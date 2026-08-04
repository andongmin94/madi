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
const epubExporter = resolve(
  repositoryRoot,
  "crates",
  "madi-export-epub",
  "target",
  "release",
  "madi-export-epub.exe",
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
  {
    source: resolve(repositoryRoot, "docs", "licenses", "BASE64-MIT.txt"),
    name: "BASE64-MIT.txt",
    sha256: "0dd882e53de11566d50f8e8e2d5a651bcf3fabee4987d70f306233cf39094ba7",
  },
  {
    source: resolve(
      repositoryRoot,
      "docs",
      "licenses",
      "BASE64-TEMPFILE-APACHE-2.0.txt",
    ),
    name: "BASE64-TEMPFILE-APACHE-2.0.txt",
    sha256: "a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2",
  },
  {
    source: resolve(repositoryRoot, "docs", "licenses", "IMAGE-MIT.txt"),
    name: "IMAGE-MIT.txt",
    sha256: "c77a4cf9da729987d0fe7ccd811e3bd27393914ddf3d23467c18cc22954513b3",
  },
  {
    source: resolve(
      repositoryRoot,
      "docs",
      "licenses",
      "IMAGE-APACHE-2.0.txt",
    ),
    name: "IMAGE-APACHE-2.0.txt",
    sha256: "0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594",
  },
  {
    source: resolve(repositoryRoot, "docs", "licenses", "QUICK-XML-MIT.txt"),
    name: "QUICK-XML-MIT.txt",
    sha256: "f0cf9b1c62bbe3bd3a69f5f79c7158f513f612b4940a0a812d1db39d605318bc",
  },
  {
    source: resolve(repositoryRoot, "docs", "licenses", "TEMPFILE-MIT.txt"),
    name: "TEMPFILE-MIT.txt",
    sha256: "8b427f5bc501764575e52ba4f9d95673cf8f6d80a86d0d06599852e1a9a20a36",
  },
  {
    source: resolve(repositoryRoot, "docs", "licenses", "ZIP-MIT.txt"),
    name: "ZIP-MIT.txt",
    sha256: "13f16f8435b4242f494f038d761bd99c5af70395aa39274bd287d22c4d35c3b7",
  },
  {
    source: resolve(
      repositoryRoot,
      "docs",
      "licenses",
      "EPUBCHECK-5.3.0-BSD-3-CLAUSE.txt",
    ),
    name: "EPUBCHECK-5.3.0-BSD-3-CLAUSE.txt",
    sha256: "851180aaf3e14dddafb23f62abf46123aa354cc9379c650952073823ee6b128e",
  },
];

if (
  process.platform !== "win32" ||
  dirname(packageDirectory) !== outputRoot
) {
  throw new Error("The unpacked package target must be a Windows output child");
}

await Promise.all([
  stat(desktopDist),
  stat(electronDist),
  stat(sidecar),
  stat(epubExporter),
]);
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
await cp(
  epubExporter,
  resolve(resourcesDirectory, "bin", "madi-export-epub.exe"),
);
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
const epubExporterBytes = await readFile(
  resolve(resourcesDirectory, "bin", "madi-export-epub.exe"),
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
      epubExporter: "resources/bin/madi-export-epub.exe",
      epubExporterBytes: epubExporterBytes.byteLength,
      epubExporterSha256: createHash("sha256")
        .update(epubExporterBytes)
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
        "resources/licenses/BASE64-MIT.txt",
        "resources/licenses/BASE64-TEMPFILE-APACHE-2.0.txt",
        "resources/licenses/IMAGE-MIT.txt",
        "resources/licenses/IMAGE-APACHE-2.0.txt",
        "resources/licenses/QUICK-XML-MIT.txt",
        "resources/licenses/TEMPFILE-MIT.txt",
        "resources/licenses/ZIP-MIT.txt",
        "resources/licenses/EPUBCHECK-5.3.0-BSD-3-CLAUSE.txt",
      ],
    },
    null,
    2,
  )}\n`,
);
