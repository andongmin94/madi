import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  LlmProviderSummary,
  LlmProviderTestResult,
  LlmRuntimeStatus,
  MadiLlmApi
} from "../../../shared/llmIpc";
import "./llmProviderDiagnostics.css";

const EMPTY_STATUS: LlmRuntimeStatus = {
  providerStore: "UNAVAILABLE",
  credentialStorage: "UNAVAILABLE"
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

export interface LlmProviderDiagnosticsProps {
  readonly api: MadiLlmApi;
  readonly createId: () => string;
}

export function LlmProviderDiagnostics({
  api,
  createId
}: LlmProviderDiagnosticsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LlmRuntimeStatus>(EMPTY_STATUS);
  const [providers, setProviders] = useState<readonly LlmProviderSummary[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LlmProviderTestResult | null>(null);

  const selectedProvider = useMemo(
    () =>
      providers.find(
        (provider) => provider.config.id === selectedProviderId
      ) ?? null,
    [providers, selectedProviderId]
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const nextStatus = await api.getStatus();
      setStatus(nextStatus);
      if (nextStatus.providerStore !== "AVAILABLE") {
        setProviders([]);
        setSelectedProviderId("");
        setError("AI 제공자 저장소를 사용할 수 없습니다.");
        return;
      }
      const nextProviders = await api.listProviders();
      setProviders(nextProviders);
      setSelectedProviderId((current) =>
        nextProviders.some((provider) => provider.config.id === current)
          ? current
          : (nextProviders[0]?.config.id ?? "")
      );
    } catch (nextError) {
      setStatus(EMPTY_STATUS);
      setProviders([]);
      setSelectedProviderId("");
      setError(publicError(nextError, "AI 제공자 목록을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (open) {
      void reload();
    }
  }, [open, reload]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !testing) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, testing]);

  const runTest = async () => {
    if (!selectedProvider) {
      setError("연결을 점검할 제공자를 선택하세요.");
      return;
    }
    if (
      selectedProvider.credentialState === "MISSING" ||
      selectedProvider.credentialState === "LOCKED"
    ) {
      setError("선택한 제공자의 API 키를 사용할 수 없습니다.");
      return;
    }
    const requestId = createId();
    setTesting(true);
    setActiveRequestId(requestId);
    setError("");
    setResult(null);
    try {
      const nextResult = await api.testProvider({
        requestId,
        providerId: selectedProvider.config.id,
        expectedRevision: selectedProvider.config.revision
      });
      setResult(nextResult);
    } catch (nextError) {
      setError(publicError(nextError, "AI 제공자 연결 점검에 실패했습니다."));
    } finally {
      setTesting(false);
      setActiveRequestId(null);
    }
  };

  const cancelTest = async () => {
    if (!activeRequestId) {
      return;
    }
    try {
      await api.cancel({ requestId: activeRequestId });
    } catch (nextError) {
      setError(publicError(nextError, "연결 점검을 취소하지 못했습니다."));
    }
  };

  return (
    <>
      <button
        type="button"
        className="madi-llm-diagnostics-launcher"
        aria-label="AI 제공자 연결 점검"
        onClick={() => setOpen(true)}
      >
        AI✓
      </button>
      {open ? (
        <div
          className="madi-llm-diagnostics-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !testing) {
              setOpen(false);
            }
          }}
        >
          <section
            className="madi-llm-diagnostics-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="madi-llm-diagnostics-title"
          >
            <header>
              <div>
                <p>선택형 AI</p>
                <h2 id="madi-llm-diagnostics-title">제공자 연결 점검</h2>
              </div>
              <button
                type="button"
                aria-label="연결 점검 닫기"
                disabled={testing}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="madi-llm-diagnostics-body">
              <p className="madi-llm-diagnostics-notice">
                원고는 전송하지 않습니다. 설정된 endpoint와 credential로 고정된
                <code>MADI_OK</code> 응답만 요청합니다.
              </p>

              <label>
                저장된 제공자
                <select
                  value={selectedProviderId}
                  disabled={loading || testing || providers.length === 0}
                  onChange={(event) => {
                    setSelectedProviderId(event.target.value);
                    setResult(null);
                    setError("");
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
                  <dt>모델</dt>
                  <dd>{selectedProvider?.config.model ?? "—"}</dd>
                </div>
                <div>
                  <dt>자격정보</dt>
                  <dd>{selectedProvider?.credentialState ?? "—"}</dd>
                </div>
                <div>
                  <dt>보호 저장소</dt>
                  <dd>{status.credentialStorage}</dd>
                </div>
              </dl>

              {result ? (
                <div
                  className={`madi-llm-diagnostics-result ${
                    result.status === "CONNECTED" ? "is-success" : "is-warning"
                  }`}
                  role="status"
                >
                  <strong>
                    {result.status === "CONNECTED"
                      ? "연결 확인 완료"
                      : "연결됐지만 고정 응답이 달랐습니다"}
                  </strong>
                  <span>
                    {result.latencyMs.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2
                    })}
                    ms · 응답 모델 {result.responseModel}
                  </span>
                </div>
              ) : null}

              {error ? (
                <p className="madi-llm-diagnostics-error" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="madi-llm-diagnostics-actions">
                <button
                  type="button"
                  className="is-primary"
                  disabled={
                    loading ||
                    testing ||
                    !selectedProvider ||
                    selectedProvider.credentialState === "MISSING" ||
                    selectedProvider.credentialState === "LOCKED"
                  }
                  onClick={() => void runTest()}
                >
                  {testing ? "점검 중…" : "연결 점검"}
                </button>
                {testing ? (
                  <button type="button" onClick={() => void cancelTest()}>
                    취소
                  </button>
                ) : null}
                <button type="button" disabled={testing} onClick={() => void reload()}>
                  다시 불러오기
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
