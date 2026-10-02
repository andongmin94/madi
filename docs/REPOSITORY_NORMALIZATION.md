# Repository normalization policy

## Canonical development branch

`main` is the only product-development branch. Feature work is committed directly to `main` as requested by the repository owner.

The obsolete `master` branch and temporary automation/probe branches are not product branches and must not be recreated.

## Continuous verification

The repository keeps two complementary, read-only GitHub Actions workflows:

```text
.github/workflows/quality.yml
.github/workflows/windows-gate.yml
```

Both run on pushes to `main` and may also be dispatched manually. `quality.yml` checks out the exact commit and pinned Typie submodule, activates the pinned Node/pnpm toolchain, installs the frozen workspace without runtime postinstall scripts, then runs:

```text
pnpm run check:toolchain
pnpm run check:repository
pnpm run format:check
git diff --check
pnpm --filter @madi/desktop typecheck
focused transport/LLM Vitest files
```

The focused Vitest set covers the local-core restart barrier, atomic-output shutdown, EPUB/HWPX process boundaries, and the narrow LLM transport/IPC paths that are safe to exercise without launching Electron. The install intentionally uses `--ignore-scripts`; this quality gate therefore does not provision or validate an Electron runtime.

This cross-platform gate is deliberately smaller than the Windows product-verification contract. A green `quality.yml` result means the repository/static contracts, desktop TypeScript typecheck, and the listed focused tests passed on that GitHub-hosted Linux runner. It does **not** prove Windows native IME behavior, Electron runtime or packaged behavior, HWPX actuals, runtime EPUBCheck packaging, or the full root `pnpm verify` path.

`windows-gate.yml` provisions pinned Node/pnpm and Rust on Windows,
then invokes the full verification and unpacked-package path. Commit `a0c1366` adds official
EPUBCheck/JRE archive preparation with the existing size/hash pins and an always-written summary
that identifies the source SHA and actual step outcomes. It also installs pnpm `11.9.0` explicitly,
because Node 26 does not bundle Corepack. These changes have passed local script syntax and pin
consistency checks; neither workflow has been run from this local session. Runner execution remains
pending in [PLANS.md](../PLANS.md).

The former `windows-private-verify.yml` workflow was intentionally removed. Do not recreate a self-modifying or repository-writing workflow merely to obtain a green status. Full Windows verification remains an exact-commit product gate and must be run in a Windows environment with the pinned toolchain and required local validation dependencies.

Self-modifying workflows, patch archives, repository-writing bootstrap/reconciliation automation,
and force-push automation are prohibited from the product tree. The tracked Typie preparation
script is a local dependency setup path, not permission for repository-history automation.

## Local/full verification commands

Mandatory commands are defined in [AGENTS.md](../AGENTS.md). Current status, prerequisites, work
order, and completion conditions are maintained in [PLANS.md](../PLANS.md). Record Git status and
recursive submodule status alongside the verification candidate.

A release or user-validation candidate must identify one exact `main` commit SHA and one matching unpacked build. Results from a different commit are not transferable. The lightweight GitHub quality gate and the full Windows gate are complementary; neither should be reported as the other.

## Distribution boundary

Repository normalization does not authorize public, paid, customer, or installer distribution. The existing gates remain separate:

```text
Typie permission: OWNER-CONFIRMED; release scope must follow the external grant
Windows native Korean IME: MANUAL VALIDATION PENDING
Runtime EPUBCheck packaging: DEFERRED TO PRE-RELEASE HARDENING
Executable signing and complete transitive license audit: PENDING
```

The exact Typie legal instrument and private grant terms are intentionally not reproduced or inferred here; see `TYPIE_LICENSE_STATUS.md`.
