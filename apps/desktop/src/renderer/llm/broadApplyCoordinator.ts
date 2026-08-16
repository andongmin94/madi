import type {
  EditorReplacementDocument,
  EditorTextReplacement,
  MadiEditorAdapter
} from "../editor/MadiEditorAdapter";
import {
  planLlmBroadProposal,
  type LlmBroadProposalIdentity,
  type LlmBroadProposalReady
} from "./broadProposalPlan";

export const LLM_AI_SAFETY_SNAPSHOT_KIND =
  "AUTO_BEFORE_AI_APPLY" as const;

export interface LlmBroadEditorState extends LlmBroadProposalIdentity {
  readonly isComposing: boolean;
}

export interface LlmAiSafetySnapshotRequest {
  readonly kind: typeof LLM_AI_SAFETY_SNAPSHOT_KIND;
  readonly name: string;
  readonly changedBlockCount: number;
  readonly sourceGeneration: number;
  readonly sourceRevision: number;
}

export interface LlmAiSafetySnapshotReceipt {
  readonly snapshotId: string;
  readonly projectRevision: number | null;
}

export interface LlmAiSafetySnapshotWriter {
  createSafetySnapshot(
    request: LlmAiSafetySnapshotRequest
  ): Promise<LlmAiSafetySnapshotReceipt>;
}

export interface LlmBroadApplyRuntime {
  readonly adapter: Pick<
    MadiEditorAdapter,
    | "getPlainText"
    | "replaceTextRanges"
    | "setInteractionEnabled"
    | "focus"
  >;
  getState(): LlmBroadEditorState;
}

export interface LlmBroadApplyRequest {
  readonly expectedGeneration: number;
  readonly expectedRevision: number;
  readonly originalText: string;
  readonly proposalText: string;
  readonly snapshotName: string;
}

export interface LlmBroadApplyResult {
  readonly snapshot: LlmAiSafetySnapshotReceipt;
  readonly generation: number;
  readonly revision: number;
  readonly changedBlockCount: number;
  readonly plainText: string;
}

export type LlmBroadApplyErrorCode =
  | "EDITOR_UNAVAILABLE"
  | "APPLY_UNSUPPORTED"
  | "COMPOSITION_ACTIVE"
  | "PLAN_REJECTED"
  | "SAFETY_SNAPSHOT_FAILED"
  | "INVALID_SAFETY_SNAPSHOT"
  | "STALE_AFTER_SNAPSHOT"
  | "RESULT_MISMATCH";

export class LlmBroadApplyError extends Error {
  readonly code: LlmBroadApplyErrorCode;

  constructor(code: LlmBroadApplyErrorCode, message: string) {
    super(message);
    this.name = "LlmBroadApplyError";
    this.code = code;
  }
}

function requireReadyPlan(
  expected: LlmBroadProposalIdentity,
  current: LlmBroadEditorState,
  currentText: string,
  request: LlmBroadApplyRequest
): LlmBroadProposalReady {
  const plan = planLlmBroadProposal({
    expected,
    current,
    currentText,
    originalText: request.originalText,
    proposalText: request.proposalText
  });
  if (plan.status !== "READY") {
    throw new LlmBroadApplyError("PLAN_REJECTED", plan.message);
  }
  return plan;
}

function validReceipt(
  receipt: LlmAiSafetySnapshotReceipt
): boolean {
  return (
    typeof receipt.snapshotId === "string" &&
    receipt.snapshotId.trim().length > 0 &&
    (receipt.projectRevision === null ||
      (Number.isSafeInteger(receipt.projectRevision) &&
        receipt.projectRevision >= 0))
  );
}

async function applyReplacements(
  adapter: LlmBroadApplyRuntime["adapter"],
  replacements: readonly EditorTextReplacement[]
): Promise<EditorReplacementDocument> {
  if (!adapter.replaceTextRanges) {
    throw new LlmBroadApplyError(
      "APPLY_UNSUPPORTED",
      "현재 Typie runtime은 다중 의미 블록 transaction을 지원하지 않습니다."
    );
  }
  return adapter.replaceTextRanges(replacements);
}

