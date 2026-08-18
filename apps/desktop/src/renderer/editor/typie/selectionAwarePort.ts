import type { Editor } from "@madi/typie-runtime/browser";

import type { EditorTextSelection } from "../MadiEditorAdapter";
import type { TypieEnginePort } from "./TypieEditorAdapter";
import { readMappedTextSelection } from "./selectionMapping";

interface BrowserTypieSelectionInternals {
  readonly editor: Editor | undefined;
  readonly compositionActive: boolean;
}

function requireSelectionInternals(
  port: TypieEnginePort
): BrowserTypieSelectionInternals {
  const candidate = port as unknown as Partial<BrowserTypieSelectionInternals>;
  if (
    !("editor" in candidate) ||
    typeof candidate.compositionActive !== "boolean"
  ) {
    throw new Error(
      "Pinned Typie browser port no longer exposes the selection bridge internals"
    );
  }
  return candidate as BrowserTypieSelectionInternals;
}

/**
 * Keeps the raw Typie `Editor` inside the pinned adapter directory while adding
 * Madi's exact same-block selection contract to the browser port. The runtime
 * pin and this bridge must be upgraded together.
 */
export function bindTypieTextSelection(
  port: TypieEnginePort
): TypieEnginePort {
  const internals = requireSelectionInternals(port);
  const readTextSelection = (): EditorTextSelection | null => {
    if (internals.compositionActive || !internals.editor) {
      return null;
    }
    return readMappedTextSelection(internals.editor);
  };
  Object.defineProperty(port, "readTextSelection", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: readTextSelection
  });
  return port;
}
