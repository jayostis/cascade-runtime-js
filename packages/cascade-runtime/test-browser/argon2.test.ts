// The packed package's browser build, checking a secret over IndexedDB in Chromium: `npm run build:package`, then
// `npm run test:pod-browser`. The Argon2id worker has no other test; a Node test cannot start it.
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
const VECTORS = fileURLToPath(
  new URL(
    "../../../runtime/test/vectors/pod-encryption-1.2.json",
    import.meta.url,
  ),
);
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ttl": "text/turtle",
  ".rq": "text/plain",
};

interface KnownAnswer {
  readonly id: string;
  readonly header: string;
  readonly passphrases: readonly string[];
  readonly mustNotOpenWith: readonly string[];
}

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
 * A secret is checked in the browser against a version 1.2 header sealed elsewhere. The headers are the known-answer pods
 * of `packages/runtime/test/vectors/pod-encryption-1.2.json`: each wrap's key was derived by libargon2 (argon2-cffi
 * 23.1.0), never by hash-wasm, so a secret opens a header only when the worker's Argon2id output is the reference's.
 */
describe("Checking a secret in a browser · checkSecret()", () => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let vectors: readonly KnownAnswer[];

  before(async () => {
    assert.ok(
      existsSync(join(PACKAGE, "dist", "browser", "index.js")),
      `${PACKAGE} holds no packed browser build: run npm run build:package`,
    );
    vectors = (
      JSON.parse(await readFile(VECTORS, "utf8")) as {
        positive: KnownAnswer[];
      }
    ).positive;
    server = await serving();
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.addInitScript(() => {
      const counts = { started: 0, answered: 0 };
      (
        globalThis as unknown as { argon2Workers: typeof counts }
      ).argon2Workers = counts;
      const Native = globalThis.Worker;
      globalThis.Worker = class extends Native {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (!String(url).endsWith("argon2-worker.js")) return;
          counts.started += 1;
          this.addEventListener("message", (event: MessageEvent) => {
            if ("key" in (event.data as object)) counts.answered += 1;
          });
        }
      };
    });
    const { port } = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${port}/`);
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  /** What `checkSecret` says of each secret for a pod whose header is seeded, and how many keys the Argon2 worker gave. */
  async function checked(header: string, secrets: readonly string[]) {
    return page.evaluate(
      async ({ header: text, secrets: tried }) => {
        const url = "/dist/browser/index.js";
        const { checkSecret, deletePod } = (await import(url)) as {
          checkSecret(name: string, secret: string): Promise<boolean>;
          deletePod(name: string): Promise<void>;
        };
        const name = `argon2-known-answer-${Math.random().toString(36).slice(2)}`;
        const opening = indexedDB.open(`cascade-pod:${name}`, 1);
        opening.onupgradeneeded = () =>
          opening.result.createObjectStore("files");
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          opening.onsuccess = () => resolve(opening.result);
          opening.onerror = () => reject(opening.error);
        });
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("files", "readwrite");
          transaction
            .objectStore("files")
            .put(new TextEncoder().encode(text), "settings/encryption.json");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
        const answers: boolean[] = [];
        const before = (
          globalThis as unknown as {
            argon2Workers: { started: number; answered: number };
          }
        ).argon2Workers.answered;
        try {
          for (const secret of tried)
            answers.push(await checkSecret(name, secret));
        } finally {
          await deletePod(name);
        }
        const { started, answered } = (
          globalThis as unknown as {
            argon2Workers: { started: number; answered: number };
          }
        ).argon2Workers;
        return { answers, started, keys: answered - before };
      },
      { header, secrets },
    );
  }

  describe("given the known-answer pod `E12-001`, a wrap under t=3, m=65536, p=1", () => {
    it("returns true for its secret and false for the near miss, each derived by the Argon2 worker", async () => {
      const vector = vectors.find(({ id }) => id === "E12-001");
      assert.ok(vector !== undefined);
      const secrets = [...vector.passphrases, ...vector.mustNotOpenWith];
      const seen = await checked(vector.header, secrets);
      assert.deepEqual(seen.answers, [true, false]);
      assert.equal(seen.started, 1);
      assert.equal(seen.keys, 2);
    });
  });

  describe("given the known-answer pod `E12-002`, two wraps with their own parameters", () => {
    it("returns true for the secret of either wrap, the second non-ASCII, and false for the near miss", async () => {
      const vector = vectors.find(({ id }) => id === "E12-002");
      assert.ok(vector !== undefined);
      const secrets = [...vector.passphrases, ...vector.mustNotOpenWith];
      const seen = await checked(vector.header, secrets);
      assert.deepEqual(seen.answers, [true, true, false]);
      assert.equal(seen.started, 1);
      assert.equal(seen.keys, 5);
    });
  });
});
