import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SceneEntityInspector } from "../src/renderer/components/storyBible/SceneEntityInspector";
import type {
  StoryEntity,
  StorySceneLink
} from "../src/renderer/components/storyBible/StoryBibleWorkspace";

const NOW = "2026-08-02T00:00:00.000Z";

function storyEntity(id: string, name: string, alias: string): StoryEntity {
  return {
    id,
    projectId: "project-1",
    kind: "CHARACTER",
    name,
    summary: null,
    documentId: `document-${id}`,
    status: "ACTIVE",
    colorToken: null,
    iconKey: null,
    attributesJson: "{}",
    createdAt: NOW,
    updatedAt: NOW,
    aliases: [
      {
        id: `alias-${id}`,
        entityId: id,
        alias,
        normalizedAlias: alias,
        createdAt: NOW
      }
    ],
    tags: []
  };
}

describe("Phase 1C scene entity inspector", () => {
  it("searches name/alias, creates role links, opens details and unlinks", async () => {
    const leia = storyEntity("entity-leia", "레이아", "리아");
    const key = storyEntity("entity-key", "붉은 열쇠", "홍염의 열쇠");
    const link: StorySceneLink = {
      sceneNodeId: "scene-1",
      sceneTitle: "성문 앞",
      entityId: leia.id,
      role: "POV",
      note: null,
      createdAt: NOW
    };
    const onCreateLink = vi.fn();
    const onDeleteLink = vi.fn();
    const onOpenEntity = vi.fn();
    const onSearchEntities = vi.fn(async () => [key.id]);
    render(
      <SceneEntityInspector
        sceneId="scene-1"
        sceneTitle="성문 앞"
        entities={[leia, key]}
        links={[link]}
        onCreateLink={onCreateLink}
        onDeleteLink={onDeleteLink}
        onOpenEntity={onOpenEntity}
        onSearchEntities={onSearchEntities}
      />
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "장면 연결 설정 검색" }),
      { target: { value: "홍염의 열쇠" } }
    );
    await waitFor(() =>
      expect(onSearchEntities).toHaveBeenCalledWith("홍염의 열쇠")
    );
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "붉은 열쇠" })
      ).toBeTruthy()
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "장면에 연결할 설정" }),
      { target: { value: key.id } }
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "장면 설정 역할" }),
      { target: { value: "RELATED" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "설정 연결" }));
    expect(onCreateLink).toHaveBeenCalledWith("scene-1", key.id, "RELATED");

    fireEvent.click(
      screen.getByRole("button", { name: "레이아 설정 상세 열기" })
    );
    expect(onOpenEntity).toHaveBeenCalledWith(leia.id);
    fireEvent.click(
      screen.getByRole("button", { name: "레이아 POV 연결 해제" })
    );
    expect(onDeleteLink).toHaveBeenCalledWith(link);
    expect(
      document.querySelector("[data-scene-link-id='scene-1:entity-leia:POV']")
    ).toBeTruthy();
  });
});
