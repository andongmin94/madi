import { useState, type FormEvent, type ReactNode } from "react";
import {
  BINDER_DEFAULT_TITLES,
  BINDER_TYPE_LABELS,
  allowedBinderChildTypes,
  binderChildren,
  binderDisplayTitle,
  canMoveBinderNode,
  normalizedBinderTitle,
  type BinderCreatableNodeType,
  type BinderNode,
  type BinderNodeType,
  type BinderWorkNode
} from "../workspace/binderTree";

export interface BinderSelectRequest {
  readonly nodeId: string;
  readonly type: BinderNodeType;
}

export interface BinderCreateRequest {
  readonly parentId: string;
  readonly type: BinderCreatableNodeType;
  readonly title: string;
}

export interface BinderRenameRequest {
  readonly nodeId: string;
  readonly title: string;
}

export interface BinderDeleteRequest {
  readonly nodeId: string;
}

export interface BinderReorderRequest {
  readonly nodeId: string;
  readonly parentId: string;
  readonly direction: "up" | "down";
}

export interface BinderProps {
  readonly tree: BinderWorkNode;
  readonly selectedNodeId?: string | null;
  readonly collapsedNodeIds: ReadonlySet<string>;
  readonly onSelect: (request: BinderSelectRequest) => void;
  readonly onToggleCollapsed: (nodeId: string, collapsed: boolean) => void;
  readonly onCreate: (request: BinderCreateRequest) => void;
  readonly onRename: (request: BinderRenameRequest) => void;
  readonly onDelete: (request: BinderDeleteRequest) => void;
  readonly onReorder: (request: BinderReorderRequest) => void;
  readonly confirmDelete?: (node: BinderNode) => boolean;
  readonly title?: ReactNode;
  readonly ariaLabel?: string;
}

interface RenameDraft {
  readonly nodeId: string;
  readonly value: string;
}

interface BinderTreeNodeProps extends BinderProps {
  readonly node: BinderNode;
  readonly parentId: string | null;
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly level: number;
  readonly renameDraft: RenameDraft | null;
  readonly setRenameDraft: (draft: RenameDraft | null) => void;
}

function defaultDeleteConfirmation(node: BinderNode): boolean {
  const title = binderDisplayTitle(node);
  const typeLabel = BINDER_TYPE_LABELS[node.type];
  return window.confirm(`‘${title}’ ${typeLabel}을(를) 삭제할까요?`);
}

