# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ explicit copied document scope, or
        └─ exact live same-node selection
        ▼
Madi invocation scope + scope SHA-256
        │
        ├─ user confirms provider/model/host/content
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
        ├─ lexical hunk include/exclude review
        └─ explicit safe apply after fresh Typie identity checks
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

The LLM adapter is not part of the Typie editor engine and does not change Publication IR or export behavior. It consumes only text and context explicitly approved by the author. Provider output remains non-canonical until the author performs a second apply action.

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

The AI surfaces do not create another Typie engine. `LlmEditorAccess` observes the existing one live Madi editor adapter.

It tracks:

- a document generation incremented whenever a Typie document is attached or restored
- the current editor transaction revision
- native composition state
- text-selection mapping availability
- semantic text-range replacement availability

The generation distinguishes different scenes or entity notes even when local editor revisions match. A proposal records generation and revision before transport. Any owner switch, restore or later content transaction invalidates it.

Text or selection capture is refused during native IME composition. Captured content becomes a separate transmission buffer; later editor changes do not silently expand it.

## Exact Typie selection mapping

The Madi-owned adapter contract exposes only:

```text
selected text
annotated-prose start scalar
annotated-prose end scalar
opaque same-node key
```

Raw Typie `Editor`, `Position`, `Selection` and CRDT node shapes stay inside `apps/desktop/src/renderer/editor/typie`.

The mapping algorithm reads:

- the live Typie selection
- Typie clipboard text for that selection
- full annotated recovery text

It rejects collapsed selections and selections whose anchor and head belong to different Typie text nodes. It then finds every occurrence of the selected clipboard text in annotated recovery text. Each candidate code-unit boundary is converted to Unicode-scalar offsets and mapped back through `prose_to_selection_annotated`. Only the candidate whose returned CRDT endpoints equal the live selection is accepted.

This endpoint round trip, not text equality alone, identifies the exact selected occurrence when identical prose appears more than once.

The browser port is pinned together with Typie. `selectionAwarePort.ts` adds the engine-independent selection method inside the same adapter directory and fails closed if the pinned browser-port shape changes. No Typie type escapes into application workspaces or shared IPC contracts.

## Explicit manuscript-scope consent

Browser and main process share one deterministic scope serialization contract:

```text
scope kind
source ID
manuscript text
optional context text
```

A copied-document source ID carries generation and revision. An exact-selection source ID additionally carries start scalar, end scalar and the opaque same-node key. The confirmation UI shows provider, model, destination host and content. Only after one-request consent does the renderer calculate SHA-256 and invoke the trusted preload API.

Immediately before transport, the main process recomputes the same hash. A changed or malformed scope causes `CONSENT_MISMATCH`, and no network call occurs.

The opaque selection key is consent/apply metadata. It is not included in the provider chat messages, which contain only the approved instruction, optional context and manuscript scope.

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

A real loopback HTTP test exercises production URL resolution, request body, network socket, response parser and cleanup. Remote HTTPS validation remains manual because it requires a disposable user-owned key and may incur cost.

## Failure isolation

The LLM subsystem is optional. Provider-store initialization errors are retained inside `LlmRuntimeService`, which reports the feature as unavailable but does not block the editor, project storage, Reader Lab, EPUB or HWPX. Active manuscript and diagnostic requests are aborted when the app quits.

## Proposal buffers and lexical hunk review

Provider output remains outside the canonical project until the author takes another action. The general panel displays original and proposal text side by side and always permits copy or rejection.

The exact-selection panel creates a bounded lexical review model. It tokenizes whitespace, Unicode letter/number/mark runs and punctuation/symbol runs, then computes a deterministic longest-common-subsequence diff. Consecutive delete/insert operations form one hunk.

Each hunk is selected by default. The author may reject any hunk, and `renderLlmProposalReview` renders the chosen set into one complete replacement string. No hunk is applied independently to Typie.

Diff work is bounded by token and matrix limits. A larger selection becomes one coarse hunk rather than blocking the renderer with unbounded quadratic work. Review hunks are ephemeral UI data; they are not canonical Typie nodes, `.madi` records, snapshots or provider provenance.

Summary, consistency-review and continuation outputs remain review material and are not interpreted as replacement text.

## Safe unique-text application

The Phase 1I-D fallback may apply a rewrite when its source occurs exactly once in the active document. `LlmEditorAccess` rereads annotated recovery text and verifies generation, revision, source text and structural restrictions before creating one Madi-owned `EditorTextReplacement`.

JavaScript code-unit positions are converted to Unicode-scalar offsets. The pinned Typie adapter independently verifies expected prose, replacement outcomes, resulting text, semantic scene-break count and semantic structure. It restores the original snapshot if a postcondition fails. Madi also verifies returned full text and locks editor interaction during the boundary when supported.

The successful operation creates one normal Typie history entry. `Ctrl+Z` is the rollback path. This decision is recorded in [`ADR-0012`](decisions/ADR-0012-llm-single-range-apply-uses-typie-transaction.md).

## Safe exact-selection application

An exact-selection proposal carries the captured generation, revision, scalar range and opaque same-node key. Immediately before mutation, Madi rereads the current annotated recovery text and verifies that the expected source still occupies the exact scalar range.

The final accepted hunk rendering must be:

- non-empty
- different from the source
- free of line and paragraph separators
- free of scene-break fallback text
- bound to the same document generation and editor revision
- applied while native composition is inactive

Madi passes one replacement for the complete exact selection to `replaceTextRanges`. The Typie adapter performs the same semantic postcondition checks as the unique-text path. A successful operation creates one Undo entry, regardless of how many lexical review hunks were accepted.

Because the operation remains inside one exact Typie text node, no named safety snapshot is created. The decision is recorded in [`ADR-0014`](decisions/ADR-0014-llm-selection-hunks-remain-one-typie-node.md).

## Broad application boundary

The following remain copy-only or rejected:

- cross-node or modifier-boundary selections
- newline-bearing or multi-block proposals
- stale, missing or unmappable selections
- multi-document and project-wide proposals
- automatic Story Bible mutations

A future broad-apply phase must introduce stable semantic-block identity and create an automatic safety snapshot before any accepted operation touches multiple Typie blocks or documents. It must commit all selected block changes atomically or restore the project from that snapshot. The current lexical hunk model alone is not sufficient authorization for broad mutation.
