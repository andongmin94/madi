import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Protocol } from "electron";

export const MADI_APP_ORIGIN = "madi://app";
export const MADI_APP_ENTRY_URL = `${MADI_APP_ORIGIN}/index.html`;

const CONTENT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".zst", "application/octet-stream"]
]);

export function resolveAppAssetPath(
  rendererDirectory: string,
  requestUrl: string
): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }

  if (
    url.protocol !== "madi:" ||
    url.hostname !== "app" ||
    url.username ||
    url.password ||
    url.port
  ) {
    return undefined;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0")) {
    return undefined;
  }

  const root = path.resolve(rendererDirectory);
  const candidate = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !CONTENT_TYPES.has(path.extname(candidate).toLowerCase())
  ) {
    return undefined;
  }
  return candidate;
}

export function installMadiAppProtocol(
  electronProtocol: Protocol,
  rendererDirectory: string
): void {
  electronProtocol.handle("madi", async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" }
      });
    }

    const assetPath = resolveAppAssetPath(rendererDirectory, request.url);
    if (!assetPath) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const contents = await readFile(assetPath);
      const body =
        request.method === "HEAD"
          ? null
          : contents.buffer.slice(
              contents.byteOffset,
              contents.byteOffset + contents.byteLength
            );
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type":
            CONTENT_TYPES.get(path.extname(assetPath).toLowerCase()) ??
            "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
