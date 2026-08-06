import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent
} from "react";

import {
  serializeLlmScopeForConsent,
  type LlmInvocationResult,
  type LlmInvocationScope,
  type LlmTaskKind
} from "../../../shared/llm";
import type {
  LlmProviderDraft,
  LlmProviderSummary,
  LlmRuntimeStatus,
  MadiLlmApi
} from "../../../shared/llmIpc";
import type { LlmEditorAccess } from "../../llm/editorAccess";
import "./llmAssistant.css";

interface TaskTemplate {
  readonly kind: LlmTaskKind;
  readonly label: string;
  readonly systemInstruction: string;
  readonly userInstruction: string;
}

const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    kind: "REWRITE_SELECTION",
    label: "문체 다듬기",
    systemInstruction:
      "당신은 한국어 장편소설 편집 보조자입니다. 원문의 의미, 인물 말투와 서술 시점을 보존하고 제안문만 반환하세요.",
    userInstruction:
      "원문의 의미와 분위기를 유지하면서 어색한 표현과 문장 호흡을 자연스럽게 다듬어 주세요."
  },
  {
    kind: "CONTINUE_SCENE",
    label: "장면 이어쓰기",
    systemInstruction:
      "당신은 한국어 장편소설 집필 보조자입니다. 제공된 원고의 문체와 시점을 분석하되 결과를 확정 원고가 아닌 제안문으로 작성하세요.",
    userInstruction:
      "현재 원고의 문체, 시점과 분위기를 유지하며 자연스럽게 이어질 다음 장면을 제안해 주세요."
  },
  {
    kind: "SUMMARIZE_SCOPE",
    label: "내용 요약",
    systemInstruction:
      "당신은 소설 원고의 사실관계를 정리하는 보조자입니다. 원고에 없는 사실을 추가하지 마세요.",
    userInstruction:
      "등장인물, 사건, 장소와 미해결 단서를 중심으로 현재 원고를 간결하게 요약해 주세요."
  },
  {
    kind: "CHECK_CONSISTENCY",
    label: "일관성 검토",
    systemInstruction:
      "당신은 소설 설정 검토 보조자입니다. 확정적으로 단정하지 말고 원고에서 확인되는 근거와 검토 후보를 구분하세요.",
    userInstruction:
      "앞뒤가 맞지 않을 가능성이 있는 설정, 시점, 인물 행동과 시간 흐름을 검토 후보로 정리해 주세요."
  },
  {
    kind: "CUSTOM",
    label: "직접 지시",
    systemInstruction:
      "당신은 한국어 장편소설 작가를 돕는 보조자입니다. 제공된 범위 밖의 원고를 알고 있다고 가정하지 마세요.",
    userInstruction: "현재 원고에 대해 다음 작업을 수행해 주세요."
  }
];

const EMPTY_STATUS: LlmRuntimeStatus = {
  providerStore: "UNAVAILABLE",
  credentialStorage: "UNAVAILABLE"
};

function createDefaultProvider(id: string): LlmProviderDraft {
  return {
    id,
    name: "새 제공자",
    kind: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.example.com/v1",
    model: "",
    requiresApiKey: true,
    timeoutMs: 60_000,
    maxOutputTokens: 4_096,
    temperature: 0.3
  };
}

function providerDraft(summary: LlmProviderSummary): LlmProviderDraft {
  return {
    id: summary.config.id,
    name: summary.config.name,
    kind: summary.config.kind,
    baseUrl: summary.config.baseUrl,
    model: summary.config.model,
    requiresApiKey: summary.config.requiresApiKey,
    timeoutMs: summary.config.timeoutMs,
    maxOutputTokens: summary.config.maxOutputTokens,
    temperature: summary.config.temperature
  };
}

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

export interface LlmAssistantOverlayProps {
  readonly api: MadiLlmApi;
  readonly editorAccess: LlmEditorAccess;
  readonly createId: () => string;
  readonly createScopeHash?: (scope: LlmInvocationScope) => Promise<string>;
  readonly copyText?: (value: string) => Promise<void>;
  readonly now: () => Date;
}

