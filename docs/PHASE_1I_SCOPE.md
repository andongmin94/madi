# Phase 1I — User-owned LLM Adapter

## Status

```text
Phase 1I-A transport contracts: IMPLEMENTED
Phase 1I-B protected provider store and Electron IPC: IMPLEMENTED
Phase 1I-C provider UI, explicit scope confirmation and proposal review: IMPLEMENTED
Phase 1I-D unique single-range Typie proposal apply: IMPLEMENTED
Phase 1I-E manuscript-free provider connectivity diagnostics: IMPLEMENTED
Phase 1I-F exact active selection and per-hunk review: IMPLEMENTED
Phase 1I-G exact multi-block mapping and review-only planning: IMPLEMENTED ON main
Multi-block canonical apply: SNAPSHOT GATE NOT YET CONNECTED
Actual loopback compatible transport: AUTOMATED TEST ADDED
Actual remote HTTPS provider: MANUAL VALIDATION PENDING
Full repository Windows verification: PENDING FOR CURRENT main
Distribution boundary: PRIVATE LOCAL ONLY
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Windows native Korean IME: MANUAL VALIDATION PENDING
```

Phase 1I adds optional user-owned LLM assistance without a Madi server, account system, shared API key or mandatory network connection. The rest of madi remains fully usable without a configured provider.

## Product rules

1. The user owns the provider account, local model, API key and resulting charges.
2. Remote providers require HTTPS; HTTP is accepted only for loopback hosts.
3. API keys never enter `.madi`, logs, evidence or public errors.
4. Electron `safeStorage` protects app-level credentials.
5. Every manuscript request is bound to one explicitly confirmed scope SHA-256.
6. Scope changes before transport are rejected before any network call.
7. Redirects are rejected.
8. Provider output first enters a non-canonical proposal buffer.
9. Canonical Typie mutation always requires a second author action and fresh identity/range checks.
10. Provider connectivity diagnostics send no manuscript, note, Story Bible or Canvas content.
11. Single-node rewrites may use one Typie transaction and one `Ctrl+Z` rollback.
12. Multi-block mutation is forbidden until a project-level pre-apply safety snapshot and direct restore path exist.
13. Prompts, API keys and raw provider responses are not canonical project data.

## Implemented layers

### Transport and credential boundary

- versioned OpenAI-compatible provider configuration
- safe endpoint normalization
- bounded request/response sizes
- timeout and cancellation
- provider CRUD
- encrypted credentials outside `.madi`
- trusted fixed IPC/preload methods
- sanitized error mapping
- actual loopback HTTP compatible-transport test

### Provider diagnostics

The renderer supplies only request ID, provider ID and expected provider revision. The main process constructs an empty fixed scope and requests `MADI_OK`. The result returns status, configured/response model and latency; response text is discarded. See [`ADR-0013`](decisions/ADR-0013-provider-connectivity-tests-send-no-manuscript.md).

### Phase 1I-F exact same-node selection

Madi maps the author’s live Typie selection to annotated-recovery Unicode-scalar offsets by round-tripping every matching candidate through Typie and comparing actual CRDT endpoints. This disambiguates repeated dialogue or narration.

The proposal receives a bounded Unicode-aware hunk diff. Accepted hunks are rendered into one replacement string, revalidated against document generation, revision, exact scalar range and source text, then committed in one Typie semantic transaction. One `Ctrl+Z` is the rollback path. See [`ADR-0014`](decisions/ADR-0014-llm-selection-hunks-remain-one-typie-node.md).

## Phase 1I-G structured multi-block review

### Engine-independent selection contract

The Madi adapter now exposes a separate `EditorStructuredSelection` contract:

```text
exact selected text
selection start/end Unicode-scalar offsets
ordered text-node segments
opaque node keys
exact separators between segments
```

Typie internals remain confined to `renderer/editor/typie`. A structured selection is found by:

1. reading the live Typie selection and clipboard text,
2. locating equal annotated-prose candidates,
3. mapping each candidate through Typie,
4. accepting only the candidate whose CRDT endpoints equal the live selection,
5. round-tripping each visible scalar to its owning text node,
6. preserving structural separators exactly.

Mapping is bounded to 20,000 Unicode scalars and 64 text-node segments. Collapsed, unmappable, scene-break and oversized selections fail closed.

### Product selection gate

The `AI¶` workflow accepts only:

- 2–32 text segments,
- separated by line or paragraph separators,
- with no same-line inline-node split treated as a separate paragraph,
- with exact reconstruction of the selected annotated prose.

The existing `AI✎` workflow remains the correct path for one same-node selection.

### Provider response structure

The provider is instructed to preserve the original paragraph count and exact blank-line separators. A response is split into blocks only when every separator matches exactly. Different newline count or style remains raw review/copy output and never becomes an apply plan.

### Block and hunk review

Every matched block receives its own bounded hunk review. The author can include or exclude hunks independently. Madi reconstructs the complete selected proposal using the original separators.

The editor is reread after every hunk choice. A structurally ready plan requires:

- unchanged document generation and revision,
- exact source text at every scalar range,
- non-overlapping text-node replacements,
- no empty replacement block,
- no line separator or scene-break fallback inside a block,
- at least two changed blocks.

A READY result proves only that the proposal can be represented as one future all-or-nothing Typie multi-replacement transaction. Phase 1I-G does not execute it.

### Canonical mutation gate

The apply control is intentionally disabled and states that the project safety snapshot boundary is not connected. This is not a placeholder success path. Multi-block canonical mutation remains unauthorized until the next slice proves:

1. dirty active Typie content is flushed,
2. an automatic pre-AI-apply logical snapshot is committed,
3. every replacement is revalidated immediately before mutation,
4. one Typie transaction applies all replacements or none,
5. failure leaves the original document unchanged,
6. the safety snapshot can be restored from the same UI,
7. save, close and reopen preserve the accepted result,
8. snapshot metadata contains no prompt, credential or raw response.

The decision is fixed in [`ADR-0015`](decisions/ADR-0015-multi-block-ai-review-precedes-snapshot-gated-apply.md).

## Focused verification code

Focused tests cover:

- provider URL, credential and privacy contracts
- consent hash and request cancellation
- manuscript-free diagnostics
- exact duplicate selection mapping
- non-BMP Unicode-scalar offsets
- same-node hunk review and one-transaction apply
- structured multi-paragraph endpoint mapping
- opaque text-node segmentation and exact separators
- rejection of inline-node splits as paragraph blocks
- exact proposal separator parsing
- deterministic per-block hunk review
- stale revision invalidation
- multiple non-overlapping read-only replacement planning
- disabled canonical apply before snapshot integration

The current `main` push triggers the Windows private verification workflow. Its final result remains authoritative; this document does not claim that a pending workflow passed.

## Still out of scope

- automatic background manuscript upload
- Madi-operated proxy or shared provider keys
- arbitrary provider headers or scripts
- streaming collaboration or AI telemetry
- unreviewed manuscript or Story Bible mutation
- multi-block apply without a project safety snapshot
- cross-document or project-wide AI mutation
- persistent prompt/raw-response history
- provider-quality or provider-privacy certification
