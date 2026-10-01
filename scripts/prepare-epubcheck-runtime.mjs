import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseVerifiedToolArchive,
  readVerifiedLocalTool,
  toolTreePath,
  verifyExtractedToolTree,
} from "./epubcheck-tools.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cacheRoot = resolve(repositoryRoot, ".tools", "phase1g-validation");
export const runtimeDirectory = resolve(cacheRoot, "runtime");
export const bundleSha256 =
  "bcabd009a2a10ec70499c1e239bef6c53df9580253cc2a19448d804cbaabcb0c";
const distributions = [
  {
    name: "epubcheck-5.3.0.zip",
    label: "EPUBCheck 5.3.0 distribution",
    bytes: 33_071_108,
    sha256: "6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5",
  },
  {
    name: "temurin-jre-21.0.11+10.zip",
    label: "Eclipse Temurin JRE 21.0.11+10 distribution",
    bytes: 49_005_708,
    sha256: "be26677aaa20b39a62edcaab4c8857a8b76673b0f45abc0b6143b142b62717e4",
  },
];

async function assertOwnedDirectories(directory) {
  const path = resolve(directory);
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error("EPUBCheck preparation directory escaped the repository");
  }
  for (let current = path; ; current = dirname(current)) {
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("EPUBCheck preparation directory must be a real directory");
    }
    if (current === repositoryRoot) break;
  }
}

export async function prepareEpubCheckRuntime() {
  await assertOwnedDirectories(cacheRoot);
  const tree = new Map();
  const contents = new Map();
  for (const distribution of distributions) {
    const bytes = await readVerifiedLocalTool({
      ...distribution,
      path: resolve(cacheRoot, distribution.name),
    });
    const parsed = parseVerifiedToolArchive(bytes, distribution.label);
    for (const [path, entry] of parsed.tree) {
      if (tree.has(path)) throw new Error("EPUBCheck distribution paths overlap");
      tree.set(path, entry);
    }
    for (const entry of parsed.files) contents.set(...entry);
  }
  const files = [...tree]
    .filter(([, entry]) => entry.kind === "file")
    .map(([path, entry]) => ({ path, bytes: entry.bytes, sha256: entry.sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const digest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  if (digest !== bundleSha256) throw new Error("EPUBCheck bundle tree pin mismatch");
  const manifest = {
    schemaVersion: 1,
    epubCheckVersion: "5.3.0",
    javaVersion: "21.0.11+10",
    archives: distributions.map(({ name, sha256 }) => ({ name, sha256 })),
    files,
    bundleSha256,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  tree.set("bundle-manifest.json", {
    kind: "file",
    bytes: manifestBytes.byteLength,
    sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  });
  contents.set("bundle-manifest.json", manifestBytes);
  const result = {
    manifest,
    tree,
    directory: runtimeDirectory,
    fileCount: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    bundleSha256,
  };
  try {
    await lstat(runtimeDirectory);
    await assertOwnedDirectories(runtimeDirectory);
    await verifyExtractedToolTree(runtimeDirectory, tree, "runtime-bundle-verify");
    return result;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const staging = await mkdtemp(resolve(cacheRoot, "runtime-staging-"));
  try {
    for (const [path, entry] of tree) {
      if (entry.kind === "directory") {
        await mkdir(toolTreePath(staging, path, "runtime-bundle"), { recursive: true });
      }
    }
    for (const [path, bytes] of contents) {
      const target = toolTreePath(staging, path, "runtime-bundle");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    await verifyExtractedToolTree(staging, tree, "runtime-bundle-verify");
    await rename(staging, runtimeDirectory);
    return result;
  } finally {
    if (dirname(staging) !== cacheRoot || !staging.startsWith(resolve(cacheRoot, "runtime-staging-"))) {
      throw new Error("EPUBCheck staging cleanup path invalid");
    }
    await assertOwnedDirectories(cacheRoot);
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await prepareEpubCheckRuntime();
  process.stdout.write(`${JSON.stringify({
    bundle: "EPUBCheck 5.3.0 / Temurin JRE 21.0.11+10",
    directory: ".tools/phase1g-validation/runtime",
    fileCount: result.fileCount,
    bytes: result.bytes,
    bundleSha256: result.bundleSha256,
    fullTreeVerified: true,
    runtimeDownload: false,
  }, null, 2)}\n`);
}
