import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";
import {
  iri,
  kitsOf,
  literal,
  MemoryFiles,
  OxigraphStore,
  questions,
  titleOf,
  written,
  XSD,
} from "@cascade-runtime/runtime";
import {
  findRoot,
  type LocalVocabulary,
  localVocabulary,
  featurePod,
} from "@cascade-runtime/runtime/node";
import {
  EXAMPLES_PAGE,
  FRONT_PAGE,
  pagesTree,
  TRY_PAGE,
} from "../src/front-page.js";
import { escape, markup } from "../src/html.js";
import { Site, type SiteOptions } from "../src/site.js";
import { shown } from "../src/terms.js";
import { startFunctions, startOf } from "../src/node/start.js";
import { type Page, readPage } from "./page.js";

const FEATURE = "runtime/matcher.feature";
const EXAMPLE =
  "the matcher joins the pair a person called different, and not the pair a person called the same";
const THROUGH = "entry";
const MERGED_FROM = "https://ns.cascadeprotocol.org/core/v1#mergedFrom";
const RECORD = "https://ns.cascadeprotocol.org/records/v1-draft#Record";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));

let vocabulary: LocalVocabulary;
let options: SiteOptions;
let site: Site;
let files: Map<string, Uint8Array>;
let pages: Map<string, Page>;

before(async () => {
  vocabulary = await localVocabulary(ROOT);
  const pod = new MemoryFiles("https://pod.example/");
  await featurePod(vocabulary, FEATURE, pod, {
    example: EXAMPLE,
    through: THROUGH,
  });
  options = {
    vocabulary: vocabulary.files,
    layout: vocabulary.layout,
    build: vocabulary.build,
    pod,
    lens: vocabulary.config.lens,
    defaultLens: vocabulary.config.lens,
    newStore: () => new OxigraphStore(),
    name: "matching",
    at: "2026-03-03T08:00:00Z",
    ask: "npm run ask -- matching",
  };
  site = await Site.build(options);
  files = await site.files();
  pages = new Map(
    [...files]
      .filter(([path]) => path.endsWith(".html"))
      .map(([path, bytes]) => [
        path,
        readPage(new TextDecoder().decode(bytes)),
      ]),
  );
});

function page(path: string | undefined): Page {
  const found = pages.get(path ?? "");
  assert.ok(found, `the site has no page ${path}`);
  return found;
}

function blockOf(on: Page, title: string) {
  const found = on.blocks.find((block) => block.title === title);
  assert.ok(found, `${on.h1} has no block ${title}`);
  return found;
}

test("every question of the vocabulary has a place on the site, shown with its query", async () => {
  const shown = new Map(
    [...pages.values()].flatMap(({ blocks }) =>
      blocks.map((block) => [block.path, block.text] as const),
    ),
  );
  for (const { path, text } of (await questions(vocabulary.files)).values()) {
    assert.equal(shown.get(path), text, path);
  }
});

test("the home page shows what each folder of the pod holds and which view lists each kind", () => {
  const home = page("index.html");
  const folders = blockOf(home, "What each folder holds").rows.map(
    (row) => row.get("folder")?.value,
  );
  const filed = vocabulary.layout.recordPlacements.filter(({ folder }) =>
    site.pod.files.some((path) => path.startsWith(folder ?? "")),
  );
  assert.ok(filed.length > 0);
  for (const { folder } of filed)
    assert.ok(folders.includes(written(literal(`/${folder}`))), folder);
  assert.deepEqual(
    new Set(
      blockOf(home, "Which view lists each kind").rows.map(
        (row) => row.get("view")?.value,
      ),
    ),
    new Set(site.views.map((view) => written(view))),
  );
});

test("each view has a page linking to its file, and the entries it lists are the rows its question returns", async () => {
  for (const view of site.views) {
    const path = view.value.slice(site.pod.address.length);
    assert.ok(page(site.page(view)).hrefs.includes(`pod/${path}`), path);
  }
  const [view] = site.views.filter((view) =>
    (site.pod.built.get(view.value.slice(site.pod.address.length)) ?? []).some(
      ([, predicate]) => predicate.value === MERGED_FROM,
    ),
  );
  assert.ok(view, "no view lists an entry");
  const shows = blockOf(page(site.page(view)), "What it shows");
  const query = (await questions(vocabulary.files)).get("entry/What it shows");
  const { rows } = await site.pod.store.select(query?.text ?? "");
  const shown = site.question("entry/What it shows").of("view", view).shown;
  const expected = rows
    .filter((row) => row.get("view")?.value === view.value)
    .map((row) =>
      [...row]
        .filter(([column]) => shown.includes(column))
        .map(([column, term]) => `${column}=${written(term)}`)
        .sort(),
    );
  const found = shows.rows.map((row) =>
    [...row].map(([column, cell]) => `${column}=${cell.value}`).sort(),
  );
  assert.ok(found.length > 0);
  assert.deepEqual(found, expected);
});

