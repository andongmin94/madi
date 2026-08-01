import type {
  MadiDesktopApi,
  ProjectSession,
  SaveDocumentResult,
  SaveSceneDocumentResult
} from "../../shared/contracts";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../editor/MadiEditorAdapter";

export type SavePhase =
  | "no-project"
  | "dirty"
  | "saving"
  | "saved"
  | "restoring"
  | "error";

export interface WorkspaceState {
  readonly savePhase: SavePhase;
  readonly session: ProjectSession | null;
  readonly activeSceneId: string | null;
  readonly title: string;
  readonly revision: number;
  readonly snapshotBytes: number;
  readonly snapshotFingerprint: string;
  readonly recoveryCharacters: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isComposing: boolean;
  readonly lastSavedAt: string;
  readonly errorMessage: string;
}

const INITIAL_STATE: WorkspaceState = {
  savePhase: "no-project",
  session: null,
  activeSceneId: null,
  title: "새 작품",
  revision: 0,
  snapshotBytes: 0,
  snapshotFingerprint: "—",
  recoveryCharacters: 0,
  canUndo: false,
  canRedo: false,
  isComposing: false,
  lastSavedAt: "",
  errorMessage: ""
};

function snapshotFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function textFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    hash ^= codeUnit & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= codeUnit >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function contentSignature(snapshot: Uint8Array, plainText: string): string {
  return [
    snapshot.byteLength,
    snapshotFingerprint(snapshot),
    plainText.length,
    textFingerprint(plainText)
  ].join(":");
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류";
}

function assertSnapshotCompatibility(
  document: Awaited<ReturnType<MadiDesktopApi["loadDocument"]>>,
  expectedCommit: string,
  expectedSchemaVersion: number
): void {
  if (document.editorEngine !== "typie") {
    throw new Error(
      "이 .madi 파일은 현재 지원하지 않는 편집 엔진을 사용합니다."
    );
  }
  if (document.editorEngineCommit !== expectedCommit) {
    throw new Error(
      "이 .madi 파일의 Typie snapshot은 현재 엔진 commit과 호환되지 않습니다. plain text 복구를 사용하세요."
    );
  }
  if (document.editorSchemaVersion !== expectedSchemaVersion) {
    throw new Error(
      "이 .madi 파일의 편집기 schema는 현재 버전과 호환되지 않습니다. plain text 복구를 사용하세요."
    );
  }
}

type CompositionGuard = boolean | (() => boolean);

function isCompositionActive(guard: CompositionGuard): boolean {
  return typeof guard === "function" ? guard() : guard;
}

function isSceneSaveResult(
  result: SaveDocumentResult | SaveSceneDocumentResult
): result is SaveSceneDocumentResult {
  return (
    "sceneId" in result &&
    typeof result.sceneId === "string" &&
    "generation" in result &&
    typeof result.generation === "number" &&
    "saveSequence" in result &&
    typeof result.saveSequence === "number"
  );
}

export class DocumentSessionController {
  private state: WorkspaceState = INITIAL_STATE;
  private readonly listeners = new Set<(state: WorkspaceState) => void>();
  private readonly unsubscribeEditor: () => void;
  private suppressEditorChanges = false;
  private changeGeneration = 0;
  private activeSave: Promise<boolean> | null = null;
  private saveSequence = 0;
  private sessionToken = 0;
  private latestSceneSwitch = 0;
  private sceneSwitchQueue: Promise<void> = Promise.resolve();
  private lastSavedContentSignature: string | null = null;

  public constructor(
    private readonly api: MadiDesktopApi,
    private readonly editor: MadiEditorAdapter,
    private readonly editorEngineCommit: string,
    private readonly editorSchemaVersion: number
  ) {
    this.unsubscribeEditor = editor.onChanged((change) =>
      this.onEditorChanged(change)
    );
  }

  public getState(): WorkspaceState {
    return this.state;
  }

