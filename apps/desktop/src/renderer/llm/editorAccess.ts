import type {
  EditorChange,
  EditorTextSelection,
  MadiEditorAdapter,
  MadiEditorAdapterFactory
} from "../editor/MadiEditorAdapter";
import {
  LlmProposalApplyError,
  planLlmProposalApply,
  type LlmProposalApplyAssessment,
  type LlmProposalApplyResult,
  type LlmProposalSourceRange
} from "./proposalApply";

export interface ActiveLlmEditorState {
  readonly generation: number;
  readonly revision: number;
  readonly isComposing: boolean;
  readonly canReadSelection: boolean;
  readonly canApplyProposal: boolean;
}

export interface ActiveLlmEditorDocument extends ActiveLlmEditorState {
  readonly plainText: string;
}

export interface ActiveLlmEditorSelection extends ActiveLlmEditorState {
  readonly selection: EditorTextSelection;
}

export interface LlmProposalApplyRequest {
  readonly expectedGeneration: number;
  readonly expectedRevision: number;
  readonly originalText: string;
  readonly proposalText: string;
  readonly sourceRange?: LlmProposalSourceRange | null;
}

export class LlmEditorAccess {
  private adapter: MadiEditorAdapter | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<
    (state: ActiveLlmEditorState) => void
  >();
  private generation = 0;
  private revision = 0;
  private isComposing = false;

  attach(adapter: MadiEditorAdapter): void {
    this.unsubscribe?.();
    this.adapter = adapter;
    this.generation += 1;
    this.revision = 0;
    this.isComposing = false;
    this.unsubscribe = adapter.onChanged((change: EditorChange) => {
      if (change.reason === "restore") {
        this.generation += 1;
      }
      this.revision = change.revision;
      this.isComposing = change.isComposing;
      this.emit();
    });
    this.emit();
  }

  getState(): ActiveLlmEditorState {
    return {
      generation: this.generation,
      revision: this.revision,
      isComposing: this.isComposing,
      canReadSelection: typeof this.adapter?.getTextSelection === "function",
      canApplyProposal: typeof this.adapter?.replaceTextRanges === "function"
    };
  }

