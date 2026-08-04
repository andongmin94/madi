import { describe, expect, it, vi } from "vitest";
import {
  EpubShutdownCoordinator,
  type EpubShutdownExporter,
  type EpubShutdownService,
  EPUB_SHUTDOWN_RETRY_BASE_DELAY_MS
} from "../src/main/epubShutdownCoordinator";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface Retry {
  readonly callback: () => void;
  readonly delayMs: number;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function createHarness(recoverApplication = vi.fn()) {
  const abortPreparation = vi.fn();
  const requestFinalQuit = vi.fn();
  const retries: Retry[] = [];
  const coordinator = new EpubShutdownCoordinator<
    EpubShutdownService,
    EpubShutdownExporter
  >({
    abortPreparation,
    requestFinalQuit,
    scheduleRetry: (callback, delayMs) => {
      retries.push({ callback, delayMs });
    },
    recoverApplication
  });
  return {
    coordinator,
    abortPreparation,
    requestFinalQuit,
    recoverApplication,
    retries
  };
}

describe("EPUB shutdown coordinator", () => {
  it("waits for will-quit and then starts service and exporter cleanup concurrently", async () => {
    const serviceCleanup = deferred();
    const exporterCleanup = deferred();
    const service = {
      prepareEpubShutdown: vi.fn(() => serviceCleanup.promise)
    };
    const exporter = {
      dispose: vi.fn(() => exporterCleanup.promise)
    };
    const harness = createHarness();
    harness.coordinator.registerService(service);
    harness.coordinator.getOrCreateExporter(() => exporter);

    await Promise.resolve();
    expect(service.prepareEpubShutdown).not.toHaveBeenCalled();
    expect(exporter.dispose).not.toHaveBeenCalled();
    expect(harness.abortPreparation).not.toHaveBeenCalled();

    harness.coordinator.beginShutdown();
    expect(harness.abortPreparation).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(service.prepareEpubShutdown).toHaveBeenCalledTimes(1);
      expect(exporter.dispose).toHaveBeenCalledTimes(1);
    });
    expect(harness.requestFinalQuit).not.toHaveBeenCalled();

    serviceCleanup.resolve();
    exporterCleanup.resolve();
    await vi.waitFor(() => {
      expect(harness.requestFinalQuit).toHaveBeenCalledTimes(1);
    });
    expect(harness.coordinator.isComplete).toBe(true);
    expect(harness.coordinator.isInProgress).toBe(false);
  });

  it("coalesces window release and repeated will-quit callbacks", async () => {
    const cleanup = deferred();
    const service = {
      prepareEpubShutdown: vi.fn(() => cleanup.promise)
    };
    const harness = createHarness();
    harness.coordinator.registerService(service);

    const firstRelease = harness.coordinator.releaseService(service);
    const secondRelease = harness.coordinator.releaseService(service);
    harness.coordinator.beginShutdown();
    harness.coordinator.beginShutdown();

    await vi.waitFor(() => {
      expect(service.prepareEpubShutdown).toHaveBeenCalledTimes(1);
    });
    expect(harness.abortPreparation).toHaveBeenCalledTimes(1);

    cleanup.resolve();
    await Promise.all([firstRelease, secondRelease]);
    await vi.waitFor(() => {
      expect(harness.requestFinalQuit).toHaveBeenCalledTimes(1);
    });

    harness.coordinator.beginShutdown();
    expect(harness.abortPreparation).toHaveBeenCalledTimes(1);
    expect(harness.requestFinalQuit).toHaveBeenCalledTimes(1);
  });

  it("keeps the shutdown gate closed until every concurrent cleanup settles", async () => {
    const exporterCleanup = deferred();
    const service = {
      prepareEpubShutdown: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("service busy"))
        .mockResolvedValue(undefined)
    };
    const exporter = {
      dispose: vi.fn(() => exporterCleanup.promise)
    };
    const harness = createHarness();
    harness.coordinator.registerService(service);
    harness.coordinator.getOrCreateExporter(() => exporter);

    harness.coordinator.beginShutdown();
    await vi.waitFor(() => {
      expect(service.prepareEpubShutdown).toHaveBeenCalledTimes(1);
      expect(exporter.dispose).toHaveBeenCalledTimes(1);
    });
    expect(harness.retries).toHaveLength(0);
    expect(harness.coordinator.isInProgress).toBe(true);

    exporterCleanup.resolve();
    await vi.waitFor(() => {
      expect(harness.retries).toHaveLength(1);
    });
    expect(harness.retries[0]?.delayMs).toBe(
      EPUB_SHUTDOWN_RETRY_BASE_DELAY_MS
    );
    expect(harness.coordinator.isInProgress).toBe(true);

    harness.retries[0]!.callback();
    await vi.waitFor(() => {
      expect(harness.requestFinalQuit).toHaveBeenCalledTimes(1);
    });
    expect(service.prepareEpubShutdown).toHaveBeenCalledTimes(2);
    expect(exporter.dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores duplicate retry callbacks while an attempt is in flight", async () => {
    const secondCleanup = deferred();
    const exporter = {
      dispose: vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("temporary file locked"))
        .mockImplementationOnce(() => secondCleanup.promise)
    };
    const harness = createHarness();
    harness.coordinator.getOrCreateExporter(() => exporter);
    harness.coordinator.beginShutdown();

    await vi.waitFor(() => {
      expect(harness.retries).toHaveLength(1);
    });
    harness.retries[0]!.callback();
    harness.retries[0]!.callback();
    await vi.waitFor(() => {
      expect(exporter.dispose).toHaveBeenCalledTimes(2);
    });
    secondCleanup.resolve();
    await vi.waitFor(() => {
      expect(harness.requestFinalQuit).toHaveBeenCalledTimes(1);
    });
    expect(exporter.dispose).toHaveBeenCalledTimes(2);
  });

  it("preserves a five-time cleanup failure and retires a fresh recovery exporter on the next quit", async () => {
    let cleanupShouldFail = true;
    const retiredExporter = {
      dispose: vi.fn(async () => {
        if (cleanupShouldFail) {
          throw new Error("temporary file locked");
        }
      })
    };
    const freshExporter = {
      dispose: vi.fn(async () => undefined)
    };
    let coordinator!: EpubShutdownCoordinator<
      EpubShutdownService,
      EpubShutdownExporter
    >;
    const recoverApplication = vi.fn(() => {
      expect(coordinator.isInProgress).toBe(false);
      coordinator.getOrCreateExporter(() => freshExporter);
    });
    const harness = createHarness(recoverApplication);
    coordinator = harness.coordinator;
    coordinator.getOrCreateExporter(() => retiredExporter);
    coordinator.beginShutdown();

    for (let index = 0; index < 4; index += 1) {
      await vi.waitFor(() => {
        expect(harness.retries).toHaveLength(index + 1);
      });
      harness.retries[index]!.callback();
    }
    await vi.waitFor(() => {
      expect(recoverApplication).toHaveBeenCalledTimes(1);
    });
    expect(retiredExporter.dispose).toHaveBeenCalledTimes(5);
    expect(freshExporter.dispose).not.toHaveBeenCalled();
    expect(coordinator.isComplete).toBe(false);
    expect(coordinator.isInProgress).toBe(false);

    cleanupShouldFail = false;
    coordinator.beginShutdown();
    await vi.waitFor(() => {
      expect(harness.requestFinalQuit).toHaveBeenCalledTimes(1);
    });
    expect(harness.abortPreparation).toHaveBeenCalledTimes(2);
    expect(retiredExporter.dispose).toHaveBeenCalledTimes(6);
    expect(freshExporter.dispose).toHaveBeenCalledTimes(1);
    expect(coordinator.isComplete).toBe(true);
  });
});
