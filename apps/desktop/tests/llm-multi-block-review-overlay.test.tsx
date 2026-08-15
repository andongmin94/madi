import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LlmMultiBlockReviewOverlay } from "../src/renderer/components/llm/LlmMultiBlockReviewOverlay";
import type {
  EditorChange,
  EditorStructuredSelection,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { LlmEditorAccess } from "../src/renderer/llm/editorAccess";
import type { MadiLlmApi } from "../src/shared/llmIpc";

const selection: EditorStructuredSelection = {
  text: "첫 문단\n\n둘째 문단",
  start: 0,
  end: 11,
  segments: [
    { text: "첫 문단", start: 0, end: 4, nodeKey: "node-1" },
    { text: "둘째 문단", start: 6, end: 11, nodeKey: "node-2" }
  ],
  separators: ["\n\n"]
};

const provider = {
  config: {
    schemaVersion: 1 as const,
    id: "provider-1",
    revision: 2,
    name: "테스트 제공자",
    kind: "OPENAI_COMPATIBLE" as const,
    baseUrl: "https://example.com/v1",
    model: "example-model",
    credentialId: "provider:provider-1",
    requiresApiKey: true,
    timeoutMs: 30_000,
    maxOutputTokens: 2_048,
    temperature: 0.3
  },
  credentialState: "AVAILABLE" as const
};

interface EditorFixture {
  readonly access: LlmEditorAccess;
  readonly adapter: MadiEditorAdapter;
  emit(change: EditorChange): void;
}

function editorFixture(): EditorFixture {
  const access = new LlmEditorAccess();
  let listener: ((change: EditorChange) => void) | null = null;
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array()),
    getPlainText: vi.fn(async () => selection.text),
    getStructuredTextSelection: vi.fn(() => selection),
    focus: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    insertSceneBreak: vi.fn(),
    onChanged: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = null;
      };
    })
  };
  access.attach(adapter);
  listener?.({
    revision: 3,
    reason: "content",
    canUndo: true,
    canRedo: false,
    isComposing: false
  });
  return {
    access,
    adapter,
    emit(change) {
      listener?.(change);
    }
  };
}

function fakeApi(responseText: string): MadiLlmApi {
  return {
    getStatus: vi.fn(async () => ({
      providerStore: "AVAILABLE" as const,
      credentialStorage: "AVAILABLE" as const
    })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn(),
    deleteProvider: vi.fn(),
    testProvider: vi.fn(),
    invoke: vi.fn(async (request) => ({
      requestId: request.invocation.requestId,
      providerId: request.invocation.providerId,
      model: "example-model",
      responseId: "response-1",
      text: responseText,
      finishReason: "stop",
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30
      }
    })),
    cancel: vi.fn(async () => ({ cancelled: true }))
  };
}

async function openAndRequest(
  fixture: EditorFixture,
  api: MadiLlmApi
): Promise<void> {
  render(
    <LlmMultiBlockReviewOverlay
      api={api}
      editorAccess={fixture.access}
      createId={() => "request-1"}
      createScopeHash={async () => "a".repeat(64)}
      copyText={vi.fn(async () => undefined)}
      now={() => new Date("2026-08-22T10:00:00.000Z")}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 다중 문단 검토" }));
  await screen.findByText("테스트 제공자 · example-model");
  await screen.findByDisplayValue(selection.text);
  const send = screen.getByRole("button", { name: "다중 문단 제안 요청" });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: /위 다중 문단 원문만 전송/u })
  );
  fireEvent.click(send);
}

describe("LlmMultiBlockReviewOverlay", () => {
  it("sends only the exact structured selection after explicit consent", async () => {
    const fixture = editorFixture();
    const api = fakeApi("새 첫 문단\n\n새 둘째 문단");

    await openAndRequest(fixture, api);
    await screen.findByDisplayValue("새 첫 문단\n\n새 둘째 문단");

    expect(api.invoke).toHaveBeenCalledWith({
      invocation: expect.objectContaining({
        requestId: "request-1",
        providerId: "provider-1",
        expectedProviderRevision: 2,
        task: "REWRITE_SELECTION",
        scope: {
          kind: "SELECTION",
          sourceId: "active-editor:1:3:structured:0:11:2",
          manuscriptText: selection.text,
          contextText: null
        },
        consent: {
          confirmedAt: "2026-08-22T10:00:00.000Z",
          scopeSha256: "a".repeat(64)
        }
      })
    });
  });

  it("reviews each block and keeps canonical apply disabled before snapshot integration", async () => {
    const fixture = editorFixture();
    const api = fakeApi("새 첫 문단\n\n새 둘째 문단");

    await openAndRequest(fixture, api);
    await screen.findByText(/2개 문단을 원래 구조와 일치하게 분리/u);
    await screen.findByText(/프로젝트 안전 snapshot 경계가 연결되면/u);

    expect(screen.getByText("문단 1")).toBeTruthy();
    expect(screen.getByText("문단 2")).toBeTruthy();
    const hunkChecks = screen.getAllByRole("checkbox", {
      name: /문단 \d+ 변경 조각 \d+ 반영/u
    });
    expect(hunkChecks.length).toBeGreaterThanOrEqual(2);
    const apply = screen.getByRole("button", {
      name: "안전 snapshot 연결 후 적용"
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it("falls back to raw review when the provider changes paragraph structure", async () => {
    const fixture = editorFixture();
    const api = fakeApi("새 첫 문단\n새 둘째 문단");

    await openAndRequest(fixture, api);

    await screen.findByText(/문단 구분을 그대로 유지하지 않아/u);
    expect(screen.getByLabelText("AI 다중 문단 원시 제안문")).toHaveValue(
      "새 첫 문단\n새 둘째 문단"
    );
    expect(
      screen.queryByRole("button", { name: "안전 snapshot 연결 후 적용" })
    ).toBeNull();
  });

  it("invalidates a structurally ready plan after a later editor transaction", async () => {
    const fixture = editorFixture();
    const api = fakeApi("새 첫 문단\n\n새 둘째 문단");
    await openAndRequest(fixture, api);
    await screen.findByText(/프로젝트 안전 snapshot 경계가 연결되면/u);

    fixture.emit({
      revision: 4,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    await waitFor(() =>
      expect(
        screen.getByText(/제안을 만든 뒤 편집 문서가 바뀌었습니다/u)
      ).toBeTruthy()
    );
  });
});
