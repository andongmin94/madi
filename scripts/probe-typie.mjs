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

const sameBytes = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const countSemanticSceneBreaks = (entry) => {
  const own =
    entry.node.type === 'horizontal_rule' && entry.node.variant === 'three_diamonds' ? 1 : 0;
  return own + entry.children.reduce((total, child) => total + countSemanticSceneBreaks(child), 0);
};

const textModifierRuns = (entry) => {
  const own = entry.node.type === 'text' ? [entry.modifiers] : [];
  return own.concat(entry.children.flatMap(textModifierRuns));
};

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

const replacementEditor = host.create_editor_from_doc(emptyDocument, viewport);
initialize(replacementEditor);
const replacementBefore = '가😀나 가😀나';
const replacementAfter = '가달빛나 가별무리나';
dispatch(replacementEditor, [
  { type: 'insertion', op: { type: 'text', text: replacementBefore } },
]);
dispatch(replacementEditor, [
  { type: 'modifier', op: { type: 'toggle', modifier_type: 'bold' } },
]);

const selectionBeforeReplacement = replacementEditor.selection();
const pendingBoldBeforeReplacement = replacementEditor.modifier_state()?.bold;
if (!selectionBeforeReplacement || pendingBoldBeforeReplacement?.type !== 'uniform') {
  throw new Error('Typie replacement probe could not establish a caret with pending bold');
}

const replacementResult = dispatch(replacementEditor, [
  {
    type: 'tracked_range',
    op: {
      type: 'replace_many_from_prose_annotated',
      expected_text: replacementBefore,
      replacements: [
        {
          id: 'emoji-second',
          start: 5,
          end: 6,
          expected_text: '😀',
          replacement: '별무리',
        },
        {
          id: 'emoji-first',
          start: 1,
          end: 2,
          expected_text: '😀',
          replacement: '달빛',
        },
      ],
    },
  },
]);

const replacedEvents = replacementResult.events.filter(
  (event) => event.type === 'tracked_range_replace_result',
);
if (
  replacedEvents.length !== 2 ||
  replacedEvents.some((event) => event.outcome !== 'replaced') ||
  new Set(replacedEvents.map((event) => event.id)).size !== 2
) {
  throw new Error(`Typie semantic replacement outcomes were incomplete: ${JSON.stringify(replacedEvents)}`);
}
if (replacementEditor.prose_text_annotated() !== replacementAfter) {
  throw new Error('Typie semantic replacement did not use Unicode-scalar offsets');
}

const selectionAfterReplacement = replacementEditor.selection();
const pendingBoldAfterReplacement = replacementEditor.modifier_state()?.bold;
const expectedCaretOffset = Array.from(replacementAfter).length;
if (
  !selectionAfterReplacement ||
  selectionAfterReplacement.anchor.node !== selectionBeforeReplacement.anchor.node ||
  selectionAfterReplacement.head.node !== selectionBeforeReplacement.head.node ||
  selectionAfterReplacement.anchor.offset !== expectedCaretOffset ||
  selectionAfterReplacement.head.offset !== expectedCaretOffset ||
  selectionAfterReplacement.anchor.affinity !== selectionBeforeReplacement.anchor.affinity ||
  selectionAfterReplacement.head.affinity !== selectionBeforeReplacement.head.affinity
) {
  throw new Error(
    `Typie semantic replacement did not preserve the stable caret: ${JSON.stringify(selectionAfterReplacement)}`,
  );
}
if (pendingBoldAfterReplacement?.type !== 'uniform') {
  throw new Error('Typie semantic replacement did not preserve pending modifiers');
}

const replacedDocument = replacementEditor.materialize_at(replacementEditor.current_heads(), []);
if (textModifierRuns(replacedDocument.root).some((modifiers) => modifiers.bold !== undefined)) {
  throw new Error('Typie pending bold leaked into semantic replacement text');
}

