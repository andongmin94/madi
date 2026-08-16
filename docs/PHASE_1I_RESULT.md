# Phase 1I-G — Exact Multi-block Mapping and Review Result

## Verdict

```text
Repository implementation: TECHNICAL IMPLEMENTATION COMPLETE ON main
Exact structured Typie selection mapping: IMPLEMENTED
Per-block and per-hunk review: IMPLEMENTED
Read-only multi-replacement planning: IMPLEMENTED
Multi-block canonical apply: NOT AUTHORIZED — SNAPSHOT GATE PENDING
Actual loopback compatible transport: AUTOMATED TEST ADDED
Actual remote HTTPS provider: MANUAL VALIDATION PENDING
Aggregate Windows verdict: PENDING WORKFLOW
Distribution boundary: PRIVATE LOCAL ONLY
```

## Preserved foundation

Phase 1I-A through Phase 1I-F remain in place:

- user-owned OpenAI-compatible transport
- protected provider store outside `.madi`
- Electron `safeStorage` credential protection
- trusted fixed IPC/preload boundary
- explicit one-request manuscript consent
- provider CRUD and manuscript-free connectivity diagnostics
- exact same-node selection mapping
- Unicode-safe per-hunk review
- one Typie transaction and one Undo for a narrow accepted rewrite

## Delivered in Phase 1I-G

- Madi-owned structured-selection contract
- exact cross-node selection endpoint matching
- bounded per-scalar text-node ownership mapping
- opaque node identity kept behind the Madi adapter
- exact structural separator preservation
- rejection of collapsed, unmappable, scene-break and oversized selections
- product gate for 2–32 paragraph-separated text segments
- provider instruction to preserve paragraph count and blank-line separators
- exact provider-response structure parser
- raw review fallback when provider structure differs
- block-by-block bounded hunk review
- independent hunk include/exclude controls per block
- reconstruction of one complete reviewed proposal with original separators
- stale generation/revision and source-range revalidation
- deterministic non-overlapping multi-replacement planning
- separate `AI¶` workflow
- canonical apply control kept disabled until project safety-snapshot integration

## Structured selection mapping

The live selection is not located by choosing the first equal substring. Madi reads Typie’s current CRDT selection endpoints and clipboard text, searches annotated recovery prose, maps each candidate back through Typie and accepts only the candidate whose endpoints equal the author’s live selection.

For a structured selection, each visible Unicode scalar is mapped back through Typie to its owning text node. Contiguous scalars with the same owner form one Madi segment. Newline and paragraph separators remain exact strings between those segments.

The exported Madi contract contains:

```text
selected text
start/end Unicode-scalar offsets
ordered text segments
opaque node keys
exact separators
```

No Typie `Selection`, `Position`, `Dot`, `PlainDoc` or generated FFI type crosses the adapter boundary.

Mapping limits:

- at most 20,000 selected Unicode scalars
- at most 64 internal text-node segments
- at most 10,000 equal-text candidate positions

## Product paragraph gate

Not every cross-node selection is a safe multi-paragraph edit. The product workflow requires:

- 2–32 segments,
- each segment to be non-empty text,
- a line or paragraph separator between every adjacent segment,
- separators to contain only whitespace and line-separator characters,
- no semantic scene-break fallback,
- exact selected-text reconstruction.

A paragraph split only by bold/ruby/other inline ownership has an empty separator and is rejected. This prevents a provider response from flattening mixed inline semantics.

## Provider response handling

The request sends only the exact selected text after explicit consent. The system instruction requires the provider to keep the same paragraph count and exact blank-line separators.

The parser accepts a response only when every original separator appears in the expected order and no unexpected line separator appears inside a block. A mismatch does not discard the response; it remains available as raw review/copy output. It cannot become an application plan.

## Block and hunk review

Every structurally matched provider block is compared with its corresponding source block using the existing bounded Unicode-aware proposal diff. All hunks start selected. The author may exclude any hunk independently.

Madi renders the accepted hunks back into one block string, then reconstructs the full proposal using the original structural separators. Hunk metadata remains renderer review state and is not canonical project data.

