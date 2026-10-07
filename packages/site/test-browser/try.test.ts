import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";
import { type Imported, openPod, type Pod } from "cascade-runtime";
import {
  FILES_JSON,
  parseConfig,
  repositoryName,
  treeIri,
} from "@cascade-runtime/runtime";
import {
  CONFIG_FILE,
  findRoot,
  PACKED,
  type Packed,
} from "@cascade-runtime/runtime/node";
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
  assert.deepEqual(sorted(added.active), sorted(first.active));

  await page.reload();
  const reloaded = await shown(page);
  assert.deepEqual(sorted(reloaded.active), sorted(added.active));
  assert.deepEqual(reloaded.added, added.added);

  await page.click("#start-over");
  const fresh = await shown(page);
  assert.deepEqual(sorted(fresh.active), expected);
  assert.deepEqual(fresh.added, first.added);
});

/** What a pod shows after an import, its own address left out, so two pods compare. */
interface After {
  readonly refused?: string;
  readonly claimed: number;
  readonly unclaimed: number;
  readonly rows: string[][];
}

const QUESTIONS = ["pod/My active allergies", "pod/My active medications"];

/** The import and the rows of the questions after it; self-contained, so the page runs it from its source as Node does. */
async function shownAfter(
  pod: Pod,
  imported: Imported,
  questions: readonly string[],
): Promise<After> {
  const rows: string[][] = [];
  for (const question of questions)
    for (const row of await pod.ask(question))
      rows.push([
        question,
        ...Object.entries(row)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(
            ([column, value]) =>
              `${column}=${value.startsWith(pod.address) ? value.slice(pod.address.length) : value}`,
          ),
      ]);
  return {
    ...(imported.refused === undefined ? {} : { refused: imported.refused }),
    claimed: imported.claimed.length,
    unclaimed: imported.unclaimed.length,
    rows: rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  };
}

test("in the browser, look and import read the files a person picks as Node reads them by path, the Bridge in a Web Worker started by the first import", async () => {
  const components = join(PAGES, "try", "cascade-runtime", "components");
  const config = parseConfig(
    await readFile(join(components, CONFIG_FILE), "utf8"),
  );
  const packed = JSON.parse(
    await readFile(join(components, PACKED), "utf8"),
  ) as Packed;
  const carried = packed.components.map(({ repository, commit }) =>
    treeIri({ repository }, commit),
  );
  const vocabulary = packed.components.find(
    ({ repository }) => repository === config.vocabulary.repository,
  );
  assert.ok(vocabulary);
  const kits = join(
    components,
    repositoryName(config.vocabulary),
    vocabulary.commit,
    "conformance",
  );
  const picked = [
    join(
      kits,
      "alex-rivera/scripted-input/alex/downloads/x-e2/apple_health_export",
    ),
    join(
      kits,
      "priya-natarajan/scripted-input/priya/downloads/kestrel-harbor-health-summary.xml",
    ),
  ];

  const node = await openPod();
  const expected: { look: unknown; after: After }[] = [];
  try {
    for (const path of picked)
      expected.push({
        look: await node.look(path),
        after: await shownAfter(
          node,
          await node.import(path, { aboutSubject: true }),
          QUESTIONS,
        ),
      });
  } finally {
    await node.close();
  }

  const page = watched(await browser.newPage());
  await page.addInitScript(() => {
    const loads: string[] = [];
    (globalThis as unknown as { bridgeLoads: string[] }).bridgeLoads = loads;
    const post = Worker.prototype.postMessage as (
      this: Worker,
      ...args: unknown[]
    ) => void;
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      ...rest: unknown[]
    ) {
      const request = (
        message as {
          request?: {
            op?: string;
            adapter?: { iri: string };
            vocabulary?: { iri: string };
          };
        }
      )?.request;
      if (request?.op === "load")
        loads.push(
          ...[request.adapter?.iri, request.vocabulary?.iri].flatMap(
            (iri) => iri ?? [],
          ),
        );
      return post.call(this, message, ...rest);
    };
  });
  let workers = 0;
  page.on("worker", () => {
    workers += 1;
  });
  await page.goto(`${served.url}try/index.html`);
  await shown(page);
  await page.evaluate(() => {
    for (const [id, folder] of [
      ["pick-folder", true],
      ["pick-file", false],
    ] as const) {
      const input = document.createElement("input");
      input.type = "file";
      input.id = id;
      input.webkitdirectory = folder;
      document.body.append(input);
    }
  });
  const [folder = "", file = ""] = picked;
  await page.setInputFiles("#pick-folder", folder);
  await page.setInputFiles("#pick-file", file);
  await page.evaluate(async () => {
    const { openPod } = (await import(
      "cascade-runtime" as string
    )) as typeof import("cascade-runtime");
    (globalThis as unknown as { pod: Pod }).pod = await openPod();
  });

  for (const [at, id] of ["pick-folder", "pick-file"].entries()) {
    const want = expected[at];
    assert.ok(want);
    const look = await page.evaluate(async (id) => {
      const input = document.getElementById(id) as HTMLInputElement;
      const files = new Map(
        [...(input.files ?? [])].map((file) => [
          file.webkitRelativePath || file.name,
          file,
        ]),
      );
      (globalThis as unknown as { picked: Map<string, File> }).picked = files;
      return (globalThis as unknown as { pod: Pod }).pod.look(files);
    }, id);
    assert.deepEqual(look, want.look, id);
    if (at === 0) assert.equal(workers, 0, "a look started a worker");
    const got = await page.evaluate(
      async ({ questions, source }) => {
        const scope = globalThis as unknown as {
          pod: Pod;
          picked: Map<string, File>;
        };
        const run = new Function(`return ${source}`)() as (
          pod: Pod,
          imported: Imported,
          questions: readonly string[],
        ) => Promise<After>;
        return run(
          scope.pod,
          await scope.pod.import(scope.picked, { aboutSubject: true }),
          questions,
        );
      },
      { questions: QUESTIONS, source: shownAfter.toString() },
    );
    assert.deepEqual(got, want.after, id);
  }
  assert.ok(workers > 0, "no import started a worker");
  const loads = await page.evaluate(
    () => (globalThis as unknown as { bridgeLoads: string[] }).bridgeLoads,
  );
  const adapters = config.adapters.map(
    ({ repository }) =>
      carried.find((iri) => iri.startsWith(`${repository}/tree/`)) ?? "",
  );
  for (const adapter of adapters) assert.ok(loads.includes(adapter), adapter);
  for (const iri of loads) assert.ok(carried.includes(iri), iri);
});
