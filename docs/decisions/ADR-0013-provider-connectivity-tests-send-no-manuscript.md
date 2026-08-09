# ADR-0013 — Provider connectivity tests send no manuscript

## Status

Accepted for private-local Phase 1I-E development.

## Context

A user-owned LLM provider can be misconfigured even when its URL and credential were stored successfully. Authors need a way to distinguish configuration, authentication, network and OpenAI-compatibility failures before they deliberately send manuscript text.

Reusing the normal assistant invocation with the active scene would make diagnostics unnecessarily disclose private content. Discovering models through provider-specific endpoints would also expand the transport surface and create inconsistent behavior across OpenAI-compatible implementations.

## Decision

1. Provider connectivity diagnostics use the same bounded main-process OpenAI-compatible transport as normal invocations.
2. The request scope is fixed by Madi:
   - kind `CUSTOM`
   - source ID `madi-provider-connectivity-test-v1`
   - empty manuscript text
   - no context text
3. The fixed system and user instructions request the exact marker `MADI_OK`.
4. The renderer may choose only a stored provider and create a request ID. It cannot supply manuscript, context, prompt, headers or endpoint overrides to the diagnostics IPC method.
5. The main process resolves the stored provider revision and protected credential.
6. The existing timeout, cancellation, redirect rejection, response-size limit and sanitized-error rules remain in force.
7. A response equal to `MADI_OK` is reported as `CONNECTED`.
8. A valid provider response with different text is reported as `CONNECTED_UNEXPECTED_RESPONSE`, not as a successful contract check.
9. The renderer receives only provider IDs, configured/response model names, status and latency. Provider response text is discarded.
10. The diagnostics result is not stored in `.madi`, named snapshots, reports or telemetry.
11. Connectivity success does not certify model quality, privacy policy, cost, quota, future availability or complete API compatibility.
12. Remote HTTPS providers still require a separate manual validation with a disposable user-owned key before any distribution claim.

## Consequences

### Positive

- authors can validate endpoint and credential configuration before exposing manuscript text
- diagnostics exercise the real main-process transport rather than a separate mock path
- no provider-specific SDK, model-list endpoint or arbitrary request builder is introduced
- cancellation and privacy behavior remain identical to ordinary requests
- local loopback providers can be verified end to end in automated tests

### Negative

- some compatible models may ignore the exact-response instruction and show a warning despite being reachable
- one successful request cannot guarantee that a later long manuscript request will fit the provider's context or quota
- the extra request may still incur a small provider charge
- remote provider validation remains a user-controlled manual gate

## Rejected alternatives

### Send the active scene as a test

Rejected because connectivity does not require manuscript disclosure.

### Let the renderer construct a custom diagnostics prompt

Rejected because it would create a second arbitrary prompt and data-transfer boundary.

### Call provider-specific model-list APIs

Rejected because OpenAI-compatible services vary widely, and model discovery would add credentials, response schemas and network paths that the product does not need yet.
