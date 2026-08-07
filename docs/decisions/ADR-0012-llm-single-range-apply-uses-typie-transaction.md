# ADR-0012 — LLM single-range apply uses one Typie transaction

## Status

Accepted for private-local Phase 1I-D development.

## Context

Phase 1I-C returned provider output as a non-canonical proposal. Applying that proposal by replacing an entire plain-text recovery copy would destroy or flatten Typie paragraph boundaries, scene breaks, ruby and inline modifiers. At the same time, the pinned Typie runtime already exposes Madi's validated `replaceTextRanges` boundary, backed by `replace_many_from_prose_annotated`, and verifies semantic structure after a replacement.

A broad multi-paragraph or project-wide AI change has different rollback and identity requirements from one replacement inside the currently active Typie document.

## Decision

1. Direct AI proposal apply is restricted to the currently active Typie document.
2. The proposal is bound to both a document generation and editor revision captured before invocation.
3. A Typie document restore or owner switch increments the generation and invalidates the proposal.
4. Any content transaction that advances the editor revision invalidates the proposal.
5. The original scope must occur exactly once in the current annotated recovery text.
6. Source and proposal must be non-empty and must not contain line, paragraph or Unicode paragraph separators.
7. Scene-break fallback text such as `***` or `* * *` is never replaced automatically.
8. Offsets are converted from JavaScript UTF-16 positions to Unicode-scalar offsets before reaching Typie.
9. Immediately before mutation, Madi rereads the active document and repeats every identity and range check.
10. Editor interaction is locked during the replacement when the adapter supports locking.
11. The replacement is applied through one Typie semantic transaction and its postconditions are checked by the existing adapter.
12. A successful single-range apply is rolled back with Typie `Ctrl+Z`; no named safety snapshot is created for this one-document transaction.
13. Multi-block, newline-bearing, ambiguous, missing, stale and unbound proposals remain non-canonical and copy-only.
14. Summary, consistency-review and continuation tasks are not treated as replacement proposals.

## Consequences

### Positive

- paragraph, scene-break, ruby and inline modifier structure remains under Typie's semantic transaction contract
- stale proposals cannot overwrite a different scene, entity note or later edit
- emoji and non-BMP Korean-adjacent content use the offset system expected by Typie
- one accepted rewrite creates one normal editor Undo entry
- no extra project snapshot is created for a small local edit

### Negative

- repeated source text is considered ambiguous until a stable selection-range API is available
- multi-paragraph rewrites cannot yet be applied automatically
- partial hunk acceptance is not yet available
- manually edited transmission text can be applied only when it still matches exactly one current document range

## Deferred work

A future broad-apply phase may add stable block or selection source mapping, partial diff acceptance and multi-block transactions. Before any accepted operation touches more than one semantic block or document, Madi must create an automatic safety snapshot and preserve the existing project-wide rollback policy.
