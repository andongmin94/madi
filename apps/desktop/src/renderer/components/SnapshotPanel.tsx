import { useState, type FormEvent } from "react";
import type {
  DiffNamedSnapshotResult,
  NamedSnapshotKind,
  NamedSnapshotSummary,
  SnapshotDiffSummary,
  SnapshotNodeCounts
} from "../../shared/contracts";

export interface SnapshotCreateInput {
  readonly name: string;
  readonly note?: string;
}

export interface SnapshotPanelProps {
  readonly snapshots: readonly NamedSnapshotSummary[];
  readonly diff: DiffNamedSnapshotResult | null;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly onCreate: (
    input: SnapshotCreateInput
  ) => void | Promise<void>;
  readonly onRename: (
    snapshotId: string,
    name: string
  ) => void | Promise<void>;
  readonly onDelete: (snapshotId: string) => void | Promise<void>;
  readonly onRequestDiff: (snapshotId: string) => void | Promise<void>;
  readonly onRestore: (snapshotId: string) => void | Promise<void>;
  readonly confirmDelete?: (snapshot: NamedSnapshotSummary) => boolean;
}

const KIND_LABELS: Readonly<Record<NamedSnapshotKind, string>> = {
  MANUAL: "수동",
  AUTO_BEFORE_REPLACE: "자동 · 치환 전",
  AUTO_BEFORE_RESTORE: "자동 · 복원 전"
};

function nodeCountsLabel(counts: SnapshotNodeCounts): string {
  return `권 ${counts.volumes} · 화 ${counts.chapters} · 장면 ${counts.scenes}`;
}

