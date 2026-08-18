# Repository normalization policy

## Canonical development branch

`main` is the only product-development branch. Feature work is committed directly to `main` as requested by the repository owner.

The obsolete `master` branch and temporary automation/probe branches are not product branches and must not be recreated.

## Continuous verification

The repository keeps exactly one GitHub Actions workflow:

```text
.github/workflows/windows-private-verify.yml
```

The workflow is read-only with respect to repository contents. It checks out the exact commit SHA, initializes the pinned Typie submodule recursively, installs the pinned Node/pnpm/Rust/.NET toolchains, runs `pnpm verify`, and enforces repository, formatting, submodule, and temporary-artifact hygiene.

Self-modifying workflows, patch archives, bootstrap scripts, reconciliation scripts, and force-push automation are prohibited from the product tree.

## Local verification commands

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

A release or user-validation candidate must identify one exact `main` commit SHA and one matching unpacked build. Results from a different commit are not transferable.

## Distribution boundary

Repository normalization does not authorize public, paid, customer, or installer distribution. The existing gates remain in force:

```text
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Windows native Korean IME: MANUAL VALIDATION PENDING
Runtime EPUBCheck packaging: DEFERRED TO PRE-RELEASE HARDENING
Executable signing and complete transitive license audit: PENDING
```
