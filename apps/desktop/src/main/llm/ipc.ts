import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";

import type {
  LlmInvocationRequest,
  LlmInvocationScope,
  LlmTaskKind
} from "../../shared/llm";
import {
  LLM_IPC_CHANNELS,
  type CancelLlmRequest,
  type DeleteLlmProviderRequest,
  type InvokeLlmRequest,
  type SaveLlmProviderRequest
} from "../../shared/llmIpc";
import { isTrustedIpcSender } from "../ipc";
import type { LlmRuntimeService } from "./service";

const TASK_KINDS = new Set<LlmTaskKind>([
  "REWRITE_SELECTION",
  "CONTINUE_SCENE",
  "SUMMARIZE_SCOPE",
  "EXTRACT_STORY_BIBLE",
  "CHECK_CONSISTENCY",
  "CUSTOM"
]);
const SCOPE_KINDS = new Set<LlmInvocationScope["kind"]>([
  "SELECTION",
  "SCENE",
  "CHAPTER",
  "CUSTOM"
]);

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid LLM request");
  }
  return value as Record<string, unknown>;
}

function requireExact(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  const record = requireRecord(value);
  const allowed = new Set(keys);
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new Error("Invalid LLM request shape");
  }
  return record;
}

function requireString(
  value: unknown,
  field: string,
  maximumLength: number,
  allowEmpty = false
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maximumLength ||
    /\u0000/u.test(value)
  ) {
    throw new Error(`Invalid LLM ${field}`);
  }
  return value;
}

function parseSaveProviderRequest(value: unknown): SaveLlmProviderRequest {
  const request = requireExact(value, [
    "provider",
    "expectedRevision",
    "apiKey"
  ]);
  const provider = requireExact(request.provider, [
    "id",
    "name",
    "kind",
    "baseUrl",
    "model",
    "requiresApiKey",
    "timeoutMs",
    "maxOutputTokens",
    "temperature"
  ]);
  if (
    typeof provider.id !== "string" ||
    typeof provider.name !== "string" ||
    provider.kind !== "OPENAI_COMPATIBLE" ||
    typeof provider.baseUrl !== "string" ||
    typeof provider.model !== "string" ||
    typeof provider.requiresApiKey !== "boolean" ||
    !Number.isSafeInteger(provider.timeoutMs) ||
    !Number.isSafeInteger(provider.maxOutputTokens) ||
    typeof provider.temperature !== "number" ||
    !Number.isFinite(provider.temperature)
  ) {
    throw new Error("Invalid LLM provider request");
  }
  if (
    request.expectedRevision !== null &&
    (!Number.isSafeInteger(request.expectedRevision) ||
      (request.expectedRevision as number) < 1)
  ) {
    throw new Error("Invalid LLM provider revision");
  }
  if (request.apiKey !== null && typeof request.apiKey !== "string") {
    throw new Error("Invalid LLM credential request");
  }
  return {
    provider: provider as unknown as SaveLlmProviderRequest["provider"],
    expectedRevision: request.expectedRevision as number | null,
    apiKey: request.apiKey as string | null
  };
}

function parseDeleteProviderRequest(value: unknown): DeleteLlmProviderRequest {
  const request = requireExact(value, ["providerId", "expectedRevision"]);
  if (
    typeof request.providerId !== "string" ||
    request.providerId.length === 0 ||
    request.providerId.length > 128 ||
    !Number.isSafeInteger(request.expectedRevision) ||
    (request.expectedRevision as number) < 1
  ) {
    throw new Error("Invalid LLM provider deletion request");
  }
  return request as unknown as DeleteLlmProviderRequest;
}

function parseInvocationScope(value: unknown): LlmInvocationScope {
  const scope = requireExact(value, [
    "kind",
    "sourceId",
    "manuscriptText",
    "contextText"
  ]);
  if (
    typeof scope.kind !== "string" ||
    !SCOPE_KINDS.has(scope.kind as LlmInvocationScope["kind"])
  ) {
    throw new Error("Invalid LLM scope kind");
  }
  const sourceId =
    scope.sourceId === null
      ? null
      : requireString(scope.sourceId, "scope source", 512);
  const contextText =
    scope.contextText === null
      ? null
      : requireString(scope.contextText, "scope context", 200_000, true);
  return {
    kind: scope.kind as LlmInvocationScope["kind"],
    sourceId,
    manuscriptText: requireString(
      scope.manuscriptText,
      "manuscript scope",
      1_000_000,
      true
    ),
    contextText
  };
}

