import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";

const windowCreated = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {
    constructor(options: unknown) {
      windowCreated(options);
    }

    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    };

    once = vi.fn();
    loadURL = vi.fn().mockResolvedValue(undefined);
  }
}));

import {
  createMainWindow,
  installRuntimeNetworkGuard,
  installRuntimeProcessNetworkBoundary
} from "../src/main/window";

function createSessionStub() {
  return {
    setSpellCheckerLanguages: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() }
  };
}

describe("runtime process network boundary", () => {
  it("installs the exact offline Chromium switches", () => {
    const appendSwitch = vi.fn();

    installRuntimeProcessNetworkBoundary({ appendSwitch });

    expect(appendSwitch.mock.calls).toEqual([
      ["disable-background-networking"],
      ["disable-component-update"],
      ["disable-quic"],
      ["no-proxy-server"],
      [
        "disable-features",
        "CertificateTransparencyComponentUpdater,DialMediaRouteProvider,MediaRouter"
      ]
    ]);
  });

  it("passes disabled built-in spellcheck to BrowserWindow", () => {
    createMainWindow("preload.js", {
      rendererUrl: "madi://app/index.html",
      isDevelopment: false
    });

    expect(windowCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ spellcheck: false })
      })
    );
  });

  it("clears dictionary languages before installing session handlers", () => {
    const electronSession = createSessionStub();

    installRuntimeNetworkGuard(electronSession as unknown as Session, {
      rendererUrl: "madi://app/index.html",
      isDevelopment: false
    });

    expect(electronSession.setSpellCheckerLanguages).toHaveBeenCalledOnce();
    expect(electronSession.setSpellCheckerLanguages).toHaveBeenCalledWith([]);
    const dictionaryCallOrder =
      electronSession.setSpellCheckerLanguages.mock.invocationCallOrder[0]!;
    for (const handler of [
      electronSession.setPermissionRequestHandler,
      electronSession.setPermissionCheckHandler,
      electronSession.webRequest.onBeforeRequest
    ]) {
      expect(handler).toHaveBeenCalledOnce();
      expect(dictionaryCallOrder).toBeLessThan(
        handler.mock.invocationCallOrder[0]!
      );
    }
  });

  it("does not install handlers when dictionary suppression fails", () => {
    const electronSession = createSessionStub();
    electronSession.setSpellCheckerLanguages.mockImplementation(() => {
      throw new Error("dictionary suppression failed");
    });

    expect(() =>
      installRuntimeNetworkGuard(electronSession as unknown as Session, {
        rendererUrl: "madi://app/index.html",
        isDevelopment: false
      })
    ).toThrow("dictionary suppression failed");

    expect(electronSession.setPermissionRequestHandler).not.toHaveBeenCalled();
    expect(electronSession.setPermissionCheckHandler).not.toHaveBeenCalled();
    expect(electronSession.webRequest.onBeforeRequest).not.toHaveBeenCalled();
  });
});
