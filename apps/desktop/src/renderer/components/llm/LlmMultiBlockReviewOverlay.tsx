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
  ActiveLlmEditorState,
  ActiveLlmEditorStructuredSelection,
  LlmEditorAccess
} from "../../llm/editorAccess";
import {
  parseLlmMultiBlockProposal,
  renderLlmMultiBlockProposal,
  type LlmMultiBlockParsed
} from "../../llm/multiBlockProposal";
import {
  allLlmProposalHunkIds,
  createLlmProposalReview,
  renderLlmProposalReview,
  type LlmProposalReview
} from "../../llm/proposalDiff";
import "./llmMultiBlockReview.css";

const EMPTY_STATUS: LlmRuntimeStatus = {
  providerStore: "UNAVAILABLE",
  credentialStorage: "UNAVAILABLE"
};

const SYSTEM_INSTRUCTION = [
  "당신은 한국어 장편소설 편집 보조자입니다.",
  "제공된 각 문단의 의미, 인물 말투와 서술 시점을 보존하세요.",
  "원문의 문단 수와 문단 사이 빈 줄을 정확히 유지하세요.",
  "문단을 합치거나 나누지 말고 설명이나 머리말 없이 수정 원고만 반환하세요."
].join(" ");

const DEFAULT_INSTRUCTION =
  "선택한 여러 문단의 의미와 흐름을 유지하면서 어색한 표현과 문장 호흡을 자연스럽게 다듬어 주세요.";

interface MultiBlockProposalState {
  readonly result: LlmInvocationResult;
  readonly parsed: LlmMultiBlockParsed | null;
  readonly parseMessage: string;
  readonly reviews: readonly LlmProposalReview[];
}

interface AssessmentState {
  readonly ready: boolean;
  readonly checking: boolean;
  readonly message: string;
}

