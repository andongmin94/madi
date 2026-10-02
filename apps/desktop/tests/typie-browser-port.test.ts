import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Editor } from "@madi/typie-runtime/browser";
import { createTypieEnginePort } from "../src/renderer/editor/typie/createTypieEnginePort";

vi.mock("@madi/typie-runtime/browser", () => ({
  createInstance: async () => ({
    EditorHost: {
      create: () => ({
        set_theme_variant: vi.fn(),
        set_fonts: vi.fn(),
        add_font_base: vi.fn(),
        add_font_manifest: vi.fn(),
        add_font_chunk: vi.fn()
      })
    }
  })
}));

describe("Typie browser port text selection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0)
    })));
    vi.spyOn(WebAssembly, "compile").mockResolvedValue({} as WebAssembly.Module);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns no selection before a document is installed", async () => {
    const port = await createTypieEnginePort();
    expect(port.readTextSelection?.()).toBeNull();
  });

  it("maps the actually selected duplicate through the browser port", async () => {
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
          anchor: { node: "node-1", offset: 0, affinity: "downstream" as const },
          head: { node: "node-1", offset: 2, affinity: "downstream" as const }
        };
      }
    } as unknown as Editor;
    const port = await createTypieEnginePort();
    Object.assign(port, { editor });

    expect(port.readTextSelection?.()).toEqual({
      text: "반복",
      start: 5,
      end: 7,
      blockKey: "node-2"
    });
  });

  it("does not inspect the editor during composition", async () => {
    const selection = vi.fn();
    const port = await createTypieEnginePort();
    Object.assign(port, { editor: { selection }, compositionActive: true });

    expect(port.readTextSelection?.()).toBeNull();
    expect(selection).not.toHaveBeenCalled();
  });
});
