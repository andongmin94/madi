import {
  forwardRef,
  lazy,
  Suspense,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import type { MadiDesktopApi, ProjectTree } from "../../shared/contracts";
import { EpubExportWorkspace } from "./epubExport/EpubExportWorkspace";
import "./epubExport/epubExport.css";

const HwpxExportWorkspace = lazy(async () => {
  const module = await import("./hwpxExport/HwpxExportWorkspace");
  return { default: module.HwpxExportWorkspace };
});

export interface PublicationExportModeHandle {
  prepareToClose(): Promise<boolean>;
  prepareToLeave(): Promise<boolean>;
  reload(): Promise<void>;
}

export interface PublicationExportModeProps {
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

export const PublicationExportMode = forwardRef<
  PublicationExportModeHandle,
  PublicationExportModeProps
>(function PublicationExportMode(props, ref) {
  const epubWorkspaceRef = useRef<PublicationExportModeHandle>(null);
  const hwpxWorkspaceRef = useRef<PublicationExportModeHandle>(null);
  const [activeFormat, setActiveFormat] = useState<"EPUB" | "HWPX">("EPUB");
  const [switching, setSwitching] = useState(false);
  const activeRef =
    activeFormat === "EPUB" ? epubWorkspaceRef : hwpxWorkspaceRef;
  useImperativeHandle(
    ref,
    () => ({
      prepareToClose: () =>
        activeRef.current?.prepareToClose() ?? Promise.resolve(true),
      prepareToLeave: () =>
        activeRef.current?.prepareToLeave() ?? Promise.resolve(true),
      reload: () => activeRef.current?.reload() ?? Promise.resolve()
    }),
    [activeRef]
  );
  const switchFormat = async (next: "EPUB" | "HWPX") => {
    if (next === activeFormat || switching || props.interactionBlocked) {
      return;
    }
    setSwitching(true);
    try {
      const ready = await activeRef.current?.prepareToLeave();
      if (ready !== false) {
        setActiveFormat(next);
      }
    } finally {
      setSwitching(false);
    }
  };
  return (
    <section aria-label="출판 파일 내보내기">
      <div className="publication-export-tabs" role="tablist" aria-label="파일 형식">
        <button
          type="button"
          role="tab"
          aria-selected={activeFormat === "EPUB"}
          disabled={switching || props.interactionBlocked}
          onClick={() => void switchFormat("EPUB")}
        >
          EPUB
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFormat === "HWPX"}
          disabled={switching || props.interactionBlocked}
          onClick={() => void switchFormat("HWPX")}
        >
          한글 문서
        </button>
      </div>
      {activeFormat === "EPUB" ? (
        <EpubExportWorkspace ref={epubWorkspaceRef} {...props} />
      ) : (
        <Suspense
          fallback={
            <p role="status" aria-busy="true">
              한글 문서 내보내기 불러오는 중…
            </p>
          }
        >
          <HwpxExportWorkspace
            key={props.sessionId}
            ref={hwpxWorkspaceRef}
            {...props}
          />
        </Suspense>
      )}
    </section>
  );
});