function BinderTreeNode({
  node,
  parentId,
  siblingIndex,
  siblingCount,
  level,
  selectedNodeId,
  collapsedNodeIds,
  onSelect,
  onToggleCollapsed,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  confirmDelete,
  renameDraft,
  setRenameDraft,
  ...sharedProps
}: BinderTreeNodeProps) {
  const children = binderChildren(node);
  const childTypes = allowedBinderChildTypes(node);
  const title = binderDisplayTitle(node);
  const selected = selectedNodeId === node.id;
  const collapsed = collapsedNodeIds.has(node.id);
  const branch = children.length > 0;
  const editing = renameDraft?.nodeId === node.id;

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameDraft || renameDraft.nodeId !== node.id) {
      return;
    }
    onRename({
      nodeId: node.id,
      title: normalizedBinderTitle(node.type, renameDraft.value)
    });
    setRenameDraft(null);
  };

  const requestDelete = () => {
    const confirmed = (confirmDelete ?? defaultDeleteConfirmation)(node);
    if (confirmed) {
      onDelete({ nodeId: node.id });
    }
  };

  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-expanded={branch ? !collapsed : undefined}
      data-node-id={node.id}
      data-node-type={node.type}
    >
      <div
        className={`binder__row${selected ? " binder__row--selected" : ""}`}
        data-selected={selected ? "true" : "false"}
        style={
          selected
            ? {
                backgroundColor: "#e7e1d5",
                boxShadow: "inset 3px 0 #725b3f"
              }
            : undefined
        }
      >
        {branch ? (
          <button
            type="button"
            aria-label={`${title} ${collapsed ? "펼치기" : "접기"}`}
            aria-expanded={!collapsed}
            onClick={() => onToggleCollapsed(node.id, !collapsed)}
          >
            <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          </button>
        ) : (
          <span aria-hidden="true">•</span>
        )}

        {editing ? (
          <form onSubmit={submitRename}>
            <label>
              <span className="sr-only">{title} 이름</span>
              <input
                autoFocus
                aria-label={`${title} 이름`}
                value={renameDraft.value}
                onChange={(event) =>
                  setRenameDraft({
                    nodeId: node.id,
                    value: event.target.value
                  })
                }
              />
            </label>
            <button type="submit">이름 저장</button>
            <button type="button" onClick={() => setRenameDraft(null)}>
              취소
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="binder__title"
            aria-current={selected ? "true" : undefined}
            onClick={() => onSelect({ nodeId: node.id, type: node.type })}
          >
            {title}
          </button>
        )}

        <span aria-label={`유형: ${BINDER_TYPE_LABELS[node.type]}`}>
          {BINDER_TYPE_LABELS[node.type]}
        </span>
        <button
          type="button"
          aria-label={`${title} 이름 변경`}
          onClick={() => setRenameDraft({ nodeId: node.id, value: title })}
        >
          이름 변경
        </button>

        {childTypes.map((childType) => (
          <button
            type="button"
            key={childType}
            aria-label={`${title}에 ${BINDER_TYPE_LABELS[childType]} 추가`}
            onClick={() =>
              onCreate({
                parentId: node.id,
                type: childType,
                title: BINDER_DEFAULT_TITLES[childType]
              })
            }
          >
            {BINDER_TYPE_LABELS[childType]} 추가
          </button>
        ))}

        {parentId && (
          <>
            <button
              type="button"
              aria-label={`${title} 위로 이동`}
              disabled={
                !canMoveBinderNode(siblingIndex, siblingCount, "up")
              }
              onClick={() =>
                onReorder({
                  nodeId: node.id,
                  parentId,
                  direction: "up"
                })
              }
            >
              위로
            </button>
            <button
              type="button"
              aria-label={`${title} 아래로 이동`}
              disabled={
                !canMoveBinderNode(siblingIndex, siblingCount, "down")
              }
              onClick={() =>
                onReorder({
                  nodeId: node.id,
                  parentId,
                  direction: "down"
                })
              }
            >
              아래로
            </button>
            <button
              type="button"
              aria-label={`${title} 삭제`}
              onClick={requestDelete}
            >
              삭제
            </button>
          </>
        )}
      </div>

      {branch && !collapsed && (
        <ul role="group">
          {children.map((child, index) => (
            <BinderTreeNode
              key={child.id}
              {...sharedProps}
              tree={sharedProps.tree}
              node={child}
              parentId={node.id}
              siblingIndex={index}
              siblingCount={children.length}
              level={level + 1}
              selectedNodeId={selectedNodeId}
              collapsedNodeIds={collapsedNodeIds}
              onSelect={onSelect}
              onToggleCollapsed={onToggleCollapsed}
              onCreate={onCreate}
              onRename={onRename}
              onDelete={onDelete}
              onReorder={onReorder}
              confirmDelete={confirmDelete}
              renameDraft={renameDraft}
              setRenameDraft={setRenameDraft}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Binder({
  title = "Binder",
  ariaLabel = "작품 Binder",
  ...props
}: BinderProps) {
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);

  return (
    <aside className="binder" aria-label={ariaLabel}>
      <h2>{title}</h2>
      <ul role="tree" aria-label={`${ariaLabel} 트리`}>
        <BinderTreeNode
          {...props}
          title={title}
          ariaLabel={ariaLabel}
          node={props.tree}
          parentId={null}
          siblingIndex={0}
          siblingCount={1}
          level={1}
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
        />
      </ul>
    </aside>
  );
}