export function LlmAssistantOverlay({
  api,
  editorAccess,
  createId,
  createScopeHash = browserScopeHash,
  copyText = copyToClipboard,
  now
}: LlmAssistantOverlayProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ASSIST" | "PROVIDERS">("ASSIST");
  const [status, setStatus] = useState<LlmRuntimeStatus>(EMPTY_STATUS);
  const [providers, setProviders] = useState<readonly LlmProviderSummary[]>([]);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<LlmProviderDraft>(() =>
    createDefaultProvider(createId())
  );
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState("");

  const [assistantProviderId, setAssistantProviderId] = useState("");
  const [task, setTask] = useState<LlmTaskKind>(TASK_TEMPLATES[0].kind);
  const [systemInstruction, setSystemInstruction] = useState(
    TASK_TEMPLATES[0].systemInstruction
  );
  const [userInstruction, setUserInstruction] = useState(
    TASK_TEMPLATES[0].userInstruction
  );
  const [scopeText, setScopeText] = useState("");
  const [contextText, setContextText] = useState("");
  const [scopeRevision, setScopeRevision] = useState<number | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [invocationBusy, setInvocationBusy] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState("");
  const [proposal, setProposal] = useState<{
    readonly original: string;
    readonly result: LlmInvocationResult;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.config.id === assistantProviderId) ??
      null,
    [assistantProviderId, providers]
  );
  const editingProvider = useMemo(
    () =>
      providers.find((provider) => provider.config.id === editingProviderId) ??
      null,
    [editingProviderId, providers]
  );

  const resetConsent = useCallback(() => {
    setConsentChecked(false);
    setProposal(null);
    setCopyStatus("");
  }, []);

  const selectProviderForEditing = useCallback((provider: LlmProviderSummary) => {
    setEditingProviderId(provider.config.id);
    setProviderForm(providerDraft(provider));
    setProviderApiKey("");
    setProviderError("");
  }, []);

  const createNewProvider = useCallback(() => {
    setEditingProviderId(null);
    setProviderForm(createDefaultProvider(createId()));
    setProviderApiKey("");
    setProviderError("");
  }, [createId]);

  const reloadRuntime = useCallback(async () => {
    setRuntimeBusy(true);
    setRuntimeError("");
    try {
      const nextStatus = await api.getStatus();
      setStatus(nextStatus);
      if (nextStatus.providerStore !== "AVAILABLE") {
        setProviders([]);
        setRuntimeError("선택형 AI 제공자 저장소를 사용할 수 없습니다.");
        return;
      }
      const nextProviders = await api.listProviders();
      setProviders(nextProviders);
      setAssistantProviderId((current) =>
        nextProviders.some((provider) => provider.config.id === current)
          ? current
          : (nextProviders[0]?.config.id ?? "")
      );
      if (nextProviders.length > 0) {
        const current = nextProviders.find(
          (provider) => provider.config.id === editingProviderId
        );
        selectProviderForEditing(current ?? nextProviders[0]!);
      } else {
        createNewProvider();
      }
    } catch (error) {
      setStatus(EMPTY_STATUS);
      setProviders([]);
      setRuntimeError(publicError(error, "AI 제공자 정보를 불러오지 못했습니다."));
    } finally {
      setRuntimeBusy(false);
    }
  }, [api, createNewProvider, editingProviderId, selectProviderForEditing]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void reloadRuntime();
  }, [open, reloadRuntime]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !invocationBusy && !providerBusy) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [invocationBusy, open, providerBusy]);

  const updateProviderText =
    (field: "name" | "baseUrl" | "model") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setProviderForm((current) => ({
        ...current,
        [field]: event.target.value
      }));
    };

  const saveProvider = async () => {
    setProviderBusy(true);
    setProviderError("");
    try {
      const saved = await api.saveProvider({
        provider: providerForm,
        expectedRevision: editingProvider?.config.revision ?? null,
        apiKey: providerApiKey.trim().length > 0 ? providerApiKey : null
      });
      const nextProviders = [
        ...providers.filter((provider) => provider.config.id !== saved.config.id),
        saved
      ].sort((left, right) =>
        left.config.name.localeCompare(right.config.name)
      );
      setProviders(nextProviders);
      setAssistantProviderId(saved.config.id);
      selectProviderForEditing(saved);
      setProviderApiKey("");
    } catch (error) {
      setProviderError(publicError(error, "AI 제공자를 저장하지 못했습니다."));
    } finally {
      setProviderBusy(false);
    }
  };

  const deleteProvider = async () => {
    if (!editingProvider) {
      return;
    }
    if (!window.confirm(`“${editingProvider.config.name}” 제공자를 삭제할까요?`)) {
      return;
    }
    setProviderBusy(true);
    setProviderError("");
    try {
      await api.deleteProvider({
        providerId: editingProvider.config.id,
        expectedRevision: editingProvider.config.revision
      });
      const nextProviders = providers.filter(
        (provider) => provider.config.id !== editingProvider.config.id
      );
      setProviders(nextProviders);
      setAssistantProviderId((current) =>
        current === editingProvider.config.id
          ? (nextProviders[0]?.config.id ?? "")
          : current
      );
      if (nextProviders.length > 0) {
        selectProviderForEditing(nextProviders[0]!);
      } else {
        createNewProvider();
      }
    } catch (error) {
      setProviderError(publicError(error, "AI 제공자를 삭제하지 못했습니다."));
    } finally {
      setProviderBusy(false);
    }
  };

  const selectTask = (value: LlmTaskKind) => {
    const template = TASK_TEMPLATES.find((item) => item.kind === value)!;
    setTask(value);
    setSystemInstruction(template.systemInstruction);
    setUserInstruction(template.userInstruction);
    resetConsent();
  };

  const loadCurrentDocument = async () => {
    setScopeBusy(true);
    setAssistantError("");
    try {
      const current = await editorAccess.readCurrentDocument();
      setScopeText(current.plainText);
      setScopeRevision(current.revision);
      resetConsent();
    } catch (error) {
      setAssistantError(publicError(error, "현재 편집 문서를 읽지 못했습니다."));
    } finally {
      setScopeBusy(false);
    }
  };

  const sendProposalRequest = async () => {
    if (!selectedProvider) {
      setAssistantError("먼저 AI 제공자를 선택하세요.");
      return;
    }
    if (
      selectedProvider.credentialState === "MISSING" ||
      selectedProvider.credentialState === "LOCKED"
    ) {
      setAssistantError("선택한 제공자의 API 키를 사용할 수 없습니다.");
      return;
    }
    if (scopeText.trim().length === 0) {
      setAssistantError("전송할 원고 범위를 불러오거나 입력하세요.");
      return;
    }
    if (!consentChecked) {
      setAssistantError("전송 대상과 제공자를 확인한 뒤 동의 항목을 선택하세요.");
      return;
    }

    const scope: LlmInvocationScope = {
      kind: "CUSTOM",
      sourceId:
        scopeRevision === null ? null : `active-editor-revision:${scopeRevision}`,
      manuscriptText: scopeText,
      contextText: contextText.trim().length > 0 ? contextText : null
    };
    const requestId = createId();
    setInvocationBusy(true);
    setActiveRequestId(requestId);
    setAssistantError("");
    setProposal(null);
    setCopyStatus("");
    try {
      const scopeSha256 = await createScopeHash(scope);
      const result = await api.invoke({
        invocation: {
          requestId,
          providerId: selectedProvider.config.id,
          expectedProviderRevision: selectedProvider.config.revision,
          task,
          systemInstruction,
          userInstruction,
          scope,
          consent: {
            confirmedAt: now().toISOString(),
            scopeSha256
          }
        }
      });
      setProposal({ original: scopeText, result });
      setConsentChecked(false);
    } catch (error) {
      setAssistantError(publicError(error, "AI 제안을 받지 못했습니다."));
    } finally {
      setInvocationBusy(false);
      setActiveRequestId(null);
    }
  };

  const cancelInvocation = async () => {
    if (!activeRequestId) {
      return;
    }
    try {
      await api.cancel({ requestId: activeRequestId });
    } catch (error) {
      setAssistantError(publicError(error, "AI 요청을 취소하지 못했습니다."));
    }
  };

  const copyProposal = async () => {
    if (!proposal) {
      return;
    }
    try {
      await copyText(proposal.result.text);
      setCopyStatus("제안문을 클립보드에 복사했습니다.");
    } catch (error) {
      setCopyStatus(publicError(error, "제안문을 복사하지 못했습니다."));
    }
  };

  return (
    <>
      <button
        type="button"
        className="madi-llm-launcher"
        aria-label="AI 보조 열기"
        onClick={() => setOpen(true)}
      >
        AI
      </button>
      {open ? (
        <div
          className="madi-llm-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !invocationBusy &&
              !providerBusy
            ) {
              setOpen(false);
            }
          }}
        >
          <section
            className="madi-llm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="madi-llm-title"
          >
            <header className="madi-llm-header">
              <div>
                <p className="madi-llm-eyebrow">선택형 · 사용자 소유 제공자</p>
                <h2 id="madi-llm-title">madi AI 보조</h2>
              </div>
              <button
                type="button"
                className="madi-llm-icon-button"
                aria-label="닫기"
                disabled={invocationBusy || providerBusy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <nav className="madi-llm-tabs" aria-label="AI 보조 메뉴">
              <button
                type="button"
                className={tab === "ASSIST" ? "is-active" : ""}
                onClick={() => setTab("ASSIST")}
              >
                도움받기
              </button>
              <button
                type="button"
                className={tab === "PROVIDERS" ? "is-active" : ""}
                onClick={() => setTab("PROVIDERS")}
              >
                제공자 설정
              </button>
            </nav>

            {runtimeError ? (
              <p className="madi-llm-alert is-error">{runtimeError}</p>
            ) : null}

            {tab === "ASSIST" ? (
              <div className="madi-llm-content">
                <section className="madi-llm-card">
                  <div className="madi-llm-card-heading">
                    <div>
                      <h3>1. 제공자와 작업</h3>
                      <p>원고는 아래 확인을 거친 뒤에만 선택한 제공자로 전송됩니다.</p>
                    </div>
                    <button
                      type="button"
                      className="madi-llm-secondary-button"
                      onClick={() => setTab("PROVIDERS")}
                    >
                      제공자 관리
                    </button>
                  </div>

                  <div className="madi-llm-form-grid">
                    <label>
                      제공자
                      <select
                        value={assistantProviderId}
                        disabled={runtimeBusy || providers.length === 0}
                        onChange={(event) => {
                          setAssistantProviderId(event.target.value);
                          resetConsent();
                        }}
                      >
                        {providers.length === 0 ? (
                          <option value="">등록된 제공자 없음</option>
                        ) : null}
                        {providers.map((provider) => (
                          <option
                            key={provider.config.id}
                            value={provider.config.id}
                          >
                            {provider.config.name} · {provider.config.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      작업
                      <select
                        value={task}
                        onChange={(event) =>
                          selectTask(event.target.value as LlmTaskKind)
                        }
                      >
                        {TASK_TEMPLATES.map((template) => (
                          <option key={template.kind} value={template.kind}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="madi-llm-field">
                    지시문
                    <textarea
                      rows={3}
                      value={userInstruction}
                      onChange={(event) => {
                        setUserInstruction(event.target.value);
                        resetConsent();
                      }}
                    />
                  </label>
                  <details className="madi-llm-advanced">
                    <summary>고급 지시문</summary>
                    <label className="madi-llm-field">
                      시스템 지시문
                      <textarea
                        rows={3}
                        value={systemInstruction}
                        onChange={(event) => {
                          setSystemInstruction(event.target.value);
                          resetConsent();
                        }}
                      />
                    </label>
                  </details>
                </section>

                <section className="madi-llm-card">
                  <div className="madi-llm-card-heading">
                    <div>
                      <h3>2. 전송할 범위</h3>
                      <p>현재 Typie 편집 문서를 복사해 온 뒤 필요한 부분만 남길 수 있습니다.</p>
                    </div>
                    <button
                      type="button"
                      className="madi-llm-secondary-button"
                      disabled={scopeBusy || invocationBusy}
                      onClick={() => void loadCurrentDocument()}
                    >
                      {scopeBusy ? "불러오는 중…" : "현재 편집 문서 불러오기"}
                    </button>
                  </div>
                  <label className="madi-llm-field">
                    원고 범위 · {scopeText.length.toLocaleString("ko-KR")}자
                    <textarea
                      rows={8}
                      value={scopeText}
                      disabled={invocationBusy}
                      onChange={(event) => {
                        setScopeText(event.target.value);
                        setScopeRevision(null);
                        resetConsent();
                      }}
                      placeholder="현재 편집 문서를 불러오거나 전송할 텍스트를 직접 입력하세요."
                    />
                  </label>
                  <label className="madi-llm-field">
                    선택적 참고 컨텍스트
                    <textarea
                      rows={3}
                      value={contextText}
                      disabled={invocationBusy}
                      onChange={(event) => {
                        setContextText(event.target.value);
                        resetConsent();
                      }}
                      placeholder="필요한 설정이나 제약만 명시적으로 추가하세요."
                    />
                  </label>
                </section>

                <section className="madi-llm-card">
                  <h3>3. 전송 확인</h3>
                  <dl className="madi-llm-summary">
                    <div>
                      <dt>제공자</dt>
                      <dd>{selectedProvider?.config.name ?? "선택되지 않음"}</dd>
                    </div>
                    <div>
                      <dt>모델</dt>
                      <dd>{selectedProvider?.config.model ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>전송 대상</dt>
                      <dd>{providerHost(selectedProvider)}</dd>
                    </div>
                    <div>
                      <dt>원고 분량</dt>
                      <dd>{scopeText.length.toLocaleString("ko-KR")}자</dd>
                    </div>
                  </dl>
                  <label className="madi-llm-consent">
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      disabled={invocationBusy}
                      onChange={(event) => setConsentChecked(event.target.checked)}
                    />
                    <span>
                      위 제공자와 원고 범위를 확인했습니다. 이 요청에서만 해당 내용을
                      전송하는 데 동의합니다.
                    </span>
                  </label>
                  <div className="madi-llm-actions">
                    <button
                      type="button"
                      className="madi-llm-primary-button"
                      disabled={
                        invocationBusy ||
                        !consentChecked ||
                        !selectedProvider ||
                        scopeText.trim().length === 0
                      }
                      onClick={() => void sendProposalRequest()}
                    >
                      {invocationBusy ? "제안 생성 중…" : "제안 요청"}
                    </button>
                    {invocationBusy ? (
                      <button
                        type="button"
                        className="madi-llm-danger-button"
                        onClick={() => void cancelInvocation()}
                      >
                        요청 취소
                      </button>
                    ) : null}
                  </div>
                  {assistantError ? (
                    <p className="madi-llm-alert is-error">{assistantError}</p>
                  ) : null}
                </section>

                {proposal ? (
                  <section className="madi-llm-card">
                    <div className="madi-llm-card-heading">
                      <div>
                        <h3>제안 검토</h3>
                        <p>
                          결과는 원고에 자동 적용되지 않습니다. 현재 단계에서는 복사 후
                          직접 검토해 반영하세요.
                        </p>
                      </div>
                      <span className="madi-llm-model-badge">
                        {proposal.result.model}
                      </span>
                    </div>
                    <div className="madi-llm-proposal-grid">
                      <label>
                        전송한 원문
                        <textarea readOnly rows={12} value={proposal.original} />
                      </label>
                      <label>
                        AI 제안문
                        <textarea readOnly rows={12} value={proposal.result.text} />
                      </label>
                    </div>
                    <div className="madi-llm-actions">
                      <button
                        type="button"
                        className="madi-llm-primary-button"
                        onClick={() => void copyProposal()}
                      >
                        제안문 복사
                      </button>
                      <button
                        type="button"
                        className="madi-llm-secondary-button"
                        disabled
                        title="Typie 의미구조를 보존하는 검토·부분 적용은 다음 구현 단계입니다."
                      >
                        원고에 적용 · 준비 중
                      </button>
                      <button
                        type="button"
                        className="madi-llm-secondary-button"
                        onClick={() => setProposal(null)}
                      >
                        제안 닫기
                      </button>
                    </div>
                    {copyStatus ? (
                      <p className="madi-llm-alert">{copyStatus}</p>
                    ) : null}
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="madi-llm-provider-layout">
                <aside className="madi-llm-provider-list">
                  <div className="madi-llm-card-heading">
                    <h3>제공자</h3>
                    <button
                      type="button"
                      className="madi-llm-secondary-button"
                      onClick={createNewProvider}
                    >
                      새 제공자
                    </button>
                  </div>
                  {runtimeBusy ? <p>불러오는 중…</p> : null}
                  {providers.map((provider) => (
                    <button
                      type="button"
                      key={provider.config.id}
                      className={`madi-llm-provider-item ${
                        editingProviderId === provider.config.id ? "is-active" : ""
                      }`}
                      onClick={() => selectProviderForEditing(provider)}
                    >
                      <strong>{provider.config.name}</strong>
                      <span>{provider.config.model}</span>
                      <small>{provider.credentialState}</small>
                    </button>
                  ))}
                  {providers.length === 0 && !runtimeBusy ? (
                    <p className="madi-llm-empty">등록된 제공자가 없습니다.</p>
                  ) : null}
                </aside>

                <section className="madi-llm-provider-form">
                  <div className="madi-llm-card-heading">
                    <div>
                      <h3>{editingProvider ? "제공자 수정" : "새 제공자"}</h3>
                      <p>
                        API 키는 .madi가 아닌 운영체제 보호 저장소에 암호화해 보관합니다.
                      </p>
                    </div>
                    {editingProvider ? (
                      <button
                        type="button"
                        className="madi-llm-danger-button"
                        disabled={providerBusy}
                        onClick={() => void deleteProvider()}
                      >
                        삭제
                      </button>
                    ) : null}
                  </div>

                  <div className="madi-llm-form-grid">
                    <label>
                      이름
                      <input
                        value={providerForm.name}
                        onChange={updateProviderText("name")}
                      />
                    </label>
                    <label>
                      모델
                      <input
                        value={providerForm.model}
                        onChange={updateProviderText("model")}
                        placeholder="제공자가 지원하는 모델 ID"
                      />
                    </label>
                  </div>
                  <label className="madi-llm-field">
                    OpenAI-compatible Base URL
                    <input
                      value={providerForm.baseUrl}
                      onChange={updateProviderText("baseUrl")}
                      placeholder="https://provider.example/v1"
                    />
                    <small>
                      원격은 HTTPS만 허용하며 HTTP는 localhost 계열만 허용합니다.
                    </small>
                  </label>
                  <label className="madi-llm-check-row">
                    <input
                      type="checkbox"
                      checked={providerForm.requiresApiKey}
                      onChange={(event) =>
                        setProviderForm((current) => ({
                          ...current,
                          requiresApiKey: event.target.checked
                        }))
                      }
                    />
                    API 키 필요
                  </label>
                  {providerForm.requiresApiKey ? (
                    <label className="madi-llm-field">
                      API 키
                      <input
                        type="password"
                        autoComplete="off"
                        value={providerApiKey}
                        onChange={(event) => setProviderApiKey(event.target.value)}
                        placeholder={
                          editingProvider?.credentialState === "AVAILABLE"
                            ? "비워두면 기존 키 유지"
                            : "API 키 입력"
                        }
                      />
                    </label>
                  ) : null}
                  <div className="madi-llm-form-grid is-three">
                    <label>
                      Timeout (ms)
                      <input
                        type="number"
                        min={1_000}
                        max={300_000}
                        value={providerForm.timeoutMs}
                        onChange={(event) =>
                          setProviderForm((current) => ({
                            ...current,
                            timeoutMs: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      최대 출력 토큰
                      <input
                        type="number"
                        min={1}
                        max={32_768}
                        value={providerForm.maxOutputTokens}
                        onChange={(event) =>
                          setProviderForm((current) => ({
                            ...current,
                            maxOutputTokens: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                    <label>
                      Temperature
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={providerForm.temperature}
                        onChange={(event) =>
                          setProviderForm((current) => ({
                            ...current,
                            temperature: Number(event.target.value)
                          }))
                        }
                      />
                    </label>
                  </div>

                  {status.credentialStorage === "UNAVAILABLE" ? (
                    <p className="madi-llm-alert is-warning">
                      운영체제 보호 저장소를 사용할 수 없습니다. API 키가 필요한 원격
                      제공자는 저장할 수 없지만 로컬 무키 제공자는 사용할 수 있습니다.
                    </p>
                  ) : null}
                  {providerError ? (
                    <p className="madi-llm-alert is-error">{providerError}</p>
                  ) : null}
                  <div className="madi-llm-actions">
                    <button
                      type="button"
                      className="madi-llm-primary-button"
                      disabled={
                        providerBusy ||
                        status.providerStore !== "AVAILABLE" ||
                        providerForm.name.trim().length === 0 ||
                        providerForm.model.trim().length === 0
                      }
                      onClick={() => void saveProvider()}
                    >
                      {providerBusy ? "저장 중…" : "제공자 저장"}
                    </button>
                    <button
                      type="button"
                      className="madi-llm-secondary-button"
                      disabled={providerBusy}
                      onClick={() => void reloadRuntime()}
                    >
                      다시 불러오기
                    </button>
                  </div>
                </section>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
