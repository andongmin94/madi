import {
  createInstance,
  type Editor,
  type EditorHost,
  type InputModifiers,
  type Message,
  type Movement,
  type PlainDoc,
  type PlainNodeEntry,
  type TickResult
} from "@madi/typie-runtime/browser";
import buildInfo from "@madi/typie-runtime/build-info";
import wasmUrl from "@madi/typie-runtime/browser/wasm?url";
import icuUrl from "@madi/typie-runtime/browser/icu.zst?url";
import fontBaseUrl from "@madi/typie-runtime/browser/font-base.zst?url";
import fontManifestUrl from "@madi/typie-runtime/browser/font-manifest.zst?url";
import fontChunkUrl from "@madi/typie-runtime/browser/font-chunk-0.zst?url";
import type {
  EditorReplacementDocument,
  EditorTextReplacement
} from "../MadiEditorAdapter";
import type {
  TypieEnginePort,
  TypieTransactionEvent
} from "./TypieEditorAdapter";
import {
  IME_CONTEXT_AFTER_LIMIT,
  IME_CONTEXT_BEFORE_LIMIT,
  normalizeImeContext
} from "./input/ime-context";
import { ImeInputAdapter } from "./input/ime-input-adapter";
import { TYPIE_SCENE_BREAK_MAPPING } from "./sceneBreakMapping";

