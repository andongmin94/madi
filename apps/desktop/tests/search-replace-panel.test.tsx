import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SearchReplacePanel,
  type SearchReplacePanelProps
} from "../src/renderer/components/SearchReplacePanel";
import type {
  SearchHit,
  SearchProjectResult
} from "../src/shared/contracts";

const titleHit: SearchHit = {
  occurrenceId: "title-1",
  nodeId: "chapter-1",
  sceneId: null,
  documentId: null,
  nodeKind: "CHAPTER",
  nodeTitle: "용의 귀환",
  field: "TITLE",
  start: 0,
  end: 1,
  contextBefore: "",
  matchedText: "용",
  contextAfter: "의 귀환",
  sourceContentHash: null
};

const firstBodyHit: SearchHit = {
  occurrenceId: "body-1",
  nodeId: "scene-1",
  sceneId: "scene-1",
  documentId: "document-1",
  nodeKind: "SCENE",
  nodeTitle: "문 앞",
  field: "BODY",
  start: 3,
  end: 4,
  contextBefore: "그날 ",
  matchedText: "용",
  contextAfter: "이 돌아왔다.",
  sourceContentHash: "b".repeat(64)
};

const secondBodyHit: SearchHit = {
  occurrenceId: "body-2",
  nodeId: "scene-2",
  sceneId: "scene-2",
  documentId: "document-2",
  nodeKind: "SCENE",
  nodeTitle: "광장",
  field: "BODY",
  start: 8,
  end: 9,
  contextBefore: "사람들은 ",
  matchedText: "용",
  contextAfter: "을 올려다보았다.",
  sourceContentHash: "c".repeat(64)
};

const result: SearchProjectResult = {
  query: "용",
  caseSensitive: false,
  target: "ALL",
  scopeNodeId: "work-1",
  totalMatches: 3,
  sceneCount: 2,
  offset: 0,
  limit: 100,
  hasMore: false,
  hits: [titleHit, firstBodyHit, secondBodyHit],
  revision: 17
};

function defaultProps(
  overrides: Partial<SearchReplacePanelProps> = {}
): SearchReplacePanelProps {
  return {
    result,
    semanticReplaceAvailable: true,
    currentScopeLabel: "제1권",
    currentScopeId: "volume-1",
    onSearch: vi.fn(),
    onResultClick: vi.fn(),
    onApply: vi.fn(),
    ...overrides
  };
}

function runMatchingSearch(): void {
  fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
    target: { value: "용" }
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
}

