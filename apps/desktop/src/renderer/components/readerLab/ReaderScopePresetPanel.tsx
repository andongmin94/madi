import type { ReaderPresetOption } from "./types";
import type { ReaderScopeOption } from "./readerLabState";

interface ReaderScopePresetPanelProps {
  readonly scopes: readonly ReaderScopeOption[];
  readonly scopeNodeId: string | null;
  readonly presets: readonly ReaderPresetOption[];
  readonly selectedPresetId: string | null;
  readonly presetName: string;
  readonly presetDirty: boolean;
  readonly busy: boolean;
  readonly leftPanelWidth: number;
  readonly onScope: (scopeNodeId: string) => void;
  readonly onPreset: (presetId: string) => void;
  readonly onPresetName: (name: string) => void;
  readonly onSavePreset: () => void;
  readonly onDuplicatePreset: () => void;
  readonly onDeletePreset: () => void;
  readonly onResetPreset: () => void;
  readonly onLeftPanelWidth: (width: number) => void;
}

export function ReaderScopePresetPanel({
  scopes,
  scopeNodeId,
  presets,
  selectedPresetId,
  presetName,
  presetDirty,
  busy,
  leftPanelWidth,
  onScope,
  onPreset,
  onPresetName,
  onSavePreset,
  onDuplicatePreset,
  onDeletePreset,
  onResetPreset,
  onLeftPanelWidth
}: ReaderScopePresetPanelProps) {
  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? presets[0] ?? null;
  return (
    <aside className="reader-scope-presets" aria-label="Reader 범위와 preset">
      <section>
        <p className="reader-eyebrow">SCOPE</p>
        <h2>읽을 범위</h2>
        <label className="reader-select-list">
          <span className="sr-only">Reader 범위</span>
          <select
            aria-label="Reader 범위"
            value={scopeNodeId ?? ""}
            disabled={busy}
            size={Math.min(6, Math.max(2, scopes.length))}
            onChange={(event) => onScope(event.currentTarget.value)}
          >
            {scopes.map((scope) => (
              <option value={scope.nodeId} key={scope.nodeId}>
                {scope.label} · {scope.kind}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="reader-preset-section">
        <p className="reader-eyebrow">PRESET</p>
        <h2>독서환경</h2>
        <label className="reader-select-list reader-select-list--presets">
          <span className="sr-only">Reader preset</span>
          <select
            aria-label="Reader preset"
            value={selectedPresetId ?? ""}
            disabled={busy}
            size={9}
            onChange={(event) => onPreset(event.currentTarget.value)}
          >
            {presets.map((preset) => (
              <option value={preset.id} key={preset.id}>
                {preset.name} · {preset.builtin ? "built-in" : preset.sourceKind.toLocaleLowerCase()}
                {preset.duplicateName ? " · 중복 이름" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="reader-control reader-preset-name">
          <span>preset 이름</span>
          <input
            value={presetName}
            maxLength={160}
            disabled={busy}
            onChange={(event) => onPresetName(event.currentTarget.value)}
          />
        </label>
        <div className="reader-button-row">
          <button type="button" disabled={busy || presetName.trim().length === 0 || !presetDirty} onClick={onSavePreset}>
            {selectedPreset?.builtin ? "새 preset 저장" : "변경 저장"}
          </button>
          <button type="button" disabled={busy || !selectedPreset} onClick={onDuplicatePreset}>복제</button>
          <button type="button" disabled={busy || !selectedPreset || selectedPreset.builtin} onClick={onDeletePreset}>삭제</button>
          <button type="button" disabled={busy || !presetDirty} onClick={onResetPreset}>설정 reset</button>
        </div>
        {presetDirty && <p className="reader-changed" role="status">저장하지 않은 사용자 변경</p>}
        {selectedPreset && (
          <dl className="reader-preset-metadata">
            <div><dt>검증 상태</dt><dd>{selectedPreset.verificationStatus}</dd></div>
            <div><dt>content hash</dt><dd title={selectedPreset.contentHash}>{selectedPreset.contentHash.slice(0, 12)}</dd></div>
          </dl>
        )}
      </section>

      <section className="reader-simulation-note">
        <strong>독서환경 시뮬레이션</strong>
        <p>실제 플랫폼 앱 버전, 기기와 사용자 설정에 따라 표시 결과가 달라질 수 있습니다.</p>
        <p>플랫폼형 template은 공식 기본값이나 UI 복제품이 아닙니다.</p>
      </section>

      <label className="reader-control reader-panel-width">
        <span>왼쪽 panel 폭</span>
        <input type="range" min={220} max={520} value={leftPanelWidth} onChange={(event) => onLeftPanelWidth(event.currentTarget.valueAsNumber)} />
      </label>
    </aside>
  );
}
