import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const roots = [
  "apps/desktop/src",
  "apps/desktop/tests",
  "crates/madi-core/src",
  "crates/madi-publication/src",
  "crates/madi-export-epub/src",
  "crates/madi-export-epub/tests",
  "scripts",
];
const extensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".rs",
  ".json",
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
}

const files = (
  await Promise.all(
    roots.map((root) => walk(resolve(repositoryRoot, root))),
  )
)
  .flat()
  .filter((path) => extensions.has(extname(path)));

for (const path of files) {
  const source = await readFile(path, "utf8");
  if (source.length > 0 && !source.endsWith("\n")) {
    throw new Error(
      `Formatted text must end with a newline: ${relative(
        repositoryRoot,
        path,
      )}`,
    );
  }
  if (/[ \t]+$/m.test(source) || source.includes("\u0000")) {
    throw new Error(
      `Trailing whitespace or NUL found: ${relative(repositoryRoot, path)}`,
    );
  }
  if (extname(path) === ".json") {
    JSON.parse(source);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      check: "source-format-and-json",
      files: files.length,
      trailingWhitespace: 0,
      invalidJson: 0,
    },
    null,
    2,
  )}\n`,
);
