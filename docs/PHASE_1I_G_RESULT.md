# Phase 1I-G — Durable Safety Gate for Multi-block AI Apply

## Verdict

```text
Broad-proposal planner: IMPLEMENTED ON main
Snapshot-before-mutation coordinator: IMPLEMENTED ON main
Production active-project snapshot bridge: NOT YET WIRED
Multi-block AI apply UI: INTENTIONALLY DISABLED
Multi-document/project-wide AI mutation: NOT AUTHORIZED
Aggregate Windows verification: PENDING
Distribution boundary: PRIVATE LOCAL ONLY
```

## Purpose

Phase 1I-F made one exact active Typie selection reviewable and safely replaceable. Phase 1I-G establishes the next required boundary: a proposal touching multiple semantic blocks may not mutate canonical content unless Madi first receives a durable project snapshot receipt.

This phase intentionally does not expose a broad-apply button. It adds the production-independent planner and coordinator that the UI must pass through once the active project session supplies a real named-snapshot writer.

## Broad proposal contract

The initial broad scope is the complete active Typie document. The source copy must still equal the current annotated recovery text and retain the same document generation and editor revision.

The planner splits annotated prose at Typie's paragraph separators and classifies semantic scene-break fallback blocks. It requires:

- the same block count in source and proposal
- scene-break blocks at the same indices
- unchanged scene-break text
- no carriage-return or Unicode paragraph-separator substitution
- no changed hard break inside one block
- no pure insertion-only or deletion-only block edit
- no more than 1,000 blocks or 500 changed blocks

For each changed text block, Madi removes the common Unicode-scalar prefix and suffix and produces one minimal in-place replacement. Applying all replacements must reproduce the proposal exactly. Otherwise the proposal remains review/copy only.

## Safety snapshot contract

The coordinator requires a `LlmAiSafetySnapshotWriter` before calling Typie. The request contains only:

- `AUTO_BEFORE_AI_APPLY`
- human-readable snapshot name
- changed-block count
- source generation
- source revision

It never contains manuscript text, prompt text, provider output, API keys or provider configuration.

The coordinator rejects:

- snapshot writer failure
- empty or malformed snapshot receipt
- document identity changes during snapshot creation
- structural-plan failure before or after snapshot creation
- active native IME composition
- unavailable semantic replacement support

No Typie mutation occurs in those cases.

## Atomic apply contract

After a valid snapshot receipt, the coordinator:

1. rereads the active document
2. rechecks generation and revision
3. rebuilds the complete plan
4. locks editor interaction when supported
5. rereads and replans immediately before commit
6. sends every non-overlapping replacement in one `replaceTextRanges` call
7. checks the returned complete annotated text against the reviewed proposal
8. verifies that the active document generation did not change
9. unlocks and refocuses the editor

The existing Typie adapter remains responsible for expected-text checks, same-node resolution, modifier ownership, semantic scene-break count, document-structure fingerprint and rollback after a failed postcondition.

## Focused tests

### Planner

- two separate Korean paragraphs become two replacements
- semantic scene-break blocks are preserved
- paragraph insertion/deletion is rejected
- scene-break replacement is rejected
- source must equal the complete current document
- generation/revision changes invalidate the proposal
- unchanged proposals create no transaction

### Coordinator

- durable snapshot is called before interaction lock and replacement
- snapshot metadata does not include source or proposal text
- all changed blocks use one replacement call
- snapshot failure leaves the manuscript untouched
- invalid snapshot receipt leaves the manuscript untouched
- revision changes during snapshot creation leave the manuscript untouched
- structural failures occur before snapshot creation
- native IME composition prevents reads, snapshot creation and mutation

## Changed areas

- `apps/desktop/src/renderer/llm/broadProposalPlan.ts`
- `apps/desktop/src/renderer/llm/broadApplyCoordinator.ts`
- `apps/desktop/tests/llm-broad-proposal-plan.test.ts`
- `apps/desktop/tests/llm-broad-apply-coordinator.test.ts`
- `docs/decisions/ADR-0015-multi-block-ai-apply-requires-durable-snapshot.md`

## Remaining production integration

The current LLM overlays are mounted outside the project workspace and do not own the active `.madi` session. The next slice must add a narrow renderer bridge from `App` to the LLM coordinator that can:

1. flush the active scene/entity note safely
2. persist current project UI state where required
3. call the existing named-snapshot API for the active session
4. return snapshot ID and project revision
5. refresh the controller's adopted project revision
6. fail closed when no project is open or save fails

Only after that bridge is covered by unit and Electron tests may the multi-block apply UI be enabled.

## Verification limit

The new code and focused tests are committed to `main`, but this result does not claim that `pnpm verify`, development Electron, fresh-unpacked Electron or GitHub Windows verification has passed. The aggregate gate remains external and authoritative.
