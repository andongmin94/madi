import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
delete process.env.MADI_PACKAGED_EXE;
process.env.MADI_PHASE1E_RELOAD_PROBE = "1";
process.env.MADI_PHASE1E_FIXTURE ??= resolve(
  repositoryRoot,
  "output",
  "test-fixtures",
  "phase1e-scale.madi",
);

await import("./electron-phase1e-smoke.mjs");
