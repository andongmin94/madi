/*
 * Adapted from Typie
 * apps/website/src/lib/editor-ffi/input/ime-input-adapter.ts
 * commit fbe5c4bf860d1717a66e66bea2374a2e39f0dd26
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Message } from "@madi/typie-runtime/browser";
import {
  canPreserveNativeInputOnEditorSync,
  codePointLength,
  codePointSlice,
  flatOffsetToUtf16Index,
  readInputUtf16Selection,
  replaceContextRange,
  syncInputElementToContext,
  updateContextFromInputElement,
  utf16SelectionToFlatRange,
  type ImeContext,
  type ImeRange,
  type ImeTextInput
} from "./ime-context";
import {
  normalizeLineBreakBeforeInput,
  readDomComposingReplacement,
  readDomInputDiff,
  textInputMessage,
  type DomInputDiff
} from "./ime-normalizer";

interface ImeInputAdapterDependencies {
  readonly readContext: () => ImeContext | null;
  readonly enqueue: (messages: Message[]) => void;
}

interface ImeEditIntent {
  readonly inputType: "insertText";
  readonly text: string;
  readonly replacementCandidate: ImeRange;
}

interface ImeCompositionEdit {
  readonly target: ImeRange;
  readonly text: string;
}

const isCollapsedRange = (range: ImeRange): boolean =>
  range.start === range.end;

const readContextCompositionText = (
  context: ImeContext
): string | null => {
  if (!context.composing) {
    return null;
  }
  return codePointSlice(
    context.text,
    context.composing.start - context.windowStart,
    context.composing.end - context.windowStart
  );
};

const resolveActiveCompositionSyncContext = (
  local: ImeContext,
  incoming: ImeContext
): ImeContext | null => {
  const localText = readContextCompositionText(local);
  if (localText === null) {
    return null;
  }
  if (localText === readContextCompositionText(incoming)) {
    return incoming;
  }
  if (
    incoming.composing ||
    incoming.selection.start !== incoming.selection.end ||
    local.selection.start !== local.selection.end
  ) {
    return null;
  }

  const textLength = codePointLength(localText);
  if (textLength === 0) {
    return null;
  }
  const end = incoming.selection.end;
  const start = end - textLength;
  if (start < incoming.windowStart) {
    return null;
  }
  const incomingText = codePointSlice(
    incoming.text,
    start - incoming.windowStart,
    end - incoming.windowStart
  );
  return incomingText === localText
    ? { ...incoming, composing: { start, end } }
    : null;
};

const rebaseNativeCompositionContext = (
  local: ImeContext,
  incoming: ImeContext,
  input: ImeTextInput
): ImeContext | null => {
  if (!local.composing) {
    return null;
  }
  const synchronized = resolveActiveCompositionSyncContext(local, incoming);
  if (!synchronized?.composing) {
    return null;
  }
  const compositionText = readContextCompositionText(local);
  if (compositionText === null) {
    return null;
  }

  const localStart = local.composing.start - local.windowStart;
  const compositionLength = codePointLength(compositionText);
  if (
    localStart < 0 ||
    localStart + compositionLength > codePointLength(input.value) ||
    codePointSlice(
      input.value,
      localStart,
      localStart + compositionLength
    ) !== compositionText
  ) {
    return null;
  }

  const windowStart = synchronized.composing.start - localStart;
  const composing = {
    start: synchronized.composing.start,
    end: synchronized.composing.start + compositionLength
  };
  return {
    text: input.value,
    windowStart,
    selection: utf16SelectionToFlatRange(
      input.value,
      windowStart,
      readInputUtf16Selection(input)
    ),
    composing
  };
};

const readDuplicateCommittedPreeditTarget = (
  context: ImeContext,
  input: ImeTextInput,
  text: string | null
): ImeRange | null => {
  if (
    !context.composing ||
    text === null ||
    readContextCompositionText(context) !== text
  ) {
    return null;
  }
  const selection = utf16SelectionToFlatRange(
    context.text,
    context.windowStart,
    readInputUtf16Selection(input)
  );
  return selection.start === selection.end &&
    selection.start === context.composing.end
    ? selection
    : null;
};

const isDuplicateCommittedPreeditDiff = (
  context: ImeContext,
  difference: DomInputDiff
): boolean =>
  !!context.composing &&
  difference.start === context.composing.end &&
  difference.end === context.composing.end &&
  readContextCompositionText(context) === difference.insertedText;

export class ImeInputAdapter {
  private context: ImeContext | null = null;
  private pendingEditIntent: ImeEditIntent | null = null;
  private pendingCompositionText: string | null = null;
  private pendingCompositionTarget: ImeRange | null = null;
  private compositionActive = false;
  private commitPendingText: string | null = null;
  private resyncInProgress = false;

  public constructor(
    private readonly dependencies: ImeInputAdapterDependencies
  ) {}

  public resetForResync(input: ImeTextInput | null): void {
    const wasComposing = this.compositionActive;
    this.resyncInProgress = true;
    try {
      this.context = null;
      this.pendingEditIntent = null;
      this.pendingCompositionText = null;
      this.pendingCompositionTarget = null;
      this.compositionActive = false;
      this.commitPendingText = null;
      if (!input) {
        return;
      }
      this.syncFromEditor(input);
      if (wasComposing && document.activeElement === input) {
        input.blur();
        input.focus({ preventScroll: true });
      }
    } finally {
      this.resyncInProgress = false;
    }
  }

  public syncFromEditor(input: ImeTextInput): void {
    const incoming = this.dependencies.readContext();
    if (!incoming) {
      return;
    }
    if (this.compositionActive) {
      if (!this.context) {
        this.context = incoming;
        return;
      }
      if (canPreserveNativeInputOnEditorSync(this.context, incoming)) {
        return;
      }
      const rebased = rebaseNativeCompositionContext(
        this.context,
        incoming,
        input
      );
      if (rebased) {
        this.context = rebased;
      }
      return;
    }
    if (
      this.context &&
      canPreserveNativeInputOnEditorSync(this.context, incoming)
    ) {
      return;
    }
    this.context = incoming;
    syncInputElementToContext(input, incoming);
  }

  public handleBeforeInput(
    event: InputEvent & { readonly currentTarget: ImeTextInput }
  ): void {
    if (this.resyncInProgress) {
      return;
    }
    if (
      this.commitPendingText !== null &&
      (event.inputType === "insertText" ||
        event.inputType === "insertCompositionText") &&
      event.data === this.commitPendingText
    ) {
      this.commitPendingText = null;
      this.pendingEditIntent = null;
      this.pendingCompositionText = null;
      this.pendingCompositionTarget = null;
      event.preventDefault();
      return;
    }

    const context = this.currentContext(event.currentTarget);
    const lineBreakMessages = normalizeLineBreakBeforeInput(event.inputType);
    if (lineBreakMessages.length > 0) {
      this.pendingEditIntent = null;
      event.preventDefault();
      this.dependencies.enqueue(lineBreakMessages);
      return;
    }

    const duplicateTarget =
      this.compositionActive &&
      this.pendingCompositionText === null &&
      event.inputType === "insertText" &&
      context
        ? readDuplicateCommittedPreeditTarget(
            context,
            event.currentTarget,
            event.data
          )
        : null;
    if (duplicateTarget) {
      this.pendingEditIntent = null;
      this.pendingCompositionTarget = duplicateTarget;
      event.preventDefault();
      return;
    }

    if (
      this.compositionActive &&
      event.inputType === "insertCompositionText"
    ) {
      this.pendingCompositionText = event.data;
      this.pendingCompositionTarget ??=
        context && !context.composing
          ? utf16SelectionToFlatRange(
              context.text,
              context.windowStart,
              readInputUtf16Selection(event.currentTarget)
            )
          : null;
    }

    this.pendingEditIntent =
      !this.compositionActive &&
      context &&
      event.inputType === "insertText" &&
      event.data !== null
        ? {
            inputType: event.inputType,
            text: event.data,
            replacementCandidate: utf16SelectionToFlatRange(
              context.text,
              context.windowStart,
              readInputUtf16Selection(event.currentTarget)
            )
          }
        : null;
  }

  public handleInput(
    event: Event & { readonly currentTarget: ImeTextInput }
  ): void {
    if (this.resyncInProgress) {
      return;
    }
    const context = this.currentContext(event.currentTarget, false);
    if (!context) {
      return;
    }
    const difference = readDomInputDiff(
      context,
      event.currentTarget.value
    );
    if (!difference) {
      this.handleInputWithoutDiff(context, event.currentTarget);
      return;
    }
    if (this.compositionActive) {
      this.handleCompositionInputWithDiff(
        context,
        event.currentTarget,
        difference
      );
      return;
    }
    this.handleTextInputWithDiff(
      context,
      event.currentTarget,
      difference
    );
  }

  public handleCompositionStart(
    event: CompositionEvent & { readonly currentTarget: ImeTextInput }
  ): void {
    if (this.resyncInProgress) {
      return;
    }
    this.clearCommitPending();
    const wasActive = this.compositionActive;
    const pendingTarget = this.pendingCompositionTarget;
    this.pendingCompositionText = null;
    this.compositionActive = true;
    const context = this.currentContext(event.currentTarget);
    this.pendingCompositionTarget =
      pendingTarget ??
      (context?.composing && !wasActive
        ? {
            start: context.composing.end,
            end: context.composing.end
          }
        : null);
  }

  public handleCompositionUpdate(event: CompositionEvent): void {
    if (!this.resyncInProgress) {
      this.pendingCompositionText = event.data;
    }
  }

  public handleCompositionEnd(): boolean {
    if (this.resyncInProgress) {
      return false;
    }
    this.compositionActive = false;
    this.pendingCompositionText = null;
    this.pendingCompositionTarget = null;
    const committedText = this.context
      ? readContextCompositionText(this.context)
      : null;
    if (this.context?.composing) {
      this.context = {
        ...this.context,
        selection: {
          start: this.context.composing.end,
          end: this.context.composing.end
        },
        composing: null
      };
    }
    if (committedText !== null) {
      this.dependencies.enqueue([
        { type: "text_input", ops: [{ type: "commit_as_is" }] }
      ]);
      this.setCommitPending(committedText);
      return true;
    }
    return false;
  }

  private handleInputWithoutDiff(
    context: ImeContext,
    input: ImeTextInput
  ): void {
    const intent = this.pendingEditIntent;
    this.pendingEditIntent = null;

    if (this.compositionActive) {
      const pendingTarget = this.pendingCompositionTarget;
      this.pendingCompositionTarget = null;
      const text = this.pendingCompositionText;
      this.pendingCompositionText = null;
      const target = pendingTarget ?? context.composing;
      if (target && text !== null) {
        this.applyCompositionEdit(context, input, { target, text });
        return;
      }
    }

    if (intent && !isCollapsedRange(intent.replacementCandidate)) {
      this.dependencies.enqueue(
        textInputMessage([
          {
            type: "set_selection",
            start: intent.replacementCandidate.start,
            end: intent.replacementCandidate.end
          },
          { type: "replace_selection", text: intent.text }
        ])
      );
    }
    this.context = updateContextFromInputElement(
      context,
      input,
      context.composing
    );
  }

  private handleCompositionInputWithDiff(
    context: ImeContext,
    input: ImeTextInput,
    difference: DomInputDiff
  ): void {
    if (
      this.pendingCompositionText === null &&
      isDuplicateCommittedPreeditDiff(context, difference)
    ) {
      if (input.value !== context.text) {
        input.value = context.text;
      }
      const selection = flatOffsetToUtf16Index(
        context.text,
        context.windowStart,
        context.selection.end
      );
      input.setSelectionRange(selection, selection);
      this.context = context;
      return;
    }

    const pendingTarget = this.pendingCompositionTarget;
    this.pendingCompositionTarget = null;
    const replacement = readDomComposingReplacement(
      context,
      input.value,
      difference
    );
    if (pendingTarget) {
      replacement.targetStart = pendingTarget.start;
      replacement.targetEnd = pendingTarget.end;
    }
    const edit = this.compositionEdit(context, replacement);
    this.pendingCompositionText = null;
    this.applyCompositionEdit(context, input, edit);
  }

  private handleTextInputWithDiff(
    context: ImeContext,
    input: ImeTextInput,
    difference: DomInputDiff
  ): void {
    const intent = this.pendingEditIntent;
    this.pendingEditIntent = null;
    this.pendingCompositionTarget = null;
    const replacement =
      intent &&
      intent.text === difference.insertedText &&
      difference.start === difference.end &&
      isCollapsedRange(intent.replacementCandidate)
        ? intent.replacementCandidate
        : { start: difference.start, end: difference.end };
    const segments = difference.insertedText
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .split("\n");
    const messages = textInputMessage([
      {
        type: "set_selection",
        start: replacement.start,
        end: replacement.end
      },
      { type: "replace_selection", text: segments[0] ?? "" }
    ]);
    for (const segment of segments.slice(1)) {
      messages.push({ type: "key", event: { key: "enter" } });
      if (segment.length > 0) {
        messages.push(
          ...textInputMessage([
            { type: "replace_selection", text: segment }
          ])
        );
      }
    }
    this.dependencies.enqueue(messages);
    this.context = updateContextFromInputElement(context, input, null);
  }

  private applyCompositionEdit(
    context: ImeContext,
    input: ImeTextInput,
    edit: ImeCompositionEdit
  ): void {
    const composing = {
      start: edit.target.start,
      end: edit.target.start + codePointLength(edit.text)
    };
    this.dependencies.enqueue(
      textInputMessage([
        {
          type: "set_composition",
          start: edit.target.start,
          end: edit.target.end
        },
        { type: "compose", text: edit.text }
      ])
    );

    const nextText = replaceContextRange(context, edit.target, edit.text);
    if (input.value !== nextText) {
      input.value = nextText;
    }
    const selection = flatOffsetToUtf16Index(
      nextText,
      context.windowStart,
      composing.end
    );
    input.setSelectionRange(selection, selection);
    this.context = updateContextFromInputElement(
      context,
      input,
      composing
    );
  }

  private currentContext(
    input: ImeTextInput,
    syncDom = true
  ): ImeContext | null {
    if (this.context) {
      return this.context;
    }
    const context = this.dependencies.readContext();
    if (!context) {
      return null;
    }
    this.context = context;
    if (syncDom) {
      syncInputElementToContext(input, context);
    }
    return context;
  }

  private clearCommitPending(): void {
    this.commitPendingText = null;
  }

  private setCommitPending(text: string): void {
    this.commitPendingText = text;
    window.setTimeout(() => this.clearCommitPending(), 0);
  }

  private compositionEdit(
    context: ImeContext,
    replacement: {
      readonly targetStart: number;
      readonly targetEnd: number;
      readonly text: string;
    }
  ): ImeCompositionEdit {
    const target = {
      start: replacement.targetStart,
      end: replacement.targetEnd
    };
    const pending = this.pendingCompositionText;
    if (!pending || !context.composing) {
      return { target, text: pending ?? replacement.text };
    }

    const current = readContextCompositionText(context) ?? "";
    const targetsCurrent =
      target.start === context.composing.start &&
      target.end === context.composing.end;
    if (
      replacement.text === `${current}${pending}` &&
      current.endsWith(pending) &&
      targetsCurrent
    ) {
      return { target, text: replacement.text };
    }
    return { target, text: pending };
  }
}
