import path from "node:path";
import { describe, expect, it } from "vitest";

import { ProcessHwpBridge } from "../src/main/hwpBridgeClient";

describe("HWP bridge Promise contract", () => {
  it("returns a rejected Promise for an invalid conversion operation id", async () => {
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    const input = path.resolve("publication.hwpx");
    const output = path.resolve("publication.hwp");
    let pending: ReturnType<ProcessHwpBridge["convert"]> | undefined;

    expect(() => {
      pending = bridge.convert("../invalid", input, output);
    }).not.toThrow();

    await expect(pending).rejects.toThrow("Invalid HWP bridge operation id");
    await bridge.dispose();
  });

  it("returns a rejected Promise for an invalid reopen path", async () => {
    const bridge = new ProcessHwpBridge("fixture-hwp-bridge.exe");
    let pending: ReturnType<ProcessHwpBridge["reopen"]> | undefined;

    expect(() => {
      pending = bridge.reopen(
        "123e4567-e89b-42d3-a456-426614174000",
        "relative-document.hwp"
      );
    }).not.toThrow();

    await expect(pending).rejects.toThrow("Invalid HWP bridge reopen path");
    await bridge.dispose();
  });
});
