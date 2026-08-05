import { contextBridge, ipcRenderer } from "electron";
import { createMadiDesktopApi } from "./bridge";
import { createMadiLlmApi } from "./llmBridge";

const invoke = (channel: string, ...arguments_: readonly unknown[]) =>
  ipcRenderer.invoke(channel, ...arguments_);

const api = createMadiDesktopApi(
  invoke,
  (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload?: unknown) =>
      listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
);

contextBridge.exposeInMainWorld("madi", api);
contextBridge.exposeInMainWorld("madiLlm", createMadiLlmApi(invoke));
