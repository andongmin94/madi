# Phase 1I-C — Provider UI and Explicit Proposal Review Result

## Verdict

```text
Implementation verdict: TECHNICAL IMPLEMENTATION COMPLETE ON main
Aggregate Windows verdict: PENDING WORKFLOW
Distribution boundary: PRIVATE LOCAL ONLY
Canonical proposal apply: NOT YET AUTHORIZED
```

## Delivered

- fixed the Phase 1I-B provider-store/service compile defects before expanding the feature
- provider CRUD UI backed by the protected app-level store
- write-only API-key input; secrets are never returned to the renderer
- support for HTTPS remote providers and loopback HTTP local providers
- current live Typie document capture through the existing adapter instance
- native composition refusal during scope capture
- editable transmission scope and optional explicit context
- task templates for rewrite, continuation, summary, consistency review and custom prompts
- provider/model/host/character-count confirmation
- required one-request consent checkbox
- shared browser/main scope serialization and SHA-256 binding
- cancellation and bounded error display
- original/proposal side-by-side review
- copy-only result handling

## Safety decision

Direct manuscript apply remains disabled. The pinned Typie adapter supports validated text-range replacement, but this UI does not yet possess a stable current-selection or block-range contract. Replacing the whole recovery text with the proposal would flatten or remove paragraph boundaries, scene breaks, ruby and inline modifiers. The next slice must add semantic source mapping and safety snapshots rather than using a plain-text shortcut.

## Changed areas

- `apps/desktop/src/shared/llm.ts`
- `apps/desktop/src/main/llm/openAiCompatibleClient.ts`
- `apps/desktop/src/main/llm/providerStore.ts`
- `apps/desktop/src/main/llm/providerStoreFormat.ts`
- `apps/desktop/src/main/llm/service.ts`
- `apps/desktop/src/renderer/llm/editorAccess.ts`
- `apps/desktop/src/renderer/components/llm/LlmAssistantOverlay.tsx`
- `apps/desktop/src/renderer/components/llm/llmAssistant.css`
- `apps/desktop/src/renderer/main.tsx`
- focused renderer/main tests

## Verification

Focused tests are included for:

- active editor attachment and plain-text read
- refusal during IME composition
- provider CRUD request shape
- no secret readback
- explicit confirmation before invocation
- scope hash propagation
- proposal rendering

The repository workflow on `main` remains the aggregate gate. No claim is made about its result until GitHub Actions completes.

## Next slice

Phase 1I-D should implement:

1. stable Typie selection/block source mapping
2. proposal diff at Unicode-scalar-safe ranges
3. reject, partial apply and full apply
4. auto safety snapshot before multi-block apply
5. project/document revision checks
6. stale proposal invalidation when the editor changes
7. real loopback and remote-provider manual validation