dispatch(replacementEditor, [{ type: 'history', op: { type: 'undo' } }]);
const replacementAfterSingleUndo = replacementEditor.prose_text_annotated();
const selectionAfterSingleUndo = replacementEditor.selection();
if (
  replacementAfterSingleUndo !== replacementBefore ||
  JSON.stringify(selectionAfterSingleUndo) !== JSON.stringify(selectionBeforeReplacement)
) {
  throw new Error('Typie semantic replacement was not reverted by exactly one Undo');
}
dispatch(replacementEditor, [{ type: 'history', op: { type: 'redo' } }]);
const replacementAfterSingleRedo = replacementEditor.prose_text_annotated();
const selectionAfterSingleRedo = replacementEditor.selection();
if (
  replacementAfterSingleRedo !== replacementAfter ||
  JSON.stringify(selectionAfterSingleRedo) !== JSON.stringify(selectionAfterReplacement)
) {
  throw new Error('Typie semantic replacement was not restored by exactly one Redo');
}

const rejectionEditor = host.create_editor_from_doc(emptyDocument, viewport);
initialize(rejectionEditor);
dispatch(rejectionEditor, [{ type: 'insertion', op: { type: 'text', text: '앞' } }]);
dispatch(rejectionEditor, [
  {
    type: 'insertion',
    op: {
      type: 'fragment',
      fragment: { node: { type: 'horizontal_rule', variant: 'three_diamonds' } },
    },
  },
]);
dispatch(rejectionEditor, [
  {
    type: 'navigation',
    op: {
      type: 'move',
      movement: { type: 'document', direction: 'forward' },
      extend: false,
    },
  },
]);
dispatch(rejectionEditor, [{ type: 'insertion', op: { type: 'text', text: '뒤' } }]);

const rejectionTextBefore = rejectionEditor.prose_text_annotated();
const rejectionHeadsBefore = rejectionEditor.current_heads();
const rejectionDocumentBefore = rejectionEditor.materialize_at(rejectionHeadsBefore, []);
const rejectionChars = Array.from(rejectionTextBefore);
const markerStart = rejectionChars.findIndex(
  (_, index) => rejectionChars.slice(index, index + 3).join('') === '***',
);
if (markerStart < 0 || countSemanticSceneBreaks(rejectionDocumentBefore.root) !== 1) {
  throw new Error('Typie replacement rejection probe could not establish a semantic scene break');
}

const rejectionResult = dispatch(rejectionEditor, [
  {
    type: 'tracked_range',
    op: {
      type: 'replace_many_from_prose_annotated',
      expected_text: rejectionTextBefore,
      replacements: [
        {
          id: 'semantic-scene-break',
          start: markerStart,
          end: markerStart + 3,
          expected_text: '***',
          replacement: '삭제',
        },
      ],
    },
  },
]);
const invalidEvents = rejectionResult.events.filter(
  (event) => event.type === 'tracked_range_replace_result',
);
const rejectionHeadsAfter = rejectionEditor.current_heads();
const rejectionDocumentAfter = rejectionEditor.materialize_at(rejectionHeadsAfter, []);
if (
  invalidEvents.length !== 1 ||
  invalidEvents[0].id !== 'semantic-scene-break' ||
  invalidEvents[0].outcome !== 'invalid' ||
  rejectionEditor.prose_text_annotated() !== rejectionTextBefore ||
  !sameBytes(rejectionHeadsBefore, rejectionHeadsAfter) ||
  countSemanticSceneBreaks(rejectionDocumentAfter.root) !== 1
) {
  throw new Error(`Typie semantic scene-break rejection was unsafe: ${JSON.stringify(invalidEvents)}`);
}

// A second request proves that an expected Invalid result does not fail-stop the editor.
dispatch(rejectionEditor, [
  { type: 'selection', op: { type: 'set_flat', start: 1, end: 1 } },
]);
if (rejectionEditor.prose_text_annotated() !== rejectionTextBefore) {
  throw new Error('Typie editor was not usable after a nonfatal semantic replacement rejection');
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
  semanticReplacement: {
    unicodeScalarOffsets: true,
    replacedEvents: replacedEvents.length,
    oneUndoRedo: true,
    stableSelection: true,
    pendingModifiersPreserved: true,
    pendingModifierBleed: false,
    semanticSceneBreakRejectedNonfatally: true,
    editorUsableAfterInvalid: true,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

restored.free();
rejectionEditor.free();
replacementEditor.free();
editor.free();
host.free();
