import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { delimiter, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const outputRoot = resolve(repositoryRoot, "output");
const fixtureDirectory = resolve(outputRoot, "test-fixtures");
const fixturePath = resolve(fixtureDirectory, "phase1d-scale.madi");
const typieBuildInfo = JSON.parse(
  await readFile(
    resolve(repositoryRoot, "packages", "typie-runtime", "BUILD_INFO.json"),
    "utf8",
  ),
);
const typieCommit = typieBuildInfo.typieCommit;
if (typeof typieCommit !== "string" || !/^[0-9a-f]{40}$/.test(typieCommit)) {
  throw new Error("Typie BUILD_INFO.json does not contain a valid commit");
}

function comparable(path) {
  return process.platform === "win32" ? path.toLocaleLowerCase() : path;
}

function isWithin(path, directory) {
  const candidate = comparable(path);
  const parent = comparable(directory);
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

if (
  dirname(fixturePath) !== fixtureDirectory ||
  dirname(fixtureDirectory) !== outputRoot ||
  !isWithin(fixturePath, outputRoot)
) {
  throw new Error("Phase 1D scale fixture target escaped output/test-fixtures");
}

await mkdir(fixtureDirectory, { recursive: true });
const [canonicalRepositoryRoot, canonicalOutputRoot, canonicalFixtureDirectory] =
  await Promise.all([
    realpath(repositoryRoot),
    realpath(outputRoot),
    realpath(fixtureDirectory),
  ]);
if (
  !isWithin(canonicalOutputRoot, canonicalRepositoryRoot) ||
  !isWithin(canonicalFixtureDirectory, canonicalOutputRoot)
) {
  throw new Error("Phase 1D scale fixture directory resolved outside the repository");
}

async function removeExistingRegularFixture() {
  try {
    const existing = await lstat(fixturePath);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(
        "Refusing to replace a non-regular Phase 1D scale fixture target",
      );
    }
    await unlink(fixturePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

await removeExistingRegularFixture();

const requiredToolchain = "1.97.1-x86_64-pc-windows-msvc";
const localCargoHome = resolve(repositoryRoot, ".tools", "cargo");
const localRustupHome = resolve(repositoryRoot, ".tools", "rustup");
const localToolchainBin = resolve(
  localRustupHome,
  "toolchains",
  "stable-x86_64-pc-windows-msvc",
  "bin",
);
const localToolchainCargo = resolve(localToolchainBin, "cargo.exe");
const localCargo = resolve(localCargoHome, "bin", "cargo.exe");

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

let command = "cargo";
let toolchainArgs = [];
let cargoEnvironment = process.env;
if (process.platform === "win32") {
  if (await fileExists(localToolchainCargo)) {
    command = localToolchainCargo;
    cargoEnvironment = {
      ...process.env,
      CARGO_HOME: localCargoHome,
      RUSTUP_HOME: localRustupHome,
      PATH: `${localToolchainBin}${delimiter}${process.env.PATH ?? ""}`,
    };
  } else if (await fileExists(localCargo)) {
    command = localCargo;
    toolchainArgs = [`+${requiredToolchain}`];
    cargoEnvironment = {
      ...process.env,
      CARGO_HOME: localCargoHome,
      RUSTUP_HOME: localRustupHome,
    };
  } else {
    toolchainArgs = [`+${requiredToolchain}`];
  }
}

const args = [
  ...toolchainArgs,
  "test",
  "--manifest-path",
  resolve(repositoryRoot, "crates", "madi-core", "Cargo.toml"),
  "--test",
  "phase1d_world_graph",
  "export_phase1d_scale_fixture_when_requested",
  "--",
  "--exact",
  "--nocapture",
];

const exitCode = await new Promise((resolveExitCode, reject) => {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: {
      ...cargoEnvironment,
      MADI_PHASE1D_SCALE_FIXTURE_OUTPUT: fixturePath,
      MADI_PHASE1D_TYPIE_COMMIT: typieCommit,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Scale fixture test terminated by ${signal}`));
      return;
    }
    resolveExitCode(code);
  });
});

if (exitCode !== 0) {
  await removeExistingRegularFixture();
  throw new Error(`Phase 1D scale fixture test exited with code ${exitCode}`);
}

const fixtureStats = await stat(fixturePath);
if (!fixtureStats.isFile() || fixtureStats.size === 0) {
  throw new Error("Phase 1D scale fixture was not created as a non-empty file");
}

process.stdout.write(
  `${JSON.stringify(
    {
      fixture: "output/test-fixtures/phase1d-scale.madi",
      bytes: fixtureStats.size,
      entities: 500,
      aliases: 1_500,
      relations: 2_000,
      sceneLinks: 2_000,
      defaultStatuses: ["ACTIVE", "DRAFT"],
      source: "test-only Rust integration fixture",
      typieCommit,
    },
    null,
    2,
  )}\n`,
);
