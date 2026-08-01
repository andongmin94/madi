import type {
  MadiDesktopApi,
  ProjectSession
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
  readonly title: string;
  readonly revision: number;
  readonly snapshotBytes: number;
  readonly snapshotFingerprint: string;
  readonly recoveryCharacters: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isComposing: boolean;
  readonly errorMessage: string;
}

const INITIAL_STATE: WorkspaceState = {
  savePhase: "no-project",
  session: null,
  title: "새 작품",
  revision: 0,
  snapshotBytes: 0,
  snapshotFingerprint: "—",
  recoveryCharacters: 0,
  canUndo: false,
  canRedo: false,
  isComposing: false,
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

export class DocumentSessionController {
  private state: WorkspaceState = INITIAL_STATE;
  private readonly listeners = new Set<(state: WorkspaceState) => void>();
  private readonly unsubscribeEditor: () => void;
  private suppressEditorChanges = false;
  private changeGeneration = 0;
  private activeSave: Promise<boolean> | null = null;

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
      this.changeGeneration += 1;
      this.patch({
        session,
        title: session.title,
        revision: session.revision,
        savePhase: "dirty",
        snapshotBytes: 0,
        snapshotFingerprint: "—",
        recoveryCharacters: 0,
        canUndo: false,
        canRedo: false,
        isComposing: false,
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
      const document = await this.api.loadDocument({
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
      this.changeGeneration = 0;
      const restoredSession: ProjectSession = {
        ...session,
        documentId: document.id,
        title: document.title,
        revision: document.revision
      };
      this.patch({
        session: restoredSession,
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
    this.patch({ savePhase: "saving", errorMessage: "" });
    try {
      const [snapshot, plainTextRecovery] = await Promise.all([
        this.editor.getSnapshot(),
        this.editor.getPlainText()
      ]);
      const result = await this.api.saveDocument({
        sessionId: session.sessionId,
        ...(session.documentId ? { documentId: session.documentId } : {}),
        title: this.state.title,
        editorEngine: "typie",
        editorEngineCommit: this.editorEngineCommit,
        editorSchemaVersion: this.editorSchemaVersion,
        snapshot,
        plainTextRecovery
      });
      const savedSession: ProjectSession = {
        ...session,
        documentId: result.documentId,
        title: this.state.title,
        revision: result.revision
      };
      this.patch({
        session: savedSession,
        revision: result.revision,
        savePhase:
          this.changeGeneration === generationAtStart ? "saved" : "dirty",
        snapshotBytes: snapshot.byteLength,
        snapshotFingerprint: snapshotFingerprint(snapshot),
        recoveryCharacters: plainTextRecovery.length,
        errorMessage: ""
      });
      return true;
    } catch (error) {
      this.patch({ savePhase: "error", errorMessage: publicError(error) });
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
