import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SnapshotPanel,
  type SnapshotPanelProps
} from "../src/renderer/components/SnapshotPanel";
import type {
  DiffNamedSnapshotResult,
  NamedSnapshotSummary,
  SnapshotDiffSummary
} from "../src/shared/contracts";

const manualSnapshot: NamedSnapshotSummary = {
  id: "snapshot-1",
  projectId: "project-1",
  name: "1차 퇴고 전",
  note: "결말을 바꾸기 전",
  kind: "MANUAL",
  payloadFormat: "madi-logical-project",
  payloadVersion: 1,
  payloadBytes: 12_345,
  contentHash: "abcdef0123456789abcdef0123456789",
  createdAt: "2026-08-02T10:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z"
};

const automaticSnapshot: NamedSnapshotSummary = {
  ...manualSnapshot,
  id: "snapshot-2",
  name: "치환 전 자동 보관",
  note: null,
  kind: "AUTO_BEFORE_REPLACE",
  contentHash: "11111111111122222222222233333333"
};

const summary: SnapshotDiffSummary = {
  added: { volumes: 1, chapters: 2, scenes: 3 },
  deleted: { volumes: 0, chapters: 1, scenes: 2 },
  renamedNodes: 4,
  reorderedNodes: 5,
  changedSceneBodies: 6,
  characterCountDelta: -127,
  addedEntities: 0,
  deletedEntities: 0,
  changedEntities: 0,
  addedTags: 7,
  deletedTags: 8,
  changedTags: 9,
  addedRelationTypes: 10,
  deletedRelationTypes: 11,
  changedRelationTypes: 12,
  addedRelations: 0,
  deletedRelations: 0,
  changedRelations: 0,
  changedSceneLinks: 0,
  changedEntityNotes: 0,
  addedCanvases: 0,
  deletedCanvases: 0,
  changedCanvases: 0,
  canvasNodeCountDelta: 0,
  canvasEdgeCountDelta: 0,
  addedReaderPresets: 0,
  deletedReaderPresets: 0,
  changedReaderPresets: 0,
  publicationMetadataChanged: true,
  coverChanged: true,
  addedExportPresets: 13,
  deletedExportPresets: 14,
  changedExportPresets: 15
};

const diff: DiffNamedSnapshotResult = {
  snapshot: manualSnapshot,
  summary,
  revision: 21
};

function defaultProps(
  overrides: Partial<SnapshotPanelProps> = {}
): SnapshotPanelProps {
  return {
    snapshots: [manualSnapshot, automaticSnapshot],
    diff: null,
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onRequestDiff: vi.fn(),
    onRestore: vi.fn(),
    confirmDelete: () => true,
    ...overrides
  };
}

