# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ user selects an explicit scope
        ▼
Madi invocation scope + scope SHA-256
        │
        ├─ user confirms provider/model/scope
        ▼
Trusted Electron IPC
        ▼
Main-process LLM runtime service
        ├─ app-level provider config store
        ├─ Electron safeStorage credential protector
        └─ bounded OpenAI-compatible transport
        ▼
Proposal result
        │
        └─ future diff/review/apply workflow
```

The LLM adapter is not part of the Typie editor engine and does not change Publication IR or export behavior. It consumes only the text and context explicitly selected by the user, then returns a non-canonical proposal.

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

Provider configuration is stored under Electron `userData/llm-providers-v1`, not in a `.madi` project. The encrypted credential bytes are stored beside the config, but plaintext keys are never serialized. Electron `safeStorage` provides encryption and decryption. When OS-protected storage is unavailable, keyless loopback providers can still work, while key-based providers report a locked or unavailable credential state.

The store uses a bounded exact-schema JSON format, revision-checked updates, unique provider IDs, temporary files, and recoverable primary/backup replacement. A corrupt optional store does not prevent the rest of madi from opening.

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

## Explicit scope consent

The consent record stores the SHA-256 of the ordered scope payload:

```text
scope kind
source ID
manuscript text
optional context text
```

Immediately before transport, the main process recomputes the hash. A changed selection, scene, or context causes `CONSENT_MISMATCH`, and no network call occurs. This prevents editor updates from silently expanding or altering the text sent after the user reviewed the confirmation screen.

## Electron boundary

The renderer receives only a frozen `window.madiLlm` API with six operations:

- get runtime status
- list providers
- save provider
- delete provider
- invoke
- cancel

The preload bridge routes these operations through fixed `madi:llm:*` channels. Main-process handlers reuse the existing trusted-sender check, accept exact request shapes, and return sanitized errors. The renderer does not receive raw `ipcRenderer`, filesystem access, Node fetch, or decrypted credentials.

## Transport constraints

The OpenAI-compatible client:

- runs in the Electron main process
- accepts an injected `fetch` implementation for deterministic tests
- sends one non-streaming chat-completions POST request
- enforces request-field and text-size limits
- validates credentials before header construction
- applies a per-provider timeout
- supports caller cancellation
- rejects redirects
- bounds response bodies to 4 MiB
- accepts string content and arrays of text content parts
- exposes normalized usage and finish metadata only

Provider error bodies are consumed only to release the response stream. They are not copied into errors, evidence, or logs.

## Failure isolation

The LLM provider store is optional. Initialization errors are retained inside `LlmRuntimeService`, which reports the LLM subsystem as unavailable but does not block the editor, project storage, Reader Lab, EPUB, or HWPX workflows. Active LLM requests are aborted when the app quits.

## Proposal application boundary

This phase does not write model output to Typie. The next slice must keep proposals in a separate review buffer and apply accepted edits through Madi-owned editor transactions. Multi-block application must create a safety snapshot first, following the existing project-wide rollback policy.
