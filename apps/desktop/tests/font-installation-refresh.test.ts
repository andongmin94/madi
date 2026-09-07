import { describe, expect, it, vi } from "vitest";

import { WindowsFontInstallationDetector } from "../src/main/fontInstallation";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Windows font installation refresh", () => {
  it("coalesces concurrent checks but refreshes after a settled result", async () => {
    const first = deferred<boolean | null>();
    const inspect = vi
      .fn<(fontFamily: string) => Promise<boolean | null>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(true);
    const detector = new WindowsFontInstallationDetector("win32");
    Object.assign(detector, { inspect });

    const firstCheck = detector.isInstalled("함초롬바탕");
    const duplicateCheck = detector.isInstalled("함초롬바탕");

    expect(inspect).toHaveBeenCalledTimes(1);
    expect(duplicateCheck).toBe(firstCheck);

    first.resolve(false);
    await expect(firstCheck).resolves.toBe(false);
    await expect(duplicateCheck).resolves.toBe(false);

    await expect(detector.isInstalled("함초롬바탕")).resolves.toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
  });
});
