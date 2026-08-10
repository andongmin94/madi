import type {
  Editor,
  Position,
  Selection
} from "@madi/typie-runtime/browser";

import type { EditorTextSelection } from "../MadiEditorAdapter";

const MAX_SELECTION_CANDIDATES = 10_000;

type SelectionMappingEditor = Pick<
  Editor,
  | "selection"
  | "copy_selection"
  | "prose_text_annotated"
  | "prose_to_selection_annotated"
>;

function samePosition(left: Position, right: Position): boolean {
  return left.node === right.node && left.offset === right.offset;
}

function sameSelection(left: Selection, right: Selection): boolean {
  return (
    (samePosition(left.anchor, right.anchor) &&
      samePosition(left.head, right.head)) ||
    (samePosition(left.anchor, right.head) &&
      samePosition(left.head, right.anchor))
  );
}

function scalarBoundaries(source: string): ReadonlyMap<number, number> {
  const boundaries = new Map<number, number>();
  let codeUnitOffset = 0;
  let scalarOffset = 0;
  boundaries.set(0, 0);
  for (const character of source) {
    codeUnitOffset += character.length;
    scalarOffset += 1;
    boundaries.set(codeUnitOffset, scalarOffset);
  }
  return boundaries;
}

/**
 * Maps the live Typie selection back to the exact annotated recovery-text
 * scalar range. Text equality alone is insufficient because the same sentence
 * can appear repeatedly; every candidate is remapped through Typie and compared
 * with the actual CRDT selection endpoints.
 */
export function readMappedTextSelection(
  editor: SelectionMappingEditor
): EditorTextSelection | null {
  const selection = editor.selection();
  const clipboard = editor.copy_selection();
  if (
    !selection ||
    !clipboard ||
    clipboard.text.length === 0 ||
    selection.anchor.node !== selection.head.node ||
    samePosition(selection.anchor, selection.head)
  ) {
    return null;
  }

  const source = editor.prose_text_annotated();
  const selectedText = clipboard.text;
  const boundaries = scalarBoundaries(source);
  let nextCodeUnit = 0;
  let candidates = 0;

  for (;;) {
    const startCodeUnit = source.indexOf(selectedText, nextCodeUnit);
    if (startCodeUnit < 0) {
      return null;
    }
    const endCodeUnit = startCodeUnit + selectedText.length;
    const start = boundaries.get(startCodeUnit);
    const end = boundaries.get(endCodeUnit);
    if (start !== undefined && end !== undefined) {
      const candidate = editor.prose_to_selection_annotated(start, end);
      if (candidate && sameSelection(candidate, selection)) {
        return {
          text: selectedText,
          start,
          end,
          blockKey: selection.anchor.node
        };
      }
    }

    candidates += 1;
    if (candidates >= MAX_SELECTION_CANDIDATES) {
      return null;
    }
    nextCodeUnit = startCodeUnit + 1;
  }
}
