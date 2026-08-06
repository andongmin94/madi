import { describe, expect, it, vi } from "vitest";

import type {
  EditorChange,
  MadiEditorAdapter,
  MadiEditorAdapterFactory
} from "../src/renderer/editor/MadiEditorAdapter";
import {
  createLlmTrackedEditorFactory,
  LlmEditorAccess
} from "../src/renderer/llm/editorAccess";

function createAdapter() {
  let listener: ((change: EditorChange) => void) | null = null;
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getPlainText: vi.fn(async () => "현재 편집 원고"),
    focus: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    insertSceneBreak: vi.fn(),
    onChanged: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = null;
      };
    })
  };
  return {
    adapter,
    emit(change: EditorChange) {
      listener?.(change);
    }
  };
}

describe("LlmEditorAccess", () => {
  it("tracks the one active editor without changing the application adapter", async () => {
    const fixture = createAdapter();
    const baseFactory: MadiEditorAdapterFactory = vi.fn(
      async () => fixture.adapter
    );
    const access = new LlmEditorAccess();
    const factory = createLlmTrackedEditorFactory(baseFactory, access);
    const mount = document.createElement("div");

    const returned = await factory(mount);
    fixture.emit({
      revision: 17,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    expect(returned).toBe(fixture.adapter);
    await expect(access.readCurrentDocument()).resolves.toEqual({
      plainText: "현재 편집 원고",
      revision: 17,
      isComposing: false
    });
  });

  it("refuses to copy a document while native composition is active", async () => {
    const fixture = createAdapter();
    const access = new LlmEditorAccess();
    const factory = createLlmTrackedEditorFactory(
      async () => fixture.adapter,
      access
    );
    await factory(document.createElement("div"));
    fixture.emit({
      revision: 18,
      reason: "composition-state",
      canUndo: true,
      canRedo: false,
      isComposing: true
    });

    await expect(access.readCurrentDocument()).rejects.toThrowError(
      /한글 조합이 끝난 뒤/u
    );
    expect(fixture.adapter.getPlainText).not.toHaveBeenCalled();
  });
});
