import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
process.env.MADI_SCALE_FIXTURE = resolve(
  repositoryRoot,
  "output",
  "test-fixtures",
  "phase1d-scale.madi",
);

await import("./electron-smoke.mjs");
