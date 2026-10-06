import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import { openPod } from "cascade-runtime";
import { FILES_JSON } from "@cascade-runtime/runtime";
import { findRoot } from "@cascade-runtime/runtime/node";
import { type Served, servePages } from "../src/node/serve.js";
import { shown, watched } from "./shown.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const PAGES = join(ROOT, "build", "pages");
const ALLERGEN = "Cascade test allergen";

let served: Served;
let browser: Browser;
let expected: string[][];

const sorted = (rows: string[][]): string[][] =>
  [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

before(async () => {
  if (!existsSync(join(PAGES, "try", "index.html")))
    throw new Error(
      `${PAGES} holds no try/; run npm run build:package and npm run build:pages first`,
    );
  const copy = await mkdtemp(join(tmpdir(), "try-"));
  try {
    await cp(join(PAGES, "alex-rivera", "pod"), copy, { recursive: true });
    await rm(join(copy, FILES_JSON));
    const pod = await openPod(copy);
    expected = sorted(
      (await pod.ask("pod/My active allergies")).map((row) => [
        row.allergen ?? "",
        row.criticality ?? "",
      ]),
    );
    await pod.close();
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
  served = await servePages(PAGES);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await served?.close();
});

test("try/ opens her published pod, adds an allergy, keeps both after a reload, and starts over", async () => {
  const page = watched(await browser.newPage());
  await page.goto(`${served.url}try/index.html`);
  const first = await shown(page);
  assert.ok(expected.length > 0);
  assert.deepEqual(sorted(first.active), expected);
  assert.equal(await page.evaluate(() => crossOriginIsolated), false);
  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map(({ name }) => name),
  );
  assert.ok(databases.includes("cascade-pod:alex-rivera"), String(databases));
  assert.ok(!first.added.includes(ALLERGEN));

  await page.fill('#add input[name="allergen"]', ALLERGEN);
  await page.click('#add button[type="submit"]');
  const added = await shown(page);
  assert.deepEqual(added.added, [...first.added, ALLERGEN].sort());
  assert.deepEqual(added.active, first.active);

  await page.reload();
  assert.deepEqual(await shown(page), added);

  await page.click("#start-over");
  const fresh = await shown(page);
  assert.deepEqual(sorted(fresh.active), expected);
  assert.deepEqual(fresh.added, first.added);
});
