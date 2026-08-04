export interface EpubShutdownService {
  prepareEpubShutdown(): Promise<void>;
}

export interface EpubShutdownExporter {
  dispose(): Promise<void>;
}

export interface EpubShutdownCoordinatorOptions {
  readonly abortPreparation: () => void;
  readonly requestFinalQuit: () => void;
  readonly scheduleRetry: (
    callback: () => void,
    delayMs: number
  ) => void;
  readonly recoverApplication: () => void;
}

export const EPUB_SHUTDOWN_MAX_ATTEMPTS = 5;
export const EPUB_SHUTDOWN_RETRY_BASE_DELAY_MS = 250;

export class EpubShutdownCoordinator<
  Service extends EpubShutdownService,
  Exporter extends EpubShutdownExporter
> {
  private readonly services = new Set<Service>();
  private readonly retiredExporters = new Set<Exporter>();
  private readonly serviceShutdowns = new Map<Service, Promise<void>>();
  private readonly exporterShutdowns = new Map<Exporter, Promise<void>>();
  private activeExporter: Exporter | undefined;
  private shutdownInProgress = false;
  private shutdownComplete = false;
  private attemptInFlight = false;
  private failedAttempts = 0;
  private retryGeneration = 0;

  public constructor(
    private readonly options: EpubShutdownCoordinatorOptions
  ) {}

  public get isInProgress(): boolean {
    return this.shutdownInProgress;
  }

  public get isComplete(): boolean {
    return this.shutdownComplete;
  }

  public registerService(service: Service): void {
    if (this.shutdownInProgress || this.shutdownComplete) {
      throw new Error("Cannot register a service while madi is shutting down");
    }
    this.services.add(service);
  }

  public releaseService(service: Service): Promise<void> {
    if (!this.services.has(service)) {
      return Promise.resolve();
    }
    return this.shutdownService(service);
  }

  public getOrCreateExporter(factory: () => Exporter): Exporter {
    if (this.shutdownInProgress || this.shutdownComplete) {
      throw new Error("Cannot create an exporter while madi is shutting down");
    }
    this.activeExporter ??= factory();
    return this.activeExporter;
  }

  public beginShutdown(): void {
    if (this.shutdownInProgress || this.shutdownComplete) {
      return;
    }
    this.shutdownInProgress = true;
    this.failedAttempts = 0;
    this.retryGeneration += 1;
    this.options.abortPreparation();
    if (this.activeExporter) {
      this.retiredExporters.add(this.activeExporter);
      this.activeExporter = undefined;
    }
    void this.runAttempt();
  }

  private shutdownService(service: Service): Promise<void> {
    const existing = this.serviceShutdowns.get(service);
    if (existing) {
      return existing;
    }
    let pending!: Promise<void>;
    pending = Promise.resolve()
      .then(() => service.prepareEpubShutdown())
      .then(() => {
        this.services.delete(service);
      })
      .finally(() => {
        if (this.serviceShutdowns.get(service) === pending) {
          this.serviceShutdowns.delete(service);
        }
      });
    this.serviceShutdowns.set(service, pending);
    return pending;
  }

  private shutdownExporter(exporter: Exporter): Promise<void> {
    const existing = this.exporterShutdowns.get(exporter);
    if (existing) {
      return existing;
    }
    let pending!: Promise<void>;
    pending = Promise.resolve()
      .then(() => exporter.dispose())
      .then(() => {
        this.retiredExporters.delete(exporter);
      })
      .finally(() => {
        if (this.exporterShutdowns.get(exporter) === pending) {
          this.exporterShutdowns.delete(exporter);
        }
      });
    this.exporterShutdowns.set(exporter, pending);
    return pending;
  }

  private async runAttempt(): Promise<void> {
    if (
      !this.shutdownInProgress ||
      this.shutdownComplete ||
      this.attemptInFlight
    ) {
      return;
    }
    this.attemptInFlight = true;
    const tasks = [
      ...[...this.services].map((service) =>
        this.shutdownService(service)
      ),
      ...[...this.retiredExporters].map((exporter) =>
        this.shutdownExporter(exporter)
      )
    ];
    const results = await Promise.allSettled(tasks);
    this.attemptInFlight = false;

    if (results.every((result) => result.status === "fulfilled")) {
      this.shutdownComplete = true;
      this.shutdownInProgress = false;
      this.retryGeneration += 1;
      this.options.requestFinalQuit();
      return;
    }

    this.failedAttempts += 1;
    if (this.failedAttempts >= EPUB_SHUTDOWN_MAX_ATTEMPTS) {
      this.shutdownInProgress = false;
      this.failedAttempts = 0;
      this.retryGeneration += 1;
      this.options.recoverApplication();
      return;
    }

    const generation = ++this.retryGeneration;
    this.options.scheduleRetry(() => {
      if (
        this.shutdownInProgress &&
        !this.shutdownComplete &&
        this.retryGeneration === generation
      ) {
        void this.runAttempt();
      }
    }, this.failedAttempts * EPUB_SHUTDOWN_RETRY_BASE_DELAY_MS);
  }
}
