# madi repository instructions

## Branch policy

- Work directly on `main`.
- Do not create feature branches or pull requests for routine project work.
- Keep commits small, coherent, and independently reviewable.
- Never rewrite, squash, amend, or reset published history unless the repository owner explicitly asks.

## Engineering policy

- Do not preserve obsolete paths. Remove superseded code instead of adding compatibility layers, fallbacks, or migrations that are not required by the current `.madi` format contract.
- Choose the simplest implementation that fully satisfies the current phase.
- Build in working vertical layers. Do not trade a verified product path for unfinished abstraction.
- Keep product UI, editor integration, local core, exporters, and platform bridges modular and dependency-directed.
- Prefer the dependencies already pinned in the repository. Check their documentation and types before introducing another package.
- Treat Publication IR as the only manuscript input to Reader Lab and publication exporters.
- Keep Typie-specific types behind Madi-owned editor adapters.
- Keep generated EPUB, HWPX, HWP, reports, caches, and runtime UI state outside canonical manuscript content unless an existing format decision explicitly says otherwise.

## Current phase gate

The current codebase contains Phase 1H HWPX export and an optional local HWP bridge, but the final Phase 1H actual verdict remains withheld until development and fresh-unpacked Windows workflows pass the approved offline/network-boundary rerun.

Before starting the next product phase:

1. Run the full pinned Windows verification path.
2. Preserve exact source/block/character coverage.
3. Require zero external runtime requests.
4. Verify fresh-unpacked Electron HWPX export, ZIP/XML reopen, deterministic hashes, cleanup, and no-clobber recovery.
5. Keep local HWP conversion disabled unless the Hancom security module and real conversion/reopen workflow are manually approved.
6. Update `docs/PHASE_1H_RESULT.md` only from actual evidence. Never convert `WITHHELD` to `GO` from static inspection.

## Distribution gates

- Windows native Korean IME remains manual-validation pending until a person completes the checklist.
- Typie distribution licensing remains a human decision.
- Hancom Automation licensing and real conversion validation remain human decisions.
- Runtime EPUBCheck/JRE packaging remains a pre-release distribution task.
- Do not represent private-local technical success as approval for public, paid, customer, or installer distribution.

## Required verification

Use the pinned pnpm workspace; do not introduce `package-lock.json` or switch package managers.

At minimum, run:

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
```

Do not report a command as passing unless it was actually executed in the stated environment. Keep manuscript text, private paths, and user content out of logs and uploaded evidence.
