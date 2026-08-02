import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  StoryBibleWorkspace,
  type StoryBibleWorkspaceProps,
  type StoryEntity,
  type StoryEntityRelation,
  type StoryRelationType,
  type StorySceneLink
} from "../src/renderer/components/storyBible/StoryBibleWorkspace";

const NOW = "2026-08-02T00:00:00.000Z";

function entity(
  id: string,
  name: string,
  kind: StoryEntity["kind"] = "CHARACTER"
): StoryEntity {
  return {
    id,
    projectId: "project-1",
    kind,
    name,
    summary: `${name} 한 줄 요약`,
    documentId: `document-${id}`,
    status: "ACTIVE",
    colorToken: null,
    iconKey: null,
    attributesJson: "{}",
    createdAt: NOW,
    updatedAt: NOW,
    aliases: [],
    tags: []
  };
}

const leia: StoryEntity = {
  ...entity("entity-leia", "레이아"),
  aliases: [
    {
      id: "alias-1",
      entityId: "entity-leia",
      alias: "북부의 마법사",
      normalizedAlias: "북부의 마법사",
      createdAt: NOW
    }
  ],
  tags: [
    {
      id: "tag-hero",
      projectId: "project-1",
      name: "주요 인물",
      colorToken: null,
      createdAt: NOW
    }
  ]
};

const organization = entity(
  "entity-order",
  "북부 마법사단",
  "ORGANIZATION"
);
const serina = entity("entity-serina", "세리나");

const relationTypes: readonly StoryRelationType[] = [
  {
    id: "type-member",
    projectId: "project-1",
    name: "소속",
    inverseName: "구성원을 가짐",
    directed: true,
    colorToken: null,
    isBuiltin: true,
    createdAt: NOW,
    updatedAt: NOW
  },
  {
    id: "type-hostile",
    projectId: "project-1",
    name: "적대",
    inverseName: "적대",
    directed: false,
    colorToken: null,
    isBuiltin: true,
    createdAt: NOW,
    updatedAt: NOW
  }
];

const relations: readonly StoryEntityRelation[] = [
  {
    id: "relation-member",
    projectId: "project-1",
    sourceEntityId: leia.id,
    relationTypeId: "type-member",
    targetEntityId: organization.id,
    note: "정예 단원",
    createdAt: NOW,
    updatedAt: NOW
  },
  {
    id: "relation-hostile",
    projectId: "project-1",
    sourceEntityId: serina.id,
    relationTypeId: "type-hostile",
    targetEntityId: leia.id,
    note: null,
    createdAt: NOW,
    updatedAt: NOW
  }
];

const sceneLink: StorySceneLink = {
  sceneNodeId: "scene-1",
  sceneTitle: "성문 앞",
  entityId: leia.id,
  role: "POV",
  note: null,
  createdAt: NOW
};

function props(
  overrides: Partial<StoryBibleWorkspaceProps> = {}
): StoryBibleWorkspaceProps {
  return {
    entities: [leia, organization, serina],
    tags: leia.tags,
    relationTypes,
    relations,
    sceneLinks: [sceneLink],
    mentions: [
      {
        occurrenceId: "mention-1",
        sceneId: "scene-2",
        sceneTitle: "봉인의 문",
        documentId: "document-scene-2",
        matchedTerm: "북부의 마법사",
        start: 4,
        end: 12,
        contextBefore: "그때 ",
        matchedText: "북부의 마법사",
        contextAfter: "가 돌아왔다.",
        alreadyLinked: false
      }
    ],
    selectedEntityId: leia.id,
    noteEditor: <div data-testid="note-editor">Typie note</div>,
    noteSaveLabel: "저장됨",
    onSearchEntities: vi.fn(async () => [leia.id]),
    onListEntities: vi.fn(async () => [leia.id, organization.id, serina.id]),
    onCreate: vi.fn(),
    onSelect: vi.fn(),
    onUpdate: vi.fn(),
    onRequestDelete: vi.fn(async () => ({
      entityId: leia.id,
      entityName: leia.name,
      relationCount: 6,
      explicitSceneCount: 12,
      discoveredSceneCount: 3,
      aliasCount: 2,
      tagCount: 1,
      noteCharacterCount: 1428
    })),
    onConfirmDelete: vi.fn(),
    onAddAlias: vi.fn(),
    onDeleteAlias: vi.fn(),
    onCreateTag: vi.fn(async (name) => ({
      id: "tag-new",
      projectId: "project-1",
      name,
      colorToken: null,
      createdAt: NOW
    })),
    onSetTags: vi.fn(),
    onCreateRelation: vi.fn(),
    onUpdateRelation: vi.fn(),
    onDeleteRelation: vi.fn(),
    onCreateRelationType: vi.fn(),
    onUpdateRelationType: vi.fn(),
    onDeleteRelationType: vi.fn(),
    onOpenScene: vi.fn(),
    onPromoteMention: vi.fn(),
    ...overrides
  };
}