function parseInvocationRequest(value: unknown): LlmInvocationRequest {
  const invocation = requireExact(value, [
    "requestId",
    "providerId",
    "expectedProviderRevision",
    "task",
    "systemInstruction",
    "userInstruction",
    "scope",
    "consent"
  ]);
  if (
    typeof invocation.task !== "string" ||
    !TASK_KINDS.has(invocation.task as LlmTaskKind) ||
    !Number.isSafeInteger(invocation.expectedProviderRevision) ||
    (invocation.expectedProviderRevision as number) < 1
  ) {
    throw new Error("Invalid LLM invocation metadata");
  }
  const consent = requireExact(invocation.consent, [
    "confirmedAt",
    "scopeSha256"
  ]);
  const scopeSha256 = requireString(
    consent.scopeSha256,
    "scope hash",
    64
  );
  if (!/^[0-9a-f]{64}$/u.test(scopeSha256)) {
    throw new Error("Invalid LLM scope hash");
  }
  return {
    requestId: requireString(invocation.requestId, "request ID", 128),
    providerId: requireString(invocation.providerId, "provider ID", 128),
    expectedProviderRevision: invocation.expectedProviderRevision as number,
    task: invocation.task as LlmTaskKind,
    systemInstruction: requireString(
      invocation.systemInstruction,
      "system instruction",
      32_000,
      true
    ),
    userInstruction: requireString(
      invocation.userInstruction,
      "user instruction",
      32_000,
      true
    ),
    scope: parseInvocationScope(invocation.scope),
    consent: {
      confirmedAt: requireString(
        consent.confirmedAt,
        "confirmation timestamp",
        64
      ),
      scopeSha256
    }
  };
}

function parseInvokeRequest(value: unknown): InvokeLlmRequest {
  const request = requireExact(value, ["invocation"]);
  return { invocation: parseInvocationRequest(request.invocation) };
}

function sanitizedError(error: unknown): Error {
  if (
    error instanceof Error &&
    typeof (error as Error & { code?: unknown }).code === "string"
  ) {
    const code = (error as Error & { code: string }).code;
    return new Error(`[${code}] ${error.message}`);
  }
  return new Error("The LLM operation failed.");
}

export interface RegisterLlmIpcOptions {
  readonly ipcMain: IpcMain;
  readonly window: BrowserWindow;
  readonly rendererUrl: string;
  readonly service: LlmRuntimeService;
}

export function registerMadiLlmIpc({
  ipcMain,
  window,
  rendererUrl,
  service
}: RegisterLlmIpcOptions): () => void {
  const authorize = (event: IpcMainInvokeEvent): void => {
    if (!isTrustedIpcSender(event, window, rendererUrl)) {
      throw new Error("Rejected IPC sender");
    }
  };
  const handle = <TArguments extends readonly unknown[], TResult>(
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      ...arguments_: TArguments
    ) => TResult | Promise<TResult>
  ): void => {
    ipcMain.handle(channel, async (event, ...arguments_: unknown[]) => {
      authorize(event);
      try {
        return await listener(event, ...(arguments_ as unknown as TArguments));
      } catch (error) {
        throw sanitizedError(error);
      }
    });
  };

  handle(LLM_IPC_CHANNELS.getStatus, () => service.getStatus());
  handle(LLM_IPC_CHANNELS.listProviders, () => service.listProviders());
  handle(LLM_IPC_CHANNELS.saveProvider, (_event, rawRequest: unknown) =>
    service.saveProvider(parseSaveProviderRequest(rawRequest))
  );
  handle(LLM_IPC_CHANNELS.deleteProvider, (_event, rawRequest: unknown) =>
    service.deleteProvider(parseDeleteProviderRequest(rawRequest))
  );
  handle(LLM_IPC_CHANNELS.invoke, (_event, rawRequest: unknown) =>
    service.invoke(parseInvokeRequest(rawRequest))
  );
  handle(LLM_IPC_CHANNELS.cancel, (_event, rawRequest: unknown) => {
    const request = requireExact(rawRequest, ["requestId"]);
    const requestId = requireString(request.requestId, "request ID", 128);
    return { cancelled: service.cancel(requestId) };
  });

  return () => {
    for (const channel of Object.values(LLM_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
