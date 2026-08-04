import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const DEVELOPMENT_WEBSOCKET_CSP = " ws://127.0.0.1:5173";

export default defineConfig(({ command }) => ({
  root: __dirname,
  // Production is served from madi://app, so emitted JS/WASM/ICU/font URLs
  // stay relative to dist/renderer/index.html and its allowlisted asset root.
  base: "./",
  plugins: [
    react(),
    ...(command === "build"
      ? [{
          name: "madi-production-csp",
          transformIndexHtml(html: string) {
            if (!html.includes(DEVELOPMENT_WEBSOCKET_CSP)) {
              throw new Error("Development WebSocket CSP directive is missing");
            }
            return html.replace(DEVELOPMENT_WEBSOCKET_CSP, "");
          }
        }]
      : [])
  ],
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "src/renderer"),
      "@shared": path.resolve(__dirname, "src/shared")
    }
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    // Typie loads every resource with fetch(). Keep even the small font
    // manifest as a real local file instead of a CSP-blocked data: URL.
    assetsInlineLimit: 0
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: false,
    restoreMocks: true
  }
}));
