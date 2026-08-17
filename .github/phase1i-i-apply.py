from __future__ import annotations

from pathlib import Path
import re
import sys

root = Path.cwd()


def read(rel: str) -> str:
    return (root / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}")
    return text.replace(old, new, 1)


# Rust model: first-class AUTO_BEFORE_AI_APPLY.
rel = "crates/madi-core/src/model.rs"
text = read(rel)
text = replace_once(
    text,
    """pub enum NamedSnapshotKind {
    #[default]
    Manual,
    AutoBeforeReplace,
    AutoBeforeRestore,
}""",
    """pub enum NamedSnapshotKind {
    #[default]
    Manual,
    AutoBeforeReplace,
    AutoBeforeRestore,
    AutoBeforeAiApply,
}""",
    "NamedSnapshotKind enum",
)
text = replace_once(
    text,
    """            Self::AutoBeforeReplace => \"AUTO_BEFORE_REPLACE\",
            Self::AutoBeforeRestore => \"AUTO_BEFORE_RESTORE\",""",
    """            Self::AutoBeforeReplace => \"AUTO_BEFORE_REPLACE\",
            Self::AutoBeforeRestore => \"AUTO_BEFORE_RESTORE\",
            Self::AutoBeforeAiApply => \"AUTO_BEFORE_AI_APPLY\",""",
    "NamedSnapshotKind as_str",
)
text = replace_once(
    text,
    """            \"AUTO_BEFORE_REPLACE\" => Ok(Self::AutoBeforeReplace),
            \"AUTO_BEFORE_RESTORE\" => Ok(Self::AutoBeforeRestore),""",
    """            \"AUTO_BEFORE_REPLACE\" => Ok(Self::AutoBeforeReplace),
            \"AUTO_BEFORE_RESTORE\" => Ok(Self::AutoBeforeRestore),
            \"AUTO_BEFORE_AI_APPLY\" => Ok(Self::AutoBeforeAiApply),""",
    "NamedSnapshotKind FromStr",
)
write(rel, text)

# Rust schema v9 migration recreates only the constrained snapshot table.
rel = "crates/madi-core/src/storage.rs"
text = read(rel)
text = replace_once(
    text,
    "pub const SCHEMA_VERSION: i64 = 8;",
    "pub const SCHEMA_VERSION: i64 = 9;",
    "schema version",
)
start = text.index('const MIGRATION_V8: &str = r#"')
end = text.index('\n"#;', start) + len('\n"#;')
if "const MIGRATION_V9:" in text:
    raise RuntimeError("MIGRATION_V9 already exists")
migration_v9 = r'''

const MIGRATION_V9: &str = r#"
DROP INDEX IF EXISTS named_snapshots_project_created_idx;
ALTER TABLE named_snapshots RENAME TO named_snapshots_v8;

CREATE TABLE named_snapshots (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT,
    kind TEXT NOT NULL CHECK (
        kind IN (
            'MANUAL',
            'AUTO_BEFORE_REPLACE',
            'AUTO_BEFORE_RESTORE',
            'AUTO_BEFORE_AI_APPLY'
        )
    ),
    payload_format TEXT NOT NULL,
    payload_version INTEGER NOT NULL CHECK (payload_version > 0),
    payload_blob BLOB NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO named_snapshots (
    id, project_id, name, note, kind, payload_format, payload_version,
    payload_blob, content_hash, created_at, updated_at
)
SELECT
    id, project_id, name, note, kind, payload_format, payload_version,
    payload_blob, content_hash, created_at, updated_at
FROM named_snapshots_v8;

DROP TABLE named_snapshots_v8;

CREATE INDEX named_snapshots_project_created_idx
    ON named_snapshots(project_id, created_at DESC, id);
"#;'''
text = text[:end] + migration_v9 + text[end:]
marker = "\n    Ok(())\n}\n\npub(crate) fn seed_builtin_relation_types"
if text.count(marker) != 1:
    raise RuntimeError("could not locate migration function tail")
