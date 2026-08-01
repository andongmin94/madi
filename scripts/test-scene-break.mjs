import {
  MADI_SCENE_BREAK_SEMANTIC_ID,
  RECOVERY_SCENE_BREAK,
  assertSemanticSceneBreak,
  createEmptyEditor,
  createTypieHost,
  dispatch,
  extractSnapshot,
  insertSceneBreak,
  insertText,
  moveToDocumentEnd,
  restoreEditor,
} from "./lib/typie-test-runtime.mjs";

const host = await createTypieHost();
const editor = createEmptyEditor(host);

try {
  insertText(editor, "장면 앞 문장");
  insertSceneBreak(editor);
  moveToDocumentEnd(editor);
  insertText(editor, "장면 뒤 문장");

  const complete = editor.prose_text_annotated();
  if (
    !complete.startsWith("장면 앞 문장") ||
    !complete.endsWith("장면 뒤 문장") ||
    !complete.includes(RECOVERY_SCENE_BREAK)
  ) {
    throw new Error(`Scene break before/after input failed: ${complete}`);
  }
  assertSemanticSceneBreak(editor);

  dispatch(editor, [{ type: "history", op: { type: "undo" } }]);
  if (editor.prose_text_annotated() === complete) {
    throw new Error("Undo did not remove the post-divider input");
  }
  dispatch(editor, [{ type: "history", op: { type: "redo" } }]);
  if (editor.prose_text_annotated() !== complete) {
    throw new Error("Redo did not restore the post-divider input");
  }

  const markerStart = complete.indexOf("***");
  const sceneSelection = editor.prose_to_selection_annotated(
    markerStart,
    markerStart + 3,
  );
  if (!sceneSelection) {
    throw new Error("Typie could not address the annotated scene break");
  }
  const sceneNodeSelection = {
    anchor: {
      ...sceneSelection.head,
      offset: 0,
      affinity: "downstream",
    },
    head: {
      ...sceneSelection.head,
      offset: 1,
      affinity: "upstream",
    },
  };
  dispatch(editor, [
    {
      type: "selection",
      op: { type: "set", selection: sceneNodeSelection },
    },
  ]);
  dispatch(editor, [{ type: "deletion", op: { type: "selection" } }]);
  if (editor.prose_text_annotated().includes(RECOVERY_SCENE_BREAK)) {
    throw new Error(
      `Deleting the selected scene break did not remove it: ${JSON.stringify({
        sceneSelection: sceneNodeSelection,
        selected: editor.selection(),
        annotated: editor.prose_text_annotated(),
        macro: editor.inspect_selection_as_slice_macro(),
      })}`,
    );
  }
  dispatch(editor, [{ type: "history", op: { type: "undo" } }]);
  if (editor.prose_text_annotated() !== complete) {
    throw new Error("Undo did not restore the deleted scene break");
  }
  dispatch(editor, [{ type: "history", op: { type: "redo" } }]);
  if (editor.prose_text_annotated().includes(RECOVERY_SCENE_BREAK)) {
    throw new Error("Redo did not re-delete the scene break");
  }
  dispatch(editor, [{ type: "history", op: { type: "undo" } }]);
  assertSemanticSceneBreak(editor);

  dispatch(editor, [
    { type: "selection", op: { type: "expand", unit: "all" } },
  ]);
  const clipboard = editor.copy_selection();
  if (
    !clipboard ||
    !clipboard.html ||
    !/data-slice-v2/i.test(clipboard.html)
  ) {
    throw new Error(
      `Scene break clipboard payload is incomplete: ${JSON.stringify(
        clipboard,
      )}`,
    );
  }

  const pasted = createEmptyEditor(host);
  try {
    dispatch(pasted, [
      {
        type: "clipboard",
        op: {
          type: "paste",
          html: clipboard.html,
          text: clipboard.text,
        },
      },
    ]);
    if (pasted.prose_text_annotated() !== complete) {
      throw new Error("Rich clipboard paste changed scene break semantics");
    }
    assertSemanticSceneBreak(pasted);

    const snapshot = extractSnapshot(pasted);
    const restored = restoreEditor(host, snapshot);
    try {
      if (restored.prose_text_annotated() !== complete) {
        throw new Error("Snapshot restore changed scene break meaning");
      }
      assertSemanticSceneBreak(restored);
    } finally {
      restored.free();
    }
  } finally {
    pasted.free();
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        semanticId: MADI_SCENE_BREAK_SEMANTIC_ID,
        typieMapping: {
          node: "horizontal_rule",
          variant: "three_diamonds",
        },
        renderingContract: "***",
        recoveryMarker: "***",
        inputBeforeAfter: true,
        deleteUndoRedo: true,
        richClipboardPreservesSemanticNode: true,
        plainTextClipboardFallback:
          "Typie plain clipboard omits the divider; semantic type is not promised",
        snapshotRestore: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  editor.free();
  host.free();
}
