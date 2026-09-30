import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LlmAssistantOverlay } from "../src/renderer/components/llm/LlmAssistantOverlay";
import type {
  EditorChange,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { LlmEditorAccess } from "../src/renderer/llm/editorAccess";
import type { LlmTaskKind } from "../src/shared/llm";
import type { MadiLlmApi } from "../src/shared/llmIpc";

interface EditorFixture {
  readonly access: LlmEditorAccess;
  readonly adapter: MadiEditorAdapter;
  readonly replaceTextRanges: ReturnType<typeof vi.fn>;
  emit(change: EditorChange): void;
  text(): string;
}

function editorFixture(initialText = "현재 원고 내용"): EditorFixture {
  const access = new LlmEditorAccess();
  let listener: ((change: EditorChange) => void) | null = null;
  const text = initialText;
  const notify = (change: EditorChange): void => {
    const current = listener;
    if (current) {
      current(change);
    }
  };
  const replaceTextRanges = vi.fn(async () => {
    throw new Error("General assistant must not mutate the manuscript");
  });
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array()),
    getPlainText: vi.fn(async () => text),
    replaceTextRanges,
    setInteractionEnabled: vi.fn(),
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
  return {
    access,
    adapter,
    replaceTextRanges,
    emit(change) {
      notify(change);
    },
    text() {
      return text;
    }
  };
}

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

function fakeApi(proposalText = "AI가 제안한 문장"): MadiLlmApi {
  return {
    getStatus: vi.fn(async () => ({
      providerStore: "AVAILABLE" as const,
      credentialStorage: "AVAILABLE" as const
    })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn(async (request) => ({
      config: {
        schemaVersion: 1,
        revision:
          request.expectedRevision === null ? 1 : request.expectedRevision + 1,
        credentialId: request.provider.requiresApiKey
          ? `provider:${request.provider.id}`
          : null,
        ...request.provider
      },
      credentialState: request.provider.requiresApiKey
        ? ("AVAILABLE" as const)
        : ("NOT_REQUIRED" as const)
    })),
    deleteProvider: vi.fn(async () => undefined),
    testProvider: vi.fn(async (request) => ({
      requestId: request.requestId,
      providerId: request.providerId,
      configuredModel: "example-model",
      responseModel: "example-model",
      status: "CONNECTED" as const,
      latencyMs: 1
    })),
    invoke: vi.fn(async (request) => ({
      requestId: request.invocation.requestId,
      providerId: request.invocation.providerId,
      model: "example-model",
      responseId: "response-1",
      text: proposalText,
      finishReason: "stop",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18
      }
    })),
    cancel: vi.fn(async () => ({ cancelled: true }))
  };
}

const SCOPE_PLACEHOLDER =
  "현재 편집 문서를 불러오거나 전송할 텍스트를 직접 입력하세요.";

function normalizeLines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function getScopeInput(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(SCOPE_PLACEHOLDER) as HTMLTextAreaElement;
}

async function openAssistant(
  fixture: EditorFixture,
  api: MadiLlmApi,
  copyText: (value: string) => Promise<void> = vi.fn(async () => undefined)
): Promise<void> {
  render(
    <LlmAssistantOverlay
      api={api}
      editorAccess={fixture.access}
      createId={() => "request-1"}
      createScopeHash={async () => "a".repeat(64)}
      copyText={copyText}
      now={() => new Date("2026-08-22T10:00:00.000Z")}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 보조 열기" }));
  await screen.findByRole("dialog", { name: "madi AI 보조" });
}

async function waitForDefaultProvider(): Promise<void> {
  const providerSelect = (await screen.findByRole("combobox", {
    name: "제공자"
  })) as HTMLSelectElement;
  await waitFor(() => expect(providerSelect.value).toBe("provider-1"));
}

async function requestProposal(
  fixture: EditorFixture,
  api: MadiLlmApi,
  scopeText?: string,
  copyText?: (value: string) => Promise<void>,
  task: LlmTaskKind = "REWRITE_SELECTION"
): Promise<void> {
  await openAssistant(fixture, api, copyText);
  await waitForDefaultProvider();
  fireEvent.change(screen.getByRole("combobox", { name: "작업" }), {
    target: { value: task }
  });
  fireEvent.click(
    screen.getByRole("button", { name: "현재 편집 문서 불러오기" })
  );
  const scope = getScopeInput();
  await waitFor(() =>
    expect(normalizeLines(scope.value)).toBe(fixture.text())
  );
  if (scopeText !== undefined) {
    fireEvent.change(scope, { target: { value: scopeText } });
  }
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: /위 제공자와 원고 범위를 확인했습니다/u
    })
  );
  fireEvent.click(screen.getByRole("button", { name: "제안 요청" }));
}

