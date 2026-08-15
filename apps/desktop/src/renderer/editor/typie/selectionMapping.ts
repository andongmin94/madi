import type {
  Editor,
  Position,
  Selection
} from "@madi/typie-runtime/browser";

import type {
  EditorStructuredSelection,
  EditorStructuredSelectionSegment,
  EditorTextSelection
} from "../MadiEditorAdapter";

const MAX_SELECTION_CANDIDATES = 10_000;
const MAX_STRUCTURED_SELECTION_SCALARS = 20_000;
const MAX_STRUCTURED_SELECTION_SEGMENTS = 64;

type SelectionMappingEditor = Pick<
  Editor,
  | "selection"
  | "copy_selection"
  | "prose_text_annotated"
  | "prose_to_selection_annotated"
>;

interface ExactMappedSelection {
  readonly source: string;
  readonly sourceCharacters: readonly string[];
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

function isStructuralSeparator(character: string): boolean {
  return /[\r\n\u2028\u2029]/u.test(character);
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
  const sourceCharacters = Array.from(source);
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
      end - start <= MAX_STRUCTURED_SELECTION_SCALARS
    ) {
      const candidate = editor.prose_to_selection_annotated(start, end);
      if (candidate && sameSelection(candidate, selection)) {
        return {
          source,
          sourceCharacters,
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

function appendSegment(
  segments: EditorStructuredSelectionSegment[],
  segment: EditorStructuredSelectionSegment | null
): void {
  if (!segment) {
    return;
  }
  if (!segment.text || isSceneBreakFallback(segment.text)) {
    throw new Error("The selection contains a semantic scene-break boundary");
  }
  segments.push(segment);
  if (segments.length > MAX_STRUCTURED_SELECTION_SEGMENTS) {
    throw new Error("The selection contains too many semantic text segments");
  }
}

/**
 * Maps a bounded live Typie selection to exact annotated-recovery scalar
 * offsets and splits it whenever text ownership or structural separators
 * change. Every visible scalar is independently round-tripped through Typie;
 * equal text at another document position cannot be selected accidentally.
 */
export function readMappedStructuredSelection(
  editor: SelectionMappingEditor
): EditorStructuredSelection | null {
  const mapped = findExactMappedSelection(editor);
  if (!mapped) {
    return null;
  }

  const segments: EditorStructuredSelectionSegment[] = [];
  let current: EditorStructuredSelectionSegment | null = null;
  try {
    for (let offset = mapped.start; offset < mapped.end; offset += 1) {
      const character = mapped.sourceCharacters[offset];
      if (character === undefined) {
        return null;
      }
      if (isStructuralSeparator(character)) {
        appendSegment(segments, current);
        current = null;
        continue;
      }

      const scalarSelection = editor.prose_to_selection_annotated(
        offset,
        offset + 1
      );
      if (
        !scalarSelection ||
        samePosition(scalarSelection.anchor, scalarSelection.head) ||
        scalarSelection.anchor.node !== scalarSelection.head.node
      ) {
        return null;
      }
      const nodeKey = scalarSelection.anchor.node;
      if (
        current &&
        current.nodeKey === nodeKey &&
        current.end === offset
      ) {
        current = {
          ...current,
          text: `${current.text}${character}`,
          end: offset + 1
        };
      } else {
        appendSegment(segments, current);
        current = {
          text: character,
          start: offset,
          end: offset + 1,
          nodeKey
        };
      }
    }
    appendSegment(segments, current);
  } catch {
    return null;
  }

  if (
    segments.length === 0 ||
    segments[0]!.start !== mapped.start ||
    segments.at(-1)!.end !== mapped.end
  ) {
    return null;
  }

  const separators = segments.slice(1).map((segment, index) =>
    mapped.sourceCharacters
      .slice(segments[index]!.end, segment.start)
      .join("")
  );
  const reconstructed = segments.reduce(
    (value, segment, index) =>
      `${value}${index === 0 ? "" : separators[index - 1]}${segment.text}`,
    ""
  );
  if (reconstructed !== mapped.selectedText) {
    return null;
  }

  return {
    text: mapped.selectedText,
    start: mapped.start,
    end: mapped.end,
    segments,
    separators
  };
}

/**
 * Same-node selection contract used by the narrow one-transaction rewrite
 * workflow. It deliberately avoids the per-scalar structured mapping pass.
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
