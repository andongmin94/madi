import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopRoot = process.cwd();
const appSourcePath = resolve(desktopRoot, "src/renderer/App.tsx");
const rendererEntryPath = resolve(desktopRoot, "src/renderer/main.tsx");
const sharedContractsPath = resolve(desktopRoot, "src/shared/contracts.ts");
const plotCanvasPublicIndexPath = resolve(
  desktopRoot,
  "src/renderer/components/plotCanvas/index.ts"
);
const plotWorkspacePath = resolve(
  desktopRoot,
  "src/renderer/components/plotCanvas/PlotCanvasWorkspace.tsx"
);
const graphCanvasPath = resolve(
  desktopRoot,
  "src/renderer/components/worldGraph/WorldGraphCanvas.tsx"
);
const rendererDistPath = resolve(desktopRoot, "dist/renderer");
const rendererAssetsPath = resolve(rendererDistPath, "assets");

describe("Graph/Canvas lazy bundle boundary", () => {
  it("keeps both heavy renderers behind distinct dynamic imports", () => {
    const appSource = readFileSync(appSourcePath, "utf8");
    const rendererEntry = readFileSync(rendererEntryPath, "utf8");
    const sharedContracts = readFileSync(sharedContractsPath, "utf8");
    const plotCanvasPublicIndex = readFileSync(
      plotCanvasPublicIndexPath,
      "utf8"
    );
    const eagerSource = `${appSource}\n${rendererEntry}`;

    expect(appSource).toMatch(
      /lazy\(async \(\) => \{[\s\S]*?import\([\s\S]*?\.\/components\/worldGraph\/WorldGraphWorkspace[\s\S]*?\)[\s\S]*?\}\)/
    );
    expect(appSource).toMatch(
      /lazy\(async \(\) => \{[\s\S]*?import\([\s\S]*?\.\/components\/PlotCanvasMode[\s\S]*?\)[\s\S]*?\}\)/
    );
    expect(eagerSource).not.toMatch(
      /(?:from\s+|import\s*\()\s*["']@xyflow\/react["']/
    );
    expect(eagerSource).not.toMatch(
      /(?:from\s+|import\s*\()\s*["']cytoscape["']/
    );
    expect(sharedContracts).not.toMatch(/@xyflow\/react|cytoscape/);
    expect(plotCanvasPublicIndex).not.toMatch(
      /@xyflow\/react|ReactFlow|ReactFlowCanvas(?:Node|Edge|Model)/
    );

    expect(readFileSync(plotWorkspacePath, "utf8")).toContain(
      'from "@xyflow/react"'
    );
    expect(readFileSync(plotWorkspacePath, "utf8")).not.toContain(
      'from "cytoscape"'
    );
    expect(readFileSync(graphCanvasPath, "utf8")).toContain(
      'from "cytoscape"'
    );
    expect(readFileSync(graphCanvasPath, "utf8")).not.toContain(
      'from "@xyflow/react"'
    );
  });

  it.skipIf(!existsSync(rendererAssetsPath))(
    "places React Flow and Cytoscape runtimes in separate production chunks",
    () => {
      const assetNames = readdirSync(rendererAssetsPath);
      const plotChunkName = assetNames.find((name) =>
        /^PlotCanvasMode-.+\.js$/.test(name)
      );
      const graphChunkName = assetNames.find((name) =>
        /^WorldGraphWorkspace-.+\.js$/.test(name)
      );
      expect(plotChunkName).toBeDefined();
      expect(graphChunkName).toBeDefined();
      expect(plotChunkName).not.toBe(graphChunkName);

      const html = readFileSync(`${rendererDistPath}/index.html`, "utf8");
      const mainChunkName = html.match(
        /<script[^>]+src="\.\/assets\/([^"?]+\.js)"/
      )?.[1];
      expect(mainChunkName).toBeDefined();

      const mainChunk = readFileSync(
        `${rendererAssetsPath}/${mainChunkName!}`,
        "utf8"
      );
      const plotChunk = readFileSync(
        `${rendererAssetsPath}/${plotChunkName!}`,
        "utf8"
      );
      const graphChunk = readFileSync(
        `${rendererAssetsPath}/${graphChunkName!}`,
        "utf8"
      );

      expect(mainChunk).toContain(plotChunkName);
      expect(mainChunk).toContain(graphChunkName);
      expect(mainChunk).not.toContain("react-flow__renderer");
      expect(mainChunk).not.toContain("No such layout `");
      expect(plotChunk).toContain("react-flow__renderer");
      expect(plotChunk).not.toContain("No such layout `");
      expect(graphChunk).toContain("No such layout `");
      expect(graphChunk).not.toContain("react-flow__renderer");
    }
  );
});
