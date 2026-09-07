# Repository normalization policy

## Canonical development branch

`main` is the only product-development branch. Feature work is committed directly to `main` as requested by the repository owner.

The obsolete `master` branch and temporary automation/probe branches are not product branches and must not be recreated.

## Continuous verification

The repository keeps one lightweight GitHub Actions workflow:

```text
.github/workflows/quality.yml
```

It runs on pushes to `main` and may also be dispatched manually. The workflow is read-only with respect to repository contents. It checks out the exact commit and pinned Typie submodule, activates the pinned Node/pnpm toolchain, installs the frozen workspace without runtime postinstall scripts, then runs:

```text
pnpm run check:toolchain
pnpm run check:repository
pnpm run format:check
git diff --check
pnpm --filter @madi/desktop typecheck
focused transport/LLM Vitest files
```

The focused Vitest set covers the local-core restart barrier, atomic-output shutdown, EPUB/HWP process boundaries, and the narrow LLM transport/IPC paths that are safe to exercise without launching Electron. The install intentionally uses `--ignore-scripts`; this quality gate therefore does not provision or validate an Electron runtime.

This cross-platform gate is deliberately smaller than the Windows product-verification contract. A green `quality.yml` result means the repository/static contracts, desktop TypeScript typecheck, and the listed focused tests passed on that GitHub-hosted Linux runner. It does **not** prove Windows native IME behavior, Electron runtime or packaged behavior, HWPX/HWP actuals, Hancom Automation, runtime EPUBCheck packaging, or the full root `pnpm verify` path.

The former `windows-private-verify.yml` workflow was intentionally removed. Do not recreate a self-modifying or repository-writing workflow merely to obtain a green status. Full Windows verification remains an exact-commit product gate and must be run in an approved Windows environment with the pinned toolchain and required local validation dependencies.

Self-modifying workflows, patch archives, bootstrap scripts, reconciliation scripts, and force-push automation are prohibited from the product tree.

## Local/full verification commands

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

A release or user-validation candidate must identify one exact `main` commit SHA and one matching unpacked build. Results from a different commit are not transferable. The lightweight GitHub quality gate and the full Windows gate are complementary; neither should be reported as the other.

## Distribution boundary

Repository normalization does not authorize public, paid, customer, or installer distribution. The existing gates remain separate:

```text
Typie permission: OWNER-CONFIRMED; release scope must follow the external grant
Windows native Korean IME: MANUAL VALIDATION PENDING
Hancom Automation and real HWP conversion/reopen: PENDING
Runtime EPUBCheck packaging: DEFERRED TO PRE-RELEASE HARDENING
Executable signing and complete transitive license audit: PENDING
```

The exact Typie legal instrument and private grant terms are intentionally not reproduced or inferred here; see `TYPIE_LICENSE_STATUS.md`.