describe("Phase 1B search and selective replace panel", () => {
  it("refreshes a changed query after a short debounce", async () => {
    vi.useFakeTimers();
    let unmount: () => void = () => undefined;
    try {
      const onSearch = vi.fn();
      ({ unmount } = render(
        <SearchReplacePanel {...defaultProps({ onSearch })} />
      ));
      fireEvent.change(
        screen.getByRole("searchbox", { name: "찾을 문자열" }),
        { target: { value: "한국어" } }
      );

      await vi.advanceTimersByTimeAsync(319);
      expect(onSearch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onSearch).toHaveBeenCalledWith("한국어", {
        caseSensitive: false,
        target: "ALL",
        scope: "CURRENT"
      });
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("submits an explicit search with target, case and scope options", () => {
    const onSearch = vi.fn();
    render(<SearchReplacePanel {...defaultProps({ onSearch })} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
      target: { value: "용" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "검색 대상" }), {
      target: { value: "BODIES" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "대소문자 구분" }));
    fireEvent.click(screen.getByRole("radio", { name: "작품 전체" }));
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("용", {
      caseSensitive: true,
      target: "BODIES",
      scope: "ALL"
    });
  });

  it("groups contextual hits and exposes title hits as read-only results", async () => {
    const onResultClick = vi.fn();
    render(<SearchReplacePanel {...defaultProps({ onResultClick })} />);

    expect(screen.getByRole("heading", { name: "용의 귀환 · 화" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "문 앞 · 장면" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "광장 · 장면" })).toBeTruthy();
    expect(screen.getByText("의 귀환")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    });
    expect(
      screen.queryByRole("checkbox", { name: "제목 일치: 용 선택" })
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "본문 그날 용 이 돌아왔다." })
    );
    expect(onResultClick).toHaveBeenCalledWith(firstBodyHit);
  });

  it("selects only BODY occurrences and sends a revision-bound apply preview", async () => {
    const onApply = vi.fn();
    render(<SearchReplacePanel {...defaultProps({ onApply })} />);
    runMatchingSearch();

    const sceneOneGroup = screen
      .getByRole("heading", { name: "문 앞 · 장면" })
      .closest<HTMLElement>(".search-result-group");
    if (!sceneOneGroup) {
      throw new Error("scene one result group missing");
    }
    const firstSelection = within(sceneOneGroup).getByRole(
      "checkbox"
    ) as HTMLInputElement;
    await waitFor(() => expect(firstSelection.checked).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "모두 해제" }));
    const applyButton = screen.getByRole("button", {
      name: "선택 항목 치환 적용"
    }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    fireEvent.click(within(sceneOneGroup).getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "바꿀 문자열" }), {
      target: { value: "별" }
    });
    expect(applyButton.disabled).toBe(false);
    expect(screen.getByText(/1개 장면의 1개 본문 일치/)).toBeTruthy();

    fireEvent.click(applyButton);
    expect(onApply).toHaveBeenCalledWith({
      query: "용",
      replacement: "별",
      caseSensitive: false,
      scopeNodeId: "work-1",
      expectedRevision: 17,
      hits: [firstBodyHit]
    });

    fireEvent.click(screen.getByRole("button", { name: "본문 결과 모두 선택" }));
    expect(screen.getByText(/2개 장면의 2개 본문 일치/)).toBeTruthy();
  });

  it("blocks unsafe replacement capability, newlines and stale search conditions", () => {
    const { rerender } = render(
      <SearchReplacePanel
        {...defaultProps({ semanticReplaceAvailable: false })}
      />
    );
    runMatchingSearch();

    const applyButton = screen.getByRole("button", {
      name: "선택 항목 치환 적용"
    }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    expect(screen.getByText(/의미 구조를 보존하는 치환/)).toBeTruthy();

    rerender(<SearchReplacePanel {...defaultProps()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "바꿀 문자열" }), {
      target: { value: "첫째 줄\n둘째 줄" }
    });
    expect(applyButton.disabled).toBe(true);
    expect(screen.getByText(/줄바꿈이 포함된 치환/)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "바꿀 문자열" }), {
      target: { value: "별" }
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "찾을 문자열" }), {
      target: { value: "새 검색어" }
    });
    expect(applyButton.disabled).toBe(true);
    expect(screen.getByText(/검색 조건이 바뀌었습니다/)).toBeTruthy();
  });

  it("invalidates CURRENT-scope preview when the selected Binder node changes", async () => {
    vi.useFakeTimers();
    let unmount: () => void = () => undefined;
    try {
      const onSearch = vi.fn();
      const rendered = render(
        <SearchReplacePanel
          {...defaultProps({ currentScopeId: "volume-a", onSearch })}
        />
      );
      unmount = rendered.unmount;
      runMatchingSearch();
      fireEvent.change(screen.getByRole("textbox", { name: "바꿀 문자열" }), {
        target: { value: "별" }
      });
      const applyButton = screen.getByRole("button", {
        name: "선택 항목 치환 적용"
      }) as HTMLButtonElement;
      expect(applyButton.disabled).toBe(false);

      rendered.rerender(
        <SearchReplacePanel
          {...defaultProps({
            currentScopeId: "volume-b",
            currentScopeLabel: "제2권",
            onSearch
          })}
        />
      );
      expect(applyButton.disabled).toBe(true);
      expect(screen.getByText(/검색 조건이 바뀌었습니다/)).toBeTruthy();

      await vi.advanceTimersByTimeAsync(320);
      expect(onSearch).toHaveBeenCalledTimes(2);
      expect(onSearch).toHaveBeenLastCalledWith("용", {
        caseSensitive: false,
        target: "ALL",
        scope: "CURRENT"
      });
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
});
