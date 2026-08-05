# ADR-0010: HWP output uses local Hancom conversion

- Status: Accepted
- Date: 2026-08-13

## Context

Binary HWP is not an open package that madi can safely generate in Phase 1H. Windows Hancom Office
offers a documented Automation boundary that can open HWPX and save HWP, but it is optional,
machine-local, may require a registered file-path security module, and has commercial licensing
conditions.

## Decision

- madi never generates binary HWP directly in Phase 1H.
- A validated, source-covered HWPX is always generated first and remains intact if conversion fails.
- HWP conversion is available only when a fixed local sidecar verifies installed Hancom Automation.
- The sidecar exposes only `probe`, `convert`, `reopen-verify`, and targeted `cancel`; the renderer
  cannot select an executable or issue arbitrary COM commands.
- The bridge uses the official `HWPFrame.HwpObject.2` ProgID and `HWPX`/`HWP` format tokens.
- Hancom programs, DLLs, type libraries, and security modules are never bundled with madi.
- If Automation is unavailable, the UI disables HWP and continues to offer complete HWPX export.
- The bridge closes only the document/window it captured and never kills all `Hwp.exe` processes.
- Generated HWP and conversion results are derived artifacts and remain outside snapshots.

## Consequences

- HWP availability varies by Windows installation and security-module registration.
- Real conversion/reopen must be validated on each supported Hancom version before distribution.
- `HANCOM AUTOMATION LICENSE REVIEW REQUIRED BEFORE DISTRIBUTION` remains a release blocker.
- Direct HWP generation may be reconsidered only after demonstrated user need and separate format and
  licensing research.

