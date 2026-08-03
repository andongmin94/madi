import { canonicalizeJsonCanvas } from "./jsonCanvasAdapter";
import type {
  CanvasAutosaveState,
  CanvasSaveRequest,
  CanvasSaveResult,
  MadiCanvasDocument
} from "./types";

export type CanvasSaveOperation = (
  request: CanvasSaveRequest
) => Promise<CanvasSaveResult | void>;

export interface CanvasAutosaveControllerOptions {
  readonly debounceMs?: number;
  readonly now?: () => number;
}

type AutosaveListener = (state: CanvasAutosaveState) => void;

/**
 * A canvas-scoped autosave state machine. Every activation advances a
 * generation, and every write has a monotonic saveSequence. Responses only
 * affect state when both still match the active request.
 */
export class CanvasAutosaveController {
  readonly #save: CanvasSaveOperation;
  readonly #debounceMs: number;
  readonly #now: () => number;
  readonly #listeners = new Set<AutosaveListener>();

  #state: CanvasAutosaveState;
  #document: MadiCanvasDocument;
  #documentVersion = 0;
  #savedCanonical: string;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  #disposed = false;

  constructor(
    canvasId: string,
    document: MadiCanvasDocument,
    save: CanvasSaveOperation,
    options: CanvasAutosaveControllerOptions = {}
  ) {
    this.#save = save;
    this.#debounceMs = options.debounceMs ?? 500;
    this.#now = options.now ?? Date.now;
    this.#document = document;
    this.#savedCanonical = canonicalizeJsonCanvas(document);
    this.#state = {
      canvasId,
      generation: 1,
      saveSequence: 0,
      phase: "clean",
      lastSavedAt: null,
      errorMessage: null
    };
  }

  get state(): CanvasAutosaveState {
    return this.#state;
  }

  get document(): MadiCanvasDocument {
    return this.#document;
  }

  subscribe(listener: AutosaveListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  activate(canvasId: string, document: MadiCanvasDocument): void {
    this.#clearTimer();
    this.#document = document;
    this.#documentVersion += 1;
    this.#savedCanonical = canonicalizeJsonCanvas(document);
    this.#setState({
      canvasId,
      generation: this.#state.generation + 1,
      saveSequence: this.#state.saveSequence,
      phase: "clean",
      lastSavedAt: null,
      errorMessage: null
    });
  }

  update(document: MadiCanvasDocument): void {
    if (this.#disposed || document === this.#document) {
      return;
    }
    this.#document = document;
    this.#documentVersion += 1;
    this.#setState({ ...this.#state, phase: "dirty", errorMessage: null });
    this.#schedule();
  }

  async flush(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#clearTimer();
    while (true) {
      if (this.#inFlight) {
        await this.#inFlight;
        if (this.#state.phase !== "dirty") {
          return;
        }
        continue;
      }
      if (this.#state.phase !== "dirty" && this.#state.phase !== "error") {
        return;
      }
      let canonical: string;
      try {
        canonical = canonicalizeJsonCanvas(this.#document);
      } catch (error) {
        const validationError =
          error instanceof Error ? error : new Error("캔버스 문서 검증 실패");
        this.#setState({
          ...this.#state,
          phase: "error",
          errorMessage: validationError.message
        });
        throw validationError;
      }
      if (canonical === this.#savedCanonical) {
        this.#setState({
          ...this.#state,
          phase: "saved",
          lastSavedAt: this.#now(),
          errorMessage: null
        });
        return;
      }
      const request: CanvasSaveRequest = {
        canvasId: this.#state.canvasId,
        generation: this.#state.generation,
        saveSequence: this.#state.saveSequence + 1,
        document: this.#document
      };
      const capturedVersion = this.#documentVersion;
      this.#setState({
        ...this.#state,
        saveSequence: request.saveSequence,
        phase: "saving",
        errorMessage: null
      });
      const inFlight = this.#performSave(request, canonical, capturedVersion);
      this.#inFlight = inFlight;
      try {
        await inFlight;
      } finally {
        if (this.#inFlight === inFlight) {
          this.#inFlight = null;
        }
      }
      if (this.#state.phase === "dirty") {
        continue;
      }
      return;
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimer();
    this.#listeners.clear();
  }

  async #performSave(
    request: CanvasSaveRequest,
    canonical: string,
    capturedVersion: number
  ): Promise<void> {
    try {
      const result = await this.#save(request);
      if (
        this.#disposed ||
        request.canvasId !== this.#state.canvasId ||
        request.generation !== this.#state.generation ||
        request.saveSequence !== this.#state.saveSequence
      ) {
        return;
      }
      if (
        result &&
        (result.canvasId !== request.canvasId ||
          result.generation !== request.generation ||
          result.saveSequence !== request.saveSequence)
      ) {
        throw new Error("오래된 캔버스 저장 응답을 차단했습니다.");
      }
      if (capturedVersion !== this.#documentVersion) {
        this.#savedCanonical = canonical;
        this.#setState({ ...this.#state, phase: "dirty" });
        this.#schedule();
        return;
      }
      this.#savedCanonical = canonical;
      this.#setState({
        ...this.#state,
        phase: "saved",
        lastSavedAt: this.#now(),
        errorMessage: null
      });
    } catch (error) {
      if (
        this.#disposed ||
        request.canvasId !== this.#state.canvasId ||
        request.generation !== this.#state.generation ||
        request.saveSequence !== this.#state.saveSequence
      ) {
        return;
      }
      const saveError =
        error instanceof Error ? error : new Error("캔버스 저장 실패");
      this.#setState({
        ...this.#state,
        phase: "error",
        errorMessage: saveError.message
      });
      throw saveError;
    }
  }

  #schedule(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush().catch(() => {
        // Background autosave exposes the failure through state. Explicit
        // flush callers still receive the rejection and can fail closed.
      });
    }, this.#debounceMs);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #setState(state: CanvasAutosaveState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}
