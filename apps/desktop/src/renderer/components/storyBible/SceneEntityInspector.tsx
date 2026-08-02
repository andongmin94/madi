import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  SceneEntityRole,
  StoryEntity,
  StorySceneLink
} from "./StoryBibleWorkspace";

const ROLE_LABELS: Readonly<Record<SceneEntityRole, string>> = {
  APPEARS: "등장",
  POV: "POV",
  MENTIONED: "언급",
  RELATED: "관련"
};

const ROLES = Object.keys(ROLE_LABELS) as SceneEntityRole[];

export interface SceneEntityInspectorProps {
  readonly sceneId: string | null;
  readonly sceneTitle: string;
  readonly entities: readonly StoryEntity[];
  readonly links: readonly StorySceneLink[];
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly onCreateLink: (
    sceneId: string,
    entityId: string,
    role: SceneEntityRole
  ) => void | Promise<void>;
  readonly onDeleteLink: (link: StorySceneLink) => void | Promise<void>;
  readonly onOpenEntity: (entityId: string) => void | Promise<void>;
  readonly onSearchEntities: (
    query: string
  ) => readonly string[] | Promise<readonly string[]>;
}

export function SceneEntityInspector({
  sceneId,
  sceneTitle,
  entities,
  links,
  busy = false,
  errorMessage = null,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
  onSearchEntities
}: SceneEntityInspectorProps) {
  const [query, setQuery] = useState("");
  const [entityId, setEntityId] = useState("");
  const [role, setRole] = useState<SceneEntityRole>("RELATED");
  const [localError, setLocalError] = useState("");
  const [remoteMatches, setRemoteMatches] = useState<ReadonlySet<string> | null>(
    null
  );
  const sceneLinks = useMemo(
    () => links.filter((link) => link.sceneNodeId === sceneId),
    [links, sceneId]
  );
  const candidates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return entities.filter((entity) => {
      if (!normalized) {
        return true;
      }
      if (remoteMatches) {
        return remoteMatches.has(entity.id);
      }
      return [entity.name, ...entity.aliases.map((alias) => alias.alias)].some(
        (value) => value.toLocaleLowerCase("ko-KR").includes(normalized)
      );
    });
  }, [entities, query, remoteMatches]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setRemoteMatches(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve(onSearchEntities(normalized))
        .then((entityIds) => {
          if (!cancelled) {
            setRemoteMatches(new Set(entityIds));
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setLocalError(
              error instanceof Error ? error.message : "설정 검색에 실패했습니다."
            );
          }
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchEntities, query]);

  const safely = async (operation: () => void | Promise<void>) => {
    setLocalError("");
    try {
      await operation();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "장면 설정 연결에 실패했습니다."
      );
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sceneId || !entityId) {
      return;
    }
    void safely(async () => {
      await onCreateLink(sceneId, entityId, role);
      setEntityId("");
      setQuery("");
    });
  };

  return (
    <aside className="side-panel scene-entity-inspector" aria-label="이 장면의 설정">
      <div className="side-panel__heading">
        <div>
          <p className="eyebrow">EXPLICIT LINKS</p>
          <h2>이 장면의 설정</h2>
        </div>
        <span>{sceneLinks.length}개</span>
      </div>
      {!sceneId ? (
        <p>Binder에서 SCENE을 선택하면 명시적 설정 연결을 편집할 수 있습니다.</p>
      ) : (
        <>
          <p className="scene-entity-inspector__scene">{sceneTitle}</p>
          <form onSubmit={submit}>
            <label>
              설정 검색
              <input
                type="search"
                value={query}
                aria-label="장면 연결 설정 검색"
                placeholder="이름 또는 별칭"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              설정
              <select
                aria-label="장면에 연결할 설정"
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
              >
                <option value="">설정 선택</option>
                {candidates.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              역할
              <select
                aria-label="장면 설정 역할"
                value={role}
                onChange={(event) => setRole(event.target.value as SceneEntityRole)}
              >
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!entityId || busy}>
              설정 연결
            </button>
          </form>

          {(localError || errorMessage) && (
            <p className="error-message" role="alert">
              {localError || errorMessage}
            </p>
          )}

          <ul className="scene-entity-links" aria-label="현재 장면 설정 연결">
            {sceneLinks.map((link) => {
              const entity = entities.find((item) => item.id === link.entityId);
              return (
                <li
                  key={`${link.sceneNodeId}:${link.entityId}:${link.role}`}
                  data-scene-link-id={`${link.sceneNodeId}:${link.entityId}:${link.role}`}
                >
                  <button
                    type="button"
                    aria-label={`${entity?.name ?? "삭제된 설정"} 설정 상세 열기`}
                    onClick={() => void safely(() => onOpenEntity(link.entityId))}
                  >
                    <span className="role-badge">{ROLE_LABELS[link.role]}</span>
                    <strong>{entity?.name ?? "삭제된 설정"}</strong>
                  </button>
                  <button
                    type="button"
                    aria-label={`${entity?.name ?? "삭제된 설정"} ${ROLE_LABELS[link.role]} 연결 해제`}
                    onClick={() => void safely(() => onDeleteLink(link))}
                  >
                    연결 해제
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
