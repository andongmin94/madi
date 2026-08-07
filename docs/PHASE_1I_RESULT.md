# Phase 1I-D — Safe Single-Range Typie Proposal Apply Result

## Verdict

```text
Implementation verdict: TECHNICAL IMPLEMENTATION COMPLETE ON main
Safe single-range Typie apply: IMPLEMENTED
Multi-block/project-wide AI apply: NOT AUTHORIZED
Aggregate Windows verdict: PENDING WORKFLOW
Real provider validation: MANUAL VALIDATION PENDING
Distribution boundary: PRIVATE LOCAL ONLY
```

## Delivered

Phase 1I-A through Phase 1I-C remain in place:

- user-owned OpenAI-compatible provider transport
- protected provider store outside `.madi`
- Electron `safeStorage` credential encryption
- trusted narrow IPC/preload boundary
- explicit provider/model/host/scope confirmation
- consent-bound SHA-256
- provider CRUD
- original/proposal side-by-side review
- copy and request cancellation

Phase 1I-D adds:

- active Typie document generation identity
- editor revision binding
- proposal invalidation after a document restore, owner switch or content transaction
- Unicode-scalar-safe source offsets
- one unique single-line source-range planner
- ambiguity, missing-source, newline and scene-break rejection
- immediate reread and revalidation before mutation
- interaction locking during mutation
- application through Madi's existing `replaceTextRanges` Typie transaction
- result-text verification after the Typie adapter's semantic postconditions
- one normal Typie Undo entry for `Ctrl+Z`
- UI readiness, blocked-reason, applying and applied states

## Application rules

Automatic application is available only for `REWRITE_SELECTION` and `CUSTOM` proposals bound to the current live Typie document.

The source range must:

- still belong to the same document generation and editor revision
- be non-empty
- occur exactly once in current annotated recovery text
- contain no line or paragraph separator
- not be a scene-break fallback

The proposal must:

- be non-empty
- differ from the source
- contain no line or paragraph separator
- not be a scene-break fallback

JavaScript code-unit positions are converted to Unicode-scalar offsets before calling Typie. This avoids splitting emoji or other non-BMP characters and matches the existing semantic replacement contract.

## Rollback decision

A successful direct apply is one active-document Typie transaction. The existing Typie Undo path is therefore the rollback mechanism, and the UI tells the author that `Ctrl+Z` can undo it.

No named safety snapshot is created for this narrow path. A future operation that touches multiple semantic blocks or documents must create an automatic safety snapshot before commit. The decision is recorded in [`ADR-0012`](decisions/ADR-0012-llm-single-range-apply-uses-typie-transaction.md).

## Deliberately blocked cases

- source text appears more than once
- source text is no longer present
- active document or revision changed after proposal creation
- native IME composition is active
- source or proposal contains a newline
- source or proposal is a scene-break fallback
- the proposal came from wholly unbound manually entered text
- summary, consistency-review or continuation output is treated as replacement text
- multiple blocks, scenes, entity notes or project-wide content would change

These cases remain proposal-and-copy workflows rather than using a structure-flattening plain-text shortcut.

## Changed areas

- `apps/desktop/src/renderer/llm/proposalApply.ts`
- `apps/desktop/src/renderer/llm/editorAccess.ts`
- `apps/desktop/src/renderer/components/llm/LlmAssistantOverlay.tsx`
- `apps/desktop/tests/llm-proposal-apply.test.ts`
- `apps/desktop/tests/llm-editor-access.test.ts`
- `apps/desktop/tests/llm-assistant-overlay.test.tsx`
- `docs/PHASE_1I_SCOPE.md`
- `docs/LLM_ADAPTER_ARCHITECTURE.md`
- `docs/decisions/ADR-0012-llm-single-range-apply-uses-typie-transaction.md`

## Focused verification added

- Unicode-scalar offset calculation with an emoji preceding the source range
- stale generation and revision rejection
- ambiguous and missing source rejection
- multi-block and semantic scene-break rejection
- empty and unchanged proposal rejection
- one active Typie replacement transaction
- interaction lock/unlock
- native composition refusal
- proposal application button readiness
- stale proposal UI invalidation
- multi-block apply UI remains disabled
- existing provider confirmation and no-secret-readback behavior

## Verification limits

The repository code and focused tests are committed to `main`, but this result does not claim that the aggregate Windows `pnpm verify`, development Electron, packaged Electron or actual provider matrix has passed. Those remain authoritative external gates.

## Next slice

Phase 1I-E should proceed only after the aggregate gate is green. Its product scope is:

1. stable Typie current-selection or block identity rather than unique-text matching
2. line/block-aware proposal diff
3. per-hunk acceptance
4. automatic safety snapshot before any multi-block or multi-document apply
5. proposal provenance without prompt or credential leakage
6. actual loopback provider validation
7. actual remote HTTPS provider validation with a disposable test key

No provider response should mutate a project without a second explicit author action and all current revision checks.