  public subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public async createProject(
    compositionGuard: CompositionGuard = false
  ): Promise<void> {
    if (!(await this.flushPendingChanges(compositionGuard))) {
      return;
    }
    const previous = this.state;
    this.patch({ savePhase: "restoring", errorMessage: "" });
    try {
      const session = await this.api.createProject({
        title: this.state.title || "새 작품",
        suggestedFileName: "드래곤을죽이다.madi",
        editorEngine: "typie",
        editorEngineCommit: this.editorEngineCommit,
        editorSchemaVersion: this.editorSchemaVersion
      });
      if (!session) {
        this.setState(previous);
        return;
      }

      await this.withSuppressedChanges(() => this.editor.open());
      this.sessionToken += 1;
      this.changeGeneration += 1;
      this.lastSavedContentSignature = null;
      this.patch({
        session,
        activeSceneId: session.sceneId ?? null,
        title: session.title,
        revision: session.revision,
        savePhase: "dirty",
        snapshotBytes: 0,
        snapshotFingerprint: "—",
        recoveryCharacters: 0,
        canUndo: false,
        canRedo: false,
        isComposing: false,
        lastSavedAt: "",
        errorMessage: ""
      });
      this.editor.focus();
    } catch (error) {
      this.patch({ savePhase: "error", errorMessage: publicError(error) });
    }
  }

  public async openProject(
    compositionGuard: CompositionGuard = false
  ): Promise<void> {
    if (!(await this.flushPendingChanges(compositionGuard))) {
      return;
    }
    const previous = this.state;
    this.patch({ savePhase: "restoring", errorMessage: "" });
    try {
      const session = await this.api.openProject();
      if (!session) {
        this.setState(previous);
        return;
      }
      if (!session.sceneId && !session.documentId) {
        await this.withSuppressedChanges(() => this.editor.open());
        this.sessionToken += 1;
        this.changeGeneration = 0;
        this.lastSavedContentSignature = null;
        this.patch({
          session,
          activeSceneId: null,
          title: session.title,
          revision: session.revision,
          savePhase: "saved",
          snapshotBytes: 0,
          snapshotFingerprint: "—",
          recoveryCharacters: 0,
          canUndo: false,
          canRedo: false,
          isComposing: false,
          lastSavedAt: "",
          errorMessage: ""
        });
        return;
      }
      const document = session.sceneId
        ? await this.api.loadSceneDocument({
            sessionId: session.sessionId,
            sceneId: session.sceneId
          })
        : await this.api.loadDocument({
            sessionId: session.sessionId,
            ...(session.documentId ? { documentId: session.documentId } : {})
          });
      assertSnapshotCompatibility(
        document,
        this.editorEngineCommit,
        this.editorSchemaVersion
      );
      const isInitialPlaceholder = document.snapshot.byteLength === 0;
      await this.withSuppressedChanges(() =>
        this.editor.open(
          isInitialPlaceholder ? undefined : document.snapshot
        )
      );
      this.sessionToken += 1;
      this.changeGeneration = 0;
      this.lastSavedContentSignature = isInitialPlaceholder
        ? null
        : contentSignature(document.snapshot, document.plainTextRecovery);
      const restoredSession: ProjectSession = {
        ...session,
        documentId: document.id,
        title: document.title,
        revision: document.revision
      };
      this.patch({
        session: restoredSession,
        activeSceneId: session.sceneId ?? null,
        title: document.title,
        revision: document.revision,
        // create_project intentionally writes a zero-byte placeholder before
        // Typie has produced its first graph. Reopening that file creates a
        // real empty Typie document and marks it dirty so the next save
        // replaces the placeholder.
        savePhase: isInitialPlaceholder ? "dirty" : "saved",
        snapshotBytes: document.snapshot.byteLength,
        snapshotFingerprint: snapshotFingerprint(document.snapshot),
        recoveryCharacters: document.plainTextRecovery.length,
        canUndo: false,
        canRedo: false,
        isComposing: false,
        lastSavedAt: document.updatedAt,
        errorMessage: ""
      });
      this.editor.focus();
    } catch (error) {
      this.patch({ savePhase: "error", errorMessage: publicError(error) });
    }
  }

  public save(compositionGuard: CompositionGuard = false): Promise<boolean> {
    if (isCompositionActive(compositionGuard) || this.state.isComposing) {
      this.patch({
        errorMessage:
          "한글 조합이 끝난 뒤 다시 시도하세요. 조합 중인 원고는 저장하지 않았습니다."
      });
      return Promise.resolve(false);
    }
    if (this.activeSave) {
      return this.activeSave;
    }
    if (this.state.savePhase === "saved") {
      return Promise.resolve(true);
    }
    const session = this.state.session;
    if (!session) {
      return Promise.resolve(true);
    }

    const save = this.performSave(session);
    this.activeSave = save;
    void save.finally(() => {
      if (this.activeSave === save) {
        this.activeSave = null;
      }
    });
    return save;
  }