migration_apply = r'''

    if current < 9 {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(MIGRATION_V9)?;
        let applied_at = database_timestamp(&transaction)?;
        transaction.execute(
            "INSERT OR IGNORE INTO schema_migrations
                (version, applied_at, description)
             VALUES (9, ?1, ?2)",
            params![
                applied_at,
                "Phase 1I first-class AI pre-apply safety snapshots"
            ],
        )?;
        transaction.execute(
            "UPDATE app_meta
             SET format_version = 1, schema_version = 9
             WHERE singleton = 1",
            [],
        )?;
        transaction.pragma_update(None, "user_version", 9_i64)?;
        transaction.commit()?;
    }
'''
text = text.replace(marker, migration_apply + marker, 1)
write(rel, text)

# Shared desktop contract and service validation.
rel = "apps/desktop/src/shared/contracts.ts"
text = read(rel)
text = replace_once(
    text,
    """export type NamedSnapshotKind =
  | \"MANUAL\"
  | \"AUTO_BEFORE_REPLACE\"
  | \"AUTO_BEFORE_RESTORE\";""",
    """export type NamedSnapshotKind =
  | \"MANUAL\"
  | \"AUTO_BEFORE_REPLACE\"
  | \"AUTO_BEFORE_RESTORE\"
  | \"AUTO_BEFORE_AI_APPLY\";""",
    "TS NamedSnapshotKind",
)
text = replace_once(
    text,
    """export interface CreateNamedSnapshotRequest extends SessionRequest {
  readonly name: string;
  readonly note?: string;
}""",
    """export interface CreateNamedSnapshotRequest extends SessionRequest {
  readonly name: string;
  readonly note?: string;
  readonly kind?: \"MANUAL\" | \"AUTO_BEFORE_AI_APPLY\";
}""",
    "CreateNamedSnapshotRequest",
)
write(rel, text)

rel = "apps/desktop/src/main/desktopService.ts"
text = read(rel)
method_start = text.index("  public async createNamedSnapshot(")
method_end = text.index("  public async listNamedSnapshots(", method_start)
method = text[method_start:method_end]
method = replace_once(
    method,
    """    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const response = asRecord(""",
    """    const sessionId = validateSessionId(input?.sessionId);
    const session = this.sessions.require(sessionId);
    const kind = input.kind ?? \"MANUAL\";
    if (kind !== \"MANUAL\" && kind !== \"AUTO_BEFORE_AI_APPLY\") {
      throw new Error(\"Unsupported renderer-created snapshot kind\");
    }
    const response = asRecord(""",
    "desktop snapshot kind validation",
)
method = replace_once(method, '        kind: "MANUAL",', "        kind,", "snapshot kind pass-through")
text = text[:method_start] + method + text[method_end:]
write(rel, text)

for path in (root / "apps/desktop/src").rglob("*.ts"):
    source = path.read_text(encoding="utf-8")
    updated = source.replace(
        '"MANUAL", "AUTO_BEFORE_REPLACE", "AUTO_BEFORE_RESTORE"',
        '"MANUAL", "AUTO_BEFORE_REPLACE", "AUTO_BEFORE_RESTORE", "AUTO_BEFORE_AI_APPLY"',
    )
    updated = updated.replace(
        '  "MANUAL",\n  "AUTO_BEFORE_REPLACE",\n  "AUTO_BEFORE_RESTORE"',
        '  "MANUAL",\n  "AUTO_BEFORE_REPLACE",\n  "AUTO_BEFORE_RESTORE",\n  "AUTO_BEFORE_AI_APPLY"',
    )
    if updated != source:
        path.write_text(updated, encoding="utf-8", newline="\n")

