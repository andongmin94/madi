import { describe, expect, it } from "vitest";

import { planLlmBroadProposal } from "../src/renderer/llm/broadProposalPlan";

const identity = { generation: 3, revision: 9 } as const;

function plan(
  originalText: string,
  proposalText: string,
  overrides: Partial<Parameters<typeof planLlmBroadProposal>[0]> = {}
) {
  return planLlmBroadProposal({
    expected: identity,
    current: identity,
    currentText: originalText,
    originalText,
    proposalText,
    ...overrides
  });
}

describe("planLlmBroadProposal", () => {
  it("plans changed text in separate paragraphs without flattening structure", () => {
    const original = "첫 문단은 느렸다.\n\n둘째 문단은 거칠었다.";
    const proposal = "첫 문단은 차분했다.\n\n둘째 문단은 매끄러웠다.";
    const result = plan(original, proposal);

    expect(result.status).toBe("READY");
    if (result.status !== "READY") {
      throw new Error(result.message);
    }
    expect(result.blockCount).toBe(2);
    expect(result.changedBlockCount).toBe(2);
    expect(result.requiresSafetySnapshot).toBe(true);
    expect(result.expectedDocumentText).toBe(proposal);
    expect(result.replacements).toEqual([
      expect.objectContaining({
        blockIndex: 0,
        expectedText: "느렸",
        replacement: "차분했"
      }),
      expect.objectContaining({
        blockIndex: 1,
        expectedText: "거칠었",
        replacement: "매끄러웠"
      })
    ]);
  });

  it("preserves semantic scene-break blocks exactly", () => {
    const original = "앞 문단.\n\n***\n\n뒤 문단.";
    const proposal = "앞 문장.\n\n***\n\n뒤 문장.";
    const result = plan(original, proposal);

    expect(result.status).toBe("READY");
    if (result.status !== "READY") {
      throw new Error(result.message);
    }
    expect(result.blockCount).toBe(3);
    expect(result.changedBlockCount).toBe(2);
    expect(result.replacements.every((replacement) => replacement.blockIndex !== 1)).toBe(
      true
    );
    expect(result.expectedDocumentText).toBe(proposal);
  });

  it("rejects added, deleted, moved, or changed structural blocks", () => {
    expect(plan("한 문단", "한 문단\n\n새 문단")).toMatchObject({
      status: "STRUCTURE_MISMATCH"
    });
    expect(plan("앞\n\n***\n\n뒤", "앞\n\n가운데\n\n뒤")).toMatchObject({
      status: "SCENE_BREAK_CHANGED"
    });
    expect(plan("앞\n\n***\n\n뒤", "앞\n\n* * *\n\n뒤")).toMatchObject({
      status: "SCENE_BREAK_CHANGED"
    });
  });

  it("rejects insertion-only and deletion-only paragraph edits", () => {
    expect(plan("문장", "긴 문장")).toMatchObject({
      status: "INSERT_DELETE_UNSUPPORTED"
    });
    expect(plan("긴 문장", "문장")).toMatchObject({
      status: "INSERT_DELETE_UNSUPPORTED"
    });
  });

  it("requires the proposal source to equal the complete active document", () => {
    expect(
      planLlmBroadProposal({
        expected: identity,
        current: identity,
        currentText: "전체 현재 문서",
        originalText: "일부 문서",
        proposalText: "수정 문서"
      })
    ).toMatchObject({ status: "SOURCE_NOT_CURRENT_DOCUMENT" });
  });

  it("invalidates a broad proposal after generation or revision changes", () => {
    expect(
      plan("원문", "제안", {
        current: { generation: 4, revision: 9 }
      })
    ).toMatchObject({ status: "STALE_DOCUMENT" });
    expect(
      plan("원문", "제안", {
        current: { generation: 3, revision: 10 }
      })
    ).toMatchObject({ status: "STALE_DOCUMENT" });
  });

  it("reports an unchanged document instead of creating a no-op transaction", () => {
    expect(plan("그대로인 문단", "그대로인 문단")).toMatchObject({
      status: "NO_CHANGES"
    });
  });
});
