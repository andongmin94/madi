# Code quality audit

## Verdict

The repository is not “perfect,” but the core product architecture is sound. The largest immediate quality problem was not the canonical data model or export pipeline; it was an unfinished Phase 1I experiment that added a second AI review surface, structured multi-block selection mapping, duplicate planning code, and tests for a mutation path that remained disabled in production.

This audit removes that experiment instead of preserving it behind compatibility code.

## Removed in this audit

- the permanently disabled `AI¶` multi-block review overlay
- its dedicated stylesheet and renderer mount
- structured multi-block Typie selection mapping
- `multiBlockProposal` parsing and planning code
- unused broad-proposal planner and snapshot coordinator
- tests that exercised only those removed paths
- duplicate ADR number `0015`
- stale Phase 1I-G result documentation
- the misleading `test:phase1d` alias that executed the Phase 1C script
- the obsolete desktop package description that still called the application a Phase 1E prototype

## Preserved product paths

- user-owned OpenAI-compatible provider configuration
- OS-protected credential storage
- explicit one-request scope consent
- provider connectivity diagnostics that send no manuscript
- general proposal review and copy
- exact same-block Typie selection rewrite
- per-hunk review within that exact selection
- revision, generation, native-IME, and semantic-boundary fail-closed checks
- one Typie transaction and one normal Undo entry for an accepted exact-selection rewrite

## Why the broad path was removed

The removed UI could inspect several Typie text nodes, but its apply button was permanently disabled because no production project-snapshot boundary was connected. In parallel, a separate broad planner and coordinator existed without a production caller. Keeping these pieces increased the number of editor contracts and global overlays without delivering an end-to-end capability.

The product now has one clear mutation boundary:

```text
exact live same-block selection
→ explicit provider consent
→ proposal review
→ chosen hunks
→ fresh revision and range verification
→ one Typie semantic transaction
```

Multi-block or multi-document AI mutation is not retained as dormant code. It can be reconsidered only from a complete vertical slice that owns durable project recovery from the start.

## 2026-09-07 transport hardening follow-up

After the original audit, the main-process transport boundaries were tightened without changing canonical manuscript, Publication IR, or export format contracts.

- LLM request limits now use the same Unicode-scalar counting rule at the shared contract, main IPC, and provider-client boundaries.
- The EPUB exporter validates operation identity before spawning, normalizes synchronous spawn failures, rejects protocol data after a terminal result, and does not let cancel/dispose overturn an already completed result.
- The local HWP bridge likewise preserves a valid completed conversion or reopen result while its owned child process is still closing.
- The atomic-output helper no longer reports a failed request as settled before its owned process closes. It uses a bounded graceful-stop → `SIGKILL` sequence and reports an explicit hard shutdown failure if the process still does not stop.
- The JSON-RPC core no longer spawns a replacement `madi-core` while a failed or timed-out previous core process is still alive. New work is held behind a bounded restart barrier, and a process that refuses to stop fails closed instead of permitting overlapping core access to a `.madi` file.

Verification status for this follow-up is deliberately separate from implementation status:

```text
Repository changes: COMMITTED
Static diff review: COMPLETE
Full Windows pnpm verify: NOT RUN IN THIS ENVIRONMENT
Fresh packaged/runtime gates: NOT RUN IN THIS ENVIRONMENT
Technical/release GO change from these edits: NONE
```

The transport changes reduce overlapping-process and post-completion race risk, but they do not substitute for the required exact-commit Windows verification gate below.

## Remaining hotspots

These are real maintainability risks, but they are not safe to split in the same cleanup commit:

1. `apps/desktop/src/main/desktopService.ts` is a very large orchestration module. The next refactor should extract one existing domain at a time, beginning with export orchestration or snapshot operations, while keeping each intermediate commit green.
2. `apps/desktop/src/renderer/App.tsx` owns many product workspaces and should be decomposed only after the main-process boundary is stable.
3. `README.md` has grown into a history and result archive. Stable user documentation should remain in README; phase evidence should remain in `docs/`.
4. Real packaged validation against Ollama or LM Studio and one disposable HTTPS provider is still manual.

## Required gate before the next structural refactor

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package:unpacked
pnpm check:repository
pnpm format:check
git diff --check
git status --short
git submodule status --recursive
```

Only the exact commit that passes this gate may be used as the base for the next refactor or user acceptance test.
