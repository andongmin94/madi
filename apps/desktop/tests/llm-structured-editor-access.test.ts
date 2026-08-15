import { describe, expect, it, vi } from "vitest";

import type {
  EditorChange,
  EditorStructuredSelection,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { LlmEditorAccess } from "../src/renderer/llm/editorAccess";

const selection: EditorStructuredSelection = {
  text: "첫 문단\n\n둘째 문단",
  start: 0,
  end: 11,
  segments: [
    { text: "첫 문단", start: 0, end: 4, nodeKey: "node-1" },
    { text: "둘째 문단", start: 6, end: 11, nodeKey: "node-2" }
  ],
  separators: ["\n\n"]
};

function createFixture() {
  let listener: ((change: EditorChange) => void) | null = null;
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array()),
    getPlainText: vi.fn(async () => selection.text),
    getStructuredTextSelection: vi.fn(() => selection),
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
  const access = new LlmEditorAccess();
  access.attach(adapter);
  listener?.({
    revision: 6,
    reason: "content",
    canUndo: true,
    canRedo: false,
    isComposing: false
  });
  return {
    access,
    adapter,
    emit(change: EditorChange) {
      listener?.(change);
    }
  };
}

describe("LlmEditorAccess structured selection", () => {
  it("returns an exact multi-block selection bound to generation and revision", async () => {
    const fixture = createFixture();

    await expect(fixture.access.readCurrentStructuredSelection()).resolves.toEqual({
      generation: 1,
      revision: 6,
      isComposing: false,
      canReadSelection: false,
      canApplyProposal: false,
      selection
    });
  });

  it("produces a read-only multi-replacement plan for the current document", async () => {
    const fixture = createFixture();

    const plan = await fixture.access.assessMultiBlockProposal({
      expectedGeneration: 1,
      expectedRevision: 6,
      selection,
      proposalBlocks: ["새 첫 문단", "새 둘째 문단"]
    });

    expect(plan).toMatchObject({
      status: "READY",
      changedBlockCount: 2,
      expectedDocumentText: "새 첫 문단\n\n새 둘째 문단"
    });
    expect(fixture.adapter.getPlainText).toHaveBeenCalledTimes(1);
  });

  it("invalidates the plan after a later editor transaction", async () => {
    const fixture = createFixture();
    fixture.emit({
      revision: 7,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    await expect(
      fixture.access.assessMultiBlockProposal({
        expectedGeneration: 1,
        expectedRevision: 6,
        selection,
        proposalBlocks: ["새 첫 문단", "새 둘째 문단"]
      })
    ).resolves.toMatchObject({ status: "STALE_DOCUMENT" });
  });
});
