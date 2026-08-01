import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  SearchHit,
  SearchProjectResult,
  SearchTarget,
  TreeNodeKind
} from "../../shared/contracts";

export type SearchPanelScope = "CURRENT" | "ALL";

export interface SearchPanelSearchOptions {
  readonly caseSensitive: boolean;
  readonly target: SearchTarget;
  readonly scope: SearchPanelScope;
}

export interface SearchPanelApplyRequest {
  readonly query: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly scopeNodeId: string;
  readonly expectedRevision: number;
  readonly hits: readonly SearchHit[];
}

export interface SearchReplacePanelProps {
  readonly result: SearchProjectResult | null;
  readonly semanticReplaceAvailable: boolean;
  readonly currentScopeLabel?: string;
  readonly currentScopeId?: string | null;
  readonly currentScopeAvailable?: boolean;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly onSearch: (
    query: string,
    options: SearchPanelSearchOptions
  ) => void | Promise<void>;
  readonly onResultClick: (hit: SearchHit) => void | Promise<void>;
  readonly onApply: (
    request: SearchPanelApplyRequest
  ) => void | Promise<void>;
}

interface SearchSubmission {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly target: SearchTarget;
  readonly scope: SearchPanelScope;
  readonly scopeIdentity: string;
}

interface HitGroup {
  readonly key: string;
  readonly nodeId: string;
  readonly nodeKind: TreeNodeKind;
  readonly nodeTitle: string;
  readonly hits: readonly SearchHit[];
}

const NODE_KIND_LABELS: Readonly<Record<TreeNodeKind, string>> = {
  WORK: "작품",
  VOLUME: "권",
  CHAPTER: "화",
  SCENE: "장면"
};
const SEARCH_DEBOUNCE_MS = 320;

function searchKey(value: SearchSubmission): string {
  return [
    value.query,
    value.caseSensitive ? "case" : "nocase",
    value.target,
    value.scope,
    value.scopeIdentity
  ].join("\u0000");
}

function groupHits(hits: readonly SearchHit[]): readonly HitGroup[] {
  const groups = new Map<string, HitGroup>();

  for (const hit of hits) {
    const key = hit.nodeId;
    const current = groups.get(key);
    if (current) {
      groups.set(key, { ...current, hits: [...current.hits, hit] });
      continue;
    }
    groups.set(key, {
      key,
      nodeId: hit.nodeId,
      nodeKind: hit.nodeKind,
      nodeTitle: hit.nodeTitle,
      hits: [hit]
    });
  }

  return [...groups.values()];
}

function swallowCallbackFailure(result: void | Promise<void>): void {
  void Promise.resolve(result).catch(() => undefined);
}

