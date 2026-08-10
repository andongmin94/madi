# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ user copies an explicit active-document scope
        ▼
Madi invocation scope + scope SHA-256
        │
        ├─ user confirms provider/model/host/character count
        ▼
Trusted Electron IPC
        ▼
Main-process LLM runtime service
        ├─ app-level provider config store
        ├─ Electron safeStorage credential protector
        └─ bounded OpenAI-compatible transport
        ▼
Non-canonical proposal buffer
        │
        ├─ copy/reject
        └─ explicit safe apply when Typie identity still matches
                ▼
        one Typie semantic replacement transaction
```

Provider diagnostics use a separate manuscript-free branch:

```text
Stored provider selection
        ▼
Exact test-provider IPC request
(request ID + provider ID + expected revision only)
        ▼
Main process creates fixed empty scope and MADI_OK prompt
        ▼
Same bounded OpenAI-compatible transport
        ▼
status + model + latency only
```

The LLM adapter is not part of the Typie editor engine and does not change Publication IR or export behavior. It consumes only text and context explicitly copied into the AI panel. Provider output remains non-canonical until the author performs a second apply action.

## Provider configuration and credentials

`LlmProviderConfig` contains only versioned, non-secret values:

- provider ID and revision
- display name
- provider kind
- base URL
- model
- credential reference ID
- API-key requirement
- timeout
- maximum output tokens
- temperature

Provider configuration is stored under Electron `userData/llm-providers-v1`, not in a `.madi` project. Encrypted credential bytes are stored beside the config, but plaintext keys are never serialized. Electron `safeStorage` provides encryption and decryption.

The renderer receives provider summaries and credential states only. Existing keys are never read back into settings. An empty key during a revision-checked update means “preserve the existing encrypted credential.”

The store uses a bounded exact-schema JSON format, revision-checked updates, unique provider IDs, temporary files and recoverable primary/backup replacement. A corrupt optional provider store does not prevent the rest of madi from opening.

## Endpoint policy

Remote endpoints:

- require HTTPS
- may not contain username or password
- may not contain query parameters or fragments
- do not follow redirects

Local endpoints:

- `http://127.0.0.1`
- `http://localhost`
- `http://[::1]`

The adapter resolves an OpenAI-compatible base URL to `/v1/chat/completions`, unless the configured URL already ends with `/v1` or `/chat/completions`.

## Active editor access

The AI panel does not create another Typie engine. `LlmEditorAccess` observes the existing one live Madi editor adapter.

It tracks:

- a document generation incremented whenever a Typie document is attached or restored
- the current editor transaction revision
- native composition state
- whether semantic text-range replacement is available

The generation distinguishes different scenes or entity notes even when local editor revisions match. A proposal records generation and revision before transport. Any owner switch, restore or later transaction invalidates it.

Text capture is refused during native IME composition. Captured text becomes a separate editable transmission buffer; later editor changes do not silently expand it.

## Explicit manuscript-scope consent

Browser and main process share one deterministic scope serialization contract:

```text
scope kind
source ID
manuscript text
optional context text
```

The source ID for a bound live-editor request carries generation and revision. The confirmation UI shows provider, model, destination host and character count. Only after one-request consent does the renderer calculate SHA-256 and invoke the trusted preload API.

Immediately before transport, the main process recomputes the same hash. A changed or malformed scope causes `CONSENT_MISMATCH`, and no network call occurs.

## Electron boundary

The renderer receives a frozen `window.madiLlm` API with seven operations:

- get runtime status
- list providers
- save provider
- delete provider
- test provider connectivity
- invoke a manuscript request
- cancel an active request

Preload routes these through fixed `madi:llm:*` channels. Main-process handlers reuse the existing trusted-sender check, parse exact nested shapes and return sanitized errors. The renderer does not receive raw `ipcRenderer`, filesystem access, Node fetch or decrypted credentials.

The connectivity-test request accepts exactly three values:

- request ID
- provider ID
- expected provider revision

Additional manuscript, context, prompt, header or endpoint fields are rejected before service dispatch.

## Transport constraints

The OpenAI-compatible client:

- runs in the Electron main process
- accepts injected `fetch` for deterministic tests
- sends one non-streaming chat-completions POST request
- enforces request-field and text-size limits
- validates credentials before header construction
- applies a per-provider timeout
- supports caller cancellation
- rejects redirects
- bounds response bodies to 4 MiB
- accepts string content and arrays of text content parts
- exposes normalized usage and finish metadata only

Provider error bodies are consumed only to release the response stream. They are not copied into errors, evidence or logs.

## Provider connectivity diagnostics

`LlmRuntimeService.testProvider` resolves the stored provider and protected credential, then creates this fixed scope:

```text
kind: CUSTOM
sourceId: madi-provider-connectivity-test-v1
manuscriptText: ""
contextText: null
```

The system and user instructions request the exact marker `MADI_OK`. The request uses the same active-request map, timeout, cancellation and transport implementation as normal invocations.

The service returns:

- request ID
- provider ID
- configured model
- response model
- `CONNECTED` or `CONNECTED_UNEXPECTED_RESPONSE`
- measured latency

The response body is discarded. Diagnostic results are not written to `.madi`, snapshots, reports or telemetry. This decision is recorded in [`ADR-0013`](decisions/ADR-0013-provider-connectivity-tests-send-no-manuscript.md).

A real loopback HTTP test exercises the production URL resolution, request body, network socket, response parser and cleanup. Remote HTTPS validation remains manual because it requires a disposable user-owned key and may incur cost.

## Failure isolation

The LLM subsystem is optional. Provider-store initialization errors are retained inside `LlmRuntimeService`, which reports the feature as unavailable but does not block the editor, project storage, Reader Lab, EPUB or HWPX. Active manuscript and diagnostic requests are aborted when the app quits.

## Proposal review

Provider output remains outside the canonical project until the author takes another action. The panel displays original and proposal text side by side and always permits copy or rejection.

Summary, consistency-review and continuation outputs remain review material. They are not interpreted as replacement text.

## Safe single-range application

`LlmEditorAccess` may apply a rewrite only when the proposal remains bound to the same active document generation and revision. The annotated recovery text is reread immediately before mutation.

The planner requires:

- one exact occurrence of the original scope
- no line or paragraph separator in source or proposal
- no scene-break fallback text
- non-empty changed output
- a replacement-capable Typie adapter
- inactive native composition

The planner converts JavaScript code-unit positions to Unicode-scalar offsets and creates one Madi-owned `EditorTextReplacement` for `replaceTextRanges`.

The pinned Typie adapter independently verifies expected prose, replacement outcomes, resulting text, semantic scene-break count and semantic structure. It restores the original snapshot if a postcondition fails. Madi also verifies that returned full text equals the reviewed expected result, and locks editor interaction during the boundary when supported.

The successful operation creates one normal Typie history entry. `Ctrl+Z` is the rollback path. This decision is recorded in [`ADR-0012`](decisions/ADR-0012-llm-single-range-apply-uses-typie-transaction.md).

## Broad application boundary

Multi-block, newline-bearing, ambiguous, stale, missing and unbound proposals remain copy-only. A future phase must add stable Typie block or selection mapping, per-hunk acceptance and an automatic safety snapshot before any accepted operation touches multiple semantic blocks or documents.
