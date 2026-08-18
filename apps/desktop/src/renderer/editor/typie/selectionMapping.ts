import type {
  Editor,
  Position,
  Selection
} from "@madi/typie-runtime/browser";

import type { EditorTextSelection } from "../MadiEditorAdapter";

const MAX_SELECTION_CANDIDATES = 10_000;
const MAX_SELECTION_SCALARS = 20_000;

type SelectionMappingEditor = Pick<
  Editor,
  | "selection"
  | "copy_selection"
  | "prose_text_annotated"
  | "prose_to_selection_annotated"
>;

interface ExactMappedSelection {
  readonly selectedText: string;
  readonly selection: Selection;
  readonly start: number;
  readonly end: number;
}

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

function isSceneBreakFallback(value: string): boolean {
  const normalized = value.trim();
  return normalized === "***" || normalized === "* * *";
}

function findExactMappedSelection(
  editor: SelectionMappingEditor
): ExactMappedSelection | null {
  const selection = editor.selection();
  const clipboard = editor.copy_selection();
  if (
    !selection ||
    !clipboard ||
    clipboard.text.length === 0 ||
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
    if (
      start !== undefined &&
      end !== undefined &&
      end > start &&
      end - start <= MAX_SELECTION_SCALARS
    ) {
      const candidate = editor.prose_to_selection_annotated(start, end);
      if (candidate && sameSelection(candidate, selection)) {
        return {
          selectedText,
          selection,
          start,
          end
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

/**
 * Maps the current same-node Typie selection to exact annotated-recovery
 * Unicode-scalar offsets. Equal text elsewhere in the document cannot be
 * selected accidentally because every candidate is round-tripped through the
 * engine and compared with the live selection.
 */
export function readMappedTextSelection(
  editor: SelectionMappingEditor
): EditorTextSelection | null {
  const mapped = findExactMappedSelection(editor);
  if (
    !mapped ||
    mapped.selection.anchor.node !== mapped.selection.head.node ||
    isSceneBreakFallback(mapped.selectedText)
  ) {
    return null;
  }
  return {
    text: mapped.selectedText,
    start: mapped.start,
    end: mapped.end,
    blockKey: mapped.selection.anchor.node
  };
}
