import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ScriveningsView,
  type ScriveningsViewProps
} from "../src/renderer/components/ScriveningsView";
import {
  calculateScriveningsStats,
  orderedDescendantScenes,
  splitHighlightSegments,
  type ScriveningsScenePreview
} from "../src/renderer/workspace/scrivenings";
import type { ProjectTree, TreeNodeRecord } from "../src/shared/contracts";

const NOW = "2026-08-02T00:00:00.000Z";

function node(
  id: string,
  parentId: string | null,
  kind: TreeNodeRecord["kind"],
  title: string,
  orderKey: number,
  documentId: string | null = null
): TreeNodeRecord {
  return {
    id,
    projectId: "project-1",
    parentId,
    kind,
    title,
    orderKey,
    documentId,
    createdAt: NOW,
    updatedAt: NOW
  };
}

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "닫힌 성문",
    authorName: null,
    createdAt: NOW,
    updatedAt: NOW
  },
  // Deliberately shuffled: traversal must use parent/orderKey rather than input order.
  nodes: [
    node("scene-3", "chapter-2", "SCENE", "새벽", 1024, "document-3"),
    node("chapter-direct", "work-1", "CHAPTER", "막간", 2048),
    node("scene-2", "chapter-1", "SCENE", "빈 방", 2048, "document-2"),
    node("volume-1", "work-1", "VOLUME", "1권", 1024),
    node("scene-direct", "chapter-direct", "SCENE", "도시", 1024, "document-4"),
    node("chapter-2", "volume-1", "CHAPTER", "2화", 2048),
    node("work-1", null, "WORK", "닫힌 성문", 1024),
    node("scene-1", "chapter-1", "SCENE", "문 앞", 1024, "document-1"),
    node("chapter-1", "volume-1", "CHAPTER", "1화", 1024)
  ],
  revision: 14
};

const previews: readonly ScriveningsScenePreview[] = [
  {
    sceneId: "scene-1",
    documentId: "document-1",
    plainTextRecovery: "그는 문을 열었다.",
    sourceContentHash: "a".repeat(64),
    updatedAt: NOW,
    blocks: [{ kind: "PARAGRAPH", text: "그는 문을 열었다." }]
  },
  {
    sceneId: "scene-2",
    documentId: "document-2",
    plainTextRecovery: "방 안에는 아무도 없었다.",
    sourceContentHash: "b".repeat(64),
    updatedAt: NOW,
    blocks: [
      { kind: "PARAGRAPH", text: "방 안에는" },
      { kind: "SCENE_BREAK" },
      { kind: "PARAGRAPH", text: "아무도 없었다." }
    ]
  },
  {
    sceneId: "scene-3",
    documentId: "document-3",
    plainTextRecovery: "다음 날 아침이었다.",
    sourceContentHash: "c".repeat(64),
    updatedAt: NOW
  },
  {
    sceneId: "scene-direct",
    documentId: "document-4",
    plainTextRecovery: "도시는 고요했다.",
    sourceContentHash: "d".repeat(64),
    updatedAt: NOW
  }
];

function props(
  overrides: Partial<ScriveningsViewProps> = {}
): ScriveningsViewProps {
  return {
    projectTree: tree,
    selectedNodeId: "work-1",
    scenePreviews: previews,
    onActivateScene: vi.fn(async () => undefined),
    renderLiveEditor: (scene) => <div>live: {scene.title}</div>,
    ...overrides
  };
}