  public async flushPendingChanges(
    compositionGuard: CompositionGuard = false
  ): Promise<boolean> {
    while (this.state.session) {
      if (isCompositionActive(compositionGuard) || this.state.isComposing) {
        this.patch({
          errorMessage:
            "한글 조합이 끝난 뒤 다시 시도하세요. 조합 중인 원고는 닫거나 교체하지 않았습니다."
        });
        return false;
      }
      if (this.state.savePhase === "saved") {
        return true;
      }
      if (this.state.savePhase === "restoring") {
        this.patch({
          errorMessage:
            "문서 준비 또는 복원이 끝난 뒤 다시 시도하세요. 현재 문서는 닫거나 교체하지 않았습니다."
        });
        return false;
      }
      if (!(await this.save(compositionGuard))) {
        return false;
      }
    }
    return true;
  }

  private async performSave(session: ProjectSession): Promise<boolean> {
    const generationAtStart = this.changeGeneration;
    const sessionTokenAtStart = this.sessionToken;
    const sceneIdAtStart = this.state.activeSceneId;
    const documentIdAtStart = session.documentId;
    const saveSequence = ++this.saveSequence;
    this.patch({ savePhase: "saving", errorMessage: "" });
    try {
      const snapshot = await this.editor.getSnapshot();
      const plainTextRecovery = await this.editor.getPlainText();
      const signature = contentSignature(snapshot, plainTextRecovery);
      if (
        this.sessionToken !== sessionTokenAtStart ||
        this.state.session?.sessionId !== session.sessionId ||
        this.state.activeSceneId !== sceneIdAtStart
      ) {
        return true;
      }
      if (signature === this.lastSavedContentSignature) {
        this.patch({
          savePhase: "saved",
          snapshotBytes: snapshot.byteLength,
          snapshotFingerprint: snapshotFingerprint(snapshot),
          recoveryCharacters: plainTextRecovery.length,
          errorMessage: ""
        });
        return true;
      }
      const result =
        sceneIdAtStart && documentIdAtStart
          ? await this.api.saveSceneDocument({
              sessionId: session.sessionId,
              sceneId: sceneIdAtStart,
              documentId: documentIdAtStart,
              generation: generationAtStart,
              saveSequence,
              editorEngine: "typie",
              editorEngineCommit: this.editorEngineCommit,
              editorSchemaVersion: this.editorSchemaVersion,
              snapshot,
              plainTextRecovery
            })
          : await this.api.saveDocument({
              sessionId: session.sessionId,
              ...(session.documentId
                ? { documentId: session.documentId }
                : {}),
              title: this.state.title,
              editorEngine: "typie",
              editorEngineCommit: this.editorEngineCommit,
              editorSchemaVersion: this.editorSchemaVersion,
              snapshot,
              plainTextRecovery
            });
      if (
        this.sessionToken !== sessionTokenAtStart ||
        this.state.session?.sessionId !== session.sessionId ||
        this.state.activeSceneId !== sceneIdAtStart
      ) {
        return true;
      }
      if (
        sceneIdAtStart &&
        documentIdAtStart &&
        (!isSceneSaveResult(result) ||
          result.sceneId !== sceneIdAtStart ||
          result.documentId !== documentIdAtStart ||
          result.generation !== generationAtStart ||
          result.saveSequence !== saveSequence)
      ) {
        this.patch({
          savePhase: "error",
          errorMessage:
            "장면 저장 응답이 현재 편집 세션과 일치하지 않습니다. 현재 장면은 유지됩니다."
        });
        return false;
      }
      const savedSession: ProjectSession = {
        ...session,
        documentId: result.documentId,
        title: sceneIdAtStart ? session.title : this.state.title,
        revision: result.revision
      };
      this.lastSavedContentSignature = signature;
      this.patch({
        session: savedSession,
        revision: result.revision,
        savePhase:
          this.changeGeneration === generationAtStart ? "saved" : "dirty",
        snapshotBytes: snapshot.byteLength,
        snapshotFingerprint: snapshotFingerprint(snapshot),
        recoveryCharacters: plainTextRecovery.length,
        lastSavedAt: result.updatedAt,
        errorMessage: ""
      });
      return true;
    } catch (error) {
      this.patch({ savePhase: "error", errorMessage: publicError(error) });
      return false;
    }
  }

