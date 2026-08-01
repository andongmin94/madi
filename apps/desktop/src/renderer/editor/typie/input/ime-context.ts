/*
 * Adapted from Typie
 * apps/website/src/lib/editor-ffi/input/ime-context.ts
 * commit fbe5c4bf860d1717a66e66bea2374a2e39f0dd26
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Ime } from "@madi/typie-runtime/browser";

export type ImeTextInput = HTMLTextAreaElement;

export const IME_CONTEXT_BEFORE_LIMIT = 64;
export const IME_CONTEXT_AFTER_LIMIT = 64;

export interface ImeRange {
  readonly start: number;
  readonly end: number;
}

export interface Utf16Selection {
  readonly start: number;
  readonly end: number;
}

export interface ImeContext {
  readonly text: string;
  readonly windowStart: number;
  readonly selection: ImeRange;
  readonly composing: ImeRange | null;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const codePoints = (text: string): string[] => [...text];

export const codePointLength = (text: string): number =>
  codePoints(text).length;

export const codePointSlice = (
  text: string,
  start: number,
  end: number
): string => codePoints(text).slice(start, end).join("");

export const normalizeImeContext = (ime: Ime): ImeContext => ({
  text: ime.text,
  windowStart: ime.window_start,
  selection: { start: ime.selection.start, end: ime.selection.end },
  composing: ime.composing
    ? { start: ime.composing.start, end: ime.composing.end }
    : null
});

export const flatOffsetToUtf16Index = (
  text: string,
  windowStart: number,
  flatOffset: number
): number => {
  const localOffset = clamp(
    flatOffset - windowStart,
    0,
    codePointLength(text)
  );
  let codePointOffset = 0;
  let utf16Index = 0;

  for (const character of text) {
    if (codePointOffset === localOffset) {
      break;
    }
    codePointOffset += 1;
    utf16Index += character.length;
  }
  return utf16Index;
};

export const utf16IndexToFlatOffset = (
  text: string,
  windowStart: number,
  utf16Index: number
): number => {
  const target = clamp(utf16Index, 0, text.length);
  let flatOffset = windowStart;
  let currentUtf16Index = 0;

  for (const character of text) {
    const nextUtf16Index = currentUtf16Index + character.length;
    if (nextUtf16Index > target) {
      break;
    }
    flatOffset += 1;
    currentUtf16Index = nextUtf16Index;
  }
  return flatOffset;
};

export const readInputUtf16Selection = (
  input: ImeTextInput
): Utf16Selection => {
  const start = input.selectionStart ?? 0;
  return {
    start,
    end: input.selectionEnd ?? start
  };
};

export const utf16SelectionToFlatRange = (
  text: string,
  windowStart: number,
  selection: Utf16Selection
): ImeRange => {
  const anchor = utf16IndexToFlatOffset(
    text,
    windowStart,
    selection.start
  );
  const head = utf16IndexToFlatOffset(text, windowStart, selection.end);
  return {
    start: Math.min(anchor, head),
    end: Math.max(anchor, head)
  };
};

export const syncInputElementToContext = (
  input: ImeTextInput,
  context: ImeContext
): void => {
  if (input.value !== context.text) {
    input.value = context.text;
  }

  const selectionStart = flatOffsetToUtf16Index(
    context.text,
    context.windowStart,
    context.selection.start
  );
  const selectionEnd = flatOffsetToUtf16Index(
    context.text,
    context.windowStart,
    context.selection.end
  );
  input.setSelectionRange(selectionStart, selectionEnd);
};

export const replaceContextRange = (
  context: ImeContext,
  range: ImeRange,
  text: string
): string => {
  const characters = [...context.text];
  const start = clamp(
    range.start - context.windowStart,
    0,
    characters.length
  );
  const end = clamp(
    range.end - context.windowStart,
    0,
    characters.length
  );
  return [
    ...characters.slice(0, start),
    text,
    ...characters.slice(end)
  ].join("");
};

export const rangesEqual = (
  left: ImeRange | null,
  right: ImeRange | null
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.start === right.start &&
    left.end === right.end);

export const contextWindowsOverlapEqual = (
  left: ImeContext,
  right: ImeContext
): boolean => {
  const leftEnd = left.windowStart + codePointLength(left.text);
  const rightEnd = right.windowStart + codePointLength(right.text);
  const overlapStart = Math.max(left.windowStart, right.windowStart);
  const overlapEnd = Math.min(leftEnd, rightEnd);
  if (overlapStart >= overlapEnd) {
    return false;
  }

  return (
    codePointSlice(
      left.text,
      overlapStart - left.windowStart,
      overlapEnd - left.windowStart
    ) ===
    codePointSlice(
      right.text,
      overlapStart - right.windowStart,
      overlapEnd - right.windowStart
    )
  );
};

export const canPreserveNativeInputOnEditorSync = (
  local: ImeContext,
  incoming: ImeContext
): boolean =>
  rangesEqual(local.selection, incoming.selection) &&
  rangesEqual(local.composing, incoming.composing) &&
  contextWindowsOverlapEqual(local, incoming);

export const updateContextFromInputElement = (
  context: ImeContext,
  input: ImeTextInput,
  composing: ImeRange | null = null
): ImeContext => {
  const text = input.value;
  const selection = utf16SelectionToFlatRange(
    text,
    context.windowStart,
    readInputUtf16Selection(input)
  );
  return {
    ...context,
    text,
    selection,
    composing
  };
};
