# Phase 1I-E — Manuscript-free Provider Diagnostics Result

## Verdict

```text
Implementation verdict: TECHNICAL IMPLEMENTATION COMPLETE ON main
Safe single-range Typie apply: IMPLEMENTED
Provider connectivity diagnostics: IMPLEMENTED
Actual loopback compatible transport: AUTOMATED TEST ADDED
Actual remote HTTPS provider: MANUAL VALIDATION PENDING
Multi-block/project-wide AI apply: NOT AUTHORIZED
Aggregate Windows verdict: PENDING WORKFLOW
Distribution boundary: PRIVATE LOCAL ONLY
```

## Existing Phase 1I foundation

Phase 1I-A through Phase 1I-D remain in place:

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
- one normal Typie Undo entry for accepted local rewrites

## Delivered in Phase 1I-E

- new closed `madi:llm:test-provider` IPC operation
- exact request contract containing only request ID, provider ID and expected revision
- main-process fixed connectivity scope with empty manuscript and null context
- fixed `MADI_OK` system/user instruction
- stored provider and protected credential resolution
- reuse of the existing timeout, cancellation, redirect, response-limit and sanitized-error transport boundary
- latency measurement
- `CONNECTED` and `CONNECTED_UNEXPECTED_RESPONSE` statuses
- response text discarded before returning to the renderer
- standalone provider diagnostics dialog
- provider host, model, credential state and protected-storage display
- test cancellation through the shared request ID boundary
- actual loopback HTTP server transport test

## Privacy boundary

The connectivity IPC request cannot contain manuscript, Story Bible, entity note, Canvas, prompt, header or endpoint fields. Exact-shape parsing rejects any additional property before service dispatch.

The main process creates this fixed scope:

```text
kind: CUSTOM
sourceId: madi-provider-connectivity-test-v1
manuscriptText: ""
contextText: null
```

The provider response is used only to compare the trimmed text with `MADI_OK`. The renderer receives no response body, prompt, credential or manuscript content.

This behavior is fixed in [`ADR-0013`](decisions/ADR-0013-provider-connectivity-tests-send-no-manuscript.md).

## Actual loopback validation

A deterministic automated test starts a real HTTP server on `127.0.0.1`, invokes the production OpenAI-compatible transport and verifies:

- loopback HTTP is accepted
- the request reaches `/v1/chat/completions`
- no authorization header is sent for a keyless provider
- JSON request/response parsing works
- usage and finish metadata are normalized
- the fixed response `MADI_OK` is returned
- a manuscript sentinel is absent from the request body
- the server is closed after the test

This is an actual local network transport test, not a mocked `fetch` call. It does not replace manual validation against Ollama, LM Studio or another user-installed compatible runtime.

## Diagnostics UX

The new `AI✓` launcher opens a compact provider diagnostics dialog. The author can:

- select a stored provider
- see the configured host and model
- see credential and protected-storage state
- run a manuscript-free connectivity test
- cancel a pending test
- view latency and the response model
- distinguish an exact `MADI_OK` contract response from a reachable endpoint that returned different text

The test button remains disabled for missing or locked credentials.

## Focused verification added

- preload exposes exactly seven closed LLM operations
- fixed test-provider channel routing
- main IPC rejects extra manuscript and prompt fields
- main IPC rejects invalid provider revisions
- service resolves stored config and protected credential
- service creates an empty manuscript scope
- service discards diagnostic response text
- unexpected marker status
- shared cancellation cleanup
- actual loopback transport
- diagnostics UI success
- diagnostics UI cancellation
- diagnostics UI locked-credential state
- existing assistant tests updated for the expanded API contract

## Changed areas

- `apps/desktop/src/shared/llmIpc.ts`
- `apps/desktop/src/main/llm/service.ts`
- `apps/desktop/src/main/llm/ipc.ts`
- `apps/desktop/src/preload/llmBridge.ts`
- `apps/desktop/src/renderer/components/llm/LlmProviderDiagnostics.tsx`
- `apps/desktop/src/renderer/components/llm/llmProviderDiagnostics.css`
- `apps/desktop/src/renderer/main.tsx`
- `apps/desktop/tests/llm-runtime-service.test.ts`
- `apps/desktop/tests/llm-preload-bridge.test.ts`
- `apps/desktop/tests/llm-main-ipc.test.ts`
- `apps/desktop/tests/llm-provider-diagnostics.test.tsx`
- `apps/desktop/tests/llm-loopback-provider.test.ts`
- `apps/desktop/tests/llm-assistant-overlay.test.tsx`
- `docs/PHASE_1I_SCOPE.md`
- `docs/LLM_ADAPTER_ARCHITECTURE.md`
- `docs/decisions/ADR-0013-provider-connectivity-tests-send-no-manuscript.md`

## Verification limits

The repository code and focused tests are committed to `main`, but this result does not claim that aggregate Windows `pnpm verify`, development Electron, unpacked Electron or a real remote provider has passed. GitHub Actions remains the aggregate technical gate.

The diagnostics request can incur a small provider charge. A successful response confirms only that one bounded request reached a compatible endpoint with the stored credential; it does not certify model quality, privacy policy, quota, context capacity or future uptime.

## Next slice

After the aggregate gate is green, Phase 1I-F should focus on stable source identity rather than adding more transport features:

1. stable current-selection or semantic-block mapping from the pinned Typie runtime
2. block-aware proposal diff
3. per-hunk review and acceptance
4. automatic safety snapshot before multi-block or multi-document commit
5. proposal provenance without storing hidden prompts, credentials or response bodies
6. manual Ollama/LM Studio compatible-runtime validation
7. manual remote HTTPS validation with a disposable user-owned credential

No provider response may mutate a project without a second explicit author action and fresh identity/revision checks.
