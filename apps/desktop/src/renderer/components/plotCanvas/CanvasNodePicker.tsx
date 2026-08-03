import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CanvasEntityReference,
  CanvasPickerItem,
  CanvasReferenceCatalog,
  MadiCanvasNodeKind
} from "./types";

export interface CanvasNodePickerProps {
  readonly open: boolean;
  readonly catalog: CanvasReferenceCatalog;
  readonly preferredKind?: MadiCanvasNodeKind | null;
  readonly onSearchEntities?: (
    query: string
  ) => Promise<readonly CanvasEntityReference[]>;
  readonly existingTextNodes?: readonly {
    readonly id: string;
    readonly text: string;
  }[];
  readonly onFocusNode?: (nodeId: string) => void;
  readonly onPick: (item: CanvasPickerItem) => void;
  readonly onClose: () => void;
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

export function CanvasNodePicker({
  open,
  catalog,
  preferredKind = null,
  onSearchEntities,
  existingTextNodes = [],
  onFocusNode,
  onPick,
  onClose
}: CanvasNodePickerProps) {
  const [query, setQuery] = useState("");
  const [remoteEntities, setRemoteEntities] = useState<
    readonly CanvasEntityReference[]
  >([]);
  const [remoteStatus, setRemoteStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGenerationRef = useRef(0);
  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setRemoteEntities([]);
    setRemoteStatus("idle");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const normalized = normalizeQuery(query);
  useEffect(() => {
    searchGenerationRef.current += 1;
    const generation = searchGenerationRef.current;
    if (
      !open ||
      !onSearchEntities ||
      normalized.length === 0 ||
      (preferredKind !== null && preferredKind !== "ENTITY_REFERENCE")
    ) {
      setRemoteEntities([]);
      setRemoteStatus("idle");
      return;
    }
    setRemoteStatus("loading");
    const timer = window.setTimeout(() => {
      void onSearchEntities(query.trim()).then(
        (results) => {
          if (searchGenerationRef.current !== generation) {
            return;
          }
          setRemoteEntities(results);
          setRemoteStatus("ready");
        },
        () => {
          if (searchGenerationRef.current !== generation) {
            return;
          }
          setRemoteEntities([]);
          setRemoteStatus("error");
        }
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [normalized, onSearchEntities, open, preferredKind, query]);

  const entities = useMemo(() => {
    const local = catalog.entities
        .filter((entity) => {
          if (preferredKind && preferredKind !== "ENTITY_REFERENCE") {
            return false;
          }
          if (!normalized) {
            return true;
          }
          return [entity.name, ...entity.aliases, ...entity.tags]
            .join("\n")
            .toLocaleLowerCase("ko-KR")
            .includes(normalized);
        })
        .slice(0, 20);
    const merged = new Map<string, CanvasEntityReference>();
    for (const entity of [...local, ...remoteEntities]) {
      merged.set(entity.id, entity);
    }
    return [...merged.values()].slice(0, 30);
  }, [catalog.entities, normalized, preferredKind, remoteEntities]);
  const scenes = useMemo(
    () =>
      catalog.scenes
        .filter((scene) => {
          if (preferredKind && preferredKind !== "SCENE_REFERENCE") {
            return false;
          }
          if (!normalized) {
            return true;
          }
          return `${scene.episodeTitle}\n${scene.sceneTitle}`
            .toLocaleLowerCase("ko-KR")
            .includes(normalized);
        })
        .slice(0, 20),
    [catalog.scenes, normalized, preferredKind]
  );
  const existingNodes = useMemo(
    () =>
      !preferredKind && normalized
        ? existingTextNodes
            .filter((node) =>
              node.text.toLocaleLowerCase("ko-KR").includes(normalized)
            )
            .slice(0, 20)
        : [],
    [existingTextNodes, normalized, preferredKind]
  );

  const canCreateText =
    query.trim().length > 0 && (!preferredKind || preferredKind === "TEXT");
  const items = useMemo<
    readonly (
      | CanvasPickerItem
      | { readonly kind: "EXISTING_NODE"; readonly id: string; readonly text: string }
    )[]
  >(
    () => [
      ...(canCreateText
        ? ([{ kind: "TEXT" as const, text: query.trim() }] as const)
        : []),
      ...entities.map((entity) => ({ kind: "ENTITY_REFERENCE" as const, entity })),
      ...scenes.map((scene) => ({ kind: "SCENE_REFERENCE" as const, scene })),
      ...existingNodes.map((node) => ({ kind: "EXISTING_NODE" as const, ...node }))
    ],
    [canCreateText, entities, existingNodes, query, scenes]
  );
  useEffect(() => {
    setActiveIndex((current) =>
      items.length === 0 ? 0 : Math.max(0, Math.min(current, items.length - 1))
    );
  }, [items.length]);

  const pickAt = (index: number) => {
    const item = items[index];
    if (item) {
      if (item.kind === "EXISTING_NODE") {
        onFocusNode?.(item.id);
        onClose();
      } else {
        onPick(item);
      }
    }
  };
  if (!open) {
    return null;
  }
  return (
    <section
      className="plot-canvas-picker"
      role="dialog"
      aria-modal="true"
      aria-label="캔버스 노드 추가"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header>
        <strong>노드 추가</strong>
        <button type="button" onClick={onClose} aria-label="노드 추가 닫기">
          닫기
        </button>
      </header>
      <input
        ref={inputRef}
        type="search"
        aria-label="설정, 장면 또는 텍스트 검색"
        placeholder="설정·장면 검색 또는 메모 입력"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        aria-activedescendant={
          items.length > 0 ? `plot-canvas-picker-option-${activeIndex}` : undefined
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              items.length === 0 ? 0 : Math.min(current + 1, items.length - 1)
            );
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            pickAt(activeIndex);
          }
        }}
      />
      {remoteStatus === "loading" ? (
        <p className="plot-canvas-picker__status" role="status">
          설정 검색 중…
        </p>
      ) : remoteStatus === "error" ? (
        <p className="plot-canvas-picker__status" role="status">
          설정 검색을 완료하지 못했습니다. 현재 목록에서 계속 검색할 수 있습니다.
        </p>
      ) : null}
      <div className="plot-canvas-picker__results" role="listbox" aria-label="노드 후보">
        {canCreateText ? (
          <button
            id="plot-canvas-picker-option-0"
            type="button"
            role="option"
            aria-selected={activeIndex === 0}
            onMouseEnter={() => setActiveIndex(0)}
            onClick={() => onPick({ kind: "TEXT", text: query.trim() })}
          >
            <span>텍스트</span>
            <strong>{query.trim()}</strong>
          </button>
        ) : null}
        {entities.map((entity, index) => {
          const itemIndex = (canCreateText ? 1 : 0) + index;
          return (
          <button
            key={`entity-${entity.id}`}
            id={`plot-canvas-picker-option-${itemIndex}`}
            type="button"
            role="option"
            aria-selected={activeIndex === itemIndex}
            onMouseEnter={() => setActiveIndex(itemIndex)}
            onClick={() => onPick({ kind: "ENTITY_REFERENCE", entity })}
          >
            <span>설정 · {entity.kind}</span>
            <strong>{entity.name}</strong>
            <small>{entity.status}</small>
          </button>
          );
        })}
        {scenes.map((scene, index) => {
          const itemIndex = (canCreateText ? 1 : 0) + entities.length + index;
          return (
          <button
            key={`scene-${scene.id}`}
            id={`plot-canvas-picker-option-${itemIndex}`}
            type="button"
            role="option"
            aria-selected={activeIndex === itemIndex}
            onMouseEnter={() => setActiveIndex(itemIndex)}
            onClick={() => onPick({ kind: "SCENE_REFERENCE", scene })}
          >
            <span>장면 · {scene.episodeTitle}</span>
            <strong>{scene.sceneTitle}</strong>
            <small>{scene.characterCount.toLocaleString()}자</small>
          </button>
          );
        })}
        {existingNodes.map((node, index) => {
          const itemIndex =
            (canCreateText ? 1 : 0) + entities.length + scenes.length + index;
          return (
            <button
              key={`existing-${node.id}`}
              id={`plot-canvas-picker-option-${itemIndex}`}
              type="button"
              role="option"
              aria-selected={activeIndex === itemIndex}
              onMouseEnter={() => setActiveIndex(itemIndex)}
              onClick={() => {
                onFocusNode?.(node.id);
                onClose();
              }}
            >
              <span>캔버스 메모로 이동</span>
              <strong>{node.text}</strong>
            </button>
          );
        })}
        {!canCreateText &&
        entities.length === 0 &&
        scenes.length === 0 &&
        existingNodes.length === 0 ? (
          <p>일치하는 설정이나 장면이 없습니다.</p>
        ) : null}
      </div>
    </section>
  );
}