rel = "apps/desktop/src/renderer/components/SnapshotPanel.tsx"
text = read(rel)
text = replace_once(
    text,
    '  AUTO_BEFORE_REPLACE: "자동 · 치환 전",\n  AUTO_BEFORE_RESTORE: "자동 · 복원 전"',
    '  AUTO_BEFORE_REPLACE: "자동 · 치환 전",\n  AUTO_BEFORE_RESTORE: "자동 · 복원 전",\n  AUTO_BEFORE_AI_APPLY: "자동 · AI 적용 전"',
    "SnapshotPanel kind label",
)
text = replace_once(
    text,
    "  readonly onRequestDiff: (snapshotId: string) => void | Promise<void>;",
    "  readonly onRequestDiff: (snapshotId: string) => void | Promise<unknown>;",
    "SnapshotPanel diff callback return",
)
write(rel, text)

write("apps/desktop/src/renderer/llm/aiSnapshotRecoveryBridge.ts", r'''import type { DiffNamedSnapshotResult } from "../../shared/contracts";

export interface LlmAiSafetySnapshotRecord {
  readonly snapshotId: string;
  readonly projectRevision: number | null;
  readonly changedBlockCount: number;
  readonly createdAt: string;
}

export interface LlmAiSnapshotRecoveryOwner {
  previewSafetySnapshot(snapshotId: string): Promise<DiffNamedSnapshotResult>;
  restoreSafetySnapshot(
    snapshotId: string,
    expectedDiff: DiffNamedSnapshotResult
  ): Promise<void>;
}

let owner: LlmAiSnapshotRecoveryOwner | null = null;
let latestRecord: LlmAiSafetySnapshotRecord | null = null;
const listeners = new Set<(record: LlmAiSafetySnapshotRecord | null) => void>();

function validSnapshotId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 500;
}

export function registerLlmAiSnapshotRecoveryOwner(
  nextOwner: LlmAiSnapshotRecoveryOwner
): () => void {
  if (owner && owner !== nextOwner) {
    throw new Error("Another Madi workspace already owns AI snapshot recovery");
  }
  owner = nextOwner;
  return () => {
    if (owner === nextOwner) owner = null;
  };
}

export function recordLlmAiSafetySnapshot(record: LlmAiSafetySnapshotRecord): void {
  if (
    !validSnapshotId(record.snapshotId) ||
    (record.projectRevision !== null &&
      (!Number.isSafeInteger(record.projectRevision) || record.projectRevision < 0)) ||
    !Number.isSafeInteger(record.changedBlockCount) ||
    record.changedBlockCount < 1 ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) throw new Error("Invalid AI safety snapshot record");
  latestRecord = Object.freeze({ ...record });
  for (const listener of listeners) listener(latestRecord);
}

export function getLatestLlmAiSafetySnapshot(): LlmAiSafetySnapshotRecord | null {
  return latestRecord;
}

export function subscribeLlmAiSafetySnapshot(
  listener: (record: LlmAiSafetySnapshotRecord | null) => void
): () => void {
  listeners.add(listener);
  listener(latestRecord);
  return () => listeners.delete(listener);
}

export function clearLlmAiSafetySnapshot(snapshotId?: string): void {
  if (snapshotId && latestRecord?.snapshotId !== snapshotId) return;
  latestRecord = null;
  for (const listener of listeners) listener(null);
}

export async function previewLlmAiSafetySnapshot(
  snapshotId: string
): Promise<DiffNamedSnapshotResult> {
  if (!owner || !validSnapshotId(snapshotId))
    throw new Error("AI 안전 snapshot을 확인할 프로젝트가 열려 있지 않습니다.");
  const result = await owner.previewSafetySnapshot(snapshotId);
  if (result.snapshot.id !== snapshotId)
    throw new Error("다른 snapshot의 변경 요약이 반환되었습니다.");
  return result;
}

export async function restoreLlmAiSafetySnapshot(
  snapshotId: string,
  expectedDiff: DiffNamedSnapshotResult
): Promise<void> {
  if (!owner || !validSnapshotId(snapshotId))
    throw new Error("AI 안전 snapshot을 복원할 프로젝트가 열려 있지 않습니다.");
  if (expectedDiff.snapshot.id !== snapshotId)
    throw new Error("AI 안전 snapshot 복원 미리보기가 일치하지 않습니다.");
  await owner.restoreSafetySnapshot(snapshotId, expectedDiff);
}
''')

