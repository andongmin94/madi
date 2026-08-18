# Phase 1I result — stable narrow AI boundary

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

## Next stage

After the Windows gate is green:

1. validate the development and unpacked application against one actual Ollama or LM Studio endpoint;
2. validate one disposable remote HTTPS provider key;
3. profile and split one domain out of `desktopService.ts` without changing behavior;
4. run the native Korean IME manual matrix before author-facing handoff.
