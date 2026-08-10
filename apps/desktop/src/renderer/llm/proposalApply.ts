import type { EditorTextReplacement } from "../editor/MadiEditorAdapter";

export type LlmProposalApplyStatus =
  | "READY"
  | "EDITOR_UNAVAILABLE"
  | "APPLY_UNSUPPORTED"
  | "SELECTION_UNAVAILABLE"
  | "COMPOSITION_ACTIVE"
  | "STALE_DOCUMENT"
  | "INVALID_SOURCE_RANGE"
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

export interface LlmProposalSourceRange {
  readonly start: number;
  readonly end: number;
  readonly blockKey: string;
}

export interface LlmProposalApplyInput {
  readonly expected: LlmProposalApplyIdentity;
  readonly current: LlmProposalApplyIdentity;
  readonly currentText: string;
  readonly originalText: string;
  readonly proposalText: string;
  readonly sourceRange?: LlmProposalSourceRange | null;
}

export interface LlmProposalApplyBlocked {
  readonly status: Exclude<LlmProposalApplyStatus, "READY">;
  readonly message: string;
}

export interface LlmProposalApplyReady {
  readonly status: "READY";
  readonly sourceMode: "EXACT_SELECTION" | "UNIQUE_TEXT";
  readonly message: string;
  readonly replacement: EditorTextReplacement;
  readonly expectedDocumentText: string;
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

function replaceScalarRange(
  source: string,
  start: number,
  end: number,
  replacement: string
): string {
  const characters = Array.from(source);
  characters.splice(start, end - start, ...Array.from(replacement));
  return characters.join("");
}

function commonValidation(
  input: LlmProposalApplyInput
): LlmProposalApplyBlocked | null {
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
    return blocked("UNCHANGED", "선택한 변경 조각을 적용해도 원문과 같습니다.");
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
      "선택한 반영본에 줄바꿈이 있어 현재 Typie 문단 구조를 보존한 자동 적용을 사용할 수 없습니다."
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
  return null;
}

export function planLlmProposalApply(
  input: LlmProposalApplyInput
): LlmProposalApplyAssessment {
  const validation = commonValidation(input);
  if (validation) {
    return validation;
  }

  const currentCharacters = Array.from(input.currentText);
  if (input.sourceRange) {
    const { start, end, blockKey } = input.sourceRange;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > currentCharacters.length ||
      blockKey.length === 0 ||
      blockKey.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(blockKey)
    ) {
      return blocked(
        "INVALID_SOURCE_RANGE",
        "선택 영역의 원본 위치 정보가 올바르지 않습니다."
      );
    }
    if (currentCharacters.slice(start, end).join("") !== input.originalText) {
      return blocked(
        "NOT_FOUND",
        "선택했던 원문이 현재 Typie 문서의 같은 위치에 남아 있지 않습니다."
      );
    }
    return {
      status: "READY",
      sourceMode: "EXACT_SELECTION",
      message:
        "현재 Typie 선택 영역의 정확한 위치에 한 transaction으로 적용할 수 있습니다.",
      replacement: {
        id: `llm-selection-${input.current.generation}-${input.current.revision}`,
        start,
        end,
        expectedText: input.originalText,
        replacement: input.proposalText
      },
      expectedDocumentText: replaceScalarRange(
        input.currentText,
        start,
        end,
        input.proposalText
      )
    };
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
      "같은 원문이 현재 문서에 여러 번 있습니다. 정확한 선택 영역을 불러와 다시 요청하세요."
    );
  }

  const start = scalarOffset(input.currentText, first);
  const end = start + Array.from(input.originalText).length;
  return {
    status: "READY",
    sourceMode: "UNIQUE_TEXT",
    message:
      "현재 문서의 고유한 단일 의미 범위에 Typie transaction으로 적용할 수 있습니다.",
    replacement: {
      id: `llm-proposal-${input.current.generation}-${input.current.revision}`,
      start,
      end,
      expectedText: input.originalText,
      replacement: input.proposalText
    },
    expectedDocumentText: replaceScalarRange(
      input.currentText,
      start,
      end,
      input.proposalText
    )
  };
}
