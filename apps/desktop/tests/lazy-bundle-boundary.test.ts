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
const readerModePath = resolve(
  desktopRoot,
  "src/renderer/components/ReaderLabMode.tsx"
);
const publicationExportModePath = resolve(
  desktopRoot,
  "src/renderer/components/PublicationExportMode.tsx"
);
const hwpxWorkspacePath = resolve(
  desktopRoot,
  "src/renderer/components/hwpxExport/HwpxExportWorkspace.tsx"
);
const rendererDistPath = resolve(desktopRoot, "dist/renderer");
const rendererAssetsPath = resolve(rendererDistPath, "assets");

describe("Graph/Canvas/Reader/EPUB lazy bundle boundary", () => {
  it("keeps all four feature renderers behind distinct dynamic imports", () => {
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
    expect(appSource).toMatch(
      /lazy\(async \(\) => \{[\s\S]*?import\([\s\S]*?\.\/components\/ReaderLabMode[\s\S]*?\)[\s\S]*?\}\)/
    );
    expect(appSource).toMatch(
      /lazy\(async \(\) => \{[\s\S]*?import\([\s\S]*?\.\/components\/PublicationExportMode[\s\S]*?\)[\s\S]*?\}\)/
    );
    expect(eagerSource).not.toMatch(
      /(?:from\s+|import\s*\()\s*["']@xyflow\/react["']/
    );
    expect(eagerSource).not.toMatch(
      /(?:from\s+|import\s*\()\s*["']cytoscape["']/
    );
    expect(sharedContracts).not.toMatch(/@xyflow\/react|cytoscape/);
    expect(rendererEntry).not.toMatch(/ReaderLabMode|PublicationContent|sectionWindowing/);
    expect(readFileSync(readerModePath, "utf8")).toContain(
      'from "./readerLab/ReaderLabWorkspace"'
    );
    expect(readFileSync(publicationExportModePath, "utf8")).toContain(
      'from "./epubExport/EpubExportWorkspace"'
    );
    expect(readFileSync(publicationExportModePath, "utf8")).toMatch(
      /lazy\(async \(\) => \{[\s\S]*?import\("\.\/hwpxExport\/HwpxExportWorkspace"\)/u
    );
    expect(eagerSource).not.toContain("HwpxExportWorkspace");
    expect(readFileSync(hwpxWorkspacePath, "utf8")).toContain(
      'aria-label="한글 문서 내보내기"'
    );
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

  it.skipIf(
    !existsSync(rendererAssetsPath) ||
      !readdirSync(rendererAssetsPath).some((name) =>
        /^PublicationExportMode-.+\.js$/.test(name)
      )
  )(
    "places React Flow, Cytoscape, Reader Lab, and publication export in separate production chunks",
    () => {
      const assetNames = readdirSync(rendererAssetsPath);
      const plotChunkName = assetNames.find((name) =>
        /^PlotCanvasMode-.+\.js$/.test(name)
      );
      const graphChunkName = assetNames.find((name) =>
        /^WorldGraphWorkspace-.+\.js$/.test(name)
      );
      const readerChunkName = assetNames.find((name) =>
        /^ReaderLabMode-.+\.js$/.test(name)
      );
      const publicationExportChunkName = assetNames.find((name) =>
        /^PublicationExportMode-.+\.js$/.test(name)
      );
      expect(plotChunkName).toBeDefined();
      expect(graphChunkName).toBeDefined();
      expect(readerChunkName).toBeDefined();
      expect(publicationExportChunkName).toBeDefined();
      expect(plotChunkName).not.toBe(graphChunkName);
      expect(readerChunkName).not.toBe(plotChunkName);
      expect(readerChunkName).not.toBe(graphChunkName);
      expect(publicationExportChunkName).not.toBe(plotChunkName);
      expect(publicationExportChunkName).not.toBe(graphChunkName);
      expect(publicationExportChunkName).not.toBe(readerChunkName);

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
      const readerChunk = readFileSync(
        `${rendererAssetsPath}/${readerChunkName!}`,
        "utf8"
      );
      const publicationExportChunk = readFileSync(
        `${rendererAssetsPath}/${publicationExportChunkName!}`,
        "utf8"
      );

      expect(mainChunk).toContain(plotChunkName);
      expect(mainChunk).toContain(graphChunkName);
      expect(mainChunk).toContain(readerChunkName);
      expect(mainChunk).toContain(publicationExportChunkName);
      expect(mainChunk).not.toContain("react-flow__renderer");
      expect(mainChunk).not.toContain("No such layout `");
      expect(mainChunk).not.toContain("reader-shadow-host");
      expect(mainChunk).not.toContain("epub-export__validation");
      expect(plotChunk).toContain("react-flow__renderer");
      expect(plotChunk).not.toContain("No such layout `");
      expect(plotChunk).not.toContain("reader-shadow-host");
      expect(graphChunk).toContain("No such layout `");
      expect(graphChunk).not.toContain("react-flow__renderer");
      expect(graphChunk).not.toContain("reader-shadow-host");
      expect(readerChunk).toContain("reader-shadow-host");
      expect(readerChunk).not.toContain("react-flow__renderer");
      expect(readerChunk).not.toContain("No such layout `");
      expect(readerChunk).not.toContain("epub-export__validation");
      expect(publicationExportChunk).toContain("epub-export__validation");
      expect(publicationExportChunk).not.toContain("reader-shadow-host");
      expect(publicationExportChunk).not.toContain("react-flow__renderer");
      expect(publicationExportChunk).not.toContain("No such layout `");
    }
  );

  it.skipIf(
    !existsSync(rendererAssetsPath) ||
      !readdirSync(rendererAssetsPath).some((name) =>
        /^HwpxExportWorkspace-.+\.js$/.test(name)
      )
  )("places HWPX export in its own nested production chunk", () => {
    const assetNames = readdirSync(rendererAssetsPath);
    const publicationExportChunkName = assetNames.find((name) =>
      /^PublicationExportMode-.+\.js$/.test(name)
    );
    const hwpxChunkName = assetNames.find((name) =>
      /^HwpxExportWorkspace-.+\.js$/.test(name)
    );
    expect(publicationExportChunkName).toBeDefined();
    expect(hwpxChunkName).toBeDefined();
    expect(hwpxChunkName).not.toBe(publicationExportChunkName);

    const publicationExportChunk = readFileSync(
      `${rendererAssetsPath}/${publicationExportChunkName!}`,
      "utf8"
    );
    const hwpxChunk = readFileSync(
      `${rendererAssetsPath}/${hwpxChunkName!}`,
      "utf8"
    );
    expect(publicationExportChunk).toContain(hwpxChunkName);
    expect(publicationExportChunk).not.toContain("hwpx-export__success");
    expect(hwpxChunk).toContain("hwpx-export__success");
    expect(hwpxChunk).not.toContain("reader-shadow-host");
    expect(hwpxChunk).not.toContain("react-flow__renderer");
    expect(hwpxChunk).not.toContain("No such layout `");
  });

  it.skipIf(!existsSync(`${rendererDistPath}/index.html`))(
    "removes the development WebSocket capability from production CSP",
    () => {
      const html = readFileSync(`${rendererDistPath}/index.html`, "utf8");
      expect(html).toContain("connect-src 'self'");
      expect(html).not.toMatch(/\b(?:ws|wss):\/\//u);
    }
  );
});
