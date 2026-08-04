import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { CoreSidecarClient } from "./lib/core-sidecar-test.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(repositoryRoot, "output");
const fixtureDirectory = resolve(outputRoot, "test-fixtures");
const manifestPath = resolve(
  fixtureDirectory,
  "phase1f-reader-fixtures.json",
);
const specifications = {
  normal: {
    relativePath: "output/test-fixtures/phase1f-reader-normal.madi",
    path: resolve(fixtureDirectory, "phase1f-reader-normal.madi"),
    volumes: 2,
    chapters: 20,
    scenes: 60,
    charactersPerScene: 3_000,
  },
  long: {
    relativePath: "output/test-fixtures/phase1f-reader-long.madi",
    path: resolve(fixtureDirectory, "phase1f-reader-long.madi"),
    volumes: 10,
    chapters: 150,
    scenes: 450,
    charactersPerScene: 1_500,
  },
};

function verify(condition, code) {
  if (!condition) {
    throw new Error(code);
  }
}

function comparable(path) {
  return process.platform === "win32" ? path.toLocaleLowerCase() : path;
}

function isWithin(path, directory) {
  const candidate = comparable(path);
  const parent = comparable(directory);
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

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

async function removeRegularFile(path) {
  verify(isWithin(path, fixtureDirectory), "phase1f-fixture-delete-scope");
  try {
    const entry = await lstat(path);
    verify(entry.isFile() && !entry.isSymbolicLink(), "phase1f-fixture-delete-type");
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function measurementSummary(samples) {
  verify(samples.length === 5, "phase1f-compile-sample-count");
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    runs: samples.length,
    samplesMs: samples.map((sample) => Number(sample.toFixed(2))),
    medianMs: Number(ordered[2].toFixed(2)),
    maxMs: Number(ordered[4].toFixed(2)),
  };
}

function expectedScope(specification, scopeKind) {
  const chaptersPerVolume = specification.chapters / specification.volumes;
  const scenesPerChapter = specification.scenes / specification.chapters;
  const sections =
    scopeKind === "WORK"
      ? specification.scenes
      : scopeKind === "VOLUME"
        ? chaptersPerVolume * scenesPerChapter
        : scopeKind === "CHAPTER"
          ? scenesPerChapter
          : 1;
  const chapters =
    scopeKind === "WORK"
      ? specification.chapters
      : scopeKind === "VOLUME"
        ? chaptersPerVolume
        : 1;
  const volumes = scopeKind === "WORK" ? specification.volumes : 1;
  const hierarchyBlocks = 1 + volumes + chapters + sections;
  return {
    sections,
    blocks: sections * 4 + hierarchyBlocks,
    withSpaces: sections * specification.charactersPerScene,
    paragraphs: sections * 3,
    chapters,
  };
}

function blockSource(block) {
  verify(block && typeof block === "object", "phase1f-block-shape");
  verify(block.source && typeof block.source === "object", "phase1f-source-shape");
  return block.source;
}

function structuralScopeEvidence(result, expected, scopeNodeId, scopeKind) {
  verify(result?.document?.scopeKind === scopeKind, "phase1f-scope-kind");
  verify(result.document.scopeNodeId === scopeNodeId, "phase1f-scope-node");
  verify(result.revision === result.metadata?.revision, "phase1f-scope-revision");
  verify(result.document.sections.length === expected.sections, "phase1f-scope-sections");
  const blocks = result.document.sections.reduce(
    (total, section) => total + section.blocks.length,
    0,
  );
  verify(blocks === expected.blocks, "phase1f-scope-blocks");
  verify(result.document.stats.withSpaces === expected.withSpaces, "phase1f-scope-characters");
  verify(result.document.stats.paragraphCount === expected.paragraphs, "phase1f-scope-paragraphs");
  verify(result.document.stats.chapterCount === expected.chapters, "phase1f-scope-chapters");
  verify(result.diagnostics.length === 0, "phase1f-scope-diagnostics");
  const firstBody = result.document.sections
    .flatMap((section) => section.blocks)
    .find((block) => block.kind === "PARAGRAPH");
  verify(firstBody, "phase1f-first-body");
  const source = blockSource(firstBody);
  verify(source.rangeVerified === true, "phase1f-first-body-range");
  return {
    scopeNodeId,
    scopeKind,
    sections: expected.sections,
    blocks,
    withSpaces: result.document.stats.withSpaces,
    withoutSpaces: result.document.stats.withoutSpaces,
    paragraphs: result.document.stats.paragraphCount,
    chapters: result.document.stats.chapterCount,
    contentHash: result.content_hash,
    firstBody: {
      id: firstBody.id,
      sourceBlockId: source.blockId,
      sceneNodeId: source.sceneNodeId,
      documentId: source.documentId,
      start: source.start,
      end: source.end,
      rangeVerified: source.rangeVerified,
    },
  };
}

async function run(command, args, environment) {
  const exitCode = await new Promise((resolveExitCode, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`phase1f-fixture-process-signal-${signal}`));
        return;
      }
      resolveExitCode(code);
    });
  });
  verify(exitCode === 0, `phase1f-fixture-process-exit-${String(exitCode)}`);
}

