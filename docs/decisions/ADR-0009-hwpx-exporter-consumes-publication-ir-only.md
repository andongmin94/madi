# ADR-0009: HWPX exporter consumes Publication IR only

- Status: Accepted
- Date: 2026-08-13

## Context

madi has one engine-independent publication boundary: Publication IR v1. Reader Lab and EPUB
already consume this derived model. Reading Typie snapshots, editor implementation types, React
DOM, or SQLite private editor payloads in another exporter would duplicate semantic decoding and
make format-specific output dependent on the editor engine.

HWPX is a generated delivery document. It must not become a canonical editing source or a second
copy of the manuscript inside `.madi`.

## Decision

- `madi-export-hwpx` accepts `PublicationDocument` v1 plus a closed madi-owned HWPX request.
- It has no dependency on Typie, editor FFI/types, renderer DOM, Reader Lab, or SQLite.
- Reader Lab, EPUB, and HWPX therefore share the same Binder order, scope, block, inline, and source
  identity semantics.
- Every source block is classified exactly once as exported, safe fallback, or rejected. Success
  requires rejected block count zero and exact source character/heading/scene-break coverage.
- HWPX/HWP files, their output paths, validation cache, reports, and conversion results are derived
  artifacts and are not stored in named snapshots.
- Only closed, versioned HWPX presets are canonical project data and participate in snapshot v5.

## Consequences

- Adding a truly supported image block requires a future Publication IR revision; Phase 1H does not
  read image bytes around the IR boundary.
- Ruby uses a documented plain-text fallback until its exact HWPX `dutmal` mapping is verified.
- An exported HWPX cannot be edited and merged back into the canonical `.madi` project.
- All future publication exporters must reuse Publication IR or explicitly revise that shared model.

