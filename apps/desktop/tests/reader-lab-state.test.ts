import { describe, expect, it } from "vitest";
import { BUILTIN_READER_PRESETS } from "../src/renderer/components/readerLab/builtinTemplates";
import { applyReaderOverrides } from "../src/renderer/components/readerLab/readerConfig";
import {
  defaultReaderLabUiState,
  normalizeReaderLabUiState,
  readerScopeOptions
} from "../src/renderer/components/readerLab/readerLabState";
import type { ProjectTree } from "../src/shared/contracts";
import { validateReaderLabUiState } from "../src/shared/readerLabStateValidation";

const NOW = "2026-08-09T00:00:00.000Z";
const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "상태 복원",
    authorName: null,
    createdAt: NOW,
    updatedAt: NOW
  },
  nodes: [
    { id: "work", projectId: "project-1", parentId: null, kind: "WORK", title: "작품", orderKey: 1024, documentId: null, createdAt: NOW, updatedAt: NOW },
    { id: "chapter", projectId: "project-1", parentId: "work", kind: "CHAPTER", title: "1화", orderKey: 1024, documentId: null, createdAt: NOW, updatedAt: NOW },
    { id: "scene-a", projectId: "project-1", parentId: "chapter", kind: "SCENE", title: "첫 장면", orderKey: 1024, documentId: "doc-a", createdAt: NOW, updatedAt: NOW },
    { id: "scene-b", projectId: "project-1", parentId: "chapter", kind: "SCENE", title: "둘째 장면", orderKey: 2048, documentId: "doc-b", createdAt: NOW, updatedAt: NOW }
  ],
  revision: 5
};

describe("Reader Lab project-local UI state", () => {
  it("keeps current SCENE first when Binder selects WORK or CHAPTER without an active scene", () => {
    for (const selected of ["work", "chapter"]) {
      const options = readerScopeOptions(tree, selected, null, null);
      expect(options[0]).toMatchObject({ nodeId: "scene-a", kind: "SCENE" });
      expect(options.some((option) => option.nodeId === selected)).toBe(true);
    }
  });

  it("falls back from deleted scope and preset references to a safe scene and built-in", () => {
    const options = readerScopeOptions(tree, "chapter", null, "deleted-node");
    const state = {
      ...defaultReaderLabUiState("scene-b"),
      lastScopeNodeId: "deleted-node",
      paneCount: 3 as const,
      panes: defaultReaderLabUiState("scene-b").panes.map((pane) => ({
        ...pane,
        presetId: "deleted-preset"
      }))
    };
    const normalized = normalizeReaderLabUiState(
      state,
      options,
      BUILTIN_READER_PRESETS
    );
    expect(normalized.lastScopeNodeId).toBe("scene-a");
    expect(normalized.panes[0]?.presetId).toBe(BUILTIN_READER_PRESETS[0]!.id);
    expect(normalized.panes).toHaveLength(3);
  });

  it("restores pane count, independent zoom/progress and comparison state", () => {
    const options = readerScopeOptions(tree, "scene-b", "scene-b", "scene-b");
    const base = defaultReaderLabUiState("scene-b");
    const state = {
      ...base,
      paneCount: 3 as const,
      scrollSync: true,
      selectedSourceBlockId: "paragraph-2",
      panes: base.panes.map((pane, index) => ({
        ...pane,
        zoom: 0.8 + index * 0.1,
        scrollProgress: index * 0.25
      }))
    };
    const restored = normalizeReaderLabUiState(
      state,
      options,
      BUILTIN_READER_PRESETS
    );
    expect(restored.paneCount).toBe(3);
    expect(restored.scrollSync).toBe(true);
    expect(restored.selectedSourceBlockId).toBe("paragraph-2");
    expect(restored.panes.map((pane) => pane.scrollProgress)).toEqual([
      0,
      0.25,
      0.5
    ]);
  });

  it("repairs persisted relational overrides before resolving a render config", () => {
    const base = defaultReaderLabUiState("scene-a");
    const persisted = validateReaderLabUiState({
      ...base,
      panes: base.panes.map((pane, index) =>
        index === 0
          ? {
              ...pane,
              presetId: BUILTIN_READER_PRESETS[0]!.id,
              overrides: {
                viewportWidth: 280,
                viewportHeight: 400,
                readerSettings: {
                  horizontalPadding: 200,
                  verticalPadding: 200
                }
              }
            }
          : pane
      )
    });
    const normalized = normalizeReaderLabUiState(
      persisted,
      readerScopeOptions(tree, "scene-a", "scene-a", "scene-a"),
      BUILTIN_READER_PRESETS
    );

    const resolved = applyReaderOverrides(
      BUILTIN_READER_PRESETS[0]!.config,
      normalized.panes[0]!.overrides
    );
    expect(resolved.settings.horizontalPadding).toBe(139);
    expect(resolved.settings.verticalPadding).toBe(153);
  });
});
