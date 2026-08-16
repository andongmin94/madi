# LLM Adapter Architecture

## Ownership boundary

```text
Typie canonical manuscript
        │
        ├─ copied active-document scope
        ├─ exact same-node selection
        └─ exact structured multi-paragraph selection
        ▼
Madi invocation scope + one-request scope SHA-256
        │
        ├─ author confirms provider/model/host/content
        ▼
Trusted Electron IPC
        ▼
Main-process LLM runtime service
        ├─ app-level provider config store
        ├─ Electron safeStorage credential protector
        └─ bounded OpenAI-compatible transport
        ▼
Non-canonical proposal buffer
        │
        ├─ copy/reject
        ├─ exact same-node apply through one Typie transaction
        └─ structured multi-block review only
                │
                └─ canonical apply locked until project snapshot gate
```

Provider connectivity diagnostics use a separate manuscript-free branch and return status/model/latency only.

## Provider and credential boundary

Provider config contains only versioned non-secret settings: identity, revision, display name, endpoint, model, credential reference, timeout, output limit and temperature. Config and encrypted credential bytes live under Electron `userData`, outside `.madi`.

The renderer sees provider summaries and credential states, never decrypted keys. Remote endpoints require HTTPS; HTTP is allowed only for loopback. Credentials in URLs, query strings, fragments and redirects are rejected.

## Electron boundary

The renderer receives a frozen `window.madiLlm` API with fixed operations for status, provider CRUD, connectivity test, invocation and cancellation. Main handlers validate exact nested shapes and trusted senders. Renderer code never receives raw `ipcRenderer`, Node filesystem access, main-process fetch or decrypted credentials.

## Explicit manuscript consent

Browser and main process share one deterministic scope serialization contract:

```text
scope kind
source ID
manuscript text
optional context text
```

The renderer displays provider, model, destination host and content size. Only after the author confirms one-request consent does it calculate SHA-256 and invoke the main process. The main process recomputes the same hash immediately before transport.

## Transport

The OpenAI-compatible client:

- runs in the main process,
- sends one non-streaming chat-completions request,
- enforces text and response limits,
- applies timeout and cancellation,
- rejects redirects,
- supports string and text-part assistant output,
- emits normalized result/usage metadata,
- excludes request text, response bodies and keys from errors.

## Active editor identity

`LlmEditorAccess` observes the one live Madi editor adapter. It tracks:

- document generation, incremented on adapter attach or document restore,
- editor transaction revision,
- native composition state,
- available selection/replacement capabilities.

A scene or entity-note switch can reuse revision numbers, so generation and revision are both required. Any later transaction invalidates a captured proposal.

## Exact same-node selection

The narrow `AI✎` workflow maps one live selection to annotated-recovery Unicode-scalar offsets. Equal text is not resolved by occurrence order. Each candidate range is mapped through Typie and compared with the actual CRDT selection endpoints.

The provider result receives a bounded hunk diff. The accepted hunk set is rendered into one replacement string, reread against the current document, then committed through one Typie semantic transaction. Typie verifies expected text, structure and scene-break invariants; Madi verifies the complete returned text. One `Ctrl+Z` is the rollback path.

## Structured selection adapter boundary

Phase 1I-G adds a distinct Madi-owned structured selection contract rather than exposing Typie types:

```ts
interface EditorStructuredSelection {
  text: string;
  start: number;
  end: number;
  segments: readonly {
    text: string;
    start: number;
    end: number;
    nodeKey: string;
  }[];
  separators: readonly string[];
}
```

`nodeKey` is opaque outside `renderer/editor/typie`. It prevents accidental merging of text owned by different Typie nodes; consumers may compare it for equality only.

### Mapping algorithm

1. Read Typie’s live selection and clipboard text.
2. Enumerate equal annotated-prose occurrences.
3. Map each complete candidate back through Typie.
4. Accept only the candidate whose CRDT endpoints equal the live selection.
5. Walk the selected Unicode scalars.
6. Map each visible scalar through `prose_to_selection_annotated`.
7. Group contiguous scalars with one owner node.
8. Preserve line/paragraph separators exactly between groups.
9. Reconstruct the full selection and require byte-for-byte JavaScript string equality.

Limits protect renderer responsiveness:

- 20,000 selected Unicode scalars,
- 64 internal text-node segments,
- 10,000 candidate occurrences.

The existing same-node path skips the per-scalar pass and remains fast.

## Paragraph-level product gate

The engine adapter may observe several text-node segments for reasons other than paragraph structure, including inline modifier ownership. Phase 1I-G treats segments as product blocks only when every adjacent pair is separated by a non-empty whitespace sequence containing a line or paragraph separator.

Therefore:

- two paragraphs are reviewable,
- several paragraphs are reviewable,
- bold/plain spans in one line are not misclassified as separate paragraphs,
- a semantic scene break is rejected,
- collapsed or unmappable selections fail closed.

## Structured provider response

The provider receives the exact selected text after explicit consent and is instructed to preserve paragraph count and exact blank-line separators.

`parseLlmMultiBlockProposal` accepts a response only when the original separators appear in the expected order and no additional line separator appears inside a block. A mismatch remains raw review/copy material and never creates a replacement plan.

## Per-block and per-hunk review

Each matched provider block is diffed against its corresponding source segment with the bounded Unicode-aware proposal diff. The author controls hunks independently per block. The complete selected result is rebuilt with the original separators.

Review state is renderer-only. It is not stored in `.madi`, named snapshots, provider config, evidence or telemetry.

## Read-only multi-replacement planner

`planLlmMultiBlockProposal` rereads the active document and requires:

- matching generation and revision,
- exact full selected source text,
- exact text at every segment scalar range,
- unique ordered opaque node keys,
- non-empty block proposals,
- no line separator or scene-break fallback inside a proposed block,
- at least two changed blocks.

A READY result contains non-overlapping Madi `EditorTextReplacement` records and expected complete document text. It performs no mutation.

## Snapshot-gated broad apply

The pinned Typie command already supports multiple replacements atomically. Phase 1I-G still keeps canonical apply disabled because one editor Undo entry is not a durable project recovery record after save, close and later edits.

The next mutation layer must:

1. flush dirty active content,
2. commit an automatic project safety snapshot,
3. revalidate every replacement,
4. call one all-or-nothing Typie multi-replacement transaction,
5. verify complete result text and semantic invariants,
6. expose direct snapshot restore,
7. prove save-close-reopen behavior,
8. keep prompts, credentials and raw response text out of snapshot metadata.

This ordering is fixed in [`ADR-0015`](decisions/ADR-0015-multi-block-ai-review-precedes-snapshot-gated-apply.md).

## Failure isolation

LLM initialization, provider-store corruption or unavailable protected storage does not block authoring, project storage, Reader Lab or exporters. Active requests are cancelled at application shutdown. A provider response never becomes canonical simply because transport succeeded.
