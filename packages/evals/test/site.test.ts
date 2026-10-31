import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import type { Results } from "../src/results.js";
import { errorsOf } from "../src/schemas.js";
import { buildSite } from "../src/site.js";

/** The smoke run graded: Tamsin Vale, one run per arm, judged by Haiku and Sonnet. */
const SMOKE = fileURLToPath(
  new URL("../../test/fixtures/smoke-run/", import.meta.url),
);
const out = await mkdtemp(join(tmpdir(), "cascade-evals-site-"));
after(() => rm(out, { recursive: true, force: true, maxRetries: 5 }));

const esc = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const results = JSON.parse(
  await readFile(join(SMOKE, "results.json"), "utf8"),
) as Results;
const graded = join(out, "graded");
const unjudged = join(out, "unjudged");
const read = (site: string, path: string) =>
  readFile(join(site, ...path.split("/")), "utf8");

async function pagesOf(site: string): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  for (const entry of await readdir(site, { recursive: true }))
    if (entry.endsWith(".html"))
      pages.set(
        resolve(site, entry),
        await readFile(join(site, entry), "utf8"),
      );
  return pages;
}

before(async () => {
  await buildSite({ run: SMOKE }, graded);
  const folder = join(out, "unjudged-run");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "results.json"),
    JSON.stringify({ ...results, grades: [], scores: [], agreement: [] }),
  );
  await buildSite({ run: folder }, unjudged);
});

test("the graded smoke run's results.json holds to its schema", () => {
  assert.deepEqual(errorsOf("results", results), []);
});

test("the index names the two inputs in plain words, gives each one's result and the better one, and links to the page that explains the test", async () => {
  const index = await read(graded, "index.html");
  const top = index.slice(0, index.indexOf("<table"));
  for (const said of ["Cascade pod", "Grab bag", 'href="about.html"'])
    assert.ok(top.includes(said), `the top of the index has ${said}`);
  assert.match(index, /Gaps found[\s\S]*?2 of 2[\s\S]*?2 of 2/);
  assert.match(index, /Traps raised[\s\S]*?0 of 2[\s\S]*?0 of 2/);
  assert.match(top, /class="better[^"]*">Tie/);
  assert.match(index, /href="cases\/tamsin-vale\.html"/);
  for (const item of ["tg1", "tg2", "tt1", "tt2"])
    assert.match(
      index,
      new RegExp(`href="cases/tamsin-vale/${item}\\.html"`),
      `the index links to ${item}'s page`,
    );
});

test("the case page is the answer key: a row per item, under should find or should not raise, with each input's verdict and its own question", async () => {
  const page = await read(graded, "cases/tamsin-vale.html");
  for (const item of ["tg1", "tg2", "tt1", "tt2"]) {
    assert.match(page, new RegExp(`<tr id="${item}"`), `${item} has a row`);
    assert.match(page, new RegExp(`href="tamsin-vale/${item}\\.html"`));
  }
  assert.ok(page.indexOf("Should find") < page.indexOf('id="tg1"'));
  assert.ok(page.indexOf('id="tg2"') < page.indexOf("Should not raise"));
  assert.ok(page.indexOf("Should not raise") < page.indexOf('id="tt1"'));
  const row = page.slice(
    page.indexOf('<tr id="tg1"'),
    page.indexOf('<tr id="tg2"'),
  );
  assert.match(row, /class="mark found"/);
  assert.ok(
    row.includes(
      esc(
        "Have I had a urine test for protein (urine albumin-to-creatinine ratio) to check my kidneys for diabetes damage?",
      ),
    ),
    "the row quotes the grab bag's own question",
  );
  const trap = page.slice(
    page.indexOf('<tr id="tt1"'),
    page.indexOf('<tr id="tt2"'),
  );
  assert.match(trap, /class="mark avoided"/);
});

test("a finding's page gives why the key expects it, then each input's verdict and question side by side, with who judged it and the evidence folded beneath", async () => {
  const page = await read(graded, "cases/tamsin-vale/tg1.html");
  const why = page.indexOf(
    esc("type 2 diabetes calls for a uACR at diagnosis and yearly"),
  );
  const verdict = page.indexOf('class="mark found"');
  assert.ok(
    why > 0 && verdict > why,
    "the key's reasoning comes before the verdicts",
  );
  for (const arm of ['id="cascade-pod"', 'id="grab-bag"'])
    assert.ok(page.includes(arm), `the page has ${arm}`);
  const firstFold = page.indexOf("<details", verdict);
  assert.ok(firstFold > verdict, "the evidence is folded under the verdict");
  for (const below of ["haiku-5-5", "sonnet-5-5", "own knowledge"]) {
    const at = page.indexOf(below, verdict);
    assert.ok(at > firstFold, `${below} sits in a fold beneath the verdict`);
  }
});

test("an unjudged run says so at the top of every page and gives no verdict", async () => {
  for (const [path, page] of await pagesOf(unjudged)) {
    if (path.endsWith("about.html")) continue;
    const top = page.slice(0, page.indexOf("</header>"));
    assert.match(
      top,
      /Not judged/,
      `${path} says it was not judged at the top`,
    );
    assert.doesNotMatch(
      page,
      /class="mark (found|partly|missed|raised|avoided)"/,
      `${path} gives no verdict`,
    );
  }
});

test("every link in the site leads to a page and an anchor that exist", async () => {
  for (const site of [graded, unjudged]) {
    const pages = await pagesOf(site);
    for (const [path, page] of pages)
      for (const [, href] of page.matchAll(/href="([^"]+)"/g)) {
        if (/^[a-z]+:/.test(href!)) continue;
        const [file, anchor] = href!.split("#");
        const target = file === "" ? path : resolve(dirname(path), file!);
        assert.ok(existsSync(target), `${path} links to ${href}, which exists`);
        if (anchor !== undefined)
          assert.ok(
            (pages.get(target) ?? "").includes(`id="${anchor}"`),
            `${path} links to ${href}, whose anchor exists`,
          );
      }
  }
});

test("every verdict, check and tool call in results.json is reachable from the site", async () => {
  const site = [...(await pagesOf(graded)).values()].join("\n");
  const said = [
    ...results.grades.flatMap((g) => [
      ...g.items.map((it) => it.reason),
      ...g.falseQuestions.map((it) => it.why),
      ...g.extraFinds.map((it) => it.why),
    ]),
    ...Object.values(results.checks).flatMap((c) => [
      ...c.citations.flatMap((it) => (it.shows ? [it.shows] : [])),
      ...c.trapWording.map((it) => it.text),
    ]),
    ...results.toolCalls.map((c) => JSON.stringify(c.input)),
    ...results.jobs.map((j) => j.id),
  ];
  for (const text of said)
    assert.ok(site.includes(esc(text)), `the site shows ${text.slice(0, 80)}`);
});
