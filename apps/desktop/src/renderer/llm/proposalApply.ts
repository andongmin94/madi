import type { EditorTextReplacement } from "../editor/MadiEditorAdapter";

export type LlmProposalApplyStatus =
  | "READY"
  | "EDITOR_UNAVAILABLE"
  | "APPLY_UNSUPPORTED"
  | "COMPOSITION_ACTIVE"
  | "SOURCE_UNBOUND"
  | "TASK_NOT_APPLICABLE"
  | "STALE_DOCUMENT"
  | "EMPTY_SCOPE"
  | "EMPTY_PROPOSAL"
  | "UNCHANGED"
  | "MULTI_BLOCK_SCOPE"
  | "MULTI_BLOCK_PROPOSAL"
  | "SEMANTIC_BOUNDARY"
  | "NOT_FOUND"
  | "AMBIGUOUS";

export interface LlmProposalApplyIdentity {
  readonly generation: number;
  readonly revision: number;
}

export interface LlmProposalApplyInput {
  readonly expected: LlmProposalApplyIdentity;
  readonly current: LlmProposalApplyIdentity;
  readonly currentText: string;
  readonly originalText: string;
  readonly proposalText: string;
}

export interface LlmProposalApplyBlocked {
  readonly status: Exclude<LlmProposalApplyStatus, "READY">;
  readonly message: string;
}

export interface LlmProposalApplyReady {
  readonly status: "READY";
  readonly message: string;
  readonly replacement: EditorTextReplacement;
  readonly expectedDocumentText: string;
  readonly startCodeUnit: number;
  readonly endCodeUnit: number;
}

export type LlmProposalApplyAssessment =
  | LlmProposalApplyBlocked
  | LlmProposalApplyReady;

export interface LlmProposalApplyResult {
  readonly generation: number;
  readonly revision: number;
  readonly plainText: string;
}

export class LlmProposalApplyError extends Error {
  readonly code: Exclude<LlmProposalApplyStatus, "READY">;

  constructor(blocked: LlmProposalApplyBlocked) {
    super(blocked.message);
    this.name = "LlmProposalApplyError";
    this.code = blocked.status;
  }
}

function blocked(
  status: LlmProposalApplyBlocked["status"],
  message: string
): LlmProposalApplyBlocked {
  return { status, message };
}

function hasBlockBoundary(value: string): boolean {
  return /[\r\n\u2028\u2029]/u.test(value);
}

function isSceneBreakFallback(value: string): boolean {
  const normalized = value.trim();
  return normalized === "***" || normalized === "* * *";
}

function scalarOffset(source: string, codeUnitOffset: number): number {
  return Array.from(source.slice(0, codeUnitOffset)).length;
}

export function planLlmProposalApply(
  input: LlmProposalApplyInput
): LlmProposalApplyAssessment {
  if (
    input.expected.generation !== input.current.generation ||
    input.expected.revision !== input.current.revision
  ) {
    return blocked(
      "STALE_DOCUMENT",
      "제안을 만든 뒤 편집 문서가 바뀌었습니다. 원고 범위를 다시 불러오세요."
    );
  }
  if (input.originalText.length === 0) {
    return blocked("EMPTY_SCOPE", "적용할 원문 범위가 비어 있습니다.");
  }
  if (input.proposalText.length === 0) {
    return blocked(
      "EMPTY_PROPOSAL",
      "빈 제안문으로 원고를 삭제하지 않도록 적용을 막았습니다."
    );
  }
  if (input.originalText === input.proposalText) {
    return blocked("UNCHANGED", "원문과 제안문이 같습니다.");
  }
  if (hasBlockBoundary(input.originalText)) {
    return blocked(
      "MULTI_BLOCK_SCOPE",
      "현재 단계에서는 줄바꿈을 포함하지 않는 단일 의미 범위만 안전하게 적용할 수 있습니다."
    );
  }
  if (hasBlockBoundary(input.proposalText)) {
    return blocked(
      "MULTI_BLOCK_PROPOSAL",
      "제안문에 줄바꿈이 있어 현재 Typie 문단 구조를 보존한 자동 적용을 사용할 수 없습니다."
    );
  }
  if (
    isSceneBreakFallback(input.originalText) ||
    isSceneBreakFallback(input.proposalText)
  ) {
    return blocked(
      "SEMANTIC_BOUNDARY",
      "장면 구분선으로 해석될 수 있는 범위는 자동 적용하지 않습니다."
    );
  }

  const first = input.currentText.indexOf(input.originalText);
  if (first < 0) {
    return blocked(
      "NOT_FOUND",
      "현재 편집 문서에서 전송한 원문 범위를 찾지 못했습니다."
    );
  }
  if (input.currentText.indexOf(input.originalText, first + 1) >= 0) {
    return blocked(
      "AMBIGUOUS",
      "같은 원문이 현재 문서에 여러 번 있어 적용 위치를 확정할 수 없습니다. 범위를 더 길게 잡으세요."
    );
  }

  const endCodeUnit = first + input.originalText.length;
  const start = scalarOffset(input.currentText, first);
  const end = start + Array.from(input.originalText).length;
  return {
    status: "READY",
    message:
      "현재 문서의 고유한 단일 의미 범위에 Typie transaction으로 적용할 수 있습니다.",
    replacement: {
      id: `llm-proposal-${input.current.generation}-${input.current.revision}`,
      start,
      end,
      expectedText: input.originalText,
      replacement: input.proposalText
    },
    expectedDocumentText:
      input.currentText.slice(0, first) +
      input.proposalText +
      input.currentText.slice(endCodeUnit),
    startCodeUnit: first,
    endCodeUnit
  };
}
