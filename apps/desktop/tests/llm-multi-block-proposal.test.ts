import { describe, expect, it } from "vitest";

import type { EditorStructuredSelection } from "../src/renderer/editor/MadiEditorAdapter";
import {
  parseLlmMultiBlockProposal,
  planLlmMultiBlockProposal,
  renderLlmMultiBlockProposal
} from "../src/renderer/llm/multiBlockProposal";

const identity = { generation: 4, revision: 9 } as const;
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

describe("multi-block LLM proposal boundary", () => {
  it("parses only a proposal that preserves exact paragraph separators", () => {
    expect(parseLlmMultiBlockProposal(selection, "새 첫 문단\n\n새 둘째 문단")).toEqual({
      status: "READY",
      message: "2개 문단을 원래 구조와 일치하게 분리했습니다.",
      blocks: ["새 첫 문단", "새 둘째 문단"],
      text: "새 첫 문단\n\n새 둘째 문단"
    });

    expect(
      parseLlmMultiBlockProposal(selection, "새 첫 문단\n새 둘째 문단")
    ).toMatchObject({ status: "STRUCTURE_MISMATCH" });
  });

  it("renders selected block results with the original structural separators", () => {
    expect(
      renderLlmMultiBlockProposal(selection, ["첫 문단", "바뀐 둘째 문단"])
    ).toBe("첫 문단\n\n바뀐 둘째 문단");
  });

  it("plans multiple non-overlapping Typie replacements without mutating", () => {
    const plan = planLlmMultiBlockProposal({
      expected: identity,
      current: identity,
      currentText: `머리 ${selection.text} 꼬리`,
      selection: {
        ...selection,
        start: 3,
        end: 14,
        segments: [
          { text: "첫 문단", start: 3, end: 7, nodeKey: "node-1" },
          { text: "둘째 문단", start: 9, end: 14, nodeKey: "node-2" }
        ]
      },
      proposalBlocks: ["새 첫 문단", "새 둘째 문단"]
    });

    expect(plan.status).toBe("READY");
    if (plan.status !== "READY") {
      throw new Error(plan.message);
    }
    expect(plan.changedBlockCount).toBe(2);
    expect(plan.replacements).toEqual([
      {
        id: "llm-multiblock-4-9-0",
        start: 3,
        end: 7,
        expectedText: "첫 문단",
        replacement: "새 첫 문단"
      },
      {
        id: "llm-multiblock-4-9-1",
        start: 9,
        end: 14,
        expectedText: "둘째 문단",
        replacement: "새 둘째 문단"
      }
    ]);
    expect(plan.expectedDocumentText).toBe(
      "머리 새 첫 문단\n\n새 둘째 문단 꼬리"
    );
  });

  it("blocks stale, empty and one-block-only commit plans", () => {
    expect(
      planLlmMultiBlockProposal({
        expected: identity,
        current: { generation: 4, revision: 10 },
        currentText: selection.text,
        selection,
        proposalBlocks: ["새 첫 문단", "새 둘째 문단"]
      })
    ).toMatchObject({ status: "STALE_DOCUMENT" });

    expect(
      planLlmMultiBlockProposal({
        expected: identity,
        current: identity,
        currentText: selection.text,
        selection,
        proposalBlocks: ["", "새 둘째 문단"]
      })
    ).toMatchObject({ status: "EMPTY_BLOCK" });

    expect(
      planLlmMultiBlockProposal({
        expected: identity,
        current: identity,
        currentText: selection.text,
        selection,
        proposalBlocks: ["새 첫 문단", "둘째 문단"]
      })
    ).toMatchObject({ status: "INSUFFICIENT_CHANGES" });
  });

  it("rejects inline-node splits that are not separated by paragraphs", () => {
    expect(
      parseLlmMultiBlockProposal(
        {
          text: "굵은보통",
          start: 0,
          end: 4,
          segments: [
            { text: "굵은", start: 0, end: 2, nodeKey: "bold" },
            { text: "보통", start: 2, end: 4, nodeKey: "plain" }
          ],
          separators: [""]
        },
        "새굵은새보통"
      )
    ).toMatchObject({ status: "INVALID_SELECTION" });
  });
});
