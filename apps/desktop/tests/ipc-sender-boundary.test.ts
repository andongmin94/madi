import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { describe, expect, it } from "vitest";

import { isTrustedIpcSender } from "../src/main/ipc";

interface FrameLike {
  readonly url: string;
}

interface WebContentsLike {
  readonly mainFrame: FrameLike;
}

function harness(rendererUrl: string, actualUrl = rendererUrl) {
  const mainFrame: FrameLike = { url: actualUrl };
  const webContents: WebContentsLike = { mainFrame };
  const window = {
    isDestroyed: () => false,
    webContents
  } as unknown as BrowserWindow;
  const event = {
    sender: webContents,
    senderFrame: mainFrame
  } as unknown as IpcMainInvokeEvent;
  return { event, mainFrame, webContents, window };
}

describe("main IPC sender boundary", () => {
  it("accepts only the current packaged main frame and ignores query/hash", () => {
    const value = harness(
      "madi://app/index.html",
      "madi://app/index.html?view=editor#selection"
    );

    expect(
      isTrustedIpcSender(value.event, value.window, "madi://app/index.html")
    ).toBe(true);
  });

  it("rejects a subframe even when it reports the trusted URL", () => {
    const value = harness("madi://app/index.html");
    const subframe = { url: "madi://app/index.html" };
    const event = {
      sender: value.webContents,
      senderFrame: subframe
    } as unknown as IpcMainInvokeEvent;

    expect(
      isTrustedIpcSender(event, value.window, "madi://app/index.html")
    ).toBe(false);
  });

  it("rejects another webContents even when its frame identity is forged", () => {
    const value = harness("madi://app/index.html");
    const event = {
      sender: { mainFrame: value.mainFrame },
      senderFrame: value.mainFrame
    } as unknown as IpcMainInvokeEvent;

    expect(
      isTrustedIpcSender(event, value.window, "madi://app/index.html")
    ).toBe(false);
  });

  it("requires the exact development origin and pathname", () => {
    const accepted = harness(
      "http://127.0.0.1:5173/",
      "http://127.0.0.1:5173/?hmr=1#root"
    );
    const otherPath = harness(
      "http://127.0.0.1:5173/",
      "http://127.0.0.1:5173/other"
    );
    const otherPort = harness(
      "http://127.0.0.1:5173/",
      "http://127.0.0.1:5174/"
    );

    expect(
      isTrustedIpcSender(
        accepted.event,
        accepted.window,
        "http://127.0.0.1:5173/"
      )
    ).toBe(true);
    expect(
      isTrustedIpcSender(
        otherPath.event,
        otherPath.window,
        "http://127.0.0.1:5173/"
      )
    ).toBe(false);
    expect(
      isTrustedIpcSender(
        otherPort.event,
        otherPort.window,
        "http://127.0.0.1:5173/"
      )
    ).toBe(false);
  });

  it("rejects all IPC once the owning window is destroyed", () => {
    const value = harness("madi://app/index.html");
    const window = {
      isDestroyed: () => true,
      webContents: value.webContents
    } as unknown as BrowserWindow;

    expect(
      isTrustedIpcSender(value.event, window, "madi://app/index.html")
    ).toBe(false);
  });
});