const INITIAL_ASSESSMENT: AssessmentState = {
  ready: false,
  checking: false,
  message: "제안문을 받은 뒤 각 Typie 블록의 원문과 위치를 다시 대조합니다."
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

export interface LlmMultiBlockReviewOverlayProps {
  readonly api: MadiLlmApi;
  readonly editorAccess: LlmEditorAccess;
  readonly createId: () => string;
  readonly createScopeHash?: (scope: LlmInvocationScope) => Promise<string>;
  readonly copyText?: (value: string) => Promise<void>;
  readonly now: () => Date;
}

export function LlmMultiBlockReviewOverlay({
  api,
  editorAccess,
  createId,
  createScopeHash = browserScopeHash,
  copyText = copyToClipboard,
  now
}: LlmMultiBlockReviewOverlayProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LlmRuntimeStatus>(EMPTY_STATUS);
  const [providers, setProviders] = useState<readonly LlmProviderSummary[]>([]);
  const [providerId, setProviderId] = useState("");
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providerError, setProviderError] = useState("");

  const [selection, setSelection] =
    useState<ActiveLlmEditorStructuredSelection | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [consentChecked, setConsentChecked] = useState(false);

  const [invocationBusy, setInvocationBusy] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<MultiBlockProposalState | null>(null);
  const [acceptedHunks, setAcceptedHunks] = useState<
    ReadonlyMap<number, ReadonlySet<string>>
  >(() => new Map());
  const [assessment, setAssessment] =
    useState<AssessmentState>(INITIAL_ASSESSMENT);
  const [requestError, setRequestError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [editorState, setEditorState] = useState<ActiveLlmEditorState>(() =>
    editorAccess.getState()
  );

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.config.id === providerId) ?? null,
    [providerId, providers]
  );

  const selectedBlocks = useMemo(() => {
    if (!proposal?.parsed) {
      return [] as readonly string[];
    }
    return proposal.reviews.map((review, index) =>
      renderLlmProposalReview(
        review,
        acceptedHunks.get(index) ?? new Set<string>()
      )
    );
  }, [acceptedHunks, proposal]);

  const selectedProposalText = useMemo(() => {
    if (!selection || selectedBlocks.length === 0) {
      return "";
    }
    return renderLlmMultiBlockProposal(selection.selection, selectedBlocks);
  }, [selectedBlocks, selection]);

  const resetProposal = useCallback(() => {
    setProposal(null);
    setAcceptedHunks(new Map());
    setAssessment(INITIAL_ASSESSMENT);
    setRequestError("");
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
      setSelection(await editorAccess.readCurrentStructuredSelection());
    } catch (error) {
      setSelection(null);
      setSelectionError(
        publicError(error, "현재 다중 문단 선택을 읽지 못했습니다.")
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
      if (event.key === "Escape" && !invocationBusy) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [invocationBusy, open]);

  useEffect(() => {
    let cancelled = false;
    if (!proposal?.parsed || !selection || selectedBlocks.length === 0) {
      setAssessment(INITIAL_ASSESSMENT);
      return () => {
        cancelled = true;
      };
    }
    setAssessment({
      ready: false,
      checking: true,
      message: "여러 Typie 블록의 원문·위치·revision을 다시 확인하는 중입니다."
    });
    void editorAccess
      .assessMultiBlockProposal({
        expectedGeneration: selection.generation,
        expectedRevision: selection.revision,
        selection: selection.selection,
        proposalBlocks: selectedBlocks
      })
      .then((result) => {
        if (!cancelled) {
          setAssessment({
            ready: result.status === "READY",
            checking: false,
            message: result.message
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssessment({
            ready: false,
            checking: false,
            message: publicError(
              error,
              "다중 블록 적용 계획을 검증하지 못했습니다."
            )
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    editorAccess,
    editorState.generation,
    editorState.isComposing,
    editorState.revision,
    proposal,
    selectedBlocks,
    selection
  ]);

  const requestProposal = async () => {
    if (!selection) {
      setRequestError("먼저 다중 문단 Typie 선택을 불러오세요.");
      return;
    }
    if (!selectedProvider) {
      setRequestError("먼저 AI 제공자를 선택하세요.");
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
      setRequestError("제공자와 선택 원문을 확인한 뒤 전송에 동의하세요.");
      return;
    }

    const scope: LlmInvocationScope = {
      kind: "SELECTION",
      sourceId: [
        "active-editor",
        selection.generation,
        selection.revision,
        "structured",
        selection.selection.start,
        selection.selection.end,
        selection.selection.segments.length
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
      const parsed = parseLlmMultiBlockProposal(
        selection.selection,
        result.text
      );
      if (parsed.status !== "READY") {
        setProposal({
          result,
          parsed: null,
          parseMessage: parsed.message,
          reviews: []
        });
        setAcceptedHunks(new Map());
      } else {
        const reviews = parsed.blocks.map((block, index) =>
          createLlmProposalReview(
            selection.selection.segments[index]!.text,
            block
          )
        );
        setProposal({
          result,
          parsed,
          parseMessage: parsed.message,
          reviews
        });
        setAcceptedHunks(
          new Map(
            reviews.map((review, index) => [
              index,
              allLlmProposalHunkIds(review)
            ])
          )
        );
      }
      setConsentChecked(false);
    } catch (error) {
      setRequestError(publicError(error, "AI 다중 문단 제안을 받지 못했습니다."));
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

  const toggleHunk = (
    blockIndex: number,
    hunkId: string,
    accepted: boolean
  ) => {
    setAcceptedHunks((current) => {
      const next = new Map(current);
      const blockHunks = new Set(next.get(blockIndex) ?? []);
      if (accepted) {
        blockHunks.add(hunkId);
      } else {
        blockHunks.delete(hunkId);
      }
      next.set(blockIndex, blockHunks);
      return next;
    });
    setActionMessage("");
  };

  const copySelectedProposal = async () => {
    const value = proposal?.parsed ? selectedProposalText : proposal?.result.text;
    if (!value) {
      return;
    }
    try {
      await copyText(value);
      setActionMessage("검토 중인 다중 문단 제안문을 복사했습니다.");
    } catch (error) {
      setActionMessage(publicError(error, "제안문을 복사하지 못했습니다."));
    }
  };

  return (
    <>
      <button
        type="button"
        className="madi-llm-multiblock-launcher"
        aria-label="AI 다중 문단 검토"
        onClick={() => setOpen(true)}
      >
        AI¶
      </button>
      {open ? (
        <div
          className="madi-llm-multiblock-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !invocationBusy) {
              setOpen(false);
            }
          }}
        >
          <section
            className="madi-llm-multiblock-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="madi-llm-multiblock-title"
          >
            <header>
              <div>
                <p>정확한 Typie 문단 구조 · 적용 전 기술검증</p>
                <h2 id="madi-llm-multiblock-title">AI 다중 문단 검토</h2>
              </div>
              <button
                type="button"
                aria-label="AI 다중 문단 검토 닫기"
                disabled={invocationBusy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="madi-llm-multiblock-body">
              <p className="madi-llm-multiblock-notice">
                이 단계는 여러 Typie 문단의 정확한 위치와 변경 조각을 검토합니다.
                프로젝트 안전 snapshot과 복원 경계가 연결되기 전에는 원고를
                변경하지 않습니다.
              </p>

              <section className="madi-llm-multiblock-card">
                <div className="madi-llm-multiblock-grid">
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
                      <dt>전송 대상</dt>
                      <dd>{providerHost(selectedProvider)}</dd>
                    </div>
                    <div>
                      <dt>보호 저장소</dt>
                      <dd>{status.credentialStorage}</dd>
                    </div>
                  </dl>
                </div>
                {providerError ? (
                  <p className="madi-llm-multiblock-error" role="alert">
                    {providerError}
                  </p>
                ) : null}
              </section>

              <section className="madi-llm-multiblock-card">
                <div className="madi-llm-multiblock-heading">
                  <div>
                    <h3>선택 원문</h3>
                    <p>
                      {selection
                        ? `${selection.selection.segments.length}개 text node · ${selection.selection.text.length.toLocaleString("ko-KR")}자`
                        : "줄바꿈으로 나뉜 2개 이상의 문단을 선택하세요."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={selectionLoading || invocationBusy}
                    onClick={() => void reloadSelection()}
                  >
                    {selectionLoading ? "읽는 중…" : "선택 다시 읽기"}
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={8}
                  aria-label="AI 다중 문단 선택 원문"
                  value={selection?.selection.text ?? ""}
                />
                {selectionError ? (
                  <p className="madi-llm-multiblock-error" role="alert">
                    {selectionError}
                  </p>
                ) : null}
              </section>

              <section className="madi-llm-multiblock-card">
                <h3>수정 지시와 전송 확인</h3>
                <textarea
                  rows={3}
                  aria-label="AI 다중 문단 수정 지시"
                  value={instruction}
                  disabled={invocationBusy}
                  onChange={(event) => {
                    setInstruction(event.target.value);
                    setConsentChecked(false);
                    resetProposal();
                  }}
                />
                <label className="madi-llm-multiblock-consent">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    disabled={!selection || invocationBusy}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                  />
                  <span>
                    {selectedProvider?.config.name ?? "선택한 제공자"}에 위 다중
                    문단 원문만 전송하는 데 동의합니다.
                  </span>
                </label>
                <div className="madi-llm-multiblock-actions">
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
                    {invocationBusy ? "제안 생성 중…" : "다중 문단 제안 요청"}
                  </button>
                  {invocationBusy ? (
                    <button type="button" onClick={() => void cancelRequest()}>
                      요청 취소
                    </button>
                  ) : null}
                </div>
                {requestError ? (
                  <p className="madi-llm-multiblock-error" role="alert">
                    {requestError}
                  </p>
                ) : null}
              </section>

              {proposal ? (
                <section className="madi-llm-multiblock-card">
                  <div className="madi-llm-multiblock-heading">
                    <div>
                      <h3>블록별 변경 검토</h3>
                      <p>
                        {proposal.parseMessage} · 응답 모델 {proposal.result.model}
                      </p>
                    </div>
                    <button type="button" onClick={() => void copySelectedProposal()}>
                      검토본 복사
                    </button>
                  </div>

                  {proposal.parsed && selection ? (
                    <>
                      <div className="madi-llm-multiblock-blocks">
                        {proposal.reviews.map((review, blockIndex) => (
                          <article
                            key={selection.selection.segments[blockIndex]!.nodeKey}
                            className="madi-llm-multiblock-block"
                          >
                            <header>
                              <strong>문단 {blockIndex + 1}</strong>
                              <span>{review.hunks.length}개 변경 조각</span>
                            </header>
                            {review.coarse ? (
                              <p className="madi-llm-multiblock-warning">
                                문단이 커서 전체를 하나의 변경 조각으로 표시했습니다.
                              </p>
                            ) : null}
                            {review.hunks.length === 0 ? (
                              <p>이 문단은 원문과 같습니다.</p>
                            ) : null}
                            {review.hunks.map((hunk, hunkIndex) => (
                              <label key={hunk.id} className="madi-llm-multiblock-hunk">
                                <input
                                  type="checkbox"
                                  aria-label={`문단 ${blockIndex + 1} 변경 조각 ${hunkIndex + 1} 반영`}
                                  checked={
                                    acceptedHunks.get(blockIndex)?.has(hunk.id) ??
                                    false
                                  }
                                  onChange={(event) =>
                                    toggleHunk(
                                      blockIndex,
                                      hunk.id,
                                      event.target.checked
                                    )
                                  }
                                />
                                <span>
                                  <del>{hunk.originalText || "∅"}</del>
                                  <ins>{hunk.proposalText || "∅"}</ins>
                                </span>
                              </label>
                            ))}
                          </article>
                        ))}
                      </div>

                      <label>
                        선택 변경 반영본
                        <textarea
                          readOnly
                          rows={10}
                          aria-label="AI 다중 문단 선택 변경 반영본"
                          value={selectedProposalText}
                        />
                      </label>
                      <p
                        className={`madi-llm-multiblock-status ${
                          assessment.ready ? "is-ready" : ""
                        }`}
                        role="status"
                      >
                        {assessment.checking
                          ? "적용 계획을 확인하는 중입니다…"
                          : assessment.message}
                      </p>
                      <div className="madi-llm-multiblock-actions">
                        <button
                          type="button"
                          disabled
                          title="AUTO_BEFORE_AI_APPLY 안전 snapshot과 복원 경계를 먼저 연결해야 합니다."
                        >
                          안전 snapshot 연결 후 적용
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="madi-llm-multiblock-warning">
                        문단 구조를 확정하지 못했으므로 provider 원문을 검토·복사만 할 수
                        있습니다.
                      </p>
                      <textarea
                        readOnly
                        rows={10}
                        aria-label="AI 다중 문단 원시 제안문"
                        value={proposal.result.text}
                      />
                    </>
                  )}
                  {actionMessage ? (
                    <p className="madi-llm-multiblock-status" role="status">
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
