import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  RDF,
  Refusal,
  tableTerms,
  tablesSettings,
  type Triple,
  withTables,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  type Components,
  findRoot,
  FolderFiles,
} from "@cascade-runtime/runtime/node";
import {
  appSettings,
  configureTables,
  partsOf,
  type ResolvedParts,
  resolved,
} from "../src/node/resolved.js";
import { openPodWith } from "../src/pod.js";
import { listing } from "../src/rows.js";
import {
  type Checked,
  LISTED,
  RULE_LIST,
  PAGE_SIZE,
  PUBLISHED_ROWS,
  Tables,
  versionName,
  writeStarterCopies,
} from "../src/tables.js";

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

let components: Components;
let parts: ResolvedParts;
let feed: Served;
/** The test feed with each series' first version current. */
let first: Served;
/** The test feed's vaccine-groups series, its first version and its second. */
let groups: { series: string; first: string; second: string };
let scratch: string;

before(async () => {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  components = await checkouts(root);
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

/** The vocabulary's rule list index, the revision it ships and that revision's series. */
async function ruleList(): Promise<{
  index: string;
  shipped: string;
  series: string;
}> {
  const index = new TextDecoder().decode(
    await parts.vocabulary.read(`${RULE_LIST}references.ttl`),
  );
  const [, shipped] = /rec:shipsWith <([^>]+)>/.exec(index) ?? [];
  const [, series] = /<([^>]+)> a rec:ReferenceSeries/.exec(index) ?? [];
  assert.ok(shipped !== undefined && series !== undefined);
  return { index, shipped, series };
}

/** The vocabulary as a package shipping a revision of its rule list would carry it: the same rules, a new version. */
async function ruleListRevised(): Promise<Files> {
  const { vocabulary } = parts;
  const { index, shipped, series } = await ruleList();
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

const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm/";
const ICD10CM = "http://hl7.org/fhir/sid/icd-10-cm/";

/** A mapping series of the test feed: its kind, the code system its rows' codes are in, and their predicate. */
interface Mapping {
  readonly series: string;
  readonly label: string;
  readonly kind: string;
  readonly system: string;
  readonly predicate: string;
  /** How the row from `source` to `target` was reached. */
  readonly justification: (source: string, target: string) => string;
}

const INGREDIENTS: Mapping = {
  series: "urn:uuid:3f1d9b7e-2c4a-4e8f-a6d5-9b0c1e2f3a4b",
  label: "Product ingredients",
  kind: "ProductIngredients",
  system: RXNORM,
  predicate: "broadMatch",
  justification: (source, target) =>
    source === target ? "ManualMappingCuration" : "MappingChaining",
};

const CONVERSIONS: Mapping = {
  series: "urn:uuid:6b1e0c3a-9f4d-4e27-8a5b-2d7c9e1f4a60",
  label: "Code conversions",
  kind: "CodeConversions",
  system: ICD10CM,
  predicate: "exactMatch",
  justification: () => "ManualMappingCuration",
};

/**
 * The feed with a mapping series added, its line of versions each holding the rows given as `[source, target]` and
 * the last current, and the names of those versions.
 */
async function withMappings(
  served: Served,
  mapping: Mapping,
  line: readonly (readonly (readonly [string, string])[])[],
): Promise<{ served: Served; versions: string[] }> {
  const files = new Map(served.files);
  const versions: string[] = [];
  let turtle = `@prefix dcat: <${DCAT}> . @prefix pav: <http://purl.org/pav/> . @prefix prov: <${PROV}> .
@prefix rdfs: <${RDFS}> . @prefix rec: <${REC}> . @prefix spdx: <${SPDX}> .
<${mapping.series}> a rec:ReferenceSeries ; rdfs:label "${mapping.label}" ; rec:tableKind rec:${mapping.kind} .
`;
  for (const [index, pairs] of line.entries()) {
    const rows = pairs.flatMap(([source, target]) => {
      const subject = iri(`urn:test:${mapping.kind}-row:${source}-${target}`);
      return [
        [
          subject,
          iri(`${RDF}type`),
          iri("http://www.w3.org/2002/07/owl#Axiom"),
        ],
        [
          subject,
          iri("http://www.w3.org/2002/07/owl#annotatedSource"),
          iri(mapping.system + source),
        ],
        [
          subject,
          iri("http://www.w3.org/2002/07/owl#annotatedProperty"),
          iri(`http://www.w3.org/2004/02/skos/core#${mapping.predicate}`),
        ],
        [
          subject,
          iri("http://www.w3.org/2002/07/owl#annotatedTarget"),
          iri(mapping.system + target),
        ],
        [
          subject,
          iri("https://w3id.org/sssom/mapping_justification"),
          iri(
            `https://w3id.org/semapv/vocab/${mapping.justification(source, target)}`,
          ),
        ],
      ] as Triple[];
    });
    const previous = versions.at(-1);
    const version = await versionName(mapping.series, previous, rows);
    const bytes = await gzipped(
      new TextDecoder()
        .decode(ntriples(rows))
        .split("\n")
        .filter((nt) => nt.trim() !== "")
        .map((nt) => `${nt.replace(/\s*\.\s*$/, "")} <${version}> .`)
        .sort()
        .join("\n"),
    );
    const url = `https://tables.example/rows/${mapping.kind}-${index}.nq.gz`;
    files.set(url, bytes);
    turtle += `<${version}> prov:specializationOf <${mapping.series}> ; pav:version "${index + 1}" ;
  ${previous === undefined ? "" : `prov:wasRevisionOf <${previous}> ;`}
  dcat:distribution [ dcat:downloadURL <${url}> ; spdx:checksum [ spdx:checksumValue "${await hex(bytes)}" ] ] .
`;
    versions.push(version);
  }
  turtle += `<${mapping.series}> dcat:hasCurrentVersion <${versions.at(-1)}> .`;
  const added = await new OxigraphStore().parse(turtle, FEED);
  return {
    served: { ...served, files, catalog: [...served.catalog, ...added] },
    versions,
  };
}

test("a pod keeps the tables it was opened with; opened after a check keeps the planted newer version, it adopts it: it records the version, files the Same it newly joins and files again the Same that used the replaced one, a brand allergy and its ingredient's among them by the vocabulary's R3 and, from a series it newly holds, a condition on a retired code and its conversion's by R7; and opened after the rule list is revised, it is opened with that; a pod in memory is recorded as opened with nothing", async () => {
  const advil: [string, string] = ["153010", "5640"];
  const ibuprofen: [string, string] = ["5640", "5640"];
  const ingredientsFirst = await withMappings(first, INGREDIENTS, [
    [advil, ibuprofen],
  ]);
  const ingredientsLater = await withMappings(feed, INGREDIENTS, [
    [advil, ibuprofen],
    // A row the first lacks, so the later is a version of its own.
    [advil, ibuprofen, ["723", "723"]],
  ]);
  const later = await withMappings(ingredientsLater.served, CONVERSIONS, [
    [["C88.0", "C88.00"]],
  ]);
  const store = new MemoryFiles("urn:test:tables/");
  const before = tablesOver(ingredientsFirst.served, store);
  const [kept] = await before.check();
  assert.equal(kept?.kept.length, 4);
  assert.ok((await before.current()).includes(groups.first));

  const folder = join(scratch, "pods", "hana");
  let pod = await openPodWith({ ...parts, tables: before }, folder);
  const relabelled = "Vaccine groups, relabelled";
  const after = tablesOver(
    {
      ...later.served,
      catalog: later.served.catalog.map(([subject, predicate, object]) =>
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
  const records = [
    ...[
      ["141", "2025-10-01"],
      ["150", "2025-10-01"],
      ["140", "2024-10-01"],
      ["141", "2024-10-01"],
    ].map(([code, date]) => [
      "health:ImmunizationRecord",
      `health:vaccineCode "${code}" ; health:administrationDate "${date}"^^<http://www.w3.org/2001/XMLSchema#date>`,
    ]),
    ...["153010", "5640"].map((code) => [
      "health:AllergyRecord",
      `health:allergenCode <${RXNORM}${code}>`,
    ]),
    ...["C88.0", "C88.00"].map((code) => [
      "health:ConditionRecord",
      `health:icd10Code <${ICD10CM}${code}>`,
    ]),
  ].map(
    ([type, fields], index) => `<urn:cascade:output-${index}> a ${type} .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  ${fields} ; rec:patient <${pod.subject}> .`,
  );
  const entered = await pod.enter(`${PREFIXES}
<urn:cascade:this-entry> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole jdg:patient ] .
${records.join("\n")}`);
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
    const [held] = ingredientsFirst.versions;
    const [, adopted] = ingredientsLater.versions;
    const brands = await pod.ask({
      query: `${PREFIXES}SELECT ?used (GROUP_CONCAT(STR(?code); separator=" ") AS ?codes) WHERE {
        ?judgment jdg:justification jdg:SameMappedCode ; prov:used ?used ; prov:hadMember ?record .
        VALUES ?used { <${held}> <${adopted}> }
        ?record pav:hasCurrentVersion/health:allergenCode ?code
      } GROUP BY ?judgment ?used`,
    });
    const allergens = ({ used = "", codes = "" }) =>
      `${used === held ? "held" : "adopted"}: ${codes.replaceAll(RXNORM, "").split(" ").sort().join(" ")}`;
    assert.deepEqual(brands.map(allergens).sort(), [
      "adopted: 153010 5640",
      "held: 153010 5640",
    ]);
    const [converted] = later.versions;
    const { shipped } = await ruleList();
    const conversions = await pod.ask({
      query: `${PREFIXES}SELECT (GROUP_CONCAT(STR(?code); separator=" ") AS ?codes) WHERE {
        ?judgment jdg:justification jdg:SameConvertedCode ; prov:used <${converted}> , <${shipped}> ; prov:hadMember ?record .
        ?record pav:hasCurrentVersion/health:icd10Code ?code
      } GROUP BY ?judgment`,
    });
    assert.deepEqual(
      conversions.map(({ codes = "" }) =>
        codes.replaceAll(ICD10CM, "").split(" ").sort().join(" "),
      ),
      ["C88.0 C88.00"],
    );
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

test("a search pages through a series of more codes than a page, in the order of their codes, asking the names and status of only the codes on the page and those they map to", async () => {
  const count = PAGE_SIZE * 2 + 3;
  const { served } = await withMappings(feed, INGREDIENTS, [
    Array.from({ length: count }, (_, at) => [`${at + 1}`, "1"] as const),
  ]);
  const tables = tablesOver(served);
  await tables.check();
  const asked: string[] = [];
  const about = tables.about.bind(tables);
  tables.about = (codes) => {
    asked.push(...codes);
    return about(codes);
  };

  const pages = [];
  for (const page of [1, 2, 3, 4]) {
    asked.length = 0;
    const searched = await tables.search(INGREDIENTS.series, "", page);
    assert.equal(searched.total, count);
    assert.equal(searched.offset, (page - 1) * PAGE_SIZE);
    assert.deepEqual(
      new Set(asked),
      new Set(searched.found.flatMap(({ code }) => [code, `${RXNORM}1`])),
    );
    pages.push(searched.found.map(({ notation }) => notation));
  }
  assert.deepEqual(
    pages.map((page) => page.length),
    [PAGE_SIZE, PAGE_SIZE, 3, 0],
  );
  assert.deepEqual(
    pages.flat(),
    Array.from({ length: count }, (_, at) => `${at + 1}`),
  );
});

test("a search lists a version again when the listing kept beside it is not one, or was listed in another shape or by other code systems", async () => {
  const path = `${fileStem(groups.second)}${LISTED}`;
  const checked = new MemoryFiles("urn:test:tables/");
  await tablesOver(feed, checked).check();
  const valid = JSON.parse(
    new TextDecoder().decode(await checked.read(path)),
  ) as Record<string, unknown>;
  const cvx141 = "http://hl7.org/fhir/sid/cvx/141";
  for (const kept of [
    "{",
    JSON.stringify({ ...valid, mapsTo: null }),
    JSON.stringify({ ...valid, codes: [], names: null }),
    JSON.stringify({ ...valid, names: { [cvx141]: 141 } }),
    JSON.stringify({ ...valid, codes: [], format: 0 }),
    JSON.stringify({ ...valid, codes: [], uriSpaces: ["urn:test:other:"] }),
  ]) {
    const files = new MemoryFiles("urn:test:tables/");
    await tablesOver(feed, files).check();
    await files.write(path, new TextEncoder().encode(kept));
    const { found } = await tablesOver(feed, files).search(
      groups.series,
      "141",
    );
    assert.deepEqual(
      found.map(({ notation }) => notation),
      ["141"],
      kept,
    );
  }
});

test("a version's listing names every code its rows give a preferred name, in a code system's URI space or not, as what the tables say of a code does", () => {
  const space = "http://hl7.org/fhir/sid/cvx/";
  const outside = "urn:test:outside:1";
  const label = "http://www.w3.org/2004/02/skos/core#prefLabel";
  const other = "http://www.w3.org/2004/02/skos/core#altLabel";
  assert.deepEqual(
    Object.keys(
      listing(
        `<${space}141> <${label}> "Flu" .\n<${space}88> <${other}> "Flu, any" .\n<${outside}> <${label}> "Other" .\n`,
        [space],
      ).names,
    ).sort(),
    [`${space}141`, outside].sort(),
  );
});

test("a version the tables name by no file is refused, by a search and by what the tables say of a code", async () => {
  const series = "urn:test:series";
  const version = "urn:test:no-file";
  const files = new MemoryFiles("urn:test:tables/");
  await files.write(
    "references.ttl",
    new TextEncoder().encode(
      `<${series}> <${REC}tableKind> <${REC}CodeNames> .
<${series}> <${REC}shipsWith> <${version}> .
<${version}> <${PROV}specializationOf> <${series}> .
`,
    ),
  );
  const tables = tablesOver(feed, files);
  await assert.rejects(tables.search(series, ""), Refusal);
  await assert.rejects(tables.about(["urn:test:code"]), Refusal);
});

test("the starter copies carry each version's rows as published, and a store emptied while the app runs, as Reset all data empties it, starts again from them with the rows a check keeps", async () => {
  const starter = new MemoryFiles("urn:test:starter/");
  await writeStarterCopies(
    {
      feeds: [FEED],
      vocabulary: parts.vocabulary,
      newStore: parts.newStore,
      fetch: fetchOf(first),
    },
    (path, bytes) => starter.write(path, bytes),
  );
  const carried = await starter.list("");
  const stem = fileStem(groups.first);
  assert.ok(carried.includes(`${stem}${PUBLISHED_ROWS}`));
  assert.ok(!carried.includes(`${stem}.ttl`));
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
  const checked = tablesOver(first);
  await checked.check();
  const rows = async (from: Tables) =>
    (await (await from.references()).rows(groups.first))
      .map((triple) => triple.map(({ value }) => value).join(" "))
      .sort();
  assert.deepEqual(await rows(tables), await rows(checked));
  await rm(app, { recursive: true, force: true });
  assert.deepEqual(await tables.current(), shipped);
});

test("a series of a kind nothing the app runs reads is neither kept nor carried as a starter copy, until a rule list names its kind", async () => {
  const unread = `${REC}BrandGenerics`;
  const served: Served = {
    ...first,
    catalog: first.catalog.map(([subject, predicate, object]) =>
      subject.value === groups.series && predicate.value === `${REC}tableKind`
        ? [subject, predicate, iri(unread)]
        : [subject, predicate, object],
    ),
  };
  const starter = new MemoryFiles("urn:test:starter/");
  await writeStarterCopies(
    {
      feeds: [FEED],
      vocabulary: parts.vocabulary,
      newStore: parts.newStore,
      fetch: fetchOf(served),
    },
    (path, bytes) => starter.write(path, bytes),
  );
  assert.ok(
    !(await starter.list("")).some((path) =>
      path.startsWith(fileStem(groups.first)),
    ),
  );
  const [unkept] = await tablesOver(served).check();
  assert.ok(!unkept?.kept.includes(groups.first));
  const { vocabulary } = parts;
  const naming: Files = {
    iri: vocabulary.iri,
    read: async (path) => {
      const bytes = await vocabulary.read(path);
      return bytes === undefined || !path.startsWith(RULE_LIST)
        ? bytes
        : new TextEncoder().encode(
            new TextDecoder()
              .decode(bytes)
              .replace("rec:VaccineGroups", "rec:BrandGenerics"),
          );
    },
    write: (path, bytes) => vocabulary.write(path, bytes),
    list: (folder) => vocabulary.list(folder),
  };
  const [kept] = await tablesOver(
    served,
    new MemoryFiles("urn:test:tables/"),
    naming,
  ).check();
  assert.ok(kept?.kept.includes(groups.first));
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
        "rows out of their canonical order",
        () =>
          withRows(feed, groups.second, (nquads) => {
            const lines = nquads.trimEnd().split("\n");
            return `${[lines.at(-1), ...lines.slice(0, -1)].join("\n")}\n`;
          }),
        /canonical order/,
        "refused",
      ],
      [
        "a row given twice",
        () =>
          withRows(
            feed,
            groups.second,
            (nquads) => `${nquads}${nquads.trimEnd().split("\n").at(-1)!}\n`,
          ),
        /canonical order/,
        "refused",
      ],
      [
        "a row not written canonically",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace("> <", ">  <"),
          ),
        /not N-Quads/,
        "refused",
      ],
      [
        "a row with a term after its literal",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace(
              "<http://www.w3.org/2004/02/skos/core#broadMatch>",
              '"broad" <urn:example:extra>',
            ),
          ),
        /not N-Quads/,
        "refused",
      ],
      [
        "a row whose IRI holds a space",
        () =>
          withRows(feed, groups.second, (nquads) =>
            nquads.replace("core#broadMatch>", "core#broad match>"),
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

const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const CVX_NAMES = "urn:uuid:f71f6797-48ec-4875-9b87-4cb1be1d9be0";
const CVX_STATUS = "urn:uuid:624f752e-dfba-45e7-a3e5-710ff7204a79";
const EXAMPLE_NAMES = "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c";
const EXAMPLE_STATUS = "urn:uuid:57b9415b-3531-4995-8dfb-48b69ead096f";
const HOST_ROOT = join(
  dirname(fileURLToPath(import.meta.resolve("cascade-reference-tables"))),
  "..",
  "..",
  "..",
);
const EXAMPLE_BUILDER = join(HOST_ROOT, "fixtures", "builder");

/** The test feed, and each builder's publisher serving its fixture release: 304 to a request asking if it changed. */
function publishersAnd(served: Served): typeof fetch {
  const cdc = "https://www2a.cdc.gov/vaccines/iis/iisstandards/downloads/";
  const cvx = join(HOST_ROOT, "builders", "cdc-cvx", "fixtures", "release");
  const releases = new Map([
    [`${cdc}CVX.txt`, join(cvx, "CVX.txt")],
    [`${cdc}VG.txt`, join(cvx, "VG.txt")],
    [
      "https://publisher.example/downloads/codes.txt",
      join(EXAMPLE_BUILDER, "fixtures", "release-2", "codes.txt"),
    ],
  ]);
  const feeds = fetchOf(served);
  return async (input, init) => {
    const path = releases.get(String(input));
    if (path === undefined) return feeds(input, init);
    return new Headers(init?.headers).has("If-Modified-Since")
      ? new Response(null, { status: 304 })
      : new Response(await readFile(path), {
          headers: { "Last-Modified": "Wed, 17 Sep 2026 00:00:00 GMT" },
        });
  };
}

/** The test feed's versions and those the CDC CVX builder and the example builder build locally, kept beside pods. */
const built = (() => {
  let checking: Promise<{ store: string; checked: Checked[][] }> | undefined;
  return () =>
    (checking ??= (async () => {
      const store = join(scratch, "built", ".tables");
      const local = await partsOf(components, {
        fetch: publishersAnd(feed),
        tables: { feeds: [FEED], builders: ["cdc-cvx", EXAMPLE_BUILDER] },
      });
      const tables = local.tablesIn(store);
      return { store, checked: [await tables.check(), await tables.check()] };
    })());
})();

test("a builder the configuration names runs locally and its versions are kept as a feed's; one that does not descend from the version held is refused; a check finding nothing new keeps nothing", async () => {
  const {
    checked: [first, second],
  } = await built();
  const [fromFeed, cvx, example] = first ?? [];
  assert.ok(fromFeed?.kept.includes(groups.second));
  assert.match(cvx?.feed ?? "", /^file:.*\/\.builds\/cdc-cvx\/feed\.ttl$/);
  assert.equal(cvx?.kept.length, 3);
  assert.deepEqual(cvx?.refused, []);
  assert.match(
    example?.refused.map(({ reason }) => reason).join("\n") ?? "",
    new RegExp(`does not descend from ${groups.second}`),
  );
  assert.deepEqual(
    second?.map(({ kept, later }) => ({ kept, later })),
    [
      { kept: [], later: undefined },
      { kept: [], later: undefined },
      { kept: [], later: undefined },
    ],
  );
});

test("a code's name and status come from the first series of their kinds, in the order of preference, that holds it, a later one where the first does not", async () => {
  const { store } = await built();
  const cvx141 = "http://hl7.org/fhir/sid/cvx/141";
  const cvx57 = "http://hl7.org/fhir/sid/cvx/57";
  const cvx03 = "http://hl7.org/fhir/sid/cvx/03";
  const unknown = "http://hl7.org/fhir/sid/cvx/999999";
  for (const [names, status, label] of [
    [CVX_NAMES, CVX_STATUS, "Influenza, split virus, trivalent, preservative"],
    [EXAMPLE_NAMES, EXAMPLE_STATUS, "flu, split"],
  ] as const) {
    const tables = (
      await partsOf(components, {
        tables: {
          feeds: [],
          preference: {
            [`${REC}CodeNames`]: [names],
            [`${REC}CodeStatus`]: [status],
          },
        },
      })
    ).tablesIn(store);
    const references = await tables.references();
    const about = await tables.about([cvx141, cvx57, cvx03, unknown]);
    const name = about.get(cvx141)?.name;
    assert.equal(name?.label, label);
    assert.equal(references.seriesOf(name?.origin ?? ""), names);
    for (const [code, holder] of [
      [cvx57, CVX_STATUS],
      [cvx03, EXAMPLE_STATUS],
    ] as const) {
      const retired = about.get(code)?.status;
      assert.equal(retired?.deprecated, true, code);
      assert.equal(references.seriesOf(retired?.origin ?? ""), holder, code);
    }
    assert.equal(about.has(unknown), false);
  }
});

test("an app's tables are the package's with each field of its own file, then of its code, in their place; and what an app cannot set is refused", async () => {
  const packaged = parts.local.config;
  const packageConfig = join(
    findRoot(dirname(fileURLToPath(import.meta.url))),
    "cascade-runtime.json",
  );
  const app = await mkdtemp(join(scratch, "app-"));
  const other = "https://tables.example/other.ttl";
  const preference = { [`${REC}CodeNames`]: [EXAMPLE_NAMES] };
  const cases: [string, unknown, object, object | RegExp][] = [
    [
      "the file's feeds and order of preference, the package's check on open",
      { tables: { feeds: [other], preference } },
      {},
      { feeds: [other], preference, checkOnOpen: packaged.tables.checkOnOpen },
    ],
    [
      "the code's over the file's",
      { tables: { feeds: [FEED] } },
      { feeds: [other], checkOnOpen: false },
      { feeds: [other], checkOnOpen: false },
    ],
    ["no feed", { tables: { feeds: [] } }, {}, { feeds: [] }],
    [
      "a builder by its name, and by its path from the file",
      { tables: { builders: ["cdc-cvx", "../mine"] } },
      {},
      { builders: ["cdc-cvx", resolve(app, "..", "mine")] },
    ],
    [
      "two builders built into one folder",
      { tables: { builders: ["loinc", "./mine/loinc"] } },
      {},
      /builders names more than one builder built into loinc/,
    ],
    [
      "a file naming more than tables",
      { tables: {}, lens: "everyday" },
      {},
      /names lens, and names nothing but tables/,
    ],
    [
      "an order of preference not of IRIs",
      { tables: { preference: { [`${REC}CodeNames`]: ["names"] } } },
      {},
      /preference does not give/,
    ],
    [
      "a feed that is no URL",
      { tables: { feeds: ["feed.ttl"] } },
      {},
      /feeds is not a list of URLs/,
    ],
    [
      "code setting what is not the tables'",
      { tables: {} },
      { repository: other },
      /configureTables names repository, which it cannot set/,
    ],
  ];
  for (const [name, file, code, expected] of cases) {
    await writeFile(join(app, "cascade-runtime.json"), JSON.stringify(file));
    const configured = async () =>
      withTables(
        packaged,
        await appSettings(app, packageConfig),
        tablesSettings(code, "configureTables"),
      ).tables;
    if (expected instanceof RegExp)
      await assert.rejects(configured(), expected, name);
    else
      assert.deepEqual(
        await configured(),
        { ...packaged.tables, ...expected },
        name,
      );
  }
  assert.deepEqual(
    await appSettings(app, join(app, "cascade-runtime.json")),
    {},
    "the package's own file",
  );
  await writeFile(
    join(app, "cascade-runtime.json"),
    JSON.stringify({ lens: "everyday" }),
  );
  const cwd = process.cwd();
  process.chdir(app);
  try {
    await assert.rejects(resolved(), /names nothing but tables/);
  } finally {
    process.chdir(cwd);
  }
  assert.doesNotThrow(
    () => configureTables({}),
    "configureTables after a start that failed",
  );
});
