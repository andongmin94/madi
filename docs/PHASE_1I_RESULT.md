# Phase 1I result — stable narrow AI boundary

This document preserves the narrow-workflow implementation and audit record. Current goals,
progress, contract discrepancies, and next work are maintained in [PLANS.md](../PLANS.md).
The latest completed runtime result applies to product source `660814c7745a5231038aba902fd7113022778238`.
Subsequent documentation-only commits record that evidence; they are not additional runtime-tested
product candidates. This record does not establish runtime acceptance for later product changes.

## Verdict

```text
Repository implementation: COMPLETE FOR NARROW AI WORKFLOWS
Exact same-block selection apply: IMPLEMENTED
General proposal review: IMPLEMENTED
Multi-block/project-wide apply: REMOVED, NOT AUTHORIZED
Aggregate Windows verification source660814c: PASS — PRIVATE LOCAL TECHNICAL
Actual loopback source660814c: DEVELOPMENT/PACKAGED PASS WITH DIAGNOSTIC WARNING
Distribution: PRIVATE LOCAL ONLY; DISTRIBUTION GATES REMAIN
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

The final product candidate must pass the required pinned path:

```powershell
pnpm install --frozen-lockfile
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
At that point, the pinned Typie source could not be initialized from its configured URL. MSVC and Windows SDK
installation subsequently completed, and the native atomic-output build and nine Windows tests
passed on source candidate `472d0fc`. Its full Desktop Vitest set also passed (103 files / 661 tests,
including the two native atomic-output E2E tests, no exclusions). At that point, `pnpm verify`,
packaging, development/fresh-unpacked actual, native IME, and actual user-owned provider
evidence were unresolved. The current status is maintained in [PLANS.md](../PLANS.md).

## 2026-09-30 source recovery follow-up

Commit `5cd2b3c` recovers the exact pinned Typie source from a preserved repository and removes
the missing-source build blocker. The full Desktop test set (103 files / 661 tests), native
Debug builds, TypeScript checks, and core/publication/exporter tests passed on that commit.
After the schema-8 endurance expectation correction in `27054e8`, the full CLI integration
path also passed. Windows unpacked packaging passed on `102f810`, which adds the missing
LF attribute for the existing hash-pinned .NET license. These results do not supply actual provider, native IME, runtime network,
or development/fresh-unpacked Electron evidence. At that point, the Phase 1I Windows integration
verdict remained `PENDING`; current command-to-commit results are recorded in [PLANS.md](../PLANS.md).

## 2026-09-30 actual loopback development follow-up

On source `451e0855634417e6d0007d3cef064ab89df5f19b`, the explicitly authorized local
provider workflow returned `PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING` in development.
The provider returned an actual response, but the fixed diagnostic response did not equal
`MADI_OK` exactly. That warning remains recorded; response text is omitted.

The workflow verified consent before requests, general proposal copy with canonical content
unchanged, no mutation before selection acceptance, exact same-block application, one exact
Undo and Redo, saved-scene equality, and exact reopen without another provider request.
Provider and request settings remained outside canonical content. No credential was supplied
or stored. The temporary provider used two CPU threads and was terminated after the run.

Clipboard API interception verified copying; the OS clipboard, remote HTTPS provider,
actual credential encryption, and native Korean IME were not validated. Approved loopback
main fetches were 3, with 0 after reopen; unapproved main fetches and renderer HTTP/WebSocket
requests were 0. These observations do not constitute a full owned-process TCP audit.

Evidence is preserved under ignored `.tools/verification/llm-development-451e085-run1/`.
The owned inactive-desktop host recorded source clean before/after, child exit 0, no screen
switch, and zero active job processes at cleanup. Both app windows closed and their processes
exited; the evidence records Playwright `closed=false`, rather than claiming that field passed.
Owned temporary app data was removed.

This result is limited to that development source. At that point, fresh-unpacked provider
validation and aggregate Windows verification remained **PENDING**. The later source51 runs follow.

## 2026-10-01 exact source51 actual loopback development and packaged

Source `51c1e6cdc10107d76e30103fbe1d6f4d035218e3` passed both explicitly authorized real
loopback-provider workflows with status `PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING`.
Both hosts recorded child exit0 and source clean before/after. The full source51 Windows run2
still failed at fresh D; these separate AI runs do not establish aggregate PASS or H acceptance.

| Mode | UTC start→finish, 2026-09-30 | Host seconds | actual.json SHA-256 |
| --- | --- | --- | --- |
| Development | 17:37:48.1484739→17:38:26.1467169 | 37.998 | `b7fef91cbc3f54a69f6b2d62791ce2b5a6604e0c82fe278cb7f7ec08801bae92` |
| Packaged | 17:38:41.6535598→17:39:19.5562741 | 37.903 | `02903a69daf0e0a5db67286c3a498b33195cad54e542531cc0dfd9a06ee70ab1` |

Both workflows verified consent, actual general-response copy with canonical content unchanged,
no mutation before acceptance, exact same-block apply, one exact Undo/Redo, exact save/reopen,
and provider/request settings persisted outside canonical content. Reopen issued no provider request.
The diagnostic received a real provider response but exact `MADI_OK` was false: state
`UNEXPECTED_RESPONSE`, error count0 and warning message length61. That warning is preserved.
Both selected11 characters, reviewed2 hunks, and received13-character general/rewrite responses;
response text is omitted. Diagnostic times were583/581ms and rewrite→apply1654/1647ms.

First-app approved loopback main fetches were3, reopen0; unapproved main fetches and renderer
HTTP/WS/page errors were0. These are main-fetch/renderer observations: full process TCP observation
was false. Both environments observed isolated user data, trusted sandbox/preload settings and
session spellchecker disabled/languages0. Clipboard interception passed; OS clipboard, remote
HTTPS, keyless credential encryption and native Korean IME remain unvalidated.