const EMPTY_DOCUMENT = {
  root: {
    node: {
      type: "root",
      layout_mode: {
        type: "paginated",
        page_width: 760,
        page_height: 1_075,
        page_margin_top: 72,
        page_margin_bottom: 72,
        page_margin_left: 80,
        page_margin_right: 80
      }
    },
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
} as unknown as PlainDoc;

type TransactionOrigin = TypieTransactionEvent["origin"];

let hostPromise: Promise<EditorHost> | undefined;

function countSemanticSceneBreaks(entry: PlainNodeEntry): number {
  const own =
    entry.node.type === TYPIE_SCENE_BREAK_MAPPING.nodeType &&
    entry.node.variant === TYPIE_SCENE_BREAK_MAPPING.variant
      ? 1
      : 0;
  return (
    own +
    entry.children.reduce(
      (total, child) => total + countSemanticSceneBreaks(child),
      0
    )
  );
}

function semanticSceneBreakCount(editor: Editor): number {
  const document = editor.materialize_at(editor.current_heads(), []);
  return countSemanticSceneBreaks(document.root);
}

function semanticDocumentFingerprint(entry: PlainNodeEntry): string {
  if (entry.node.type === "text") {
    return "";
  }
  return JSON.stringify({
    node: entry.node,
    modifiers: entry.modifiers,
    carry: entry.carry ?? [],
    children: entry.children
      .map(semanticDocumentFingerprint)
      .filter((child) => child !== "")
  });
}

async function fetchBytes(
  url: string,
  label: string
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Typie ${label} asset could not be loaded`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function loadHost(): Promise<EditorHost> {
  hostPromise ??= (async () => {
    const [wasmBytes, icuData, fontBase, fontManifest, fontChunk] =
      await Promise.all([
        fetchBytes(wasmUrl, "WASM"),
        fetchBytes(icuUrl, "ICU"),
        fetchBytes(fontBaseUrl, "font base"),
        fetchBytes(fontManifestUrl, "font manifest"),
        fetchBytes(fontChunkUrl, "font chunk")
      ]);
    const wasmModule = await WebAssembly.compile(wasmBytes);
    const { EditorHost } = await createInstance(wasmModule);
    const host = EditorHost.create(icuData);

    host.set_theme_variant("light-white")?.free();
    host
      .set_fonts([
        {
          name: "Pretendard",
          source: "DEFAULT",
          weights: [
            {
              value: 400,
              hash: buildInfo.font.engineHash
            }
          ]
        }
      ])
      ?.free();
    host.add_font_base("Pretendard", 400, fontBase)?.free();
    host.add_font_manifest("Pretendard", 400, fontManifest)?.free();
    host.add_font_chunk("Pretendard", 400, 0, fontChunk)?.free();
    return host;
  })();
  return hostPromise;
}

function modifiersFromEvent(event: KeyboardEvent): InputModifiers {
  return {
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey
  };
}

function isCommandKey(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function commandRejected(result: TickResult): boolean {
  return result.request_outcomes.some((outcome) =>
    outcome.command_outcomes.some((candidate) => candidate.type === "rejected")
  );
}

class BrowserTypieEnginePort implements TypieEnginePort {
  private editor: Editor | undefined;
  private mountElement: HTMLElement | undefined;
  private surfaceElement: HTMLDivElement | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private readonly canvases = new Map<number, HTMLCanvasElement>();
  private input: HTMLTextAreaElement | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private readonly attachedSurfaceSizes = new Map<
    number,
    { readonly width: number; readonly height: number; readonly scale: number }
  >();
  private readonly pageOffsets = new Map<number, number>();
  private renderFrame: number | undefined;
  private revision = 0;
  private undoAvailable = false;
  private redoAvailable = false;
  private compositionActive = false;
  private interactionEnabled = true;
  private fontDataMissingEvents = 0;
  private dragging = false;
  private dragAnchor:
    | NonNullable<ReturnType<Editor["selection"]>>["anchor"]
    | undefined;
  private readonly listeners = new Set<
    (event: TypieTransactionEvent) => void
  >();
  private readonly imeAdapter: ImeInputAdapter;

  public constructor(private readonly host: EditorHost) {
    this.imeAdapter = new ImeInputAdapter({
      readContext: () => {
        const ime = this.editor?.ime(
          IME_CONTEXT_BEFORE_LIMIT,
          IME_CONTEXT_AFTER_LIMIT
        );
        return ime ? normalizeImeContext(ime) : null;
      },
      enqueue: (messages) => {
        if (this.interactionEnabled) {
          this.dispatch(messages, "input");
        }
      }
    });
  }

  public async mount(element: HTMLElement): Promise<void> {
    if (this.mountElement) {
      this.relocate(element);
      return;
    }

    const surface = document.createElement("div");
    surface.className = "typie-runtime";
    surface.dataset.interactionEnabled = "true";
    surface.setAttribute("aria-busy", "false");
    const input = document.createElement("textarea");
    input.className = "typie-runtime__ime-input";
    input.setAttribute("aria-label", "Typie 문서 입력");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    input.wrap = "off";

    surface.append(input);
    element.replaceChildren(surface);
    element.classList.add("typie-editor-mount--active");
    this.mountElement = element;
    this.surfaceElement = surface;
    this.input = input;
    this.installInputHandlers(input);

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.editor || !this.mountElement) {
        return;
      }
      const viewport = this.readViewport();
      this.dispatch(
        [
          {
            type: "system",
            event: {
              type: "resize",
              width: viewport.width,
              height: viewport.height,
              scale_factor: viewport.scale_factor
            }
          }
        ],
        null
      );
    });
    this.resizeObserver.observe(element);
  }

  public relocate(element: HTMLElement): void {
    const surface = this.surfaceElement;
    const previous = this.mountElement;
    if (!surface || !previous) {
      throw new Error("Typie runtime must be mounted before relocation");
    }
    if (previous === element) {
      return;
    }

    previous.classList.remove("typie-editor-mount--active");
    this.resizeObserver?.disconnect();
    element.replaceChildren(surface);
    element.classList.add("typie-editor-mount--active");
    this.mountElement = element;
    this.resizeObserver?.observe(element);

    if (this.editor) {
      const viewport = this.readViewport();
      this.dispatch(
        [
          {
            type: "system",
            event: {
              type: "resize",
              width: viewport.width,
              height: viewport.height,
              scale_factor: viewport.scale_factor
            }
          }
        ],
        null
      );
      this.attachOrResizeSurface();
      this.scheduleRender();
    }
  }

  public async createEmptyDocument(): Promise<void> {
    this.installEditor(
      this.host.create_editor_from_doc(EMPTY_DOCUMENT, this.readViewport())
    );
  }

  public async restoreSnapshot(snapshot: Uint8Array): Promise<void> {
    if (snapshot.byteLength === 0) {
      throw new Error("Typie snapshot is empty");
    }
    this.installEditor(
      this.host.create_editor_from_graph(
        Uint8Array.from(snapshot),
        this.readViewport()
      )
    );
  }

  public async exportSnapshot(): Promise<Uint8Array> {
    const result = this.requireEditor().missing_changesets_tolerant(
      new Uint8Array()
    );
    if (result.withheld !== 0) {
      throw new Error("Typie withheld changes while creating a snapshot");
    }
    return Uint8Array.from(result.bytes);
  }

  public async exportPlainText(): Promise<string> {
    // Annotated prose preserves semantic horizontal rules as `***`, making
    // the recovery copy useful even without the binary Typie graph.
    return this.requireEditor().prose_text_annotated();
  }

  public async replaceTextRanges(
    replacements: readonly EditorTextReplacement[]
  ): Promise<EditorReplacementDocument> {
    const editor = this.requireEditor();
    const originalSnapshot = await this.exportSnapshot();
    const originalHeads = editor.current_heads();
    const originalText = editor.prose_text_annotated();
    const originalBreakCount = semanticSceneBreakCount(editor);
    const originalStructure = semanticDocumentFingerprint(
      editor.materialize_at(editor.current_heads(), []).root
    );
    const ordered = [...replacements].sort((left, right) => {
      return right.start - left.start || right.end - left.end;
    });

    let dispatchAttempted = false;
    let replacementCommitted = false;
    try {
      this.validateReplacementRanges(originalText, ordered);
      if (ordered.length === 0) {
        return {
          snapshot: originalSnapshot,
          plainTextRecovery: originalText,
          semanticSceneBreakCount: originalBreakCount
        };
      }

      dispatchAttempted = true;
      const result = this.dispatch(
        [{
          type: "tracked_range",
          op: {
            type: "replace_many_from_prose_annotated",
            expected_text: originalText,
            replacements: ordered.map((replacement) => ({
              id: replacement.id,
              start: replacement.start,
              end: replacement.end,
              expected_text: replacement.expectedText,
              replacement: replacement.replacement
            }))
          }
        }],
        null
      );
      const outcomes = new Map(
        (result?.events ?? [])
          .filter((event) => event.type === "tracked_range_replace_result")
          .map((event) => [event.id, event.outcome] as const)
      );
      for (const replacement of ordered) {
        if (outcomes.get(replacement.id) !== "replaced") {
          throw new Error(
            `Typie rejected replacement ${replacement.id}: ${outcomes.get(replacement.id) ?? "missing outcome"}`
          );
        }
      }
      const nextText = editor.prose_text_annotated();
      const expectedCharacters = Array.from(originalText);
      for (const replacement of ordered) {
        expectedCharacters.splice(
          replacement.start,
          replacement.end - replacement.start,
          ...Array.from(replacement.replacement)
        );
      }
      const expectedText = expectedCharacters.join("");
      const nextBreakCount = semanticSceneBreakCount(editor);
      const nextStructure = semanticDocumentFingerprint(
        editor.materialize_at(editor.current_heads(), []).root
      );
      if (nextText !== expectedText) {
        throw new Error("Typie replacement result did not match the preview");
      }
      if (nextBreakCount !== originalBreakCount) {
        throw new Error("Typie replacement changed semantic scene breaks");
      }
      if (nextStructure !== originalStructure) {
        throw new Error("Typie replacement changed semantic document structure");
      }

      replacementCommitted = true;
      const snapshot = await this.exportSnapshot();
      this.undoAvailable = true;
      this.redoAvailable = false;
      this.emitTransaction("input");
      return {
        snapshot,
        plainTextRecovery: nextText,
        semanticSceneBreakCount: nextBreakCount
      };
    } catch (error) {
      // Command validation failures are atomic and leave Typie's history intact.
      // Restore only after a successful command violates a postcondition.
      if (replacementCommitted) {
        await this.restoreSnapshot(originalSnapshot);
      } else if (dispatchAttempted) {
        try {
          editor.prose_text_annotated();
          const currentHeads = editor.current_heads();
          if (
            currentHeads.length !== originalHeads.length ||
            currentHeads.some((value, index) => value !== originalHeads[index])
          ) {
            await this.restoreSnapshot(originalSnapshot);
          }
        } catch {
          await this.restoreSnapshot(originalSnapshot);
        }
      }
      throw error;
    }
  }

  public setInteractionEnabled(enabled: boolean): void {
    if (this.interactionEnabled === enabled) {
      return;
    }
    if (!enabled && this.compositionActive) {
      throw new Error(
        "Typie interaction cannot be locked during an active composition"
      );
    }
    this.interactionEnabled = enabled;
    this.dragging = false;
    this.dragAnchor = undefined;
    if (this.input) {
      if (!enabled) {
        this.input.blur();
      }
      this.input.disabled = !enabled;
      this.input.setAttribute("aria-disabled", enabled ? "false" : "true");
    }
    if (this.surfaceElement) {
      this.surfaceElement.inert = !enabled;
      this.surfaceElement.dataset.interactionEnabled = String(enabled);
      this.surfaceElement.setAttribute(
        "aria-busy",
        enabled ? "false" : "true"
      );
    }
  }

  public revealTextRange(
    start: number,
    end: number,
    options?: { readonly focus?: boolean }
  ): void {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      throw new Error("Invalid search result range");
    }
    const selection = this.requireEditor().prose_to_selection_annotated(
      start,
      end
    );
    if (!selection) {
      throw new Error("Typie could not map the search result range");
    }
    this.dispatch(
      [{ type: "selection", op: { type: "set", selection } }],
      null
    );
    if (this.surfaceElement) {
      this.surfaceElement.dataset.lastProgrammaticSelectionStart = String(start);
      this.surfaceElement.dataset.lastProgrammaticSelectionEnd = String(end);
    }
    if (options?.focus !== false) {
      this.focus();
    }
  }

  public focus(): void {
    this.requireEditor();
    if (!this.interactionEnabled) {
      return;
    }
    this.input?.focus({ preventScroll: true });
  }

  public undo(): void {
    this.dispatch([{ type: "history", op: { type: "undo" } }], "history");
  }

  public redo(): void {
    this.dispatch([{ type: "history", op: { type: "redo" } }], "history");
  }

  public insertSemanticSceneBreak(): void {
    const editor = this.requireEditor();
    const before = semanticSceneBreakCount(editor);
    this.dispatch(
      [
        {
          type: "insertion",
          op: {
            type: "fragment",
            fragment: {
              node: {
                type: TYPIE_SCENE_BREAK_MAPPING.nodeType,
                variant: TYPIE_SCENE_BREAK_MAPPING.variant
              }
            }
          }
        }
      ],
      "scene-break"
    );
    const after = semanticSceneBreakCount(editor);
    if (after <= before) {
      throw new Error("Typie did not retain the semantic scene break");
    }
    this.dispatch(
      [
        {
          type: "navigation",
          op: {
            type: "move",
            movement: { type: "grapheme", direction: "forward" },
            extend: false
          }
        }
      ],
      null
    );
    if (this.input) {
      this.imeAdapter.resetForResync(this.input);
    }
    this.updateSceneBreakDiagnostic();
  }

  public onTransaction(
    listener: (event: TypieTransactionEvent) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private installEditor(editor: Editor): void {
    if (!this.mountElement || !this.surfaceElement || !this.input) {
      editor.free();
      throw new Error("Typie runtime must be mounted before opening");
    }

    if (this.editor) {
      for (const page of this.attachedSurfaceSizes.keys()) {
        this.editor.detach_surface(page);
      }
      this.editor.free();
    }
    this.editor = editor;
    this.attachedSurfaceSizes.clear();
    this.pageOffsets.clear();
    this.revision = 0;
    this.undoAvailable = false;
    this.redoAvailable = false;
    this.fontDataMissingEvents = 0;
    for (const canvas of this.canvases.values()) {
      canvas.dataset.fontDataMissingEvents = "0";
    }
    this.imeAdapter.resetForResync(null);
    this.dispatch(
      [
        { type: "system", event: { type: "initialize" } },
        {
          type: "selection",
          op: { type: "set_flat", start: 1, end: 1 }
        }
      ],
      "restore"
    );
    this.updateSceneBreakDiagnostic();
    this.imeAdapter.resetForResync(this.input);
    this.attachOrResizeSurface();
    this.scheduleRender();
  }

  private updateSceneBreakDiagnostic(): void {
    if (!this.editor) {
      return;
    }
    const count = semanticSceneBreakCount(this.editor);
    for (const canvas of this.canvases.values()) {
      canvas.dataset.semanticSceneBreaks = String(count);
      canvas.dataset.sceneBreakSemanticId =
        TYPIE_SCENE_BREAK_MAPPING.semanticId;
    }
  }

  private validateReplacementRanges(
    originalText: string,
    ordered: readonly EditorTextReplacement[]
  ): void {
    const ids = new Set<string>();
    const originalCharacters = Array.from(originalText);
    let nextStart = originalCharacters.length;
    for (const replacement of ordered) {
      if (
        !replacement.id ||
        ids.has(replacement.id) ||
        !Number.isInteger(replacement.start) ||
        !Number.isInteger(replacement.end) ||
        replacement.start < 0 ||
        replacement.start >= replacement.end ||
        replacement.end > originalCharacters.length ||
        replacement.end > nextStart ||
        originalCharacters
          .slice(replacement.start, replacement.end)
          .join("") !==
          replacement.expectedText
      ) {
        throw new Error(`Invalid replacement preview ${replacement.id}`);
      }
      if (/\r|\n/u.test(replacement.replacement)) {
        throw new Error("Phase 1B replacement cannot insert line breaks");
      }
      ids.add(replacement.id);
      nextStart = replacement.start;
    }
  }

  private dispatch(
    messages: Message[],
    origin: TransactionOrigin | null
  ): TickResult | undefined {
    if (messages.length === 0) {
      return undefined;
    }
    const editor = this.requireEditor();
    const requestId = editor.enqueue_request(messages);
    const result = editor.tick_through(requestId);
    if (commandRejected(result)) {
      throw new Error("Typie rejected an editor command");
    }
    this.fontDataMissingEvents += result.events.filter(
      (event) => event.type === "font_data_missing"
    ).length;
    for (const canvas of this.canvases.values()) {
      canvas.dataset.fontDataMissingEvents = String(
        this.fontDataMissingEvents
      );
    }

    this.revision = result.revision.value;
    if (
      origin === "scene-break" ||
      origin === "history" ||
      origin === "restore"
    ) {
      this.updateSceneBreakDiagnostic();
    }
    if (origin === "input" || origin === "scene-break") {
      this.undoAvailable = true;
      this.redoAvailable = false;
    } else if (origin === "history") {
      const history = messages.find((message) => message.type === "history");
      if (history?.type === "history" && history.op.type === "undo") {
        this.redoAvailable = true;
      } else if (
        history?.type === "history" &&
        history.op.type === "redo"
      ) {
        this.undoAvailable = true;
        this.redoAvailable = false;
      }
    }

    if (
      result.events.some((event) => event.type === "ime_resync_required") &&
      this.input
    ) {
      this.imeAdapter.resetForResync(this.input);
    } else if (this.input) {
      this.imeAdapter.syncFromEditor(this.input);
    }
    this.positionImeInput();
    this.attachOrResizeSurface();
    this.scheduleRender();

    if (origin) {
      this.emitTransaction(origin);
    }
    return result;
  }

  private emitTransaction(origin: TransactionOrigin): void {
    const transaction: TypieTransactionEvent = {
      revision: this.revision,
      origin,
      canUndo: this.undoAvailable,
      canRedo: this.redoAvailable,
      isComposing: this.compositionActive
    };
    for (const listener of this.listeners) {
      listener(transaction);
    }
  }

  private readViewport() {
    const width = Math.max(
      320,
      Math.floor(this.mountElement?.clientWidth || 720)
    );
    const height = Math.max(
      320,
      Math.floor(this.mountElement?.clientHeight || 640)
    );
    return {
      width,
      height,
      scale_factor: Math.max(1, window.devicePixelRatio || 1)
    };
  }

  private attachOrResizeSurface(): void {
    const editor = this.editor;
    const surface = this.surfaceElement;
    if (!editor || !surface) {
      return;
    }
    const pageSizes = editor.page_sizes();
    const backingSizes = editor.page_backing_sizes();
    if (pageSizes.length === 0) {
      return;
    }

    const scale = Math.max(1, window.devicePixelRatio || 1);
    const pageGap = 24;
    let offset = 0;
    let surfaceWidth = 0;

    for (const [page, pageSize] of pageSizes.entries()) {
      const backingSize = backingSizes[page] ?? pageSize;
      const width = pageSize.width;
      const height = backingSize.height;
      let canvas = this.canvases.get(page);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.className = "typie-runtime__canvas";
        canvas.setAttribute("aria-hidden", "true");
        canvas.dataset.pageIndex = String(page);
        this.installPointerHandlers(canvas);
        surface.insertBefore(canvas, this.input ?? null);
        this.canvases.set(page, canvas);
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.top = `${offset}px`;
      canvas.style.left = "0";
      canvas.dataset.pageCount = String(pageSizes.length);
      canvas.dataset.fontDataMissingEvents = String(
        this.fontDataMissingEvents
      );
      this.pageOffsets.set(page, offset);

      const previous = this.attachedSurfaceSizes.get(page);
      if (!previous) {
        editor.attach_surface(page, canvas, width, height, scale);
      } else if (
        previous.width !== width ||
        previous.height !== height ||
        previous.scale !== scale
      ) {
        editor.resize_surface(page, width, height, scale);
      }
      canvas.dataset.surfaceBackend = editor.surface_backend(page);
      this.attachedSurfaceSizes.set(page, { width, height, scale });
      surfaceWidth = Math.max(surfaceWidth, width);
      offset += pageSize.height + pageGap;
    }

    for (const [page, canvas] of [...this.canvases.entries()]) {
      if (page >= pageSizes.length) {
        if (this.attachedSurfaceSizes.has(page)) {
          editor.detach_surface(page);
        }
        canvas.remove();
        this.canvases.delete(page);
        this.attachedSurfaceSizes.delete(page);
        this.pageOffsets.delete(page);
      }
    }

    this.canvas = this.canvases.get(0);
    surface.style.width = `${surfaceWidth}px`;
    surface.style.height = `${Math.max(0, offset - pageGap)}px`;
    this.updateSceneBreakDiagnostic();
  }

  private scheduleRender(): void {
    if (this.renderFrame !== undefined) {
      return;
    }
    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = undefined;
      const editor = this.editor;
      if (!editor || this.attachedSurfaceSizes.size === 0) {
        return;
      }
      for (const [page, canvas] of this.canvases) {
        const frame = editor.render_surface(page, {
          value: this.revision
        });
        canvas.dataset.renderRevision = String(this.revision);
        canvas.dataset.frameKey = frame
          ? String(frame.value)
          : "unavailable";
      }
    });
  }

  private positionImeInput(): void {
    const input = this.input;
    const cursor = this.editor?.cursor();
    if (!input || !cursor) {
      return;
    }
    const pageOffset = this.pageOffsets.get(cursor.page_idx) ?? 0;
    input.style.left = `${Math.max(0, cursor.caret.x)}px`;
    input.style.top = `${Math.max(
      0,
      pageOffset + cursor.caret.y + cursor.caret.height
    )}px`;
    for (const canvas of this.canvases.values()) {
      canvas.dataset.cursorPage = String(cursor.page_idx);
    }
  }

  private installInputHandlers(input: HTMLTextAreaElement): void {
    input.addEventListener("beforeinput", (event) => {
      if (!this.interactionEnabled) {
        event.preventDefault();
        return;
      }
      this.imeAdapter.handleBeforeInput(
        event as InputEvent & {
          readonly currentTarget: HTMLTextAreaElement;
        }
      );
    });
    input.addEventListener("input", (event) => {
      if (!this.interactionEnabled) {
        event.preventDefault();
        return;
      }
      this.imeAdapter.handleInput(
        event as Event & {
          readonly currentTarget: HTMLTextAreaElement;
        }
      );
    });
    input.addEventListener("compositionstart", (event) => {
      if (!this.interactionEnabled) {
        event.preventDefault();
        return;
      }
      this.compositionActive = true;
      this.imeAdapter.handleCompositionStart(
        event as CompositionEvent & {
          readonly currentTarget: HTMLTextAreaElement;
        }
      );
      this.emitTransaction("composition-state");
    });
    input.addEventListener("compositionupdate", (event) => {
      if (!this.interactionEnabled) {
        event.preventDefault();
        return;
      }
      this.imeAdapter.handleCompositionUpdate(event);
    });
    input.addEventListener("compositionend", () => {
      if (!this.interactionEnabled) {
        return;
      }
      this.compositionActive = false;
      this.imeAdapter.handleCompositionEnd();
      // A cancelled/resynced composition may have no content operation to
      // dispatch. Publish the state transition independently so save/close
      // guards cannot remain stuck on the previous composing transaction.
      this.emitTransaction("composition-state");
    });
    input.addEventListener("keydown", (event) =>
      this.handleKeyDown(event)
    );
    input.addEventListener("copy", (event) => this.handleCopy(event));
    input.addEventListener("cut", (event) => {
      if (!this.interactionEnabled) {
        event.preventDefault();
        return;
      }
      if (this.handleCopy(event)) {
        this.dispatch(
          [{ type: "clipboard", op: { type: "cut" } }],
          "input"
        );
      }
    });
    input.addEventListener("paste", (event) => {
      if (!this.interactionEnabled) {
        event.preventDefault();
        return;
      }
      const clipboard = event.clipboardData;
      if (!clipboard) {
        return;
      }
      event.preventDefault();
      this.dispatch(
        [
          {
            type: "clipboard",
            op: {
              type: "paste",
              text: clipboard.getData("text/plain"),
              html: clipboard.getData("text/html") || undefined
            }
          }
        ],
        "input"
      );
    });
    input.addEventListener("focus", () => {
      this.dispatch(
        [{ type: "system", event: { type: "set_focused", focused: true } }],
        null
      );
    });
    input.addEventListener("blur", () => {
      this.dispatch(
        [{ type: "system", event: { type: "set_focused", focused: false } }],
        null
      );
    });
  }

  private handleCopy(event: ClipboardEvent): boolean {
    const payload = this.editor?.copy_selection();
    if (!payload || !event.clipboardData) {
      return false;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    if (payload.html) {
      event.clipboardData.setData("text/html", payload.html);
    }
    return true;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.interactionEnabled) {
      event.preventDefault();
      return;
    }
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    const command = isCommandKey(event);
    const lowerKey = event.key.toLocaleLowerCase();
    let messages: Message[] | undefined;
    let origin: TransactionOrigin | null = null;

    if (command && lowerKey === "a") {
      messages = [
        { type: "selection", op: { type: "expand", unit: "all" } }
      ];
    } else if (command && lowerKey === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    } else if (command && lowerKey === "y") {
      event.preventDefault();
      this.redo();
      return;
    } else if (event.key === "Backspace" || event.key === "Delete") {
      messages = [
        {
          type: "deletion",
          op: {
            type: "move",
            movement: {
              type: command ? "word" : "grapheme",
              direction:
                event.key === "Backspace" ? "backward" : "forward"
            }
          }
        }
      ];
      origin = "input";
    } else if (event.key === "Enter") {
      messages = [{ type: "key", event: { key: "enter" } }];
      origin = "input";
    } else if (event.key === "Tab") {
      messages = [
        {
          type: "key",
          event: { key: "tab", modifiers: modifiersFromEvent(event) }
        }
      ];
      origin = "input";
    } else if (event.key === "Escape") {
      messages = [{ type: "key", event: { key: "escape" } }];
    } else {
      const movement = this.movementForKey(event);
      if (movement) {
        messages = [
          {
            type: "navigation",
            op: {
              type: "move",
              movement,
              extend: event.shiftKey
            }
          }
        ];
      }
    }

    if (!messages) {
      return;
    }
    event.preventDefault();
    this.dispatch(messages, origin);
  }

  private movementForKey(event: KeyboardEvent): Movement | undefined {
    const command = isCommandKey(event);
    switch (event.key) {
      case "ArrowLeft":
        return {
          type: command ? "word" : "grapheme",
          direction: "backward"
        };
      case "ArrowRight":
        return {
          type: command ? "word" : "grapheme",
          direction: "forward"
        };
      case "ArrowUp":
        return {
          type: "line",
          direction: "backward",
          axis: "vertical"
        };
      case "ArrowDown":
        return {
          type: "line",
          direction: "forward",
          axis: "vertical"
        };
      case "Home":
        return {
          type: "line",
          direction: "backward",
          axis: "horizontal"
        };
      case "End":
        return {
          type: "line",
          direction: "forward",
          axis: "horizontal"
        };
      case "PageUp":
        return { type: "page", direction: "backward" };
      case "PageDown":
        return { type: "page", direction: "forward" };
      default:
        return undefined;
    }
  }

  private installPointerHandlers(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", (event) => {
      if (
        !this.interactionEnabled ||
        event.button !== 0 ||
        !event.isPrimary
      ) {
        if (!this.interactionEnabled) {
          event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      this.focus();
      const point = this.localPoint(event);
      if (!point) {
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      this.dragging = true;

      if (event.detail >= 2) {
        this.dispatch(
          [
            {
              type: "selection",
              op: {
                type: "select_unit_at",
                page: point.page,
                x: point.x,
                y: point.y,
                unit: event.detail >= 3 ? "paragraph" : "word"
              }
            }
          ],
          null
        );
      } else {
        this.dispatch(
          [
            {
              type: "selection",
              op: {
                type: "set_at",
                page: point.page,
                x: point.x,
                y: point.y
              }
            }
          ],
          null
        );
      }
      this.dragAnchor = this.editor?.selection()?.anchor;
    });

    canvas.addEventListener("pointermove", (event) => {
      if (
        !this.interactionEnabled ||
        !this.dragging ||
        !this.dragAnchor
      ) {
        return;
      }
      const point = this.localPoint(event);
      if (!point) {
        return;
      }
      this.dispatch(
        [
          {
            type: "selection",
            op: {
              type: "extend_to",
              anchor: this.dragAnchor,
              head_page: point.page,
              head_x: point.x,
              head_y: point.y,
              base_selection: undefined,
              allow_collapse: true
            }
          }
        ],
        null
      );
    });

    const finishDrag = (event: PointerEvent) => {
      this.dragging = false;
      this.dragAnchor = undefined;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerup", finishDrag);
    canvas.addEventListener("pointercancel", finishDrag);
  }

  private localPoint(
    event: Pick<PointerEvent, "clientX" | "clientY">
  ):
    | { readonly page: number; readonly x: number; readonly y: number }
    | undefined {
    const pageSizes = this.editor?.page_sizes();
    if (!pageSizes || pageSizes.length === 0) {
      return undefined;
    }
    let nearest:
      | {
          readonly page: number;
          readonly bounds: DOMRect;
          readonly distance: number;
        }
      | undefined;
    for (const [page, canvas] of this.canvases) {
      const bounds = canvas.getBoundingClientRect();
      const distance =
        event.clientY < bounds.top
          ? bounds.top - event.clientY
          : event.clientY > bounds.bottom
            ? event.clientY - bounds.bottom
            : 0;
      if (!nearest || distance < nearest.distance) {
        nearest = { page, bounds, distance };
      }
    }
    if (
      !nearest ||
      nearest.bounds.width === 0 ||
      nearest.bounds.height === 0
    ) {
      return undefined;
    }
    const pageSize = pageSizes[nearest.page];
    if (!pageSize) {
      return undefined;
    }
    return {
      page: nearest.page,
      x:
        ((event.clientX - nearest.bounds.left) / nearest.bounds.width) *
        pageSize.width,
      y:
        ((event.clientY - nearest.bounds.top) / nearest.bounds.height) *
        pageSize.height
    };
  }

  private requireEditor(): Editor {
    if (!this.editor) {
      throw new Error("Typie editor is not initialized");
    }
    return this.editor;
  }
}

export async function createTypieEnginePort(): Promise<TypieEnginePort> {
  return new BrowserTypieEnginePort(await loadHost());
}
