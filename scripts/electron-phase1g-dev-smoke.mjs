import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

delete process.env.MADI_PACKAGED_EXE;
delete process.env.MADI_PHASE1G_PACKAGED_OVERRIDE_CANARY;
delete process.env.MADI_PHASE1G_FAST_DIAGNOSTIC;
process.env.MADI_PHASE1G_MANIFEST = resolve(
  repositoryRoot,
  "output",
  "test-fixtures",
  "phase1f-reader-fixtures.json",
);

await import("./electron-phase1g-smoke.mjs");
