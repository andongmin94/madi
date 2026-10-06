import { createRequire } from "node:module";

const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
if (process.env.MADI_ISOLATED_GATE_RUN_DIR?.trim()) {
  process.argv.splice(2, 0, "--disable-gpu");
}
desktopRequire("electron/cli.js");
