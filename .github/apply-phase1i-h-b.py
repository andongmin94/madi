from __future__ import annotations

from pathlib import Path
import re

ROOT = Path.cwd()


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.is_file():
        raise SystemExit(f"required file missing: {rel}")
    return path.read_text(encoding="utf-8")


def write(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f"{label}: expected one exact marker, found {source.count(old)}")
    return source.replace(old, new, 1)


s = read("crates/madi-core/src/model.rs")
s, n = re.subn(r"(pub enum NamedSnapshotKind \{\n\s*#\[default\]\n\s*Manual,\n\s*AutoBeforeReplace,\n\s*AutoBeforeRestore,\n)(\})", r"\1    AutoBeforeAiApply,\n\2", s, count=1)
if n != 1:
    raise SystemExit("NamedSnapshotKind enum marker not found")
s, n = re.subn(r'(Self::AutoBeforeRestore => "AUTO_BEFORE_RESTORE",\n)(\s*\})', r'\1            Self::AutoBeforeAiApply => "AUTO_BEFORE_AI_APPLY",\n\2', s, count=1)
if n != 1:
    raise SystemExit("NamedSnapshotKind as_str marker not found")
s, n = re.subn(r'("AUTO_BEFORE_RESTORE" => Ok\(Self::AutoBeforeRestore\),\n)(\s*_ =>)', r'\1            "AUTO_BEFORE_AI_APPLY" => Ok(Self::AutoBeforeAiApply),\n\2', s, count=1)
if n != 1:
    raise SystemExit("NamedSnapshotKind FromStr marker not found")
write("crates/madi-core/src/model.rs", s)

s = read("crates/madi-core/src/storage.rs")
s = replace_once(s, "pub const SCHEMA_VERSION: i64 = 8;", "pub const SCHEMA_VERSION: i64 = 9;", "schema version")
marker = "const ORDER_STEP: f64 = 1024.0;"
if marker not in s or "const MIGRATION_V9:" in s:
    raise SystemExit("storage migration insertion marker invalid")
migration = r'''const MIGRATION_V9: &str = r#"
DROP INDEX IF EXISTS named_snapshots_project_created_idx;
ALTER TABLE named_snapshots RENAME TO named_snapshots_v8;
CREATE TABLE named_snapshots (
    id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    note TEXT,
    kind TEXT NOT NULL CHECK (
        kind IN (
            'MANUAL', 'AUTO_BEFORE_REPLACE', 'AUTO_BEFORE_RESTORE',
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
"#;

'''
s = s.replace(marker, migration + marker, 1)
old_tail = '''        transaction.pragma_update(None, "user_version", 8_i64)?;
        transaction.commit()?;
    }

    Ok(())
}'''
new_tail = '''        transaction.pragma_update(None, "user_version", 8_i64)?;
        transaction.commit()?;
        current = 8;
    }

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
                "Phase 1I formal AUTO_BEFORE_AI_APPLY recovery snapshots"
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

    Ok(())
}'''
s = replace_once(s, old_tail, new_tail, "V8 migration tail")
s += r'''

#[cfg(test)]
mod phase1i_ai_snapshot_kind_tests {
    use super::{MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_V9};
    use rusqlite::{params, Connection};

    #[test]
    fn migration_v9_accepts_formal_ai_safety_snapshot_kind() {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection.execute_batch(MIGRATION_V1).expect("create v1 schema");
        connection.execute_batch(MIGRATION_V2).expect("create v2 schema");
        connection.execute_batch(MIGRATION_V3).expect("create v3 snapshot schema");
        connection.execute_batch(MIGRATION_V9).expect("migrate snapshot kind constraint");
        connection.execute(
            "INSERT INTO named_snapshots (
                id, project_id, name, note, kind, payload_format,
                payload_version, payload_blob, content_hash,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, NULL, 'AUTO_BEFORE_AI_APPLY',
                       'MADI_LOGICAL_JSON', 5, ?4, ?5, ?6, ?6)",
            params!["snapshot-ai-1", "project-1", "AI 적용 전", vec![1_u8, 2, 3], "a".repeat(64), "2026-08-22T12:00:00.000Z"],
        ).expect("insert formal AI safety snapshot");
        let kind: String = connection.query_row("SELECT kind FROM named_snapshots WHERE id = ?1", ["snapshot-ai-1"], |row| row.get(0)).expect("load snapshot kind");
        assert_eq!(kind, "AUTO_BEFORE_AI_APPLY");
    }
}
'''
write("crates/madi-core/src/storage.rs", s)

