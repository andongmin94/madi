import { forwardRef, useImperativeHandle, useRef } from "react";
import type { MadiDesktopApi, ProjectTree } from "../../shared/contracts";
import { EpubExportWorkspace } from "./epubExport/EpubExportWorkspace";
import "./epubExport/epubExport.css";

export interface EpubExportModeHandle {
  prepareToClose(): Promise<boolean>;
  prepareToLeave(): Promise<boolean>;
  reload(): Promise<void>;
}

export interface EpubExportModeProps {
  readonly api: MadiDesktopApi;
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly projectTree: ProjectTree;
  readonly initialScopeNodeId: string | null;
  readonly reloadToken: number;
  readonly interactionBlocked: boolean;
  readonly onBeforeExport: () => Promise<number | null>;
  readonly onProjectRevision: (revision: number) => void;
  readonly onOpenSource: (sourceNodeId: string) => void | Promise<void>;
  readonly onOperationBusyChange: (busy: boolean) => void;
}

export const EpubExportMode = forwardRef<
  EpubExportModeHandle,
  EpubExportModeProps
>(function EpubExportMode(props, ref) {
  const workspaceRef = useRef<EpubExportModeHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      prepareToClose: () =>
        workspaceRef.current?.prepareToClose() ?? Promise.resolve(true),
      prepareToLeave: () =>
        workspaceRef.current?.prepareToLeave() ?? Promise.resolve(true),
      reload: () => workspaceRef.current?.reload() ?? Promise.resolve()
    }),
    []
  );
  return <EpubExportWorkspace ref={workspaceRef} {...props} />;
});
