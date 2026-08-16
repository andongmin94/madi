import { describe, expect, it, vi } from "vitest";

import type {
  EditorReplacementDocument,
  EditorTextReplacement
} from "../src/renderer/editor/MadiEditorAdapter";
import {
  applyLlmBroadProposal,
  LLM_AI_SAFETY_SNAPSHOT_KIND,
  type LlmAiSafetySnapshotWriter,
  type LlmBroadApplyRuntime
} from "../src/renderer/llm/broadApplyCoordinator";

function runtimeFixture(initialText: string) {
  let text = initialText;
  let generation = 2;
  let revision = 7;
  let composing = false;
  const events: string[] = [];
  const replaceTextRanges = vi.fn(
    async (
      replacements: readonly EditorTextReplacement[]
    ): Promise<EditorReplacementDocument> => {
      events.push("replace");
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
      revision += 1;
      return {
        snapshot: new Uint8Array([1, 2, 3]),
        plainTextRecovery: text,
        semanticSceneBreakCount: text.includes("***") ? 1 : 0
      };
    }
  );
  const runtime: LlmBroadApplyRuntime = {
    adapter: {
      getPlainText: vi.fn(async () => text),
      replaceTextRanges,
      setInteractionEnabled: vi.fn((enabled: boolean) => {
        events.push(enabled ? "unlock" : "lock");
      }),
      focus: vi.fn(() => events.push("focus"))
    },
    getState: () => ({ generation, revision, isComposing: composing })
  };
  return {
    runtime,
    events,
    replaceTextRanges,
    text: () => text,
    setRevision(value: number) {
      revision = value;
    },
    setGeneration(value: number) {
      generation = value;
    },
    setComposing(value: boolean) {
      composing = value;
    }
  };
}

function request(originalText: string, proposalText: string) {
  return {
    expectedGeneration: 2,
    expectedRevision: 7,
    originalText,
    proposalText,
    snapshotName: "AI 다중 문단 적용 전 자동 저장"
  } as const;
}

describe("applyLlmBroadProposal", () => {
  it("creates a durable safety snapshot before one atomic Typie batch", async () => {
    const original = "첫 문단은 느렸다.\n\n둘째 문단은 거칠었다.";
    const proposal = "첫 문단은 차분했다.\n\n둘째 문단은 매끄러웠다.";
    const fixture = runtimeFixture(original);
    const snapshotWriter: LlmAiSafetySnapshotWriter = {
      createSafetySnapshot: vi.fn(async (snapshotRequest) => {
        fixture.events.push("snapshot");
        expect(snapshotRequest).toEqual({
          kind: LLM_AI_SAFETY_SNAPSHOT_KIND,
          name: "AI 다중 문단 적용 전 자동 저장",
          changedBlockCount: 2,
          sourceGeneration: 2,
          sourceRevision: 7
        });
        expect(snapshotRequest).not.toHaveProperty("originalText");
        expect(snapshotRequest).not.toHaveProperty("proposalText");
        return { snapshotId: "snapshot-1", projectRevision: 41 };
      })
    };

    const result = await applyLlmBroadProposal(
      fixture.runtime,
      snapshotWriter,
      request(original, proposal)
    );

    expect(fixture.events).toEqual([
      "snapshot",
      "lock",
      "replace",
      "unlock",
      "focus"
    ]);
    expect(fixture.replaceTextRanges).toHaveBeenCalledTimes(1);
    expect(fixture.replaceTextRanges).toHaveBeenCalledWith([
      expect.objectContaining({ blockIndex: 0 }),
      expect.objectContaining({ blockIndex: 1 })
    ]);
    expect(fixture.text()).toBe(proposal);
    expect(result).toEqual({
      snapshot: { snapshotId: "snapshot-1", projectRevision: 41 },
      generation: 2,
      revision: 8,
      changedBlockCount: 2,
      plainText: proposal
    });
  });

  it("does not mutate when the safety snapshot fails", async () => {
    const original = "첫 문단.\n\n둘째 문단.";
    const proposal = "첫 문장.\n\n둘째 문장.";
    const fixture = runtimeFixture(original);
    const snapshotWriter: LlmAiSafetySnapshotWriter = {
      createSafetySnapshot: vi.fn(async () => {
        throw new Error("disk full");
      })
    };

    await expect(
      applyLlmBroadProposal(
        fixture.runtime,
        snapshotWriter,
        request(original, proposal)
      )
    ).rejects.toMatchObject({ code: "SAFETY_SNAPSHOT_FAILED" });
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
    expect(fixture.text()).toBe(original);
  });

  it("does not mutate when the snapshot receipt is invalid", async () => {
    const original = "첫 문단.\n\n둘째 문단.";
    const proposal = "첫 문장.\n\n둘째 문장.";
    const fixture = runtimeFixture(original);
    const snapshotWriter: LlmAiSafetySnapshotWriter = {
      createSafetySnapshot: vi.fn(async () => ({
        snapshotId: "",
        projectRevision: null
      }))
    };

    await expect(
      applyLlmBroadProposal(
        fixture.runtime,
        snapshotWriter,
        request(original, proposal)
      )
    ).rejects.toMatchObject({ code: "INVALID_SAFETY_SNAPSHOT" });
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
  });

  it("rechecks document identity after snapshot creation", async () => {
    const original = "첫 문단.\n\n둘째 문단.";
    const proposal = "첫 문장.\n\n둘째 문장.";
    const fixture = runtimeFixture(original);
    const snapshotWriter: LlmAiSafetySnapshotWriter = {
      createSafetySnapshot: vi.fn(async () => {
        fixture.setRevision(8);
        return { snapshotId: "snapshot-2", projectRevision: 42 };
      })
    };

    await expect(
      applyLlmBroadProposal(
        fixture.runtime,
        snapshotWriter,
        request(original, proposal)
      )
    ).rejects.toMatchObject({ code: "STALE_AFTER_SNAPSHOT" });
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
  });

  it("rejects structural changes before creating a snapshot", async () => {
    const fixture = runtimeFixture("한 문단");
    const snapshotWriter: LlmAiSafetySnapshotWriter = {
      createSafetySnapshot: vi.fn()
    };

    await expect(
      applyLlmBroadProposal(
        fixture.runtime,
        snapshotWriter,
        request("한 문단", "한 문단\n\n새 문단")
      )
    ).rejects.toMatchObject({ code: "PLAN_REJECTED" });
    expect(snapshotWriter.createSafetySnapshot).not.toHaveBeenCalled();
    expect(fixture.replaceTextRanges).not.toHaveBeenCalled();
  });

  it("rejects active native composition before reading or snapshotting", async () => {
    const fixture = runtimeFixture("첫 문단.\n\n둘째 문단.");
    fixture.setComposing(true);
    const snapshotWriter: LlmAiSafetySnapshotWriter = {
      createSafetySnapshot: vi.fn()
    };

    await expect(
      applyLlmBroadProposal(
        fixture.runtime,
        snapshotWriter,
        request("첫 문단.\n\n둘째 문단.", "첫 문장.\n\n둘째 문장.")
      )
    ).rejects.toMatchObject({ code: "COMPOSITION_ACTIVE" });
    expect(snapshotWriter.createSafetySnapshot).not.toHaveBeenCalled();
    expect(fixture.runtime.adapter.getPlainText).not.toHaveBeenCalled();
  });
});
