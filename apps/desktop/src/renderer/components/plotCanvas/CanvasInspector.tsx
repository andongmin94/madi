import {
  convertReferenceToText,
  relinkEntityReference,
  relinkSceneReference,
  reorderCanvasNode,
  resolveCanvasNodeDisplay,
  updateCanvasEdge,
  updateCanvasNode
} from "./canvasDocument";
import {
  MAX_JSON_CANVAS_DIMENSION,
  normalizeCanvasDimension
} from "./canvasGeometry";
import type {
  CanvasReferenceCatalog,
  MadiCanvasDocument,
  MadiCanvasNode,
  MadiCanvasSelection
} from "./types";

export interface CanvasInspectorProps {
  readonly document: MadiCanvasDocument;
  readonly catalog: CanvasReferenceCatalog;
  readonly selection: MadiCanvasSelection | null;
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
  readonly onDocumentChange: (document: MadiCanvasDocument) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onOpenEntity?: (entityId: string) => void;
  readonly onOpenScene?: (sceneNodeId: string) => void;
}

function numericValue(value: string, fallback: number): number {
  return normalizeCanvasDimension(Number(value), fallback);
}

function withParent(node: MadiCanvasNode, parentGroupId: string): MadiCanvasNode {
  const madi = node.madi ?? {
    nodeKind: node.type === "group" ? ("GROUP" as const) : ("TEXT" as const)
  };
  if (!parentGroupId) {
    const { parentGroupId: _removed, ...rest } = madi;
    return { ...node, madi: rest } as MadiCanvasNode;
  }
  return { ...node, madi: { ...madi, parentGroupId } } as MadiCanvasNode;
}

