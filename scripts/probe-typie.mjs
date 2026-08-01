import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createInstance } from '../packages/typie-runtime/browser/editor_ffi.js';

const pathFromHere = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const wasmPath = pathFromHere('../packages/typie-runtime/browser/editor_ffi_bg.wasm');
const icuPath = pathFromHere('../packages/typie-runtime/browser/icu.zst');
const buildInfoPath = pathFromHere('../packages/typie-runtime/BUILD_INFO.json');
const fontBasePath = pathFromHere('../packages/typie-runtime/assets/NanumGothic-Regular.base.zst');
const fontManifestPath = pathFromHere('../packages/typie-runtime/assets/NanumGothic-Regular.manifest.zst');
const fontChunkPath = pathFromHere('../packages/typie-runtime/assets/NanumGothic-Regular.chunk-0.zst');

const [wasmBytes, icuData, buildInfoJson, fontBase, fontManifest, fontChunk] = await Promise.all([
  readFile(wasmPath),
  readFile(icuPath),
  readFile(buildInfoPath, 'utf8'),
  readFile(fontBasePath),
  readFile(fontManifestPath),
  readFile(fontChunkPath),
]);
const buildInfo = JSON.parse(buildInfoJson);

const wasmModule = await WebAssembly.compile(wasmBytes);
const { EditorHost } = await createInstance(wasmModule);
const host = EditorHost.create(icuData);

host.set_fonts([
  {
    name: 'Pretendard',
    source: 'DEFAULT',
    weights: [{ value: 400, hash: buildInfo.font.engineHash }],
  },
])?.free();
host.add_font_base('Pretendard', 400, fontBase)?.free();
host.add_font_manifest('Pretendard', 400, fontManifest)?.free();
host.add_font_chunk('Pretendard', 400, 0, fontChunk)?.free();

const viewport = { width: 760, height: 560, scale_factor: 1 };
const emptyDocument = {
  root: {
    node: { type: 'root', layout_mode: { type: 'continuous', max_width: 720 } },
    modifiers: {},
    carry: [],
    children: [
      {
        node: { type: 'paragraph' },
        modifiers: {},
        carry: [],
        children: [],
      },
    ],
  },
};

const dispatch = (editor, messages) => {
  const requestId = editor.enqueue_request(messages);
  const result = editor.tick_through(requestId);
  const outcome = result.request_outcomes.find((candidate) => candidate.request_id.value === requestId.value);
  const rejected = outcome?.command_outcomes.filter((candidate) => candidate.type === 'rejected') ?? [];
  if (rejected.length > 0) {
    throw new Error(`Typie rejected a probe command: ${JSON.stringify(rejected)}`);
  }
  return result;
};

const initialize = (editor) =>
  dispatch(editor, [
    { type: 'system', event: { type: 'initialize' } },
    { type: 'selection', op: { type: 'set_flat', start: 1, end: 1 } },
  ]);

const editor = host.create_editor_from_doc(emptyDocument, viewport);
initialize(editor);
dispatch(editor, [{ type: 'insertion', op: { type: 'text', text: '한국어 검증 문장' } }]);
if (!editor.prose_text().includes('한국어')) {
  throw new Error(`Typie text insertion did not change the document: ${editor.inspect_state({ show_node_ids: false })}`);
}
dispatch(editor, [
  {
    type: 'insertion',
    op: {
      type: 'fragment',
      fragment: {
        node: { type: 'horizontal_rule', variant: 'three_diamonds' },
      },
    },
  },
]);
dispatch(editor, [
  {
    type: 'navigation',
    op: {
      type: 'move',
      movement: { type: 'grapheme', direction: 'forward' },
      extend: false,
    },
  },
]);
const selectionAfterSceneBreak = editor.selection();
const imeAfterSceneBreak = editor.ime(128, 128);
dispatch(editor, [{ type: 'insertion', op: { type: 'text', text: '둘째 장면' } }]);

const beforeUndo = editor.prose_text_annotated();
dispatch(editor, [{ type: 'history', op: { type: 'undo' } }]);
const afterUndo = editor.prose_text_annotated();
dispatch(editor, [{ type: 'history', op: { type: 'redo' } }]);
const afterRedo = editor.prose_text_annotated();

if (!beforeUndo.includes('\n\n***\n\n')) {
  throw new Error(`Typie horizontal_rule was not preserved as an annotated semantic divider: ${JSON.stringify(beforeUndo)}`);
}
if (afterUndo === beforeUndo || afterRedo !== beforeUndo) {
  throw new Error('Typie undo/redo round-trip failed');
}

const snapshotResult = editor.missing_changesets_tolerant(new Uint8Array());
if (snapshotResult.withheld !== 0 || snapshotResult.bytes.byteLength === 0) {
  throw new Error('Typie full changeset snapshot extraction failed');
}
const snapshot = new Uint8Array(snapshotResult.bytes);
const restored = host.create_editor_from_graph(snapshot, viewport);
initialize(restored);

if (restored.prose_text_annotated() !== beforeUndo) {
  throw new Error('Typie changeset snapshot restore did not reproduce the document');
}

const report = {
  commit: 'fbe5c4bf860d1717a66e66bea2374a2e39f0dd26',
  snapshotBytes: snapshot.byteLength,
  snapshotSha256: createHash('sha256').update(snapshot).digest('hex'),
  plainTextLength: restored.prose_text().length,
  annotatedSceneBreak: true,
  selectionAfterSceneBreak,
  imeAfterSceneBreak: imeAfterSceneBreak
    ? {
        selection: imeAfterSceneBreak.selection,
        composing: imeAfterSceneBreak.composing,
        windowStart: imeAfterSceneBreak.window_start,
      }
    : null,
  undoRedo: true,
  restored: true,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

restored.free();
editor.free();
host.free();
