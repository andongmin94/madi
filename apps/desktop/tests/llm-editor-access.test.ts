import { describe, expect, it, vi } from "vitest";

import type {
  EditorChange,
  EditorTextReplacement,
  MadiEditorAdapter,
  MadiEditorAdapterFactory
} from "../src/renderer/editor/MadiEditorAdapter";
import {
  createLlmTrackedEditorFactory,
  LlmEditorAccess
} from "../src/renderer/llm/editorAccess";

function createAdapter(initialText = "현재 편집 원고") {
  let listener: ((change: EditorChange) => void) | null = null;
  let text = initialText;
  let revision = 0;
  const replaceTextRanges = vi.fn(
    async (replacements: readonly EditorTextReplacement[]) => {
      const characters = Array.from(text);
      for (const replacement of [...replacements].sort(
        (left, right) => right.start - left.start
      )) {
        expect(
          characters.slice(replacement.start, replacement.end).join("")
        ).toBe(replacement.expectedText);
        characters.splice(
          replacement.start,
          replacement.end - replacement.start,
          ...Array.from(replacement.replacement)
        );
      }
      text = characters.join("");
      revision += 1;
      listener?.({
        revision,
        reason: "content",
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
      return {
        snapshot: new Uint8Array([4, 5, 6]),
        plainTextRecovery: text,
        semanticSceneBreakCount: 0
      };
    }
  );
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getPlainText: vi.fn(async () => text),
    replaceTextRanges,
    setInteractionEnabled: vi.fn(),
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
    replaceTextRanges,
    emit(change: EditorChange) {
      revision = change.revision;
      listener?.(change);
    },
    text() {
      return text;
    }
  };
}

describe("LlmEditorAccess", () => {
  it("tracks the one active editor and its document generation", async () => {
    const fixture = createAdapter();
    const baseFactory: MadiEditorAdapterFactory = vi.fn(
      async () => fixture.adapter
    );
    const access = new LlmEditorAccess();
    const factory = createLlmTrackedEditorFactory(baseFactory, access);
    const mount = document.createElement("div");

    const returned = await factory(mount);
    fixture.emit({
      revision: 0,
      reason: "restore",
      canUndo: false,
      canRedo: false,
      isComposing: false
    });
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
      generation: 2,
      revision: 17,
      isComposing: false,
      canApplyProposal: true
    });
  });

  it("notifies subscribers when a new Typie document is restored", async () => {
    const fixture = createAdapter();
    const access = new LlmEditorAccess();
    await createLlmTrackedEditorFactory(
      async () => fixture.adapter,
      access
    )(document.createElement("div"));
    const states: number[] = [];
    const unsubscribe = access.subscribe((state) => states.push(state.generation));

    fixture.emit({
      revision: 0,
      reason: "restore",
      canUndo: false,
      canRedo: false,
      isComposing: false
    });

    expect(states).toEqual([1, 2]);
    unsubscribe();
  });

  it("refuses to copy or apply while native composition is active", async () => {
    const fixture = createAdapter();
    const access = new LlmEditorAccess();
    await createLlmTrackedEditorFactory(
      async () => fixture.adapter,
      access
    )(document.createElement("div"));
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
    await expect(
      access.applyProposal({
        expectedGeneration: 1,
        expectedRevision: 18,
        originalText: "현재",
        proposalText: "지금"
      })
    ).rejects.toThrowError(/한글 조합이 끝난 뒤/u);
    expect(fixture.adapter.getPlainText).not.toHaveBeenCalled();
  });

  it("applies one unique single-line proposal through a Typie transaction", async () => {
    const fixture = createAdapter("앞 🙂 고칠 문장 뒤");
    const access = new LlmEditorAccess();
    await createLlmTrackedEditorFactory(
      async () => fixture.adapter,
      access
    )(document.createElement("div"));
    fixture.emit({
      revision: 5,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    const result = await access.applyProposal({
      expectedGeneration: 1,
      expectedRevision: 5,
      originalText: "고칠 문장",
      proposalText: "다듬은 문장"
    });

    expect(result).toEqual({
      generation: 1,
      revision: 6,
      plainText: "앞 🙂 다듬은 문장 뒤"
    });
    expect(fixture.replaceTextRanges).toHaveBeenCalledWith([
      expect.objectContaining({
        start: 4,
        end: 9,
        expectedText: "고칠 문장",
        replacement: "다듬은 문장"
      })
    ]);
    expect(fixture.adapter.setInteractionEnabled).toHaveBeenNthCalledWith(
      1,
      false
    );
    expect(fixture.adapter.setInteractionEnabled).toHaveBeenLastCalledWith(true);
    expect(fixture.text()).toBe("앞 🙂 다듬은 문장 뒤");
  });

  it("blocks stale and ambiguous proposals before mutation", async () => {
    const fixture = createAdapter("반복 문장 / 반복 문장");
    const access = new LlmEditorAccess();
    await createLlmTrackedEditorFactory(
      async () => fixture.adapter,
      access
    )(document.createElement("div"));
    fixture.emit({
      revision: 3,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    await expect(
      access.applyProposal({
        expectedGeneration: 1,
        expectedRevision: 2,
        originalText: "반복 문장",
        proposalText: "새 문장"
      })
    ).rejects.toMatchObject({ code: "STALE_DOCUMENT" });
    await expect(
      access.applyProposal({
        expectedGeneration: 1,
        expectedRevision: 3,
        originalText: "반복 문장",
        proposalText: "새 문장"
      })
    ).rejects.toMatchObject({ code: "AMBIGUOUS" });
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
  });
});