The owned local model used CPU threads2/batch2/GPU0/parallel1/context2048; prepared runtime/model
hashes matched and raw provider logging was disabled. No credentials were read or stored and no
global install or persistent environment change was performed. Both model processes exited after
owned `SIGTERM` cleanup; exitCode was null rather than a claimed normal exit0.
Both app windows/processes closed, with `playwrightClosed=false` preserved. Temporary app data
was removed. Each host recorded job35/active cleanup0/no forced job termination, job empty and
closed handles/desktop, Input Default74 samples/unavailable0/inactive desktop throughout.

Actual and orchestrator receipts are archived recursively under ignored
`.tools/verification/llm-development-51c1e6c-run1/` and `llm-packaged-51c1e6c-run1/`.
Packaged first/reopen observed `isPackaged=true` and used the same candidate build recorded by
full run2's package receipt/source join and source51 inventory. Inventory alone does not infer
freshness. Preparation source21c9a9d describes the local runtime preparation, not the app source.
This completes the recorded source51 loopback actual pair with warnings. At that point, the new
viewport candidate had not inherited those passes and final aggregate Windows verification remained
**PENDING**. The exact source660814c result follows.

## 2026-10-01 exact source660814c aggregate and actual loopback completion

Exact source `660814c7745a5231038aba902fd7113022778238` completed the pinned full Windows
verification with exit 0 in 5333.110 seconds, including development and fresh-unpacked workflows.
The full host recorded source clean before/after. Its technical result is private-local; it does
not approve installer, public, paid, or customer distribution.

The same source then passed both explicitly authorized real loopback-provider workflows with
status `PASS_LOOPBACK_ACTUAL_WITH_DIAGNOSTIC_WARNING`. Each actual, orchestrator, preserved
harness/orchestrator source copy, and host receipt joins the exact candidate and mode. Both hosts
recorded child exit 0 and source clean before/after.

| Mode | UTC start→finish, 2026-09-30 | Host seconds | actual.json SHA-256 |
| --- | --- | --- | --- |
| Development | 20:10:20.4612719→20:11:00.2472423 | 39.787 | `dd7cc87a73d0be0ffb1c08aebbb3a30787658cccc4b789bf73ac001309a015be` |
| Packaged | 20:11:21.7507263→20:12:00.1756519 | 38.425 | `c4b6a84bbf68e2a00522c0642461c1977bdf459bb8a013aa41bf98375bc1ce32` |

Both workflows verified consent before requests, actual general-response copy with canonical
content unchanged, no mutation before selection acceptance, exact same-block application, one
exact Undo and Redo, exact save and full app/project reopen, and provider/request configuration
persisted outside canonical content. Reopen issued no provider request. No credential was supplied
or stored. The actual selection was one whole 11-character block, with 2 reviewed hunks and
13-character general/rewrite responses; response text is omitted. Diagnostic times were 608/588 ms
and rewrite→apply times 1648/1679 ms.

The diagnostic received an actual provider response but exact `MADI_OK` was false in both modes:
state `UNEXPECTED_RESPONSE`, error message length 0 and warning message length 61. The connected
warning is preserved; later successful inference does not convert that exact-response check to PASS.

First-app approved loopback main fetches were 3, reopen 0; unapproved main fetches and renderer
HTTP/WebSocket/page errors were 0. These counters were collected before window close and are
main-fetch/renderer observations; full owned-process TCP observation was false. The probe recorded
2 non-stage stderr lines in each run. This AI harness does not assert zero through-quit process
diagnostics or an OS TCP boundary. The full Windows gate supplies its separate offline/runtime-boundary
evidence. Both AI environments observed isolated user data, trusted sandbox/preload settings,
isolated-host GPU disablement, and session spellchecker disabled with zero languages.

Clipboard API interception verified copying; the OS clipboard, actual remote HTTPS provider,
credential encryption, and native Korean IME were not validated. This actual test covers one whole
block selection, not partial-block, duplicate/Unicode, multi-block, or project-wide mutation.
Separate adapter/unit evidence retains its own scope.

The owned local model used CPU threads 2/batch 2/GPU 0/parallel 1/context 2048; archive/model and all 51
runtime-file hashes matched preparation. Raw provider logging was disabled. No credentials were
read and no global install or persistent environment change was performed. Both model processes
exited after owned `SIGTERM` cleanup; exitCode was null rather than a claimed normal exit 0.
Both app windows closed and their owned processes exited, with `playwrightClosed=false` preserved.
Owned temporary app data was removed. Each host recorded job 35/active cleanup 0/no forced job
termination, job empty and closed handles/desktop; Input Default samples were 78/75, unavailable 0,
and the owned desktop remained inactive throughout.

Evidence is archived under ignored `.tools/verification/llm-development-660814c-run1/` and
`llm-packaged-660814c-run1/`. Full evidence is under `full-verify-660814c-run1/`. Packaged first/reopen
observed `isPackaged=true`; the fresh package command/source receipt and inventory must be read
together. Inventory `package-inventory-660814c-2e909792-7af7-4f53-b925-9830d5d46db1` records 101
files/233245115 bytes and joins the completed full host metadata hash and exact clean source.
Inventory alone does not infer freshness. Preparation source21c9a9d records runtime preparation,
not app source. Native Korean IME and the existing distribution/Hancom decisions remain human gates.

## Next stage

The current execution order and completion conditions are maintained in [PLANS.md](../PLANS.md).
Do not infer a new product phase or structural refactor from this result. Later product changes
require their own applicable verification.
