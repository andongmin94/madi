import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCoreBinary } from "../src/main/coreClient";
import { resolveEpubExporterBinary } from "../src/main/epubExportClient";
import { resolveHwpBridgeBinary } from "../src/main/hwpBridgeClient";
import { resolveHwpxExporterBinary } from "../src/main/hwpxExportClient";
import { resolveWindowTarget } from "../src/main/window";
import { resolveAtomicOutputBinary } from "../src/main/atomicOutputClient";

describe("packaged runtime boundary", () => {
  it("always resolves the bundled core before inspecting development overrides", () => {
    const resourcesPath = path.resolve("packaged-resources");
    const maliciousOverride = path.resolve("malicious-core.exe");

    expect(
      resolveCoreBinary({
        appPath: path.resolve("packaged-app"),
        resourcesPath,
        isPackaged: true,
        platform: "win32",
        environment: { MADI_CORE_BIN: maliciousOverride }
      })
    ).toBe(path.join(resourcesPath, "bin", "madi-core.exe"));

    expect(
      resolveCoreBinary({
        appPath: path.resolve("development-app"),
        resourcesPath,
        isPackaged: false,
        platform: "win32",
        environment: { MADI_CORE_BIN: maliciousOverride }
      })
    ).toBe(maliciousOverride);
  });

  it("resolves development sidecars only from their current crate targets", () => {
    const appPath = path.resolve("apps", "desktop");
    const resourcesPath = path.resolve("packaged-resources");

    expect(
      resolveCoreBinary({
        appPath,
        resourcesPath,
        isPackaged: false,
        platform: "win32",
        environment: {}
      })
    ).toBe(path.resolve("crates", "madi-core", "target", "debug", "madi-core.exe"));

    expect(
      resolveEpubExporterBinary({
        appPath,
        resourcesPath,
        isPackaged: false,
        platform: "win32",
        environment: {}
      })
    ).toBe(
      path.resolve(
        "crates",
        "madi-export-epub",
        "target",
        "debug",
        "madi-export-epub.exe"
      )
    );

    expect(
      resolveHwpxExporterBinary({
        appPath,
        resourcesPath,
        isPackaged: false,
        platform: "win32",
        environment: {}
      })
    ).toBe(
      path.resolve(
        "crates",
        "madi-export-hwpx",
        "target",
        "debug",
        "madi-export-hwpx.exe"
      )
    );

    expect(
      resolveHwpBridgeBinary({
        appPath,
        resourcesPath,
        isPackaged: false,
        platform: "win32",
        environment: {}
      })
    ).toBe(
      path.resolve(
        "sidecars",
        "hwp-bridge",
        "bin",
        "Debug",
        "net10.0-windows",
        "win-x86",
        "madi-hwp-bridge.exe"
      )
    );

    expect(
      resolveAtomicOutputBinary({
        appPath,
        resourcesPath,
        isPackaged: false,
        platform: "win32",
        environment: {}
      })
    ).toBe(
      path.resolve(
        "crates",
        "madi-atomic-output",
        "target",
        "debug",
        "madi-atomic-output.exe"
      )
    );
  });

  it("pins the packaged HWPX exporter before inspecting development overrides", () => {
    const resourcesPath = path.resolve("packaged-resources");

    expect(
      resolveHwpxExporterBinary({
        appPath: path.resolve("packaged-app"),
        resourcesPath,
        isPackaged: true,
        platform: "win32",
        environment: {
          MADI_HWPX_EXPORT_BIN: path.resolve("malicious-hwpx-exporter.exe")
        }
      })
    ).toBe(path.join(resourcesPath, "bin", "madi-export-hwpx.exe"));
  });

  it("pins the packaged HWP bridge before inspecting development overrides", () => {
    const resourcesPath = path.resolve("packaged-resources");

    expect(
      resolveHwpBridgeBinary({
        appPath: path.resolve("packaged-app"),
        resourcesPath,
        isPackaged: true,
        platform: "win32",
        environment: {
          MADI_HWP_BRIDGE_BIN: path.resolve("malicious-hwp-bridge.exe")
        }
      })
    ).toBe(
      path.join(
        resourcesPath,
        "bin",
        "hwp-bridge",
        "madi-hwp-bridge.exe"
      )
    );
  });

  it("pins the packaged atomic output helper before inspecting development overrides", () => {
    const resourcesPath = path.resolve("packaged-resources");

    expect(
      resolveAtomicOutputBinary({
        appPath: path.resolve("packaged-app"),
        resourcesPath,
        isPackaged: true,
        platform: "win32",
        environment: {
          MADI_ATOMIC_OUTPUT_BIN: path.resolve("malicious-atomic-output.exe")
        }
      })
    ).toBe(path.join(resourcesPath, "bin", "madi-atomic-output.exe"));
  });

  it("always resolves the packaged renderer before parsing development URLs", () => {
    expect(
      resolveWindowTarget({
        isPackaged: true,
        developmentUrl: "file:///malicious-renderer.html"
      })
    ).toEqual({
      rendererUrl: "madi://app/index.html",
      isDevelopment: false
    });

    expect(
      resolveWindowTarget({
        isPackaged: false,
        developmentUrl: "http://127.0.0.1:5173"
      })
    ).toEqual({
      rendererUrl: "http://127.0.0.1:5173/",
      isDevelopment: true
    });

    expect(() =>
      resolveWindowTarget({
        isPackaged: false,
        developmentUrl: "https://example.invalid"
      })
    ).toThrow("MADI_RENDERER_URL must use a loopback address");
  });
});
