import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppAssetPath } from "../src/main/appProtocol";

describe("madi application protocol", () => {
  const rendererDirectory = path.resolve("dist", "renderer");

  it("maps a known asset type below the renderer root", () => {
    expect(
      resolveAppAssetPath(
        rendererDirectory,
        "madi://app/assets/editor_ffi_bg.wasm"
      )
    ).toBe(
      path.join(
        rendererDirectory,
        "assets",
        "editor_ffi_bg.wasm"
      )
    );
  });

  it.each([
    "file:///C:/Windows/win.ini",
    "madi://other/index.html",
    "madi://app/assets/native.exe",
    "madi://app/assets/%2e%2e%2f%2e%2e%2fsecret.js",
    "madi://app/%00index.html"
  ])("rejects an out-of-scope URL: %s", (url) => {
    expect(resolveAppAssetPath(rendererDirectory, url)).toBeUndefined();
  });
});
