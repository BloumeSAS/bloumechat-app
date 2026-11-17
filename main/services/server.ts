import http from "http";
import fs from "fs";
import path from "path";

/** Preferred port; any free port is used when something else already holds it. */
export const PROD_PORT = 15999;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

const CSP_HEADER =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "frame-src https://bloumechat.com https://www.bloumechat.com https://challenges.cloudflare.com; " +
  "connect-src 'self'; font-src 'self' data:; media-src 'self' blob:; worker-src blob:";

/** Maps a request path to the file served for it (pretty URLs, index.html, .html fallbacks). */
function resolveRoute(serveDir: string, pathname: string): string {
  if (pathname === "/" || pathname === "") return "/home/index.html";
  if (pathname === "/home" || pathname === "/home/") return "/home/index.html";
  if (pathname === "/update" || pathname === "/update/")
    return "/update/index.html";
  if (pathname === "/screen-picker" || pathname === "/screen-picker/")
    return "/screen-picker/index.html";
  if (!pathname.includes(".")) {
    if (fs.existsSync(path.join(serveDir, pathname + ".html")))
      return pathname + ".html";
    if (fs.existsSync(path.join(serveDir, pathname + "/index.html")))
      return pathname + "/index.html";
  }
  return pathname;
}

/** Hashed build output never changes; everything else is revalidated. */
function cacheControlFor(pathname: string, extname: string): string {
  if (pathname.startsWith("/_next/static/"))
    return "public, max-age=31536000, immutable";
  if (extname === ".html") return "no-cache";
  return "public, max-age=3600";
}

function createHandler(serveDir: string): http.RequestListener {
  const serveDirResolved = path.resolve(serveDir);

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(req.url || "", `http://${req.headers.host}`).pathname,
      );
    } catch {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    pathname = resolveRoute(serveDir, pathname);

    const filePath = path.resolve(path.join(serveDir, pathname));
    // Block path traversal — the resolved path must stay inside serveDir.
    if (
      filePath !== serveDirResolved &&
      !filePath.startsWith(serveDirResolved + path.sep)
    ) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const extname = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (error, content) => {
      if (error) {
        const notFound = error.code === "ENOENT" || error.code === "EISDIR";
        res.writeHead(notFound ? 404 : 500);
        res.end(
          notFound ? "File not found" : "Internal server error: " + error.code,
        );
        return;
      }
      const headers: Record<string, string> = {
        "Content-Type": MIME_TYPES[extname] || "application/octet-stream",
        "Cache-Control": cacheControlFor(pathname, extname),
        "X-Content-Type-Options": "nosniff",
      };
      if (extname === ".html") {
        headers["Content-Security-Policy"] = CSP_HEADER;
        headers["X-Frame-Options"] = "SAMEORIGIN";
      }
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : content);
    });
  };
}

function listen(
  server: http.Server,
  port: number,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve({
        server,
        port: typeof address === "object" && address ? address.port : port,
      });
    });
  });
}

/**
 * Serves the bundled home shell on loopback only. If the preferred port is taken (another
 * program, or a leftover process) any free port is used instead: the remote site allows any
 * 127.0.0.1 port as a frame ancestor, and a fixed port that is busy used to leave the app
 * with a blank window and no error at all.
 */
export async function startLocalServer(
  serveDir: string,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(createHandler(serveDir));
  try {
    const result = await listen(server, PROD_PORT);
    console.log(`[Server] Running at http://127.0.0.1:${result.port}`);
    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    console.warn(
      `[Server] Port ${PROD_PORT} already in use — using a free one`,
    );
    const result = await listen(server, 0);
    console.log(`[Server] Running at http://127.0.0.1:${result.port}`);
    return result;
  }
}
