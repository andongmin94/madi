import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";

export type StoryEntityKind =
  | "CHARACTER"
  | "LOCATION"
  | "ORGANIZATION"
  | "ITEM"
  | "EVENT"
  | "WORLD_RULE"
  | "FORESHADOWING"
  | "OTHER";

export type StoryEntityStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";
export type SceneEntityRole = "APPEARS" | "POV" | "MENTIONED" | "RELATED";

export interface StoryEntityAlias {
  readonly id: string;
  readonly entityId: string;
  readonly alias: string;
  readonly normalizedAlias: string;
  readonly createdAt: string;
}

export interface StoryTag {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly colorToken: string | null;
  readonly createdAt: string;
}

export interface StoryEntity {
  readonly id: string;
  readonly projectId: string;
  readonly kind: StoryEntityKind;
  readonly name: string;
  readonly summary: string | null;
  readonly documentId: string;
  readonly status: StoryEntityStatus;
  readonly colorToken: string | null;
  readonly iconKey: string | null;
  readonly attributesJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly aliases: readonly StoryEntityAlias[];
  readonly tags: readonly StoryTag[];
}

export interface StoryRelationType {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly inverseName: string | null;
  readonly directed: boolean;
  readonly colorToken: string | null;
  readonly isBuiltin: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoryEntityRelation {
  readonly id: string;
  readonly projectId: string;
  readonly sourceEntityId: string;
  readonly relationTypeId: string;
  readonly targetEntityId: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StorySceneLink {
  readonly sceneNodeId: string;
  readonly sceneTitle: string;
  readonly entityId: string;
  readonly role: SceneEntityRole;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface StoryMentionCandidate {
  readonly occurrenceId: string;
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly documentId: string;
  readonly matchedTerm: string;
  readonly start: number;
  readonly end: number;
  readonly contextBefore: string;
  readonly matchedText: string;
  readonly contextAfter: string;
  readonly alreadyLinked: boolean;
}

export interface StoryEntityDeleteImpact {
  readonly entityId: string;
  readonly entityName: string;
  readonly relationCount: number;
  readonly explicitSceneCount: number;
  readonly discoveredSceneCount: number;
  readonly aliasCount: number;
  readonly tagCount: number;
  readonly noteCharacterCount: number;
}

export interface StoryEntityPatch {
  readonly name?: string;
  readonly kind?: StoryEntityKind;
  readonly status?: StoryEntityStatus;
  readonly summary?: string | null;
  readonly colorToken?: string | null;
  readonly iconKey?: string | null;
}

export interface StoryRelationInput {
  readonly relationTypeId: string;
  readonly targetEntityId: string;
  readonly note?: string;
}

export interface StoryRelationTypeInput {
  readonly name: string;
  readonly inverseName?: string;
  readonly directed: boolean;
  readonly colorToken?: string;
}

export interface StoryEntityListFilter {
  readonly kind: StoryEntityKind | "ALL";
  readonly status: StoryEntityStatus | "ALL";
  readonly tagId: string | "ALL";
  readonly sort: "NAME" | "UPDATED";
}

export interface StoryBibleWorkspaceProps {
  readonly entities: readonly StoryEntity[];
  readonly tags: readonly StoryTag[];
  readonly relationTypes: readonly StoryRelationType[];
  readonly relations: readonly StoryEntityRelation[];
  readonly sceneLinks: readonly StorySceneLink[];
  readonly mentions: readonly StoryMentionCandidate[];
  readonly selectedEntityId: string | null;
  readonly noteEditor: ReactNode;
  readonly noteSaveLabel: string;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly onSearchEntities: (query: string) =>
    | readonly string[]
    | Promise<readonly string[]>;
  readonly onListEntities: (
    filter: StoryEntityListFilter
  ) => readonly string[] | Promise<readonly string[]>;
  readonly onCreate: (kind: StoryEntityKind, name: string) => void | Promise<void>;
  readonly onSelect: (entityId: string) => void | Promise<void>;
  readonly onUpdate: (
    entityId: string,
    patch: StoryEntityPatch
  ) => void | Promise<void>;
  readonly onRequestDelete: (
    entityId: string
  ) => StoryEntityDeleteImpact | Promise<StoryEntityDeleteImpact>;
  readonly onConfirmDelete: (entityId: string) => void | Promise<void>;
  readonly onAddAlias: (entityId: string, alias: string) => void | Promise<void>;
  readonly onDeleteAlias: (aliasId: string) => void | Promise<void>;
  readonly onCreateTag: (name: string) => StoryTag | Promise<StoryTag>;
  readonly onSetTags: (
    entityId: string,
    tagIds: readonly string[]
  ) => void | Promise<void>;
  readonly onCreateRelation: (
    sourceEntityId: string,
    input: StoryRelationInput
  ) => void | Promise<void>;
  readonly onUpdateRelation: (
    relationId: string,
    input: StoryRelationInput
  ) => void | Promise<void>;
  readonly onDeleteRelation: (relationId: string) => void | Promise<void>;
  readonly onCreateRelationType: (
    input: StoryRelationTypeInput
  ) => void | Promise<void>;
  readonly onUpdateRelationType: (
    relationTypeId: string,
    input: StoryRelationTypeInput
  ) => void | Promise<void>;
  readonly onDeleteRelationType: (
    relationTypeId: string
  ) => void | Promise<void>;
  readonly onOpenScene: (
    sceneId: string,
    range?: { readonly start: number; readonly end: number }
  ) => void | Promise<void>;
  readonly onPromoteMention: (
    candidate: StoryMentionCandidate,
    role: SceneEntityRole
  ) => void | Promise<void>;
}

const KIND_LABELS: Readonly<Record<StoryEntityKind, string>> = {
  CHARACTER: "등장인물",
  LOCATION: "장소",
  ORGANIZATION: "조직",
  ITEM: "물건",
  EVENT: "사건",
  WORLD_RULE: "설정",
  FORESHADOWING: "복선",
  OTHER: "기타"
};

const DEFAULT_NAMES: Readonly<Record<StoryEntityKind, string>> = {
  CHARACTER: "새 등장인물",
  LOCATION: "새 장소",
  ORGANIZATION: "새 조직",
  ITEM: "새 물건",
  EVENT: "새 사건",
  WORLD_RULE: "새 설정",
  FORESHADOWING: "새 복선",
  OTHER: "새 기타 설정"
};

const STATUS_LABELS: Readonly<Record<StoryEntityStatus, string>> = {
  ACTIVE: "활성",
  DRAFT: "초안",
  ARCHIVED: "보관됨"
};

const ROLE_LABELS: Readonly<Record<SceneEntityRole, string>> = {
  APPEARS: "등장",
  POV: "POV",
  MENTIONED: "언급",
  RELATED: "관련"
};

const KINDS = Object.keys(KIND_LABELS) as StoryEntityKind[];
const STATUSES = Object.keys(STATUS_LABELS) as StoryEntityStatus[];
const ROLES = Object.keys(ROLE_LABELS) as SceneEntityRole[];

function entityLabel(
  entities: readonly StoryEntity[],
  entityId: string
): string {
  return entities.find((entity) => entity.id === entityId)?.name ?? "삭제된 설정";
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function stopFormPropagation(event: FormEvent): void {
  event.stopPropagation();
}

export function StoryBibleWorkspace({
  entities,
  tags,
  relationTypes,
  relations,
  sceneLinks,
  mentions,
  selectedEntityId,
  noteEditor,
  noteSaveLabel,
  busy = false,
  errorMessage = null,
  onSearchEntities,
  onListEntities,
  onCreate,
  onSelect,
  onUpdate,
  onRequestDelete,
  onConfirmDelete,
  onAddAlias,
  onDeleteAlias,
  onCreateTag,
  onSetTags,
  onCreateRelation,
  onUpdateRelation,
  onDeleteRelation,
  onCreateRelationType,
  onUpdateRelationType,
  onDeleteRelationType,
  onOpenScene,
  onPromoteMention
}: StoryBibleWorkspaceProps) {
  const [kindFilter, setKindFilter] = useState<StoryEntityKind | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<StoryEntityStatus | "ALL">(
    "ALL"
  );
  const [tagFilter, setTagFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [remoteMatchedEntityIds, setRemoteMatchedEntityIds] = useState<
    ReadonlySet<string> | null
  >(null);
  const [remoteListedEntityIds, setRemoteListedEntityIds] = useState<
    ReadonlySet<string> | null
  >(null);
  const [entitySearchBusy, setEntitySearchBusy] = useState(false);
  const [sort, setSort] = useState<"NAME" | "UPDATED">("NAME");
  const [createKind, setCreateKind] = useState<StoryEntityKind>("CHARACTER");
  const [aliasDraft, setAliasDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [relationTypeId, setRelationTypeId] = useState("");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [relationTargetQuery, setRelationTargetQuery] = useState("");
  const [remoteRelationTargetIds, setRemoteRelationTargetIds] = useState<
    ReadonlySet<string> | null
  >(null);
  const [relationNote, setRelationNote] = useState("");
  const [editingRelationId, setEditingRelationId] = useState<string | null>(null);
  const [editingRelationTypeId, setEditingRelationTypeId] = useState<
    string | null
  >(null);
  const [relationTypeName, setRelationTypeName] = useState("");
  const [relationTypeInverseName, setRelationTypeInverseName] = useState("");
  const [relationTypeDirected, setRelationTypeDirected] = useState(true);
  const [relationTypeColor, setRelationTypeColor] = useState("");
  const [deleteImpact, setDeleteImpact] =
    useState<StoryEntityDeleteImpact | null>(null);
  const [localError, setLocalError] = useState("");

  const selected =
    entities.find((entity) => entity.id === selectedEntityId) ?? null;
  const [nameDraft, setNameDraft] = useState(selected?.name ?? "");
  const [summaryDraft, setSummaryDraft] = useState(selected?.summary ?? "");
  const [colorDraft, setColorDraft] = useState(selected?.colorToken ?? "");
  const [iconDraft, setIconDraft] = useState(selected?.iconKey ?? "");

  useEffect(() => {
    setNameDraft(selected?.name ?? "");
    setSummaryDraft(selected?.summary ?? "");
    setColorDraft(selected?.colorToken ?? "");
    setIconDraft(selected?.iconKey ?? "");
    setAliasDraft("");
    setRelationTargetId("");
    setRelationTargetQuery("");
    setRelationNote("");
    setEditingRelationId(null);
    setDeleteImpact(null);
  }, [selected?.id, selected?.updatedAt]);

  useEffect(() => {
    if (!relationTypeId && relationTypes[0]) {
      setRelationTypeId(relationTypes[0].id);
    }
  }, [relationTypeId, relationTypes]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setRemoteMatchedEntityIds(null);
      setEntitySearchBusy(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setEntitySearchBusy(true);
      void Promise.resolve(onSearchEntities(normalized))
        .then((entityIds) => {
          if (!cancelled) {
            setRemoteMatchedEntityIds(new Set(entityIds));
            setLocalError("");
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setRemoteMatchedEntityIds(new Set());
            setLocalError(
              error instanceof Error
                ? error.message
                : "설정 상세 검색에 실패했습니다."
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setEntitySearchBusy(false);
          }
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchEntities, query]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(
      onListEntities({
        kind: kindFilter,
        status: statusFilter,
        tagId: tagFilter,
        sort
      })
    )
      .then((entityIds) => {
        if (!cancelled) {
          setRemoteListedEntityIds(new Set(entityIds));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLocalError(
            error instanceof Error ? error.message : "설정 목록 필터에 실패했습니다."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kindFilter, onListEntities, sort, statusFilter, tagFilter]);

  useEffect(() => {
    const normalized = relationTargetQuery.trim();
    if (!normalized) {
      setRemoteRelationTargetIds(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve(onSearchEntities(normalized))
        .then((entityIds) => {
          if (!cancelled) {
            setRemoteRelationTargetIds(new Set(entityIds));
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setLocalError(
              error instanceof Error ? error.message : "관계 대상을 검색하지 못했습니다."
            );
          }
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchEntities, relationTargetQuery]);

  const duplicateName = useMemo(() => {
    if (!selected || !nameDraft.trim()) {
      return false;
    }
    const candidate = normalizedName(nameDraft);
    return entities.some(
      (entity) =>
        entity.id !== selected.id && normalizedName(entity.name) === candidate
    );
  }, [entities, nameDraft, selected]);

  const filteredEntities = useMemo(() => {
    const needle = normalizedName(query);
    return entities
      .filter(
        (entity) =>
          remoteListedEntityIds === null || remoteListedEntityIds.has(entity.id)
      )
      .filter((entity) => {
        if (!needle) {
          return true;
        }
        if (remoteMatchedEntityIds) {
          return remoteMatchedEntityIds.has(entity.id);
        }
        return [
          entity.name,
          entity.summary ?? "",
          ...entity.aliases.map((alias) => alias.alias),
          ...entity.tags.map((tag) => tag.name)
        ].some((value) => normalizedName(value).includes(needle));
      })
      .sort((left, right) =>
        sort === "NAME"
          ? left.name.localeCompare(right.name, "ko-KR")
          : right.updatedAt.localeCompare(left.updatedAt)
      );
  }, [
    entities,
    kindFilter,
    query,
    remoteMatchedEntityIds,
    remoteListedEntityIds,
    sort,
    statusFilter,
    tagFilter
  ]);

  const outgoing = selected
    ? relations.filter((relation) => relation.sourceEntityId === selected.id)
    : [];
  const incoming = selected
    ? relations.filter((relation) => relation.targetEntityId === selected.id)
    : [];
  const selectedLinks = selected
    ? sceneLinks.filter((link) => link.entityId === selected.id)
    : [];

  const safely = async (operation: () => void | Promise<void>) => {
    setLocalError("");
    try {
      await operation();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "설정 변경에 실패했습니다."
      );
    }
  };

  const persistDraft = (
    field: keyof Pick<
      StoryEntityPatch,
      "name" | "summary" | "colorToken" | "iconKey"
    >,
    rawValue: string
  ) => {
    if (!selected) {
      return;
    }
    const normalized = rawValue.trim();
    if (field === "name" && !normalized) {
      setLocalError("설정 이름은 비어 있을 수 없습니다.");
      setNameDraft(selected.name);
      return;
    }
    const current =
      field === "name"
        ? selected.name
        : field === "summary"
          ? selected.summary ?? ""
          : field === "colorToken"
            ? selected.colorToken ?? ""
            : selected.iconKey ?? "";
    if (normalized === current) {
      return;
    }
    void safely(() =>
      onUpdate(selected.id, {
        [field]: field === "name" ? normalized : normalized || null
      })
    );
  };

  const submitAlias = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !aliasDraft.trim()) {
      return;
    }
    void safely(async () => {
      await onAddAlias(selected.id, aliasDraft.trim());
      setAliasDraft("");
    });
  };

  const submitTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !tagDraft.trim()) {
      return;
    }
    void safely(async () => {
      const tag = await onCreateTag(tagDraft.trim());
      await onSetTags(selected.id, [
        ...new Set([...selected.tags.map((item) => item.id), tag.id])
      ]);
      setTagDraft("");
    });
  };

  const submitRelation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !relationTypeId || !relationTargetId) {
      return;
    }
    const input: StoryRelationInput = {
      relationTypeId,
      targetEntityId: relationTargetId,
      ...(relationNote.trim() ? { note: relationNote.trim() } : {})
    };
    void safely(async () => {
      if (editingRelationId) {
        await onUpdateRelation(editingRelationId, input);
      } else {
        await onCreateRelation(selected.id, input);
      }
      setEditingRelationId(null);
      setRelationTargetId("");
      setRelationTargetQuery("");
      setRelationNote("");
    });
  };

  const submitRelationType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!relationTypeName.trim()) {
      return;
    }
    const input: StoryRelationTypeInput = {
      name: relationTypeName.trim(),
      ...(relationTypeInverseName.trim()
        ? { inverseName: relationTypeInverseName.trim() }
        : {}),
      directed: relationTypeDirected,
      ...(relationTypeColor.trim() ? { colorToken: relationTypeColor.trim() } : {})
    };
    void safely(async () => {
      if (editingRelationTypeId) {
        await onUpdateRelationType(editingRelationTypeId, input);
      } else {
        await onCreateRelationType(input);
      }
      setEditingRelationTypeId(null);
      setRelationTypeName("");
      setRelationTypeInverseName("");
      setRelationTypeDirected(true);
      setRelationTypeColor("");
    });
  };

  const requestDelete = () => {
    if (!selected) {
      return;
    }
    void safely(async () => setDeleteImpact(await onRequestDelete(selected.id)));
  };

  return (
    <section className="story-bible" aria-label="설정 작업 공간">
      <aside className="story-bible__list" aria-label="설정 목록">
        <header>
          <div>
            <p className="eyebrow">STORY BIBLE</p>
            <h2>설정 목록</h2>
          </div>
          <span>{filteredEntities.length.toLocaleString("ko-KR")}개</span>
        </header>

        <div className="story-bible__kind-tabs" role="group" aria-label="설정 타입">
          <button
            type="button"
            aria-pressed={kindFilter === "ALL"}
            onClick={() => setKindFilter("ALL")}
          >
            전체
          </button>
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kindFilter === kind}
              onClick={() => setKindFilter(kind)}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>

        <div className="story-bible__filters">
          <label>
            <span className="sr-only">설정 검색</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름·별칭·요약·태그 검색"
              aria-label="설정 검색"
            />
            {entitySearchBusy && <small role="status">상세 노트까지 검색 중…</small>}
          </label>
          <label>
            <span className="sr-only">태그 필터</span>
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              aria-label="태그 필터"
            >
              <option value="ALL">모든 태그</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">상태 필터</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StoryEntityStatus | "ALL")
              }
              aria-label="상태 필터"
            >
              <option value="ALL">모든 상태</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">설정 정렬</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as "NAME" | "UPDATED")}
              aria-label="설정 정렬"
            >
              <option value="NAME">이름순</option>
              <option value="UPDATED">수정일순</option>
            </select>
          </label>
        </div>

        <form
          className="story-bible__create"
          onSubmit={(event) => {
            event.preventDefault();
            void safely(() => onCreate(createKind, DEFAULT_NAMES[createKind]));
          }}
        >
          <label>
            <span className="sr-only">새 설정 타입</span>
            <select
              aria-label="새 설정 타입"
              value={createKind}
              onChange={(event) => setCreateKind(event.target.value as StoryEntityKind)}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            새 엔트리 생성
          </button>
        </form>

        <ul className="story-bible__entities" aria-label="설정 엔트리">
          {filteredEntities.map((entity) => {
            const duplicate =
              entities.filter(
                (candidate) =>
                  normalizedName(candidate.name) === normalizedName(entity.name)
              ).length > 1;
            return (
              <li key={entity.id} data-entity-id={entity.id}>
                <button
                  type="button"
                  aria-current={entity.id === selectedEntityId ? "true" : undefined}
                  onClick={() => void safely(() => onSelect(entity.id))}
                >
                  <span aria-hidden="true">{entity.iconKey || "◇"}</span>
                  <span>
                    <strong>{entity.name}</strong>
                    <small>
                      {KIND_LABELS[entity.kind]} · {STATUS_LABELS[entity.status]}
                    </small>
                  </span>
                  {duplicate && <em title="같은 이름의 설정이 있습니다">중복</em>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="story-bible__detail" aria-label="설정 상세">
        {!selected ? (
          <div className="story-bible__empty">
            <strong>설정을 선택하세요</strong>
            <p>이름, 별칭, 태그와 Typie 상세 노트를 편집할 수 있습니다.</p>
          </div>
        ) : (
          <>
            <header>
              <div>
                <p className="eyebrow">{KIND_LABELS[selected.kind]}</p>
                <h2>{selected.name}</h2>
              </div>
              <button type="button" className="danger-button" onClick={requestDelete}>
                설정 삭제
              </button>
            </header>

            {(errorMessage || localError) && (
              <p className="error-message" role="alert">
                {localError || errorMessage}
              </p>
            )}

            <div className="story-bible__fields">
              <label>
                이름
                <input
                  value={nameDraft}
                  aria-label="설정 이름"
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => persistDraft("name", nameDraft)}
                />
                {duplicateName && (
                  <small className="duplicate-warning">같은 이름의 설정이 있습니다.</small>
                )}
              </label>
              <label>
                타입
                <select
                  aria-label="설정 타입 변경"
                  value={selected.kind}
                  onChange={(event) =>
                    void safely(() =>
                      onUpdate(selected.id, {
                        kind: event.target.value as StoryEntityKind
                      })
                    )
                  }
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상태
                <select
                  aria-label="설정 상태 변경"
                  value={selected.status}
                  onChange={(event) =>
                    void safely(() =>
                      onUpdate(selected.id, {
                        status: event.target.value as StoryEntityStatus
                      })
                    )
                  }
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="story-bible__summary-field">
                한 줄 요약
                <input
                  value={summaryDraft}
                  aria-label="설정 한 줄 요약"
                  onChange={(event) => setSummaryDraft(event.target.value)}
                  onBlur={() => persistDraft("summary", summaryDraft)}
                />
              </label>
              <label>
                색상 토큰
                <input
                  value={colorDraft}
                  aria-label="설정 색상 토큰"
                  placeholder="예: crimson-500"
                  onChange={(event) => setColorDraft(event.target.value)}
                  onBlur={() => persistDraft("colorToken", colorDraft)}
                />
              </label>
              <label>
                아이콘 키
                <input
                  value={iconDraft}
                  aria-label="설정 아이콘 키"
                  placeholder="예: person"
                  onChange={(event) => setIconDraft(event.target.value)}
                  onBlur={() => persistDraft("iconKey", iconDraft)}
                />
              </label>
            </div>

            <section className="story-bible__chips" aria-label="별칭">
              <div className="story-bible__section-heading">
                <h3>별칭</h3>
                <span>{selected.aliases.length}개</span>
              </div>
              <div className="chip-list">
                {selected.aliases.map((alias) => (
                  <span key={alias.id} className="story-chip">
                    {alias.alias}
                    <button
                      type="button"
                      aria-label={`${alias.alias} 별칭 삭제`}
                      onClick={() => void safely(() => onDeleteAlias(alias.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={submitAlias}>
                <label>
                  <span className="sr-only">새 별칭</span>
                  <input
                    value={aliasDraft}
                    aria-label="새 별칭"
                    placeholder="한국어·영어·숫자·공백 지원"
                    onChange={(event) => setAliasDraft(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={!aliasDraft.trim() || busy}>
                  별칭 추가
                </button>
              </form>
            </section>

            <section className="story-bible__chips" aria-label="태그">
              <div className="story-bible__section-heading">
                <h3>태그</h3>
                <span>{selected.tags.length}개</span>
              </div>
              <div className="tag-picker">
                {tags.map((tag) => {
                  const checked = selected.tags.some((item) => item.id === tag.id);
                  return (
                    <label key={tag.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          void safely(() =>
                            onSetTags(
                              selected.id,
                              checked
                                ? selected.tags
                                    .filter((item) => item.id !== tag.id)
                                    .map((item) => item.id)
                                : [...selected.tags.map((item) => item.id), tag.id]
                            )
                          )
                        }
                      />
                      <span>{tag.name}</span>
                    </label>
                  );
                })}
              </div>
              <form onSubmit={submitTag}>
                <label>
                  <span className="sr-only">새 태그</span>
                  <input
                    value={tagDraft}
                    aria-label="새 태그"
                    onChange={(event) => setTagDraft(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={!tagDraft.trim() || busy}>
                  태그 생성 및 연결
                </button>
              </form>
            </section>

            <section className="story-bible__note" aria-label="Typie 상세 노트">
              <div className="story-bible__section-heading">
                <h3>Typie 상세 노트</h3>
                <span>{noteSaveLabel}</span>
              </div>
              {noteEditor}
            </section>
          </>
        )}
      </section>

      <aside className="story-bible__connections" aria-label="관계와 등장 위치">
        <header>
          <p className="eyebrow">CONNECTIONS</p>
          <h2>관계 · 등장 위치</h2>
        </header>
        {!selected ? (
          <p>설정을 선택하면 관계와 장면 후보를 표시합니다.</p>
        ) : (
          <>
            <details className="relation-type-manager">
              <summary>관계 타입 관리</summary>
              <form onSubmit={submitRelationType}>
                <label>
                  관계 타입 이름
                  <input
                    aria-label="관계 타입 이름"
                    value={relationTypeName}
                    onChange={(event) => setRelationTypeName(event.target.value)}
                  />
                </label>
                <label>
                  역방향 이름
                  <input
                    aria-label="관계 타입 역방향 이름"
                    value={relationTypeInverseName}
                    onChange={(event) =>
                      setRelationTypeInverseName(event.target.value)
                    }
                  />
                </label>
                <label>
                  색상 토큰
                  <input
                    aria-label="관계 타입 색상 토큰"
                    value={relationTypeColor}
                    onChange={(event) => setRelationTypeColor(event.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={relationTypeDirected}
                    onChange={(event) => setRelationTypeDirected(event.target.checked)}
                  />
                  방향 관계
                </label>
                <div>
                  <button type="submit" disabled={!relationTypeName.trim() || busy}>
                    {editingRelationTypeId ? "관계 타입 변경 저장" : "관계 타입 생성"}
                  </button>
                  {editingRelationTypeId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRelationTypeId(null);
                        setRelationTypeName("");
                        setRelationTypeInverseName("");
                        setRelationTypeDirected(true);
                        setRelationTypeColor("");
                      }}
                    >
                      타입 수정 취소
                    </button>
                  )}
                </div>
              </form>
              <ul aria-label="관계 타입 목록">
                {relationTypes.map((type) => (
                  <li key={type.id} data-relation-type-id={type.id}>
                    <span>
                      <strong>{type.name}</strong>
                      <small>
                        {type.directed
                          ? `역방향: ${type.inverseName || type.name}`
                          : "양방향"}
                        {type.isBuiltin ? " · 기본 타입" : " · 사용자 타입"}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`${type.name} 관계 타입 수정`}
                      onClick={() => {
                        setEditingRelationTypeId(type.id);
                        setRelationTypeName(type.name);
                        setRelationTypeInverseName(type.inverseName ?? "");
                        setRelationTypeDirected(type.directed);
                        setRelationTypeColor(type.colorToken ?? "");
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      disabled={type.isBuiltin || busy}
                      title={type.isBuiltin ? "기본 관계 타입은 삭제할 수 없습니다." : undefined}
                      aria-label={`${type.name} 관계 타입 삭제`}
                      onClick={() => void safely(() => onDeleteRelationType(type.id))}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            </details>

            <form
              className="relation-editor"
              onSubmit={submitRelation}
              onClick={stopFormPropagation}
            >
              <h3>{editingRelationId ? "관계 수정" : "관계 추가"}</h3>
              <label>
                관계 타입
                <select
                  aria-label="관계 타입"
                  value={relationTypeId}
                  onChange={(event) => setRelationTypeId(event.target.value)}
                >
                  <option value="">관계 타입 선택</option>
                  {relationTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}{type.directed ? "" : " ↔"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                대상 설정 검색
                <input
                  type="search"
                  aria-label="관계 대상 검색어"
                  value={relationTargetQuery}
                  placeholder="이름 또는 별칭"
                  onChange={(event) => setRelationTargetQuery(event.target.value)}
                />
              </label>
              <label>
                대상 설정
                <select
                  aria-label="관계 대상 설정 검색"
                  value={relationTargetId}
                  onChange={(event) => setRelationTargetId(event.target.value)}
                >
                  <option value="">대상 선택</option>
                  {entities
                    .filter((entity) => entity.id !== selected.id)
                    .filter((entity) => {
                      const needle = normalizedName(relationTargetQuery);
                      return (
                        !needle ||
                        remoteRelationTargetIds?.has(entity.id) ||
                        [
                          entity.name,
                          ...entity.aliases.map((alias) => alias.alias)
                        ].some((value) => normalizedName(value).includes(needle))
                        );
                    })
                    .map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name} · {KIND_LABELS[entity.kind]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                관계 메모 (선택)
                <input
                  value={relationNote}
                  aria-label="관계 메모"
                  onChange={(event) => setRelationNote(event.target.value)}
                />
              </label>
              <div>
                <button
                  type="submit"
                  disabled={!relationTypeId || !relationTargetId || busy}
                >
                  {editingRelationId ? "관계 변경 저장" : "관계 추가"}
                </button>
                {editingRelationId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRelationId(null);
                      setRelationTargetId("");
                      setRelationTargetQuery("");
                      setRelationNote("");
                    }}
                  >
                    수정 취소
                  </button>
                )}
              </div>
            </form>

            <RelationList
              title="나가는 관계"
              direction="OUTGOING"
              relations={outgoing}
              entities={entities}
              relationTypes={relationTypes}
              selectedId={selected.id}
              onEdit={(relation) => {
                setEditingRelationId(relation.id);
                setRelationTypeId(relation.relationTypeId);
                setRelationTargetQuery("");
                setRelationTargetId(relation.targetEntityId);
                setRelationNote(relation.note ?? "");
              }}
              onDelete={(id) => void safely(() => onDeleteRelation(id))}
            />
            <RelationList
              title="들어오는 관계"
              direction="INCOMING"
              relations={incoming}
              entities={entities}
              relationTypes={relationTypes}
              selectedId={selected.id}
              onEdit={(relation) => {
                setEditingRelationId(relation.id);
                setRelationTypeId(relation.relationTypeId);
                setRelationTargetQuery("");
                setRelationTargetId(relation.targetEntityId);
                setRelationNote(relation.note ?? "");
              }}
              onDelete={(id) => void safely(() => onDeleteRelation(id))}
            />

            <section className="connection-section" aria-label="연결된 장면">
              <div className="story-bible__section-heading">
                <h3>연결된 장면</h3>
                <span>{selectedLinks.length}개</span>
              </div>
              {selectedLinks.length === 0 ? (
                <p>명시적으로 연결된 장면이 없습니다.</p>
              ) : (
                <ul>
                  {selectedLinks.map((link) => (
                    <li
                      key={`${link.sceneNodeId}:${link.entityId}:${link.role}`}
                      data-scene-link-id={`${link.sceneNodeId}:${link.entityId}:${link.role}`}
                    >
                      <button type="button" onClick={() => void onOpenScene(link.sceneNodeId)}>
                        <span className="role-badge">{ROLE_LABELS[link.role]}</span>
                        {link.sceneTitle}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="connection-section mention-candidates" aria-label="본문에서 찾은 후보">
              <div className="story-bible__section-heading">
                <h3>본문에서 찾은 후보</h3>
                <span>{mentions.length}개 장면</span>
              </div>
              <p className="candidate-caution">
                이름·별칭의 정확 부분 문자열 후보입니다. 한국어 경계 특성상 사실로
                단정하지 않으며 명시적 연결과 구분합니다.
              </p>
              <ul>
                {mentions.map((candidate) => (
                  <li key={candidate.occurrenceId} data-mention-id={candidate.occurrenceId}>
                    <button
                      type="button"
                      className="mention-context"
                      onClick={() =>
                        void onOpenScene(candidate.sceneId, {
                          start: candidate.start,
                          end: candidate.end
                        })
                      }
                    >
                      <strong>{candidate.sceneTitle}</strong>
                      <span>
                        …{candidate.contextBefore}
                        <mark>{candidate.matchedText}</mark>
                        {candidate.contextAfter}…
                      </span>
                      <small>발견 표현: {candidate.matchedTerm}</small>
                    </button>
                    {candidate.alreadyLinked ? (
                      <span className="candidate-linked">명시적 연결됨</span>
                    ) : (
                      <label>
                        <span className="sr-only">
                          {candidate.sceneTitle} 후보를 명시적 연결로 승격
                        </span>
                        <select
                          aria-label={`${candidate.sceneTitle} 승격 역할`}
                          defaultValue="MENTIONED"
                          onChange={(event) =>
                            void safely(() =>
                              onPromoteMention(
                                candidate,
                                event.target.value as SceneEntityRole
                              )
                            )
                          }
                        >
                          <option value="" disabled>
                            명시적 연결로 승격
                          </option>
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            void safely(() => onPromoteMention(candidate, "MENTIONED"))
                          }
                        >
                          언급으로 연결
                        </button>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>

      {deleteImpact && selected && (
        <div
          className="story-delete-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="story-delete-title"
          aria-describedby="story-delete-detail"
        >
          <div>
            <h2 id="story-delete-title">“{deleteImpact.entityName}” 설정을 삭제합니다.</h2>
            <ul id="story-delete-detail">
              <li>관계 {deleteImpact.relationCount}개</li>
              <li>장면 연결 {deleteImpact.explicitSceneCount}개</li>
              <li>본문 자동 발견 장면 {deleteImpact.discoveredSceneCount}개</li>
              <li>별칭 {deleteImpact.aliasCount}개</li>
              <li>태그 {deleteImpact.tagCount}개</li>
              <li>상세 노트 {deleteImpact.noteCharacterCount.toLocaleString("ko-KR")}자</li>
            </ul>
            <p>
              삭제하면 관계와 명시적 장면 연결도 함께 제거됩니다. 본문 원고의
              이름이나 문장은 변경하지 않습니다.
            </p>
            <div>
              <button
                type="button"
                className="danger-button"
                onClick={() =>
                  void safely(async () => {
                    await onConfirmDelete(selected.id);
                    setDeleteImpact(null);
                  })
                }
              >
                삭제
              </button>
              <button type="button" onClick={() => setDeleteImpact(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RelationList({
  title,
  direction,
  relations,
  entities,
  relationTypes,
  selectedId,
  onEdit,
  onDelete
}: {
  readonly title: string;
  readonly direction: "OUTGOING" | "INCOMING";
  readonly relations: readonly StoryEntityRelation[];
  readonly entities: readonly StoryEntity[];
  readonly relationTypes: readonly StoryRelationType[];
  readonly selectedId: string;
  readonly onEdit: (relation: StoryEntityRelation) => void;
  readonly onDelete: (relationId: string) => void;
}) {
  return (
    <section className="connection-section" aria-label={title}>
      <div className="story-bible__section-heading">
        <h3>{title}</h3>
        <span>{relations.length}개</span>
      </div>
      {relations.length === 0 ? (
        <p>관계가 없습니다.</p>
      ) : (
        <ul>
          {relations.map((relation) => {
            const type = relationTypes.find(
              (candidate) => candidate.id === relation.relationTypeId
            );
            const counterpartId =
              direction === "OUTGOING"
                ? relation.targetEntityId
                : relation.sourceEntityId;
            const label =
              direction === "INCOMING" && type?.directed
                ? type.inverseName || type.name
                : type?.name || "관계";
            const arrow = type?.directed
              ? direction === "OUTGOING"
                ? "→"
                : "←"
              : "↔";
            return (
              <li key={relation.id} data-relation-id={relation.id}>
                <div>
                  <strong>
                    {label} {arrow} {entityLabel(entities, counterpartId)}
                  </strong>
                  {!type?.directed && <small>양방향 관계</small>}
                  {relation.note && <p>{relation.note}</p>}
                </div>
                {relation.sourceEntityId === selectedId && (
                  <button
                    type="button"
                    aria-label={`${label} 관계 수정`}
                    onClick={() => onEdit(relation)}
                  >
                    수정
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`${label} 관계 삭제`}
                  onClick={() => onDelete(relation.id)}
                >
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export { DEFAULT_NAMES as STORY_ENTITY_DEFAULT_NAMES, KIND_LABELS as STORY_ENTITY_KIND_LABELS };