export function SearchReplacePanel({
  result,
  semanticReplaceAvailable,
  currentScopeLabel = "현재 선택 범위",
  currentScopeId = null,
  currentScopeAvailable = true,
  busy = false,
  errorMessage = null,
  onSearch,
  onResultClick,
  onApply
}: SearchReplacePanelProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [target, setTarget] = useState<SearchTarget>("ALL");
  const [scope, setScope] = useState<SearchPanelScope>(
    currentScopeAvailable ? "CURRENT" : "ALL"
  );
  const [lastSubmission, setLastSubmission] =
    useState<SearchSubmission | null>(null);
  const [selectedOccurrenceIds, setSelectedOccurrenceIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const onSearchRef = useRef(onSearch);
  const busyRef = useRef(busy);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!currentScopeAvailable && scope === "CURRENT") {
      setScope("ALL");
    }
  }, [currentScopeAvailable, scope]);

  useEffect(() => {
    setSelectedOccurrenceIds(
      new Set(
        (result?.hits ?? [])
          .filter((hit) => hit.field === "BODY")
          .map((hit) => hit.occurrenceId)
      )
    );
  }, [result]);

  const bodyHits = useMemo(
    () => (result?.hits ?? []).filter((hit) => hit.field === "BODY"),
    [result]
  );
  const titleHitCount = (result?.hits.length ?? 0) - bodyHits.length;
  const selectedBodyHits = useMemo(
    () =>
      bodyHits.filter((hit) =>
        selectedOccurrenceIds.has(hit.occurrenceId)
      ),
    [bodyHits, selectedOccurrenceIds]
  );
  const selectedSceneCount = new Set(
    selectedBodyHits.map((hit) => hit.sceneId).filter(Boolean)
  ).size;
  const groups = useMemo(
    () => groupHits(result?.hits ?? []),
    [result]
  );
  const currentSubmission: SearchSubmission = {
    query,
    caseSensitive,
    target,
    scope,
    scopeIdentity:
      scope === "CURRENT" ? (currentScopeId ?? "__missing__") : "__all__"
  };
  const resultMatchesSubmission = Boolean(
    result &&
      lastSubmission &&
      result.query === lastSubmission.query &&
      result.caseSensitive === lastSubmission.caseSensitive &&
      result.target === lastSubmission.target &&
      searchKey(currentSubmission) === searchKey(lastSubmission)
  );
  const replacementHasNewline = /[\r\n]/u.test(replacement);
  const applyDisabled =
    busy ||
    !semanticReplaceAvailable ||
    replacementHasNewline ||
    selectedBodyHits.length === 0 ||
    !resultMatchesSubmission;

  useEffect(() => {
    if (!query) {
      return;
    }
    const submission: SearchSubmission = {
      query,
      caseSensitive,
      target,
      scope,
      scopeIdentity:
        scope === "CURRENT" ? (currentScopeId ?? "__missing__") : "__all__"
    };
    const runWhenReady = () => {
      if (busyRef.current) {
        debounceTimerRef.current = window.setTimeout(runWhenReady, 80);
        return;
      }
      debounceTimerRef.current = null;
      setLastSubmission(submission);
      swallowCallbackFailure(
        onSearchRef.current(submission.query, {
          caseSensitive: submission.caseSensitive,
          target: submission.target,
          scope: submission.scope
        })
      );
    };
    const timer = window.setTimeout(runWhenReady, SEARCH_DEBOUNCE_MS);
    debounceTimerRef.current = timer;
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = null;
    };
  }, [caseSensitive, currentScopeId, query, scope, target]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (query.length === 0 || busy) {
      return;
    }
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const submission = { ...currentSubmission };
    setLastSubmission(submission);
    swallowCallbackFailure(
      onSearch(query, {
        caseSensitive: submission.caseSensitive,
        target: submission.target,
        scope: submission.scope
      })
    );
  };

  const toggleOccurrence = (occurrenceId: string, selected: boolean) => {
    setSelectedOccurrenceIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(occurrenceId);
      } else {
        next.delete(occurrenceId);
      }
      return next;
    });
  };

  const selectAllBodies = () => {
    setSelectedOccurrenceIds(
      new Set(bodyHits.map((hit) => hit.occurrenceId))
    );
  };

  const applyReplacement = () => {
    if (!result || applyDisabled) {
      return;
    }
    swallowCallbackFailure(
      onApply({
        query: result.query,
        replacement,
        caseSensitive: result.caseSensitive,
        scopeNodeId: result.scopeNodeId,
        expectedRevision: result.revision,
        hits: selectedBodyHits
      })
    );
  };

  return (
    <aside
      className="side-panel search-replace-panel"
      aria-label="프로젝트 검색 및 선택 치환"
    >
      <div className="side-panel__heading">
        <div>
          <p className="eyebrow">PROJECT SEARCH</p>
          <h2>검색 · 선택 치환</h2>
        </div>
      </div>

      <form className="search-form" onSubmit={submitSearch}>
        <label>
          찾을 문자열
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="정확히 찾을 문자열"
          />
        </label>
        <label>
          검색 대상
          <select
            value={target}
            onChange={(event) =>
              setTarget(event.target.value as SearchTarget)
            }
          >
            <option value="ALL">제목과 본문</option>
            <option value="TITLES">제목</option>
            <option value="BODIES">본문</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          대소문자 구분
        </label>
        <fieldset>
          <legend>검색 범위</legend>
          <label>
            <input
              type="radio"
              name="search-scope"
              value="CURRENT"
              checked={scope === "CURRENT"}
              disabled={!currentScopeAvailable}
              onChange={() => setScope("CURRENT")}
            />
            {currentScopeLabel}
          </label>
          <label>
            <input
              type="radio"
              name="search-scope"
              value="ALL"
              checked={scope === "ALL"}
              onChange={() => setScope("ALL")}
            />
            작품 전체
          </label>
        </fieldset>
        <button type="submit" disabled={query.length === 0 || busy}>
          검색
        </button>
      </form>

      {errorMessage && <p role="alert">{errorMessage}</p>}

      <section className="search-results" aria-label="검색 결과">
        <div className="search-results__summary" aria-live="polite">
          {result ? (
            <p>
              전체 {result.totalMatches}개 · 본문 {bodyHits.length}개 · 제목{" "}
              {titleHitCount}개 · {result.sceneCount}개 장면
            </p>
          ) : (
            <p>검색어와 범위를 정한 뒤 검색하세요.</p>
          )}
        </div>
        {result?.hasMore && (
          <p role="status">
            정확한 전체 개수는 {result.totalMatches}개이며, 안전한 응답 한도에 따라
            현재 페이지 {result.hits.length}개만 표시합니다. 범위를 좁혀 나머지
            결과를 확인하세요.
          </p>
        )}

        {bodyHits.length > 0 && (
          <div className="search-selection-actions">
            <button type="button" onClick={selectAllBodies}>
              본문 결과 모두 선택
            </button>
            <button
              type="button"
              onClick={() => setSelectedOccurrenceIds(new Set())}
            >
              모두 해제
            </button>
          </div>
        )}

        {groups.map((group) => (
          <section
            className="search-result-group"
            key={group.key}
            data-node-id={group.nodeId}
          >
            <h3>
              {group.nodeTitle} · {NODE_KIND_LABELS[group.nodeKind]}
            </h3>
            <ul>
              {group.hits.map((hit) => {
                const selected = selectedOccurrenceIds.has(
                  hit.occurrenceId
                );
                const resultLabel = `${
                  hit.field === "BODY" ? "본문" : "제목"
                } 일치: ${hit.matchedText}`;
                return (
                  <li
                    key={hit.occurrenceId}
                    data-field={hit.field}
                    data-occurrence-id={hit.occurrenceId}
                  >
                    {hit.field === "BODY" && (
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${resultLabel} 선택`}
                          checked={selected}
                          onChange={(event) =>
                            toggleOccurrence(
                              hit.occurrenceId,
                              event.target.checked
                            )
                          }
                        />
                        <span className="sr-only">치환 대상</span>
                      </label>
                    )}
                    <button
                      type="button"
                      className="search-hit"
                      onClick={() =>
                        swallowCallbackFailure(onResultClick(hit))
                      }
                    >
                      <span className="search-hit__field">
                        {hit.field === "BODY" ? "본문" : "제목"}
                      </span>
                      <span className="search-hit__context">
                        {hit.contextBefore}
                        <mark>{hit.matchedText}</mark>
                        {hit.contextAfter}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>

      <section className="replace-preview" aria-label="선택 치환 미리보기">
        <h3>선택 치환 미리보기</h3>
        <label>
          바꿀 문자열
          <textarea
            value={replacement}
            rows={2}
            onChange={(event) => setReplacement(event.target.value)}
          />
        </label>
        <p aria-live="polite">
          {selectedSceneCount}개 장면의 {selectedBodyHits.length}개 본문 일치를
          치환합니다. 제목 결과는 치환 대상이 아닙니다.
        </p>
        {!semanticReplaceAvailable && (
          <p role="status">
            현재 편집기에서는 의미 구조를 보존하는 치환을 보장할 수 없어 적용을
            막았습니다.
          </p>
        )}
        {replacementHasNewline && (
          <p role="status">
            줄바꿈이 포함된 치환은 현재 의미 보존 경로에서 지원하지 않습니다.
          </p>
        )}
        {result && !resultMatchesSubmission && (
          <p role="status">검색 조건이 바뀌었습니다. 다시 검색해 주세요.</p>
        )}
        <button
          type="button"
          disabled={applyDisabled}
          onClick={applyReplacement}
        >
          선택 항목 치환 적용
        </button>
      </section>
    </aside>
  );
}
