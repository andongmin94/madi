import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

delete process.env.MADI_PACKAGED_EXE;
delete process.env.MADI_PHASE1H_PACKAGED_OVERRIDE_CANARY;
delete process.env.MADI_PHASE1H_FAST_DIAGNOSTIC;
delete process.env.MADI_RENDERER_URL;
delete process.env.MADI_CORE_BIN;
delete process.env.MADI_HWPX_EXPORT_BIN;
delete process.env.MADI_HWP_BRIDGE_BIN;
process.env.MADI_PHASE1H_MANIFEST = resolve(
  repositoryRoot,
  "output",
  "test-fixtures",
  "phase1f-reader-fixtures.json",
);

await import("./electron-phase1h-smoke.mjs");

