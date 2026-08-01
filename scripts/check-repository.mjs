import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedCommit = "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26";
const allowedTypieDirectory = resolve(
  repositoryRoot,
  "apps",
  "desktop",
  "src",
  "renderer",
  "editor",
  "typie",
);
const sourceRoot = resolve(repositoryRoot, "apps", "desktop", "src");
const coreRoot = resolve(repositoryRoot, "crates", "madi-core", "src");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return paths.flat();
}

function isWithin(path, directory) {
  return path === directory || path.startsWith(`${directory}${sep}`);
}

const forbiddenOutsideAdapter = [
  {
    label: "@madi/typie-runtime package import",
    pattern: /(?:from\s+|import\s*\()(["'])@madi\/typie-runtime(?:\/[^"']*)?\1/,
  },
  {
    label: "generated editor_ffi binding import",
    pattern: /(?:from\s+|import\s*\()(["'])[^"']*editor_ffi[^"']*\1/,
  },
  {
    label: "vendored Typie source import",
    pattern: /(?:from\s+|import\s*\()(["'])[^"']*vendor[\\/]typie[^"']*\1/,
  },
  {
    label: "Typie FFI type",
    pattern:
      /\b(?:FlatImeOp|PlainDoc|PlainNodeEntry|TypieEnginePort|TypieTransactionEvent)\b/,
  },
];

function boundaryViolations(path, source) {
  if (isWithin(path, allowedTypieDirectory)) {
    return [];
  }
  return forbiddenOutsideAdapter
    .filter(({ pattern }) => pattern.test(source))
    .map(({ label }) => `${relative(repositoryRoot, path)}: ${label}`);
}

const boundaryFiles = (await walk(sourceRoot)).filter((path) =>
  /\.(?:ts|tsx|js|jsx)$/.test(path),
);
const boundaryResults = await Promise.all(
  boundaryFiles.map(async (path) =>
    boundaryViolations(path, await readFile(path, "utf8")),
  ),
);
const violations = boundaryResults.flat();

const negativeFixture = boundaryViolations(
  resolve(sourceRoot, "negative-boundary-fixture.ts"),
  'import type { FlatImeOp } from "@madi/typie-runtime/browser/editor_ffi";',
);
if (
  !negativeFixture.some((entry) =>
    entry.includes("@madi/typie-runtime package import"),
  ) ||
  !negativeFixture.some((entry) => entry.includes("Typie FFI type"))
) {
  throw new Error(
    "Adapter boundary negative fixture did not trigger package and FFI gates",
  );
}
if (violations.length > 0) {
  throw new Error(
    `Typie dependency escaped the adapter boundary:\n${violations.join("\n")}`,
  );
}

const coreFiles = (await walk(coreRoot)).filter((path) => path.endsWith(".rs"));
for (const path of coreFiles) {
  const source = await readFile(path, "utf8");
  if (/\btypie::|editor_ffi|vendor[\\/]typie/i.test(source)) {
    throw new Error(
      `Rust storage core directly references Typie internals: ${relative(
        repositoryRoot,
        path,
      )}`,
    );
  }
}

const buildInfoPath = resolve(
  repositoryRoot,
  "packages",
  "typie-runtime",
  "BUILD_INFO.json",
);
const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8"));
if (
  buildInfo.typieCommit !== expectedCommit ||
  buildInfo.typieRepository !== "https://github.com/penxle/typie" ||
  buildInfo.typieLicense !== "AGPL-3.0-only" ||
  buildInfo.sourcePatch?.path !==
    "patches/typie/phase1b-semantic-replace.patch"
) {
  throw new Error("Typie BUILD_INFO pin is invalid");
}

const submoduleConfig = await readFile(
  resolve(repositoryRoot, ".gitmodules"),
  "utf8",
);
if (
  !submoduleConfig.includes("path = vendor/typie") ||
  !submoduleConfig.includes("url = https://github.com/penxle/typie.git")
) {
  throw new Error(".gitmodules does not identify the pinned Typie source");
}

let nestedHead;
let nestedStatus;
try {
  nestedHead = execFileSync(
    "git",
    ["-C", "vendor/typie", "rev-parse", "HEAD"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  ).trim();
  nestedStatus = execFileSync(
    "git",
    ["-C", "vendor/typie", "status", "--porcelain"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  ).trim();
} catch (error) {
  throw new Error(
    `Pinned Typie checkout is unavailable; run scripts/bootstrap-typie.ps1 (${String(
      error,
    )})`,
  );
}
if (nestedHead !== expectedCommit || nestedStatus !== "") {
  throw new Error(
    `Typie checkout must be clean at ${expectedCommit}; found ${nestedHead}`,
  );
}

const sourcePatchPath = resolve(repositoryRoot, buildInfo.sourcePatch.path);
try {
  execFileSync(
    "git",
    ["-C", "vendor/typie", "apply", "--check", sourcePatchPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
} catch (error) {
  throw new Error(
    `Phase 1B Typie patch does not apply to the pinned checkout (${String(error)})`,
  );
}

async function sha256(relativePath) {
  const bytes = await readFile(resolve(repositoryRoot, relativePath));
  return createHash("sha256").update(bytes).digest("hex");
}

const assets = [
  [buildInfo.sourcePatch.path, buildInfo.sourcePatch.sha256],
  [
    "packages/typie-runtime/browser/editor_ffi_bg.wasm",
    buildInfo.wasmSha256,
  ],
  ["packages/typie-runtime/browser/icu.zst", buildInfo.icuSha256],
  [
    "packages/typie-runtime/browser/editor_ffi.js",
    buildInfo.bindings.javascriptSha256,
  ],
  [
    "packages/typie-runtime/browser/editor_ffi.d.ts",
    buildInfo.bindings.typescriptSha256,
  ],
  [
    "packages/typie-runtime/browser/editor_ffi_bg.wasm.d.ts",
    buildInfo.bindings.wasmTypescriptSha256,
  ],
  [
    "packages/typie-runtime/assets/NanumGothic-Regular.base.zst",
    buildInfo.font.baseSha256,
  ],
  [
    "packages/typie-runtime/assets/NanumGothic-Regular.manifest.zst",
    buildInfo.font.manifestSha256,
  ],
  [
    "packages/typie-runtime/assets/NanumGothic-Regular.chunk-0.zst",
    buildInfo.font.chunk0Sha256,
  ],
];
for (const [path, expectedHash] of assets) {
  const actualHash = await sha256(path);
  if (actualHash !== expectedHash) {
    throw new Error(
      `Pinned runtime hash mismatch for ${path}: ${actualHash}`,
    );
  }
}

const hygieneRoots = [
  resolve(repositoryRoot, "apps", "desktop", "src"),
  resolve(repositoryRoot, "scripts"),
  resolve(repositoryRoot, "crates", "madi-core", "src"),
];
const hygieneFiles = (
  await Promise.all(hygieneRoots.map((directory) => walk(directory)))
)
  .flat()
  .filter((path) => /\.(?:ts|tsx|js|mjs|rs)$/.test(path));
for (const path of hygieneFiles) {
  const source = await readFile(path, "utf8");
  if (source.includes("\u0000") || /[ \t]+$/m.test(source)) {
    throw new Error(
      `Source hygiene check failed: ${relative(repositoryRoot, path)}`,
    );
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      typieCommit: expectedCommit,
      nestedCheckoutClean: true,
      artifactHashesVerified: assets.length,
      adapterBoundaryFilesScanned: boundaryFiles.length,
      rustCoreFilesScanned: coreFiles.length,
      negativeBoundaryFixture: "rejected",
      sourceHygieneFilesScanned: hygieneFiles.length,
    },
    null,
    2,
  )}\n`,
);
