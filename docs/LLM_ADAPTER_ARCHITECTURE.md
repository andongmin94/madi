# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ user selects an explicit scope
        ▼
Madi LLM invocation scope
        │  SHA-256
        ├─ user confirms provider/model/scope
        ▼
Electron main OpenAI-compatible client
        │
        ├─ HTTPS remote provider, or
        └─ loopback HTTP local provider
        ▼
Proposal result
        │
        └─ future diff/review/apply workflow
```

The LLM adapter is not part of the Typie editor engine and does not change the Publication IR or export pipeline. It consumes a user-selected copy of text and optional context, and returns a proposal. Canonical manuscript changes remain Typie transactions initiated after user review.

## Provider config and secrets

`LlmProviderConfig` contains only non-secret, versioned configuration:

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

The actual API key is passed to the main-process transport at invocation time. It is never serialized into provider config. The next implementation slice will bind credential references to Electron `safeStorage`-protected records outside `.madi`.

## Endpoint policy

Remote endpoints:

- must use HTTPS
- may not contain username/password
- may not contain a query string or fragment
- do not follow redirects

Local endpoints:

- `http://127.0.0.1`, `http://localhost`, and `http://[::1]` are allowed
- this supports user-operated OpenAI-compatible local gateways

The adapter resolves a base URL to `/v1/chat/completions`, unless the URL already ends with `/v1` or `/chat/completions`.

## Explicit scope consent

The consent record contains the SHA-256 of this ordered scope payload:

```text
scope kind
source ID
manuscript text
optional context text
```

Immediately before transport, the main process recomputes the hash. A changed selection, scene, or context causes `CONSENT_MISMATCH`, and no network call occurs.

This prevents an asynchronous editor update from silently increasing the text sent after the confirmation UI was shown.

## Transport constraints

The OpenAI-compatible client:

- accepts an injected `fetch` implementation for deterministic tests
- sends one non-streaming chat-completions POST request
- enforces request-field and text-size limits
- rejects missing or header-unsafe API keys
- applies a per-provider timeout
- supports caller cancellation
- rejects redirects
- bounds response bodies to 4 MiB
- accepts string content and arrays of text content parts
- exposes normalized usage and finish metadata only

Provider error bodies are consumed only to release the stream. They are not copied into thrown errors, evidence, or logs.

## Error model

Errors are reduced to Madi-owned codes:

- invalid request or consent mismatch
- missing/invalid credential
- cancellation or timeout
- network failure
- authentication failure
- rate limit
- provider unavailable/rejected
- oversized or malformed response

The error object carries only a generic description, optional HTTP status, and retryable flag. It does not retain the request, response body, prompt, manuscript, or API key.

## Next integration slice

1. Add OS-protected credential storage.
2. Add typed main/preload IPC without exposing `fetch`, filesystem, or secrets to the renderer.
3. Add provider CRUD and explicit send confirmation.
4. Show proposals in a non-canonical review buffer.
5. Add a Typie semantic diff/apply adapter with an automatic safety snapshot before any accepted multi-block change.
6. Preserve the current offline/no-provider path as the default product state.
