import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve as absolute, sep } from "node:path";

/** The types GitHub Pages serves the tree's files with that a browser checks. */
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ttl": "text/turtle; charset=utf-8",
};

export interface Served {
  /** The folder's URL, ending in a slash. */
  readonly url: string;
  close(): Promise<void>;
}

/** Serves the folder on 127.0.0.1, as Pages serves it: no header beyond each file's type, a folder by its index.html. */
export async function servePages(folder: string, port = 0): Promise<Served> {
  const root = absolute(folder);
  const server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent(
        new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      );
      const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      try {
        const bytes = await readFile(file);
        response.writeHead(200, {
          "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        });
        response.end(bytes);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const { port: listening } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${listening}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
