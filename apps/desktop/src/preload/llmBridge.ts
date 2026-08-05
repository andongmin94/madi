import {
  LLM_IPC_CHANNELS,
  type CancelLlmRequest,
  type DeleteLlmProviderRequest,
  type InvokeLlmRequest,
  type MadiLlmApi,
  type SaveLlmProviderRequest
} from "../shared/llmIpc";

export type LlmIpcInvoke = (
  channel: string,
  ...arguments_: readonly unknown[]
) => Promise<unknown>;

export function createMadiLlmApi(invoke: LlmIpcInvoke): MadiLlmApi {
  return Object.freeze({
    getStatus: () => invoke(LLM_IPC_CHANNELS.getStatus) as ReturnType<MadiLlmApi["getStatus"]>,
    listProviders: () =>
      invoke(LLM_IPC_CHANNELS.listProviders) as ReturnType<MadiLlmApi["listProviders"]>,
    saveProvider: (request: SaveLlmProviderRequest) =>
      invoke(LLM_IPC_CHANNELS.saveProvider, request) as ReturnType<
        MadiLlmApi["saveProvider"]
      >,
    deleteProvider: (request: DeleteLlmProviderRequest) =>
      invoke(LLM_IPC_CHANNELS.deleteProvider, request) as ReturnType<
        MadiLlmApi["deleteProvider"]
      >,
    invoke: (request: InvokeLlmRequest) =>
      invoke(LLM_IPC_CHANNELS.invoke, request) as ReturnType<MadiLlmApi["invoke"]>,
    cancel: (request: CancelLlmRequest) =>
      invoke(LLM_IPC_CHANNELS.cancel, request) as ReturnType<MadiLlmApi["cancel"]>
  });
}
