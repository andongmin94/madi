# Code quality audit

This document records the audit and transport-hardening observations at their stated stages.
Current work order, open contract checks, and verification status are maintained in
[PLANS.md](../PLANS.md). Historical audit conclusions are not a later commit's runtime acceptance.

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

The transport changes reduce overlapping-process and post-completion race risk, but they do not substitute for the required exact-commit Windows verification gate in [AGENTS.md](../AGENTS.md).

## 2026-09-30 current-contract and session correction

The current execution plan is [PLANS.md](../PLANS.md). The product source candidate for this
follow-up is `472d0fc6b46f3735dd2a8c198aa5e5ab1103ff9f`; the earlier audit outcomes are not
transferred to this candidate.

Commit `37802a0` removes the remaining general-assistant application handler and unique-text
range inference. General proposals are review/copy only; every canonical AI edit requires exact
same-block coordinates. Focused tests passed in 4 files / 28 tests, including duplicate occurrences,
Unicode scalar coordinates, stale input, and native-IME guards. The built-in actual WASM probes
also passed. The IR document now describes list content as unsupported text fallback, matching
the current types without expanding the format.

Commit `472d0fc` fixes a reproduced project-open failure: opening incompatible B retired A's
main-process session before the renderer could install B, leaving A visible but unable to save.
The registry now owns one current session and one candidate. An owned completion IPC accepts
the candidate only after successful editor installation; cancel or failure discards the candidate.
The controller retains the prior editor owner, restores a touched editor after failure, cancels stale
scene/entity switches, and fails closed if candidate rejection or editor restoration fails. Each open
operation releases only its own editor lock. Focused tests passed in 7 files / 90 tests, including
existing-session save/Undo, cancellation, concurrent preflush, and scene/entity recovery.

On this Windows machine, repository-local pinned tools passed final-candidate TypeScript checks,
the Desktop build, the included actual Typie WASM probes, HWP bridge mock/probe contracts
(17/17), formatting (287 files), and the complete Desktop Vitest set (103 files / 661 tests).
The two built native atomic-output process E2E tests are included; no test file is excluded in
this final run. The earlier pre-installation partial run is recorded separately in the plan.
An independent final static review found no new actionable issue in session completion callers,
AI mutation entry points, or CI pins/summary references.

On `472d0fc`, full `pnpm verify` and `pnpm check:repository` failed at the uninitialized pinned Typie checkout.
`pnpm package:unpacked` failed at its missing `editor-codec` manifest. No unpacked build or
Electron actual was produced at that point. With user-authorized administrator confirmation, the signed
Build Tools installer completed (exit `3010`, no automatic restart); both required C++/Windows SDK
components are registered complete. The native atomic-output debug/release builds and nine actual
Windows file replacement/recovery/no-clobber tests subsequently passed without restarting.
The complete Desktop test set then passed with the native E2E file included. Runtime actual,
native Korean IME, actual user-owned providers, and Phase 1H `WITHHELD` remain pending.

## 2026-09-30 exact source recovery and CLI follow-up

Commit `5cd2b3c3faf697b000b3ea31d74dada091f945f5` restores the existing Typie pin from
the public preserved repository `lens0021/typie`. The Git commit and tree match exactly; the
original provenance, license, engine identity, runtime bytes, and patch hashes are unchanged.
The earlier missing-source failures above remain historical results. Repository checking now
passes, and an independent offline bundle restore plus CI-style shallow recursive checkout
both recover the same source. See [Typie pinning](TYPIE_PINNING_AND_PATCHES.md).

On that commit, frozen install, repository checks, TypeScript checks, all native Debug builds,
the Desktop build, and the full Desktop test set (103 files / 661 tests) passed. Core,
Publication IR, EPUB, and HWPX passed 59, 14, 18, and 19 tests respectively. Actual shipped
WASM probes, the four bundle-boundary tests, and build-test-only EPUBCheck also passed.

The first integration run exposed a stale endurance expectation of seven migrations while
the current schema already defines eight. Commit `27054e8ffef5344c1cdea78bdc65f98000f2ba35`
corrects only that expectation and retains exact count/order assertions. The entire integration
path then passed, including 20 storage/recovery rounds. On this commit, exact toolchain checks,
nine native atomic-output tests, and 17 HWP bridge mock/registry-only contracts also passed.
HWP automation was not activated.

Unpacked release packaging passed on `102f81081409ce05f6fe97a2a29289d841de86f7`. Earlier
attempts failed at a Windows HWPX linker file-lock error (`LNK1105`, error `1224`) and then
at a .NET MIT license hash mismatch caused by CRLF conversion. `102f810` adds the omitted
`text eol=lf` attribute; the original license text and pinned hash remain unchanged. All eight
native binary copies match their release sources by length and SHA-256, and pinned license
checks passed. The executable is `output/madi-win32-x64/madi.exe`; privacy-safe packaging
evidence is retained in `.tools/verification/package-source-recovered.json`.

The existing Graph, Canvas, and Reader fixture commands also passed. Reader WORK/VOLUME/
CHAPTER/SCENE metadata and first-body source ranges passed for 180,000-character and
675,000-character synthetic manuscripts, with deterministic WORK hashes across five runs.
Debug-core WORK compile medians were 32.56 and 88.02 seconds under BelowNormal priority
while release builds ran concurrently. This is fixture preparation evidence, not packaged
Reader performance or complete export coverage evidence.

No aggregate `pnpm verify` or development/fresh-unpacked Electron
actual has run after source recovery: the existing harness shows windows, and an environment
separated from the user's current desktop is unavailable. Network-boundary runtime evidence,
native IME, actual user-owned providers, and Phase 1H `WITHHELD` remain pending. Command-to-
commit mappings and the next gate are maintained in [PLANS.md](../PLANS.md).

## Remaining hotspots

These are real maintainability risks, but they are not safe to split in the same cleanup commit:

1. `apps/desktop/src/main/desktopService.ts` is a very large orchestration module. This is a maintainability observation, not authorization for the next refactor.
2. `apps/desktop/src/renderer/App.tsx` owns many product workspaces. Structural changes require a verified base and a defined scope.
3. The README history and result duplication identified in this audit is consolidated by the current `PLANS.md` entry point; phase evidence remains in `docs/`.
4. Real packaged validation against Ollama or LM Studio and one disposable HTTPS provider requires an actual endpoint and user-owned credentials/consent.

## Required gate before the next structural refactor

The mandatory commands are defined in [AGENTS.md](../AGENTS.md), and their current work order and
completion conditions are maintained in [PLANS.md](../PLANS.md). Only the exact commit that passes
the required Windows gate may be used as the base for a structural refactor or user acceptance test.
