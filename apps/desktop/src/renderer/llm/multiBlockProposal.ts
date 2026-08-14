import type {
  EditorStructuredSelection,
  EditorTextReplacement
} from "../editor/MadiEditorAdapter";

const MAX_MULTI_BLOCKS = 32;
const MAX_MULTI_BLOCK_CHARACTERS = 20_000;

export type LlmMultiBlockStatus =
  | "READY"
  | "INVALID_SELECTION"
  | "STRUCTURE_MISMATCH"
  | "STALE_DOCUMENT"
  | "SOURCE_MISMATCH"
  | "EMPTY_BLOCK"
  | "UNCHANGED"
  | "INSUFFICIENT_CHANGES"
  | "SEMANTIC_BOUNDARY";

export interface LlmMultiBlockIdentity {
  readonly generation: number;
  readonly revision: number;
}

export interface LlmMultiBlockBlocked {
  readonly status: Exclude<LlmMultiBlockStatus, "READY">;
  readonly message: string;
}

export interface LlmMultiBlockParsed {
  readonly status: "READY";
  readonly message: string;
  readonly blocks: readonly string[];
  readonly text: string;
}

export type LlmMultiBlockParseResult =
  | LlmMultiBlockBlocked
  | LlmMultiBlockParsed;

export interface LlmMultiBlockPlanInput {
  readonly expected: LlmMultiBlockIdentity;
  readonly current: LlmMultiBlockIdentity;
  readonly currentText: string;
  readonly selection: EditorStructuredSelection;
  readonly proposalBlocks: readonly string[];
}

export interface LlmMultiBlockPlanReady {
  readonly status: "READY";
  readonly message: string;
  readonly replacements: readonly EditorTextReplacement[];
  readonly expectedDocumentText: string;
  readonly changedBlockCount: number;
}

export type LlmMultiBlockPlan =
  | LlmMultiBlockBlocked
  | LlmMultiBlockPlanReady;

function blocked(
  status: LlmMultiBlockBlocked["status"],
  message: string
): LlmMultiBlockBlocked {
  return { status, message };
}

function hasLineBoundary(value: string): boolean {
  return /[\r\n\u2028\u2029]/u.test(value);
}

function isSceneBreakFallback(value: string): boolean {
  const normalized = value.trim();
  return normalized === "***" || normalized === "* * *";
}

function isStructuralSeparator(value: string): boolean {
  return (
    value.length > 0 &&
    hasLineBoundary(value) &&
    /^[\t \r\n\u2028\u2029]+$/u.test(value)
  );
}

function validateSelection(
  selection: EditorStructuredSelection
): LlmMultiBlockBlocked | null {
  if (
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start ||
    selection.segments.length < 2 ||
    selection.segments.length > MAX_MULTI_BLOCKS ||
    selection.separators.length !== selection.segments.length - 1 ||
    Array.from(selection.text).length > MAX_MULTI_BLOCK_CHARACTERS
  ) {
    return blocked(
      "INVALID_SELECTION",
      "2~32개의 문단으로 이루어진 제한된 Typie 선택 영역이 필요합니다."
    );
  }

  const nodeKeys = new Set<string>();
  let expectedStart = selection.start;
  let reconstructed = "";
  for (const [index, segment] of selection.segments.entries()) {
    if (
      !segment.nodeKey ||
      nodeKeys.has(segment.nodeKey) ||
      !Number.isSafeInteger(segment.start) ||
      !Number.isSafeInteger(segment.end) ||
      segment.start !== expectedStart ||
      segment.end <= segment.start ||
      segment.text.length === 0 ||
      hasLineBoundary(segment.text) ||
      isSceneBreakFallback(segment.text) ||
      Array.from(segment.text).length !== segment.end - segment.start
    ) {
      return blocked(
        "INVALID_SELECTION",
        "선택 영역의 의미 블록 경계를 안전하게 확정하지 못했습니다."
      );
    }
    nodeKeys.add(segment.nodeKey);
    reconstructed += segment.text;
    expectedStart = segment.end;

    if (index < selection.separators.length) {
      const separator = selection.separators[index]!;
      if (!isStructuralSeparator(separator)) {
        return blocked(
          "INVALID_SELECTION",
          "같은 문단 안의 여러 서식 노드가 아니라 줄바꿈으로 분리된 문단들을 선택하세요."
        );
      }
      reconstructed += separator;
      expectedStart += Array.from(separator).length;
    }
  }

  if (
    expectedStart !== selection.end ||
    reconstructed !== selection.text ||
    Array.from(selection.text).length !== selection.end - selection.start
  ) {
    return blocked(
      "INVALID_SELECTION",
      "선택 영역의 본문과 구조 구분자가 일치하지 않습니다."
    );
  }
  return null;
}

export function renderLlmMultiBlockProposal(
  selection: EditorStructuredSelection,
  blocks: readonly string[]
): string {
  if (blocks.length !== selection.segments.length) {
    throw new Error("Multi-block proposal count does not match the selection");
  }
  return blocks.reduce(
    (text, block, index) =>
      `${text}${index === 0 ? "" : selection.separators[index - 1]}${block}`,
    ""
  );
}

/**
 * Parses a provider response only when it preserves the exact structural
 * separators of the selected Typie paragraphs. Different newline counts or
 * styles remain reviewable as raw output but cannot become a replacement plan.
 */
