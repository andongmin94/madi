// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Protocol } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installMadiAppProtocol,
  resolveAppAssetPath
} from "../src/main/appProtocol";

const temporaryDirectoryPrefix = "madi-app-protocol-";
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== path.resolve(tmpdir()) ||
      !path.basename(directory).startsWith(temporaryDirectoryPrefix)
    ) {
      throw new Error("Protocol test cleanup target is outside its temporary directory");
    }
    await rm(directory, { recursive: true, force: true });
  }
});

async function createRendererFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), temporaryDirectoryPrefix));
  directories.push(directory);
  const rendererDirectory = path.join(directory, "renderer");
  await mkdir(path.join(rendererDirectory, "assets"), { recursive: true });
  return { directory, rendererDirectory };
}

function installedHandler(rendererDirectory: string) {
  const handle = vi.fn<Protocol["handle"]>();
  installMadiAppProtocol({ handle } as unknown as Protocol, rendererDirectory);
  expect(handle).toHaveBeenCalledOnce();
  expect(handle.mock.calls[0]![0]).toBe("madi");
  return handle.mock.calls[0]![1];
}

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
    "madi://app/assets/pretendard.ttf",
    "madi://app/assets/pretendard.woff",
    "madi://app/assets/%2e%2e%2f%2e%2e%2fsecret.js",
    "madi://app/%00index.html"
  ])("rejects an out-of-scope URL: %s", (url) => {
    expect(resolveAppAssetPath(rendererDirectory, url)).toBeUndefined();
  });

  it("serves local WOFF2 bytes with the font MIME type and an empty HEAD body", async () => {
    const fixture = await createRendererFixture();
    const bytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x80, 0xff, 0x01]);
    const fontPath = path.join(fixture.rendererDirectory, "assets", "pretendard.woff2");
    const fontUrl = "madi://app/assets/pretendard.woff2";
    await writeFile(fontPath, bytes);
    expect(resolveAppAssetPath(fixture.rendererDirectory, fontUrl)).toBe(fontPath);

    const handler = installedHandler(fixture.rendererDirectory);
    const getResponse = await handler(new Request(fontUrl));
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("Content-Type")).toBe("font/woff2");
    expect(getResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(getResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await getResponse.arrayBuffer())).toEqual(bytes);

    const headResponse = await handler(new Request(fontUrl, { method: "HEAD" }));
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("Content-Type")).toBe("font/woff2");
    expect(headResponse.body).toBeNull();
    expect((await headResponse.arrayBuffer()).byteLength).toBe(0);
  });

  it("keeps font requests inside the protocol origin, path and asset allowlist", async () => {
    const fixture = await createRendererFixture();
    const bytes = Buffer.from([0x00, 0x80, 0xff]);
    await writeFile(path.join(fixture.rendererDirectory, "assets", "pretendard.woff2"), bytes);
    await writeFile(path.join(fixture.rendererDirectory, "assets", "private.ttf"), bytes);
    await writeFile(path.join(fixture.directory, "outside.woff2"), bytes);
    const handler = installedHandler(fixture.rendererDirectory);

    for (const url of [
      "madi://other/assets/pretendard.woff2",
      "https://app/assets/pretendard.woff2",
      "madi://app/assets/private.ttf",
      "madi://app/assets/missing.woff2",
      "madi://app/assets/%2e%2e%2f%2e%2e%2foutside.woff2"
    ]) {
      const response = await handler(new Request(url));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
  });
});
