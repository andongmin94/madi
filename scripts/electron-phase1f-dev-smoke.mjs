import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
delete process.env.MADI_PACKAGED_EXE;
delete process.env.MADI_PHASE1F_FAST_DIAGNOSTIC;
delete process.env.MADI_PHASE1F_PACKAGED_OVERRIDE_CANARY;
process.env.MADI_PHASE1F_MANIFEST = resolve(
  repositoryRoot,
  "output",
  "test-fixtures",
  "phase1f-reader-fixtures.json",
);

await import("./electron-phase1f-smoke.mjs");
