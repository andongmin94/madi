import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createInstance } from "../packages/typie-runtime/browser/editor_ffi.js";

const pathFromHere = (relativePath) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const [wasmBytes, icuData, buildInfoJson, fontBase, fontManifest, fontChunk] =
  await Promise.all([
    readFile(pathFromHere("../packages/typie-runtime/browser/editor_ffi_bg.wasm")),
    readFile(pathFromHere("../packages/typie-runtime/browser/icu.zst")),
    readFile(pathFromHere("../packages/typie-runtime/BUILD_INFO.json"), "utf8"),
    readFile(
      pathFromHere(
        "../packages/typie-runtime/assets/NanumGothic-Regular.base.zst"
      )
    ),
    readFile(
      pathFromHere(
        "../packages/typie-runtime/assets/NanumGothic-Regular.manifest.zst"
      )
    ),
    readFile(
      pathFromHere(
        "../packages/typie-runtime/assets/NanumGothic-Regular.chunk-0.zst"
      )
    )
  ]);

const buildInfo = JSON.parse(buildInfoJson);
const wasmModule = await WebAssembly.compile(wasmBytes);
const { EditorHost } = await createInstance(wasmModule);
const host = EditorHost.create(icuData);
host.set_fonts([
  {
    name: "Pretendard",
    source: "DEFAULT",
    weights: [{ value: 400, hash: buildInfo.font.engineHash }]
  }
])?.free();
host.add_font_base("Pretendard", 400, fontBase)?.free();
host.add_font_manifest("Pretendard", 400, fontManifest)?.free();
host.add_font_chunk("Pretendard", 400, 0, fontChunk)?.free();

const emptyDocument = {
  root: {
    node: { type: "root", layout_mode: { type: "continuous", max_width: 720 } },
    modifiers: {},
    carry: [],
    children: [
      {
        node: { type: "paragraph" },
        modifiers: {},
        carry: [],
        children: []
      }
    ]
  }
};
const viewport = { width: 760, height: 560, scale_factor: 1 };

function dispatch(editor, messages) {
  const requestId = editor.enqueue_request(messages);
  const result = editor.tick_through(requestId);
  const rejected = result.request_outcomes.flatMap((outcome) =>
    outcome.command_outcomes.filter((candidate) => candidate.type === "rejected")
  );
  if (rejected.length > 0) {
    throw new Error(
      `Typie rejected an LLM selection probe command: ${JSON.stringify(rejected)}`
    );
  }
  return result;
}

function samePosition(left, right) {
  return left.node === right.node && left.offset === right.offset;
}

function sameSelection(left, right) {
  return (
    (samePosition(left.anchor, right.anchor) &&
      samePosition(left.head, right.head)) ||
    (samePosition(left.anchor, right.head) &&
      samePosition(left.head, right.anchor))
  );
}

function scalarBoundaries(source) {
  const boundaries = new Map([[0, 0]]);
  let codeUnitOffset = 0;
  let scalarOffset = 0;
  for (const character of source) {
    codeUnitOffset += character.length;
    scalarOffset += 1;
    boundaries.set(codeUnitOffset, scalarOffset);
  }
  return boundaries;
}

function mapCurrentSelection(editor) {
  const selection = editor.selection();
  const clipboard = editor.copy_selection();
  if (!selection || !clipboard?.text) {
    return null;
  }
  const source = editor.prose_text_annotated();
  const boundaries = scalarBoundaries(source);
  let nextCodeUnit = 0;
  for (;;) {
    const startCodeUnit = source.indexOf(clipboard.text, nextCodeUnit);
    if (startCodeUnit < 0) {
      return null;
    }
    const endCodeUnit = startCodeUnit + clipboard.text.length;
    const start = boundaries.get(startCodeUnit);
    const end = boundaries.get(endCodeUnit);
    if (start !== undefined && end !== undefined) {
      const candidate = editor.prose_to_selection_annotated(start, end);
      if (candidate && sameSelection(candidate, selection)) {
        return { text: clipboard.text, start, end };
      }
    }
    nextCodeUnit = startCodeUnit + 1;
  }
}

const editor = host.create_editor_from_doc(emptyDocument, viewport);
try {
  dispatch(editor, [
    { type: "system", event: { type: "initialize" } },
    { type: "selection", op: { type: "set_flat", start: 1, end: 1 } }
  ]);

  const original = "같은 문장 / 같은 문장";
  const expected = "같은 문장 / 두 번째 문장";
  dispatch(editor, [{ type: "insertion", op: { type: "text", text: original } }]);

  const second = editor.prose_to_selection_annotated(8, 13);
  if (!second) {
    throw new Error("Typie could not map the second duplicate selection");
  }
  dispatch(editor, [{ type: "selection", op: { type: "set", selection: second } }]);

  const mapped = mapCurrentSelection(editor);
  if (
    mapped?.text !== "같은 문장" ||
    mapped.start !== 8 ||
    mapped.end !== 13
  ) {
    throw new Error(
      `Typie exact duplicate selection mapping failed: ${JSON.stringify(mapped)}`
    );
  }

  const replaceResult = dispatch(editor, [
    {
      type: "tracked_range",
      op: {
        type: "replace_many_from_prose_annotated",
        expected_text: original,
        replacements: [
          {
            id: "llm-exact-second",
            start: mapped.start,
            end: mapped.end,
            expected_text: mapped.text,
            replacement: "두 번째 문장"
          }
        ]
      }
    }
  ]);
  const outcome = replaceResult.events.find(
    (event) =>
      event.type === "tracked_range_replace_result" &&
      event.id === "llm-exact-second"
  );
  if (outcome?.outcome !== "replaced") {
    throw new Error(
      `Typie exact selection replacement was not accepted: ${JSON.stringify(outcome)}`
    );
  }
  if (editor.prose_text_annotated() !== expected) {
    throw new Error("Typie exact selection replacement changed the wrong occurrence");
  }

  dispatch(editor, [{ type: "history", op: { type: "undo" } }]);
  if (editor.prose_text_annotated() !== original) {
    throw new Error("One Undo did not restore the exact selection rewrite");
  }
  dispatch(editor, [{ type: "history", op: { type: "redo" } }]);
  if (editor.prose_text_annotated() !== expected) {
    throw new Error("One Redo did not restore the exact selection rewrite");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        probe: "typie-llm-exact-selection",
        duplicateOccurrence: 2,
        scalarRange: [mapped.start, mapped.end],
        oneUndoEntry: true
      },
      null,
      2
    )}\n`
  );
} finally {
  editor.free();
  host.free();
}
