# Typie license status

Status date: 2026-09-07

## Current status

The Madi product owner has confirmed that permission to use Typie for Madi has been obtained.
Accordingly, the unresolved Typie-permission gate recorded during earlier private-local phases no longer blocks continued product development.

```text
Typie permission: OWNER-CONFIRMED
Development gate: RESOLVED
Exact legal instrument and grant terms: EXTERNAL / NOT RECORDED HERE
Repository interpretation of distribution rights: NONE
```

This record intentionally does not infer whether the permission is an AGPL-compliance decision, a separate commercial license, another written grant, or any particular combination of rights.
The exact agreement, covered versions, distribution channels, monetization rights, source obligations, renewal terms, and other legal conditions must be checked against the external grant by the product owner before each release that depends on them.

## Repository consequence

- Typie may remain the pinned editor engine for current Madi development.
- Do not start a Typie-removal or clean-room replacement project merely to satisfy the former unresolved-license gate.
- Keep the existing adapter boundary, exact Typie pin, patch inventory, third-party notices, and build provenance intact.
- A Typie version upgrade still requires both technical compatibility review and confirmation that the external permission covers the new version or use.
- Do not copy private agreement text, signatures, private contact details, or other confidential evidence into this repository unless the product owner explicitly chooses to publish it.

## What this does not resolve

This owner confirmation does not convert unrelated release gates to PASS.
In particular, the following remain separate:

- Windows native Korean IME manual validation;
- development and fresh-unpacked Windows verification required by the Phase 1H evidence contract;
- Hancom Automation licensing, security-module setup, and real HWP conversion/reopen validation;
- runtime EPUBCheck/JRE distribution hardening where applicable;
- installer, executable signing, update, and other release-engineering decisions.

Earlier documents such as `LICENSE_DECISION_REQUIRED.md` and historical phase result records describe the state at the time they were written.
They remain useful technical/legal-analysis history, but their former `HUMAN DECISION REQUIRED` Typie gate is superseded for current development by this owner-confirmed status record.
