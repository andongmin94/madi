import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectSession } from "../shared/contracts";

interface ProjectSessionRecord {
  readonly sessionId: string;
  readonly filePath: string;
  readonly fileName: string;
  readonly projectId: string;
  documentId?: string;
  title: string;
  revision: number;
}

export class ProjectSessionRegistry {
  private readonly records = new Map<string, ProjectSessionRecord>();

  public add(input: {
    readonly filePath: string;
    readonly projectId: string;
    readonly documentId?: string;
    readonly title: string;
    readonly revision: number;
  }): ProjectSession {
    const sessionId = randomUUID();
    const record: ProjectSessionRecord = {
      sessionId,
      filePath: input.filePath,
      fileName: path.basename(input.filePath),
      projectId: input.projectId,
      title: input.title,
      revision: input.revision
    };
    if (input.documentId !== undefined) {
      record.documentId = input.documentId;
    }
    this.records.set(sessionId, record);
    return this.toPublic(record);
  }

  public require(sessionId: string): ProjectSessionRecord {
    const record = this.records.get(sessionId);
    if (!record) {
      throw new Error("The project session is no longer available");
    }
    return record;
  }

  public update(
    sessionId: string,
    input: {
      readonly documentId: string;
      readonly title: string;
      readonly revision: number;
    }
  ): ProjectSession {
    const record = this.require(sessionId);
    record.documentId = input.documentId;
    record.title = input.title;
    record.revision = input.revision;
    return this.toPublic(record);
  }

  private toPublic(record: ProjectSessionRecord): ProjectSession {
    const session: ProjectSession = {
      sessionId: record.sessionId,
      fileName: record.fileName,
      projectId: record.projectId,
      title: record.title,
      revision: record.revision
    };
    if (record.documentId !== undefined) {
      return { ...session, documentId: record.documentId };
    }
    return session;
  }
}