test("an entry's page links to the page of each record it joins", () => {
  const joined = [...site.pod.built.values()]
    .flat()
    .filter(([, predicate]) => predicate.value === MERGED_FROM);
  assert.ok(joined.length > 0);
  for (const [entry, , record] of joined) {
    assert.ok(
      page(site.page(entry)).hrefs.includes(site.page(record) ?? ""),
      `${entry.value} ${record.value}`,
    );
  }
});

test("every thing's page lists the files of the pod that state it, each linked to its copy in the site", () => {
  const things = [...site.things.values()].flat();
  assert.ok(things.length > 0);
  for (const thing of things) {
    const stated = blockOf(
      page(site.page(thing)),
      "Which file states each thing",
    );
    assert.ok(stated.rows.length > 0, thing.value);
    for (const row of stated.rows) {
      const [href] = row.get("file")?.hrefs ?? [];
      assert.ok(href?.startsWith("pod/") && files.has(href), thing.value);
    }
  }
});

test("the pipeline page shows each step of the lens as it ran, the other lens beside it, and what each added", () => {
  const pipeline = page("pipeline.html");
  const steps = site.pod.derived.map(({ path }) =>
    path.slice(path.lastIndexOf("/") + 1, -3),
  );
  const ids = pipeline.blocks.flatMap(({ id }) => id ?? []);
  assert.deepEqual(
    ids.filter((id) => steps.includes(id)),
    steps,
  );
  const others = [...site.pipeline]
    .filter(([lens]) => lens !== vocabulary.config.lens)
    .map(([lens]) => lens);
  assert.ok(others.length > 0);
  for (const lens of others) assert.ok(pipeline.ids.has(lens), lens);
  const cells = pipeline.blocks.flatMap(({ rows }) =>
    rows.flatMap((row) => [...row.values()]),
  );
  const writesRecord = site.pod.derived.find(({ added }) =>
    added.some(
      ([, predicate, value]) =>
        predicate.value === TYPE && value.value === RECORD,
    ),
  );
  assert.ok(writesRecord);
  const linksOf = (term: string): string[] =>
    cells
      .filter(({ value }) => value === written(iri(term)))
      .flatMap(({ hrefs }) => hrefs);
  assert.ok(
    linksOf(RECORD).includes(
      `pipeline.html#${writesRecord.path.slice(writesRecord.path.lastIndexOf("/") + 1, -3)}`,
    ),
  );
  assert.ok(!linksOf(TYPE).some((href) => href.startsWith("pipeline.html")));
  const otherLens = pipeline.blocks.filter(({ said }) =>
    said.includes("--lens"),
  );
  assert.ok(otherLens.length > 0);
  assert.ok(
    !otherLens
      .flatMap(({ rows }) => rows.flatMap((row) => [...row.values()]))
      .some(({ hrefs }) => hrefs.some((href) => href.endsWith(".html"))),
  );
});

test("the page of what is not shown lists each record no view shows, with why, and links to its page", () => {
  const hidden = blockOf(page("not-shown.html"), "Why it is in no view");
  assert.ok(hidden.rows.length > 0);
  for (const row of hidden.rows) {
    assert.ok(row.get("why")?.value);
    assert.ok(
      row.get("record")?.hrefs.some((href) => pages.has(href)),
      row.get("record")?.value,
    );
  }
});

