import { describe, expect, it } from "vitest";

import { ProjectSessionRegistry } from "../src/main/projectSessions";

describe("ProjectSessionRegistry", () => {
  it("retires the previous project session when a replacement is added", () => {
    const registry = new ProjectSessionRegistry();
    const first = registry.add({
      filePath: "/drafts/first.madi",
      projectId: "project-1",
      documentId: "document-1",
      sceneId: "scene-1",
      workNodeId: "work-1",
      title: "First",
      revision: 1
    });

    const second = registry.add({
      filePath: "/drafts/second.madi",
      projectId: "project-2",
      documentId: "document-2",
      sceneId: "scene-2",
      workNodeId: "work-2",
      title: "Second",
      revision: 7
    });

    expect(() => registry.require(first.sessionId)).toThrow(
      "The project session is no longer available"
    );
    expect(registry.require(second.sessionId)).toMatchObject({
      projectId: "project-2",
      documentId: "document-2",
      sceneId: "scene-2",
      workNodeId: "work-2",
      revision: 7
    });
  });
});
