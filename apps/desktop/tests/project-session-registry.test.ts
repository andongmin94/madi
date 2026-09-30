import { describe, expect, it } from "vitest";

import { ProjectSessionRegistry } from "../src/main/projectSessions";

describe("ProjectSessionRegistry", () => {
  it("keeps the previous session until the replacement is accepted", () => {
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
    registry.completeProjectOpen(first.sessionId, true);

    const second = registry.add({
      filePath: "/drafts/second.madi",
      projectId: "project-2",
      documentId: "document-2",
      sceneId: "scene-2",
      workNodeId: "work-2",
      title: "Second",
      revision: 7
    });

    expect(registry.require(first.sessionId).projectId).toBe("project-1");
    expect(registry.require(second.sessionId).projectId).toBe("project-2");
    registry.completeProjectOpen(second.sessionId, true);

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

  it("discards a rejected candidate and rejects overlapping or stale completions", () => {
    const registry = new ProjectSessionRegistry();
    const input = {
      filePath: "/drafts/first.madi",
      projectId: "project-1",
      title: "First",
      revision: 1
    };
    const first = registry.add(input);
    registry.completeProjectOpen(first.sessionId, true);
    const candidate = registry.add({ ...input, projectId: "project-2" });
    expect(() => registry.add(input)).toThrow(
      "Another project open is awaiting completion"
    );
    expect(() => registry.completeProjectOpen(first.sessionId, true)).toThrow(
      "The project open is no longer pending"
    );
    registry.completeProjectOpen(candidate.sessionId, false);
    expect(registry.require(first.sessionId).projectId).toBe("project-1");
    expect(() => registry.require(candidate.sessionId)).toThrow(
      "The project session is no longer available"
    );
    expect(() => registry.completeProjectOpen(candidate.sessionId, true)).toThrow(
      "The project open is no longer pending"
    );
    const next = registry.add({ ...input, projectId: "project-3" });
    registry.completeProjectOpen(next.sessionId, true);
    expect(() => registry.require(first.sessionId)).toThrow(
      "The project session is no longer available"
    );
    expect(registry.require(next.sessionId).projectId).toBe("project-3");
  });
});
