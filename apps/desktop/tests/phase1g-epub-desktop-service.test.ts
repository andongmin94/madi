import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort,
  type ShellPort
} from "../src/main/desktopService";
import type { CoreClient, CoreMethod } from "../src/main/coreClient";
import type {
  EpubExporterPort,
  EpubExporterRunInput,
  EpubUtilityResult
} from "../src/main/epubExportClient";
import { EpubExportCancelledError } from "../src/main/epubExportClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import type {
  EpubExportPresetConfig,
  PublicationExportMetadata,
  RunEpubExportRequest,
  ValidateEpubExportRequest
} from "../src/shared/epubExport";
import type { PublicationDocument } from "../src/shared/publication";
import { readerPublication } from "./reader-lab-fixtures";

const NOW = "2026-08-09T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);
const LOGICAL_HASH = "b".repeat(64);
const OPERATION_1 = "123e4567-e89b-42d3-a456-426614174000";
const OPERATION_2 = "123e4567-e89b-42d3-a456-426614174001";
const OPERATION_3 = "123e4567-e89b-42d3-a456-426614174002";
const GENERATED_EPUB = Buffer.from("content-free EPUB fixture", "utf8");
const COVER_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);
const temporaryDirectories: string[] = [];

const CONFIG: EpubExportPresetConfig = {
  formatVersion: 1,
  targetProfile: "EPUB_3_3_COMPATIBILITY",
  splitMode: "CHAPTER",
  tocDepth: 3,
  includeChapterTitles: true,
  includeSceneTitles: true,
  sceneBreakStyleToken: "ORNAMENT",
  bodyStyleToken: "REFLOWABLE_PROSE",
  includeCover: false,
  stylesheetToken: "MADI_CLASSIC"
};

const METADATA: PublicationExportMetadata = {
  projectId: "project-1",
  publicationTitle: "테스트 작품",
  creatorName: "테스트 작가",
  language: "ko",
  identifier: "urn:madi:test:project-1",
  publisher: null,
  description: null,
  rights: null,
  subjects: [],
  coverAssetId: null,
  createdAt: NOW,
  updatedAt: NOW
};

const ALTERNATE_CONFIG: EpubExportPresetConfig = {
  ...CONFIG,
  splitMode: "SCENE",
  sceneBreakStyleToken: "RULE"
};

function persistedMetadata(): Record<string, unknown> {
  return {
    project_id: METADATA.projectId,
    publication_title: METADATA.publicationTitle,
    creator_name: METADATA.creatorName,
    language: METADATA.language,
    identifier: METADATA.identifier,
    publisher: METADATA.publisher,
    description: METADATA.description,
    rights: METADATA.rights,
    subjects: METADATA.subjects,
    cover_asset_id: METADATA.coverAssetId,
    created_at: METADATA.createdAt,
    updated_at: METADATA.updatedAt
  };
}

function persistedCover(input: {
  readonly id: string;
  readonly projectId?: string;
  readonly sha256?: string;
  readonly bytes?: Uint8Array;
}): Record<string, unknown> {
  const bytes = Buffer.from(input.bytes ?? COVER_BYTES);
  return {
    id: input.id,
    project_id: input.projectId ?? METADATA.projectId,
    kind: "COVER",
    media_type: "image/png",
    original_name: "cover.png",
    sha256: input.sha256 ?? sha256(bytes),
    bytes_base64: bytes.toString("base64"),
    byte_length: bytes.byteLength,
    width: 1,
    height: 1,
    created_at: NOW,
    updated_at: NOW
  };
}

function persistedPreset(input: {
  readonly id: string;
  readonly name: string;
  readonly config: EpubExportPresetConfig;
  readonly revision: number;
  readonly projectId?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    project_id: input.projectId ?? METADATA.projectId,
    kind: "EPUB",
    name: input.name,
    preset_format: "MADI_EXPORT_PRESET",
    preset_version: 1,
    preset_json: input.config,
    content_hash: "c".repeat(64),
    revision: input.revision,
    created_at: NOW,
    updated_at: NOW
  };
}

