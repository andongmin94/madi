import type { SavePhase } from "../workspace/DocumentSessionController";

const LABELS: Readonly<Record<SavePhase, string>> = {
  "no-project": "프로젝트 없음",
  dirty: "저장 필요",
  saving: "저장 중…",
  saved: "저장됨",
  restoring: "복원 중…",
  error: "오류"
};

export function SaveStatusBadge({ phase }: { readonly phase: SavePhase }) {
  return (
    <output
      className={`save-status save-status--${phase}`}
      data-testid="save-status"
      data-phase={phase}
      aria-live="polite"
    >
      <span className="save-status__dot" aria-hidden="true" />
      {LABELS[phase]}
    </output>
  );
}