s = read("apps/desktop/src/shared/contracts.ts")
s = replace_once(s, '''export type NamedSnapshotKind =
  | "MANUAL"
  | "AUTO_BEFORE_REPLACE"
  | "AUTO_BEFORE_RESTORE";''', '''export type NamedSnapshotKind =
  | "MANUAL"
  | "AUTO_BEFORE_REPLACE"
  | "AUTO_BEFORE_RESTORE"
  | "AUTO_BEFORE_AI_APPLY";

export type CreatableNamedSnapshotKind =
  | "MANUAL"
  | "AUTO_BEFORE_AI_APPLY";''', "TypeScript snapshot union")
s = replace_once(s, '''export interface CreateNamedSnapshotRequest extends SessionRequest {
  readonly name: string;
  readonly note?: string;
}''', '''export interface CreateNamedSnapshotRequest extends SessionRequest {
  readonly name: string;
  readonly note?: string;
  readonly kind?: CreatableNamedSnapshotKind;
}''', "snapshot create request")
write("apps/desktop/src/shared/contracts.ts", s)

s = read("apps/desktop/src/renderer/components/SnapshotPanel.tsx")
s = replace_once(s, 'import { useState, type FormEvent } from "react";', 'import { useEffect, useRef, useState, type FormEvent } from "react";', "SnapshotPanel imports")
s = replace_once(s, '''  readonly errorMessage?: string | null;
  readonly onCreate: (''', '''  readonly errorMessage?: string | null;
  readonly focusSnapshotId?: string | null;
  readonly onCreate: (''', "SnapshotPanel props")
s = replace_once(s, '''  AUTO_BEFORE_REPLACE: "자동 · 치환 전",
  AUTO_BEFORE_RESTORE: "자동 · 복원 전"''', '''  AUTO_BEFORE_REPLACE: "자동 · 치환 전",
  AUTO_BEFORE_RESTORE: "자동 · 복원 전",
  AUTO_BEFORE_AI_APPLY: "자동 · AI 적용 전"''', "SnapshotPanel labels")
s = replace_once(s, '''  errorMessage = null,
  onCreate,''', '''  errorMessage = null,
  focusSnapshotId = null,
  onCreate,''', "SnapshotPanel destructuring")
s = replace_once(s, '''  const [restoreCandidate, setRestoreCandidate] =
    useState<NamedSnapshotSummary | null>(null);

  const matchingDiff =''', '''  const [restoreCandidate, setRestoreCandidate] =
    useState<NamedSnapshotSummary | null>(null);
  const lastFocusedSnapshotId = useRef<string | null>(null);

  useEffect(() => {
    if (!focusSnapshotId || busy || lastFocusedSnapshotId.current === focusSnapshotId || !snapshots.some((snapshot) => snapshot.id === focusSnapshotId)) {
      return;
    }
    lastFocusedSnapshotId.current = focusSnapshotId;
    setDiffRequestedId(focusSnapshotId);
    void Promise.resolve(onRequestDiff(focusSnapshotId)).catch(() => undefined);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-snapshot-id="${CSS.escape(focusSnapshotId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [busy, focusSnapshotId, onRequestDiff, snapshots]);

  const matchingDiff =''', "SnapshotPanel focus effect")
s = replace_once(s, '''                data-snapshot-payload-version={snapshot.payloadVersion}
              >''', '''                data-snapshot-payload-version={snapshot.payloadVersion}
                data-snapshot-focused={
                  focusSnapshotId === snapshot.id ? "true" : "false"
                }
              >''', "SnapshotPanel focused row")
write("apps/desktop/src/renderer/components/SnapshotPanel.tsx", s)

