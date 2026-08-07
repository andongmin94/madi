# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ user copies the active document into an explicit scope buffer
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
        └─ explicit safe apply when current Typie identity still matches
                ▼
        one Typie semantic replacement transaction
```

The LLM adapter is not part of the Typie editor engine and does not change Publication IR or export behavior. It consumes only the text and context explicitly copied into the AI panel, then returns a non-canonical proposal. Canonical mutation requires a separate user action after proposal review.

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

Provider configuration is stored under Electron `userData/llm-providers-v1`, not in a `.madi` project. Encrypted credential bytes are stored beside the config, but plaintext keys are never serialized. Electron `safeStorage` provides encryption and decryption. When OS-protected storage is unavailable, keyless loopback providers can still work, while key-based providers report a locked or unavailable credential state.

The renderer receives provider summaries and credential states only. An existing API key is never read back into the settings form. An empty key during a revision-checked provider update means “preserve the existing encrypted credential.”

The store uses a bounded exact-schema JSON format, revision-checked updates, unique provider IDs, temporary files and recoverable primary/backup replacement. A corrupt optional store does not prevent the rest of madi from opening.

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

The AI panel does not create another Typie engine. `LlmEditorAccess` observes the existing one live Madi editor adapter created by `App`.

It tracks:

- a document generation incremented whenever a Typie document is attached or restored
- the current editor transaction revision
- native composition state
- whether semantic text-range replacement is available

The generation distinguishes different scenes or entity notes even when their local editor revisions happen to be the same. A proposal records generation and revision before transport. Any owner switch, restore or later content transaction invalidates it.

Text capture is refused while native IME composition is active. The captured text becomes a separate editable transmission buffer; later editor changes do not silently expand that buffer.

## Explicit scope consent

Browser and main process share one deterministic scope serialization contract:

```text
scope kind
source ID
manuscript text
optional context text
```

The source ID for a bound live-editor request carries its generation and revision. The confirmation UI shows provider, model, destination host and manuscript character count. Only after the user checks one-request consent does the renderer calculate SHA-256 and invoke the trusted preload API.

Immediately before transport, the main process recomputes the same hash. A changed or malformed scope causes `CONSENT_MISMATCH`, and no network call occurs. This prevents asynchronous renderer state or altered IPC data from silently changing what is sent after confirmation.

## Electron boundary

The renderer receives only a frozen `window.madiLlm` API with six operations:

- get runtime status
- list providers
- save provider
- delete provider
- invoke
- cancel

The preload bridge routes these operations through fixed `madi:llm:*` channels. Main-process handlers reuse the existing trusted-sender check, parse exact nested invocation shapes and return sanitized errors. The renderer does not receive raw `ipcRenderer`, filesystem access, Node fetch or decrypted credentials.

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

Provider error bodies are consumed only to release the response stream. They are not copied into errors, evidence or logs.

## Failure isolation

The LLM provider store is optional. Initialization errors are retained inside `LlmRuntimeService`, which reports the LLM subsystem as unavailable but does not block the editor, project storage, Reader Lab, EPUB or HWPX workflows. Active LLM requests are aborted when the app quits.

## Proposal review

Provider output remains outside the canonical project until the author takes another action. The panel displays original text and proposal side by side and always permits copy or rejection.

Summary, consistency-review and continuation outputs remain review material. They are not interpreted as replacement text.

## Safe single-range application

`LlmEditorAccess` may apply a rewrite only when the proposal remains bound to the same active document generation and revision. The current annotated recovery text is reread immediately before mutation.

The planner requires:

- one exact occurrence of the original scope
- no line or paragraph separator in source or proposal
- no scene-break fallback text
- non-empty changed output
- a replacement-capable Typie adapter
- inactive native composition

The planner finds the unique JavaScript code-unit range, then converts its start and end to Unicode-scalar offsets. It creates one Madi-owned `EditorTextReplacement` and passes it to `replaceTextRanges`.

The pinned Typie adapter independently:

- verifies expected annotated prose
- applies `replace_many_from_prose_annotated`
- checks every replacement outcome
- checks resulting text
- checks semantic scene-break count
- checks semantic document structure
- restores the original snapshot if a postcondition fails

Madi also verifies that the returned full plain text equals the reviewed expected result. Editor interaction is locked during this boundary when supported.

The successful operation creates one normal Typie history entry. `Ctrl+Z` is the rollback path. This narrow operation does not create a named snapshot; the decision is recorded in [`ADR-0012`](decisions/ADR-0012-llm-single-range-apply-uses-typie-transaction.md).

## Broad application boundary

Multi-block, newline-bearing, ambiguous, stale, missing and unbound proposals remain copy-only. A future broad-apply phase must add stable Typie block or selection mapping, partial hunk acceptance and an automatic safety snapshot before any accepted operation touches multiple semantic blocks or documents.

This follows madi’s existing rule: broad operations are recoverable through safety snapshots rather than an invisible persistent project-wide command log.