verify(dirname(fixtureDirectory) === outputRoot, "phase1f-fixture-directory-shape");
for (const specification of Object.values(specifications)) {
  verify(dirname(specification.path) === fixtureDirectory, "phase1f-fixture-target-shape");
}
await mkdir(fixtureDirectory, { recursive: true });
const [canonicalRepository, canonicalOutput, canonicalFixtureDirectory] =
  await Promise.all([
    realpath(repositoryRoot),
    realpath(outputRoot),
    realpath(fixtureDirectory),
  ]);
verify(isWithin(canonicalOutput, canonicalRepository), "phase1f-output-scope");
verify(
  isWithin(canonicalFixtureDirectory, canonicalOutput),
  "phase1f-fixture-directory-scope",
);
for (const specification of Object.values(specifications)) {
  for (const suffix of ["", ".bak", ".bak.previous"]) {
    await removeRegularFile(`${specification.path}${suffix}`);
  }
}
await removeRegularFile(manifestPath);

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
const manifest = resolve(repositoryRoot, "crates", "madi-core", "Cargo.toml");
try {
  await run(
    command,
    [
      ...toolchainArgs,
      "test",
      "--manifest-path",
      manifest,
      "--test",
      "phase1f_reader_fixtures",
      "export_phase1f_reader_fixtures_when_requested",
      "--",
      "--exact",
      "--nocapture",
    ],
    {
      ...cargoEnvironment,
      MADI_PHASE1F_READER_FIXTURE_DIRECTORY: fixtureDirectory,
    },
  );
  await run(
    command,
    [...toolchainArgs, "build", "--manifest-path", manifest, "--bin", "madi-core"],
    cargoEnvironment,
  );

  const evidence = { formatVersion: 1, fixtures: {} };
  for (const [label, specification] of Object.entries(specifications)) {
    const file = await stat(specification.path);
    verify(file.isFile() && file.size > 0, "phase1f-fixture-file");
    const ids = {
      workId: `phase1f-${label}-work`,
      volumeId: `phase1f-${label}-volume-000`,
      chapterId: `phase1f-${label}-chapter-000`,
      sceneId: `phase1f-${label}-scene-000`,
      documentId: `phase1f-${label}-document-000`,
    };
    const client = new CoreSidecarClient(`phase1f-${label}`, {
      timeoutMs: 300_000,
    });
    try {
      const opened = await client.request("open_project", {
        file_path: specification.path,
      });
      verify(opened.metadata.project_id === `phase1f-${label}-project`, "phase1f-project-id");
      verify(opened.metadata.revision === 1, "phase1f-project-revision");
      const workSamples = [];
      let workResult;
      for (let runIndex = 0; runIndex < 5; runIndex += 1) {
        const started = performance.now();
        const result = await client.request("compile_publication", {
          file_path: specification.path,
          scope_node_id: ids.workId,
          expected_revision: opened.metadata.revision,
        });
        workSamples.push(performance.now() - started);
        if (workResult) {
          verify(result.content_hash === workResult.content_hash, "phase1f-work-hash-determinism");
        } else {
          workResult = result;
        }
      }
      const scopes = {
        WORK: structuralScopeEvidence(
          workResult,
          expectedScope(specification, "WORK"),
          ids.workId,
          "WORK",
        ),
      };
      for (const [scopeKind, scopeNodeId] of [
        ["VOLUME", ids.volumeId],
        ["CHAPTER", ids.chapterId],
        ["SCENE", ids.sceneId],
      ]) {
        const result = await client.request("compile_publication", {
          file_path: specification.path,
          scope_node_id: scopeNodeId,
          expected_revision: opened.metadata.revision,
        });
        scopes[scopeKind] = structuralScopeEvidence(
          result,
          expectedScope(specification, scopeKind),
          scopeNodeId,
          scopeKind,
        );
      }
      evidence.fixtures[label] = {
        relativePath: specification.relativePath,
        bytes: file.size,
        sha256: await sha256File(specification.path),
        projectId: opened.metadata.project_id,
        revision: opened.metadata.revision,
        ids,
        inventory: {
          volumes: specification.volumes,
          chapters: specification.chapters,
          scenes: specification.scenes,
          characters: specification.scenes * specification.charactersPerScene,
          paragraphs: specification.scenes * 3,
          sceneBreaks: specification.scenes,
          sections: specification.scenes,
          blocks: expectedScope(specification, "WORK").blocks,
        },
        scopes,
        compileWork: {
          ...measurementSummary(workSamples),
          contentHash: workResult.content_hash,
        },
      };
    } finally {
      await client.close();
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  for (const specification of Object.values(specifications)) {
    for (const suffix of ["", ".bak", ".bak.previous"]) {
      await removeRegularFile(`${specification.path}${suffix}`);
    }
  }
  await removeRegularFile(manifestPath);
  throw error;
}
