# ADR-0015 — Multi-block AI apply requires a durable project snapshot

## Status

Accepted for private-local Phase 1I-G development.

## Context

A single exact Typie selection can be changed by one semantic transaction and reverted with one normal editor Undo entry. A broader AI rewrite is materially different: it can touch several paragraphs, and a later save, close, reload or unrelated edit can make an in-memory Undo path unavailable or unclear.

The pinned Typie runtime can atomically execute several non-overlapping text replacements in one transaction, but that transaction alone is not a durable project recovery point. Madi already treats other broad operations, such as project-wide replacement and snapshot restore, as operations that need a recoverable logical checkpoint.

## Decision

1. A broad AI proposal is limited initially to the complete active Typie document.
2. Paragraph separators and semantic scene-break positions must remain unchanged.
3. Every changed block must map to a non-empty in-place text replacement.
4. Pure block insertion, block deletion, block reorder and scene-break mutation are rejected.
5. The proposal is planned from annotated recovery text using Unicode-scalar offsets.
6. The document generation and editor revision are checked before planning, after snapshot creation and immediately before mutation.
7. Before any multi-block mutation, Madi must create a durable project snapshot named as an AI-apply safety checkpoint.
8. The snapshot request contains only snapshot metadata, changed-block count and source identity. It does not contain prompts, credentials, manuscript text or provider response text.
9. Snapshot failure or an invalid snapshot receipt prevents all manuscript mutation.
10. After the checkpoint, all approved replacements are sent to Typie in one `replaceTextRanges` call.
11. Typie remains responsible for same-node, modifier, scene-break and semantic-structure postconditions; Madi verifies the returned complete document text again.
12. Any failed replacement leaves the current document unchanged through the existing Typie transaction rollback boundary.
13. Multi-document and project-wide AI mutation remain prohibited.

## Consequences

### Positive

- broad AI changes cannot bypass durable project recovery
- snapshot creation happens before interaction locking and mutation
- stale edits during snapshot creation are detected
- paragraph and scene-break structure cannot be silently flattened
- all accepted blocks commit as one Typie history operation
- snapshot records do not retain private prompts, provider responses or credentials

### Negative

- proposals that add, remove or reorder paragraphs remain review/copy only
- pure insertions and deletions inside a paragraph are not yet supported in the broad path
- mixed inline-modifier ownership may still be rejected by the pinned Typie transaction
- the production UI cannot enable broad apply until an active-project snapshot writer is wired to the coordinator

## Implementation boundary

Phase 1I-G introduces:

- a deterministic, bounded broad-proposal planner
- a snapshot-before-mutation coordinator
- focused tests proving ordering, fail-closed behavior and all-or-nothing dispatch

The existing UI remains unable to invoke broad mutation until the current project session can provide a real `createNamedSnapshot` receipt. This is deliberate: a missing production snapshot bridge must disable the feature rather than substitute an in-memory backup.

## Rejected alternatives

### Rely only on Ctrl+Z

Rejected because editor history is not a durable project checkpoint across save, close and restart boundaries.

### Save only a Typie binary snapshot in renderer memory

Rejected because it is lost on process failure and does not cover the project-level persistence contract.

### Flatten the complete proposal back into plain text

Rejected because it would lose semantic scene breaks, inline modifiers, ruby and other Typie document structure.

### Apply blocks one by one

Rejected because partial success would leave a document that matches neither the reviewed source nor the reviewed proposal.
