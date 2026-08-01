import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repositoryRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const packageJsonLink = resolve(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "package.json",
);
const packageJsonPath = await realpath(packageJsonLink);
const electronDirectory = dirname(packageJsonPath);
if (!electronDirectory.startsWith(`${repositoryRoot}${sep}`)) {
  throw new Error("Electron package resolved outside the madi workspace");
}

const electronRequire = createRequire(packageJsonPath);
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const executableName = process.platform === "win32" ? "electron.exe" : "electron";
const executablePath = resolve(
  electronDirectory,
  "dist",
  executableName,
);
const pathFile = resolve(electronDirectory, "path.txt");
const versionFile = resolve(electronDirectory, "dist", "version");

async function isComplete() {
  try {
    const [executable, installedVersion, recordedPath] = await Promise.all([
      stat(executablePath),
      readFile(versionFile, "utf8"),
      readFile(pathFile, "utf8"),
    ]);
    return (
      executable.size > 0 &&
      installedVersion.trim().replace(/^v/, "") === packageJson.version &&
      recordedPath.trim() === executableName
    );
  } catch {
    return false;
  }
}

async function sha256File(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

if (await isComplete()) {
  process.stdout.write(
    `Electron ${packageJson.version} binary integrity: present\n`,
  );
  process.exit(0);
}

const hold = setInterval(() => undefined, 1_000);
try {
  const { downloadArtifact } = electronRequire("@electron/get");
  const checksums = electronRequire("./checksums.json");
  const archiveName =
    `electron-v${packageJson.version}-${process.platform}-${process.arch}.zip`;
  const zipPath = await downloadArtifact({
    version: packageJson.version,
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    checksums,
    force: process.env.MADI_ELECTRON_FORCE_DOWNLOAD === "1",
  });
  const expectedChecksum = checksums[archiveName];
  const actualChecksum = await sha256File(zipPath);
  if (!expectedChecksum || actualChecksum !== expectedChecksum) {
    throw new Error(
      `Electron archive checksum mismatch for ${archiveName}: ` +
        `expected ${expectedChecksum ?? "missing"}, got ${actualChecksum}`,
    );
  }
  const distDirectory = resolve(electronDirectory, "dist");
  await rm(distDirectory, { recursive: true, force: true });
  await mkdir(distDirectory, { recursive: true });
  if (process.platform === "win32") {
    await execFileAsync(
      "tar.exe",
      ["-xf", zipPath, "-C", distDirectory],
      {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  } else {
    const extractZip = electronRequire("extract-zip");
    await extractZip(zipPath, { dir: distDirectory });
  }
  await writeFile(pathFile, executableName, "utf8");
  if (!(await isComplete())) {
    throw new Error(
      `Electron ${packageJson.version} extraction did not produce a complete runtime`,
    );
  }
  process.stdout.write(
    `Electron ${packageJson.version} binary integrity: restored\n`,
  );
} finally {
  clearInterval(hold);
}
