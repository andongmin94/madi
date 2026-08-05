# Phase 1I — User-owned LLM Adapter

## Status

```text
Phase 1I-A transport contracts: IMPLEMENTED
Phase 1I-B protected provider store and Electron IPC: IMPLEMENTED ON main
Local strict TypeScript compile: PASS
Local provider-store/runtime exercise: PASS
Full repository Windows verification: PENDING
Provider UI and proposal review/apply: NOT YET IMPLEMENTED
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

## Verification performed in this implementation turn

- strict TypeScript compilation of the split LLM store/service/transport modules
- local runtime exercise covering create, encrypted persistence, no plaintext-at-rest, update, invoke, and delete
- automated repository tests added for contracts, transport privacy, provider storage, preload routing, cancellation, and optional-store failure

The full repository `pnpm verify`, Electron package tests, and Windows workflow remain the authoritative aggregate gates and were not claimed as passed in this turn.

## Next Phase 1I slice

- provider settings UI
- explicit send-confirmation UI showing provider, model, scope, and character count
- optional streaming proposal display
- proposal diff, reject, partial apply, and full apply
- automatic safety snapshot before accepted multi-block changes
- prompt recipes for selection, scene, chapter, Story Bible extraction, and consistency review
- real remote-provider and loopback-provider manual validation

## Explicitly out of scope

- background manuscript upload
- Madi-operated proxy or shared keys
- automatic rewrite without review
- provider-specific SDKs
- arbitrary headers or scripts
- collaborative AI sessions
- AI telemetry
