import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createInstance } from "../vendor/typie/crates/editor-ffi/pkg/server/editor_ffi.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serverWasmPath = resolve(
  repositoryRoot,
  "vendor",
  "typie",
  "crates",
  "editor-ffi",
  "pkg",
  "server",
  "editor_ffi_bg.wasm"
);
const sourceFontPath = resolve(
  repositoryRoot,
  ".tools",
  "NanumGothic-Regular.ttf"
);
const outputDirectory = resolve(
  repositoryRoot,
  "packages",
  "typie-runtime",
  "assets"
);

const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

const [serverWasm, sourceFont] = await Promise.all([
  readFile(serverWasmPath),
  readFile(sourceFontPath)
]);
const { EditorServer } = await createInstance(
  await WebAssembly.compile(serverWasm)
);
const server = EditorServer.create();

try {
  const codepoints = server.get_font_codepoints(sourceFont);
  const built = server.build_font(sourceFont, {
    // Phase 0 loads one complete glyph chunk locally. Typie's manifest and
    // chunk protocol remain intact without introducing a network font service.
    chunks: [Array.from(codepoints)]
  });
  if (built.chunks.length !== 1) {
    throw new Error("The phase-0 font build did not produce one glyph chunk");
  }

  const outputs = [
    ["NanumGothic-Regular.base.zst", built.base],
    ["NanumGothic-Regular.manifest.zst", built.manifest],
    ["NanumGothic-Regular.chunk-0.zst", built.chunks[0]]
  ];
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    outputs.map(([name, bytes]) =>
      writeFile(resolve(outputDirectory, name), bytes)
    )
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        engineHash: built.hash,
        sourceCodepoints: codepoints.length,
        sourceSha256: sha256(sourceFont),
        outputs: Object.fromEntries(
          outputs.map(([name, bytes]) => [
            name,
            { bytes: bytes.byteLength, sha256: sha256(bytes) }
          ])
        )
      },
      null,
      2
    )}\n`
  );
} finally {
  server.free();
}