async function expectProposalText(expected: string): Promise<void> {
  const proposal = await screen.findByLabelText("AI 제안문");
  await waitFor(() =>
    expect(normalizeLines((proposal as HTMLTextAreaElement).value)).toBe(expected)
  );
}

describe("LlmAssistantOverlay", () => {
  it("requires explicit scope confirmation before invoking a provider", async () => {
    const api = fakeApi();
    const fixture = editorFixture();
    await openAssistant(fixture, api);
    await waitForDefaultProvider();

    fireEvent.click(
      screen.getByRole("button", { name: "현재 편집 문서 불러오기" })
    );
    const scope = getScopeInput();
    await waitFor(() => expect(scope.value).toBe("현재 원고 내용"));

    const send = screen.getByRole("button", { name: "제안 요청" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(api.invoke).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /위 제공자와 원고 범위를 확인했습니다/u
      })
    );
    fireEvent.click(send);

    await expectProposalText("AI가 제안한 문장");
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(api.invoke).toHaveBeenCalledWith({
      invocation: expect.objectContaining({
        requestId: "request-1",
        providerId: "provider-1",
        expectedProviderRevision: 2,
        scope: expect.objectContaining({
          sourceId: "active-editor:1:0",
          manuscriptText: "현재 원고 내용",
          contextText: null
        }),
        consent: {
          confirmedAt: "2026-08-22T10:00:00.000Z",
          scopeSha256: "a".repeat(64)
        }
      })
    });
  });

  it.each(["REWRITE_SELECTION", "CUSTOM"] as const)(
    "reviews and copies a unique single-line proposal without mutation: %s",
    async (task) => {
      const fixture = editorFixture("앞 문장 고칠 문장 뒤 문장");
      const api = fakeApi("다듬은 문장");
      const copyText = vi.fn(async () => undefined);
      await requestProposal(fixture, api, "고칠 문장", copyText, task);
      await expectProposalText("다듬은 문장");

      expect(screen.queryByRole("button", { name: /원고에.*적용/u })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "제안문 복사" }));
      await screen.findByText("제안문을 클립보드에 복사했습니다.");
      expect(copyText).toHaveBeenCalledWith("다듬은 문장");
      expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
      expect(fixture.text()).toBe("앞 문장 고칠 문장 뒤 문장");
    }
  );

  it("keeps a reviewed proposal copyable after the active Typie document changes", async () => {
    const fixture = editorFixture("앞 문장 고칠 문장 뒤 문장");
    const api = fakeApi("다듬은 문장");
    await requestProposal(fixture, api, "고칠 문장");
    await expectProposalText("다듬은 문장");

    fixture.emit({
      revision: 1,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    await expectProposalText("다듬은 문장");
    expect(screen.queryByRole("button", { name: /원고에.*적용/u })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "제안문 복사" }));
    await screen.findByText("제안문을 클립보드에 복사했습니다.");
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
  });

  it("keeps multi-block proposals reviewable and copyable without mutation", async () => {
    const fixture = editorFixture("첫 문단\n둘째 문단");
    const api = fakeApi("새 첫 문단\n새 둘째 문단");
    await requestProposal(fixture, api);
    await expectProposalText("새 첫 문단\n새 둘째 문단");

    expect(screen.queryByRole("button", { name: /원고에.*적용/u })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "제안문 복사" }));
    await screen.findByText("제안문을 클립보드에 복사했습니다.");
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
    expect(fixture.text()).toBe("첫 문단\n둘째 문단");
  });

  it("creates a provider without reading a stored API key back into the renderer", async () => {
    const api = fakeApi();
    vi.mocked(api.listProviders).mockResolvedValueOnce([]);
    await openAssistant(editorFixture(), api);
    fireEvent.click(screen.getByRole("button", { name: "제공자 설정" }));
    await screen.findByText("등록된 제공자가 없습니다.");

    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "로컬 모델" }
    });
    fireEvent.change(screen.getByLabelText("모델"), {
      target: { value: "local-model" }
    });
    fireEvent.change(screen.getByLabelText(/OpenAI-compatible Base URL/u), {
      target: { value: "http://127.0.0.1:11434/v1" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "API 키 필요" }));
    fireEvent.click(screen.getByRole("button", { name: "제공자 저장" }));

    await waitFor(() => expect(api.saveProvider).toHaveBeenCalledTimes(1));
    expect(api.saveProvider).toHaveBeenCalledWith({
      provider: expect.objectContaining({
        id: "request-1",
        name: "로컬 모델",
        model: "local-model",
        baseUrl: "http://127.0.0.1:11434/v1",
        requiresApiKey: false
      }),
      expectedRevision: null,
      apiKey: null
    });
    expect(screen.queryByDisplayValue(/private|secret|api-key/iu)).toBeNull();
  });
});
