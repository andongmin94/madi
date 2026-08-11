import { describe, expect, it } from "vitest";

import {
  allLlmProposalHunkIds,
  createLlmProposalReview,
  renderLlmProposalReview
} from "../src/renderer/llm/proposalDiff";

describe("LLM proposal hunk review", () => {
  it("lets independent Korean word changes be accepted separately", () => {
    const review = createLlmProposalReview(
      "그는 천천히 문을 열고 조용히 웃었다.",
      "그는 조심스럽게 문을 열고 희미하게 웃었다."
    );

    expect(review.coarse).toBe(false);
    expect(review.hunks.length).toBeGreaterThanOrEqual(2);
    expect(
      renderLlmProposalReview(review, allLlmProposalHunkIds(review))
    ).toBe("그는 조심스럽게 문을 열고 희미하게 웃었다.");
    expect(renderLlmProposalReview(review, new Set())).toBe(
      "그는 천천히 문을 열고 조용히 웃었다."
    );

    const firstOnly = new Set([review.hunks[0]!.id]);
    const partiallyAccepted = renderLlmProposalReview(review, firstOnly);
    expect(partiallyAccepted).not.toBe(
      "그는 천천히 문을 열고 조용히 웃었다."
    );
    expect(partiallyAccepted).not.toBe(
      "그는 조심스럽게 문을 열고 희미하게 웃었다."
    );
  });

  it("preserves Unicode and punctuation exactly", () => {
    const review = createLlmProposalReview(
      "🙂 그는 말했다… 정말로?",
      "🙂 그는 속삭였다… 정말로!"
    );

    expect(
      renderLlmProposalReview(review, allLlmProposalHunkIds(review))
    ).toBe("🙂 그는 속삭였다… 정말로!");
    expect(renderLlmProposalReview(review, new Set())).toBe(
      "🙂 그는 말했다… 정말로?"
    );
  });

  it("falls back to one bounded coarse hunk for very large selections", () => {
    const original = Array.from({ length: 400 }, (_, index) => `원문${index}`).join(
      " "
    );
    const proposal = Array.from({ length: 400 }, (_, index) =>
      `제안${index}`
    ).join(" ");
    const review = createLlmProposalReview(original, proposal);

    expect(review.coarse).toBe(true);
    expect(review.hunks).toHaveLength(1);
    expect(
      renderLlmProposalReview(review, allLlmProposalHunkIds(review))
    ).toBe(proposal);
  });

  it("returns no hunk for unchanged text", () => {
    const review = createLlmProposalReview("같은 문장", "같은 문장");

    expect(review.hunks).toHaveLength(0);
    expect(renderLlmProposalReview(review, new Set())).toBe("같은 문장");
  });
});