export function CanvasInspector({
  document,
  catalog,
  selection,
  width,
  onWidthChange,
  onDocumentChange,
  onDuplicate,
  onDelete,
  onOpenEntity,
  onOpenScene
}: CanvasInspectorProps) {
  const entities = new Map(catalog.entities.map((entity) => [entity.id, entity]));
  const scenes = new Map(catalog.scenes.map((scene) => [scene.id, scene]));
  const node =
    selection?.kind === "NODE"
      ? document.nodes.find((candidate) => candidate.id === selection.id)
      : undefined;
  const edge =
    selection?.kind === "EDGE"
      ? document.edges.find((candidate) => candidate.id === selection.id)
      : undefined;

  return (
    <aside
      id="plot-canvas-inspector"
      className="plot-canvas-inspector"
      style={{ width }}
      aria-label="선택 항목 상세"
      tabIndex={-1}
      data-testid="plot-canvas-inspector"
    >
      <h2>선택 항목 상세</h2>
      <label className="plot-canvas-inspector__width">
        상세 패널 너비
        <input
          type="range"
          min="260"
          max="520"
          step="10"
          value={width}
          onChange={(event) => onWidthChange(Number(event.currentTarget.value))}
        />
      </label>
      {!node && !edge ? (
        <p>노드나 연결선을 선택하면 여기에서 내용을 수정할 수 있습니다.</p>
      ) : null}
      {node ? (() => {
        const display = resolveCanvasNodeDisplay(node, entities, scenes);
        const groupOptions = document.nodes.filter(
          (candidate) => candidate.type === "group" && candidate.id !== node.id
        );
        return (
          <div className="plot-canvas-inspector__form">
            <p className="plot-canvas-inspector__type">
              {display.kind === "TEXT"
                ? "텍스트"
                : display.kind === "ENTITY_REFERENCE"
                  ? "설정 참조"
                  : display.kind === "SCENE_REFERENCE"
                    ? "장면 참조"
                    : "그룹"}
            </p>
            {node.type === "text" && display.kind === "TEXT" ? (
              <label>
                텍스트
                <textarea
                  maxLength={1_000_000}
                  value={node.text}
                  onChange={(event) =>
                    onDocumentChange(
                      updateCanvasNode(document, node.id, (current) =>
                        current.type === "text"
                          ? { ...current, text: event.currentTarget.value }
                          : current
                      )
                    )
                  }
                />
              </label>
            ) : null}
            {node.type === "group" ? (
              <label>
                그룹 제목
                <input
                  maxLength={20_000}
                  value={node.label ?? ""}
                  onChange={(event) =>
                    onDocumentChange(
                      updateCanvasNode(document, node.id, (current) =>
                        current.type === "group"
                          ? { ...current, label: event.currentTarget.value }
                          : current
                      )
                    )
                  }
                />
              </label>
            ) : null}
            <label>
              색상
              <input
                aria-label="선택 항목 색상"
                placeholder="#64748b 또는 1~6"
                maxLength={64}
                value={node.color ?? ""}
                onChange={(event) =>
                  onDocumentChange(
                    updateCanvasNode(document, node.id, (current) => ({
                      ...current,
                      ...(event.currentTarget.value
                        ? { color: event.currentTarget.value }
                        : { color: undefined })
                    }))
                  )
                }
              />
            </label>
            <div className="plot-canvas-inspector__dimensions">
              <label>
                너비
                <input
                  type="number"
                  min="1"
                  max={MAX_JSON_CANVAS_DIMENSION}
                  step="1"
                  value={Math.round(node.width)}
                  onChange={(event) =>
                    onDocumentChange(
                      updateCanvasNode(document, node.id, (current) => ({
                        ...current,
                        width: numericValue(event.currentTarget.value, current.width)
                      }))
                    )
                  }
                />
              </label>
              <label>
                높이
                <input
                  type="number"
                  min="1"
                  max={MAX_JSON_CANVAS_DIMENSION}
                  step="1"
                  value={Math.round(node.height)}
                  onChange={(event) =>
                    onDocumentChange(
                      updateCanvasNode(document, node.id, (current) => ({
                        ...current,
                        height: numericValue(event.currentTarget.value, current.height)
                      }))
                    )
                  }
                />
              </label>
            </div>
            {node.type !== "group" ? (
              <label>
                그룹
                <select
                  aria-label="상위 그룹"
                  value={node.madi?.parentGroupId ?? ""}
                  onChange={(event) =>
                    onDocumentChange(
                      updateCanvasNode(document, node.id, (current) =>
                        withParent(current, event.currentTarget.value)
                      )
                    )
                  }
                >
                  <option value="">그룹 없음</option>
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.type === "group" ? group.label || "제목 없는 그룹" : group.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {display.kind === "ENTITY_REFERENCE" ? (
              <>
                <p>{display.broken ? display.subtitle : display.description}</p>
                <label>
                  설정 다시 연결
                  <select
                    aria-label="다시 연결할 설정"
                    value={display.broken ? "" : display.referenceId ?? ""}
                    onChange={(event) => {
                      const entity = entities.get(event.currentTarget.value);
                      if (entity) {
                        onDocumentChange(relinkEntityReference(document, node.id, entity));
                      }
                    }}
                  >
                    <option value="">설정 선택</option>
                    {catalog.entities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name} · {entity.kind}
                      </option>
                    ))}
                  </select>
                </label>
                {!display.broken && display.referenceId ? (
                  <button
                    type="button"
                    onClick={() => onOpenEntity?.(display.referenceId!)}
                  >
                    설정 상세에서 열기
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    onDocumentChange(convertReferenceToText(document, node.id))
                  }
                >
                  일반 텍스트로 변환
                </button>
              </>
            ) : null}
            {display.kind === "SCENE_REFERENCE" ? (
              <>
                <p>{display.broken ? display.subtitle : display.description}</p>
                <label>
                  장면 다시 연결
                  <select
                    aria-label="다시 연결할 장면"
                    value={display.broken ? "" : display.referenceId ?? ""}
                    onChange={(event) => {
                      const scene = scenes.get(event.currentTarget.value);
                      if (scene) {
                        onDocumentChange(relinkSceneReference(document, node.id, scene));
                      }
                    }}
                  >
                    <option value="">장면 선택</option>
                    {catalog.scenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {scene.episodeTitle} · {scene.sceneTitle}
                      </option>
                    ))}
                  </select>
                </label>
                {!display.broken && display.referenceId ? (
                  <button type="button" onClick={() => onOpenScene?.(display.referenceId!)}>
                    원고에서 장면 열기
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    onDocumentChange(convertReferenceToText(document, node.id))
                  }
                >
                  일반 텍스트로 변환
                </button>
              </>
            ) : null}
            <div className="plot-canvas-inspector__actions">
              <button
                type="button"
                onClick={() => onDocumentChange(reorderCanvasNode(document, node.id, "FRONT"))}
              >
                앞으로 가져오기
              </button>
              <button
                type="button"
                onClick={() => onDocumentChange(reorderCanvasNode(document, node.id, "BACK"))}
              >
                뒤로 보내기
              </button>
              <button type="button" onClick={onDuplicate}>
                복제
              </button>
              <button type="button" className="danger" onClick={onDelete}>
                삭제
              </button>
            </div>
          </div>
        );
      })() : null}
      {edge ? (
        <div className="plot-canvas-inspector__form">
          <p className="plot-canvas-inspector__type">캔버스 연결선</p>
          <p>세계관 설정의 공식 관계와는 별개입니다.</p>
          <label>
            Label
            <input
              maxLength={20_000}
              value={edge.label ?? ""}
              onChange={(event) =>
                onDocumentChange(
                  updateCanvasEdge(document, edge.id, (current) => ({
                    ...current,
                    label: event.currentTarget.value
                  }))
                )
              }
            />
          </label>
          <label>
            화살표
            <select
              value={
                edge.fromEnd === "arrow" && edge.toEnd === "arrow"
                  ? "BOTH"
                  : edge.fromEnd === "arrow"
                    ? "START"
                    : edge.toEnd === "arrow"
                      ? "END"
                      : "NONE"
              }
              onChange={(event) =>
                onDocumentChange(
                  updateCanvasEdge(document, edge.id, (current) => ({
                    ...current,
                    fromEnd:
                      event.currentTarget.value === "BOTH" ||
                      event.currentTarget.value === "START"
                        ? "arrow"
                        : "none",
                    toEnd:
                      event.currentTarget.value === "BOTH" ||
                      event.currentTarget.value === "END"
                        ? "arrow"
                        : "none"
                  }))
                )
              }
            >
              <option value="NONE">없음</option>
              <option value="END">끝</option>
              <option value="START">시작</option>
              <option value="BOTH">양방향</option>
            </select>
          </label>
          <label>
            선 스타일
            <select
              value={edge.madi?.lineStyle ?? "SOLID"}
              onChange={(event) =>
                onDocumentChange(
                  updateCanvasEdge(document, edge.id, (current) => ({
                    ...current,
                    madi: {
                      ...current.madi,
                      lineStyle: event.currentTarget.value as
                        | "SOLID"
                        | "DASHED"
                        | "DOTTED"
                    }
                  }))
                )
              }
            >
              <option value="SOLID">실선</option>
              <option value="DASHED">파선</option>
              <option value="DOTTED">점선</option>
            </select>
          </label>
          <label>
            색상
            <input
              aria-label="연결선 색상"
              maxLength={64}
              value={edge.color ?? ""}
              onChange={(event) =>
                onDocumentChange(
                  updateCanvasEdge(document, edge.id, (current) => ({
                    ...current,
                    ...(event.currentTarget.value
                      ? { color: event.currentTarget.value }
                      : { color: undefined })
                  }))
                )
              }
            />
          </label>
          <button type="button" className="danger" onClick={onDelete}>
            연결선 삭제
          </button>
        </div>
      ) : null}
    </aside>
  );
}
