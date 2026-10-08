import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  type Files,
  fileStem,
  iri,
  literal,
  MemoryFiles,
  ntriples,
  OxigraphStore,
  tableTerms,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  findRoot,
  FolderFiles,
} from "@cascade-runtime/runtime/node";
import { partsOf, type ResolvedParts } from "../src/node/resolved.js";
import { openPodWith } from "../src/pod.js";
import { RULE_LIST, Tables } from "../src/tables.js";

const FEED = "https://tables.example/feed.ttl";
const DCAT = "http://www.w3.org/ns/dcat#";
const SPDX = "http://spdx.org/rdf/terms#";
const PROV = "http://www.w3.org/ns/prov#";
const CURRENT = `${DCAT}hasCurrentVersion`;
const REVISION_OF = `${PROV}wasRevisionOf`;
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const PREFIXES = `PREFIX jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pav: <http://purl.org/pav/>
PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
PREFIX health: <https://ns.cascadeprotocol.org/health/v1#>
`;

/** The test feed as it is served: its catalog and each file under it, by URL. */
interface Served {
  readonly catalog: readonly Triple[];
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** What is served as the feed in place of its catalog. */
  readonly text?: string;
  /** The URL whose download breaks off. */
  readonly broken?: string;
}

let parts: ResolvedParts;
let feed: Served;
/** The test feed with each series' first version current. */
let first: Served;
/** The test feed's vaccine-groups series, its first version and its second. */
let groups: { series: string; first: string; second: string };
let scratch: string;