s = read("apps/desktop/src/main/desktopService.ts")
s = replace_once(s, '''        kind: "MANUAL",
        expected_revision: session.revision,''', '''        kind: validateEnum(
          input.kind ?? "MANUAL",
          ["MANUAL", "AUTO_BEFORE_AI_APPLY"] as const,
          "snapshot kind"
        ),
        expected_revision: session.revision,''', "desktop snapshot kind")
s = s.replace('"MANUAL", "AUTO_BEFORE_REPLACE", "AUTO_BEFORE_RESTORE"', '"MANUAL", "AUTO_BEFORE_REPLACE", "AUTO_BEFORE_RESTORE", "AUTO_BEFORE_AI_APPLY"')
s = s.replace('''  "MANUAL",
  "AUTO_BEFORE_REPLACE",
  "AUTO_BEFORE_RESTORE"
] as const''', '''  "MANUAL",
  "AUTO_BEFORE_REPLACE",
  "AUTO_BEFORE_RESTORE",
  "AUTO_BEFORE_AI_APPLY"
] as const''')
write("apps/desktop/src/main/desktopService.ts", s)

s = read("apps/desktop/src/main/ipc.ts")
s = replace_once(s, '''      return service.createNamedSnapshot(
        requireObject(rawRequest) as unknown as CreateNamedSnapshotRequest
      );''', '''      return service.createNamedSnapshot(
        requireExactRequest(rawRequest, [
          "sessionId",
          "name",
          "note",
          "kind"
        ]) as unknown as CreateNamedSnapshotRequest
      );''', "snapshot IPC shape")
write("apps/desktop/src/main/ipc.ts", s)

write("apps/desktop/src/renderer/llm/projectSnapshotNavigationBridge.ts", '''export interface LlmProjectSnapshotNavigationTarget {
  openSafetySnapshot(snapshotId: string): void;
}

export class LlmProjectSnapshotNavigationBridge {
  private target: LlmProjectSnapshotNavigationTarget | null = null;

  attach(target: LlmProjectSnapshotNavigationTarget): () => void {
    if (this.target !== null) {
      throw new Error("AI snapshot navigation is already connected.");
    }
    this.target = target;
    return () => {
      if (this.target === target) {
        this.target = null;
      }
    };
  }

  openSafetySnapshot(snapshotId: string): void {
    const normalized = snapshotId.trim();
    if (!normalized) {
      throw new Error("AI safety snapshot id is missing.");
    }
    if (!this.target) {
      throw new Error("현재 프로젝트 화면이 AI safety snapshot 탐색 경계에 연결되지 않았습니다.");
    }
    this.target.openSafetySnapshot(normalized);
  }
}

export const llmProjectSnapshotNavigationBridge = new LlmProjectSnapshotNavigationBridge();
''')

s = read("apps/desktop/src/renderer/App.tsx")
s = replace_once(s, 'import type { WorldGraphPerformanceSample } from "./components/worldGraph/worldGraphInteraction";', 'import type { WorldGraphPerformanceSample } from "./components/worldGraph/worldGraphInteraction";\nimport { llmProjectSnapshotNavigationBridge } from "./llm/projectSnapshotNavigationBridge";', "App navigation import")
s = replace_once(s, "  const [snapshotBusy, setSnapshotBusy] = useState(false);", '''  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [focusedSnapshotId, setFocusedSnapshotId] = useState<string | null>(null);''', "App focused snapshot state")
s = replace_once(s, "  const imeEnvironment = useMemo(", '''  useEffect(
    () =>
      llmProjectSnapshotNavigationBridge.attach({
        openSafetySnapshot(snapshotId) {
          setAppMode("MANUSCRIPT");
          setPanel("snapshots");
          setFocusedSnapshotId(snapshotId);
        }
      }),
    []
  );

  const imeEnvironment = useMemo(''', "App navigation effect")
positions = []
start = 0
while True:
    index = s.find("api.createNamedSnapshot({", start)
    if index < 0:
        break
    end = s.find("});", index)
    if end < 0:
        raise SystemExit("unterminated App snapshot request")
    context = s[max(0, index - 2500):min(len(s), end + 1000)]
    if "AUTO_BEFORE_AI_APPLY" in context:
        positions.append((index, end))
    start = end + 3
if len(positions) != 1:
    raise SystemExit(f"expected one AI snapshot request, found {len(positions)}")
