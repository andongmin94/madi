import { afterEach, describe, expect, it, vi } from "vitest";

interface QuitEvent {
  readonly preventDefault: ReturnType<typeof vi.fn>;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface CapturedIpcOptions {
  readonly onCloseReady: (readyToClose: boolean) => boolean;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("EPUB shutdown main lifecycle", () => {
  it("installs the process network boundary before readiness and quits after the last window closes", async () => {
    const appHandlers = new Map<string, (event?: QuitEvent) => void>();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const appCommandLine = { appendSwitch: vi.fn() };
    const appWhenReady = vi.fn(() => ready);
    const installRuntimeProcessNetworkBoundary = vi.fn();
    const appQuit = vi.fn();
    const coreDispose = vi.fn();
    const serviceCleanup = deferred();
    const exporterCleanup = deferred();
    const prepareEpubShutdown = vi.fn(() => serviceCleanup.promise);
    const disposeExporter = vi.fn(() => exporterCleanup.promise);
    const initializeHwpxRecovery = vi.fn(async () => undefined);
    const services: FakeDesktopService[] = [];
    const exporters: FakeEpubExporter[] = [];
    let registeredIpcOptions: CapturedIpcOptions | undefined;
    let openWindowCount = 1;
    const getAllWindows = vi.fn(() =>
      Array.from({ length: openWindowCount }, () => ({}))
    );
    const safeCloseComplete = vi.fn((readyToClose: boolean) => readyToClose);
    const nextTurnCallbacks: Array<() => void> = [];
    const scheduleNextTurn = vi.fn((callback: () => void) => {
      nextTurnCallbacks.push(callback);
      return 1 as unknown as NodeJS.Immediate;
    });

    class FakeCoreClient {
      readonly dispose = coreDispose;
    }

    class FakeDesktopService {
      readonly prepareEpubShutdown = prepareEpubShutdown;

      constructor(..._args: unknown[]) {
        services.push(this);
      }
    }

    class FakeEpubExporter {
      readonly dispose = disposeExporter;

      constructor(..._args: unknown[]) {
        exporters.push(this);
      }
    }

    class FakeHwpxCrashRecoveryRegistry {
      readonly initialize = initializeHwpxRecovery;

      constructor(..._args: unknown[]) {}
    }

    vi.stubGlobal("setImmediate", scheduleNextTurn);
    vi.doMock("electron", () => ({
      app: {
        commandLine: appCommandLine,
        enableSandbox: vi.fn(),
        getAppPath: vi.fn(() => "C:/madi"),
        getPath: vi.fn(() => "C:/madi-user-data"),
        getVersion: vi.fn(() => "0.0.1"),
        isPackaged: false,
        on: vi.fn(
          (eventName: string, callback: (event?: QuitEvent) => void) => {
            appHandlers.set(eventName, callback);
          }
        ),
        quit: appQuit,
        whenReady: appWhenReady
      },
      BrowserWindow: { getAllWindows },
      dialog: { showErrorBox: vi.fn() },
      ipcMain: {},
      protocol: { registerSchemesAsPrivileged: vi.fn() },
      session: { defaultSession: {} },
      shell: {}
    }));
    vi.doMock("../src/main/appProtocol", () => ({
      installMadiAppProtocol: vi.fn()
    }));
    vi.doMock("../src/main/coreClient", () => ({
      JsonRpcCoreClient: FakeCoreClient,
      resolveCoreBinary: vi.fn(() => "C:/madi/madi-core.exe")
    }));
    vi.doMock("../src/main/desktopService", () => ({
      DesktopService: FakeDesktopService
    }));
    vi.doMock("../src/main/epubExportClient", () => ({
      ProcessEpubExporter: FakeEpubExporter,
      resolveEpubExporterBinary: vi.fn(
        () => "C:/madi/madi-export-epub.exe"
      )
    }));
    vi.doMock("../src/main/hwpxCrashRecovery", () => ({
      FileHwpxCrashRecoveryRegistry: FakeHwpxCrashRecoveryRegistry
    }));
    vi.doMock("../src/main/ipc", () => ({
      registerMadiIpc: vi.fn((options: CapturedIpcOptions) => {
        registeredIpcOptions = options;
        return vi.fn();
      })
    }));
    vi.doMock("../src/main/projectSessions", () => ({
      ProjectSessionRegistry: class ProjectSessionRegistry {}
    }));
    vi.doMock("../src/main/window", () => ({
      createMainWindow: vi.fn(() => ({ once: vi.fn() })),
      installRuntimeNetworkGuard: vi.fn(),
      installRuntimeProcessNetworkBoundary,
      installSafeWindowClose: vi.fn(() => ({
        complete: safeCloseComplete,
        dispose: vi.fn()
      })),
      resolveRendererDirectory: vi.fn(() => "C:/madi/renderer"),
      resolveWindowTarget: vi.fn(() => ({
        isDevelopment: true,
        rendererUrl: "http://127.0.0.1:5173"
      }))
    }));

    await import("../src/main/index");
    expect(installRuntimeProcessNetworkBoundary).toHaveBeenCalledTimes(1);
    expect(installRuntimeProcessNetworkBoundary).toHaveBeenCalledWith(
      appCommandLine
    );
    expect(
      installRuntimeProcessNetworkBoundary.mock.invocationCallOrder[0]
    ).toBeLessThan(appWhenReady.mock.invocationCallOrder[0]!);
    resolveReady();
    await vi.waitFor(() => {
      expect(services).toHaveLength(1);
      expect(exporters).toHaveLength(1);
    });
    expect(initializeHwpxRecovery).toHaveBeenCalledTimes(1);

    const windowAllClosed = appHandlers.get("window-all-closed");
    const willQuit = appHandlers.get("will-quit");
    const onCloseReady = registeredIpcOptions?.onCloseReady;
    if (!windowAllClosed || !willQuit || !onCloseReady) {
      throw new Error("Application shutdown handlers were not registered");
    }

    expect(onCloseReady(false)).toBe(false);
    expect(safeCloseComplete).toHaveBeenLastCalledWith(false);
    expect(scheduleNextTurn).not.toHaveBeenCalled();
    expect(prepareEpubShutdown).not.toHaveBeenCalled();
    expect(disposeExporter).not.toHaveBeenCalled();

    expect(onCloseReady(true)).toBe(true);
    expect(onCloseReady(true)).toBe(true);
    expect(scheduleNextTurn).toHaveBeenCalledTimes(1);
    expect(nextTurnCallbacks).toHaveLength(1);
    expect(scheduleNextTurn.mock.invocationCallOrder[0]).toBeLessThan(
      safeCloseComplete.mock.invocationCallOrder[1]!
    );
    expect(prepareEpubShutdown).not.toHaveBeenCalled();
    expect(disposeExporter).not.toHaveBeenCalled();
    expect(coreDispose).not.toHaveBeenCalled();
    expect(appQuit).not.toHaveBeenCalled();

    const incompleteEvent = { preventDefault: vi.fn() };
    willQuit(incompleteEvent);
    expect(incompleteEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(scheduleNextTurn).toHaveBeenCalledTimes(1);
    expect(prepareEpubShutdown).not.toHaveBeenCalled();
    expect(disposeExporter).not.toHaveBeenCalled();
    expect(appQuit).not.toHaveBeenCalled();

    nextTurnCallbacks[0]!();
    await vi.waitFor(() => {
      expect(prepareEpubShutdown).toHaveBeenCalledTimes(1);
      expect(disposeExporter).toHaveBeenCalledTimes(1);
    });
    expect(coreDispose).toHaveBeenCalledTimes(1);
    expect(appQuit).not.toHaveBeenCalled();

    serviceCleanup.resolve();
    await Promise.resolve();
    expect(appQuit).not.toHaveBeenCalled();

    exporterCleanup.resolve();
    await vi.waitFor(() => {
      expect(getAllWindows).toHaveBeenCalledTimes(1);
    });
    expect(appQuit).not.toHaveBeenCalled();

    openWindowCount = 0;
    windowAllClosed();
    expect(appQuit).toHaveBeenCalledTimes(1);

    const completeEvent = { preventDefault: vi.fn() };
    willQuit(completeEvent);
    expect(completeEvent.preventDefault).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(scheduleNextTurn).toHaveBeenCalledTimes(1);
    expect(prepareEpubShutdown).toHaveBeenCalledTimes(1);
    expect(disposeExporter).toHaveBeenCalledTimes(1);
    expect(coreDispose).toHaveBeenCalledTimes(1);
    expect(appQuit).toHaveBeenCalledTimes(1);
  });
});
