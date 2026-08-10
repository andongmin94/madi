import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import {
  serializeLlmScopeForConsent,
  type LlmInvocationResult,
  type LlmInvocationScope
} from "../../../shared/llm";
import type {
  LlmProviderSummary,
  LlmRuntimeStatus,
  MadiLlmApi
} from "../../../shared/llmIpc";
import type {
  ActiveLlmEditorSelection,
  ActiveLlmEditorState,
  LlmEditorAccess
} from "../../llm/editorAccess";
import {
  allLlmProposalHunkIds,
  createLlmProposalReview,
  renderLlmProposalReview,
  type LlmProposalReview
} from "../../llm/proposalDiff";
import "./llmSelectionRewrite.css";

const EMPTY_STATUS: LlmRuntimeStatus = {
  providerStore: "UNAVAILABLE",
  credentialStorage: "UNAVAILABLE"
};

const SYSTEM_INSTRUCTION =
  "당신은 한국어 장편소설 편집 보조자입니다. 선택된 원문의 의미, 인물 말투와 서술 시점을 보존하세요. 설명이나 머리말 없이 수정 제안문만 반환하세요.";

const DEFAULT_USER_INSTRUCTION =
  "선택한 문장의 의미와 분위기를 유지하면서 어색한 표현과 문장 호흡을 자연스럽게 다듬어 주세요.";

interface SelectionProposalState {
  readonly result: LlmInvocationResult;
  readonly review: LlmProposalReview;
}

interface ApplyUiState {
  readonly ready: boolean;
  readonly checking: boolean;
  readonly message: string;
}

const INITIAL_APPLY_STATE: ApplyUiState = {
  ready: false,
  checking: false,
  message: "제안문을 받은 뒤 현재 선택 영역과 다시 대조합니다."
};

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function providerHost(provider: LlmProviderSummary | null): string {
  if (!provider) {
    return "—";
  }
  try {
    return new URL(provider.config.baseUrl).host;
  } catch {
    return "잘못된 URL";
  }
}

async function browserScopeHash(scope: LlmInvocationScope): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serializeLlmScopeForConsent(scope))
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export interface LlmSelectionRewriteOverlayProps {
  readonly api: MadiLlmApi;
  readonly editorAccess: LlmEditorAccess;
  readonly createId: () => string;
  readonly createScopeHash?: (scope: LlmInvocationScope) => Promise<string>;
  readonly copyText?: (value: string) => Promise<void>;
  readonly now: () => Date;
}

