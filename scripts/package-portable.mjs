import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const unsafePayload = /(?:^|\/)(?:\.git|\.env(?:\.[^/]*)?|llm-providers-v1|hwpx-recovery-v1)(?:\/|$)|\.(?:pfx|p12|pem|key|madi(?:\.bak(?:\.previous)?)?)$/iu;

function verify(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameFileIdentity(left, right) {
  return ["dev", "ino", "size", "mtimeNs", "ctimeNs", "birthtimeNs"].every((key) => left[key] === right[key]);
}

async function hashFile(path) {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat({ bigint: true });
    verify(before.isFile(), "PORTABLE_NON_REGULAR_FILE");
    const hash = createHash("sha256");
    for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes);
    verify(sameFileIdentity(before, await handle.stat({ bigint: true })), "PORTABLE_FILE_CHANGED_DURING_HASH");
    const pathState = await lstat(path, { bigint: true });
    verify(!pathState.isSymbolicLink() && sameFileIdentity(before, pathState), "PORTABLE_FILE_IDENTITY_CHANGED");
    verify(before.size <= BigInt(Number.MAX_SAFE_INTEGER), "PORTABLE_FILE_SIZE_INVALID");
    return { bytes: Number(before.size), sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export async function inventoryTree(directory) {
  const root = resolve(directory);
  verify(!(await lstat(root)).isSymbolicLink() && (await lstat(root)).isDirectory(), "PORTABLE_UNSAFE_ROOT");
  verify(await realpath(root) === root, "PORTABLE_ROOT_REDIRECTED");
  await nativeOperation("CHECK_TREE", { MADI_PORTABLE_SOURCE: root });
  const files = [];
  const directories = [];
  const casePaths = new Set();
  async function walk(current, prefix) {
    const names = (await readdir(current)).sort();
    for (const name of names) {
      verify(!/[\\/:*?"<>|]/u.test(name) && !/[. ]$/u.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name), "PORTABLE_UNSAFE_ENTRY_NAME");
      const path = prefix ? `${prefix}/${name}` : name;
      verify(!unsafePayload.test(path), "PORTABLE_PRIVATE_PAYLOAD_REJECTED");
      verify(!casePaths.has(path.toLowerCase()), "PORTABLE_CASE_COLLISION");
      casePaths.add(path.toLowerCase());
      const absolute = join(current, name);
      const entry = await lstat(absolute);
      verify(!entry.isSymbolicLink() && await realpath(absolute) === absolute, "PORTABLE_LINK_OR_REDIRECT_REJECTED");
      if (entry.isDirectory()) {
        directories.push(path);
        await walk(absolute, path);
      } else {
        verify(entry.isFile(), "PORTABLE_NON_REGULAR_ENTRY");
        files.push({ path, ...await hashFile(absolute) });
      }
    }
  }
  await walk(root, "");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  directories.sort();
  return { directories, files };
}

export function assertSameInventory(expected, actual) {
  verify(JSON.stringify(expected) === JSON.stringify(actual), "PORTABLE_TREE_MISMATCH");
}

const nativeZipScript = `
$ErrorActionPreference = 'Stop'
try {
  [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  function Native-Path([string] $path) {
    if ($path.StartsWith('\\\\?\\')) { return $path }
    if ($path.StartsWith('\\\\')) { return ('\\\\?\\UNC\\' + $path.Substring(2)) }
    return ('\\\\?\\' + $path)
  }
  function Assert-NoReparseTree([string] $root) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($root)
    while ($pending.Count -gt 0) {
      $path = $pending.Pop()
      $attributes = [System.IO.File]::GetAttributes($path)
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT' }
      if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
        foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($path)) { $pending.Push($entry) }
      }
    }
  }
  switch ($env:MADI_PORTABLE_OPERATION) {
    'CHECK_TREE' { Assert-NoReparseTree (Native-Path $env:MADI_PORTABLE_SOURCE) }
    'ROUNDTRIP' {
      Assert-NoReparseTree (Native-Path $env:MADI_PORTABLE_SOURCE)
      [System.IO.Compression.ZipFile]::CreateFromDirectory((Native-Path $env:MADI_PORTABLE_SOURCE), (Native-Path $env:MADI_PORTABLE_ZIP), [System.IO.Compression.CompressionLevel]::Optimal, $false)
      [System.IO.Compression.ZipFile]::ExtractToDirectory((Native-Path $env:MADI_PORTABLE_ZIP), (Native-Path $env:MADI_PORTABLE_EXTRACTED))
      Assert-NoReparseTree (Native-Path $env:MADI_PORTABLE_EXTRACTED)
    }
    'COMMIT' {
      Assert-NoReparseTree (Native-Path $env:MADI_PORTABLE_SOURCE)
      [System.IO.Directory]::Move((Native-Path $env:MADI_PORTABLE_SOURCE), (Native-Path $env:MADI_PORTABLE_DESTINATION))
    }
    default { throw 'INVALID_OPERATION' }
  }
  exit 0
} catch { exit 1 }
`;

async function nativeOperation(operation, paths) {
  verify(process.platform === "win32", "PORTABLE_WINDOWS_REQUIRED");
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(nativeZipScript, "utf16le").toString("base64")], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, MADI_PORTABLE_OPERATION: operation, ...paths }
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120_000);
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once("error", () => reject(new Error("PORTABLE_NATIVE_SPAWN_FAILED")));
      child.once("close", resolveExit);
    });
    verify(!timedOut && code === 0, operation === "ROUNDTRIP" ? "PORTABLE_NATIVE_ZIP_FAILED" : operation === "COMMIT" ? "PORTABLE_RELEASE_COMMIT_FAILED" : "PORTABLE_REPARSE_CHECK_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

function sourceState(root) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8", windowsHide: true });
  verify(head.status === 0 && status.status === 0 && /^[0-9a-f]{40}$/u.test(head.stdout.trim()), "PORTABLE_SOURCE_STATE_FAILED");
  return { head: head.stdout.trim(), worktreeDirty: Boolean(status.stdout.trim()), statusSha256: sha256(status.stdout) };
}