  public selectScene(
    sceneId: string,
    compositionGuard: CompositionGuard = false
  ): Promise<boolean> {
    if (
      this.state.activeSceneId === sceneId &&
      this.state.session?.documentId
    ) {
      return Promise.resolve(true);
    }
    const requestToken = ++this.latestSceneSwitch;
    const operation = this.sceneSwitchQueue.then(() =>
      this.performSceneSwitch(sceneId, requestToken, compositionGuard)
    );
    this.sceneSwitchQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async performSceneSwitch(
    sceneId: string,
    requestToken: number,
    compositionGuard: CompositionGuard
  ): Promise<boolean> {
    const session = this.state.session;
    if (!session) {
      return false;
    }
    if (isCompositionActive(compositionGuard) || this.state.isComposing) {
      this.patch({
        errorMessage:
          "한글 조합이 끝난 뒤 장면을 전환하세요. 현재 장면은 유지됩니다."
      });
      return false;
    }
    if (!(await this.flushPendingChanges(compositionGuard))) {
      return false;
    }
    if (requestToken !== this.latestSceneSwitch) {
      return false;
    }

    const previous = this.state;
    this.patch({ savePhase: "restoring", errorMessage: "" });
    try {
      const document = await this.api.loadSceneDocument({
        sessionId: session.sessionId,
        sceneId
      });
      if (requestToken !== this.latestSceneSwitch) {
        this.setState(previous);
        return false;
      }
      assertSnapshotCompatibility(
        document,
        this.editorEngineCommit,
        this.editorSchemaVersion
      );
      const isInitialPlaceholder = document.snapshot.byteLength === 0;
      await this.withSuppressedChanges(() =>
        this.editor.open(
          isInitialPlaceholder ? undefined : document.snapshot
        )
      );
      this.sessionToken += 1;
      this.changeGeneration = 0;
      this.lastSavedContentSignature = isInitialPlaceholder
        ? null
        : contentSignature(document.snapshot, document.plainTextRecovery);
      this.setState({
        ...previous,
        session: {
          ...session,
          sceneId,
          documentId: document.id,
          revision: document.revision
        },
        activeSceneId: sceneId,
        title: document.title,
        revision: document.revision,
        savePhase: isInitialPlaceholder ? "dirty" : "saved",
        snapshotBytes: document.snapshot.byteLength,
        snapshotFingerprint: snapshotFingerprint(document.snapshot),
        recoveryCharacters: document.plainTextRecovery.length,
        canUndo: false,
        canRedo: false,
        isComposing: false,
        lastSavedAt: document.updatedAt,
        errorMessage: ""
      });
      this.editor.focus();
      return true;
    } catch (error) {
      this.setState({
        ...previous,
        savePhase: "error",
        errorMessage: publicError(error)
      });
      return false;
    }
  }

  public async checkPlainTextRecovery(): Promise<void> {
    const session = this.state.session;
    if (!session) {
      return;
    }
    try {
      const recovery = await this.api.recoverPlainText({
        sessionId: session.sessionId,
        ...(session.documentId ? { documentId: session.documentId } : {})
      });
      this.patch({
        recoveryCharacters: recovery.plainText.length,
        errorMessage: ""
      });
    } catch (error) {
      this.patch({ savePhase: "error", errorMessage: publicError(error) });
    }
  }

  public setTitle(title: string): void {
    if (title === this.state.title) {
      return;
    }
    this.changeGeneration += 1;
    this.patch({ title, savePhase: this.state.session ? "dirty" : "no-project" });
  }

  public undo(): void {
    this.editor.undo();
  }

  public redo(): void {
    this.editor.redo();
  }

  public insertSceneBreak(): void {
    this.editor.insertSceneBreak();
    this.editor.focus();
  }

  public focus(): void {
    this.editor.focus();
  }

  public dispose(): void {
    this.unsubscribeEditor();
    this.listeners.clear();
  }

  private onEditorChanged(change: EditorChange): void {
    if (this.suppressEditorChanges) {
      return;
    }
    if (change.reason === "composition-state") {
      this.patch({ isComposing: change.isComposing });
      return;
    }
    this.changeGeneration += 1;
    this.patch({
      savePhase: this.state.session ? "dirty" : "no-project",
      canUndo: change.canUndo,
      canRedo: change.canRedo,
      isComposing: change.isComposing
    });
  }

  private async withSuppressedChanges(
    operation: () => Promise<void>
  ): Promise<void> {
    this.suppressEditorChanges = true;
    try {
      await operation();
    } finally {
      this.suppressEditorChanges = false;
    }
  }

  private patch(patch: Partial<WorkspaceState>): void {
    this.setState({ ...this.state, ...patch });
  }

  private setState(state: WorkspaceState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
