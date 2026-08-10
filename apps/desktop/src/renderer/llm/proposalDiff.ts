const MAX_DIFF_TOKENS = 320;
const MAX_DIFF_MATRIX_CELLS = 80_000;

export interface LlmProposalDiffHunk {
  readonly id: string;
  readonly originalText: string;
  readonly proposalText: string;
}

export type LlmProposalDiffSegment =
  | {
      readonly kind: "EQUAL";
      readonly text: string;
    }
  | {
      readonly kind: "CHANGE";
      readonly hunk: LlmProposalDiffHunk;
    };

export interface LlmProposalReview {
  readonly segments: readonly LlmProposalDiffSegment[];
  readonly hunks: readonly LlmProposalDiffHunk[];
  readonly coarse: boolean;
}

type DiffOperation =
  | { readonly kind: "EQUAL"; readonly text: string }
  | { readonly kind: "DELETE"; readonly text: string }
  | { readonly kind: "INSERT"; readonly text: string };

function tokenize(value: string): string[] {
  return (
    value.match(/\s+|[\p{L}\p{N}\p{M}_]+|[^\p{L}\p{N}\p{M}_\s]+/gu) ??
    []
  );
}

function coarseReview(originalText: string, proposalText: string): LlmProposalReview {
  if (originalText === proposalText) {
    return {
      segments: [{ kind: "EQUAL", text: originalText }],
      hunks: [],
      coarse: true
    };
  }
  const hunk: LlmProposalDiffHunk = {
    id: "hunk-1",
    originalText,
    proposalText
  };
  return {
    segments: [{ kind: "CHANGE", hunk }],
    hunks: [hunk],
    coarse: true
  };
}

function buildOperations(left: readonly string[], right: readonly string[]): DiffOperation[] {
  const columns = right.length + 1;
  const matrix = new Uint16Array((left.length + 1) * columns);
  const at = (row: number, column: number): number => row * columns + column;

  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      matrix[at(row, column)] =
        left[row] === right[column]
          ? matrix[at(row + 1, column + 1)]! + 1
          : Math.max(
              matrix[at(row + 1, column)]!,
              matrix[at(row, column + 1)]!
            );
    }
  }

  const operations: DiffOperation[] = [];
  let row = 0;
  let column = 0;
  while (row < left.length || column < right.length) {
    if (
      row < left.length &&
      column < right.length &&
      left[row] === right[column]
    ) {
      operations.push({ kind: "EQUAL", text: left[row]! });
      row += 1;
      column += 1;
      continue;
    }
    if (
      column < right.length &&
      (row >= left.length ||
        matrix[at(row, column + 1)]! > matrix[at(row + 1, column)]!)
    ) {
      operations.push({ kind: "INSERT", text: right[column]! });
      column += 1;
      continue;
    }
    if (row < left.length) {
      operations.push({ kind: "DELETE", text: left[row]! });
      row += 1;
    }
  }
  return operations;
}

function groupOperations(operations: readonly DiffOperation[]): LlmProposalReview {
  const segments: LlmProposalDiffSegment[] = [];
  const hunks: LlmProposalDiffHunk[] = [];
  let equal = "";
  let deleted = "";
  let inserted = "";

  const flushEqual = (): void => {
    if (equal.length > 0) {
      segments.push({ kind: "EQUAL", text: equal });
      equal = "";
    }
  };
  const flushChange = (): void => {
    if (deleted.length === 0 && inserted.length === 0) {
      return;
    }
    const hunk: LlmProposalDiffHunk = {
      id: `hunk-${hunks.length + 1}`,
      originalText: deleted,
      proposalText: inserted
    };
    hunks.push(hunk);
    segments.push({ kind: "CHANGE", hunk });
    deleted = "";
    inserted = "";
  };

  for (const operation of operations) {
    if (operation.kind === "EQUAL") {
      flushChange();
      equal += operation.text;
    } else {
      flushEqual();
      if (operation.kind === "DELETE") {
        deleted += operation.text;
      } else {
        inserted += operation.text;
      }
    }
  }
  flushChange();
  flushEqual();

  return { segments, hunks, coarse: false };
}

/**
 * Produces a deterministic word/punctuation diff. Large inputs fall back to one
 * coarse hunk so renderer work remains bounded and predictable.
 */
export function createLlmProposalReview(
  originalText: string,
  proposalText: string
): LlmProposalReview {
  if (originalText === proposalText) {
    return {
      segments: [{ kind: "EQUAL", text: originalText }],
      hunks: [],
      coarse: false
    };
  }

  const originalTokens = tokenize(originalText);
  const proposalTokens = tokenize(proposalText);
  if (
    originalTokens.length > MAX_DIFF_TOKENS ||
    proposalTokens.length > MAX_DIFF_TOKENS ||
    (originalTokens.length + 1) * (proposalTokens.length + 1) >
      MAX_DIFF_MATRIX_CELLS
  ) {
    return coarseReview(originalText, proposalText);
  }
  return groupOperations(buildOperations(originalTokens, proposalTokens));
}

export function allLlmProposalHunkIds(
  review: LlmProposalReview
): ReadonlySet<string> {
  return new Set(review.hunks.map((hunk) => hunk.id));
}

export function renderLlmProposalReview(
  review: LlmProposalReview,
  acceptedHunkIds: ReadonlySet<string>
): string {
  return review.segments
    .map((segment) => {
      if (segment.kind === "EQUAL") {
        return segment.text;
      }
      return acceptedHunkIds.has(segment.hunk.id)
        ? segment.hunk.proposalText
        : segment.hunk.originalText;
    })
    .join("");
}
