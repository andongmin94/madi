# ADR-0014 — LLM hunk review remains inside one exact Typie text node

## Status

Accepted for private-local Phase 1I-F development.

## Context

Phase 1I-D could apply a rewrite only when its plain-text source occurred exactly once in the active document. That safely avoided the wrong location, but it also blocked ordinary prose when the same sentence appeared more than once.

The pinned Typie runtime exposes the current CRDT selection, clipboard text and a reversible mapping between annotated recovery-text scalar ranges and Typie selections. The existing semantic replacement command can replace one or more validated ranges in one history transaction, but broad multi-block authoring still requires a project-level safety snapshot and a stronger block identity model.

An LLM proposal can also contain several independent word or punctuation changes. Authors need to reject individual changes without manually reconstructing the desired result.

## Decision

1. Madi maps the live, non-collapsed Typie selection to annotated recovery-text Unicode-scalar offsets.
2. Candidate text occurrences are not trusted by text equality alone. Each candidate is converted back through `prose_to_selection_annotated` and compared with the live CRDT selection endpoints.
3. Selection mapping is restricted to anchor and head positions in the same Typie text node.
4. A mapped selection carries an opaque `blockKey`; code outside the Typie adapter must not interpret it as a Typie node model.
5. The scope consent source ID includes generation, revision, scalar range and opaque block key.
6. Proposal review uses a deterministic, bounded word-and-punctuation diff.
7. Every change hunk is selected by default, and the author may include or exclude each hunk before applying.
8. Large diffs fall back to one coarse hunk instead of performing unbounded renderer work.
9. Selected hunks are rendered into one complete replacement string for the original exact selection.
10. Immediately before mutation, Madi rereads the active document and verifies generation, revision, exact scalar range and expected source text.
11. The selected result is applied through one existing Typie semantic replacement transaction.
12. A successful operation has one Typie Undo entry; `Ctrl+Z` is the rollback path.
13. No named safety snapshot is created because this phase changes only one exact selection inside one active Typie text node.
14. Cross-node, newline-bearing, multi-block, multi-document and project-wide application remains prohibited.
15. Any future operation spanning multiple semantic blocks or documents must create an automatic safety snapshot before commit.

## Consequences

### Positive

- repeated identical prose can be rewritten at the position the author actually selected
- emoji and other non-BMP characters use the same Unicode-scalar coordinate system as Typie replacement
- each AI wording change can be reviewed independently
- the final canonical mutation remains one semantic transaction rather than a sequence of partially applied editor commands
- existing Typie Undo semantics remain sufficient for the narrow operation
- no additional canonical proposal or provenance table is required

### Negative

- selections crossing inline-node boundaries are rejected even when they appear to be one visual paragraph
- a very large selection receives one coarse review hunk
- hunk boundaries are lexical review aids, not Typie semantic nodes
- the pinned browser port and selection bridge must be upgraded together
- project-level safety snapshots are still required before broad AI application can be enabled

## Rejected alternatives

### Use the first matching text occurrence

Rejected because repeated dialogue or narration would make it possible to alter the wrong location.

### Apply each accepted hunk as a separate Typie command

Rejected because partial failure would create a harder rollback model and multiple Undo entries.

### Enable cross-block application now

Rejected because a single active-editor Undo entry is not a sufficient recovery policy for a broad or multi-document AI mutation.

### Persist prompts and provider responses as canonical project data

Rejected because proposal review does not require permanent storage of private prompts, model responses or credentials.