write("apps/desktop/src/renderer/components/llm/LlmAiSnapshotRecoveryPanel.tsx", r'''import { useEffect, useState } from "react";
import type { DiffNamedSnapshotResult } from "../../../shared/contracts";
import {
  clearLlmAiSafetySnapshot,
  getLatestLlmAiSafetySnapshot,
  previewLlmAiSafetySnapshot,
  restoreLlmAiSafetySnapshot,
  subscribeLlmAiSafetySnapshot,
  type LlmAiSafetySnapshotRecord
} from "../../llm/aiSnapshotRecoveryBridge";
import "./llmAiSnapshotRecovery.css";

function publicError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function LlmAiSnapshotRecoveryPanel() {
  const [record, setRecord] = useState<LlmAiSafetySnapshotRecord | null>(() =>
    getLatestLlmAiSafetySnapshot()
  );
  const [preview, setPreview] = useState<DiffNamedSnapshotResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => subscribeLlmAiSafetySnapshot((next) => {
    setRecord(next);
    setPreview(null);
    setError("");
  }), []);

  if (!record) return null;

  const loadPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewLlmAiSafetySnapshot(record.snapshotId));
    } catch (cause) {
      setError(publicError(cause, "AI 적용 전 변경 요약을 불러오지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!preview) return;
    if (!window.confirm(`“${preview.snapshot.name}” 상태로 복원할까요? 현재 상태는 복원 전 자동 snapshot으로 보존됩니다.`)) return;
    setBusy(true);
    setError("");
    try {
      await restoreLlmAiSafetySnapshot(record.snapshotId, preview);
      clearLlmAiSafetySnapshot(record.snapshotId);
    } catch (cause) {
      setError(publicError(cause, "AI 적용 전 상태로 복원하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="madi-llm-recovery" aria-label="AI 적용 안전 snapshot">
      <div className="madi-llm-recovery__heading">
        <div><strong>AI 적용 전 상태 보존됨</strong><span>{record.changedBlockCount}개 의미 블록 변경 전 snapshot</span></div>
        <button type="button" aria-label="AI snapshot 안내 닫기" disabled={busy} onClick={() => clearLlmAiSafetySnapshot(record.snapshotId)}>×</button>
      </div>
      {preview ? (
        <dl className="madi-llm-recovery__diff">
          <div><dt>본문 변경</dt><dd>{preview.summary.changedSceneBodies}개 장면</dd></div>
          <div><dt>문자 수 변화</dt><dd>{preview.summary.characterCountDelta >= 0 ? "+" : ""}{preview.summary.characterCountDelta}자</dd></div>
          <div><dt>프로젝트 revision</dt><dd>{preview.revision}</dd></div>
        </dl>
      ) : <p>변경 요약을 확인한 뒤 이 화면에서 바로 적용 전 상태로 복원할 수 있습니다.</p>}
      {error ? <p role="alert" className="madi-llm-recovery__error">{error}</p> : null}
      <div className="madi-llm-recovery__actions">
        <button type="button" disabled={busy} onClick={() => void loadPreview()}>{busy && !preview ? "확인 중…" : "변경 확인"}</button>
        <button type="button" disabled={busy || !preview} onClick={() => void restore()}>적용 전 상태로 복원</button>
      </div>
    </aside>
  );
}
''')

