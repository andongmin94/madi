import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaveStatusBadge } from "../src/renderer/components/SaveStatusBadge";
import type { SavePhase } from "../src/renderer/workspace/DocumentSessionController";

describe("save status UI", () => {
  const expectations: readonly [SavePhase, string][] = [
    ["no-project", "프로젝트 없음"],
    ["dirty", "저장 필요"],
    ["saving", "저장 중…"],
    ["saved", "저장됨"],
    ["restoring", "복원 중…"],
    ["error", "오류"]
  ];

  for (const [phase, label] of expectations) {
    it(`renders ${phase}`, () => {
      render(<SaveStatusBadge phase={phase} />);
      const status = screen.getByTestId("save-status");
      expect(status.textContent).toContain(label);
      expect(status.getAttribute("data-phase")).toBe(phase);
    });
  }
});
