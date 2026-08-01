import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC_EVENTS } from "../src/shared/contracts";
import {
  installSafeWindowClose,
  SAFE_WINDOW_CLOSE_AUTHORIZATION_DELAY_MS
} from "../src/main/window";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {}
}));

interface FakeCloseEvent {
  readonly preventDefault: ReturnType<typeof vi.fn>;
}

class FakeWebContents extends EventEmitter {
  destroyed = false;
  readonly send = vi.fn();

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class FakeBrowserWindow extends EventEmitter {
  destroyed = false;
  readonly webContents = new FakeWebContents();
  readonly closeEvents: FakeCloseEvent[] = [];
  readonly close = vi.fn(() => {
    this.emitClose();
  });

  isDestroyed(): boolean {
    return this.destroyed;
  }

  emitClose(): FakeCloseEvent {
    const event = {
      preventDefault: vi.fn()
    };
    this.closeEvents.push(event);
    this.emit("close", event);
    return event;
  }
}

function asBrowserWindow(window: FakeBrowserWindow): BrowserWindow {
  return window as unknown as BrowserWindow;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("safe window close", () => {
  it("returns the approval IPC before destroying the renderer window", () => {
    vi.useFakeTimers();
    const window = new FakeBrowserWindow();
    const safeClose = installSafeWindowClose(asBrowserWindow(window));

    window.emitClose();
    expect(safeClose.complete(true)).toBe(true);
    const duplicate = window.emitClose();

    expect(window.close).not.toHaveBeenCalled();
    expect(duplicate.preventDefault).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SAFE_WINDOW_CLOSE_AUTHORIZATION_DELAY_MS);

    expect(window.close).toHaveBeenCalledTimes(1);
    expect(
      window.closeEvents.at(-1)?.preventDefault
    ).not.toHaveBeenCalled();

    safeClose.dispose();
  });

  it("resets an unanswered pending request after the response timeout", () => {
    vi.useFakeTimers();
    const window = new FakeBrowserWindow();
    const safeClose = installSafeWindowClose(
      asBrowserWindow(window),
      25
    );

    const first = window.emitClose();
    const duplicate = window.emitClose();

    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(duplicate.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      IPC_EVENTS.closeRequested
    );

    vi.advanceTimersByTime(25);
    const retry = window.emitClose();

    expect(retry.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledTimes(2);

    expect(safeClose.complete(false)).toBe(true);
    window.emitClose();
    expect(window.webContents.send).toHaveBeenCalledTimes(3);

    safeClose.dispose();
  });

  it("closes safely when the renderer process is gone", () => {
    vi.useFakeTimers();
    const window = new FakeBrowserWindow();
    const safeClose = installSafeWindowClose(
      asBrowserWindow(window),
      25
    );

    window.emitClose();
    expect(window.webContents.send).toHaveBeenCalledTimes(1);

    window.webContents.emit("render-process-gone");

    expect(window.close).toHaveBeenCalledTimes(1);
    expect(
      window.closeEvents.at(-1)?.preventDefault
    ).not.toHaveBeenCalled();

    vi.advanceTimersByTime(25);
    expect(safeClose.complete(true)).toBe(false);
    expect(window.close).toHaveBeenCalledTimes(1);

    safeClose.dispose();
  });

  it("does not block a close after web contents is already destroyed", () => {
    const window = new FakeBrowserWindow();
    const safeClose = installSafeWindowClose(asBrowserWindow(window));
    window.webContents.destroyed = true;

    const event = window.emitClose();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.webContents.send).not.toHaveBeenCalled();

    safeClose.dispose();
  });
});