export function parseLlmMultiBlockProposal(
  selection: EditorStructuredSelection,
  proposalText: string
): LlmMultiBlockParseResult {
  const invalidSelection = validateSelection(selection);
  if (invalidSelection) {
    return invalidSelection;
  }
  if (
    proposalText.length === 0 ||
    Array.from(proposalText).length > MAX_MULTI_BLOCK_CHARACTERS
  ) {
    return blocked(
      "STRUCTURE_MISMATCH",
      "AI 응답이 비어 있거나 다중 문단 검토 한도를 초과했습니다."
    );
  }

  const blocks: string[] = [];
  let cursor = 0;
  for (const separator of selection.separators) {
    const separatorIndex = proposalText.indexOf(separator, cursor);
    if (separatorIndex < 0) {
      return blocked(
        "STRUCTURE_MISMATCH",
        "AI가 선택 원문의 문단 구분을 그대로 유지하지 않아 블록별 검토만 진행할 수 없습니다."
      );
    }
    const block = proposalText.slice(cursor, separatorIndex);
    if (hasLineBoundary(block)) {
      return blocked(
        "STRUCTURE_MISMATCH",
        "AI 응답에 예상하지 않은 줄바꿈이 포함되어 블록 경계를 확정할 수 없습니다."
      );
    }
    blocks.push(block);
    cursor = separatorIndex + separator.length;
  }
  const finalBlock = proposalText.slice(cursor);
  if (hasLineBoundary(finalBlock)) {
    return blocked(
      "STRUCTURE_MISMATCH",
      "AI 응답에 예상하지 않은 마지막 줄바꿈이 포함되어 블록 경계를 확정할 수 없습니다."
    );
  }
  blocks.push(finalBlock);
  if (blocks.length !== selection.segments.length) {
    return blocked(
      "STRUCTURE_MISMATCH",
      "AI 응답의 문단 수가 선택 원문과 다릅니다."
    );
  }

  return {
    status: "READY",
    message: `${blocks.length}개 문단을 원래 구조와 일치하게 분리했습니다.`,
    blocks,
    text: renderLlmMultiBlockProposal(selection, blocks)
  };
}

/**
 * Read-only Phase 1I-G planning boundary. A READY result proves that a future
 * snapshot-gated commit can be expressed as non-overlapping Typie semantic
 * replacements; this function itself never mutates the editor.
 */
export function planLlmMultiBlockProposal(
  input: LlmMultiBlockPlanInput
): LlmMultiBlockPlan {
  const invalidSelection = validateSelection(input.selection);
  if (invalidSelection) {
    return invalidSelection;
  }
  if (
    input.expected.generation !== input.current.generation ||
    input.expected.revision !== input.current.revision
  ) {
    return blocked(
      "STALE_DOCUMENT",
      "제안을 만든 뒤 편집 문서가 바뀌었습니다. 다중 문단 선택을 다시 읽으세요."
    );
  }
  if (input.proposalBlocks.length !== input.selection.segments.length) {
    return blocked(
      "STRUCTURE_MISMATCH",
      "검토 중인 제안 블록 수가 선택 원문과 다릅니다."
    );
  }

  const characters = Array.from(input.currentText);
  if (
    input.selection.end > characters.length ||
    characters
      .slice(input.selection.start, input.selection.end)
      .join("") !== input.selection.text
  ) {
    return blocked(
      "SOURCE_MISMATCH",
      "현재 Typie 문서의 선택 범위가 AI 요청 당시 원문과 다릅니다."
    );
  }

  const replacements: EditorTextReplacement[] = [];
  for (const [index, segment] of input.selection.segments.entries()) {
    const proposal = input.proposalBlocks[index]!;
    if (
      characters.slice(segment.start, segment.end).join("") !== segment.text
    ) {
      return blocked(
        "SOURCE_MISMATCH",
        "현재 Typie 문서의 의미 블록 하나가 AI 요청 당시 원문과 다릅니다."
      );
    }
    if (proposal.length === 0) {
      return blocked(
        "EMPTY_BLOCK",
        "빈 문단으로 원고를 삭제하지 않도록 다중 블록 적용 계획을 막았습니다."
      );
    }
    if (hasLineBoundary(proposal) || isSceneBreakFallback(proposal)) {
      return blocked(
        "SEMANTIC_BOUNDARY",
        "각 제안 블록은 줄바꿈과 장면 구분선을 포함하지 않아야 합니다."
      );
    }
    if (proposal !== segment.text) {
      replacements.push({
        id: `llm-multiblock-${input.current.generation}-${input.current.revision}-${index}`,
        start: segment.start,
        end: segment.end,
        expectedText: segment.text,
        replacement: proposal
      });
    }
  }

  if (replacements.length === 0) {
    return blocked("UNCHANGED", "선택한 변경 조각이 없어 원문과 같습니다.");
  }
  if (replacements.length < 2) {
    return blocked(
      "INSUFFICIENT_CHANGES",
      "실제 변경은 한 블록뿐입니다. 현재 AI✎ 단일 선택 적용 경계를 사용하세요."
    );
  }

  const expectedCharacters = [...characters];
  for (const replacement of [...replacements].sort(
    (left, right) => right.start - left.start
  )) {
    expectedCharacters.splice(
      replacement.start,
      replacement.end - replacement.start,
      ...Array.from(replacement.replacement)
    );
  }
  return {
    status: "READY",
    message:
      "여러 Typie 블록의 원문·위치·revision이 일치합니다. 프로젝트 안전 snapshot 경계가 연결되면 원자적으로 적용할 수 있습니다.",
    replacements,
    expectedDocumentText: expectedCharacters.join(""),
    changedBlockCount: replacements.length
  };
}