function mutationResponse(
  revision: number,
  fields: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return {
    metadata: { revision },
    ...fields,
    revision
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utilityResult(
  input: EpubExporterRunInput,
  document: PublicationDocument,
  bytes = GENERATED_EPUB
): EpubUtilityResult {
  const blocks = document.sections.flatMap((section) => section.blocks);
  return {
    mode: input.mode,
    outputPath: input.mode === "EXPORT" ? input.outputPath : null,
    summary: {
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      logicalPackageHash: LOGICAL_HASH,
      targetProfile: input.config.targetProfile,
      sourcePublicationHash: input.sourcePublicationHash,
      validationReport: {
        status: "PASS",
        fatalCount: 0,
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        messages: []
      },
      exportTiming: {
        contentSplitMs: 1,
        xhtmlGenerationMs: 1,
        packageDocumentsMs: 1,
        zipPackagingMs: 1,
        internalValidationMs: 1,
        totalMs: 5
      },
      statistics: {
        fileCount: 5,
        xhtmlCount: document.sections.length,
        sourceSectionCount: document.sections.length,
        exportedSectionCount: document.sections.length,
        sourceBlockCount: blocks.length,
        exportedBlockCount: blocks.length,
        fallbackBlockCount: 0,
        rejectedBlockCount: 0,
        sourceCharacterCount: document.stats.withSpaces,
        exportedCharacterCount: document.stats.withSpaces,
        sceneBreakCount: blocks.filter((block) => block.kind === "SCENE_BREAK").length,
        rubyCount: 0,
        headingCount: blocks.filter((block) => block.kind === "HEADING").length,
        coverIncluded: false
      }
    }
  };
}

type UtilityTransform = (
  result: EpubUtilityResult,
  input: EpubExporterRunInput
) => EpubUtilityResult;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function exportStateResponse(): Record<string, unknown> {
  return {
    metadata: { revision: 5 },
    revision: 5,
    publication_metadata: persistedMetadata(),
    cover_asset: null,
    export_presets: []
  };
}

function compileResponse(document: PublicationDocument): Record<string, unknown> {
  return {
    metadata: { revision: 5 },
    revision: 5,
    document,
    content_hash: SOURCE_HASH,
    diagnostics: [],
    compile_timing_ms: 1
  };
}

function createHarness(transform: UtilityTransform = (result) => result) {
  const document = readerPublication({ revision: 5 });
  const request = vi.fn(
    async (
      method: CoreMethod,
      _params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => {
      if (method === "get_publication_export_state") {
        return exportStateResponse();
      }
      if (method === "compile_publication") {
        return compileResponse(document);
      }
      throw new Error(`Unexpected core method: ${method}`);
    }
  );
  const core: CoreClient = { request, dispose: vi.fn() };
  const sessions = new ProjectSessionRegistry();
  const session = sessions.add({
    filePath: "C:\\drafts\\phase1g.madi",
    projectId: "project-1",
    title: "테스트 작품",
    revision: 5
  });
  const otherSession = sessions.add({
    filePath: "C:\\drafts\\other.madi",
    projectId: "project-2",
    title: "다른 작품",
    revision: 5
  });
  const showSaveDialog = vi.fn<DialogPort["showSaveDialog"]>(async () => ({
    canceled: true
  }));
  const showOpenDialog = vi.fn<DialogPort["showOpenDialog"]>(async () => ({
    canceled: true,
    filePaths: []
  }));
  const dialog: DialogPort = {
    showSaveDialog,
    showOpenDialog
  };
  const run = vi.fn(
    async (input: EpubExporterRunInput): Promise<EpubUtilityResult> => {
      if (input.mode === "EXPORT") {
        await writeFile(input.outputPath, GENERATED_EPUB);
      }
      return transform(utilityResult(input, document), input);
    }
  );
  const cancel = vi.fn(async () => false);
  const exporter: EpubExporterPort = {
    run,
    cancel,
    dispose: vi.fn(async () => undefined)
  };
  const send = vi.fn();
  const window = { webContents: { send } } as unknown as BrowserWindow;
  const shell: ShellPort = { showItemInFolder: vi.fn() };
  return {
    cancel,
    dialog,
    document,
    exporter,
    otherSession,
    request,
    run,
    session,
    sessions,
    shell,
    showOpenDialog,
    showSaveDialog,
    service: new DesktopService(
      window,
      dialog,
      core,
      sessions,
      "0.0.1",
      exporter,
      shell
    )
  };
}

function validateRequest(
  sessionId: string,
  operationId: string
): ValidateEpubExportRequest {
  return {
    sessionId,
    operationId,
    scopeNodeId: "scene-1",
    expectedProjectRevision: 5,
    metadata: METADATA,
    config: CONFIG
  };
}

async function chooseOutput(
  harness: ReturnType<typeof createHarness>,
  filePath: string
): Promise<string> {
  harness.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath });
  const selection = await harness.service.chooseEpubOutput({
    sessionId: harness.session.sessionId,
    suggestedFileName: path.basename(filePath)
  });
  if (!selection) {
    throw new Error("Expected an EPUB output selection");
  }
  return selection.selectionId;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "madi-epub-service-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function expectRejectedWithoutRevisionChange(
  harness: ReturnType<typeof createHarness>,
  operation: Promise<unknown>
): Promise<void> {
  await expect(operation).rejects.toThrow();
  expect(
    harness.sessions.require(harness.session.sessionId).revision
  ).toBe(harness.session.revision);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Phase 1G DesktopService EPUB trust boundary", () => {
  it.each([
    {
      label: "different editable content",
      publicationTitle: "변조된 작품",
      noOp: false,
      revision: 6
    },
    {
      label: "a no-op paired with an incremented project revision",
      publicationTitle: METADATA.publicationTitle,
      noOp: true,
      revision: 6
    },
    {
      label: "a mutation paired with an unchanged project revision",
      publicationTitle: METADATA.publicationTitle,
      noOp: false,
      revision: 5
    }
  ])(
    "rejects metadata mutation response tampering: $label",
    async ({ publicationTitle, noOp, revision }) => {
      const harness = createHarness();
      harness.request.mockImplementation(async (method) => {
        if (method !== "update_publication_metadata") {
          throw new Error(`Unexpected core method: ${method}`);
        }
        return mutationResponse(revision, {
          publication_metadata: {
            ...persistedMetadata(),
            publication_title: publicationTitle
          },
          no_op: noOp
        });
      });

      await expectRejectedWithoutRevisionChange(
        harness,
        harness.service.updatePublicationMetadata({
          sessionId: harness.session.sessionId,
          publicationTitle: METADATA.publicationTitle,
          creatorName: METADATA.creatorName,
          language: METADATA.language,
          identifier: METADATA.identifier,
          publisher: METADATA.publisher,
          description: METADATA.description,
          rights: METADATA.rights,
          subjects: METADATA.subjects
        })
      );
    }
  );

  it.each([
    { label: "cross-project cover", tamper: "PROJECT" },
    { label: "different cover identity", tamper: "ID" },
    { label: "different cover hash", tamper: "HASH" }
  ] as const)(
    "rejects set-cover response tampering: $label",
    async ({ tamper }) => {
      const directory = await makeTemporaryDirectory();
      const coverPath = path.join(directory, "cover.png");
      await writeFile(coverPath, COVER_BYTES);
      const harness = createHarness();
      harness.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: [coverPath]
      });
      harness.request.mockImplementation(async (method, params) => {
        if (method === "get_publication_export_state") {
          return exportStateResponse();
        }
        if (method !== "set_publication_cover") {
          throw new Error(`Unexpected core method: ${method}`);
        }
        const requestedId = String(params.asset_id);
        const returnedId = tamper === "ID" ? "different-cover" : requestedId;
        return mutationResponse(6, {
          asset: persistedCover({
            id: returnedId,
            ...(tamper === "PROJECT" ? { projectId: "project-2" } : {}),
            ...(tamper === "HASH" ? { sha256: "f".repeat(64) } : {})
          }),
          publication_metadata: {
            ...persistedMetadata(),
            cover_asset_id: returnedId
          },
          no_op: false
        });
      });

      await expectRejectedWithoutRevisionChange(
        harness,
        harness.service.choosePublicationCover({
          sessionId: harness.session.sessionId
        })
      );
    }
  );

  it("rejects a remove-cover response for a different deleted asset", async () => {
    const harness = createHarness();
    const coverId = "cover-1";
    harness.request.mockImplementation(async (method) => {
      if (method === "get_publication_export_state") {
        return {
          ...exportStateResponse(),
          publication_metadata: {
            ...persistedMetadata(),
            cover_asset_id: coverId
          },
          cover_asset: persistedCover({ id: coverId })
        };
      }
      if (method !== "remove_publication_cover") {
        throw new Error(`Unexpected core method: ${method}`);
      }
      return mutationResponse(6, {
        deleted_asset_id: "different-cover",
        publication_metadata: persistedMetadata(),
        no_op: false
      });
    });

    await expectRejectedWithoutRevisionChange(
      harness,
      harness.service.removePublicationCover({
        sessionId: harness.session.sessionId
      })
    );
  });

  it("rejects duplicate identities in the EPUB preset state", async () => {
    const harness = createHarness();
    const duplicatePreset = persistedPreset({
      id: "preset-1",
      name: "중복 프리셋",
      config: CONFIG,
      revision: 0
    });
    harness.request.mockResolvedValue({
      ...exportStateResponse(),
      export_presets: [duplicatePreset, duplicatePreset]
    });

    await expectRejectedWithoutRevisionChange(
      harness,
      harness.service.getPublicationExportState({
        sessionId: harness.session.sessionId
      })
    );
  });

  const presetMutationCases = (
    ["CREATE", "UPDATE", "DUPLICATE"] as const
  ).flatMap((mutation) =>
    (["ID", "NAME", "CONFIG", "PRESET_REVISION", "PROJECT_REVISION"] as const).map(
      (tamper) => ({ mutation, tamper })
    )
  );

  it.each(presetMutationCases)(
    "rejects $mutation preset response tampering: $tamper",
    async ({ mutation, tamper }) => {
      const harness = createHarness();
      const targetPresetId = "target-preset";
      const sourcePresetId = "source-preset";
      harness.request.mockImplementation(async (method, params) => {
        if (method === "get_publication_export_state" && mutation === "DUPLICATE") {
          return {
            ...exportStateResponse(),
            export_presets: [
              persistedPreset({
                id: sourcePresetId,
                name: "원본 프리셋",
                config: CONFIG,
                revision: 3
              })
            ]
          };
        }

        const expectedMethod =
          mutation === "CREATE"
            ? "create_export_preset"
            : mutation === "UPDATE"
              ? "update_export_preset"
              : "duplicate_export_preset";
        if (method !== expectedMethod) {
          throw new Error(`Unexpected core method: ${method}`);
        }
        const expectedId =
          mutation === "UPDATE" ? targetPresetId : String(params.preset_id);
        const expectedName =
          mutation === "CREATE"
            ? "새 프리셋"
            : mutation === "UPDATE"
              ? "갱신 프리셋"
              : "복제 프리셋";
        const expectedPresetRevision = mutation === "UPDATE" ? 4 : 0;
        const projectRevision = tamper === "PROJECT_REVISION" ? 7 : 6;
        return mutationResponse(projectRevision, {
          preset: persistedPreset({
            id: tamper === "ID" ? "different-target" : expectedId,
            name: tamper === "NAME" ? "변조된 이름" : expectedName,
            config: tamper === "CONFIG" ? ALTERNATE_CONFIG : CONFIG,
            revision:
              tamper === "PRESET_REVISION"
                ? expectedPresetRevision + 1
                : expectedPresetRevision
          }),
          no_op: false
        });
      });

      const operation =
        mutation === "CREATE"
          ? harness.service.createEpubExportPreset({
              sessionId: harness.session.sessionId,
              name: "새 프리셋",
              config: CONFIG
            })
          : mutation === "UPDATE"
            ? harness.service.updateEpubExportPreset({
                sessionId: harness.session.sessionId,
                presetId: targetPresetId,
                name: "갱신 프리셋",
                config: CONFIG,
                expectedPresetRevision: 3
              })
            : harness.service.duplicateEpubExportPreset({
                sessionId: harness.session.sessionId,
                sourcePresetId,
                name: "복제 프리셋"
              });

      await expectRejectedWithoutRevisionChange(harness, operation);
    }
  );

  it.each([
    { label: "different preset identity", deletedPresetId: "preset-2", revision: 6 },
    { label: "invalid project revision", deletedPresetId: "preset-1", revision: 7 }
  ])("rejects delete-preset response tampering: $label", async (tamper) => {
    const harness = createHarness();
    harness.request.mockResolvedValue(
      mutationResponse(tamper.revision, {
        deleted_preset_id: tamper.deletedPresetId
      })
    );

    await expectRejectedWithoutRevisionChange(
      harness,
      harness.service.deleteEpubExportPreset({
        sessionId: harness.session.sessionId,
        presetId: "preset-1",
        expectedPresetRevision: 3
      })
    );
  });

  it("waits for tracked auxiliary IPC durability before shutdown resolves", async () => {
    const harness = createHarness();
    const auxiliaryStarted = deferred<void>();
    const auxiliaryCompletion = deferred<void>();
    const auxiliary = harness.service.runEpubIpcTask(async () => {
      auxiliaryStarted.resolve(undefined);
      await auxiliaryCompletion.promise;
    });
    await auxiliaryStarted.promise;
    let shutdownSettled = false;

    const shutdown = harness.service.prepareEpubShutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(shutdownSettled).toBe(false);
    await expect(
      harness.service.runEpubIpcTask(async () => undefined)
    ).rejects.toThrow("shutting down");
    auxiliaryCompletion.resolve(undefined);
    await auxiliary;
    await shutdown;
    expect(shutdownSettled).toBe(true);
  });

  it("waits for PREPARING completion, blocks utility launch, and rejects new work during shutdown", async () => {
    const harness = createHarness();
    const compileStarted = deferred<void>();
    const compileCompletion = deferred<unknown>();
    harness.request.mockImplementation(async (method) => {
      if (method === "get_publication_export_state") {
        return exportStateResponse();
      }
      if (method === "compile_publication") {
        compileStarted.resolve(undefined);
        return compileCompletion.promise;
      }
      throw new Error(`Unexpected core method: ${method}`);
    });
    const operation = harness.service.validateEpubExport(
      validateRequest(harness.session.sessionId, OPERATION_1)
    );
    void operation.catch(() => undefined);
    await compileStarted.promise;
    let shutdownSettled = false;

    const shutdown = harness.service.prepareEpubShutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(shutdownSettled).toBe(false);
    expect(harness.run).not.toHaveBeenCalled();
    await expect(
      harness.service.validateEpubExport(
        validateRequest(harness.session.sessionId, OPERATION_2)
      )
    ).rejects.toThrow("shutting down");

    compileCompletion.resolve(compileResponse(harness.document));
    await expect(operation).rejects.toThrow("cancelled");
    await expect(shutdown).resolves.toBeUndefined();
    expect(shutdownSettled).toBe(true);
    expect(harness.run).not.toHaveBeenCalled();
  });

  it("waits for EXPORTING cancellation and service completion before shutdown resolves", async () => {
    const harness = createHarness();
    const runStarted = deferred<EpubExporterRunInput>();
    const runCompletion = deferred<EpubUtilityResult>();
    const cancelCompletion = deferred<boolean>();
    harness.run.mockImplementation(async (input) => {
      runStarted.resolve(input);
      return runCompletion.promise;
    });
    harness.cancel.mockImplementation(() => cancelCompletion.promise);
    const operation = harness.service.validateEpubExport(
      validateRequest(harness.session.sessionId, OPERATION_1)
    );
    void operation.catch(() => undefined);
    await runStarted.promise;
    let shutdownSettled = false;

    const shutdown = harness.service.prepareEpubShutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(harness.cancel).toHaveBeenCalledWith(OPERATION_1);
    expect(shutdownSettled).toBe(false);

    cancelCompletion.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    runCompletion.reject(new Error("The utility closed after cancellation"));
    await expect(operation).rejects.toThrow("closed after cancellation");
    await expect(shutdown).resolves.toBeUndefined();
    expect(shutdownSettled).toBe(true);
  });

  it("tombstones a completed operation UUID so it cannot be reused", async () => {
    const harness = createHarness();
    const request = validateRequest(harness.session.sessionId, OPERATION_1);

    await expect(harness.service.validateEpubExport(request)).resolves.toMatchObject({
      operationId: OPERATION_1,
      sourcePublicationHash: SOURCE_HASH
    });
    await expect(harness.service.validateEpubExport(request)).rejects.toThrow(
      "already used"
    );
    expect(harness.run).toHaveBeenCalledTimes(1);
  });

  it("commits only verified staged bytes and binds report/reveal to the session", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    const request: RunEpubExportRequest = {
      ...validateRequest(harness.session.sessionId, OPERATION_1),
      outputSelectionId: selectionId
    };

    await expect(harness.service.runEpubExport(request)).resolves.toMatchObject({
      status: "COMPLETED",
      operationId: OPERATION_1,
      byteLength: GENERATED_EPUB.byteLength,
      sha256: sha256(GENERATED_EPUB)
    });
    await expect(readFile(destination)).resolves.toEqual(GENERATED_EPUB);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_1}`))
    ).toBe(false);

    await expect(
      harness.service.saveEpubExportReport({
        sessionId: harness.otherSession.sessionId,
        operationId: OPERATION_1,
        format: "JSON"
      })
    ).rejects.toThrow("report is unavailable");
    await expect(
      harness.service.revealEpubExport({
        sessionId: harness.otherSession.sessionId,
        operationId: OPERATION_1
      })
    ).resolves.toBe(false);
    await expect(
      harness.service.revealEpubExport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_1
      })
    ).resolves.toBe(true);
    expect(harness.shell.showItemInFolder).toHaveBeenCalledWith(destination);
  });

  it("resolves only typed user cancellation as a structured export outcome", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    const runStarted = deferred<void>();
    const runCompletion = deferred<EpubUtilityResult>();
    harness.run.mockImplementation(async () => {
      runStarted.resolve(undefined);
      return runCompletion.promise;
    });
    harness.cancel.mockImplementation(async () => {
      runCompletion.reject(new EpubExportCancelledError());
      return true;
    });
    const operation = harness.service.runEpubExport({
      ...validateRequest(harness.session.sessionId, OPERATION_2),
      outputSelectionId: selectionId
    });
    await runStarted.promise;

    await expect(
      harness.service.cancelEpubExport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_2
      })
    ).resolves.toBe(true);
    await expect(operation).resolves.toEqual({
      status: "CANCELLED",
      operationId: OPERATION_2
    });
    expect(existsSync(destination)).toBe(false);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_2}`))
    ).toBe(false);
  });

  it("does not swallow a non-typed error with cancellation-like text", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    harness.run.mockRejectedValueOnce(
      new Error("The EPUB export was cancelled")
    );

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_3),
        outputSelectionId: selectionId
      })
    ).rejects.toThrow("cancelled");
    expect(existsSync(destination)).toBe(false);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_3}`))
    ).toBe(false);
  });

  it("returns a typed failure when a file appears after output selection", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    const interveningBytes = Buffer.from("new destination owner", "utf8");
    await writeFile(destination, interveningBytes);

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_2),
        outputSelectionId: selectionId
      })
    ).resolves.toEqual({
      status: "FAILED",
      operationId: OPERATION_2,
      code: "DESTINATION_CHANGED"
    });
    await expect(readFile(destination)).resolves.toEqual(interveningBytes);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_2}`))
    ).toBe(false);
  });

  it("replaces only the exact existing destination confirmed by the dialog", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const originalBytes = Buffer.from("confirmed existing publication", "utf8");
    await writeFile(destination, originalBytes);
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_2),
        outputSelectionId: selectionId
      })
    ).resolves.toMatchObject({ sha256: sha256(GENERATED_EPUB) });
    await expect(readFile(destination)).resolves.toEqual(GENERATED_EPUB);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_2}`))
    ).toBe(false);
  });

  it("restores a destination that changed after overwrite confirmation", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    await writeFile(destination, Buffer.from("confirmed bytes", "utf8"));
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    const changedBytes = Buffer.from("changed after confirmation", "utf8");
    await writeFile(destination, changedBytes);

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_3),
        outputSelectionId: selectionId
      })
    ).rejects.toThrow("changed during export");
    await expect(readFile(destination)).resolves.toEqual(changedBytes);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_3}`))
    ).toBe(false);
  });

  it("preserves a foreign operation directory collision", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const operationDirectory = path.join(
      directory,
      `.madi-epub-operation-${OPERATION_3}`
    );
    const markerPath = path.join(operationDirectory, "foreign-owner.txt");
    const marker = Buffer.from("foreign operation directory", "utf8");
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    await mkdir(operationDirectory);
    await writeFile(markerPath, marker);

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_3),
        outputSelectionId: selectionId
      })
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(markerPath)).resolves.toEqual(marker);
    expect(existsSync(destination)).toBe(false);
  });

  it("rejects a staged SHA mismatch without replacing an existing destination", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const originalBytes = Buffer.from("existing publication", "utf8");
    await writeFile(destination, originalBytes);
    const harness = createHarness((result) => ({
      ...result,
      summary: {
        ...result.summary,
        sha256: "f".repeat(64)
      }
    }));
    const selectionId = await chooseOutput(harness, destination);

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_3),
        outputSelectionId: selectionId
      })
    ).rejects.toThrow("does not match");
    await expect(readFile(destination)).resolves.toEqual(originalBytes);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_3}`))
    ).toBe(false);
  });

  it("rejects utility-reported content loss before committing output", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const harness = createHarness((result) => ({
      ...result,
      summary: {
        ...result.summary,
        statistics: {
          ...result.summary.statistics,
          exportedBlockCount: result.summary.statistics.exportedBlockCount - 1,
          rejectedBlockCount: 1
        }
      }
    }));
    const selectionId = await chooseOutput(harness, destination);

    await expect(
      harness.service.runEpubExport({
        ...validateRequest(harness.session.sessionId, OPERATION_2),
        outputSelectionId: selectionId
      })
    ).rejects.toThrow("content loss");
    expect(existsSync(destination)).toBe(false);
    expect(
      existsSync(path.join(directory, `.madi-epub-operation-${OPERATION_2}`))
    ).toBe(false);
  });

  it("requires the exact confirmed extension and atomically replaces a report", async () => {
    const directory = await makeTemporaryDirectory();
    const destination = path.join(directory, "publication.epub");
    const harness = createHarness();
    const selectionId = await chooseOutput(harness, destination);
    await harness.service.runEpubExport({
      ...validateRequest(harness.session.sessionId, OPERATION_1),
      outputSelectionId: selectionId
    });
    expect(harness.showSaveDialog.mock.calls[0]?.[1]).toMatchObject({
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });

    const derivedReport = path.join(directory, "report.json");
    const originalReport = Buffer.from("existing report owner", "utf8");
    await writeFile(derivedReport, originalReport);
    harness.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(directory, "report")
    });
    await expect(
      harness.service.saveEpubExportReport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_1,
        format: "JSON"
      })
    ).rejects.toThrow("must use the .json extension");
    await expect(readFile(derivedReport)).resolves.toEqual(originalReport);

    harness.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: derivedReport
    });
    await expect(
      harness.service.saveEpubExportReport({
        sessionId: harness.session.sessionId,
        operationId: OPERATION_1,
        format: "JSON"
      })
    ).resolves.toMatchObject({ fileName: "report.json" });
    expect(JSON.parse(await readFile(derivedReport, "utf8"))).toMatchObject({
      formatVersion: 1,
      validation: { status: "VALID" }
    });
    expect(harness.showSaveDialog.mock.calls[2]?.[1]).toMatchObject({
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
  });

  it("does not derive an overwrite target from an extensionless dialog result", async () => {
    const directory = await makeTemporaryDirectory();
    const derivedDestination = path.join(directory, "book.epub");
    const original = Buffer.from("existing EPUB owner", "utf8");
    await writeFile(derivedDestination, original);
    const harness = createHarness();
    harness.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(directory, "book")
    });

    await expect(
      harness.service.chooseEpubOutput({
        sessionId: harness.session.sessionId,
        suggestedFileName: "book.epub"
      })
    ).rejects.toThrow("must use the .epub extension");
    await expect(readFile(derivedDestination)).resolves.toEqual(original);
  });
});
