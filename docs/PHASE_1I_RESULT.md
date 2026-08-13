# Phase 1I-F — Exact Typie Selection and Hunk Review Result

## Verdict

```text
Implementation verdict: TECHNICAL IMPLEMENTATION COMPLETE ON main
Exact active Typie selection mapping: IMPLEMENTED
Per-hunk proposal review: IMPLEMENTED
One-node exact-selection apply: IMPLEMENTED
Actual loopback compatible transport: AUTOMATED TEST ADDED
Actual remote HTTPS provider: MANUAL VALIDATION PENDING
Cross-node/multi-block/project-wide AI apply: NOT AUTHORIZED
Aggregate Windows verdict: PENDING WORKFLOW
Distribution boundary: PRIVATE LOCAL ONLY
```

## Existing Phase 1I foundation

Phase 1I-A through Phase 1I-E remain in place:

- user-owned OpenAI-compatible provider transport
- protected provider store outside `.madi`
- Electron `safeStorage` credential encryption
- trusted narrow IPC/preload boundary
- explicit provider/model/host/scope confirmation
- consent-bound SHA-256
- provider CRUD
- original/proposal side-by-side review
- copy and request cancellation
- safe one-range Typie proposal application
- document generation and revision invalidation
- Unicode-scalar-safe source offsets
- manuscript-free provider connectivity diagnostics
- actual loopback HTTP transport test

## Delivered in Phase 1I-F

- Madi-owned `EditorTextSelection` contract
- exact live Typie selection mapping to annotated recovery-text Unicode-scalar offsets
- candidate verification through `prose_to_selection_annotated`
- duplicate-text disambiguation using live CRDT selection endpoints
- fail-closed rejection of collapsed, cross-node and unmappable selections
- pinned browser-port selection bridge kept inside the Typie adapter directory
- active selection capture with document generation and editor revision
- exact range included in one-request scope consent metadata
- deterministic bounded word/punctuation proposal diff
- per-hunk include/exclude controls
- all/none hunk actions
- selected-result preview
- exact selected-range revalidation immediately before apply
- one Typie semantic replacement transaction for the final accepted result
- one normal Typie Undo entry for rollback
- separate `AI✎` quick-action workflow
- actual pinned-runtime duplicate-selection and one-Undo probe

## Exact selection mapping

The live selection is not located by choosing the first equal string. Madi reads:

- Typie’s live selection endpoints
- `copy_selection()` text
- annotated recovery text

It then enumerates matching text occurrences. Each candidate scalar range is mapped back through Typie. Only the candidate whose CRDT endpoints equal the live selection is accepted.

This resolves a limitation of Phase 1I-D: the author can now select the second or later occurrence of identical dialogue or narration and apply a rewrite only there.

The mapping remains intentionally conservative. Anchor and head must belong to the same Typie text node. A selection crossing separate inline nodes, modifiers, paragraph boundaries or scene breaks is rejected.

## Unicode coordinate contract

Annotated recovery text and semantic replacement use Unicode-scalar offsets. Madi builds a code-unit-to-scalar boundary map when searching matching candidates. The source range passed to Typie therefore does not split emoji or other non-BMP characters.

The mapped selection contains:

```text
selected text
start scalar
end scalar
opaque same-node key
```

The opaque key is used only as identity metadata. It is not exposed as a Typie document model to the rest of the application.

## Hunk review

The proposal review layer tokenizes text into:

- whitespace runs
- Unicode letter/number/mark runs
- punctuation and symbol runs

A deterministic longest-common-subsequence pass produces independent change hunks. Every hunk is selected by default, and the author can reject any hunk before apply. The selected hunk set is rendered into one complete replacement string.

The diff is bounded to prevent large synchronous renderer work. Inputs above the token or matrix threshold become one coarse hunk. Hunk boundaries are review aids; they are not persisted as canonical data and are not treated as Typie semantic nodes.

## Apply and rollback contract

Immediately before mutation, Madi verifies:

- active document generation
- editor revision
- exact selection scalar range
- expected source text at that range
- no newline or paragraph separator
- non-empty changed selected result
- no scene-break fallback
- inactive native IME composition

The accepted hunk set is committed as one `replaceTextRanges` request. The pinned Typie adapter independently checks expected prose, replacement outcomes, final text, scene-break count and semantic structure. Madi verifies the returned full text again.

Because the operation changes one exact selection in one active Typie text node, rollback is one `Ctrl+Z`. No named safety snapshot is created for this narrow path. The decision is fixed in [`ADR-0014`](decisions/ADR-0014-llm-selection-hunks-remain-one-typie-node.md).

## Deliberately blocked cases

