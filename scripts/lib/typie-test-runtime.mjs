import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createInstance } from "../../packages/typie-runtime/browser/editor_ffi.js";

export const TYPIE_COMMIT =
  "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26";
export const MADI_SCENE_BREAK_SEMANTIC_ID = "madi.scene-break.v1";
export const RECOVERY_SCENE_BREAK = "\n\n***\n\n";

const viewport = { width: 760, height: 560, scale_factor: 1 };

const emptyDocument = {
  root: {
    node: {
      type: "root",
      layout_mode: { type: "continuous", max_width: 720 },
    },
    modifiers: {},
    carry: [],
    children: [
      {
        node: { type: "paragraph" },
        modifiers: {},
        carry: [],
        children: [],
      },
    ],
  },
};

export function dispatch(editor, messages) {
  const requestId = editor.enqueue_request(messages);
  const result = editor.tick_through(requestId);
  const outcome = result.request_outcomes.find(
    (candidate) => candidate.request_id.value === requestId.value,
  );
  const rejected =
    outcome?.command_outcomes.filter(
      (candidate) => candidate.type === "rejected",
    ) ?? [];
  if (rejected.length > 0) {
    throw new Error(
      `Typie rejected a verification command: ${JSON.stringify(rejected)}`,
    );
  }
  return result;
}

export function initializeEditor(editor) {
  dispatch(editor, [
    { type: "system", event: { type: "initialize" } },
    { type: "selection", op: { type: "set_flat", start: 1, end: 1 } },
  ]);
}

export function createEmptyEditor(host) {
  const editor = host.create_editor_from_doc(emptyDocument, viewport);
  initializeEditor(editor);
  return editor;
}

export function restoreEditor(host, snapshot) {
  const editor = host.create_editor_from_graph(snapshot, viewport);
  initializeEditor(editor);
  return editor;
}

export function moveToDocumentEnd(editor) {
  dispatch(editor, [
    {
      type: "navigation",
      op: {
        type: "move",
        movement: { type: "document", direction: "forward" },
        extend: false,
      },
    },
  ]);
}

export function insertText(editor, text) {
  dispatch(editor, [{ type: "insertion", op: { type: "text", text } }]);
}

export function insertSceneBreak(editor) {
  dispatch(editor, [
    {
      type: "insertion",
      op: {
        type: "fragment",
        fragment: {
          node: { type: "horizontal_rule", variant: "three_diamonds" },
        },
      },
    },
  ]);
}

export function extractSnapshot(editor) {
  const extracted = editor.missing_changesets_tolerant(new Uint8Array());
  if (extracted.withheld !== 0 || extracted.bytes.byteLength === 0) {
    throw new Error("Typie full changeset extraction failed");
  }
  return new Uint8Array(extracted.bytes);
}

export function countSceneBreaks(annotatedText) {
  return annotatedText.split(RECOVERY_SCENE_BREAK).length - 1;
}

export function countSemanticSceneBreakNodes(editor) {
  const document = editor.materialize_at(editor.current_heads(), []);
  const visit = (entry) => {
    const own =
      entry.node.type === "horizontal_rule" &&
      entry.node.variant === "three_diamonds"
        ? 1
        : 0;
    return (
      own +
      entry.children.reduce((total, child) => total + visit(child), 0)
    );
  };
  return visit(document.root);
}

export function assertSemanticSceneBreak(editor, expectedCount = 1) {
  const annotatedText = editor.prose_text_annotated();
  const markerCount = countSceneBreaks(annotatedText);
  const semanticCount = countSemanticSceneBreakNodes(editor);

  if (markerCount !== expectedCount || semanticCount !== expectedCount) {
    throw new Error(
      `Scene break semantic node mismatch (marker=${markerCount}, semantic=${semanticCount})`,
    );
  }
}

export async function createTypieHost() {
  const wasmPath = fileURLToPath(
    new URL(
      "../../packages/typie-runtime/browser/editor_ffi_bg.wasm",
      import.meta.url,
    ),
  );
  const icuPath = fileURLToPath(
    new URL(
      "../../packages/typie-runtime/browser/icu.zst",
      import.meta.url,
    ),
  );
  const [wasmBytes, icuData] = await Promise.all([
    readFile(wasmPath),
    readFile(icuPath),
  ]);
  const { EditorHost } = await createInstance(
    await WebAssembly.compile(wasmBytes),
  );
  return EditorHost.create(icuData);
}