export function LlmSelectionRewriteOverlay({
  api,
  editorAccess,
  createId,
  createScopeHash = browserScopeHash,
  copyText = copyToClipboard,
  now
}: LlmSelectionRewriteOverlayProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LlmRuntimeStatus>(EMPTY_STATUS);
  const [providers, setProviders] = useState<readonly LlmProviderSummary[]>([]);
  const [providerId, setProviderId] = useState("");
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providerError, setProviderError] = useState("");

  const [selection, setSelection] =
    useState<ActiveLlmEditorSelection | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [instruction, setInstruction] = useState(DEFAULT_USER_INSTRUCTION);
  const [consentChecked, setConsentChecked] = useState(false);

  const [invocationBusy, setInvocationBusy] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [proposal, setProposal] =
    useState<SelectionProposalState | null>(null);
  const [acceptedHunkIds, setAcceptedHunkIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [applyState, setApplyState] =
    useState<ApplyUiState>(INITIAL_APPLY_STATE);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [requestError, setRequestError] = useState("");
  const [editorState, setEditorState] = useState<ActiveLlmEditorState>(() =>
    editorAccess.getState()
  );

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.config.id === providerId) ?? null,
    [providerId, providers]
  );

  const selectedProposalText = useMemo(
    () =>
      proposal
        ? renderLlmProposalReview(proposal.review, acceptedHunkIds)
        : "",
    [acceptedHunkIds, proposal]
  );

  const resetProposal = useCallback(() => {
    setProposal(null);
    setAcceptedHunkIds(new Set());
    setApplyState(INITIAL_APPLY_STATE);
    setApplied(false);
    setActionMessage("");
  }, []);

  const reloadProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProviderError("");
    try {
      const nextStatus = await api.getStatus();
      setStatus(nextStatus);
      if (nextStatus.providerStore !== "AVAILABLE") {
        setProviders([]);
        setProviderId("");
        setProviderError("AI 제공자 저장소를 사용할 수 없습니다.");
        return;
      }
      const nextProviders = await api.listProviders();
      setProviders(nextProviders);
      setProviderId((current) =>
        nextProviders.some((provider) => provider.config.id === current)
          ? current
          : (nextProviders[0]?.config.id ?? "")
      );
    } catch (error) {
      setStatus(EMPTY_STATUS);
      setProviders([]);
      setProviderId("");
      setProviderError(publicError(error, "AI 제공자를 불러오지 못했습니다."));
    } finally {
      setProvidersLoading(false);
    }
  }, [api]);

  const reloadSelection = useCallback(async () => {
    setSelectionLoading(true);
    setSelectionError("");
    setConsentChecked(false);
    resetProposal();
    try {
      setSelection(await editorAccess.readCurrentSelection());
    } catch (error) {
      setSelection(null);
      setSelectionError(
        publicError(error, "현재 Typie 선택 영역을 읽지 못했습니다.")
      );
    } finally {
      setSelectionLoading(false);
    }
  }, [editorAccess, resetProposal]);

  useEffect(() => editorAccess.subscribe(setEditorState), [editorAccess]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void reloadProviders();
    void reloadSelection();
  }, [open, reloadProviders, reloadSelection]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !invocationBusy &&
        !applyBusy
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyBusy, invocationBusy, open]);

  useEffect(() => {
    let cancelled = false;
    if (!proposal || !selection) {
      setApplyState(INITIAL_APPLY_STATE);
      return () => {
        cancelled = true;
      };
    }
    if (applied) {
      setApplyState({
        ready: false,
        checking: false,
        message:
          "선택한 변경 조각을 현재 Typie 문서에 적용했습니다. Ctrl+Z로 되돌릴 수 있습니다."
      });
      return () => {
        cancelled = true;
      };
    }

    setApplyState({
      ready: false,
      checking: true,
      message: "현재 문서와 선택 반영본을 다시 대조하는 중입니다."
    });
    void editorAccess
      .assessProposal({
        expectedGeneration: selection.generation,
        expectedRevision: selection.revision,
        originalText: selection.selection.text,
        proposalText: selectedProposalText,
        sourceRange: {
          start: selection.selection.start,
          end: selection.selection.end,
          blockKey: selection.selection.blockKey
        }
      })
      .then((assessment) => {
        if (!cancelled) {
          setApplyState({
            ready: assessment.status === "READY",
            checking: false,
            message: assessment.message
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setApplyState({
            ready: false,
            checking: false,
            message: publicError(
              error,
              "선택 반영본의 적용 가능성을 확인하지 못했습니다."
            )
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    applied,
    editorAccess,
    editorState.generation,
    editorState.isComposing,
    editorState.revision,
    proposal,
    selectedProposalText,
    selection
  ]);

  const requestProposal = async () => {
    if (!selection) {
      setRequestError("먼저 현재 Typie 선택 영역을 불러오세요.");
      return;
    }
    if (!selectedProvider) {
      setRequestError("먼저 전체 AI 설정에서 제공자를 등록하거나 선택하세요.");
      return;
    }
    if (
      selectedProvider.credentialState === "MISSING" ||
      selectedProvider.credentialState === "LOCKED"
    ) {
      setRequestError("선택한 제공자의 API 키를 사용할 수 없습니다.");
      return;
    }
    if (!consentChecked) {
      setRequestError("제공자와 선택 영역을 확인한 뒤 전송에 동의하세요.");
      return;
    }

    const scope: LlmInvocationScope = {
      kind: "SELECTION",
      sourceId: [
        "active-editor",
        selection.generation,
        selection.revision,
        selection.selection.start,
        selection.selection.end,
        selection.selection.blockKey
      ].join(":"),
      manuscriptText: selection.selection.text,
      contextText: null
    };
    const requestId = createId();
    setInvocationBusy(true);
    setActiveRequestId(requestId);
    setRequestError("");
    setActionMessage("");
    resetProposal();
    try {
      const result = await api.invoke({
        invocation: {
          requestId,
          providerId: selectedProvider.config.id,
          expectedProviderRevision: selectedProvider.config.revision,
          task: "REWRITE_SELECTION",
          systemInstruction: SYSTEM_INSTRUCTION,
          userInstruction: instruction,
          scope,
          consent: {
            confirmedAt: now().toISOString(),
            scopeSha256: await createScopeHash(scope)
          }
        }
      });
      const review = createLlmProposalReview(
        selection.selection.text,
        result.text
      );
      setProposal({ result, review });
      setAcceptedHunkIds(allLlmProposalHunkIds(review));
      setConsentChecked(false);
    } catch (error) {
      setRequestError(publicError(error, "AI 수정 제안을 받지 못했습니다."));
    } finally {
      setInvocationBusy(false);
      setActiveRequestId(null);
    }
  };

  const cancelRequest = async () => {
    if (!activeRequestId) {
      return;
    }
    try {
      await api.cancel({ requestId: activeRequestId });
    } catch (error) {
      setRequestError(publicError(error, "AI 요청을 취소하지 못했습니다."));
    }
  };

  const toggleHunk = (hunkId: string, accepted: boolean) => {
    setAcceptedHunkIds((current) => {
      const next = new Set(current);
      if (accepted) {
        next.add(hunkId);
      } else {
        next.delete(hunkId);
      }
      return next;
    });
    setApplied(false);
    setActionMessage("");
  };

  const applySelectedHunks = async () => {
    if (!selection || !proposal || !applyState.ready) {
      return;
    }
    setApplyBusy(true);
    setRequestError("");
    setActionMessage("");
    try {
      await editorAccess.applyProposal({
        expectedGeneration: selection.generation,
        expectedRevision: selection.revision,
        originalText: selection.selection.text,
        proposalText: selectedProposalText,
        sourceRange: {
          start: selection.selection.start,
          end: selection.selection.end,
          blockKey: selection.selection.blockKey
        }
      });
      setApplied(true);
    } catch (error) {
      setRequestError(
        publicError(error, "선택한 변경 조각을 원고에 적용하지 못했습니다.")
      );
    } finally {
      setApplyBusy(false);
    }
  };

  const copySelectedProposal = async () => {
    try {
      await copyText(selectedProposalText);
      setActionMessage("선택 반영본을 클립보드에 복사했습니다.");
    } catch (error) {
      setActionMessage(publicError(error, "선택 반영본을 복사하지 못했습니다."));
    }
  };

  return (
    <>
      <button
        type="button"
        className="madi-llm-selection-launcher"
        aria-label="AI 선택 영역 다듬기"
        onClick={() => setOpen(true)}
      >
        AI✎
      </button>
      {open ? (
        <div
          className="madi-llm-selection-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !invocationBusy &&
              !applyBusy
            ) {
              setOpen(false);
            }
          }}
        >
          <section
            className="madi-llm-selection-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="madi-llm-selection-title"
          >
            <header>
              <div>
                <p>정확한 Typie 선택 영역 · 변경 조각 검토</p>
                <h2 id="madi-llm-selection-title">AI 선택 다듬기</h2>
              </div>
              <button
                type="button"
                aria-label="AI 선택 다듬기 닫기"
                disabled={invocationBusy || applyBusy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="madi-llm-selection-body">
              <p className="madi-llm-selection-notice">
                여러 번 나오는 같은 문장도 실제로 선택한 위치에만 적용합니다. 현재
                단계는 한 의미 블록 안의 선택만 허용하며 성공 시 한 번의 Ctrl+Z로
                되돌릴 수 있습니다.
              </p>

              <div className="madi-llm-selection-grid">
                <label>
                  제공자
                  <select
                    value={providerId}
                    disabled={providersLoading || invocationBusy}
                    onChange={(event) => {
                      setProviderId(event.target.value);
                      setConsentChecked(false);
                      resetProposal();
                    }}
                  >
                    {providers.length === 0 ? (
                      <option value="">등록된 제공자 없음</option>
                    ) : null}
                    {providers.map((provider) => (
                      <option key={provider.config.id} value={provider.config.id}>
                        {provider.config.name} · {provider.config.model}
                      </option>
                    ))}
                  </select>
                </label>
                <dl>
                  <div>
                    <dt>대상</dt>
                    <dd>{providerHost(selectedProvider)}</dd>
                  </div>
                  <div>
                    <dt>보호 저장소</dt>
                    <dd>{status.credentialStorage}</dd>
                  </div>
                </dl>
              </div>
              {providerError ? (
                <p className="madi-llm-selection-error" role="alert">
                  {providerError}
                </p>
              ) : null}

              <section className="madi-llm-selection-card">
                <div className="madi-llm-selection-heading">
                  <div>
                    <h3>선택 원문</h3>
                    <p>
                      {selection
                        ? `${selection.selection.text.length.toLocaleString("ko-KR")}자 · scalar ${selection.selection.start}–${selection.selection.end}`
                        : "Typie 편집기에서 한 문단 안의 텍스트를 선택하세요."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={selectionLoading || invocationBusy || applyBusy}
                    onClick={() => void reloadSelection()}
                  >
                    {selectionLoading ? "읽는 중…" : "선택 다시 읽기"}
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={5}
                  aria-label="AI 다듬기 선택 원문"
                  value={selection?.selection.text ?? ""}
                />
                {selectionError ? (
                  <p className="madi-llm-selection-error" role="alert">
                    {selectionError}
                  </p>
                ) : null}
              </section>

              <section className="madi-llm-selection-card">
                <h3>수정 지시</h3>
                <textarea
                  rows={3}
                  aria-label="AI 선택 다듬기 지시"
                  value={instruction}
                  disabled={invocationBusy}
                  onChange={(event) => {
                    setInstruction(event.target.value);
                    setConsentChecked(false);
                    resetProposal();
                  }}
                />
                <label className="madi-llm-selection-consent">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    disabled={!selection || invocationBusy}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                  />
                  <span>
                    {selectedProvider?.config.name ?? "선택한 제공자"}에 위 선택
                    원문만 전송하는 데 동의합니다.
                  </span>
                </label>
                <div className="madi-llm-selection-actions">
                  <button
                    type="button"
                    className="is-primary"
                    disabled={
                      invocationBusy ||
                      !selection ||
                      !selectedProvider ||
                      !consentChecked ||
                      instruction.trim().length === 0
                    }
                    onClick={() => void requestProposal()}
                  >
                    {invocationBusy ? "제안 생성 중…" : "수정 제안 요청"}
                  </button>
                  {invocationBusy ? (
                    <button type="button" onClick={() => void cancelRequest()}>
                      요청 취소
                    </button>
                  ) : null}
                </div>
                {requestError ? (
                  <p className="madi-llm-selection-error" role="alert">
                    {requestError}
                  </p>
                ) : null}
              </section>

              {proposal ? (
                <section className="madi-llm-selection-card">
                  <div className="madi-llm-selection-heading">
                    <div>
                      <h3>변경 조각 검토</h3>
                      <p>
                        {acceptedHunkIds.size}/{proposal.review.hunks.length}개 반영 ·
                        응답 모델 {proposal.result.model}
                      </p>
                    </div>
                    <div className="madi-llm-selection-small-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setAcceptedHunkIds(
                            allLlmProposalHunkIds(proposal.review)
                          )
                        }
                      >
                        전부 선택
                      </button>
                      <button
                        type="button"
                        onClick={() => setAcceptedHunkIds(new Set())}
                      >
                        전부 해제
                      </button>
                    </div>
                  </div>

                  {proposal.review.coarse ? (
                    <p className="madi-llm-selection-warning">
                      선택 범위가 커서 전체를 하나의 변경 조각으로 표시했습니다.
                    </p>
                  ) : null}

                  <div className="madi-llm-selection-hunks">
                    {proposal.review.hunks.length === 0 ? (
                      <p>AI 제안문과 원문 사이에 변경이 없습니다.</p>
                    ) : null}
                    {proposal.review.hunks.map((hunk, index) => (
                      <label key={hunk.id} className="madi-llm-selection-hunk">
                        <input
                          type="checkbox"
                          aria-label={`변경 조각 ${index + 1} 반영`}
                          checked={acceptedHunkIds.has(hunk.id)}
                          disabled={applied || applyBusy}
                          onChange={(event) =>
                            toggleHunk(hunk.id, event.target.checked)
                          }
                        />
                        <span className="madi-llm-selection-hunk-number">
                          {index + 1}
                        </span>
                        <span>
                          <del>{hunk.originalText || "∅"}</del>
                          <ins>{hunk.proposalText || "∅"}</ins>
                        </span>
                      </label>
                    ))}
                  </div>

                  <label>
                    선택 반영본
                    <textarea
                      readOnly
                      rows={7}
                      aria-label="AI 선택 변경 반영본"
                      value={selectedProposalText}
                    />
                  </label>

                  <p
                    className={`madi-llm-selection-status ${
                      applyState.ready || applied ? "is-ready" : ""
                    }`}
                    role="status"
                  >
                    {applyState.checking
                      ? "적용 가능성을 확인하는 중입니다…"
                      : applyState.message}
                  </p>

                  <div className="madi-llm-selection-actions">
                    <button
                      type="button"
                      onClick={() => void copySelectedProposal()}
                    >
                      선택 반영본 복사
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={
                        applyBusy ||
                        applied ||
                        !applyState.ready
                      }
                      onClick={() => void applySelectedHunks()}
                    >
                      {applyBusy
                        ? "Typie에 적용 중…"
                        : applied
                          ? "원고에 적용됨"
                          : "선택 변경 원고에 적용"}
                    </button>
                  </div>
                  {actionMessage ? (
                    <p className="madi-llm-selection-status" role="status">
                      {actionMessage}
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
