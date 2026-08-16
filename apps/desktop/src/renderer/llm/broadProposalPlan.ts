import type { EditorTextReplacement } from "../editor/MadiEditorAdapter";

const MAX_BROAD_BLOCKS = 1_000;
const MAX_BROAD_REPLACEMENTS = 500;

export type LlmBroadProposalStatus =
  | "READY"
  | "STALE_DOCUMENT"
  | "SOURCE_NOT_CURRENT_DOCUMENT"
  | "EMPTY_DOCUMENT"
  | "INVALID_LINE_ENDINGS"
  | "TOO_LARGE"
  | "STRUCTURE_MISMATCH"
  | "SCENE_BREAK_CHANGED"
  | "INSERT_DELETE_UNSUPPORTED"
  | "UNSAFE_BLOCK"
  | "NO_CHANGES";

export interface LlmBroadProposalIdentity {
  readonly generation: number;
  readonly revision: number;
}

export interface LlmBroadProposalInput {
  readonly expected: LlmBroadProposalIdentity;
  readonly current: LlmBroadProposalIdentity;
  readonly currentText: string;
  readonly originalText: string;
  readonly proposalText: string;
}

export interface LlmBroadProposalBlocked {
  readonly status: Exclude<LlmBroadProposalStatus, "READY">;
  readonly message: string;
}

export interface LlmBroadProposalReplacement extends EditorTextReplacement {
  readonly blockIndex: number;
}

export interface LlmBroadProposalReady {
  readonly status: "READY";
  readonly message: string;
  readonly blockCount: number;
  readonly changedBlockCount: number;
  readonly replacements: readonly LlmBroadProposalReplacement[];
  readonly expectedDocumentText: string;
  readonly requiresSafetySnapshot: true;
}

export type LlmBroadProposalAssessment =
  | LlmBroadProposalBlocked
  | LlmBroadProposalReady;

interface AnnotatedBlock {
  readonly index: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly kind: "TEXT" | "SCENE_BREAK";
}