index, end = positions[0]
block = s[index:end + 3]
block = block.replace("api.createNamedSnapshot({\n", 'api.createNamedSnapshot({\n        kind: "AUTO_BEFORE_AI_APPLY",\n', 1)
s = s[:index] + block + s[end + 3:]
index = s.find("<SnapshotPanel")
end = s.find("/>", index)
block = s[index:end + 2]
if "diff={snapshotDiff}" in block:
    block = block.replace("diff={snapshotDiff}", "diff={snapshotDiff}\n              focusSnapshotId={focusedSnapshotId}", 1)
else:
    block = block.replace("snapshots={snapshots}", "snapshots={snapshots}\n              focusSnapshotId={focusedSnapshotId}", 1)
s = s[:index] + block + s[end + 2:]
s = replace_once(s, '''      setSnapshots((current) =>
        current.filter((snapshot) => snapshot.id !== snapshotId)
      );''', '''      setSnapshots((current) =>
        current.filter((snapshot) => snapshot.id !== snapshotId)
      );
      setFocusedSnapshotId((current) => current === snapshotId ? null : current);''', "clear focused deleted snapshot")
write("apps/desktop/src/renderer/App.tsx", s)

s = read("apps/desktop/src/renderer/components/llm/LlmMultiBlockReviewOverlay.tsx")
s = replace_once(s, 'import "./llmMultiBlockReview.css";', 'import { llmProjectSnapshotNavigationBridge } from "../../llm/projectSnapshotNavigationBridge";\nimport "./llmMultiBlockReview.css";', "multi-block navigation import")
matches = []
for match in re.finditer(r"const\s+(\w+)\s*=\s*await\s+(.{0,1800}?);", s, re.S):
    expression = match.group(2)
    if "apply" in expression.lower() and ("proposal" in expression.lower() or "multi" in expression.lower()):
        matches.append(match)
if not matches:
    raise SystemExit("canonical multi-block apply assignment not found")
match = matches[-1]
variable = match.group(1)
s = s[:match.end()] + f'''\n      llmProjectSnapshotNavigationBridge.openSafetySnapshot({variable}.snapshot.snapshotId);''' + s[match.end():]
write("apps/desktop/src/renderer/components/llm/LlmMultiBlockReviewOverlay.tsx", s)

write("apps/desktop/tests/llm-project-snapshot-navigation-bridge.test.ts", '''import { describe, expect, it, vi } from "vitest";
import { LlmProjectSnapshotNavigationBridge } from "../src/renderer/llm/projectSnapshotNavigationBridge";

describe("LlmProjectSnapshotNavigationBridge", () => {
  it("opens exactly the requested safety snapshot", () => {
    const bridge = new LlmProjectSnapshotNavigationBridge();
    const openSafetySnapshot = vi.fn();
    const detach = bridge.attach({ openSafetySnapshot });
    bridge.openSafetySnapshot("snapshot-ai-1");
    expect(openSafetySnapshot).toHaveBeenCalledWith("snapshot-ai-1");
    detach();
    expect(() => bridge.openSafetySnapshot("snapshot-ai-1")).toThrowError(/연결되지 않았습니다/u);
  });
});
''')
write("apps/desktop/tests/phase1i-ai-snapshot-kind.test.tsx", '''import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SnapshotPanel } from "../src/renderer/components/SnapshotPanel";
import type { NamedSnapshotSummary } from "../src/shared/contracts";

const aiSnapshot: NamedSnapshotSummary = {
  id: "snapshot-ai-1", projectId: "project-1", name: "AI 다중 문단 적용 전", note: "변경 문단 2개",
  kind: "AUTO_BEFORE_AI_APPLY", payloadFormat: "MADI_LOGICAL_JSON", payloadVersion: 5,
  payloadBytes: 1024, contentHash: "a".repeat(64), createdAt: "2026-08-22T12:00:00.000Z", updatedAt: "2026-08-22T12:00:00.000Z"
};

describe("formal AI safety snapshot kind", () => {
  it("labels and focuses AUTO_BEFORE_AI_APPLY snapshots", async () => {
    const onRequestDiff = vi.fn(async () => undefined);
    render(<SnapshotPanel snapshots={[aiSnapshot]} diff={null} focusSnapshotId={aiSnapshot.id} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onRequestDiff={onRequestDiff} onRestore={vi.fn()} />);
    expect(screen.getByText("자동 · AI 적용 전")).toBeTruthy();
    await waitFor(() => expect(onRequestDiff).toHaveBeenCalledWith(aiSnapshot.id));
  });
});
''')