  subscribe(listener: (state: ActiveLlmEditorState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async readCurrentDocument(): Promise<ActiveLlmEditorDocument> {
    const adapter = this.requireAdapter();
    this.requireCompositionFinished();
    const before = this.getState();
    const plainText = await adapter.getPlainText();
    const after = this.getState();
    if (
      before.generation !== after.generation ||
      before.revision !== after.revision ||
      after.isComposing
    ) {
      throw new Error(
        "원고를 읽는 동안 편집 문서가 바뀌었습니다. 다시 시도하세요."
      );
    }
    return {
      ...after,
      plainText
    };
  }

  async readCurrentSelection(): Promise<ActiveLlmEditorSelection> {
    const adapter = this.requireAdapter();
    this.requireCompositionFinished();
    if (!adapter.getTextSelection) {
      throw new Error("현재 Typie runtime은 선택 영역 매핑을 지원하지 않습니다.");
    }
    const before = this.getState();
    const selection = adapter.getTextSelection();
    const after = this.getState();
    if (
      before.generation !== after.generation ||
      before.revision !== after.revision ||
      after.isComposing
    ) {
      throw new Error(
        "선택 영역을 읽는 동안 편집 문서가 바뀌었습니다. 다시 선택하세요."
      );
    }
    if (!selection) {
      throw new Error(
        "한 문단 안의 텍스트를 정확히 선택한 뒤 다시 시도하세요. 너무 짧거나 여러 블록에 걸친 선택은 사용할 수 없습니다."
      );
    }
    return {
      ...after,
      selection
    };
  }

  async assessProposal(
    request: LlmProposalApplyRequest
  ): Promise<LlmProposalApplyAssessment> {
    const adapter = this.adapter;
    if (!adapter) {
      return {
        status: "EDITOR_UNAVAILABLE",
        message: "편집기가 아직 준비되지 않았습니다."
      };
    }
    if (typeof adapter.replaceTextRanges !== "function") {
      return {
        status: "APPLY_UNSUPPORTED",
        message: "현재 Typie runtime은 의미구조 보존 적용을 지원하지 않습니다."
      };
    }
    if (this.isComposing) {
      return {
        status: "COMPOSITION_ACTIVE",
        message: "한글 조합이 끝난 뒤 제안문을 적용하세요."
      };
    }
    const before = this.getState();
    const currentText = await adapter.getPlainText();
    const after = this.getState();
    if (
      before.generation !== after.generation ||
      before.revision !== after.revision ||
      after.isComposing
    ) {
      return {
        status: "STALE_DOCUMENT",
        message:
          "적용 가능성을 확인하는 동안 편집 문서가 바뀌었습니다. 다시 시도하세요."
      };
    }
    return planLlmProposalApply({
      expected: {
        generation: request.expectedGeneration,
        revision: request.expectedRevision
      },
      current: {
        generation: after.generation,
        revision: after.revision
      },
      currentText,
      originalText: request.originalText,
      proposalText: request.proposalText,
      sourceRange: request.sourceRange
    });
  }

  async applyProposal(
    request: LlmProposalApplyRequest
  ): Promise<LlmProposalApplyResult> {
    const adapter = this.requireAdapter();
    if (!adapter.replaceTextRanges) {
      throw new LlmProposalApplyError({
        status: "APPLY_UNSUPPORTED",
        message: "현재 Typie runtime은 의미구조 보존 적용을 지원하지 않습니다."
      });
    }
    this.requireCompositionFinished();

    let interactionLocked = false;
    try {
      if (adapter.setInteractionEnabled) {
        adapter.setInteractionEnabled(false);
        interactionLocked = true;
      }
      const before = this.getState();
      const currentText = await adapter.getPlainText();
      const afterRead = this.getState();
      const assessment = planLlmProposalApply({
        expected: {
          generation: request.expectedGeneration,
          revision: request.expectedRevision
        },
        current: {
          generation: afterRead.generation,
          revision: afterRead.revision
        },
        currentText,
        originalText: request.originalText,
        proposalText: request.proposalText,
        sourceRange: request.sourceRange
      });
      if (
        before.generation !== afterRead.generation ||
        before.revision !== afterRead.revision ||
        afterRead.isComposing
      ) {
        throw new LlmProposalApplyError({
          status: "STALE_DOCUMENT",
          message:
            "적용 직전에 편집 문서가 바뀌었습니다. 원고 범위를 다시 불러오세요."
        });
      }
      if (assessment.status !== "READY") {
        throw new LlmProposalApplyError(assessment);
      }

      const transformed = await adapter.replaceTextRanges([
        assessment.replacement
      ]);
      if (transformed.plainTextRecovery !== assessment.expectedDocumentText) {
        throw new Error(
          "Typie 적용 결과가 검토한 선택 반영본과 일치하지 않습니다."
        );
      }
      const current = this.getState();
      if (current.generation !== request.expectedGeneration) {
        throw new Error(
          "제안문 적용 중 편집 문서 identity가 바뀌었습니다."
        );
      }
      return {
        generation: current.generation,
        revision: current.revision,
        plainText: transformed.plainTextRecovery
      };
    } finally {
      if (interactionLocked) {
        adapter.setInteractionEnabled?.(true);
      }
      adapter.focus();
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.adapter = null;
    this.revision = 0;
    this.isComposing = false;
    this.emit();
  }

  private requireAdapter(): MadiEditorAdapter {
    if (!this.adapter) {
      throw new Error("편집기가 아직 준비되지 않았습니다.");
    }
    return this.adapter;
  }

  private requireCompositionFinished(): void {
    if (this.isComposing) {
      throw new Error("한글 조합이 끝난 뒤 다시 시도하세요.");
    }
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export function createLlmTrackedEditorFactory(
  baseFactory: MadiEditorAdapterFactory,
  access: LlmEditorAccess
): MadiEditorAdapterFactory {
  return async (mountElement) => {
    const adapter = await baseFactory(mountElement);
    access.attach(adapter);
    return adapter;
  };
}