- collapsed selection
- selection spanning two Typie nodes
- selection containing line or paragraph separators
- selection that cannot be round-tripped through annotated prose
- document restore, owner switch or content edit after proposal creation
- empty selected result
- scene-break replacement
- automatic application of summary, consistency-review or continuation output
- multiple semantic blocks or documents
- automatic Story Bible mutation
- project-wide AI mutation

Any future operation touching multiple blocks or documents must create an automatic project safety snapshot before commit.

## Focused verification added

### Selection mapping

- the live second duplicate maps to the second annotated-prose occurrence
- the first duplicate is not selected accidentally
- emoji preceding the selection does not shift scalar offsets
- collapsed selection returns no mapping
- cross-node selection returns no mapping
- the pinned browser-port bridge returns no selection during IME composition
- the bridge fails closed when the pinned port shape changes

### Proposal review

- independent Korean word changes form separately selectable hunks
- all accepted hunks reproduce the provider proposal
- no accepted hunks reproduce the original
- partial acceptance creates a deterministic intermediate result
- Unicode punctuation and emoji are preserved
- large inputs use one bounded coarse hunk
- unchanged text creates no hunk

### Apply workflow

- explicit consent is required before selection transmission
- transmitted scope contains only the exact selected text
- exact range metadata is bound to the request source ID
- the selected second duplicate is replaced without touching the first
- excluded hunks remain original text
- the final accepted result uses one Typie replacement transaction
- a later editor revision disables apply
- IME composition and structural boundary protections remain active

### Actual pinned-runtime probe

`probe-typie-llm-selection.mjs` creates a real pinned Typie editor, inserts duplicate text, selects the second occurrence, verifies endpoint-based mapping, replaces only that occurrence, and confirms that exactly one Undo and one Redo restore each state.

The root `test:typie` gate now runs both the original semantic probe and the exact-selection probe.

## Changed areas

- `apps/desktop/src/renderer/editor/MadiEditorAdapter.ts`
- `apps/desktop/src/renderer/editor/typie/TypieEditorAdapter.ts`
- `apps/desktop/src/renderer/editor/typie/selectionMapping.ts`
- `apps/desktop/src/renderer/editor/typie/selectionAwarePort.ts`
- `apps/desktop/src/renderer/editor/typie/productionAdapter.ts`
- `apps/desktop/src/renderer/llm/editorAccess.ts`
- `apps/desktop/src/renderer/llm/proposalApply.ts`
- `apps/desktop/src/renderer/llm/proposalDiff.ts`
- `apps/desktop/src/renderer/components/llm/LlmSelectionRewriteOverlay.tsx`
- `apps/desktop/src/renderer/components/llm/llmSelectionRewrite.css`
- `apps/desktop/src/renderer/main.tsx`
- `apps/desktop/tests/typie-selection-mapping.test.ts`
- `apps/desktop/tests/typie-selection-aware-port.test.ts`
- `apps/desktop/tests/llm-proposal-diff.test.ts`
- `apps/desktop/tests/llm-proposal-apply.test.ts`
- `apps/desktop/tests/llm-editor-access.test.ts`
- `apps/desktop/tests/llm-selection-rewrite-overlay.test.tsx`
- `scripts/probe-typie-llm-selection.mjs`
- `package.json`
- `docs/PHASE_1I_SCOPE.md`
- `docs/LLM_ADAPTER_ARCHITECTURE.md`
- `docs/decisions/ADR-0014-llm-selection-hunks-remain-one-typie-node.md`

## Verification limits

The repository code, focused tests and runtime probe are committed to `main`, but this document does not claim that aggregate Windows `pnpm verify`, development Electron, unpacked Electron or a real remote provider has passed. GitHub Actions remains the aggregate technical gate.

The exact-selection browser bridge is tied to the pinned Typie browser-port shape and must be reviewed whenever that runtime pin changes. A successful selection rewrite confirms structural application safety; it does not certify provider quality, factuality, confidentiality policy or cost.

## Next slice

Phase 1I-G should not broaden transport. It should establish project-safe broad application:

1. stable semantic-block identity across one active document
2. multi-block proposal planning without flattening Typie structure
3. automatic `AUTO_BEFORE_AI_APPLY` logical snapshot before commit
4. all-or-nothing multi-block apply and restore-on-failure
5. block-level and hunk-level review
6. snapshot diff showing AI-applied blocks without storing prompts, credentials or raw responses
7. development and packaged Electron smoke for selection capture, apply, restart and Undo
8. manual Ollama/LM Studio validation
9. manual remote HTTPS validation with a disposable user-owned credential

No provider response may mutate multiple semantic blocks or documents until the safety snapshot and atomic rollback gate exists.