describe("Phase 1B Scrivenings", () => {
  it("traverses WORK, VOLUME and CHAPTER descendants in tree order", () => {
    expect(
      orderedDescendantScenes(tree, "work-1", previews).map(
        (scene) => scene.sceneId
      )
    ).toEqual(["scene-1", "scene-2", "scene-3", "scene-direct"]);
    expect(
      orderedDescendantScenes(tree, "volume-1", previews).map(
        (scene) => scene.sceneId
      )
    ).toEqual(["scene-1", "scene-2", "scene-3"]);
    expect(
      orderedDescendantScenes(tree, "chapter-2", previews).map(
        (scene) => scene.sceneId
      )
    ).toEqual(["scene-3"]);

    const { container } = render(<ScriveningsView {...props()} />);
    expect(
      Array.from(container.querySelectorAll("[data-scene-id]")).map(
        (element) => element.getAttribute("data-scene-id")
      )
    ).toEqual(["scene-1", "scene-2", "scene-3", "scene-direct"]);
  });

  it("keeps exactly one live editor and saves before activating another block", async () => {
    const events: string[] = [];
    const onActivateScene = vi.fn(async (request) => {
      events.push(`save:${request.fromSceneId}`);
      await Promise.resolve();
      events.push(`activate:${request.toSceneId}`);
    });
    render(
      <ScriveningsView
        {...props({
          defaultActiveSceneId: "scene-1",
          onActivateScene,
          renderLiveEditor: (scene) => {
            events.push(`render:${scene.sceneId}`);
            return <div>live: {scene.title}</div>;
          }
        })}
      />
    );

    expect(document.querySelectorAll("[data-live-editor-slot]")).toHaveLength(1);
    expect(screen.getByText("live: 문 앞")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "빈 방 장면 편집" }));

    await waitFor(() => expect(screen.getByText("live: 빈 방")).toBeTruthy());
    expect(document.querySelectorAll("[data-live-editor-slot]")).toHaveLength(1);
    expect(onActivateScene).toHaveBeenCalledWith({
      fromSceneId: "scene-1",
      fromDocumentId: "document-1",
      toSceneId: "scene-2",
      toDocumentId: "document-2",
      reason: "BODY"
    });
    expect(events.indexOf("save:scene-1")).toBeLessThan(
      events.indexOf("activate:scene-2")
    );
  });

  it("keeps the current editor mounted when save-before-activate rejects", async () => {
    const onActivationError = vi.fn();
    const onSceneTitleClick = vi.fn();
    render(
      <ScriveningsView
        {...props({
          defaultActiveSceneId: "scene-1",
          onActivateScene: vi.fn(async () => {
            throw new Error("장면 저장 실패");
          }),
          onActivationError,
          onSceneTitleClick
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "새벽" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("장면 저장 실패")
    );

    expect(screen.getByText("live: 문 앞")).toBeTruthy();
    expect(document.querySelectorAll("[data-live-editor-slot]")).toHaveLength(1);
    expect(
      document
        .querySelector('[data-scene-id="scene-1"]')
        ?.getAttribute("data-active")
    ).toBe("true");
    expect(onSceneTitleClick).toHaveBeenCalledWith({
      sceneId: "scene-3",
      documentId: "document-3"
    });
    expect(onActivationError).toHaveBeenCalledTimes(1);
  });

  it("highlights Korean substring matches in titles and read-only text", () => {
    const { container } = render(
      <ScriveningsView {...props({ searchQuery: "문" })} />
    );
    const marks = Array.from(container.querySelectorAll("mark")).map(
      (mark) => mark.textContent
    );
    expect(marks).toEqual(["문", "문"]);
    expect(splitHighlightSegments("닫힌 성문", "성문")).toEqual([
      { text: "닫힌 ", matched: false, start: 0, end: 3 },
      { text: "성문", matched: true, start: 3, end: 5 }
    ]);
  });

  it("reports selection character counts and scene count", () => {
    const scenes = orderedDescendantScenes(tree, "volume-1", previews);
    expect(calculateScriveningsStats(scenes)).toEqual({
      sceneCount: 3,
      loadedSceneCount: 3,
      charactersWithSpaces: 35,
      charactersWithoutSpaces: 28
    });

    render(
      <ScriveningsView
        {...props({ selectedNodeId: "volume-1" })}
      />
    );
    expect(
      screen.getByLabelText("선택 범위 글자 수").textContent
    ).toContain("장면 3개 · 공백 포함 35자 · 공백 제외 28자");
  });

  it("keeps distant blocks lightweight while preserving activation", async () => {
    const onActivateScene = vi.fn(async () => undefined);
    const { container } = render(
      <ScriveningsView
        {...props({
          onActivateScene,
          initialHeavySceneCount: 1,
          windowOverscan: 0
        })}
      />
    );
    const distant = container.querySelector<HTMLElement>(
      '[data-scene-id="scene-direct"]'
    );
    if (!distant) {
      throw new Error("distant scene block missing");
    }
    expect(distant.dataset.renderMode).toBe("light");
    fireEvent.click(
      within(distant).getByRole("button", { name: "도시 장면 편집" })
    );
    await waitFor(() => expect(distant.dataset.renderMode).toBe("live"));
    expect(onActivateScene).toHaveBeenCalledWith(
      expect.objectContaining({ toSceneId: "scene-direct" })
    );
  });
});