describe("Phase 1B named snapshot panel", () => {
  it("creates a named logical snapshot with an optional note", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SnapshotPanel {...defaultProps({ onCreate })} />);

    const createButton = screen.getByRole("button", {
      name: "현재 프로젝트 snapshot 생성"
    }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "이름" }), {
      target: { value: "  2차 퇴고 전  " }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "메모 (선택)" }), {
      target: { value: "  인물 관계 정리  " }
    });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        name: "2차 퇴고 전",
        note: "인물 관계 정리"
      });
    });
    await waitFor(() => {
      expect(
        (screen.getByRole("textbox", { name: "이름" }) as HTMLInputElement)
          .value
      ).toBe("");
    });
  });

  it("lists format metadata and supports inline rename and confirmed delete", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const confirmDelete = vi.fn().mockReturnValue(true);
    render(
      <SnapshotPanel
        {...defaultProps({ onRename, onDelete, confirmDelete })}
      />
    );

    expect(screen.getByText("결말을 바꾸기 전")).toBeTruthy();
    expect(screen.getAllByText("madi-logical-project v1")).toHaveLength(2);
    expect(screen.getByText("자동 · 치환 전")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "1차 퇴고 전 이름 변경" })
    );
    const renameInput = screen.getByRole("textbox", {
      name: "1차 퇴고 전 새 이름"
    });
    fireEvent.change(renameInput, { target: { value: "  결말 수정 직전  " } });
    fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith("snapshot-1", "결말 수정 직전");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "치환 전 자동 보관 삭제" })
    );
    await waitFor(() => {
      expect(confirmDelete).toHaveBeenCalledWith(automaticSnapshot);
      expect(onDelete).toHaveBeenCalledWith("snapshot-2");
    });
  });

  it("requests and presents the complete logical diff summary", () => {
    const onRequestDiff = vi.fn();
    const { rerender } = render(
      <SnapshotPanel {...defaultProps({ onRequestDiff })} />
    );

    const firstItem = screen
      .getByText("1차 퇴고 전")
      .closest<HTMLElement>("[data-snapshot-id='snapshot-1']");
    if (!firstItem) {
      throw new Error("first snapshot item missing");
    }
    fireEvent.click(within(firstItem).getByRole("button", { name: "차이 보기" }));
    expect(onRequestDiff).toHaveBeenCalledWith("snapshot-1");
    expect(screen.getByText(/차이를 계산하는 중/)).toBeTruthy();

    rerender(
      <SnapshotPanel {...defaultProps({ diff, onRequestDiff })} />
    );
    const preview = screen.getByRole("region", { name: "Snapshot 차이" });
    expect(within(preview).getByText("권 1 · 화 2 · 장면 3")).toBeTruthy();
    expect(within(preview).getByText("권 0 · 화 1 · 장면 2")).toBeTruthy();
    expect(within(preview).getByText("4개 노드")).toBeTruthy();
    expect(within(preview).getByText("5개 노드")).toBeTruthy();
    expect(within(preview).getByText("6개 장면")).toBeTruthy();
    expect(within(preview).getByText("-127자")).toBeTruthy();
    expect(within(preview).getByText("+7 · −8 · 변경 9")).toBeTruthy();
    expect(within(preview).getByText("+10 · −11 · 변경 12")).toBeTruthy();
    expect(within(preview).getByText("출판 메타데이터")).toBeTruthy();
    expect(within(preview).getByText("표지")).toBeTruthy();
    expect(within(preview).getByText("+13 · −14 · 변경 15")).toBeTruthy();
  });

  it("requires a diff-backed confirmation and explains restore transaction safety", async () => {
    const onRequestDiff = vi.fn();
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SnapshotPanel {...defaultProps({ onRequestDiff, onRestore })} />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "1차 퇴고 전 복원" })
    );
    expect(onRequestDiff).toHaveBeenCalledWith("snapshot-1");
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getAllByText(/자동 안전 snapshot/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/하나의 트랜잭션/)).toBeTruthy();
    const restoreButton = within(dialog).getByRole("button", {
      name: "안전 snapshot 생성 후 복원"
    }) as HTMLButtonElement;
    expect(restoreButton.disabled).toBe(true);

    rerender(
      <SnapshotPanel
        {...defaultProps({ diff, onRequestDiff, onRestore })}
      />
    );
    expect(restoreButton.disabled).toBe(false);
    fireEvent.click(restoreButton);
    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledWith("snapshot-1");
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("offers the product-level whole-replacement rollback action on safety snapshots", () => {
    const onRequestDiff = vi.fn();
    render(<SnapshotPanel {...defaultProps({ onRequestDiff })} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "치환 전 자동 보관 전체 치환 전 상태로 되돌리기"
      })
    );

    expect(onRequestDiff).toHaveBeenCalledWith("snapshot-2");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "project-wide Undo" })
    ).toBeNull();
  });

  it("warns that restoring a legacy v1 snapshot clears Story Bible and Canvas data", () => {
    const onRequestDiff = vi.fn();
    render(<SnapshotPanel {...defaultProps({ onRequestDiff })} />);

    expect(
      screen.getAllByText(
        /v1 snapshot · 복원하면 설정\(Story Bible\)과 Plot Canvas는 빈 상태/
      )
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "1차 퇴고 전 복원" })
    );

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/설정·관계·장면 연결은 빈 상태/)).toBeTruthy();
    expect(within(dialog).getAllByText(/자동 안전 snapshot/).length).toBeGreaterThan(0);
  });
});
