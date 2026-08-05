import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from "electron";

import {
  LLM_IPC_CHANNELS,
  type CancelLlmRequest,
  type DeleteLlmProviderRequest,
  type InvokeLlmRequest,
  type SaveLlmProviderRequest
} from "../../shared/llmIpc";
import { isTrustedIpcSender } from "../ipc";
import type { LlmRuntimeService } from "./service";

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
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("Invalid LLM request shape");
  }
  return record;
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
    !Number.isSafeInteger(request.expectedRevision) ||
    (request.expectedRevision as number) < 1
  ) {
    throw new Error("Invalid LLM provider deletion request");
  }
  return request as unknown as DeleteLlmProviderRequest;
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
    service.invoke(
      requireExact(rawRequest, ["invocation"]) as unknown as InvokeLlmRequest
    )
  );
  handle(LLM_IPC_CHANNELS.cancel, (_event, rawRequest: unknown) => {
    const request = requireExact(rawRequest, ["requestId"]) as unknown as CancelLlmRequest;
    if (typeof request.requestId !== "string") {
      throw new Error("Invalid LLM cancellation request");
    }
    return { cancelled: service.cancel(request.requestId) };
  });

  return () => {
    for (const channel of Object.values(LLM_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
    }
  };
}