write("docs/PHASE_1I_H_RESULT.md", '''# Phase 1I-H — Snapshot-gated Multi-block AI Apply and Recovery Navigation

`AUTO_BEFORE_AI_APPLY` is now a formal schema-v9 snapshot kind. A reviewed active-document multi-paragraph rewrite flushes dirty state, creates the durable snapshot, revalidates source ranges and commits one Typie transaction. The exact recovery point opens in the existing author-confirmed Snapshot diff/restore panel. Cross-document and project-wide AI mutation remains unauthorized. Distribution remains private-local only.
''')
write("docs/decisions/ADR-0016-formal-ai-safety-snapshot-kind-and-navigation.md", '''# ADR-0016 — Formal AI safety snapshots use the existing restore UI

`AUTO_BEFORE_AI_APPLY` is a first-class snapshot kind. It is committed before multi-block Typie mutation and excludes credentials, prompts and raw provider output from metadata. After apply, only the snapshot ID crosses a renderer-local bridge; `App` opens the existing fresh-diff and author-confirmed restore flow. Cross-document and project-wide AI mutation remains unauthorized.
''')

s = read("docs/PHASE_1I_SCOPE.md")
status = '''## Status

```text
Phase 1I-A through 1I-G: IMPLEMENTED
Phase 1I-H snapshot-gated active-document multi-block apply and recovery navigation: IMPLEMENTED
Cross-document or project-wide AI mutation: NOT AUTHORIZED
Actual remote HTTPS provider: MANUAL VALIDATION PENDING
Full repository Windows verification: PENDING FOR CURRENT main
Distribution boundary: PRIVATE LOCAL ONLY
Typie license: HUMAN DECISION REQUIRED BEFORE DISTRIBUTION
Windows native Korean IME: MANUAL VALIDATION PENDING
```
'''
s, count = re.subn(r"## Status\n\n```text\n.*?```\n", status, s, count=1, flags=re.S)
if count != 1:
    raise SystemExit("Phase 1I scope status block missing")
s += '\n## Phase 1I-H recovery details\n\nSee [`PHASE_1I_H_RESULT.md`](PHASE_1I_H_RESULT.md) and [`ADR-0016`](decisions/ADR-0016-formal-ai-safety-snapshot-kind-and-navigation.md).\n'
write("docs/PHASE_1I_SCOPE.md", s)

for rel, addition in {
    "docs/PHASE_1I_RESULT.md": "\n## Phase 1I-H completion\n\nThe structured apply path now uses a durable formal AI safety snapshot and opens the exact recovery point in the established Snapshot diff/restore workflow.\n",
    "docs/LLM_ADAPTER_ARCHITECTURE.md": "\n## Formal AI recovery point\n\nPhase 1I-H commits `AUTO_BEFORE_AI_APPLY` before Typie mutation and passes only its ID to the existing confirmed restore flow.\n",
    "docs/NAMED_SNAPSHOT_FORMAT.md": "\n## Phase 1I formal AI safety snapshot\n\nSchema version 9 adds `AUTO_BEFORE_AI_APPLY`; payload format is unchanged and metadata excludes credentials, prompts and raw responses.\n",
    "docs/MADI_FILE_FORMAT_V1_DRAFT.md": "\n## Schema version 9 — AI apply recovery provenance\n\nLogical format remains 1. Existing snapshot rows and payload bytes are preserved.\n",
    "README.md": "\n## Phase 1I-H private-local AI recovery boundary\n\nReviewed active-document multi-paragraph rewrites require a formal `AUTO_BEFORE_AI_APPLY` snapshot before one all-or-nothing Typie transaction.\n",
}.items():
    write(rel, read(rel) + addition)

print("Phase 1I-H-B applied")
