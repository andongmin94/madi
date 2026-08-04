import { contextBridge, ipcRenderer } from "electron";
import { createMadiDesktopApi } from "./bridge";

const api = createMadiDesktopApi(
  (channel, ...arguments_) =>
    ipcRenderer.invoke(channel, ...arguments_),
  (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload?: unknown) =>
      listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
);

contextBridge.exposeInMainWorld("madi", api);
