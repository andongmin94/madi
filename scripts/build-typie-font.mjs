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
  "Pretendard-Regular.ttf"
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
if (
  sha256(sourceFont) !==
  "6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324"
) {
  throw new Error("The Pretendard v1.3.9 Regular source font hash does not match");
}
const { EditorServer } = await createInstance(
  await WebAssembly.compile(serverWasm)
);
const server = EditorServer.create();

try {
  const codepoints = server.get_font_codepoints(sourceFont);
  const coverage = new Set(codepoints);
  let hangulSyllablesCovered = 0;
  for (let codepoint = 0xAC00; codepoint <= 0xD7A3; codepoint += 1) {
    if (coverage.has(codepoint)) hangulSyllablesCovered += 1;
  }
  if (hangulSyllablesCovered !== 11_172) {
    throw new Error("The Pretendard font does not cover every Hangul syllable");
  }
  const built = server.build_font(sourceFont, {
    // Load one complete glyph chunk locally. Typie's manifest and
    // chunk protocol remain intact without introducing a network font service.
    chunks: [Array.from(codepoints)]
  });
  if (built.chunks.length !== 1) {
    throw new Error("The local font build did not produce one glyph chunk");
  }

  const outputs = [
    ["Pretendard-Regular.base.zst", built.base],
    ["Pretendard-Regular.manifest.zst", built.manifest],
    ["Pretendard-Regular.chunk-0.zst", built.chunks[0]]
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
        hangulSyllablesCovered,
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
