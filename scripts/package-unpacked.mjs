import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = resolve(repositoryRoot, "output");
const packageDirectory = resolve(outputRoot, "madi-win32-x64");
const resourcesDirectory = resolve(packageDirectory, "resources");
const appDirectory = resolve(resourcesDirectory, "app");
const desktopDist = resolve(repositoryRoot, "apps", "desktop", "dist");
const electronDist = resolve(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
);
const sidecar = resolve(
  repositoryRoot,
  "crates",
  "madi-core",
  "target",
  "release",
  "madi-core.exe",
);
const rustLicenseCopies = [
  {
    source: resolve(repositoryRoot, "docs", "licenses", "SHA2-MIT.txt"),
    name: "SHA2-MIT.txt",
    sha256: "b4eb00df6e2a4d22518fcaa6a2b4646f249b3a3c9814509b22bd2091f1392ff1",
  },
  {
    source: resolve(
      repositoryRoot,
      "docs",
      "licenses",
      "SHA2-APACHE-2.0.txt",
    ),
    name: "SHA2-APACHE-2.0.txt",
    sha256: "a9040321c3712d8fd0b09cf52b17445de04a23a10165049ae187cd39e5c86be5",
  },
  {
    source: resolve(repositoryRoot, "docs", "licenses", "THISERROR-MIT.txt"),
    name: "THISERROR-MIT.txt",
    sha256: "23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3",
  },
  {
    source: resolve(
      repositoryRoot,
      "docs",
      "licenses",
      "THISERROR-APACHE-2.0.txt",
    ),
    name: "THISERROR-APACHE-2.0.txt",
    sha256: "62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a",
  },
];

if (
  process.platform !== "win32" ||
  dirname(packageDirectory) !== outputRoot
) {
  throw new Error("The unpacked package target must be a Windows output child");
}

await Promise.all([stat(desktopDist), stat(electronDist), stat(sidecar)]);
await mkdir(outputRoot, { recursive: true });
await rm(packageDirectory, { recursive: true, force: true });
await cp(electronDist, packageDirectory, {
  recursive: true,
  force: true,
});
await rename(
  resolve(packageDirectory, "electron.exe"),
  resolve(packageDirectory, "madi.exe"),
);

await mkdir(resolve(appDirectory, "dist"), { recursive: true });
await cp(desktopDist, resolve(appDirectory, "dist"), {
  recursive: true,
  force: true,
});
await writeFile(
  resolve(appDirectory, "package.json"),
  `${JSON.stringify(
    {
      name: "madi",
      version: "0.0.1",
      private: true,
      main: "dist/electron/main/index.js",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await mkdir(resolve(resourcesDirectory, "bin"), { recursive: true });
await cp(sidecar, resolve(resourcesDirectory, "bin", "madi-core.exe"));
await mkdir(resolve(resourcesDirectory, "licenses"), { recursive: true });
await Promise.all([
  cp(
    resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
    resolve(resourcesDirectory, "licenses", "THIRD_PARTY_NOTICES.md"),
  ),
  cp(
    resolve(repositoryRoot, "packages", "typie-runtime", "LICENSE"),
    resolve(resourcesDirectory, "licenses", "TYPIE-AGPL-3.0.txt"),
  ),
  cp(
    resolve(
      repositoryRoot,
      "packages",
      "typie-runtime",
      "NANUM_GOTHIC_LICENSE.txt",
    ),
    resolve(resourcesDirectory, "licenses", "NANUM_GOTHIC-OFL-1.1.txt"),
  ),
  cp(
    resolve(
      repositoryRoot,
      "apps",
      "desktop",
      "node_modules",
      "cytoscape",
      "LICENSE",
    ),
    resolve(resourcesDirectory, "licenses", "CYTOSCAPE-MIT.txt"),
  ),
  cp(
    resolve(
      repositoryRoot,
      "apps",
      "desktop",
      "node_modules",
      "@xyflow",
      "react",
      "LICENSE",
    ),
    resolve(resourcesDirectory, "licenses", "REACT-FLOW-MIT.txt"),
  ),
  cp(
    resolve(repositoryRoot, "docs", "licenses", "JSON-CANVAS-MIT.txt"),
    resolve(resourcesDirectory, "licenses", "JSON-CANVAS-MIT.txt"),
  ),
  ...rustLicenseCopies.map(({ source, name }) =>
    cp(source, resolve(resourcesDirectory, "licenses", name)),
  ),
]);

for (const license of rustLicenseCopies) {
  const [sourceBytes, packagedBytes] = await Promise.all([
    readFile(license.source),
    readFile(resolve(resourcesDirectory, "licenses", license.name)),
  ]);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const packagedHash = createHash("sha256")
    .update(packagedBytes)
    .digest("hex");
  if (sourceHash !== license.sha256 || packagedHash !== license.sha256) {
    throw new Error(`Packaged Rust license hash mismatch: ${license.name}`);
  }
}

const executable = resolve(packageDirectory, "madi.exe");
const sidecarBytes = await readFile(
  resolve(resourcesDirectory, "bin", "madi-core.exe"),
);
const executableSize = (await stat(executable)).size;

process.stdout.write(
  `${JSON.stringify(
    {
      packageType: "Windows unpacked",
      output: "output/madi-win32-x64",
      executable: "output/madi-win32-x64/madi.exe",
      executableBytes: executableSize,
      packagedApp: "resources/app",
      sidecar: "resources/bin/madi-core.exe",
      sidecarBytes: sidecarBytes.byteLength,
      sidecarSha256: createHash("sha256")
        .update(sidecarBytes)
        .digest("hex"),
      notices: [
        "resources/licenses/THIRD_PARTY_NOTICES.md",
        "resources/licenses/TYPIE-AGPL-3.0.txt",
        "resources/licenses/NANUM_GOTHIC-OFL-1.1.txt",
        "resources/licenses/CYTOSCAPE-MIT.txt",
        "resources/licenses/REACT-FLOW-MIT.txt",
        "resources/licenses/JSON-CANVAS-MIT.txt",
        "resources/licenses/SHA2-MIT.txt",
        "resources/licenses/SHA2-APACHE-2.0.txt",
        "resources/licenses/THISERROR-MIT.txt",
        "resources/licenses/THISERROR-APACHE-2.0.txt",
      ],
    },
    null,
    2,
  )}\n`,
);