function blocked(
  status: LlmBroadProposalBlocked["status"],
  message: string
): LlmBroadProposalBlocked {
  return { status, message };
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function isSceneBreak(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "***" || trimmed === "* * *";
}

function parseAnnotatedBlocks(value: string): readonly AnnotatedBlock[] | null {
  if (/\r|\u2028|\u2029/u.test(value)) {
    return null;
  }
  const segments = value.split("\n\n");
  const blocks: AnnotatedBlock[] = [];
  let cursor = 0;
  for (const [index, text] of segments.entries()) {
    const start = cursor;
    const end = start + scalarLength(text);
    blocks.push({
      index,
      text,
      start,
      end,
      kind: isSceneBreak(text) ? "SCENE_BREAK" : "TEXT"
    });
    cursor = end + (index < segments.length - 1 ? 2 : 0);
  }
  return blocks;
}

function minimalChangedRange(
  originalText: string,
  proposalText: string
): {
  readonly prefixLength: number;
  readonly originalMiddle: string;
  readonly proposalMiddle: string;
} {
  const original = Array.from(originalText);
  const proposal = Array.from(proposalText);
  let prefixLength = 0;
  while (
    prefixLength < original.length &&
    prefixLength < proposal.length &&
    original[prefixLength] === proposal[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < original.length - prefixLength &&
    suffixLength < proposal.length - prefixLength &&
    original[original.length - 1 - suffixLength] ===
      proposal[proposal.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    prefixLength,
    originalMiddle: original
      .slice(prefixLength, original.length - suffixLength)
      .join(""),
    proposalMiddle: proposal
      .slice(prefixLength, proposal.length - suffixLength)
      .join("")
  };
}

function applyReplacements(
  source: string,
  replacements: readonly LlmBroadProposalReplacement[]
): string {
  const characters = Array.from(source);
  for (const replacement of [...replacements].sort(
    (left, right) => right.start - left.start || right.end - left.end
  )) {
    characters.splice(
      replacement.start,
      replacement.end - replacement.start,
      ...Array.from(replacement.replacement)
    );
  }
  return characters.join("");
}

/**
 * Plans a broad rewrite of the complete active Typie document. The planner is
 * intentionally conservative: paragraph separators and semantic scene-break
 * blocks must remain at the same indices, and every changed block must reduce
 * to a non-empty in-place text replacement. The pinned Typie transaction still
 * performs the final node/modifier validation.
 */
export function planLlmBroadProposal(
  input: LlmBroadProposalInput
): LlmBroadProposalAssessment {
  if (
    input.expected.generation !== input.current.generation ||
    input.expected.revision !== input.current.revision
  ) {
    return blocked(
      "STALE_DOCUMENT",
      "제안을 만든 뒤 편집 문서가 바뀌었습니다. 전체 문서를 다시 불러오세요."
    );
  }
  if (input.currentText !== input.originalText) {
    return blocked(
      "SOURCE_NOT_CURRENT_DOCUMENT",
      "다중 문단 적용은 현재 활성 Typie 문서 전체와 정확히 일치하는 범위에만 허용됩니다."
    );
  }
  if (input.originalText.length === 0) {
    return blocked("EMPTY_DOCUMENT", "적용할 원고가 비어 있습니다.");
  }

  const originalBlocks = parseAnnotatedBlocks(input.originalText);
  const proposalBlocks = parseAnnotatedBlocks(input.proposalText);
  if (!originalBlocks || !proposalBlocks) {
    return blocked(
      "INVALID_LINE_ENDINGS",
      "현재 단계는 Typie annotated prose의 LF 문단 경계만 지원합니다."
    );
  }
  if (
    originalBlocks.length > MAX_BROAD_BLOCKS ||
    proposalBlocks.length > MAX_BROAD_BLOCKS
  ) {
    return blocked(
      "TOO_LARGE",
      `한 번에 검토할 수 있는 의미 블록은 ${MAX_BROAD_BLOCKS.toLocaleString("ko-KR")}개까지입니다.`
    );
  }
  if (originalBlocks.length !== proposalBlocks.length) {
    return blocked(
      "STRUCTURE_MISMATCH",
      "AI 제안이 문단 수를 추가하거나 삭제했습니다. 현재 단계에서는 기존 문단 구조를 유지해야 합니다."
    );
  }

  const replacements: LlmBroadProposalReplacement[] = [];
  for (let index = 0; index < originalBlocks.length; index += 1) {
    const original = originalBlocks[index]!;
    const proposal = proposalBlocks[index]!;
    if (original.kind !== proposal.kind) {
      return blocked(
        "SCENE_BREAK_CHANGED",
        "AI 제안이 장면 구분선과 일반 문단의 위치를 바꿨습니다."
      );
    }
    if (original.kind === "SCENE_BREAK") {
      if (original.text !== proposal.text) {
        return blocked(
          "SCENE_BREAK_CHANGED",
          "장면 구분선은 다중 문단 AI 적용에서 변경할 수 없습니다."
        );
      }
      continue;
    }
    if (original.text === proposal.text) {
      continue;
    }
    if (/\n/u.test(original.text) || /\n/u.test(proposal.text)) {
      return blocked(
        "UNSAFE_BLOCK",
        "한 의미 블록 안의 hard break를 변경하는 제안은 자동 적용하지 않습니다."
      );
    }

    const changed = minimalChangedRange(original.text, proposal.text);
    if (
      changed.originalMiddle.length === 0 ||
      changed.proposalMiddle.length === 0
    ) {
      return blocked(
        "INSERT_DELETE_UNSUPPORTED",
        "문단 내부의 순수 삽입·삭제는 현재 다중 문단 자동 적용에서 제외됩니다."
      );
    }
    const start = original.start + changed.prefixLength;
    const end = start + scalarLength(changed.originalMiddle);
    replacements.push({
      id: `llm-broad-${input.current.generation}-${input.current.revision}-${index}`,
      blockIndex: index,
      start,
      end,
      expectedText: changed.originalMiddle,
      replacement: changed.proposalMiddle
    });
    if (replacements.length > MAX_BROAD_REPLACEMENTS) {
      return blocked(
        "TOO_LARGE",
        `한 번에 적용할 수 있는 변경 블록은 ${MAX_BROAD_REPLACEMENTS.toLocaleString("ko-KR")}개까지입니다.`
      );
    }
  }

  if (replacements.length === 0) {
    return blocked("NO_CHANGES", "원고와 AI 제안 사이에 적용할 변경이 없습니다.");
  }
  const expectedDocumentText = applyReplacements(
    input.currentText,
    replacements
  );
  if (expectedDocumentText !== input.proposalText) {
    return blocked(
      "STRUCTURE_MISMATCH",
      "AI 제안을 기존 의미 블록 구조에 손실 없이 투영할 수 없습니다."
    );
  }

  return {
    status: "READY",
    message: `${replacements.length.toLocaleString("ko-KR")}개 의미 블록을 하나의 Typie transaction으로 적용할 수 있습니다. 적용 전 프로젝트 안전 snapshot이 필요합니다.`,
    blockCount: originalBlocks.length,
    changedBlockCount: replacements.length,
    replacements,
    expectedDocumentText,
    requiresSafetySnapshot: true
  };
}
