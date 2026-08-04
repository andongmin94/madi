import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import type {
  PublicationBlock,
  PublicationInline,
  PublicationSourceReference,
  ReaderRenderConfig
} from "../../../shared/publication";

function InlineContent({
  inlines
}: {
  readonly inlines: readonly PublicationInline[];
}) {
  return inlines.map((inline, index) => {
    const key = `${inline.kind}:${index}`;
    switch (inline.kind) {
      case "TEXT":
        return <Fragment key={key}>{inline.text}</Fragment>;
      case "STRONG":
        return (
          <strong key={key}>
            <InlineContent inlines={inline.children} />
          </strong>
        );
      case "EMPHASIS":
        return (
          <em key={key}>
            <InlineContent inlines={inline.children} />
          </em>
        );
      case "UNDERLINE":
        return (
          <u key={key}>
            <InlineContent inlines={inline.children} />
          </u>
        );
      case "STRIKE":
        return (
          <s key={key}>
            <InlineContent inlines={inline.children} />
          </s>
        );
      case "RUBY":
        return (
          <ruby key={key}>
            <InlineContent inlines={inline.children} />
            <rp>(</rp>
            <rt>{inline.annotation}</rt>
            <rp>)</rp>
          </ruby>
        );
    }
  });
}

function headingContent(block: Extract<PublicationBlock, { kind: "HEADING" }>): ReactNode {
  switch (block.level) {
    case 1:
      return <h1>{block.text}</h1>;
    case 2:
      return <h2>{block.text}</h2>;
    case 3:
      return <h3>{block.text}</h3>;
    case 4:
      return <h4>{block.text}</h4>;
  }
}

function sceneBreakContent(config: ReaderRenderConfig): ReactNode {
  if (
    !config.settings.showSceneBreak ||
    config.workStyle.sceneBreakStyleToken === "HIDDEN"
  ) {
    return null;
  }
  switch (config.workStyle.sceneBreakStyleToken) {
    case "DIAMONDS":
      return (
        <span className="reader-scene-break" aria-label="장면 구분선">
          ◆ ◆ ◆
        </span>
      );
    case "RULE":
      return <span className="reader-scene-break reader-scene-break--rule" aria-label="장면 구분선" />;
    case "SPACE":
      return <span className="reader-scene-break reader-scene-break--space" aria-label="장면 구분 여백" />;
  }
}

function blockContent(block: PublicationBlock, config: ReaderRenderConfig): ReactNode {
  switch (block.kind) {
    case "HEADING":
      if (block.level === 3 && !config.settings.showChapterTitle) {
        return null;
      }
      if (
        block.level === 4 &&
        (!config.settings.showSceneTitle ||
          config.workStyle.sceneTitleStyleToken === "SCENE_HIDDEN")
      ) {
        return null;
      }
      return headingContent(block);
    case "PARAGRAPH":
      return (
        <p data-reader-paragraph="true">
          <InlineContent inlines={block.inlines} />
        </p>
      );
    case "QUOTE":
      return (
        <blockquote data-reader-paragraph="true">
          <InlineContent inlines={block.inlines} />
        </blockquote>
      );
    case "SCENE_BREAK":
      return sceneBreakContent(config);
    case "UNSUPPORTED":
      return (
        <aside className="reader-unsupported" data-reader-paragraph="true">
          <span className="reader-unsupported__label">지원하지 않는 block · {block.nodeType}</span>
          <p>{block.text}</p>
        </aside>
      );
  }
}

export interface PublicationBlockViewProps {
  readonly block: PublicationBlock;
  readonly config: ReaderRenderConfig;
  readonly selected: boolean;
  readonly measurement?: boolean;
  readonly tabIndex?: 0 | -1;
  readonly onSelect: (blockId: string) => void;
  readonly onOpenSource: (source: PublicationSourceReference) => void | Promise<void>;
}

export function PublicationBlockView({
  block,
  config,
  selected,
  measurement = false,
  tabIndex = 0,
  onSelect,
  onOpenSource
}: PublicationBlockViewProps) {
  const content = blockContent(block, config);
  if (content === null) {
    return null;
  }

  const activate = () => {
    onSelect(block.id);
    if (block.source.sceneNodeId && block.source.documentId) {
      void onOpenSource(block.source);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };
  return (
    <div
      className={`reader-block${
        block.kind === "HEADING" &&
        block.level === 3 &&
        config.workStyle.chapterTitleStyleToken === "CHAPTER_COMPACT"
          ? " reader-block--chapter-compact"
          : ""
      }`}
      data-reader-block-id={measurement ? undefined : block.id}
      data-reader-measure-block-id={measurement ? block.id : undefined}
      data-reader-block-kind={block.kind}
      data-reader-source-range={block.source.rangeVerified ? "exact" : "scene-fallback"}
      role={measurement ? undefined : "button"}
      tabIndex={measurement ? undefined : tabIndex}
      aria-pressed={measurement ? undefined : selected}
      aria-hidden={measurement ? true : undefined}
      aria-label={
        measurement
          ? undefined
          : `${block.kind === "SCENE_BREAK" ? "장면 구분선" : "원고 block"} · ${block.source.sceneNodeId ? "원고로 이동" : "source 선택"}`
      }
      onClick={measurement ? undefined : activate}
      onKeyDown={measurement ? undefined : onKeyDown}
    >
      {content}
    </div>
  );
}
