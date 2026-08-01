/*
 * Adapted from Typie
 * apps/website/src/lib/editor-ffi/input/ime-normalizer.ts
 * commit fbe5c4bf860d1717a66e66bea2374a2e39f0dd26
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type {
  FlatImeOp,
  Message
} from "@madi/typie-runtime/browser";
import {
  codePointLength,
  codePoints,
  codePointSlice,
  type ImeContext
} from "./ime-context";

export interface DomInputDiff {
  readonly start: number;
  readonly end: number;
  readonly insertedText: string;
}

export interface DomComposingReplacement {
  targetStart: number;
  targetEnd: number;
  readonly nextStart: number;
  readonly nextEnd: number;
  readonly text: string;
}

export const textInputMessage = (operations: FlatImeOp[]): Message[] =>
  operations.length === 0
    ? []
    : [{ type: "text_input", ops: operations }];

export const readDomInputDiff = (
  context: ImeContext,
  nextText: string
): DomInputDiff | null => {
  if (context.text === nextText) {
    return null;
  }

  const previousCharacters = codePoints(context.text);
  const nextCharacters = codePoints(nextText);
  let prefix = 0;
  while (
    prefix < previousCharacters.length &&
    prefix < nextCharacters.length &&
    previousCharacters[prefix] === nextCharacters[prefix]
  ) {
    prefix += 1;
  }

  let previousSuffix = previousCharacters.length;
  let nextSuffix = nextCharacters.length;
  while (
    previousSuffix > prefix &&
    nextSuffix > prefix &&
    previousCharacters[previousSuffix - 1] ===
      nextCharacters[nextSuffix - 1]
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }

  return {
    start: context.windowStart + prefix,
    end: context.windowStart + previousSuffix,
    insertedText: nextCharacters.slice(prefix, nextSuffix).join("")
  };
};

export const readDomComposingReplacement = (
  context: ImeContext,
  nextText: string,
  difference: DomInputDiff
): DomComposingReplacement => {
  const previous = context.composing ?? {
    start: difference.start,
    end: difference.end
  };
  const removedLength = difference.end - difference.start;
  const insertedLength = codePointLength(difference.insertedText);
  const nextStart = previous.start;
  const nextEnd = Math.max(
    previous.start,
    previous.end + insertedLength - removedLength
  );
  const localStart = Math.max(0, nextStart - context.windowStart);
  const localEnd = Math.max(localStart, nextEnd - context.windowStart);

  return {
    targetStart: previous.start,
    targetEnd: previous.end,
    nextStart,
    nextEnd,
    text: codePointSlice(nextText, localStart, localEnd)
  };
};

export const normalizeLineBreakBeforeInput = (
  inputType: string
): Message[] =>
  inputType === "insertLineBreak" || inputType === "insertParagraph"
    ? [{ type: "key", event: { key: "enter" } }]
    : [];