## Read-only multi-replacement plan

After each hunk choice, `LlmEditorAccess` rereads the active Typie document. A plan is READY only when:

- document generation and editor revision still match,
- the full selected scalar range equals the original selection,
- every segment’s current text equals its captured source,
- proposed blocks are non-empty,
- proposed blocks contain no line separator or scene-break fallback,
- replacement ranges are exact and non-overlapping,
- at least two semantic blocks actually change.

The result contains the Madi-owned `EditorTextReplacement[]`, expected complete document text and changed-block count. The planner performs no mutation.

## Why apply remains disabled

The pinned Typie command can already commit multiple non-overlapping replacements atomically in one history entry. Product recovery requires more than engine atomicity. A broad AI change must remain recoverable after autosave, close, reopen and later edits.

Phase 1I-G therefore displays structural readiness but keeps the apply control disabled. The next slice must create and expose an automatic pre-apply logical snapshot before it may call the existing Typie multi-replacement transaction.

Required next-slice proof:

1. flush dirty active content,
2. create the automatic safety snapshot,
3. revalidate every range,
4. commit all replacements or none,
5. preserve the original document on failure,
6. restore the snapshot from the same workflow,
7. persist and reopen the accepted result,
8. keep prompt, credential and raw response out of snapshot metadata.

See [`ADR-0015`](decisions/ADR-0015-multi-block-ai-review-precedes-snapshot-gated-apply.md).

## Focused verification added

- actual second-occurrence endpoint mapping remains intact
- emoji/non-BMP scalar offsets remain correct
- exact two-paragraph segmentation and separators
- same-line inline-node split rejection
- exact separator parser success and mismatch fallback
- deterministic reconstructed proposal text
- multiple non-overlapping replacement plans
- empty-block, one-block-only and stale-plan rejection
- structured editor access bound to generation/revision
- explicit consent before multi-paragraph transport
- exact selected manuscript scope in invocation
- block-level hunk review
- disabled canonical apply before snapshot integration
- raw response review after provider structural drift

## Changed areas

- `apps/desktop/src/renderer/editor/MadiEditorAdapter.ts`
- `apps/desktop/src/renderer/editor/typie/TypieEditorAdapter.ts`
- `apps/desktop/src/renderer/editor/typie/selectionMapping.ts`
- `apps/desktop/src/renderer/editor/typie/selectionAwarePort.ts`
- `apps/desktop/src/renderer/llm/editorAccess.ts`
- `apps/desktop/src/renderer/llm/multiBlockProposal.ts`
- `apps/desktop/src/renderer/components/llm/LlmMultiBlockReviewOverlay.tsx`
- `apps/desktop/src/renderer/components/llm/llmMultiBlockReview.css`
- `apps/desktop/src/renderer/main.tsx`
- focused adapter, selection, planner, editor-access and UI tests
- `docs/PHASE_1I_SCOPE.md`
- `docs/LLM_ADAPTER_ARCHITECTURE.md`
- `docs/decisions/ADR-0015-multi-block-ai-review-precedes-snapshot-gated-apply.md`

## Verification limits

The code and focused tests are committed to `main`, but this document does not claim that aggregate Windows `pnpm verify`, development Electron, fresh unpacked Electron or a real remote provider passed. GitHub Actions remains the aggregate gate.

The structured selection bridge is tied to the pinned Typie browser-port shape and must be reviewed with any Typie pin change. A structurally READY plan does not certify provider quality, factuality, privacy policy or cost.

## Next slice

Phase 1I-H should connect project recovery without broadening provider transport:

1. project-level `AUTO_BEFORE_AI_APPLY` safety snapshot orchestration,
2. current dirty Typie flush before snapshot,
3. one all-or-nothing multi-replacement transaction,
4. direct snapshot restore from the AI review UI,
5. no prompt/credential/raw-response snapshot metadata,
6. save-close-reopen verification,
7. development and fresh-unpacked Electron smoke,
8. manual Ollama/LM Studio validation,
9. manual remote HTTPS validation with a disposable user-owned credential.

Cross-document and project-wide AI mutation remains unauthorized.
