# Phase 1I — User-owned LLM Adapter

## Status

```text
Phase 1I-A transport contracts: IMPLEMENTED
Phase 1I-B protected provider store and Electron IPC: IMPLEMENTED
Phase 1I-C provider UI, explicit scope confirmation and proposal review: IMPLEMENTED ON main
Canonical Typie apply: DEFERRED TO Phase 1I-D
Full repository Windows verification: PENDING FOR CURRENT main
Distribution boundary: PRIVATE LOCAL ONLY
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Windows native Korean IME: MANUAL VALIDATION PENDING
```

Phase 1I adds optional user-owned LLM assistance without adding a Madi server, account system, shared API key, or mandatory network connection. The product remains fully usable when no provider is configured.

## Product rules

1. AI is optional and disabled until the user configures a provider.
2. The user owns the provider account, local model, API key, and resulting charges.
3. Remote providers require HTTPS. Plain HTTP is accepted only for loopback endpoints.
4. Provider URLs may not contain credentials, query parameters, or fragments.
5. API keys are not stored in `.madi`, provider config JSON, logs, evidence, or error reports.
6. Electron `safeStorage` protects credentials in the app-level provider store under `userData`.
7. If protected storage is unavailable, remote key-based providers remain unavailable while the rest of madi continues to work.
8. Every invocation is bound to an explicitly confirmed manuscript scope SHA-256.
9. If the scope changes after confirmation, the main process rejects the request before any network call.
10. Redirects are rejected.
11. Provider output is a proposal and is never applied to Typie canonical content automatically.
12. Manuscript text, provider response bodies, and API keys are excluded from sanitized errors.

## Implemented repository layers

### Shared contracts

- versioned OpenAI-compatible provider configuration
- safe endpoint normalization
- task, scope, consent, usage, and result types
- one shared deterministic scope serialization contract for browser and main process
- closed `madi:llm:*` IPC channel set
- provider CRUD and invocation contracts with no secret-bearing config field

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
- bounded JSON parser with exact schema and duplicate-ID rejection
- temporary-file write, primary/backup recovery, and stale-temp cleanup
- optional-store failure does not stop the authoring application

### Electron boundary

- fixed, trusted-sender IPC handlers
- separate narrow `window.madiLlm` preload API
- no raw `ipcRenderer`, `fetch`, filesystem, or secret storage exposed to the renderer
- active requests are aborted on application shutdown

### Provider and proposal UI

- global AI launcher that does not alter the existing authoring workspaces
- provider create, edit, delete and refresh
- remote HTTPS and loopback local-provider guidance
- API-key field that is write-only from the renderer perspective
- current live Typie document copied into a separate, editable transmission scope
- explicit provider, model, host and character-count confirmation
- consent checkbox required before invocation
- browser/main SHA-256 agreement over the exact scope payload
- request cancellation
- original/proposal side-by-side review
- proposal copy without automatic manuscript mutation

The AI panel uses a tracked reference to the existing one live editor adapter. It does not create another Typie instance, does not expose Typie internals, and refuses to copy text while native composition is active.

## Phase 1I-D

The next slice is the canonical proposal-application workflow:

- selection or block-level source mapping
- semantic Typie diff
- reject, partial apply and full apply
- automatic safety snapshot before accepted multi-block changes
- stale source/revision prevention
- proposal provenance that does not retain API keys or hidden prompts
- real remote-provider and loopback-provider manual validation

Until that slice is complete, the UI intentionally disables direct apply and offers copy-only review. Replacing an entire Typie document with plain text would destroy paragraph, scene-break, ruby and inline semantics, so that shortcut is not accepted.

## Verification status

Focused tests cover:

- provider URL and config contracts
- transport privacy and response bounds
- encrypted provider storage
- trusted preload/IPC routing
- current editor access and composition refusal
- explicit confirmation before invocation
- provider creation without secret readback

The current main push triggers the Windows private verification workflow. Its final result remains authoritative; this document does not claim that a pending workflow has passed.

## Explicitly out of scope

- background manuscript upload
- Madi-operated proxy or shared keys
- automatic rewrite without review
- provider-specific SDKs
- arbitrary headers or scripts
- collaborative AI sessions
- AI telemetry
- unreviewed automatic Story Bible mutations