test("every internal link resolves to a file the build wrote, and every anchor to an id on its page", () => {
  const broken: string[] = [];
  for (const [path, { hrefs }] of pages) {
    for (const href of hrefs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const [file = "", anchor] = href.split("#");
      const target = file === "" ? path : file;
      if (
        !files.has(target) ||
        (anchor !== undefined && !pages.get(target)?.ids.has(anchor))
      )
        broken.push(`${path} -> ${href}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("text put in a page is never markup", () => {
  const label = `<script>alert(1)</script> " onmouseover="x' & y`;
  const page = markup`<p title="${label}">${label}</p>`.text;
  assert.ok(!page.includes("<script>") && !page.includes(`"x`));
  assert.match(
    page,
    /&lt;script&gt;alert\(1\)&lt;\/script&gt; &#34; onmouseover=&#34;x&#39; &amp; y/,
  );
});

test("a time is shown in UTC to the minute whatever its offset, and only an xsd:dateTime is", () => {
  const time = (value: string) => shown(literal(value, `${XSD}dateTime`));
  assert.equal(time("2027-01-01T09:00:00+05:00"), "2027-01-01 04:00 UTC");
  assert.equal(time("2027-01-01T09:00:00"), "2027-01-01 09:00 UTC");
  assert.equal(shown(literal("2027-01-01", `${XSD}date`)), "2027-01-01");
  assert.equal(shown(literal("2027-01-01T09:00:00Z")), "2027-01-01T09:00:00Z");
});

test("a site built under a lens other than the one `ask` and GraphDB use names that lens in every command it prints", async () => {
  const fallback = vocabulary.config.lens;
  const other = [...site.pipeline.keys()].find((lens) => lens !== fallback);
  assert.ok(other);
  const built = await (
    await Site.build({ ...options, lens: other, defaultLens: fallback })
  ).files();
  const home = readPage(new TextDecoder().decode(built.get("index.html")));
  const run = home.blocks.filter(({ said }) =>
    said.includes("Run it yourself"),
  );
  assert.ok(run.length > 0);
  for (const { title, said } of run) {
    assert.ok(said.includes(`--lens ${other}`), title);
    assert.ok(said.includes(`under the ${fallback} lens only`), title);
  }
  for (const { title, said } of page("index.html").blocks)
    assert.ok(!said.includes("--lens"), title);
});

/** The Pages tree over the suite's site, built once for the tests of its two pages. */
async function pagesOf() {
  const kits = await kitsOf(vocabulary.files);
  assert.ok(kits.length > 0);
  const examples = await Promise.all(
    kits.map(async (kit) => ({
      folder: kit.slice(kit.lastIndexOf("/") + 1),
      title: await titleOf(vocabulary.files, kit),
      site: files,
    })),
  );
  const vocabularyAt = {
    name: "cascade-vocabulary",
    version: vocabulary.resolved.version,
    href: vocabulary.resolved.iri,
  };
  const built = {
    ingredients: [vocabularyAt],
    configured: [],
    at: "2026-03-03T08:00:00Z",
  };
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const start = await startOf(
    ROOT,
    commit,
    vocabulary.layout,
    examples[0]?.folder ?? "",
  );
  return {
    examples,
    vocabularyAt,
    built,
    commit,
    start,
    tree: pagesTree(examples, built, start),
  };
}
let pagesTreeOf: ReturnType<typeof pagesOf> | undefined;
const shared = () => (pagesTreeOf ??= pagesOf());

test("the Pages examples page links each kit of the vocabulary, by its name, to a site and a pod in the tree, and names what built it", async () => {
  const { examples, vocabularyAt, tree } = await shared();
  const text = new TextDecoder().decode(tree.get(EXAMPLES_PAGE));
  const front = readPage(text);
  for (const { folder, title } of examples)
    assert.ok(
      text.includes(`<a href="${folder}/index.html">${escape(title)}</a>`),
      title,
    );
  const local = front.hrefs.filter((href) => !/^https?:/.test(href));
  assert.ok(local.length > examples.length);
  for (const href of local) assert.ok(tree.has(href), href);
  assert.ok(front.hrefs.includes(vocabularyAt.href));
});

test("the Pages front page gives the example's pod, the kinds a pod holds, the command and the prompt, and links only what the tree holds", async () => {
  const { examples, built, commit, start, tree } = await shared();
  const { tarballAddress, startLine, agentPrompt } = await startFunctions(ROOT);
  const address = tarballAddress(commit);
  const text = new TextDecoder().decode(tree.get(FRONT_PAGE));
  const front = readPage(text);
  assert.deepEqual(front.code, [
    startLine(address, "my-app"),
    agentPrompt("my-app"),
  ]);
  assert.equal(front.said.split(address).length - 1, 1);
  const titles = vocabulary.layout.views.map(({ title }) => title ?? "");
  assert.ok(titles.length > 0);
  assert.ok(front.said.includes(titles.join(" ")));
  assert.deepEqual(
    front.hrefs.filter((href) => !tree.has(href)),
    [],
    "a link to a file the tree does not hold",
  );
  for (const href of [
    `${start.example}/index.html`,
    `${start.example}/pod/manifest.ttl`,
    EXAMPLES_PAGE,
  ])
    assert.ok(front.hrefs.includes(href), href);
  assert.ok(!front.hrefs.includes(TRY_PAGE));
  assert.throws(
    () => pagesTree(examples, built, { ...start, example: "nobody" }),
    /nobody/,
  );
});