write("apps/desktop/src/renderer/components/llm/llmAiSnapshotRecovery.css", '''.madi-llm-recovery { position: fixed; right: 20px; bottom: 84px; z-index: 1190; width: min(380px, calc(100vw - 40px)); padding: 16px; border: 1px solid #c7c9ee; border-radius: 14px; background: #fff; box-shadow: 0 18px 48px rgb(15 23 42 / 18%); color: #171923; }
.madi-llm-recovery__heading,.madi-llm-recovery__actions { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.madi-llm-recovery__heading>div { display:grid; gap:3px; }
.madi-llm-recovery__heading span,.madi-llm-recovery p,.madi-llm-recovery__diff dt { color:#667085; font-size:.82rem; }
.madi-llm-recovery__heading button { border:0; background:transparent; font-size:1.3rem; cursor:pointer; }
.madi-llm-recovery__diff { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:14px 0; }
.madi-llm-recovery__diff>div { display:grid; gap:2px; padding:9px; border-radius:9px; background:#f5f6f8; }
.madi-llm-recovery__diff dd { margin:0; font-weight:650; }
.madi-llm-recovery__actions { justify-content:flex-end; margin-top:12px; }
.madi-llm-recovery__actions button { min-height:34px; padding:0 12px; border:1px solid #cfd3dd; border-radius:8px; background:#fff; cursor:pointer; }
.madi-llm-recovery__actions button:last-child { border-color:#4f46e5; background:#4f46e5; color:#fff; }
.madi-llm-recovery__actions button:disabled { cursor:not-allowed; opacity:.55; }
.madi-llm-recovery__error { color:#b42318 !important; }
''')

rel = "apps/desktop/src/renderer/main.tsx"
text = read(rel)
text = replace_once(text, 'import { LlmAssistantOverlay } from "./components/llm/LlmAssistantOverlay";\n', 'import { LlmAssistantOverlay } from "./components/llm/LlmAssistantOverlay";\nimport { LlmAiSnapshotRecoveryPanel } from "./components/llm/LlmAiSnapshotRecoveryPanel";\n', "main recovery import")
text = replace_once(text, '    <LlmMultiBlockReviewOverlay\n      api={window.madiLlm}', '    <LlmAiSnapshotRecoveryPanel />\n    <LlmMultiBlockReviewOverlay\n      api={window.madiLlm}', "main recovery mount")
write(rel, text)

rel = "apps/desktop/src/renderer/App.tsx"
text = read(rel)
anchor = 'import type { WorldGraphPerformanceSample } from "./components/worldGraph/worldGraphInteraction";\n'
text = replace_once(text, anchor, anchor + 'import {\n  recordLlmAiSafetySnapshot,\n  registerLlmAiSnapshotRecoveryOwner\n} from "./llm/aiSnapshotRecoveryBridge";\n', "App recovery import")
text = replace_once(text, '  const requestSnapshotDiff = async (snapshotId: string): Promise<void> => {', '  const requestSnapshotDiff = async (snapshotId: string): Promise<DiffNamedSnapshotResult> => {', "requestSnapshotDiff return type")
start = text.index("  const requestSnapshotDiff = async ")
end = text.index("\n\n  const restoreNamedSnapshot = async", start)
segment = text[start:end]
segment = replace_once(segment, "      setSnapshotDiff(result);", "      setSnapshotDiff(result);\n      return result;", "return snapshot diff")
text = text[:start] + segment + text[end:]
text = replace_once(text, '  const restoreNamedSnapshot = async (snapshotId: string): Promise<void> => {', '  const restoreNamedSnapshot = async (\n    snapshotId: string,\n    expectedDiffOverride?: DiffNamedSnapshotResult\n  ): Promise<void> => {', "restore signature")
text = replace_once(text, '''        if (
          !snapshotDiff ||
          snapshotDiff.snapshot.id !== snapshotId ||
          snapshotDiff.revision !== freshDiff.revision ||
          JSON.stringify(snapshotDiff.summary) !==
            JSON.stringify(freshDiff.summary)
        ) {''', '''        const expectedDiff = expectedDiffOverride ?? snapshotDiff;
        if (
          !expectedDiff ||
          expectedDiff.snapshot.id !== snapshotId ||
          expectedDiff.revision !== freshDiff.revision ||
          JSON.stringify(expectedDiff.summary) !==
            JSON.stringify(freshDiff.summary)
        ) {''', "restore expected diff")
positions = [m.start() for m in re.finditer(r"api\.createNamedSnapshot\(\{", text)]
candidates = []
for pos in positions:
    around = text[max(0, pos - 2500):pos + 1800]
    if "createSafetySnapshot" in around and "changedBlockCount" in around:
        candidates.append(pos)
