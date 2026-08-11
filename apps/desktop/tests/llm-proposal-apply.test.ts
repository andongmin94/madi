import { describe, expect, it } from "vitest";

import { planLlmProposalApply } from "../src/renderer/llm/proposalApply";

const identity = { generation: 7, revision: 12 } as const;

function plan(overrides: Partial<Parameters<typeof planLlmProposalApply>[0]> = {}) {
  return planLlmProposalApply({
    expected: identity,
    current: identity,
    currentText: "앞 문장 🙂 고칠 문장 뒤 문장",
    originalText: "고칠 문장",
    proposalText: "다듬은 문장",
    ...overrides
  });
}

describe("planLlmProposalApply", () => {
  it("returns Unicode-scalar offsets for one unique text replacement", () => {
    const result = plan();

    expect(result.status).toBe("READY");
    if (result.status !== "READY") {
      throw new Error(result.message);
    }
    expect(result.sourceMode).toBe("UNIQUE_TEXT");
    expect(result.replacement).toEqual({
      id: "llm-proposal-7-12",
      start: 7,
      end: 12,
      expectedText: "고칠 문장",
      replacement: "다듬은 문장"
    });
    expect(result.expectedDocumentText).toBe(
      "앞 문장 🙂 다듬은 문장 뒤 문장"
    );
  });

  it("uses an exact selected range to disambiguate repeated text", () => {
    const result = plan({
      currentText: "같은 문장 / 같은 문장",
      originalText: "같은 문장",
      proposalText: "두 번째 문장",
      sourceRange: {
        start: 8,
        end: 13,
        blockKey: "opaque-node-2"
      }
    });

    expect(result.status).toBe("READY");
    if (result.status !== "READY") {
      throw new Error(result.message);
    }
    expect(result.sourceMode).toBe("EXACT_SELECTION");
    expect(result.replacement).toMatchObject({
      start: 8,
      end: 13,
      expectedText: "같은 문장",
      replacement: "두 번째 문장"
    });
    expect(result.expectedDocumentText).toBe("같은 문장 / 두 번째 문장");
  });

  it("blocks a stale document identity", () => {
    expect(
      plan({ current: { generation: 8, revision: 12 } })
    ).toMatchObject({ status: "STALE_DOCUMENT" });
    expect(
      plan({ current: { generation: 7, revision: 13 } })
    ).toMatchObject({ status: "STALE_DOCUMENT" });
  });

  it("blocks ambiguous and missing source ranges without exact selection data", () => {
    expect(
      plan({
        currentText: "같은 문장 / 같은 문장",
        originalText: "같은 문장"
      })
    ).toMatchObject({ status: "AMBIGUOUS" });
    expect(plan({ originalText: "없는 문장" })).toMatchObject({
      status: "NOT_FOUND"
    });
  });

  it("rejects stale or malformed exact selection data", () => {
    expect(
      plan({
        sourceRange: { start: 0, end: 5, blockKey: "node" }
      })
    ).toMatchObject({ status: "NOT_FOUND" });
    expect(
      plan({
        sourceRange: { start: 7, end: 7, blockKey: "node" }
      })
    ).toMatchObject({ status: "INVALID_SOURCE_RANGE" });
  });

  it("blocks multi-block and semantic scene-break replacements", () => {
    expect(plan({ originalText: "고칠\n문장" })).toMatchObject({
      status: "MULTI_BLOCK_SCOPE"
    });
    expect(plan({ proposalText: "다듬은\n문장" })).toMatchObject({
      status: "MULTI_BLOCK_PROPOSAL"
    });
    expect(
      plan({ currentText: "***", originalText: "***", proposalText: "문장" })
    ).toMatchObject({ status: "SEMANTIC_BOUNDARY" });
  });

  it("blocks empty and unchanged selected reflection instead of deleting silently", () => {
    expect(plan({ proposalText: "" })).toMatchObject({
      status: "EMPTY_PROPOSAL"
    });
    expect(plan({ proposalText: "고칠 문장" })).toMatchObject({
      status: "UNCHANGED"
    });
  });
});
