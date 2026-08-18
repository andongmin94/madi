# LLM adapter architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ author chooses an exact same-block range or copies explicit text
        ▼
Madi invocation scope + scope SHA-256
        │
        ├─ author confirms provider, model, host, and character count
        ▼
Trusted preload IPC
        ▼
Electron main LLM service
        ├─ provider config outside .madi
        ├─ safeStorage-protected credential
        └─ bounded OpenAI-compatible transport
        ▼
Non-canonical proposal
        │
        ├─ copy or reject
        └─ explicit exact-selection apply
                ▼
        one Typie semantic transaction
```

The LLM adapter is optional and does not participate in Publication IR, EPUB, HWPX, Story Bible, World Graph, or Plot Canvas canonical storage.

## Provider and secret storage

Provider configuration contains only versioned non-secret values: ID, revision, display name, endpoint, model, credential reference, timeout, output-token limit, and temperature. The actual API key is encrypted with Electron `safeStorage` under the application `userData` directory and is never serialized into `.madi` or returned to the renderer.

Remote endpoints require HTTPS. Plain HTTP is accepted only for loopback hosts. URLs with embedded credentials, query parameters, or fragments are rejected. Redirects are not followed.

## Explicit transmission consent

Browser and main process share one deterministic scope serialization. The confirmation view shows the provider, model, destination host, and manuscript character count. The renderer calculates SHA-256 after consent; the main process recomputes it immediately before transport. A changed or malformed scope causes a failure before the network request.

## Proposal-first workflow

Provider output is not canonical text. The author first reviews or copies it. Summary, consistency-review, and continuation output are never interpreted as direct replacements.

The exact selection rewrite workflow is the only automatic mutation path:

1. map the live same-block Typie selection to annotated-recovery Unicode-scalar offsets;
2. bind the request to editor generation and revision;
3. build a proposal diff and let the author select hunks;
4. reread and revalidate the current document;
5. lock editor interaction;
6. call `replaceTextRanges` once;
7. verify full resulting text and semantic postconditions;
8. unlock and leave one standard Typie Undo entry.

Equal text elsewhere cannot be changed accidentally because each candidate range is round-tripped through Typie and compared with the live selection.

## Provider diagnostics

The diagnostics surface sends an empty manuscript scope with a fixed `MADI_OK` instruction. It reports connectivity, response model, and latency. Provider response text is discarded in the main process.

## Error and privacy model

Madi-owned errors contain only a stable code, generic public message, optional status, and retryability. They do not retain prompts, manuscript text, provider response bodies, or credentials. Response bodies are bounded, timeouts and cancellation are supported, and active requests are aborted at application shutdown.

## Deliberately absent broad mutation

Multi-block and multi-document AI mutation is not hidden behind a disabled button or dormant coordinator. The previous experiment was removed because it duplicated proposal and selection logic without a complete production recovery boundary.

A future broad workflow must start as one complete vertical slice with:

- one review surface;
- durable project snapshot creation before mutation;
- stable semantic block identity;
- atomic multi-document core operation;
- exact development and packaged verification.