if len(candidates) != 1:
    raise RuntimeError(f"expected one LLM snapshot call, found {len(candidates)}")
pos = candidates[0]
call_end = text.index("      });", pos) + len("      });")
call = text[pos:call_end]
if 'kind: "AUTO_BEFORE_AI_APPLY"' not in call:
    call = call.replace("name: request.name,", 'name: request.name,\n        kind: "AUTO_BEFORE_AI_APPLY",', 1)
text = text[:pos] + call + text[call_end:]
region = text[pos:pos + 3200]
match = re.search(r"return \{\s*snapshotId:\s*result\.snapshot\.id,\s*projectRevision:\s*result\.revision\s*\};", region, re.S)
if not match:
    raise RuntimeError("could not locate AI snapshot receipt return")
absolute = pos + match.start()
text = text[:absolute] + '''recordLlmAiSafetySnapshot({
        snapshotId: result.snapshot.id,
        projectRevision: result.revision,
        changedBlockCount: request.changedBlockCount,
        createdAt: new Date().toISOString()
      });
      ''' + text[absolute:]
restore_start = text.index("  const restoreNamedSnapshot = async (")
switch_marker = "\n\n  const switchAppMode = async "
restore_end = text.index(switch_marker, restore_start)
text = text[:restore_end] + '''

  useEffect(() =>
    registerLlmAiSnapshotRecoveryOwner({
      previewSafetySnapshot: (snapshotId) => requestSnapshotDiff(snapshotId),
      restoreSafetySnapshot: (snapshotId, expectedDiff) =>
        restoreNamedSnapshot(snapshotId, expectedDiff)
    })
  );''' + text[restore_end:]
write(rel, text)

write("docs/decisions/ADR-0016-ai-safety-snapshot-is-first-class-and-directly-restorable.md", '''# ADR-0016 — AI safety snapshot is first-class and directly restorable

## Status
Accepted for private-local Phase 1I-I.

## Decision
- `AUTO_BEFORE_AI_APPLY` is a first-class Rust, SQLite and TypeScript snapshot kind.
- Existing payload bytes and hashes are preserved by schema 9 migration.
- The renderer recovery record contains only snapshot ID, project revision, changed-block count and timestamp.
- Prompt, API key, raw response, context and manuscript are excluded.
- The AI recovery UI requests the normal named-snapshot diff from the active App.
- Restore is allowed only after review and a fresh identical diff.
- Restore continues to create `AUTO_BEFORE_RESTORE` protection.
- Cross-document and project-wide AI mutation remains unauthorized.
''')

write("docs/PHASE_1I_I_RESULT.md", '''# Phase 1I-I — First-class AI Safety Snapshot and Direct Recovery

## Verdict

```text
Repository implementation: COMPLETE ON main
AUTO_BEFORE_AI_APPLY snapshot kind: IMPLEMENTED
Direct diff and restore from AI recovery UI: IMPLEMENTED
Cross-document/project-wide AI mutation: NOT AUTHORIZED
Distribution: PRIVATE LOCAL ONLY
```

Schema 9 distinguishes AI pre-apply recovery from search/replace snapshots without changing payload format. The global recovery panel delegates diff and restore to the active App and carries no manuscript or provider secret. A fresh diff equality check is required before the established restore workflow runs.
''')

for rel in ["docs/PHASE_1I_SCOPE.md", "docs/LLM_ADAPTER_ARCHITECTURE.md", "docs/NAMED_SNAPSHOT_FORMAT.md", "docs/MADI_FILE_FORMAT_V1_DRAFT.md"]:
    text = read(rel)
    text += '''

## Phase 1I-I first-class AI recovery

Schema 9 adds `AUTO_BEFORE_AI_APPLY` as a first-class named-snapshot kind. Payload version and logical format version do not change. The AI recovery panel stores only bounded snapshot identity metadata, obtains a normal project diff from App, and requires a fresh matching diff before direct restore. Prompt, credential, raw response and manuscript content are not included in recovery metadata.
'''
    write(rel, text)

print("Phase 1I-I transformation complete")
