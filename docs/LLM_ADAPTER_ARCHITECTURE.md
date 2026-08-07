# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ the user copies the active document into an explicit scope buffer
        ▼
Madi invocation scope + scope SHA-256
        │
        ├─ the user confirms provider/model/host/character count
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
        ├─ copy/reject now
        └─ future semantic diff/partial apply/full apply
```

The LLM adapter is not part of the Typie editor engine and does not change Publication IR or export behavior. It consumes only the text and context explicitly copied into the AI panel, then returns a non-canonical proposal.

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

The renderer receives provider summaries and credential states only. An existing API key is never read back into the settings form. An empty key during a revision-checked provider update means “preserve the existing encrypted credential.”

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

## Active editor access

The AI panel does not create another Typie engine. `LlmEditorAccess` observes the existing one live Madi editor adapter created by `App` and can request its current plain-text recovery view.

- Typie internals remain behind `MadiEditorAdapter`.
- No editor snapshot or engine type is exposed to the AI component.
- Text capture is refused while native IME composition is active.
- Captured text becomes a separate editable transmission buffer.
- Later editor changes do not silently expand that buffer.

The current slice deliberately labels this as the “current editing document,” because the one live editor can own either a SCENE or an ENTITY note. Owner-aware selection and stable block ranges belong to the semantic apply slice.

## Explicit scope consent

Browser and main process share one deterministic scope serialization contract:

```text
scope kind
source ID
manuscript text
optional context text
```

The confirmation UI shows the provider, model, destination host, and manuscript character count. Only after the user checks one-request consent does the renderer calculate SHA-256 and invoke the trusted preload API.

Immediately before transport, the main process recomputes the same hash. A changed or malformed scope causes `CONSENT_MISMATCH`, and no network call occurs. This prevents asynchronous editor updates or altered IPC data from silently changing what is sent after confirmation.

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

## Proposal review and application boundary

The current UI shows original text and proposal side by side, supports cancellation and copy, and never writes model output to Typie automatically.

Direct apply remains disabled because the current AI panel has no stable current-selection or block-range contract. Replacing the complete recovery string would flatten semantic paragraphs, scene breaks, ruby and modifiers. The next slice must add:

- owner-aware source identity
- stable Typie selection or block mapping
- semantic diff
- reject, partial apply and full apply
- stale document/revision checks
- automatic safety snapshot before accepted multi-block changes

This follows madi’s existing rule: a broad operation is recoverable through a safety snapshot rather than an invisible persistent project-wide command log.
