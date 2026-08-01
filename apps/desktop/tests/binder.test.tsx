import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Binder,
  type BinderProps
} from "../src/renderer/components/Binder";
import {
  allowedBinderChildTypes,
  type BinderWorkNode
} from "../src/renderer/workspace/binderTree";

const tree: BinderWorkNode = {
  id: "work-1",
  type: "WORK",
  title: "드래곤을 죽이다",
  children: [
    {
      id: "volume-1",
      type: "VOLUME",
      title: "제1권",
      children: [
        {
          id: "chapter-1",
          type: "CHAPTER",
          title: "제1화",
          children: [
            {
              id: "scene-1",
              type: "SCENE",
              title: "첫 장면"
            },
            {
              id: "scene-2",
              type: "SCENE",
              title: ""
            }
          ]
        }
      ]
    },
    {
      id: "chapter-direct",
      type: "CHAPTER",
      title: "막간",
      children: [
        {
          id: "scene-direct",
          type: "SCENE",
          title: "도시의 밤"
        }
      ]
    }
  ]
};

function defaultProps(
  overrides: Partial<BinderProps> = {}
): BinderProps {
  return {
    tree,
    selectedNodeId: null,
    collapsedNodeIds: new Set(),
    onSelect: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    ...overrides
  };
}

describe("Phase 1A Binder", () => {
  it("renders the typed hierarchy, direct WORK chapter, defaults and selection", () => {
    render(
      <Binder
        {...defaultProps({ selectedNodeId: "chapter-direct" })}
      />
    );

    expect(screen.getAllByRole("treeitem")).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: "드래곤을 죽이다" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "막간" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 장면" })).toBeTruthy();

    const selectedRow = screen
      .getByRole("button", { name: "막간" })
      .closest('[role="treeitem"]');
    expect(selectedRow?.getAttribute("aria-selected")).toBe("true");
    expect(
      selectedRow?.querySelector(".binder__row")?.getAttribute(
        "data-selected"
      )
    ).toBe("true");
  });

  it("selects WORK, VOLUME and CHAPTER nodes through real buttons", () => {
    const onSelect = vi.fn();
    render(<Binder {...defaultProps({ onSelect })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "드래곤을 죽이다" })
    );
    fireEvent.click(screen.getByRole("button", { name: "제1권" }));
    fireEvent.click(screen.getByRole("button", { name: "막간" }));

    expect(onSelect.mock.calls).toEqual([
      [{ nodeId: "work-1", type: "WORK" }],
      [{ nodeId: "volume-1", type: "VOLUME" }],
      [{ nodeId: "chapter-direct", type: "CHAPTER" }]
    ]);
  });

  it("keeps collapse controlled and hides or restores descendants", () => {
    function ControlledBinder() {
      const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
        new Set()
      );
      return (
        <Binder
          {...defaultProps({
            collapsedNodeIds: collapsed,
            onToggleCollapsed: (nodeId, nextCollapsed) => {
              setCollapsed((current) => {
                const next = new Set(current);
                if (nextCollapsed) {
                  next.add(nodeId);
                } else {
                  next.delete(nodeId);
                }
                return next;
              });
            }
          })}
        />
      );
    }

    render(<ControlledBinder />);
    fireEvent.click(screen.getByRole("button", { name: "제1권 접기" }));

    expect(
      screen.queryByRole("button", { name: "제1화" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "제1권 펼치기" })
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "제1권 펼치기" })
    );
    expect(screen.getByRole("button", { name: "제1화" })).toBeTruthy();
  });

  it("offers only allowed create actions including a direct WORK chapter", () => {
    const onCreate = vi.fn();
    render(<Binder {...defaultProps({ onCreate })} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "드래곤을 죽이다에 권 추가"
      })
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "드래곤을 죽이다에 화 추가"
      })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "제1권에 화 추가" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "제1화에 장면 추가" })
    );

    expect(onCreate.mock.calls).toEqual([
      [{ parentId: "work-1", type: "VOLUME", title: "새 권" }],
      [{ parentId: "work-1", type: "CHAPTER", title: "새 화" }],
      [{ parentId: "volume-1", type: "CHAPTER", title: "새 화" }],
      [{ parentId: "chapter-1", type: "SCENE", title: "새 장면" }]
    ]);
    expect(
      screen.queryByRole("button", { name: /첫 장면에 .* 추가/ })
    ).toBeNull();
    expect(allowedBinderChildTypes(tree)).toEqual(["VOLUME", "CHAPTER"]);
  });

  it("renames with an accessible inline form and applies a default title", () => {
    const onRename = vi.fn();
    render(<Binder {...defaultProps({ onRename })} />);

    fireEvent.click(
      screen.getByRole("button", { name: "막간 이름 변경" })
    );
    const input = screen.getByRole("textbox", { name: "막간 이름" });
    fireEvent.change(input, { target: { value: "새 막간" } });
    fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
    expect(onRename).toHaveBeenLastCalledWith({
      nodeId: "chapter-direct",
      title: "새 막간"
    });

    fireEvent.click(
      screen.getByRole("button", { name: "새 장면 이름 변경" })
    );
    const defaultInput = screen.getByRole("textbox", {
      name: "새 장면 이름"
    });
    fireEvent.change(defaultInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
    expect(onRename).toHaveBeenLastCalledWith({
      nodeId: "scene-2",
      title: "새 장면"
    });
  });

  it("requests deletion only after explicit confirmation", () => {
    const onDelete = vi.fn();
    const confirmDelete = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(
      <Binder
        {...defaultProps({ onDelete, confirmDelete })}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "막간 삭제" });
    fireEvent.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(deleteButton);

    expect(confirmDelete).toHaveBeenCalledTimes(2);
    expect(onDelete).toHaveBeenCalledWith({ nodeId: "chapter-direct" });
    expect(
      screen.queryByRole("button", { name: "드래곤을 죽이다 삭제" })
    ).toBeNull();
  });

  it("reorders only within the same parent and disables boundary moves", () => {
    const onReorder = vi.fn();
    render(<Binder {...defaultProps({ onReorder })} />);

    const volumeItem = screen
      .getByRole("button", { name: "제1권" })
      .closest<HTMLElement>('[role="treeitem"]');
    if (!volumeItem) {
      throw new Error("volume tree item missing");
    }
    const volume = within(volumeItem);
    expect(
      (volume.getByRole("button", {
        name: "제1권 위로 이동"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(
      volume.getByRole("button", { name: "제1권 아래로 이동" })
    );

    const directChapterItem = screen
      .getByRole("button", { name: "막간" })
      .closest<HTMLElement>('[role="treeitem"]');
    if (!directChapterItem) {
      throw new Error("direct chapter tree item missing");
    }
    expect(
      (within(directChapterItem).getByRole("button", {
        name: "막간 아래로 이동"
      }) as HTMLButtonElement).disabled
    ).toBe(true);

    expect(onReorder).toHaveBeenCalledWith({
      nodeId: "volume-1",
      parentId: "work-1",
      direction: "down"
    });
  });
});
