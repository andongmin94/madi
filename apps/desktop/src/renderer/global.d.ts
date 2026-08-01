import type { MadiDesktopApi } from "../shared/contracts";

declare global {
  interface Window {
    readonly madi: MadiDesktopApi;
  }
}

export {};
