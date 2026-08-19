import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LlmSelectionRewriteOverlay } from "../src/renderer/components/llm/LlmSelectionRewriteOverlay";
import type {
  EditorChange,
  EditorTextReplacement,
  EditorTextSelection,
  MadiEditorAdapter
} from "../src/renderer/editor/MadiEditorAdapter";
import { LlmEditorAccess } from "../src/renderer/llm/editorAccess";
import type { MadiLlmApi } from "../src/shared/llmIpc";

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
  readonly selection: EditorTextSelection;
  readonly replaceTextRanges: ReturnType<typeof vi.fn>;
  emit(change: EditorChange): void;
  text(): string;
}

function editorFixture(
  initialText: string,
  selection: EditorTextSelection,
  revision = 3
): EditorFixture {
  const access = new LlmEditorAccess();
  let listener: ((change: EditorChange) => void) | null = null;
  let text = initialText;
  let currentRevision = 0;
  const notify = (change: EditorChange): void => {
    const currentListener = listener;
    if (currentListener) {
      currentListener(change);
    }
  };
  const replaceTextRanges = vi.fn(
    async (replacements: readonly EditorTextReplacement[]) => {
      const characters = Array.from(text);
      for (const replacement of [...replacements].sort(
        (left, right) => right.start - left.start
      )) {
        expect(
          characters.slice(replacement.start, replacement.end).join("")
        ).toBe(replacement.expectedText);
        characters.splice(
          replacement.start,
          replacement.end - replacement.start,
          ...Array.from(replacement.replacement)
        );
      }
      text = characters.join("");
      currentRevision += 1;
      notify({
        revision: currentRevision,
        reason: "content",
        canUndo: true,
        canRedo: false,
        isComposing: false
      });
      return {
        snapshot: new Uint8Array([4, 5, 6]),
        plainTextRecovery: text,
        semanticSceneBreakCount: 0
      };
    }
  );
  const adapter: MadiEditorAdapter = {
    open: vi.fn(async () => undefined),
    getSnapshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getPlainText: vi.fn(async () => text),
    getTextSelection: vi.fn(() => selection),
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
  currentRevision = revision;
  notify({
    revision,
    reason: "content",
    canUndo: true,
    canRedo: false,
    isComposing: false
  });
  return {
    access,
    adapter,
    selection,
    replaceTextRanges,
    emit(change) {
      currentRevision = change.revision;
      notify(change);
    },
    text() {
      return text;
    }
  };
}

function fakeApi(proposalText: string): MadiLlmApi {
  return {
    getStatus: vi.fn(async () => ({
      providerStore: "AVAILABLE" as const,
      credentialStorage: "AVAILABLE" as const
    })),
    listProviders: vi.fn(async () => [provider]),
    saveProvider: vi.fn(async () => provider),
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
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20
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
    <LlmSelectionRewriteOverlay
      api={api}
      editorAccess={fixture.access}
      createId={() => "request-1"}
      createScopeHash={async () => "a".repeat(64)}
      copyText={vi.fn(async () => undefined)}
      now={() => new Date("2026-08-22T10:00:00.000Z")}
    />
  );
  fireEvent.click(
    screen.getByRole("button", { name: "AI 선택 영역 다듬기" })
  );
  await screen.findByText("테스트 제공자 · example-model");
  await screen.findByDisplayValue(fixture.selection.text);
  const send = screen.getByRole("button", { name: "수정 제안 요청" });
  expect((send as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: /위 선택 원문만 전송/u })
  );
  fireEvent.click(send);
}

describe("LlmSelectionRewriteOverlay", () => {
  it("sends only the exact active selection after explicit consent", async () => {
    const fixture = editorFixture("같은 문장 / 같은 문장", {
      text: "같은 문장",
      start: 8,
      end: 13,
      blockKey: "node-2"
    });
    const api = fakeApi("두 번째 문장");

    await openAndRequest(fixture, api);

    await screen.findByDisplayValue("두 번째 문장");
    expect(api.invoke).toHaveBeenCalledWith({
      invocation: expect.objectContaining({
        providerId: "provider-1",
        task: "REWRITE_SELECTION",
        scope: {
          kind: "SELECTION",
          sourceId: "active-editor:1:3:8:13:node-2",
          manuscriptText: "같은 문장",
          contextText: null
        },
        consent: {
          confirmedAt: "2026-08-22T10:00:00.000Z",
          scopeSha256: "a".repeat(64)
        }
      })
    });
  });

  it("applies the selected duplicate without touching the first occurrence", async () => {
    const fixture = editorFixture("같은 문장 / 같은 문장", {
      text: "같은 문장",
      start: 8,
      end: 13,
      blockKey: "node-2"
    });
    const api = fakeApi("두 번째 문장");
    await openAndRequest(fixture, api);
    await screen.findByDisplayValue("두 번째 문장");

    const apply = await screen.findByRole("button", {
      name: "선택 변경 원고에 적용"
    });
    await waitFor(() =>
      expect((apply as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(apply);

    await screen.findByText(/선택한 변경 조각을 현재 Typie 문서에 적용했습니다/u);
    expect(fixture.text()).toBe("같은 문장 / 두 번째 문장");
    expect(fixture.replaceTextRanges).toHaveBeenCalledWith([
      expect.objectContaining({
        start: 8,
        end: 13,
        expectedText: "같은 문장",
        replacement: "두 번째 문장"
      })
    ]);
  });

  it("lets the author accept only chosen proposal hunks", async () => {
    const original = "그는 천천히 문을 열고 조용히 웃었다.";
    const fixture = editorFixture(original, {
      text: original,
      start: 0,
      end: Array.from(original).length,
      blockKey: "node-1"
    });
    const api = fakeApi("그는 조심스럽게 문을 열고 희미하게 웃었다.");
    await openAndRequest(fixture, api);
    await screen.findByDisplayValue(
      "그는 조심스럽게 문을 열고 희미하게 웃었다."
    );

    const hunkCheckboxes = await screen.findAllByRole("checkbox", {
      name: /변경 조각 \d+ 반영/u
    });
    expect(hunkCheckboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(hunkCheckboxes.at(-1)!);

    const selectedResult = screen.getByLabelText(
      "AI 선택 변경 반영본"
    ) as HTMLTextAreaElement;
    expect(selectedResult.value).not.toBe(original);
    expect(selectedResult.value).not.toBe(
      "그는 조심스럽게 문을 열고 희미하게 웃었다."
    );

    const apply = screen.getByRole("button", {
      name: "선택 변경 원고에 적용"
    });
    await waitFor(() =>
      expect((apply as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(apply);
    await screen.findByText(/현재 Typie 문서에 적용했습니다/u);
    expect(fixture.text()).toBe(selectedResult.value);
  });

  it("invalidates the proposal after a later editor transaction", async () => {
    const original = "그는 천천히 걸었다.";
    const fixture = editorFixture(original, {
      text: original,
      start: 0,
      end: Array.from(original).length,
      blockKey: "node-1"
    });
    const api = fakeApi("그는 조심스럽게 걸었다.");
    await openAndRequest(fixture, api);
    await screen.findByDisplayValue("그는 조심스럽게 걸었다.");

    fixture.emit({
      revision: 4,
      reason: "content",
      canUndo: true,
      canRedo: false,
      isComposing: false
    });

    await screen.findByText(/제안을 만든 뒤 편집 문서가 바뀌었습니다/u);
    expect(
      (screen.getByRole("button", {
        name: "선택 변경 원고에 적용"
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
  });
});
