# Phase 1I — User-owned LLM adapter

## Current scope

```text
Provider transport and protected credentials: IMPLEMENTED
Explicit one-request scope consent: IMPLEMENTED
Provider connectivity diagnostics: IMPLEMENTED
General proposal review and copy: IMPLEMENTED
Exact same-block selection rewrite: IMPLEMENTED
Per-hunk review inside the selected range: IMPLEMENTED
Multi-block or multi-document mutation: NOT IMPLEMENTED
Distribution boundary: PRIVATE LOCAL ONLY
```

Phase 1I keeps AI optional and user-owned. Madi does not operate a proxy, account service, shared key, or background manuscript upload.

Current execution priorities and verification status are maintained in [PLANS.md](../PLANS.md).
The mutation contract follows [AGENTS.md](../AGENTS.md): exact same-block selection only.

## Product rules

1. The application remains fully usable without an AI provider.
2. Remote providers require HTTPS; plain HTTP is accepted only for loopback endpoints.
3. API keys are stored outside `.madi` using Electron `safeStorage` and are never returned to the renderer.
4. Every request is bound to an explicitly confirmed scope hash.
5. Provider output enters a non-canonical proposal buffer.
6. Canonical mutation requires a second author action, an exact same-block selection range, and a fresh editor identity/range check.
7. Errors, logs, reports, and evidence exclude manuscript text, provider response bodies, prompts, and credentials.

## Supported authoring workflows

### General assistant

- rewrite, continuation, summary, consistency review, or custom instruction
- explicit provider, model, destination host, and character-count confirmation
- request cancellation
- original/proposal side-by-side review
- proposal review and copy
- canonical application through the exact-selection workflow

The current general-assistant implementation also contains a unique-text application route without
exact selection coordinates. That static discrepancy is recorded in [PLANS.md](../PLANS.md);
it is not an expansion of the approved mutation contract.

### Exact selection rewrite

- reads the current same-block Typie selection
- preserves the exact duplicate occurrence by round-tripping through Typie selection mapping
- supports per-hunk acceptance within the selected text
- revalidates generation, revision, Unicode-scalar offsets, expected text, and native composition immediately before mutation
- applies one Typie semantic transaction and creates one normal Undo entry

### Provider diagnostics

- sends no manuscript or project context
- uses a fixed `MADI_OK` connectivity request
- returns status, response model, and latency without exposing provider output

## Removed experimental scope

The former multi-block review overlay, structured selection bridge, broad planner, and snapshot coordinator were removed. They added a second global AI workflow and editor contract while the production apply action remained disabled. No compatibility layer remains.

Multi-block or multi-document AI mutation may return only as a complete vertical slice with durable project recovery, a single review surface, and exact packaged verification.

## Remaining validation

Windows aggregate, development/fresh-unpacked runtime, actual provider, and native IME validation
are tracked in [PLANS.md](../PLANS.md). Typie development permission is
[owner-confirmed](TYPIE_LICENSE_STATUS.md); each release must remain within the external grant terms.