describe("Phase 1C Story Bible workspace", () => {
  it("filters, creates, selects, renames and warns about duplicate names", async () => {
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
    const onSearchEntities = vi.fn(async () => [organization.id]);
    render(
      <StoryBibleWorkspace
        {...props({ onCreate, onSelect, onUpdate, onSearchEntities })}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "새 설정 타입" }), {
      target: { value: "LOCATION" }
    });
    fireEvent.click(screen.getByRole("button", { name: "새 엔트리 생성" }));
    expect(onCreate).toHaveBeenCalledWith("LOCATION", "새 장소");

    fireEvent.click(screen.getByRole("button", { name: /북부 마법사단/ }));
    expect(onSelect).toHaveBeenCalledWith(organization.id);

    const name = screen.getByRole("textbox", { name: "설정 이름" });
    fireEvent.change(name, { target: { value: "세리나" } });
    expect(screen.getByText("같은 이름의 설정이 있습니다.")).toBeTruthy();
    fireEvent.blur(name);
    expect(onUpdate).toHaveBeenCalledWith(leia.id, { name: "세리나" });

    fireEvent.change(screen.getByRole("searchbox", { name: "설정 검색" }), {
      target: { value: "상세 노트에만 있는 문구" }
    });
    await waitFor(() =>
      expect(onSearchEntities).toHaveBeenCalledWith("상세 노트에만 있는 문구")
    );
    await waitFor(() => {
      const list = screen.getByRole("list", { name: "설정 엔트리" });
      expect(within(list).getByText("북부 마법사단")).toBeTruthy();
      expect(within(list).queryByText("레이아")).toBeNull();
    });
  });

  it("edits aliases, tags, directed/inverse relations and mention promotion", async () => {
    const onAddAlias = vi.fn();
    const onDeleteAlias = vi.fn();
    const onSetTags = vi.fn();
    const onCreateRelation = vi.fn();
    const onUpdateRelation = vi.fn();
    const onDeleteRelation = vi.fn();
    const onOpenScene = vi.fn();
    const onPromoteMention = vi.fn();
    render(
      <StoryBibleWorkspace
        {...props({
          onAddAlias,
          onDeleteAlias,
          onSetTags,
          onCreateRelation,
          onUpdateRelation,
          onDeleteRelation,
          onOpenScene,
          onPromoteMention
        })}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "새 별칭" }), {
      target: { value: "리아" }
    });
    fireEvent.click(screen.getByRole("button", { name: "별칭 추가" }));
    expect(onAddAlias).toHaveBeenCalledWith(leia.id, "리아");
    fireEvent.click(
      screen.getByRole("button", { name: "북부의 마법사 별칭 삭제" })
    );
    expect(onDeleteAlias).toHaveBeenCalledWith("alias-1");

    fireEvent.click(screen.getByRole("checkbox", { name: "주요 인물" }));
    expect(onSetTags).toHaveBeenCalledWith(leia.id, []);

    const outgoing = screen.getByRole("region", { name: "나가는 관계" });
    expect(within(outgoing).getByText(/소속 → 북부 마법사단/)).toBeTruthy();
    const incoming = screen.getByRole("region", { name: "들어오는 관계" });
    expect(within(incoming).getByText(/적대 ↔ 세리나/)).toBeTruthy();
    expect(within(incoming).getByText("양방향 관계")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "관계 타입" }), {
      target: { value: "type-member" }
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "관계 대상 설정 검색" }),
      { target: { value: organization.id } }
    );
    fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
    expect(onCreateRelation).toHaveBeenCalledWith(leia.id, {
      relationTypeId: "type-member",
      targetEntityId: organization.id
    });

    fireEvent.click(within(outgoing).getByRole("button", { name: "소속 관계 수정" }));
    fireEvent.change(screen.getByRole("textbox", { name: "관계 메모" }), {
      target: { value: "변경한 메모" }
    });
    fireEvent.click(screen.getByRole("button", { name: "관계 변경 저장" }));
    expect(onUpdateRelation).toHaveBeenCalledWith(
      "relation-member",
      expect.objectContaining({ note: "변경한 메모" })
    );
    fireEvent.click(within(incoming).getByRole("button", { name: "적대 관계 삭제" }));
    expect(onDeleteRelation).toHaveBeenCalledWith("relation-hostile");

    fireEvent.click(screen.getByRole("button", { name: /봉인의 문/ }));
    expect(onOpenScene).toHaveBeenCalledWith("scene-2", { start: 4, end: 12 });
    fireEvent.click(screen.getByRole("button", { name: "언급으로 연결" }));
    expect(onPromoteMention).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceId: "mention-1" }),
      "MENTIONED"
    );
    expect(screen.getByText(/사실로 단정하지 않으며/)).toBeTruthy();
  });

  it("manages custom relation types and presents complete delete impact", async () => {
    const onCreateRelationType = vi.fn();
    const onUpdateRelationType = vi.fn();
    const onDeleteRelationType = vi.fn();
    const onConfirmDelete = vi.fn();
    render(
      <StoryBibleWorkspace
        {...props({
          onCreateRelationType,
          onUpdateRelationType,
          onDeleteRelationType,
          onConfirmDelete
        })}
      />
    );

    fireEvent.click(screen.getByText("관계 타입 관리"));
    fireEvent.change(screen.getByRole("textbox", { name: "관계 타입 이름" }), {
      target: { value: "스승" }
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "관계 타입 역방향 이름" }),
      { target: { value: "제자" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "관계 타입 생성" }));
    expect(onCreateRelationType).toHaveBeenCalledWith({
      name: "스승",
      inverseName: "제자",
      directed: true
    });
    expect(
      (screen.getByRole("button", {
        name: "소속 관계 타입 삭제"
      }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "설정 삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("관계 6개")).toBeTruthy();
    expect(within(dialog).getByText("장면 연결 12개")).toBeTruthy();
    expect(within(dialog).getByText("상세 노트 1,428자")).toBeTruthy();
    expect(within(dialog).getByText(/본문 원고의 이름이나 문장은 변경하지 않습니다/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(onConfirmDelete).toHaveBeenCalledWith(leia.id));
  });

  it("renders and selects within the bounded 500 entity / 1,500 alias / 2,000 relation / 2,000 link fixture", () => {
    const entities = Array.from({ length: 500 }, (_, index) => ({
      ...entity(`entity-${index}`, `설정 ${String(index).padStart(3, "0")}`),
      aliases: Array.from({ length: 3 }, (_, aliasIndex) => ({
        id: `alias-${index}-${aliasIndex}`,
        entityId: `entity-${index}`,
        alias: `설정 ${index} 별칭 ${aliasIndex}`,
        normalizedAlias: `설정 ${index} 별칭 ${aliasIndex}`,
        createdAt: NOW
      }))
    }));
    const manyRelations = Array.from({ length: 2_000 }, (_, index) => ({
      id: `relation-${index}`,
      projectId: "project-1",
      sourceEntityId: index < 20 ? "entity-0" : `entity-${(index % 499) + 1}`,
      relationTypeId: "type-member",
      targetEntityId: `entity-${(index + 1) % 500}`,
      note: null,
      createdAt: NOW,
      updatedAt: NOW
    }));
    const manyLinks = Array.from({ length: 2_000 }, (_, index) => ({
      sceneNodeId: `scene-${index}`,
      sceneTitle: `장면 ${index}`,
      entityId: index < 20 ? "entity-0" : `entity-${(index % 499) + 1}`,
      role: "RELATED" as const,
      note: null,
      createdAt: NOW
    }));
    const onSelect = vi.fn();
    render(
      <StoryBibleWorkspace
        {...props({
          entities,
          selectedEntityId: "entity-0",
          relations: manyRelations,
          sceneLinks: manyLinks,
          mentions: [],
          onSelect,
          onListEntities: vi.fn(async () => entities.map((item) => item.id))
        })}
      />
    );

    expect(
      within(screen.getByRole("list", { name: "설정 엔트리" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(500);
    expect(screen.getByText("설정 0 별칭 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /설정 499/ }));
    expect(onSelect).toHaveBeenCalledWith("entity-499");
    expect(
      within(screen.getByRole("region", { name: "나가는 관계" })).getAllByRole(
        "listitem"
      ).length
    ).toBeGreaterThanOrEqual(20);
    expect(
      within(screen.getByRole("region", { name: "연결된 장면" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(20);
  }, 15_000);
});
