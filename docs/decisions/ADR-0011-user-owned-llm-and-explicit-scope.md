# ADR-0011 — LLM access is user-owned and explicitly scoped

## Status

Accepted for private-local Phase 1I development.

## Context

madi is a local-first authoring application. Optional LLM assistance can be useful for rewriting, summarization, Story Bible extraction, and consistency review, but manuscript confidentiality and author control are product requirements. An application-owned proxy would create recurring infrastructure cost, account handling, secret custody, and a new manuscript disclosure boundary.

Editor state can also change between opening an AI panel and sending a request. A simple “send current scene” action could therefore transmit more or different text than the user reviewed.

## Decision

1. madi does not operate an LLM proxy or shared API key.
2. The user configures an OpenAI-compatible remote endpoint or a loopback local endpoint.
3. Remote providers require HTTPS. Plain HTTP is allowed only for loopback hosts.
4. Provider configuration contains a credential reference, never the secret itself.
5. API keys will be stored outside `.madi` using an OS-protected credential boundary.
6. Every invocation identifies an explicit manuscript scope and optional context.
7. The confirmation UI records a SHA-256 of that exact scope.
8. The main-process transport recomputes the hash immediately before the network call and rejects changed scopes.
9. Redirects are rejected.
10. Provider output is a proposal and is not applied to Typie canonical content automatically.
11. Errors, logs, reports, tests, and telemetry must not include manuscript text, provider response bodies, or credentials.
12. The application remains fully usable when no provider is configured.

## Consequences

### Positive

- No Madi server or recurring model cost is required.
- The author chooses the provider, local model, account, and spending policy.
- `.madi` files remain portable without carrying API credentials.
- Scope hashing prevents stale UI state from silently changing transmitted content.
- Proposal-first application preserves editorial control and existing snapshot safety semantics.

### Negative

- Provider setup is more complex for the user.
- Madi must maintain compatibility with imperfect OpenAI-compatible implementations.
- Cost and quota reporting cannot be uniform across providers.
- OS credential storage and provider-specific manual testing are still required.
- Remote providers still receive explicitly approved manuscript text; local-first does not mean network-free after user invocation.

## Rejected alternatives

### Madi-operated proxy

Rejected because it introduces accounts, server operations, manuscript transit, secret custody, and recurring cost.

### Store API keys in `.madi`

Rejected because project files are copied to Dropbox, MYBOX, NAS, email, and other user-controlled locations.

### Send the active editor state without a confirmation-bound hash

Rejected because asynchronous edits or navigation could change the transmitted scope after the user reviewed it.

### Automatically replace manuscript text with model output

Rejected because LLM output is untrusted editorial material and must be reviewed before becoming canonical Typie content.
