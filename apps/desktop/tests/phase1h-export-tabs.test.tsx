import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  epubLeave: vi.fn(async () => true),
  epubClose: vi.fn(async () => true),
  hwpxLeave: vi.fn(async () => true),
  hwpxClose: vi.fn(async () => true)
}));

vi.mock("../src/renderer/components/epubExport/EpubExportWorkspace", async () => {
  const React = await import("react");
  return {
    EpubExportWorkspace: React.forwardRef(function FakeEpub(_props, ref) {
      React.useImperativeHandle(ref, () => ({
        prepareToLeave: controls.epubLeave,
        prepareToClose: controls.epubClose,
        reload: async () => undefined
      }));
      return React.createElement("section", { "aria-label": "EPUB child" });
    })
  };
});

vi.mock(
  "../src/renderer/components/hwpxExport/HwpxExportWorkspace",
  async () => {
    const React = await import("react");
    return {
      HwpxExportWorkspace: React.forwardRef(function FakeHwpx(_props, ref) {
        React.useImperativeHandle(ref, () => ({
          prepareToLeave: controls.hwpxLeave,
          prepareToClose: controls.hwpxClose,
          reload: async () => undefined
        }));
        return React.createElement("section", { "aria-label": "HWPX child" });
      })
    };
  }
);

import {
  PublicationExportMode,
  type PublicationExportModeHandle,
  type PublicationExportModeProps
} from "../src/renderer/components/PublicationExportMode";
import type { ProjectTree } from "../src/shared/contracts";
import { phase1cApiStubs } from "./phase1c-api-stubs";

const tree: ProjectTree = {
  project: {
    id: "project-1",
    title: "작품",
    authorName: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z"
  },
  nodes: [],
  revision: 1
};

function props(): PublicationExportModeProps {
  return {
    api: phase1cApiStubs() as PublicationExportModeProps["api"],
    sessionId: "session-1",
    projectId: "project-1",
    projectRevision: 1,
    projectTree: tree,
    initialScopeNodeId: null,
    reloadToken: 0,
    interactionBlocked: false,
    onBeforeExport: async () => 1,
    onProjectRevision: vi.fn(),
    onOpenSource: vi.fn(),
    onOperationBusyChange: vi.fn()
  };
}

describe("Phase 1H publication export tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controls.epubLeave.mockResolvedValue(true);
    controls.epubClose.mockResolvedValue(true);
    controls.hwpxLeave.mockResolvedValue(true);
    controls.hwpxClose.mockResolvedValue(true);
  });

  it("waits for the active exporter before switching formats", async () => {
    let resolveLeave!: (ready: boolean) => void;
    controls.epubLeave.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (resolveLeave = resolve))
    );
    render(<PublicationExportMode {...props()} />);
    expect(screen.getByRole("region", { name: "EPUB child" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "한글 문서" }));
    expect(screen.queryByRole("region", { name: "HWPX child" })).toBeNull();
    resolveLeave(true);
    await screen.findByRole("region", { name: "HWPX child" });
    expect(controls.epubLeave).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the active exporter refuses the transition", async () => {
    controls.epubLeave.mockResolvedValueOnce(false);
    render(<PublicationExportMode {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: "한글 문서" }));
    await waitFor(() => expect(controls.epubLeave).toHaveBeenCalled());
    expect(screen.getByRole("region", { name: "EPUB child" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "HWPX child" })).toBeNull();
  });

  it("delegates App close preparation to the selected HWPX exporter", async () => {
    const handle = createRef<PublicationExportModeHandle>();
    render(<PublicationExportMode ref={handle} {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: "한글 문서" }));
    await screen.findByRole("region", { name: "HWPX child" });
    await expect(handle.current!.prepareToClose()).resolves.toBe(true);
    expect(controls.hwpxClose).toHaveBeenCalledTimes(1);
    expect(controls.epubClose).not.toHaveBeenCalled();
  });
});