/**
 * Applies a complete-document, structure-preserving proposal only after an
 * external project snapshot writer confirms durable recovery. The coordinator
 * never passes manuscript or provider response text to the snapshot writer.
 */
export async function applyLlmBroadProposal(
  runtime: LlmBroadApplyRuntime,
  snapshotWriter: LlmAiSafetySnapshotWriter,
  request: LlmBroadApplyRequest
): Promise<LlmBroadApplyResult> {
  if (!runtime.adapter) {
    throw new LlmBroadApplyError(
      "EDITOR_UNAVAILABLE",
      "편집기가 준비되지 않았습니다."
    );
  }
  const expected: LlmBroadProposalIdentity = {
    generation: request.expectedGeneration,
    revision: request.expectedRevision
  };
  const initialState = runtime.getState();
  if (initialState.isComposing) {
    throw new LlmBroadApplyError(
      "COMPOSITION_ACTIVE",
      "한글 조합이 끝난 뒤 다중 문단 제안을 적용하세요."
    );
  }
  const initialText = await runtime.adapter.getPlainText();
  const plan = requireReadyPlan(
    expected,
    runtime.getState(),
    initialText,
    request
  );

  let snapshot: LlmAiSafetySnapshotReceipt;
  try {
    snapshot = await snapshotWriter.createSafetySnapshot({
      kind: LLM_AI_SAFETY_SNAPSHOT_KIND,
      name: request.snapshotName,
      changedBlockCount: plan.changedBlockCount,
      sourceGeneration: expected.generation,
      sourceRevision: expected.revision
    });
  } catch {
    throw new LlmBroadApplyError(
      "SAFETY_SNAPSHOT_FAILED",
      "AI 제안 적용 전 프로젝트 안전 snapshot을 만들지 못해 원고를 변경하지 않았습니다."
    );
  }
  if (!validReceipt(snapshot)) {
    throw new LlmBroadApplyError(
      "INVALID_SAFETY_SNAPSHOT",
      "프로젝트 안전 snapshot 결과가 올바르지 않아 원고를 변경하지 않았습니다."
    );
  }

  const afterSnapshotState = runtime.getState();
  const afterSnapshotText = await runtime.adapter.getPlainText();
  let finalPlan: LlmBroadProposalReady;
  try {
    finalPlan = requireReadyPlan(
      expected,
      afterSnapshotState,
      afterSnapshotText,
      request
    );
  } catch {
    throw new LlmBroadApplyError(
      "STALE_AFTER_SNAPSHOT",
      "안전 snapshot을 만드는 동안 편집 문서가 바뀌어 AI 제안을 적용하지 않았습니다."
    );
  }

  let interactionLocked = false;
  try {
    if (runtime.adapter.setInteractionEnabled) {
      runtime.adapter.setInteractionEnabled(false);
      interactionLocked = true;
    }
    const beforeCommitState = runtime.getState();
    const beforeCommitText = await runtime.adapter.getPlainText();
    finalPlan = requireReadyPlan(
      expected,
      beforeCommitState,
      beforeCommitText,
      request
    );
    const transformed = await applyReplacements(
      runtime.adapter,
      finalPlan.replacements
    );
    if (transformed.plainTextRecovery !== finalPlan.expectedDocumentText) {
      throw new LlmBroadApplyError(
        "RESULT_MISMATCH",
        "Typie 다중 블록 적용 결과가 검토한 AI 제안과 일치하지 않습니다."
      );
    }
    const current = runtime.getState();
    if (current.generation !== expected.generation) {
      throw new LlmBroadApplyError(
        "RESULT_MISMATCH",
        "AI 적용 중 활성 Typie 문서 identity가 바뀌었습니다."
      );
    }
    return {
      snapshot,
      generation: current.generation,
      revision: current.revision,
      changedBlockCount: finalPlan.changedBlockCount,
      plainText: transformed.plainTextRecovery
    };
  } finally {
    if (interactionLocked) {
      runtime.adapter.setInteractionEnabled?.(true);
    }
    runtime.adapter.focus();
  }
}
