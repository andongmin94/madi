import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
process.env.MADI_PACKAGED_EXE = resolve(
  repositoryRoot,
  "output",
  "madi-win32-x64",
  "madi.exe",
);

await import("./electron-smoke.mjs");
