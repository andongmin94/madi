import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopService,
  type DialogPort
} from "../src/main/desktopService";
import type { CoreClient, CoreMethod } from "../src/main/coreClient";
import { ProjectSessionRegistry } from "../src/main/projectSessions";
import { BUILTIN_READER_PRESETS } from "../src/renderer/components/readerLab/builtinTemplates";
import type { ReaderLabUiState } from "../src/shared/contracts";
import { readerPublication } from "./reader-lab-fixtures";

const FILE_PATH = "C:\\drafts\\reader-lab.madi";
const PROJECT_ID = "project-1";
const UPDATED_AT = "2026-08-09T00:00:00.000Z";
const HASH = "a".repeat(64);

function createHarness(
  responder: (
    method: CoreMethod,
    params: Readonly<Record<string, unknown>>
  ) => unknown | Promise<unknown>
) {
  const request = vi.fn(
    async (
      method: CoreMethod,
      params: Readonly<Record<string, unknown>>
    ): Promise<unknown> => responder(method, params)
  );
  const core: CoreClient = { request, dispose: vi.fn() };
  const sessions = new ProjectSessionRegistry();
  const session = sessions.add({
    filePath: FILE_PATH,
    projectId: PROJECT_ID,
    title: "Reader Lab",
    revision: 5
  });
  const dialog: DialogPort = {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  };
  return {
    request,
    session,
    service: new DesktopService(
      {} as BrowserWindow,
      dialog,
      core,
      sessions,
      "0.0.1"
    )
  };
}

const pane = {
  presetId: null,
  deviceProfileId: "phone-360x720",
  overrides: {},
  zoom: 1,
  scrollProgress: 0
};

const uiState: ReaderLabUiState = {
  lastScopeNodeId: "work-1",
  paneCount: 1,
  panes: [pane, pane, pane],
  scrollSync: true,
  leftPanelWidth: 300,
  rightPanelWidth: 340,
  selectedSourceBlockId: null,
  diagnosticsExpanded: false
};

function presetRecord(revision = 0) {
  const builtin = BUILTIN_READER_PRESETS[0]!;
  return {
    id: "preset-1",
    project_id: PROJECT_ID,
    name: "내 독서환경",
    source_kind: "CUSTOM",
    source_id: builtin.sourceId,
    source_version: "1",
    verification_status: "USER_DEFINED",
    preset_format: "MADI_READER_PRESET",
    preset_version: 1,
    preset_json: {
      ...builtin.config,
      platform: {
        ...builtin.config.platform,
        verificationStatus: "USER_DEFINED" as const
      }
    },
    content_hash: HASH,
    revision,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT
  };
}

describe("Phase 1F DesktopService Reader trust boundary", () => {
  it("validates the core Publication envelope and rejects revision or unknown-field tampering", async () => {
    const document = readerPublication({
      scopeNodeId: "scene-1",
      scopeKind: "SCENE",
      revision: 5
    });
    let responseRevision = 5;
    let tamperDocument = false;
    const { service, session } = createHarness((method) => {
      expect(method).toBe("compile_publication");
      return {
        metadata: { revision: 5 },
        revision: responseRevision,
        document: tamperDocument
          ? { ...document, externalUrl: "https://example.invalid" }
          : document,
        content_hash: HASH,
        diagnostics: [
          {
            code: "UNSUPPORTED_INLINE_MODIFIER",
            severity: "WARNING",
            scene_node_id: "scene-1",
            document_id: "document-1",
            block_id: "source-block-1"
          }
        ],
        compile_timing_ms: 4.25
      };
    });
    const request = {
      sessionId: session.sessionId,
      scopeNodeId: "scene-1",
      expectedProjectRevision: 5
    };

    await expect(service.compilePublication(request)).resolves.toMatchObject({
      document,
      contentHash: HASH,
      compileTimingMs: 4.25,
      revision: 5,
      diagnostics: [
        {
          code: "UNSUPPORTED_INLINE_MODIFIER",
          sceneNodeId: "scene-1"
        }
      ]
    });
    responseRevision = 6;
    await expect(service.compilePublication(request)).rejects.toThrow(
      "mismatched compile publication revisions"
    );
    responseRevision = 5;
    tamperDocument = true;
    await expect(service.compilePublication(request)).rejects.toThrow(
      /runtime validation/
    );
  });

  it("round-trips strict Reader UI state and rejects semantic mutation", async () => {
    let mutate = false;
    const { service, session } = createHarness((method, params) => {
      expect(method).toBe("save_ui_state");
      const value = structuredClone(params.value) as ReaderLabUiState;
      return {
        state: {
          project_id: PROJECT_ID,
          key: "reader-lab.v1",
          value: mutate
            ? { ...value, panes: value.panes.map((item, index) =>
                index === 0 ? { ...item, zoom: 1.25 } : item
              ) }
            : value,
          updated_at: UPDATED_AT
        }
      };
    });
    const input = { sessionId: session.sessionId, state: uiState };
    await expect(service.saveReaderLabUiState(input)).resolves.toBeUndefined();
    mutate = true;
    await expect(service.saveReaderLabUiState(input)).rejects.toThrow(
      "saved different Reader Lab UI state"
    );
  });

  it("parses preset CRUD provenance, duplicate names, revision zero, and no-op", async () => {
    let methodUnderTest: CoreMethod = "list_reader_presets";
    let mismatchVerificationStatus = false;
    const { request, service, session } = createHarness((method) => {
      expect(method).toBe(methodUnderTest);
      if (method === "list_reader_presets") {
        return {
          metadata: { revision: 5 },
          revision: 5,
          presets: [
            mismatchVerificationStatus
              ? {
                  ...presetRecord(),
                  preset_json: {
                    ...presetRecord().preset_json,
                    platform: {
                      ...presetRecord().preset_json.platform,
                      verificationStatus: "GENERIC"
                    }
                  }
                }
              : presetRecord(),
            { ...presetRecord(), id: "preset-2" }
          ],
          duplicate_names: ["내 독서환경"]
        };
      }
      if (method === "update_reader_preset") {
        return {
          metadata: { revision: 5 },
          revision: 5,
          preset: presetRecord(),
          no_op: true
        };
      }
      throw new Error("unexpected method");
    });

    await expect(
      service.listReaderPresets({ sessionId: session.sessionId })
    ).resolves.toMatchObject({
      duplicateNames: ["내 독서환경"],
      revision: 5
    });
    mismatchVerificationStatus = true;
    await expect(
      service.listReaderPresets({ sessionId: session.sessionId })
    ).rejects.toThrow("inconsistent reader preset verification status");
    mismatchVerificationStatus = false;
    methodUnderTest = "update_reader_preset";
    const config = presetRecord().preset_json;
    await expect(
      service.updateReaderPreset({
        sessionId: session.sessionId,
        presetId: "preset-1",
        name: "내 독서환경",
        verificationStatus: "USER_DEFINED",
        config,
        expectedPresetRevision: 0
      })
    ).resolves.toMatchObject({ noOp: true, revision: 5 });
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({
      expected_preset_revision: 0,
      expected_revision: 5
    });
  });
});
