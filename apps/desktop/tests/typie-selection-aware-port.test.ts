import { describe, expect, it, vi } from "vitest";

import type { Editor } from "@madi/typie-runtime/browser";
import type { TypieEnginePort } from "../src/renderer/editor/typie/TypieEditorAdapter";
import { bindTypieTextSelection } from "../src/renderer/editor/typie/selectionAwarePort";

function basePort(): TypieEnginePort {
  return {
    mount: vi.fn(async () => undefined),
    createEmptyDocument: vi.fn(async () => undefined),
    restoreSnapshot: vi.fn(async () => undefined),
    exportSnapshot: vi.fn(async () => new Uint8Array()),
    exportPlainText: vi.fn(async () => "반복 / 반복"),
    setInteractionEnabled: vi.fn(),
    focus: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    insertSemanticSceneBreak: vi.fn(),
    onTransaction: vi.fn(() => () => undefined)
  };
}

describe("bindTypieTextSelection", () => {
  it("keeps the raw editor behind the port while exposing one Madi selection", () => {
    const selection = {
      anchor: { node: "node-2", offset: 0, affinity: "downstream" as const },
      head: { node: "node-2", offset: 2, affinity: "downstream" as const }
    };
    const editor = {
      selection: () => selection,
      copy_selection: () => ({ text: "반복", html: "" }),
      prose_text_annotated: () => "반복 / 반복",
      prose_to_selection_annotated: (start: number, end: number) => {
        if (start >= 5 && end <= 7) {
          return {
            anchor: {
              node: "node-2",
              offset: start - 5,
              affinity: "downstream" as const
            },
            head: {
              node: "node-2",
              offset: end - 5,
              affinity: "downstream" as const
            }
          };
        }
        return {
          anchor: {
            node: "node-1",
            offset: 0,
            affinity: "downstream" as const
          },
          head: {
            node: "node-1",
            offset: 2,
            affinity: "downstream" as const
          }
        };
      }
    } as unknown as Editor;
    const port = Object.assign(basePort(), {
      editor,
      compositionActive: false
    });

    const bound = bindTypieTextSelection(port);

    expect(bound).toBe(port);
    expect(bound.readTextSelection?.()).toEqual({
      text: "반복",
      start: 5,
      end: 7,
      blockKey: "node-2"
    });
    expect(Object.keys(bound)).not.toContain("readTextSelection");
  });

  it("returns no selection during native composition", () => {
    const port = Object.assign(basePort(), {
      editor: {} as Editor,
      compositionActive: true
    });
    const bound = bindTypieTextSelection(port);

    expect(bound.readTextSelection?.()).toBeNull();
  });

  it("fails closed when the pinned browser port shape changes", () => {
    expect(() => bindTypieTextSelection(basePort())).toThrowError(
      /selection bridge internals/u
    );
  });
});
