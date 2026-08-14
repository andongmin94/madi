import { describe, expect, it } from "vitest";

import {
  readMappedStructuredSelection,
  readMappedTextSelection
} from "../src/renderer/editor/typie/selectionMapping";

function position(node: string, offset: number) {
  return { node, offset, affinity: "downstream" as const };
}

describe("Typie selection mapping", () => {
  it("maps the actually selected duplicate instead of the first text match", () => {
    const currentSelection = {
      anchor: position("node-2", 2),
      head: position("node-2", 0)
    };
    const result = readMappedTextSelection({
      selection: () => currentSelection,
      copy_selection: () => ({ text: "반복", html: "" }),
      prose_text_annotated: () => "반복 / 반복",
      prose_to_selection_annotated: (start, end) => {
        if (start === 0 && end === 2) {
          return {
            anchor: position("node-1", 0),
            head: position("node-1", 2)
          };
        }
        if (start >= 5 && end <= 7) {
          return {
            anchor: position("node-2", start - 5),
            head: position("node-2", end - 5)
          };
        }
        return undefined;
      }
    });

    expect(result).toEqual({
      text: "반복",
      start: 5,
      end: 7,
      blockKey: "node-2"
    });
  });

  it("uses Unicode-scalar offsets after a non-BMP character", () => {
    const result = readMappedTextSelection({
      selection: () => ({
        anchor: position("node-1", 0),
        head: position("node-1", 2)
      }),
      copy_selection: () => ({ text: "반복", html: "" }),
      prose_text_annotated: () => "🙂 반복",
      prose_to_selection_annotated: (start, end) =>
        start >= 2 && end <= 4
          ? {
              anchor: position("node-1", start - 2),
              head: position("node-1", end - 2)
            }
          : undefined
    });

    expect(result).toMatchObject({ start: 2, end: 4, text: "반복" });
  });

  it("maps an exact multi-paragraph selection into opaque text-node segments", () => {
    const currentSelection = {
      anchor: position("node-1", 0),
      head: position("node-2", 5)
    };
    const result = readMappedStructuredSelection({
      selection: () => currentSelection,
      copy_selection: () => ({ text: "첫 문단\n\n둘째 문단", html: "" }),
      prose_text_annotated: () => "첫 문단\n\n둘째 문단",
      prose_to_selection_annotated: (start, end) => {
        if (start === 0 && end === 11) {
          return currentSelection;
        }
        if (start >= 0 && end <= 4) {
          return {
            anchor: position("node-1", start),
            head: position("node-1", end)
          };
        }
        if (start >= 6 && end <= 11) {
          return {
            anchor: position("node-2", start - 6),
            head: position("node-2", end - 6)
          };
        }
        return undefined;
      }
    });

    expect(result).toEqual({
      text: "첫 문단\n\n둘째 문단",
      start: 0,
      end: 11,
      segments: [
        { text: "첫 문단", start: 0, end: 4, nodeKey: "node-1" },
        { text: "둘째 문단", start: 6, end: 11, nodeKey: "node-2" }
      ],
      separators: ["\n\n"]
    });
    expect(readMappedTextSelection({
      selection: () => currentSelection,
      copy_selection: () => ({ text: "첫 문단\n\n둘째 문단", html: "" }),
      prose_text_annotated: () => "첫 문단\n\n둘째 문단",
      prose_to_selection_annotated: (start, end) => {
        if (start === 0 && end === 11) {
          return currentSelection;
        }
        if (start >= 0 && end <= 4) {
          return {
            anchor: position("node-1", start),
            head: position("node-1", end)
          };
        }
        if (start >= 6 && end <= 11) {
          return {
            anchor: position("node-2", start - 6),
            head: position("node-2", end - 6)
          };
        }
        return undefined;
      }
    })).toBeNull();
  });

  it("rejects collapsed and unmappable selections", () => {
    expect(
      readMappedTextSelection({
        selection: () => ({
          anchor: position("node-1", 1),
          head: position("node-1", 1)
        }),
        copy_selection: () => ({ text: "", html: "" }),
        prose_text_annotated: () => "문장",
        prose_to_selection_annotated: () => undefined
      })
    ).toBeNull();

    expect(
      readMappedStructuredSelection({
        selection: () => ({
          anchor: position("node-1", 0),
          head: position("node-2", 2)
        }),
        copy_selection: () => ({ text: "두 문단", html: "" }),
        prose_text_annotated: () => "두\n문단",
        prose_to_selection_annotated: () => undefined
      })
    ).toBeNull();
  });
});
