# ADR-0015 — Multi-block AI review precedes snapshot-gated apply

## Status

Accepted for private-local Phase 1I-G development.

## Context

The pinned Typie replacement command can validate and commit multiple non-overlapping text-node replacements in one transaction. That engine capability alone is not sufficient to authorize a product workflow that changes several semantic blocks. A provider response may be structurally valid but editorially wrong, and the existing narrow `Ctrl+Z` contract is not a durable project-level recovery record after save, close or later edits.

Phase 1I-F established exact same-node selection mapping and per-hunk review. The next layer needs exact multi-paragraph mapping and block-level review before connecting any broad mutation path.

## Decision

1. Madi adds an engine-independent structured selection contract made of exact annotated-prose scalar ranges, opaque text-node keys and preserved structural separators.
2. The Typie adapter locates the actual live selection by round-tripping candidate ranges through Typie and comparing CRDT endpoints; repeated text is not resolved by first-match heuristics.
3. Structured mapping is bounded to 20,000 Unicode scalars and 64 text-node segments.
4. The Phase 1I-G product workflow accepts only 2–32 text segments separated by line or paragraph separators. Multiple inline nodes inside one paragraph are not treated as independent editable blocks.
5. The provider receives the exact selected text only after one-request consent. It is instructed to preserve the original block count and exact separators.
6. A response whose paragraph separators differ remains raw review/copy output and cannot produce an application plan.
7. Each structurally matched block receives an independent bounded hunk review. The author may include or exclude each hunk and inspect the reconstructed full proposal.
8. Madi rereads the active Typie document and verifies generation, revision, every source scalar range and every expected block before reporting that a multi-block plan is structurally ready.
9. Phase 1I-G does **not** execute that plan. The apply control remains disabled until an automatic pre-apply logical snapshot and direct restore path are connected.
10. The future mutation boundary must create a project-level safety snapshot before calling one all-or-nothing Typie multi-replacement transaction.
11. Prompts, API keys, provider response bodies and accepted hunk text are not stored in the safety snapshot metadata.
12. Cross-document and project-wide AI mutation remains out of scope.

## Consequences

### Positive

- multi-paragraph review becomes useful without weakening the canonical manuscript boundary
- repeated text is mapped by live Typie identity rather than occurrence order
- block structure and blank-line separators are explicit and testable
- provider formatting drift fails closed
- the future commit path already has deterministic non-overlapping replacement plans
- no incomplete snapshot implementation is presented as recovery safety

### Negative

- users cannot yet apply a multi-block review directly
- providers that normalize blank lines may fall back to raw review
- selections spanning inline modifier ownership without paragraph separators are rejected
- per-scalar structured mapping is intentionally bounded and costs more than same-node mapping

## Follow-up gate

The next slice may enable apply only after it can prove:

1. current dirty Typie content is flushed,
2. an automatic logical snapshot is committed,
3. every replacement is revalidated,
4. one Typie transaction applies all replacements or none,
5. failure leaves the original document unchanged,
6. the created snapshot can be restored from the same UI,
7. save, close and reopen preserve the committed result,
8. snapshot metadata contains no prompt, credential or raw provider response.
