// The packed package's browser build, opened over IndexedDB in Chromium: `npm run build:package`, then
// `npm run test:pod-browser`. A browser has the engine, IndexedDB and workers that no Node test has.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright";

const PACKAGE = fileURLToPath(
  new URL("../../../../build/package/", import.meta.url),
);
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ttl": "text/turtle",
  ".rq": "text/plain",
};

/** Serves the packed package's folder, as an app serves its files beside its bundle. */
function serving(): Promise<Server> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(
      new URL(request.url ?? "/", "http://x").pathname,
    );
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>pod</title>");
      return;
    }
    const file = normalize(join(PACKAGE, path));
    if (!file.startsWith(PACKAGE)) {
      response.writeHead(403).end();
      return;
    }
    readFile(file)
      .then((bytes) => {
        response.writeHead(200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        });
        response.end(bytes);
      })
      .catch(() => response.writeHead(404).end());
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

/**
 * A pod kept in the browser's IndexedDB opens again with the title an app gave it. The title is in the pod's manifest and
 * in `pod.json` beside its answers, and `pod.titled` says whether one was ever given.
 */
describe("Retitling a pod in a browser · openPod(), pod.retitle(), podTitle()", () => {
  let server: Server;
  let browser: Browser;
  let page: Page;

  before(async () => {
    assert.ok(
      existsSync(join(PACKAGE, "dist", "browser", "index.js")),
      `${PACKAGE} holds no packed browser build: run npm run build:package`,
    );
    server = await serving();
    browser = await chromium.launch();
    page = await browser.newPage();
    const { port } = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${port}/`);
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  describe("given a pod made with no title", () => {
    it("opens again with the new title in `pod.json` and in its manifest, and as titled", async () => {
      const seen = await page.evaluate(async () => {
        const url = "/dist/browser/index.js";
        const { openPod, podTitle, deletePod } = (await import(url)) as {
          openPod(name: string): Promise<{
            titled: boolean;
            retitle(title: string): Promise<void>;
            ask(question: { query: string }): Promise<unknown[]>;
            close(): Promise<void>;
          }>;
          podTitle(name: string): Promise<string | undefined>;
          deletePod(name: string): Promise<void>;
        };
        const name = "retitle-in-a-browser";
        const first = await openPod(name);
        const before = first.titled;
        const untitledAs = await podTitle(name);
        await first.retitle("Ada Lovelace");
        const during = first.titled;
        await first.close();
        const second = await openPod(name);
        const kept = second.titled;
        const keptTitle = await podTitle(name);
        await second.ask({ query: "SELECT * WHERE { ?s ?p ?o } LIMIT 1" });
        const computed = second.titled;
        await second.close();
        await deletePod(name);
        return { before, untitledAs, during, kept, keptTitle, computed };
      });
      assert.deepEqual(seen, {
        before: false,
        untitledAs: "retitle-in-a-browser",
        during: true,
        kept: true,
        keptTitle: "Ada Lovelace",
        computed: true,
      });
    });
  });
});
