# Phase 1I — User-owned LLM Adapter Foundation

## Status

```text
Phase 1I-A implementation: IN PROGRESS ON main
Distribution boundary: PRIVATE LOCAL ONLY
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Windows native Korean IME: MANUAL VALIDATION PENDING
Phase 1H Windows actual: CI VERIFICATION IN PROGRESS
```

Phase 1I starts with a small, testable transport boundary instead of adding an AI writing UI directly to the existing renderer monolith. The first slice defines the provider and invocation contracts, enforces explicit scope consent, and implements a bounded OpenAI-compatible client in the Electron main-process codebase.

## Product rules

1. AI is optional. Every non-AI writing, organization, preview, and export feature continues to work without a provider.
2. madi does not operate an LLM proxy or account service.
3. The user owns the provider account, API key, local model, and resulting charges.
4. A remote provider must use HTTPS. Plain HTTP is accepted only for loopback endpoints such as `127.0.0.1`, `localhost`, or `::1`.
5. A provider URL must not contain credentials, query parameters, or fragments.
6. API keys are not part of the provider config, `.madi` project file, logs, evidence, reports, or error messages.
7. A request is rejected if the selected manuscript scope changes after the user confirms transmission.
8. Provider output is a proposal. It is not written into a Typie document automatically.
9. Manuscript and provider response bodies are never included in application logs or sanitized errors.
10. Redirects are rejected so a configured provider cannot silently forward manuscript content to another host.

## Phase 1I-A implementation

- `apps/desktop/src/shared/llm.ts`
  - versioned provider config
  - safe base-URL validation and normalization
  - OpenAI-compatible chat endpoint resolution
  - invocation scope, consent, usage, and result contracts
  - no secret-bearing fields
- `apps/desktop/src/main/llm/openAiCompatibleClient.ts`
  - SHA-256 binding of user consent to the exact selected scope
  - request and response size bounds
  - timeout and cancellation
  - redirect rejection
  - generic status/error mapping without response-body leakage
  - string and text-part assistant response support
- automated contract and transport tests using injected `fetch`; tests make no real network request

## Deferred to the next Phase 1I slice

- Electron IPC and typed preload methods
- OS-protected credential storage using Electron `safeStorage`
- provider CRUD UI
- explicit send-confirmation UI showing provider, model, selected scope, and character count
- streaming response UI
- proposal diff, partial apply, reject, and snapshot-before-apply
- scene, chapter, Story Bible, and custom prompt recipes
- local-model discovery
- usage/cost display
- real-provider manual validation

## Explicitly out of scope

- automatic background manuscript upload
- server-owned provider keys
- automatic rewrite without review
- LLM output stored as canonical manuscript before user approval
- provider-specific SDKs
- arbitrary request headers or scripts
- remote HTTP endpoints
- collaborative AI sessions
- AI telemetry
