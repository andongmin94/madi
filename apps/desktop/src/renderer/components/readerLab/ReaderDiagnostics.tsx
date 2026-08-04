import type {
  PublicationDiagnostic,
  PublicationDocument,
  PublicationSourceReference
} from "../../../shared/publication";
import type { ReaderLayoutDiagnostic } from "./types";

const CORE_DIAGNOSTIC_LABELS: Readonly<Record<PublicationDiagnostic["code"], string>> = {
  UNSUPPORTED_BLOCK: "지원하지 않는 block이 있어 plain text로 안전하게 표시합니다.",
  UNSUPPORTED_INLINE_MODIFIER: "지원하지 않는 inline modifier를 안전한 text로 표시합니다.",
  INVALID_SEMANTIC_DOCUMENT: "의미 문서 일부를 검증하지 못했습니다.",
  EMPTY_SCOPE: "선택 범위에 표시할 원고 block이 없습니다."
};

interface ReaderDiagnosticsProps {
  readonly expanded: boolean;
  readonly document: PublicationDocument | null;
  readonly coreDiagnostics: readonly PublicationDiagnostic[];
  readonly layoutDiagnostics: readonly ReaderLayoutDiagnostic[];
  readonly onExpanded: (expanded: boolean) => void;
  readonly onOpenSource: (source: PublicationSourceReference) => void | Promise<void>;
  readonly onSelectBlock: (blockId: string) => void;
}

export function ReaderDiagnostics({
  expanded,
  document,
  coreDiagnostics,
  layoutDiagnostics,
  onExpanded,
  onOpenSource,
  onSelectBlock
}: ReaderDiagnosticsProps) {
  return (
    <section className="reader-diagnostics" aria-label="Reader 검토 후보">
      <button
        type="button"
        className="reader-diagnostics__toggle"
        aria-expanded={expanded}
        onClick={() => onExpanded(!expanded)}
      >
        검토 후보 · {coreDiagnostics.length + layoutDiagnostics.length}
      </button>
      {expanded && (
        <div>
          {coreDiagnostics.map((diagnostic, index) => {
            const matchedBlock = diagnostic.blockId
              ? document?.sections
                  .flatMap((section) => section.blocks)
                  .find(
                    (block) =>
                      block.source.blockId === diagnostic.blockId &&
                      (diagnostic.sceneNodeId === null ||
                        block.source.sceneNodeId === diagnostic.sceneNodeId) &&
                      (diagnostic.documentId === null ||
                        block.source.documentId === diagnostic.documentId)
                  ) ?? null
              : null;
            const content = (
              <>
                <strong>{diagnostic.severity}</strong>{" "}
                {CORE_DIAGNOSTIC_LABELS[diagnostic.code]}
              </>
            );
            return matchedBlock ? (
              <button
                type="button"
                className={`reader-core-diagnostic reader-core-diagnostic--${diagnostic.severity.toLocaleLowerCase()}`}
                key={`${diagnostic.code}:${diagnostic.blockId}`}
                onClick={() => {
                  onSelectBlock(matchedBlock.id);
                  void onOpenSource(matchedBlock.source);
                }}
              >
                {content}
              </button>
            ) : (
              <p
                className={`reader-core-diagnostic reader-core-diagnostic--${diagnostic.severity.toLocaleLowerCase()}`}
                key={`${diagnostic.code}:${index}`}
              >
                {content}
              </p>
            );
          })}
          {layoutDiagnostics.map((diagnostic) => (
            <button
              type="button"
              key={diagnostic.id}
              onClick={() => {
                onSelectBlock(diagnostic.blockId);
                void onOpenSource(diagnostic.source);
              }}
            >
              <strong>{diagnostic.code}</strong>
              <span>{diagnostic.message}</span>
            </button>
          ))}
          {coreDiagnostics.length === 0 && layoutDiagnostics.length === 0 && (
            <p>현재 설정에서 표시할 검토 후보가 없습니다.</p>
          )}
          <p className="reader-diagnostics__note">검토 후보는 문장 품질 판정이 아니며 측정 환경에 따라 달라질 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