before(async () => {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  const components = await checkouts(root);
  parts = await partsOf(components);
  const { folder } = await components.resolve(
    components.config.tables.repository,
  );
  const valid = join(folder, "fixtures", "feeds", "valid");
  const catalog = await new OxigraphStore().parse(
    await readFile(join(valid, "feed.ttl")),
    FEED,
  );
  const files = new Map<string, Uint8Array>();
  for (const [, predicate, url] of catalog)
    if (predicate.value === `${DCAT}downloadURL`)
      files.set(
        url.value,
        await readFile(join(valid, ...new URL(url.value).pathname.split("/"))),
      );
  feed = { catalog, files };
  const revised = (version: string): string =>
    catalog.find(
      ([subject, predicate]) =>
        subject.value === version && predicate.value === REVISION_OF,
    )?.[2].value ?? version;
  first = {
    files,
    catalog: catalog.map(([subject, predicate, object]) =>
      predicate.value === CURRENT
        ? [subject, predicate, iri(revised(object.value))]
        : [subject, predicate, object],
    ),
  };
  const series = catalog.find(
    ([, predicate, object]) =>
      predicate.value.endsWith("#tableKind") &&
      object.value.endsWith("#VaccineGroups"),
  )?.[0].value;
  const second = catalog.find(
    ([subject, predicate]) =>
      subject.value === series && predicate.value === CURRENT,
  )?.[2].value;
  assert.ok(series !== undefined && second !== undefined);
  groups = { series, second, first: revised(second) };
  assert.notEqual(groups.first, second);
  scratch = await mkdtemp(join(tmpdir(), "cascade-tables-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function fetchOf(served: Served): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === served.broken)
      return new Response(
        new ReadableStream({
          start: (controller) =>
            controller.error(new TypeError("the connection was reset")),
        }),
      );
    if (url === FEED)
      return new Response(
        served.text ?? new TextDecoder().decode(ntriples(served.catalog)),
      );
    const bytes = served.files.get(url);
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes.slice());
  };
}

function tablesOver(
  served: Served,
  files = new MemoryFiles("urn:test:tables/"),
  vocabulary: Files = parts.vocabulary,
): Tables {
  return new Tables({
    files,
    feeds: [FEED],
    vocabulary,
    newStore: parts.newStore,
    fetch: fetchOf(served),
  });
}

/** The vocabulary as a package shipping a revision of its rule list would carry it: the same rules, a new version. */
async function ruleListRevised(): Promise<Files> {
  const { vocabulary } = parts;
  const index = new TextDecoder().decode(
    await vocabulary.read(`${RULE_LIST}references.ttl`),
  );
  const [, shipped] = /rec:shipsWith <([^>]+)>/.exec(index) ?? [];
  const [, series] = /<([^>]+)> a rec:ReferenceSeries/.exec(index) ?? [];
  assert.ok(shipped !== undefined && series !== undefined);
  const next = "urn:uuid:0b8f3c1e-6d2a-4e5b-9c7f-1a2b3c4d5e6f";
  const rows = await vocabulary.read(`${RULE_LIST}${fileStem(shipped)}.ttl`);
  assert.ok(rows);
  const files = new Map([
    [
      `${RULE_LIST}references.ttl`,
      new TextEncoder().encode(
        `${index.replace(`rec:shipsWith <${shipped}>`, `rec:shipsWith <${next}>`)}
<${next}> a prov:Entity ; prov:specializationOf <${series}> ; prov:wasRevisionOf <${shipped}> ; pav:version "2" .
`,
      ),
    ],
    [`${RULE_LIST}${fileStem(next)}.ttl`, rows],
  ]);
  return {
    iri: vocabulary.iri,
    read: async (path) => files.get(path) ?? vocabulary.read(path),
    write: (path, bytes) => vocabulary.write(path, bytes),
    list: (folder) => vocabulary.list(folder),
  };
}

/** The vocabulary with its records ontology changed by `change`. */
function recordsChanged(change: (turtle: string) => string): Files {
  const { vocabulary } = parts;
  return {
    iri: vocabulary.iri,
    read: async (path) => {
      const bytes = await vocabulary.read(path);
      return bytes === undefined || !path.endsWith("records.ttl")
        ? bytes
        : new TextEncoder().encode(change(new TextDecoder().decode(bytes)));
    },
    write: (path, bytes) => vocabulary.write(path, bytes),
    list: (folder) => vocabulary.list(folder),
  };
}

/** The URL of a version's rows. */
function rowsUrl(served: Served, version: string): string {
  const distribution = served.catalog.find(
    ([subject, predicate]) =>
      subject.value === version && predicate.value === `${DCAT}distribution`,
  )?.[2];
  const url = served.catalog.find(
    ([subject, predicate]) =>
      subject.value === distribution?.value &&
      predicate.value === `${DCAT}downloadURL`,
  )?.[2].value;
  assert.ok(url);
  return url;
}

async function gunzipped(bytes: Uint8Array): Promise<string> {
  return new Response(
    new Blob([bytes.slice()])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
  ).text();
}

async function gzipped(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}

async function hex(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The feed with the version's rows changed by `change`, and the checksum the feed gives for them made theirs. */
async function withRows(
  served: Served,
  version: string,
  change: (nquads: string) => string,
): Promise<Served> {
  const was = served.files.get(rowsUrl(served, version));
  assert.ok(was);
  return withBytes(
    served,
    version,
    await gzipped(change(await gunzipped(was))),
  );
}

/** The feed serving the bytes as the version's rows, and giving their checksum. */
async function withBytes(
  served: Served,
  version: string,
  bytes: Uint8Array,
): Promise<Served> {
  const url = rowsUrl(served, version);
  const was = served.files.get(url);
  assert.ok(was);
  const [oldSum, newSum] = [await hex(was), await hex(bytes)];
  return {
    files: new Map([...served.files, [url, bytes]]),
    catalog: served.catalog.map(([subject, predicate, object]) =>
      predicate.value === `${SPDX}checksumValue` && object.value === oldSum
        ? [subject, predicate, literal(newSum)]
        : [subject, predicate, object],
    ),
  };
}

test("a pod keeps the tables it was opened with; opened after a check keeps the planted newer version, it adopts it: it records the version, files the Same it newly joins and files again the Same that used the replaced one; and opened after the rule list is revised, it is opened with that; a pod in memory is recorded as opened with nothing", async () => {
  const store = new MemoryFiles("urn:test:tables/");
  const before = tablesOver(first, store);
  const [kept] = await before.check();
  assert.equal(kept?.kept.length, 3);
  assert.ok((await before.current()).includes(groups.first));

  const folder = join(scratch, "pods", "hana");
  let pod = await openPodWith({ ...parts, tables: before }, folder);
  const relabelled = "Vaccine groups, relabelled";
  const after = tablesOver(
    {
      ...feed,
      catalog: feed.catalog.map(([subject, predicate, object]) =>
        subject.value === groups.series && predicate.value === `${RDFS}label`
          ? [subject, predicate, literal(relabelled)]
          : [subject, predicate, object],
      ),
    },
    store,
  );
  const [checked] = await after.check({ cache: "no-cache" });
  assert.deepEqual(checked?.refused, []);
  assert.ok(checked?.kept.includes(groups.second));
  assert.deepEqual(
    (await after.references())
      .description(groups.series)
      .filter(([, predicate]) => predicate.value === `${RDFS}label`)
      .map(([, , label]) => label.value),
    [relabelled],
  );
  const shots = [
    ["141", "2025-10-01"],
    ["150", "2025-10-01"],
    ["140", "2024-10-01"],
    ["141", "2024-10-01"],
  ].map(
    (
      [code, date],
      index,
    ) => `<urn:cascade:output-${index}> a health:ImmunizationRecord .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  health:vaccineCode "${code}" ; health:administrationDate "${date}"^^<http://www.w3.org/2001/XMLSchema#date> ;
  rec:patient <${pod.subject}> .`,
  );
  const entered = await pod.enter(`${PREFIXES}
<urn:cascade:this-entry> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole jdg:patient ] .
${shots.join("\n")}`);
  assert.equal(entered.refused, undefined);
  assert.equal(entered.matched?.refused, undefined);
  await pod.close();

  pod = await openPodWith({ ...parts, tables: after }, folder);
  try {
    assert.equal(pod.opened?.refused, undefined);
    assert.deepEqual(pod.opened?.unheld, []);
    assert.deepEqual(
      await pod.ask({
        query: `${PREFIXES}SELECT ?version WHERE { <${groups.series}> pav:hasCurrentVersion ?version }`,
      }),
      [{ version: groups.second }],
    );
    const sames = await pod.ask({
      query: `${PREFIXES}SELECT ?used (GROUP_CONCAT(?code; separator=" ") AS ?codes) WHERE {
        ?judgment jdg:justification jdg:SameMappedCodeAndDate ; prov:used ?used ; prov:hadMember ?record .
        VALUES ?used { <${groups.first}> <${groups.second}> }
        ?record pav:hasCurrentVersion/health:vaccineCode ?code
      } GROUP BY ?judgment ?used`,
    });
    const codes = ({ used = "", codes = "" }) =>
      `${used === groups.first ? "first" : "second"}: ${codes.split(" ").sort().join(" ")}`;
    assert.deepEqual(sames.map(codes).sort(), [
      "first: 141 150",
      "second: 140 141",
      "second: 141 150",
    ]);
  } finally {
    await pod.close();
  }
  const again = await openPodWith({ ...parts, tables: after }, folder);
  assert.equal(again.opened, undefined);
  await again.close();

  const empty = join(scratch, "pods", "empty");
  await (await openPodWith({ ...parts, tables: after }, empty)).close();
  const revised = await openPodWith(
    { ...parts, tables: tablesOver(feed, store, await ruleListRevised()) },
    empty,
  );
  assert.ok(revised.opened);
  assert.equal(revised.opened.refused, undefined);
  await revised.close();

  const inMemory = await openPodWith({ ...parts, tables: after }, undefined);
  assert.equal(await after.openedWith(inMemory.address), undefined);
  await inMemory.close();
});

test("the app tells what it holds: each series with its versions, credit and how fresh its feed is, the pods that use each version by name, and the codes a search finds by code or by name, named and mapped", async () => {
  const of = (subject: string, predicate: string): string | undefined =>
    feed.catalog.find(
      ([s, p]) => s.value === subject && p.value === predicate,
    )?.[2].value;
  const source = of(groups.series, "http://purl.org/dc/terms/source") ?? "";
  const watched = { at: "2026-10-08T19:00:00Z", found: "nothing new" };
  const store = new MemoryFiles("urn:test:tables/");
  await tablesOver(first, store).check();
  const folder = join(scratch, "pods", "uses");
  await (
    await openPodWith({ ...parts, tables: tablesOver(first, store) }, folder)
  ).close();
  const tables = tablesOver(
    {
      ...feed,
      files: new Map([
        ...feed.files,
        [
          new URL("checked.json", FEED).href,
          new TextEncoder().encode(
            JSON.stringify({
              checked: { [source]: { label: "example", ...watched } },
            }),
          ),
        ],
      ]),
    },
    store,
  );
  await tables.check();

  const held = await tables.held();
  const label = (series: string): string =>
    of(series, `${RDFS}label`) ?? series;
  assert.deepEqual(
    held.map((series) => series.label),
    held.map((series) => label(series.iri)).sort(),
  );
  const vaccineGroups = held.find((series) => series.iri === groups.series);
  assert.ok(vaccineGroups);
  assert.deepEqual(
    vaccineGroups.versions.map((version) => version.iri),
    [groups.second, groups.first],
  );
  assert.equal(
    vaccineGroups.credit,
    of(groups.series, "http://purl.org/dc/terms/bibliographicCitation"),
  );
  assert.deepEqual(vaccineGroups.watched, watched);
  assert.equal(vaccineGroups.feed, FEED);
  assert.deepEqual((await tables.uses())[groups.first], ["uses"]);

  const names = held.find((series) => series.kind?.endsWith("#CodeNames"));
  assert.ok(names);
  const nameRows = await gunzipped(
    feed.files.get(rowsUrl(feed, names.current.iri)) ?? new Uint8Array(),
  );
  const nameOf = (code: string): string | undefined =>
    new RegExp(`/cvx/${code}> <[^>]*#prefLabel> "([^"]*)"`).exec(nameRows)?.[1];
  const [shot, ...others] = (await tables.search(groups.series, "141")).found;
  assert.equal(others.length, 0);
  assert.equal(shot?.notation, "141");
  assert.equal(shot.about?.name?.label, nameOf("141"));
  assert.ok(shot.mapsTo.length > 0);
  for (const group of shot.mapsTo)
    assert.equal(group.about?.name?.label, nameOf(group.notation));
  const named = await tables.search(names.iri, "SPLIT VIRUS");
  assert.ok(named.found.some(({ notation }) => notation === "141"));
  for (const { about } of named.found)
    assert.ok(
      [about?.name?.label ?? "", ...(about?.name?.altLabels ?? [])].some(
        (text) => text.toLowerCase().includes("split virus"),
      ),
    );
});

test("a store emptied while the app runs, as Reset all data empties it, starts again from the starter copies", async () => {
  const starter = new MemoryFiles("urn:test:starter/");
  await tablesOver(first, starter).check();
  const app = join(scratch, "reset");
  const tables = new Tables({
    files: new FolderFiles(join(app, ".tables")),
    feeds: [FEED],
    vocabulary: parts.vocabulary,
    newStore: parts.newStore,
    starter,
  });
  const shipped = await tables.current();
  assert.ok(shipped.includes(groups.first));
  await rm(app, { recursive: true, force: true });
  assert.deepEqual(await tables.current(), shipped);
});

test("the rows a pod's codes find are those found by them, by the kind's property or the row's own code, and no others", async () => {
  const tables = tablesOver(feed);
  await tables.check();
  const references = await tables.references();
  const cvx141 = "http://hl7.org/fhir/sid/cvx/141";
  const names = feed.catalog.find(
    ([subject, predicate]) =>
      predicate.value === CURRENT &&
      feed.catalog.some(
        ([s, , o]) =>
          s.value === subject.value && o.value.endsWith("#CodeNames"),
      ),
  )?.[2].value;
  assert.ok(names);
  const subjects = (rows: readonly Triple[]): string[] =>
    [...new Set(rows.map(([subject]) => subject.value))].sort();
  const sources = (rows: readonly Triple[]): string[] =>
    rows
      .filter(([, predicate]) => predicate.value.endsWith("#annotatedSource"))
      .map(([, , object]) => object.value);

  const find = {
    codes: new Set([cvx141]),
    terms: await tableTerms(parts.vocabulary, parts.newStore),
  };
  const found = await references.rows(groups.second, find);
  assert.deepEqual(sources(found), [cvx141]);
  assert.ok(
    subjects(await references.rows(groups.second)).length >
      subjects(found).length,
  );
  assert.deepEqual(subjects(await references.rows(names, find)), [cvx141]);
});

test("rows are found through no index that is unreadable, or was built for a kind found by nothing or by fewer properties: the rows a code finds are among them", async () => {
  const checked = tablesOver(feed);
  await checked.check();
  const all = await (await checked.references()).rows(groups.second);
  const [, , target] =
    all.find(([, predicate]) => predicate.value.endsWith("#annotatedTarget")) ??
    [];
  assert.ok(target !== undefined);
  const cvx141 = "http://hl7.org/fhir/sid/cvx/141";
  const source = "rec:foundBy owl:annotatedSource .";
  const cases: [string, Files, (files: Files) => Promise<void>, string][] = [
    [
      "unreadable",
      parts.vocabulary,
      (files) =>
        files.write(
          `${fileStem(groups.second)}.codes.json`,
          new TextEncoder().encode("{"),
        ),
      cvx141,
    ],
    [
      "found by nothing",
      recordsChanged((turtle) =>
        turtle.replace(source, "rdfs:seeAlso owl:annotatedSource ."),
      ),
      async () => {},
      cvx141,
    ],
    ["found by fewer", parts.vocabulary, async () => {}, target.value],
  ];
  const reading = recordsChanged((turtle) =>
    turtle.replace(
      source,
      "rec:foundBy owl:annotatedSource , owl:annotatedTarget .",
    ),
  );
  for (const [name, vocabulary, change, code] of cases) {
    const files = new MemoryFiles("urn:test:tables/");
    await tablesOver(feed, files, vocabulary).check();
    await change(files);
    const references = await tablesOver(feed, files, reading).references();
    const found = new Set(
      (
        await references.rows(groups.second, {
          codes: new Set([code]),
          terms: await tableTerms(reading, parts.newStore),
        })
      ).map(([subject]) => subject.value),
    );
    const wanted = all.filter(
      ([, predicate, object]) =>
        /#annotated(Source|Target)$/.test(predicate.value) &&
        object.value === code,
    );
    assert.ok(wanted.length > 0, name);
    for (const [subject] of wanted) assert.ok(found.has(subject.value), name);
  }
});

test("a check whose read of the vocabulary fails keeps the version a later check reads it for", async () => {
  let failed = false;
  const { vocabulary } = parts;
  const once: Files = {
    iri: vocabulary.iri,
    read: async (path) => {
      if (path.endsWith("records.ttl") && !failed) {
        failed = true;
        throw new Error("the vocabulary could not be read");
      }
      return vocabulary.read(path);
    },
    write: (path, bytes) => vocabulary.write(path, bytes),
    list: (folder) => vocabulary.list(folder),
  };
  const tables = tablesOver(feed, new MemoryFiles("urn:test:tables/"), once);
  await assert.rejects(tables.check(), /could not be read/);
  await tables.check();
  assert.ok((await tables.references()).isVersion(groups.second));
});

test("a check keeps nothing of a version that does not verify, and tries a feed or rows it cannot read later", async () => {
  const cases: [string, () => Promise<Served>, RegExp, "refused" | "later"][] =
    [
      [
        "rows not of the checksum the feed gives",
        async () => ({
          ...feed,
          files: new Map([
            ...feed.files,
            [rowsUrl(feed, groups.second), await gzipped("")],
          ]),
        }),
        /checksum/,
        "refused",
      ],
      [
        "rows that do not give the version's name",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace("/cvx/140>", "/cvx/149>"),
          ),
        /name/,
        "refused",
      ],
      [
        "a row outside the version's graph",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace(`<${groups.second}> .`, "<urn:example:other> ."),
          ),
        /outside the graph/,
        "refused",
      ],
      [
        "rows that are not N-Quads",
        () =>
          withRows(
            feed,
            groups.second,
            (nquads) => `${nquads}not a quad <${groups.second}> .\n`,
          ),
        /not N-Quads/,
        "refused",
      ],
      [
        "rows that are not gzip",
        () =>
          withBytes(feed, groups.second, new TextEncoder().encode("not gzip")),
        /not gzip/,
        "refused",
      ],
      [
        "rows whose download breaks off",
        async () => ({ ...feed, broken: rowsUrl(feed, groups.second) }),
        /could not be read: the connection was reset/,
        "later",
      ],
      [
        "a feed whose download breaks off",
        async () => ({ ...feed, broken: FEED }),
        /could not be read: the connection was reset/,
        "later",
      ],
      [
        "rows the feed's site no longer serves",
        async () => ({
          ...feed,
          files: new Map(
            [...feed.files].filter(
              ([url]) => url !== rowsUrl(feed, groups.second),
            ),
          ),
        }),
        /404/,
        "later",
      ],
      [
        "a feed that is not Turtle",
        async () => ({ ...feed, text: "<not> <Turtle" }),
        /not Turtle/,
        "later",
      ],
    ];
  const store = new MemoryFiles("urn:test:tables/");
  await tablesOver(first, store).check();
  for (const [input, served, reason, outcome] of cases) {
    const tables = tablesOver(await served(), store);
    const [checked] = await tables.check();
    const said =
      outcome === "later"
        ? (checked?.later ?? "")
        : (checked?.refused.find(({ version }) => version === groups.second)
            ?.reason ?? "");
    assert.match(said, reason, input);
    assert.ok(!checked?.kept.includes(groups.second), input);
    assert.ok(!(await tables.current()).includes(groups.second), input);
    assert.equal(
      await store.read(`${fileStem(groups.second)}.ttl`),
      undefined,
      input,
    );
  }
});
