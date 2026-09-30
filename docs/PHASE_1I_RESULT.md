# Phase 1I result — stable narrow AI boundary

This document preserves the narrow-workflow implementation and audit record. Current goals,
progress, contract discrepancies, and next work are maintained in [PLANS.md](../PLANS.md).
This record does not establish runtime acceptance for a later commit.

## Verdict

```text
Repository implementation: COMPLETE FOR NARROW AI WORKFLOWS
Exact same-block selection apply: IMPLEMENTED
General proposal review: IMPLEMENTED
Multi-block/project-wide apply: REMOVED, NOT AUTHORIZED
Aggregate Windows verification: PENDING FOR THIS COMMIT
Distribution: PRIVATE LOCAL ONLY
```

## Delivered

- user-owned OpenAI-compatible remote or loopback provider
- remote HTTPS and loopback-only HTTP policy
- Electron `safeStorage` credential protection outside `.madi`
- trusted narrow preload and main-process IPC
- exact scope serialization and consent-bound SHA-256
- redirect rejection, timeout, cancellation, response bounds, and sanitized errors
- provider connectivity diagnostics with a fixed no-manuscript request
- general assistant proposal review and copy
- exact same-block Typie selection rewrite
- duplicate-occurrence-safe selection mapping
- per-hunk acceptance inside the exact selection
- one Typie semantic transaction with one Undo entry
- generation, revision, expected-text, Unicode-scalar, scene-break, and native-composition guards

## Code-quality correction

An unfinished multi-block experiment was removed. It had introduced:

- a fourth global AI launcher
- structured multi-node selection mapping
- a second proposal parser and review workflow
- broad planning and snapshot coordinator modules with no production caller
- a permanently disabled apply button
- duplicate ADR numbering and stale result documents

The stable product now has one clear canonical mutation path: an exact same-block selection. There is no dormant compatibility path for broader mutation.

## Intentionally unsupported

- automatic insertion or deletion outside the exact selected range
- changes that cross Typie semantic blocks
- scene-break modification
- multiple scenes or documents in one AI operation
- automatic Story Bible or Canvas mutation
- background manuscript upload
- Madi-operated provider proxy or shared keys
- unreviewed provider output becoming canonical text

## Verification contract

The exact cleanup commit must pass:

```powershell
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
```

No earlier phase report or different commit can substitute for that result.

## 2026-09-30 exact-selection correction

The correction recorded in `37802a0` removes the general assistant's direct-application UI,
assessment, and handler. General proposals remain review/copy only. The planner and editor access
now require `sourceRange`; missing/null coordinates are rejected even for unique source text.
The obsolete unique-text search, mode discriminator, and ambiguity branch were removed.

Actual focused checks used the repository-local Node `26.3.1` and pnpm `11.9.0`:

- assistant, planner, editor-access, and existing selection-overlay tests: 4 files / 28 tests,
  exit `0`, with at most two workers;
- renderer and Electron TypeScript checks: exit `0`;
- built-in Typie WASM selection/semantic transaction probes: exit `0`, including duplicate
  occurrence mapping and one Undo entry;
- changed-file whitespace check: exit `0`.

These focused worktree checks do not establish aggregate acceptance of a final candidate.
The pinned Typie source could not be initialized from its configured URL. MSVC and Windows SDK
installation subsequently completed, and the native atomic-output build and nine Windows tests
passed on source candidate `472d0fc`. Its full Desktop Vitest set also passed (103 files / 661 tests,
including the two native atomic-output E2E tests, no exclusions). `pnpm verify`, package,
development/fresh-unpacked actual, native IME, and actual user-owned provider evidence remain
unresolved in [PLANS.md](../PLANS.md).

## Next stage

The current execution order and completion conditions are maintained in [PLANS.md](../PLANS.md).
Do not infer a new product phase, structural refactor, or aggregate PASS from this implementation record.