async function absent(path) {
  try { await lstat(path); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error("PORTABLE_OUTPUT_ALREADY_EXISTS");
}

async function ownedDirectory(path, parent) {
  const canonical = await realpath(path);
  verify(canonical === resolve(path) && await realpath(parent) === resolve(parent) && dirname(canonical) === resolve(parent) && !(await lstat(path)).isSymbolicLink(), "PORTABLE_WORK_DIRECTORY_UNSAFE");
  return canonical;
}

function readme(version, source, zipName) {
  return `# madi ${version} — Windows x64 portable\n\n` +
    `Extract \`${zipName}\` into a new writable folder, then run \`madi.exe\`. Keep the entire extracted folder together. No installer, administrator permission, or automatic launch is used.\n\n` +
    `The ZIP contains the application files. \`portable-manifest.json\` records their relative paths, byte sizes and SHA-256 hashes; \`SHA256SUMS.txt\` records hashes for the ZIP, manifest and this README.\n\n` +
    `Projects stay in the .madi locations you choose. Provider settings and recovery state use Electron's normal user-data directory, typically \`%APPDATA%\\madi\`; this is separate from the extracted application folder. This ZIP is a portable application payload, not a mode that moves all user data onto removable media.\n\n` +
    `For a manual update, save work and close madi, extract the new ZIP into a separate folder, and launch its madi.exe. Preserve your .madi projects and user-data directory. Do not overwrite a running application. To remove this application copy, close it and delete only its extracted folder; projects and user data remain separate.\n\n` +
    `Repository HEAD at packaging: \`${source.head}\`. Working tree dirty: \`${source.worktreeDirty}\`. This HEAD is a packaging reference, not independent proof that every compiled payload byte was built from that commit; use the matching build/verification receipts.\n\n` +
    `Packaging performs no code signing, public publishing or update-server configuration. Existing manual-validation and distribution approvals remain separate.\n`;
}

export async function createPortableRelease(root = repositoryRoot) {
  const canonicalRoot = await realpath(root);
  const input = resolve(canonicalRoot, "output", "madi-win32-x64");
  const releasesRoot = resolve(canonicalRoot, "output", "releases");
  const beforeSource = sourceState(canonicalRoot);
  const before = await inventoryTree(input);
  verify(before.files.length > 0, "PORTABLE_EMPTY_INPUT");
  for (const required of ["madi.exe", "resources/app/package.json", "resources/app/dist/electron/main/index.js"]) verify(before.files.some((file) => file.path === required), "PORTABLE_INPUT_INCOMPLETE");
  const appBytes = await readFile(join(input, "resources", "app", "package.json"));
  verify(appBytes.length <= 65_536 && sha256(appBytes) === before.files.find((file) => file.path === "resources/app/package.json").sha256, "PORTABLE_INPUT_CHANGED");
  const app = JSON.parse(appBytes.toString("utf8"));
  verify(app.name === "madi" && typeof app.version === "string" && app.version.length <= 64 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(app.version), "PORTABLE_APP_METADATA_INVALID");
  await mkdir(releasesRoot, { recursive: true });
  verify(await realpath(releasesRoot) === releasesRoot && !(await lstat(releasesRoot)).isSymbolicLink(), "PORTABLE_RELEASE_ROOT_UNSAFE");
  const releaseId = `madi-${app.version}-win32-x64-${beforeSource.head}`;
  const destination = join(releasesRoot, releaseId);
  await absent(destination);
  const work = join(releasesRoot, `.portable-work-${randomUUID()}`);
  await mkdir(work);
  try {
    await ownedDirectory(work, releasesRoot);
    const stagedRelease = join(work, "release");
    const extracted = join(work, "extracted");
    await mkdir(stagedRelease);
    const zipName = `${releaseId}.zip`;
    const zipPath = join(stagedRelease, zipName);
    await nativeOperation("ROUNDTRIP", { MADI_PORTABLE_SOURCE: input, MADI_PORTABLE_ZIP: zipPath, MADI_PORTABLE_EXTRACTED: extracted });
    assertSameInventory(before, await inventoryTree(input));
    assertSameInventory(before, await inventoryTree(extracted));
    const afterSource = sourceState(canonicalRoot);
    verify(JSON.stringify(beforeSource) === JSON.stringify(afterSource), "PORTABLE_SOURCE_STATE_CHANGED");
    const archive = await hashFile(zipPath);
    const manifest = {
      schemaVersion: 1, packageType: "Windows x64 portable ZIP", version: app.version,
      source: beforeSource, sourceMeaning: "PACKAGING_HEAD_REFERENCE_NOT_COMPILED_SOURCE_PROOF",
      sourceStateMatchedAfterPackaging: true, archive: { path: zipName, ...archive },
      payloadInventorySha256: sha256(JSON.stringify(before)), directories: before.directories, files: before.files,
      fileCount: before.files.length, directoryCount: before.directories.length,
      totalBytes: before.files.reduce((sum, file) => sum + file.bytes, 0),
      verification: { nativeZipTool: "WINDOWS_DOTNET_ZIPFILE", reparsePointsRejected: true, inputStableAcrossZip: true, freshExtractionPathAndHashMatch: true, hiddenOmissionGuard: "COMPLETE_TREE_ROUNDTRIP_COMPARISON" },
      actions: { appLaunched: false, installed: false, signed: false, published: false }
    };
    const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
    const readmeBytes = readme(app.version, beforeSource, zipName);
    await writeFile(join(stagedRelease, "portable-manifest.json"), manifestBytes, { flag: "wx" });
    await writeFile(join(stagedRelease, "README.md"), readmeBytes, { flag: "wx" });
    const sums = `${archive.sha256}  ${zipName}\n${sha256(manifestBytes)}  portable-manifest.json\n${sha256(readmeBytes)}  README.md\n`;
    await writeFile(join(stagedRelease, "SHA256SUMS.txt"), sums, { flag: "wx" });
    await absent(destination);
    await nativeOperation("COMMIT", { MADI_PORTABLE_SOURCE: stagedRelease, MADI_PORTABLE_DESTINATION: destination });
    return { status: "PORTABLE_LOCAL_ARTIFACT_CREATED", output: `output/releases/${releaseId}`, source: beforeSource, fileCount: manifest.fileCount, directoryCount: manifest.directoryCount, totalBytes: manifest.totalBytes, archiveSha256: archive.sha256, manifestSha256: sha256(manifestBytes), freshExtractionPathAndHashMatch: true };
  } finally {
    const canonicalWork = await ownedDirectory(work, releasesRoot);
    verify(basename(canonicalWork).startsWith(".portable-work-") && !relative(releasesRoot, canonicalWork).startsWith(`..${sep}`), "PORTABLE_WORK_CLEANUP_UNSAFE");
    await rm(canonicalWork, { recursive: true, force: false, maxRetries: 0 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    verify(process.argv.length === 2, "PORTABLE_ARGUMENTS_INVALID");
    process.stdout.write(JSON.stringify(await createPortableRelease()) + "\n");
  } catch (error) {
    const code = typeof error.message === "string" && /^PORTABLE_[A-Z_]+$/u.test(error.message) ? error.message : "PORTABLE_OPERATION_FAILED";
    process.stderr.write(JSON.stringify({ status: "FAIL", code }) + "\n");
    process.exitCode = 1;
  }
}
