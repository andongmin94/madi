# Phase 1I — User-owned LLM Adapter

## Status

```text
Phase 1I-A transport contracts: IMPLEMENTED
Phase 1I-B protected provider store and Electron IPC: IMPLEMENTED
Phase 1I-C provider UI, explicit scope confirmation and proposal review: IMPLEMENTED
Phase 1I-D unique single-range Typie proposal apply: IMPLEMENTED
Phase 1I-E manuscript-free provider connectivity diagnostics: IMPLEMENTED ON main
Actual loopback compatible transport: AUTOMATED TEST ADDED
Actual remote HTTPS provider: MANUAL VALIDATION PENDING
Multi-block and project-wide AI apply: DEFERRED
Full repository Windows verification: PENDING FOR CURRENT main
Distribution boundary: PRIVATE LOCAL ONLY
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Windows native Korean IME: MANUAL VALIDATION PENDING
```

Phase 1I adds optional user-owned LLM assistance without adding a Madi server, account system, shared API key or mandatory network connection. The product remains fully usable when no provider is configured.

## Product rules

1. AI is optional and disabled until the user configures a provider.
2. The user owns the provider account, local model, API key and resulting charges.
3. Remote providers require HTTPS. Plain HTTP is accepted only for loopback endpoints.
4. Provider URLs may not contain credentials, query parameters or fragments.
5. API keys are not stored in `.madi`, provider config JSON, logs, evidence or error reports.
6. Electron `safeStorage` protects credentials in the app-level provider store under `userData`.
7. If protected storage is unavailable, remote key-based providers remain unavailable while the rest of madi continues to work.
8. Every manuscript invocation is bound to an explicitly confirmed scope SHA-256.
9. If the confirmed scope changes before transport, the main process rejects the request before any network call.
10. Redirects are rejected.
11. Provider output first enters a separate proposal buffer.
12. Canonical Typie mutation requires a second explicit user action and a fresh identity/range check.
13. Provider connectivity diagnostics send no manuscript, note, Story Bible or Canvas content.
14. Manuscript text, provider response bodies and API keys are excluded from sanitized errors.

## Implemented repository layers

### Shared contracts

- versioned OpenAI-compatible provider configuration
- safe endpoint normalization
- task, scope, consent, usage and result types
- deterministic scope serialization shared by browser and main process
- closed `madi:llm:*` IPC channel set
- provider CRUD, connectivity-test and invocation contracts
- no secret-bearing provider config field

### Main-process transport

- bounded non-streaming chat-completions request
- explicit-scope consent hash verification
- timeout and caller cancellation
- response-size limit
- redirect rejection
- generic status/error mapping
- string and text-part assistant response parsing

### Protected provider store

- provider config stored outside `.madi`
- credentials encrypted with Electron `safeStorage`
- revision-checked provider mutations
- bounded exact-schema JSON parser and duplicate-ID rejection
- temporary-file write, primary/backup recovery and stale-temp cleanup
- optional-store failure does not stop the authoring application

### Electron boundary

- fixed, trusted-sender IPC handlers
- separate narrow `window.madiLlm` preload API
- no raw `ipcRenderer`, `fetch`, filesystem or secret storage exposed to the renderer
- active requests, including connectivity tests, are aborted on application shutdown

### Provider, proposal and diagnostics UI

- provider create, edit, delete and refresh
- remote HTTPS and loopback local-provider guidance
- write-only API-key field
- active Typie document copied into a separate transmission scope
- explicit provider, model, host and character-count confirmation
- consent checkbox required before manuscript invocation
- request cancellation
- original/proposal side-by-side review
- proposal copy
- safe direct apply for one unique single-line range in the same active Typie document
- separate connectivity diagnostics dialog
- connectivity test displays target, model, credential state, latency and response model
- connectivity request text is fixed by the main process and cannot be supplied by the renderer

## Phase 1I-D safe apply contract

A proposal can be applied automatically only when all of the following are true:

- the task is `REWRITE_SELECTION` or `CUSTOM`
- the scope originated from the current live Typie document
- document generation and editor revision still match the captured values
- the original scope is non-empty and occurs exactly once in annotated recovery text
- the proposal is non-empty and differs from the original
- neither side contains line, paragraph or Unicode paragraph separators
- neither side is a scene-break fallback such as `***` or `* * *`
- the pinned adapter exposes `replaceTextRanges`
- native composition is not active

Madi rereads the active document immediately before mutation, converts UTF-16 positions to Unicode-scalar offsets and calls the existing Typie semantic replacement transaction. The adapter independently checks expected text, resulting text, scene-break count and semantic structure.

A successful single-range apply creates one Typie Undo entry, so `Ctrl+Z` is the rollback path. It does not create a named snapshot. This decision is fixed in [`ADR-0012`](decisions/ADR-0012-llm-single-range-apply-uses-typie-transaction.md).

## Phase 1I-E connectivity contract

Provider diagnostics use the same main-process transport as normal requests, but the scope is fixed to:

```text
kind: CUSTOM
source ID: madi-provider-connectivity-test-v1
manuscript text: empty
context text: null
expected response: MADI_OK
```

The renderer supplies only provider ID, expected provider revision and request ID. It cannot attach manuscript, context, prompt, headers or a different endpoint. The result returns status, configured/response model and latency; the provider response text is discarded.

A real loopback HTTP server test exercises the complete OpenAI-compatible request path without external network access. Remote HTTPS validation remains manual because it requires a disposable user-owned credential and may incur provider cost. The decision is fixed in [`ADR-0013`](decisions/ADR-0013-provider-connectivity-tests-send-no-manuscript.md).

## Deferred broad apply

The following remain intentionally blocked:

- proposals containing newlines or multiple semantic blocks
- ambiguous source text that occurs more than once
- proposals whose source document was restored, switched or edited
- whole-scene continuation output treated as replacement text
- summary or consistency-review output treated as manuscript text
- multi-document or project-wide AI mutation
- automatic Story Bible mutation

A later broad-apply slice must add stable block/selection source mapping, per-hunk acceptance and an automatic safety snapshot before any accepted operation touches multiple blocks or documents.

## Verification status

Focused tests cover:

- provider URL and config contracts
- transport privacy and response bounds
- encrypted provider storage
- trusted preload/IPC routing
- current editor access and composition refusal
- explicit confirmation before invocation
- provider creation without secret readback
- document generation and revision invalidation
- Unicode-scalar replacement offsets
- ambiguous, missing, multi-block and scene-break rejection
- one semantic Typie replacement with interaction locking
- provider diagnostics fixed request shape
- rejection of extra manuscript/prompt fields at IPC
- connectivity cancellation
- actual loopback HTTP compatible transport
- diagnostics UI success, cancellation and locked-credential states

The current main push triggers the Windows private verification workflow. Its final result remains authoritative; this document does not claim that a pending workflow has passed.

## Explicitly out of scope

- background manuscript upload
- Madi-operated proxy or shared keys
- provider-specific SDKs
- arbitrary headers or scripts
- collaborative AI sessions
- AI telemetry
- unreviewed automatic manuscript or Story Bible mutation
- multi-block AI apply without a safety snapshot
- automatic provider model discovery