function signedNumber(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function defaultDeleteConfirmation(snapshot: NamedSnapshotSummary): boolean {
  return window.confirm(`‘${snapshot.name}’ snapshot을 삭제할까요?`);
}

function SnapshotDiffDetails({
  summary,
  compact = false
}: {
  readonly summary: SnapshotDiffSummary;
  readonly compact?: boolean;
}) {
  return (
    <dl className={compact ? "snapshot-diff snapshot-diff--compact" : "snapshot-diff"}>
      <div>
        <dt>추가</dt>
        <dd>{nodeCountsLabel(summary.added)}</dd>
      </div>
      <div>
        <dt>삭제</dt>
        <dd>{nodeCountsLabel(summary.deleted)}</dd>
      </div>
      <div>
        <dt>이름 변경</dt>
        <dd>{summary.renamedNodes}개 노드</dd>
      </div>
      <div>
        <dt>순서 변경</dt>
        <dd>{summary.reorderedNodes}개 노드</dd>
      </div>
      <div>
        <dt>본문 변경</dt>
        <dd>{summary.changedSceneBodies}개 장면</dd>
      </div>
      <div>
        <dt>문자 수 변화</dt>
        <dd>{signedNumber(summary.characterCountDelta)}자</dd>
      </div>
      <div>
        <dt>설정 변화</dt>
        <dd>
          +{summary.addedEntities} · −{summary.deletedEntities} · 변경 {summary.changedEntities}
        </dd>
      </div>
      <div>
        <dt>관계 변화</dt>
        <dd>
          +{summary.addedRelations} · −{summary.deletedRelations} · 변경 {summary.changedRelations}
        </dd>
      </div>
      <div>
        <dt>태그 변화</dt>
        <dd>
          +{summary.addedTags} · −{summary.deletedTags} · 변경 {summary.changedTags}
        </dd>
      </div>
      <div>
        <dt>관계 타입</dt>
        <dd>
          +{summary.addedRelationTypes} · −{summary.deletedRelationTypes} · 변경{" "}
          {summary.changedRelationTypes}
        </dd>
      </div>
      <div>
        <dt>장면 연결</dt>
        <dd>{summary.changedSceneLinks}개 변화</dd>
      </div>
      <div>
        <dt>설정 노트</dt>
        <dd>{summary.changedEntityNotes}개 설정 변화</dd>
      </div>
    </dl>
  );
}

export function SnapshotPanel({
  snapshots,
  diff,
  busy = false,
  errorMessage = null,
  onCreate,
  onRename,
  onDelete,
  onRequestDiff,
  onRestore,
  confirmDelete = defaultDeleteConfirmation
}: SnapshotPanelProps) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [diffRequestedId, setDiffRequestedId] = useState<string | null>(null);
  const [restoreCandidate, setRestoreCandidate] =
    useState<NamedSnapshotSummary | null>(null);

  const matchingDiff =
    diffRequestedId && diff?.snapshot.id === diffRequestedId ? diff : null;
  const restoreDiff =
    restoreCandidate && diff?.snapshot.id === restoreCandidate.id ? diff : null;

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || busy) {
      return;
    }
    try {
      await onCreate({
        name: normalizedName,
        ...(note.trim() ? { note: note.trim() } : {})
      });
      setName("");
      setNote("");
    } catch {
      // The parent owns error presentation; keep the user's draft for retry.
    }
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = renameValue.trim();
    if (!renamingId || !normalizedName || busy) {
      return;
    }
    try {
      await onRename(renamingId, normalizedName);
      setRenamingId(null);
      setRenameValue("");
    } catch {
      // The parent owns error presentation; keep the inline editor open.
    }
  };

  const requestDiff = (snapshotId: string) => {
    setDiffRequestedId(snapshotId);
    void Promise.resolve(onRequestDiff(snapshotId)).catch(() => undefined);
  };

  const requestRestore = (snapshot: NamedSnapshotSummary) => {
    setRestoreCandidate(snapshot);
    setDiffRequestedId(snapshot.id);
    void Promise.resolve(onRequestDiff(snapshot.id)).catch(() => undefined);
  };

  const confirmRestore = async () => {
    if (!restoreCandidate || !restoreDiff || busy) {
      return;
    }
    try {
      await onRestore(restoreCandidate.id);
      setRestoreCandidate(null);
    } catch {
      // The parent owns error presentation; keep confirmation visible.
    }
  };

  const deleteSnapshot = async (snapshot: NamedSnapshotSummary) => {
    if (busy || !confirmDelete(snapshot)) {
      return;
    }
    try {
      await onDelete(snapshot.id);
    } catch {
      // The parent owns error presentation.
    }
  };

  return (
    <aside className="side-panel snapshot-panel" aria-label="Named snapshot">
      <div className="side-panel__heading">
        <div>
          <p className="eyebrow">PROJECT SNAPSHOTS</p>
          <h2>Named snapshot</h2>
        </div>
      </div>

      <form className="snapshot-create" onSubmit={(event) => void submitCreate(event)}>
        <label>
          이름
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 1차 퇴고 전"
          />
        </label>
        <label>
          메모 (선택)
          <textarea
            value={note}
            maxLength={1_000}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button type="submit" disabled={name.trim().length === 0 || busy}>
          현재 프로젝트 snapshot 생성
        </button>
      </form>

      {errorMessage && <p role="alert">{errorMessage}</p>}

      <section className="snapshot-list" aria-label="저장된 snapshot">
        <h3>저장된 snapshot {snapshots.length}개</h3>
        {snapshots.length === 0 ? (
          <p>아직 저장된 snapshot이 없습니다.</p>
        ) : (
          <ul>
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} data-snapshot-id={snapshot.id}>
                {renamingId === snapshot.id ? (
                  <form onSubmit={(event) => void submitRename(event)}>
                    <label>
                      <span className="sr-only">{snapshot.name} 새 이름</span>
                      <input
                        autoFocus
                        aria-label={`${snapshot.name} 새 이름`}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={renameValue.trim().length === 0 || busy}
                    >
                      이름 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                    >
                      취소
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="snapshot-list__heading">
                      <strong>{snapshot.name}</strong>
                      <span>{KIND_LABELS[snapshot.kind]}</span>
                    </div>
                    {snapshot.note && <p>{snapshot.note}</p>}
                    {snapshot.payloadVersion === 1 && (
                      <p className="snapshot-legacy-warning">
                        구버전 snapshot · 복원하면 설정(Story Bible)은 빈 상태가 됩니다.
                      </p>
                    )}
                    <dl className="snapshot-metadata">
                      <div>
                        <dt>생성</dt>
                        <dd>{snapshot.createdAt}</dd>
                      </div>
                      <div>
                        <dt>형식</dt>
                        <dd>
                          {snapshot.payloadFormat} v{snapshot.payloadVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>크기</dt>
                        <dd>{snapshot.payloadBytes.toLocaleString("ko-KR")} bytes</dd>
                      </div>
                      <div>
                        <dt>해시</dt>
                        <dd title={snapshot.contentHash}>
                          {snapshot.contentHash.slice(0, 12)}…
                        </dd>
                      </div>
                    </dl>
                    <div className="snapshot-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => requestDiff(snapshot.id)}
                      >
                        차이 보기
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`${snapshot.name} 이름 변경`}
                        onClick={() => {
                          setRenamingId(snapshot.id);
                          setRenameValue(snapshot.name);
                        }}
                      >
                        이름 변경
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`${snapshot.name} 삭제`}
                        onClick={() => void deleteSnapshot(snapshot)}
                      >
                        삭제
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={
                          snapshot.kind === "AUTO_BEFORE_REPLACE"
                            ? `${snapshot.name} 전체 치환 전 상태로 되돌리기`
                            : `${snapshot.name} 복원`
                        }
                        onClick={() => requestRestore(snapshot)}
                      >
                        {snapshot.kind === "AUTO_BEFORE_REPLACE"
                          ? "전체 치환 전 상태로 되돌리기"
                          : "복원"}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {diffRequestedId && !matchingDiff && (
        <p role="status">snapshot 차이를 계산하는 중입니다…</p>
      )}
      {matchingDiff && !restoreCandidate && (
        <section className="snapshot-diff-preview" aria-label="Snapshot 차이">
          <h3>현재 프로젝트 ↔ {matchingDiff.snapshot.name}</h3>
          <SnapshotDiffDetails summary={matchingDiff.summary} />
        </section>
      )}

      {restoreCandidate && (
        <section
          className="snapshot-restore-confirmation"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="snapshot-restore-title"
          aria-describedby="snapshot-restore-safety"
        >
          <h3 id="snapshot-restore-title">
            ‘{restoreCandidate.name}’으로 복원할까요?
          </h3>
          {restoreDiff ? (
            <SnapshotDiffDetails summary={restoreDiff.summary} compact />
          ) : (
            <p role="status">복원 전 변경 요약을 계산하는 중입니다…</p>
          )}
          <p id="snapshot-restore-safety">
            복원 직전의 현재 프로젝트를 자동 안전 snapshot으로 먼저 저장합니다.
            복원과 안전 snapshot 생성은 하나의 트랜잭션으로 처리되어, 실패하면
            프로젝트 전체가 복원 전 상태로 유지됩니다.
          </p>
          {restoreCandidate.payloadVersion === 1 && (
            <p className="snapshot-legacy-warning" role="note">
              이 v1 snapshot에는 설정 데이터가 없습니다. 복원 후 Story Bible의
              설정·관계·장면 연결은 빈 상태가 됩니다. 현재 전체 상태는 복원 전에
              자동 안전 snapshot으로 보관됩니다.
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={!restoreDiff || busy}
              onClick={() => void confirmRestore()}
            >
              안전 snapshot 생성 후 복원
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRestoreCandidate(null)}
            >
              취소
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
