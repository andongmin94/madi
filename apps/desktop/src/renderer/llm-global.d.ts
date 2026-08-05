import type { MadiLlmApi } from "../shared/llmIpc";

declare global {
  interface Window {
    readonly madiLlm: MadiLlmApi;
  }
}

export {};
