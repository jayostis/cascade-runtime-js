import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
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
  RULE_LIST,
  tableTerms,
  type Term,
  type Triple,
  withTables,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  type Components,
  findRoot,
  FolderFiles,
} from "@cascade-runtime/runtime/node";
import { configureTables, tablesBeside } from "cascade-runtime";
// A test builds the tables over its own store, feed and starter; the package's entry makes them once in a process, from the real feeds.
import {
  type Checked,
  HELD,
  LISTED,
  PAGE_SIZE,
  PUBLISHED_ROWS,
  Tables,
  versionName,
  writeStarterCopies,
} from "../src/tables.js";
// The same, for a pod over those tables; a browser reads published answers with `keptPod`, which a Node test cannot call as a page does.
import { keptPod, openPodWith, type Pod, type Row } from "../src/pod.js";
import { Answers } from "../src/answers.js";
// Parts over the repository's checkouts, and an app's file, which the package reads once in a process and nine files cannot be read through.
import {
  appSettings,
  partsOf,
  type ResolvedParts,
} from "../src/node/resolved.js";
// A vocabulary with a kind it has stopped declaring, which the real one does not have.
import { kindsRead } from "../src/tables/feed-check.js";
// One version's write held while another's read fails.
import { READ_AHEAD, StarterFiles, versionsIn } from "../src/tables/starter.js";
// Rows a server sends unzipped, and codes in no fixture feed.
import { IN_THIS_THREAD, listing, merged } from "../src/rows.js";
const FEED = "https://tables.example/feed.ttl";
const QUESTION = "pod/My active allergies";
const DCAT = "http://www.w3.org/ns/dcat#";
const SPDX = "http://spdx.org/rdf/terms#";
const PROV = "http://www.w3.org/ns/prov#";
const CURRENT = `${DCAT}hasCurrentVersion`;
const REVISION_OF = `${PROV}wasRevisionOf`;
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const PREFIXES = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pav: <http://purl.org/pav/>
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

const components: Components = await checkouts(
  findRoot(dirname(fileURLToPath(import.meta.url))),
);
const parts: ResolvedParts = await partsOf(components);
let feed: Served;
/** The test feed with each series' first version current. */
let first: Served;
/** The test feed's vaccine-groups series, its first version and its second. */
let groups: { series: string; first: string; second: string };
let scratch: string;

before(async () => {
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
  files: Files = new MemoryFiles("urn:test:tables/"),
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
  const [, shipped] = /cascade:defaultTableVersion <([^>]+)>/.exec(index) ?? [];
  const [, series] = /<([^>]+)> a cascade:ReferenceSeries/.exec(index) ?? [];
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
        `${index.replace(`cascade:defaultTableVersion <${shipped}>`, `cascade:defaultTableVersion <${next}>`)}
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

/** The vocabulary with its ontology changed by `change`. */
function recordsChanged(change: (turtle: string) => string): Files {
  const { vocabulary } = parts;
  return {
    iri: vocabulary.iri,
    read: async (path) => {
      const bytes = await vocabulary.read(path);
      return bytes === undefined || !path.endsWith("ontologies/cascade.ttl")
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

const SYSTEMS = (await tableTerms(parts.vocabulary, parts.newStore))
  .codeSystems;
/** The URI space the vocabulary registers for the code system of this label. */
const spaceOf = (label: string): string => {
  const found = SYSTEMS.find((system) => system.label === label);
  assert.ok(found, `the vocabulary registers no code system ${label}`);
  return found.uriSpace;
};
const RXNORM = spaceOf("RxNorm");
const CVX = spaceOf("CVX");

/** A mapping series of the test feed: its kind, the code system its rows' codes are in, and their predicate. */
interface Mapping {
  readonly series: string;
  readonly label: string;
  readonly kind: string;
  readonly system: string;
  readonly predicate: string;
  /** How the row from `source` to `target` was reached. */
  readonly justification: (source: string, target: string) => string;
  /** The code system of the rows' targets, when it is not the sources'. */
  readonly targetSystem?: string;
  /** The predicate of the row from `source` to `target`, when kinds of the series' rows give several. */
  readonly predicateOf?: (source: string, target: string) => string;
  /** What else the row says. */
  readonly extra?: (
    source: string,
    target: string,
  ) => readonly (readonly [string, Term])[];
}

const INGREDIENTS: Mapping = {
  series: "urn:uuid:3f1d9b7e-2c4a-4e8f-a6d5-9b0c1e2f3a4b",
  label: "Product ingredients",
  kind: "ProductIngredients",
  system: RXNORM,
  predicate: "http://purl.obolibrary.org/obo/RO_0002248",
  justification: (source, target) =>
    source === target ? "ManualMappingCuration" : "MappingChaining",
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
  return withVersions(
    served,
    mapping,
    line.map((pairs) => mappingRows(mapping, pairs)),
  );
}

/** The rows of a mapping series' version, one for each `[source, target]`. */
function mappingRows(
  mapping: Mapping,
  pairs: readonly (readonly [string, string])[],
): Triple[] {
  return pairs.flatMap(([source, target]) => {
    const subject = iri(`urn:test:${mapping.kind}-row:${source}-${target}`);
    return [
      [subject, iri(`${RDF}type`), iri("http://www.w3.org/2002/07/owl#Axiom")],
      [
        subject,
        iri("http://www.w3.org/2002/07/owl#annotatedSource"),
        iri(mapping.system + source),
      ],
      [
        subject,
        iri("http://www.w3.org/2002/07/owl#annotatedProperty"),
        iri(mapping.predicateOf?.(source, target) ?? mapping.predicate),
      ],
      [
        subject,
        iri("http://www.w3.org/2002/07/owl#annotatedTarget"),
        iri((mapping.targetSystem ?? mapping.system) + target),
      ],
      [
        subject,
        iri("https://w3id.org/sssom/mapping_justification"),
        iri(
          `https://w3id.org/semapv/vocab/${mapping.justification(source, target)}`,
        ),
      ],
      ...(mapping.extra?.(source, target) ?? []).map(
        ([predicate, object]): Triple => [subject, iri(predicate), object],
      ),
    ] as Triple[];
  });
}

/** The feed with a series added, its line of versions each holding the rows given, the last current. */
async function withVersions(
  served: Served,
  series: { series: string; label: string; kind: string },
  line: readonly (readonly Triple[])[],
): Promise<{ served: Served; versions: string[] }> {
  const files = new Map(served.files);
  const versions: string[] = [];
  let turtle = `@prefix dcat: <${DCAT}> . @prefix pav: <http://purl.org/pav/> . @prefix prov: <${PROV}> .
@prefix rdfs: <${RDFS}> . @prefix cascade: <${CASCADE}> . @prefix spdx: <${SPDX}> .
<${series.series}> a cascade:ReferenceSeries ; rdfs:label "${series.label}" ; cascade:tableKind cascade:${series.kind} .
`;
  for (const [index, rows] of line.entries()) {
    const previous = versions.at(-1);
    const version = await versionName(series.series, previous, rows);
    const bytes = await gzipped(
      new TextDecoder()
        .decode(ntriples(rows))
        .split("\n")
        .filter((nt) => nt.trim() !== "")
        .map((nt) => `${nt.replace(/\s*\.\s*$/, "")} <${version}> .`)
        .sort()
        .join("\n"),
    );
    const url = `https://tables.example/rows/${series.kind}-${series.series.slice(-12)}-${index}.nq.gz`;
    files.set(url, bytes);
    turtle += `<${version}> prov:specializationOf <${series.series}> ; pav:version "${index + 1}" ;
  ${previous === undefined ? "" : `prov:wasRevisionOf <${previous}> ;`}
  dcat:distribution [ dcat:downloadURL <${url}> ; spdx:checksum [ spdx:checksumValue "${await hex(bytes)}" ] ] .
`;
    versions.push(version);
  }
  turtle += `<${series.series}> dcat:hasCurrentVersion <${versions.at(-1)}> .`;
  const added = await new OxigraphStore().parse(turtle, FEED);
  return {
    served: { ...served, files, catalog: [...served.catalog, ...added] },
    versions,
  };
}

const OTHER_FEED = "https://tables.example/other.ttl";
const APP_POD = "urn:uuid:5f0c2a64-8e1b-4d3a-9c7e-2b6a4f1d8e03";

/** What an app started through the package's entry did, as `startedApp` keeps it. */
interface StartedApp {
  /** What the first `tablesBeside` threw, with an app file that names more than tables. */
  readonly failedStart: unknown;
  /** What `configureTables` threw straight after that start failed, if it threw. */
  readonly afterFailedStart: unknown;
  /** What `configureTables` threw for a setting the tables do not own. */
  readonly unsettable: unknown;
  /** What `configureTables` threw once the tables were made. */
  readonly afterMade: unknown;
  readonly tables: Tables;
  /** What `current()` gave while the check on open waited for the feed. */
  readonly currentWhileChecking: readonly string[];
  /** Whether the feed's fetch had passed its gate when a pod's open was noted. */
  readonly fetchedWhileNoting: boolean;
  readonly openedWhileChecking: readonly string[] | undefined;
  /** The addresses asked of the network by the time the pod's open was noted. */
  readonly askedWhileChecking: readonly string[];
  /** Every address asked of the network once the check had ended. */
  readonly asked: readonly string[];
  /** What a `check()` queued behind the check on open returned. */
  readonly checked: readonly Checked[];
  readonly currentAfter: readonly string[];
  readonly openedAfter: readonly string[] | undefined;
}

let startedMade: Promise<StartedApp> | undefined;

/**
 * An app started through the package's entry, made once: the only code here that sets what the package keeps for the
 * process. The app's file names `OTHER_FEED`, its code names the test feed and has a check on open wait at the feed's gate;
 * a pod's open is noted while the check waits, and the check is let go.
 */
function startedApp(): Promise<StartedApp> {
  startedMade ??= (async () => {
    const app = join(scratch, "app");
    await mkdir(app);
    const file = join(app, "cascade-runtime.json");
    await writeFile(file, JSON.stringify({ lens: "everyday" }));
    const asked: string[] = [];
    let fetched = false;
    let release = (): void => undefined;
    const gate = new Promise<void>((open) => (release = open));
    const served = fetchOf(feed);
    const cwd = process.cwd();
    try {
      process.chdir(app);
      const failedStart = await thrownBy(() => tablesBeside(join(app, "pods")));
      const afterFailedStart = await thrownBy(() => configureTables({}));
      // The type does not let code name `repository`; a script without types can.
      const unsettable = await thrownBy(() =>
        configureTables({ repository: OTHER_FEED } as Parameters<
          typeof configureTables
        >[0]),
      );
      await writeFile(
        file,
        JSON.stringify({ tables: { feeds: [OTHER_FEED], checkOnOpen: false } }),
      );
      configureTables({
        feeds: [FEED],
        checkOnOpen: true,
        fetch: async (input, init) => {
          asked.push(String(input));
          // The check on open gives up when its signal aborts: a note of a pod's open that waits for it is made only after this passes.
          await Promise.race([
            gate,
            new Promise<void>((aborted) =>
              init?.signal?.aborted
                ? aborted()
                : init?.signal?.addEventListener("abort", () => aborted()),
            ),
          ]);
          fetched = true;
          return served(input, init);
        },
      });
      const tables = await tablesBeside(join(app, "pods"));
      process.chdir(cwd);
      const currentWhileChecking = await tables.current();
      await tables.recordOpen(APP_POD, [groups.first], "alex");
      const fetchedWhileNoting = fetched;
      const askedWhileChecking = [...asked];
      const openedWhileChecking = await tables.openedWith(APP_POD);
      release();
      // A second check is queued behind the one on open, as every check is.
      const checked = await tables.check();
      const currentAfter = await tables.current();
      const openedAfter = await tables.openedWith(APP_POD);
      const afterMade = await thrownBy(() => configureTables({}));
      return {
        failedStart,
        afterFailedStart,
        unsettable,
        afterMade,
        tables,
        currentWhileChecking,
        fetchedWhileNoting,
        openedWhileChecking,
        askedWhileChecking,
        asked: [...asked],
        checked,
        currentAfter,
        openedAfter,
      };
    } finally {
      process.chdir(cwd);
      release();
    }
  })();
  return startedMade;
}

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
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

const LOINC = spaceOf("LOINC");
const MEDRT = spaceOf("MED-RT");
const OBO = "http://purl.obolibrary.org/obo/";
const SKOS_PREF_LABEL = "http://www.w3.org/2004/02/skos/core#prefLabel";
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

const PANELS: Mapping = {
  series: "urn:uuid:9a3c5e7f-1b2d-4f60-8a9b-0c1d2e3f4a5b",
  label: "LOINC panel members",
  kind: "PanelMembers",
  system: LOINC,
  predicate: `${OBO}RO_0002351`,
  justification: () => "ManualMappingCuration",
};

const CLASSES: Mapping = {
  series: "urn:uuid:2b4d6f81-3c5e-4a70-9b1c-2d3e4f5a6b7c",
  label: "Drug classes",
  kind: "DrugClasses",
  system: RXNORM,
  targetSystem: MEDRT,
  predicate: `${CASCADE}establishedPharmacologicClass`,
  justification: () => "ManualMappingCuration",
};

const NAMES = (
  series: string,
  label: string,
): { series: string; label: string; kind: string } => ({
  series,
  label,
  kind: "CodeNames",
});

const named = (code: string, name: string): Triple => [
  iri(code),
  iri(SKOS_PREF_LABEL),
  literal(name),
];

const PANEL = "24323-8";
const LISINOPRIL = "29046";
const ESTRADIOL = "4083";
const FLUOROESTRADIOL = "2372221";
const KETOCONAZOLE = "6135";
const LEVOKETOCONAZOLE = "2588846";
const MECHANISMS = new Set(["N0000000174", "N0000000100", "N0000175869"]);
const AZOLES = "N0000007654";
/** The product ingredients rows, `[source, target]`, that name a precise ingredient. */
const PRECISE = new Set([`2588848 ${LEVOKETOCONAZOLE}`]);
const PRECISE_INGREDIENTS: Mapping = {
  ...INGREDIENTS,
  predicateOf: (source, target) =>
    PRECISE.has(`${source} ${target}`)
      ? `${CASCADE}hasPreciseIngredient`
      : INGREDIENTS.predicate,
};
/** Estradiol's rows: its tablet, which has no precise ingredient, and fluoroestradiol F-18, a precise ingredient of it. */
const ESTRADIOL_ROWS: [string, string][] = [
  ["197658", ESTRADIOL],
  [FLUOROESTRADIOL, ESTRADIOL],
  [ESTRADIOL, ESTRADIOL],
];
const ESTRADIOL_CLASSES: [string, string][] = [
  [ESTRADIOL, "N0000175825"],
  [ESTRADIOL, "N0000000100"],
  [FLUOROESTRADIOL, "N0000177914"],
  [FLUOROESTRADIOL, "N0000175869"],
];
const CLASSES_BY_RELATION: Mapping = {
  ...CLASSES,
  predicateOf: (_, target) =>
    MECHANISMS.has(target)
      ? `${CASCADE}mechanismOfActionClass`
      : target === AZOLES
        ? `${CASCADE}chemicalStructureClass`
        : CLASSES.predicate,
};

/**
 * The feed the panel and class tests share, built once: a panel and its members; a tablet of lisinopril, whose
 * relations name no precise ingredient, and lisinopril anhydrous, a precise ingredient FDA classes; a combination,
 * mapped to its multiple ingredient concept; estradiol, classed itself, whose tablet maps to it and whose precise
 * ingredient fluoroestradiol F-18 maps to it too, classed differently; and a tablet of levoketoconazole, a precise
 * ingredient of ketoconazole, each classed differently. Its product ingredients version states precise ingredients.
 */
let planted: Promise<{ tables: Tables; classes: string }> | undefined;

function plantedTables(): Promise<{ tables: Tables; classes: string }> {
  planted ??= (async () => {
    const place: Record<string, [number, string | undefined]> = {
      "2951-2": [2, "R"],
      "2823-3": [1, undefined],
      "17861-6": [3, "R-a"],
    };
    const panels = await withMappings(
      feed,
      {
        ...PANELS,
        extra: (_, member) => [
          [
            `${CASCADE}panelSequence`,
            literal(String(place[member]![0]), XSD_INTEGER),
          ],
          ...(place[member]![1] === undefined
            ? []
            : [
                [
                  `${CASCADE}observationRequiredInPanel`,
                  literal(place[member]![1]),
                ] as const,
              ]),
        ],
      },
      [Object.keys(place).map((member): [string, string] => [PANEL, member])],
    );
    const ingredients = await withMappings(panels.served, PRECISE_INGREDIENTS, [
      [
        ["314076", LISINOPRIL],
        ["1546022", LISINOPRIL],
        [LISINOPRIL, LISINOPRIL],
        // A combination maps to the multiple ingredient concept, which MED-RT classes none of.
        ["197885", "214618"],
        ...ESTRADIOL_ROWS,
        ["2588848", KETOCONAZOLE],
        ["2588848", LEVOKETOCONAZOLE],
        [LEVOKETOCONAZOLE, KETOCONAZOLE],
        [KETOCONAZOLE, KETOCONAZOLE],
      ],
    ]);
    const classes = await withMappings(
      ingredients.served,
      CLASSES_BY_RELATION,
      [
        [
          ["1546022", "N0000175562"],
          ["1546022", "N0000000174"],
          ...ESTRADIOL_CLASSES,
          [KETOCONAZOLE, "N0000175487"],
          [KETOCONAZOLE, AZOLES],
          [LEVOKETOCONAZOLE, "N0000193183"],
        ],
      ],
    );
    const loinc = await withVersions(
      classes.served,
      NAMES("urn:uuid:5c7e9a1b-4d6f-4b82-8c3d-4e5f6a7b8c9d", "LOINC names"),
      [
        [
          named(
            `${LOINC}2823-3`,
            "Potassium [Moles/volume] in Serum or Plasma",
          ),
          named(`${LOINC}2951-2`, "Sodium [Moles/volume] in Serum or Plasma"),
          named(`${LOINC}${PANEL}`, "Comprehensive metabolic 2000 panel"),
        ],
      ],
    );
    const medrt = await withVersions(
      loinc.served,
      NAMES("urn:uuid:6d8f0b2c-5e70-4c93-9d4e-5f6a7b8c9d0e", "MED-RT names"),
      [
        [
          named(
            `${MEDRT}N0000175562`,
            "Angiotensin Converting Enzyme Inhibitor [EPC]",
          ),
          named(`${RXNORM}1546022`, "lisinopril anhydrous"),
          named(`${RXNORM}${ESTRADIOL}`, "estradiol"),
        ],
      ],
    );
    const tables = tablesOver(medrt.served);
    await tables.check();
    return { tables, classes: classes.versions[0]! };
  })();
  return planted;
}

/** What a code's page says of its classes, a line each: a class with the code it is through, or a relation withheld. */
async function classLines(tables: Tables, code: string): Promise<string[]> {
  return (await tables.facts(`${RXNORM}${code}`)).classes.flatMap(
    ({ in: each, withheld }) => [
      ...each.map(
        ({ relation, class: of, through }) =>
          `${relation.slice(CASCADE.length)} ${of.notation}${through === undefined ? "" : ` through ${through.notation}`}`,
      ),
      ...withheld.map(
        ({ relation, ingredient }) =>
          `${relation.slice(CASCADE.length)} withheld, a different form of ${ingredient.notation}`,
      ),
    ],
  );
}

/** What a piece of work threw, or `undefined` when it threw nothing. */
async function thrownBy(work: () => unknown): Promise<unknown> {
  try {
    await work();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A new store holding what one check of the feed keeps. */
async function checkedStore(
  served: Served,
  vocabulary?: Files,
): Promise<MemoryFiles> {
  const store = new MemoryFiles("urn:test:tables/");
  await tablesOver(served, store, vocabulary).check();
  return store;
}

/** The feed with the vaccine groups series of the kind given. */
function retyped(kind: string): Served {
  return {
    ...first,
    catalog: first.catalog.map(([subject, predicate, object]) =>
      subject.value === groups.series &&
      predicate.value === `${CASCADE}tableKind`
        ? [subject, predicate, iri(kind)]
        : [subject, predicate, object],
    ),
  };
}

let checkedMade: Promise<Tables> | undefined;

/** The test feed's tables, checked once and then only read. */
function checkedFeed(): Promise<Tables> {
  checkedMade ??= (async () => {
    const tables = tablesOver(feed);
    await tables.check();
    return tables;
  })();
  return checkedMade;
}

/** What the package carries, as `writeStarterCopies` writes it for the test feed. */
interface Starter {
  readonly files: MemoryFiles;
  /** Every path it holds. */
  readonly carried: readonly string[];
  /** The stem of the vaccine groups' first version, whose files it holds. */
  readonly stem: string;
  /** The path of each version's rows. */
  readonly rowsCarried: readonly string[];
  /** The versions whose rows it carries, in the order of its index. */
  readonly order: readonly string[];
}

let starterMade: Promise<Starter> | undefined;

/** The starter copies of the test feed with one product ingredients version more, made once and never written to. */
function starterCopies(): Promise<Starter> {
  starterMade ??= (async () => {
    const files = new MemoryFiles("urn:test:starter/");
    // One version more than are read ahead.
    const { served } = await withMappings(first, INGREDIENTS, [
      [["153010", "5640"]],
    ]);
    await writeStarterCopies(
      {
        feeds: [FEED],
        vocabulary: parts.vocabulary,
        newStore: parts.newStore,
        fetch: fetchOf(served),
      },
      (path, bytes) => files.write(path, bytes),
    );
    const carried = await files.list("");
    const order = [...versionsIn(carried)]
      .filter(([, paths]) =>
        paths.some((path) => path.endsWith(PUBLISHED_ROWS)),
      )
      .map(([version]) => version);
    return {
      files,
      carried,
      stem: fileStem(groups.first),
      rowsCarried: carried.filter((path) => path.endsWith(PUBLISHED_ROWS)),
      order,
    };
  })();
  return starterMade;
}

/** What was asked of a starter: each path read, the most rows read at once, and whether the read set to fail has. */
interface Reads {
  readonly asked: string[];
  most: number;
  /** The rows whose next read fails once. */
  failing: string | undefined;
  failed: boolean;
}

/** The starter behind a `Files` that notes its reads, and fails the read of the rows in `failing` once. */
function readsOf(starter: Files): { files: Files; reads: Reads } {
  const reads: Reads = {
    asked: [],
    most: 0,
    failing: undefined,
    failed: false,
  };
  let inFlight = 0;
  const files: Files = {
    iri: starter.iri,
    list: (folder) => starter.list(folder),
    write: (path, bytes) => starter.write(path, bytes),
    read: async (path) => {
      reads.asked.push(path);
      if (!path.endsWith(PUBLISHED_ROWS)) return starter.read(path);
      inFlight += 1;
      reads.most = Math.max(reads.most, inFlight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        if (path === reads.failing) {
          reads.failing = undefined;
          reads.failed = true;
          throw new Error("the starter's network failed");
        }
        return await starter.read(path);
      } finally {
        inFlight -= 1;
      }
    },
  };
  return { files, reads };
}

/** The paths of rows that were read. */
function rowsRead(reads: Reads): string[] {
  return reads.asked.filter((path) => path.endsWith(PUBLISHED_ROWS));
}

/** What a copy from the starter does with a version's rows: convert them, and list none of what came listed. */
function copying(converted: () => void = () => undefined) {
  return {
    ...IN_THIS_THREAD,
    listed: () => Promise.reject(new Error("listed what came listed")),
    published: (bytes: Uint8Array<ArrayBuffer>) => {
      converted();
      return IN_THIS_THREAD.published(bytes);
    },
  };
}

/** Tables over a store and the starter, which hold the test feed's current versions and reach nothing else. */
function startedOn(
  starter: Files,
  files: Files = new MemoryFiles("urn:test:app/"),
  converted?: () => void,
): Tables {
  return new Tables({
    files,
    feeds: [FEED],
    vocabulary: parts.vocabulary,
    newStore: parts.newStore,
    fetch: fetchOf(feed),
    starter,
    work: copying(converted),
  });
}

let brandMade:
  | Promise<{
      about: Awaited<ReturnType<Tables["about"]>>;
      versions: string[];
      brand: string;
      ibuprofen: string;
      unmapped: string;
    }>
  | undefined;

/** What `about` says of a brand that maps to two ingredients, of one that maps to itself and of a code no row maps; made once. */
function brandIngredients() {
  brandMade ??= (async () => {
    const { served, versions } = await withMappings(feed, INGREDIENTS, [
      [
        ["153010", "5640"],
        ["153010", "7052"],
        ["5640", "5640"],
      ],
    ]);
    const tables = tablesOver(served);
    await tables.check();
    const [brand, ibuprofen, unmapped] = ["153010", "5640", "999999"].map(
      (code) => RXNORM + code,
    ) as [string, string, string];
    return {
      about: await tables.about([brand, ibuprofen, unmapped]),
      versions,
      brand,
      ibuprofen,
      unmapped,
    };
  })();
  return brandMade;
}

/** Tables over a store whose index names a version by a name no file can be made from. */
async function nameless(): Promise<Tables> {
  const series = "urn:test:series";
  const version = "urn:test:no-file";
  const files = new MemoryFiles("urn:test:tables/");
  await files.write(
    "references.ttl",
    new TextEncoder().encode(
      `<${series}> <${CASCADE}tableKind> <${CASCADE}CodeNames> .
<${series}> <${CASCADE}defaultTableVersion> <${version}> .
<${version}> <${PROV}specializationOf> <${series}> .
`,
    ),
  );
  return tablesOver(feed, files);
}

/** Opens the pod in the folder, or in memory, with the tables, reads it, and closes it. */
async function opening<T>(
  tables: Tables,
  folder: string | undefined,
  read: (pod: Pod) => Promise<T>,
): Promise<T> {
  const pod = await openPodWith({ ...parts, tables }, folder);
  try {
    return await read(pod);
  } finally {
    await pod.close();
  }
}

/** The text that enters records into a pod: an activity of its owner, then each record with the draft given. */
function entering(pod: Pod, records: readonly string[]): string {
  return `${PREFIXES}
<urn:uuid:${crypto.randomUUID()}> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] .
${records.join("\n")}`;
}

/** A record of the type, `output-<n>`, with the fields given. */
function draft(
  position: number,
  type: string,
  fields: string,
  pod: Pod,
): string {
  return `<urn:cascade:output-${position}> a ${type} .
<urn:cascade:output-${position}-version> prov:specializationOf <urn:cascade:output-${position}> ;
  ${fields} ; cascade:patient <${pod.subject}> .`;
}

/** What a pod opened over several sets of tables did: the opens that matter to its capabilities. */
interface Hana {
  /** The open that gave the pod the newer versions. */
  readonly adopted: Pod["opened"];
  /** The versions cited by the view entry of an allergy to ibuprofen, of CVX 150 and of CVX 140 at that open. */
  readonly cited: {
    readonly ibuprofen: readonly string[];
    readonly cvx150: readonly string[];
    readonly cvx140: readonly string[];
  };
  /** The open after, with the same tables. */
  readonly again: {
    readonly opened: Pod["opened"];
    readonly unheld: readonly string[] | undefined;
  };
  /** The first and the second open with tables that lack the newer versions. */
  readonly lacking: readonly {
    readonly opened: Pod["opened"];
    readonly unheld: readonly string[] | undefined;
  }[];
  /** The product ingredients version the pod first held, and the one it adopted. */
  readonly ingredients: { readonly held: string; readonly adopted: string };
}

let hanaMade: Promise<Hana> | undefined;

/**
 * A pod entered under tables holding the first versions, opened under tables holding newer ones, again under the same,
 * and twice under tables of another store that lack them: made once, and its opens kept.
 */
function hanaPod(): Promise<Hana> {
  hanaMade ??= (async () => {
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
    const store = new MemoryFiles("urn:test:tables/");
    const held = tablesOver(ingredientsFirst.served, store);
    await held.check();
    const folder = join(scratch, "pods", "hana");
    await opening(held, folder, async (pod) => {
      const entered = await pod.enter(
        entering(pod, [
          ...[
            ["141", "2025-10-01"],
            ["150", "2025-10-01"],
            ["140", "2024-10-01"],
            ["141", "2024-10-01"],
          ].map(([code, date], index) =>
            draft(
              index,
              "cascade:Vaccination",
              `cascade:vaccineCode <${CVX}${code}> ; cascade:vaccinationOccurrenceTime "${date}"^^<http://www.w3.org/2001/XMLSchema#date>`,
              pod,
            ),
          ),
          ...["153010", "5640"].map((code, index) =>
            draft(
              4 + index,
              "cascade:AllergyOrIntolerance",
              `cascade:allergenCode <${RXNORM}${code}>`,
              pod,
            ),
          ),
        ]),
      );
      assert.equal(entered.refused, undefined);
    });

    const later = tablesOver(ingredientsLater.served, store);
    await later.check({ cache: "no-cache" });
    const adopting = await opening(later, folder, async (pod) => {
      const joined = new Map<string, string[]>();
      for (const { entry = "", used = "" } of await pod.joinedBy())
        joined.set(entry, [...(joined.get(entry) ?? []), used]);
      const citedBy = async (
        field: string,
        value: string,
      ): Promise<string[]> => {
        const entries = await pod.ask({
          query: `${PREFIXES}SELECT DISTINCT ?entry WHERE { ?record pav:hasCurrentVersion/cascade:${field} ${value} . ?entry cascade:mergedFrom ?record }`,
        });
        assert.equal(
          entries.length,
          1,
          `${field} ${value} is in several entries`,
        );
        return joined.get(entries[0]?.entry ?? "") ?? [];
      };
      return {
        opened: pod.opened,
        cited: {
          ibuprofen: await citedBy("allergenCode", `<${RXNORM}5640>`),
          cvx150: await citedBy("vaccineCode", `<${CVX}150>`),
          cvx140: await citedBy("vaccineCode", `<${CVX}140>`),
        },
      };
    });
    const again = await opening(later, folder, async (pod) => ({
      opened: pod.opened,
      unheld: await pod.unheldTableVersions(),
    }));

    const older = tablesOver(
      ingredientsFirst.served,
      new MemoryFiles("urn:test:tables-elsewhere/"),
    );
    await older.check();
    const lackingOpen = () =>
      opening(older, folder, async (pod) => ({
        opened: pod.opened,
        unheld: await pod.unheldTableVersions(),
      }));
    const lacking = [await lackingOpen(), await lackingOpen()];
    return {
      adopted: adopting.opened,
      cited: adopting.cited,
      again,
      lacking,
      ingredients: {
        held: ingredientsFirst.versions[0]!,
        adopted: ingredientsLater.versions[1]!,
      },
    };
  })();
  return hanaMade;
}

/**
 * An app keeps its reference tables in a folder beside its pods, which `tablesBeside` returns, and `check` reads each
 * feed and keeps every newer version whose rows verify, so damaged rows never reach a pod. With a `phase`,
 * `tablesBeside` reports the copy of the package's own tables and the check for newer ones, each in a line a person
 * reads while they wait.
 * @rule runtime/matcher.feature M10
 * @rule runtime/naming.feature N12
 */
describe("Keeping reference tables up to date · tablesBeside(), tables.check()", () => {
  describe("tables.check()", () => {
    let checked: Checked | undefined;
    let labels: { before: string | undefined; after: string | undefined };

    before(async () => {
      const labelOf = async (tables: Tables): Promise<string | undefined> =>
        (await tables.held()).find(
          ({ iri: series }) => series === groups.series,
        )?.label;
      [checked] = await tablesOver(feed, await checkedStore(first)).check({
        cache: "no-cache",
      });
      const relabelled = tablesOver(
        {
          ...feed,
          catalog: feed.catalog.map(([subject, predicate, object]) =>
            subject.value === groups.series &&
            predicate.value === `${RDFS}label`
              ? [subject, predicate, literal("Vaccine groups, relabelled")]
              : [subject, predicate, object],
          ),
        },
        await checkedStore(first),
      );
      const was = await labelOf(relabelled);
      await relabelled.check({ cache: "no-cache" });
      labels = { before: was, after: await labelOf(relabelled) };
    });

    it("returns in `kept` each newer version the feed lists, with nothing `refused`", () => {
      assert.deepEqual(checked?.refused, []);
      assert.ok(checked?.kept.includes(groups.second));
    });

    it("replaces a series' label with the one the feed now gives", () => {
      assert.notEqual(labels.before, "Vaccine groups, relabelled");
      assert.equal(labels.after, "Vaccine groups, relabelled");
    });
  });

  describe("when a check cannot read the vocabulary", () => {
    let failure: unknown;
    let current: string | undefined;

    before(async () => {
      let failed = false;
      const { vocabulary } = parts;
      const once: Files = {
        iri: vocabulary.iri,
        read: async (path) => {
          if (path.endsWith("ontologies/cascade.ttl") && !failed) {
            failed = true;
            throw new Error("the vocabulary could not be read");
          }
          return vocabulary.read(path);
        },
        write: (path, bytes) => vocabulary.write(path, bytes),
        list: (folder) => vocabulary.list(folder),
      };
      const tables = tablesOver(
        feed,
        new MemoryFiles("urn:test:tables/"),
        once,
      );
      failure = await thrownBy(() => tables.check());
      await tables.check();
      current = (await tables.held()).find(
        ({ iri: series }) => series === groups.series,
      )?.current.iri;
    });

    it("rejects with what failed", () => {
      assert.ok(failure instanceof Error);
      assert.match(failure.message, /could not be read/);
    });

    it("keeps the version at the next check", () => {
      assert.equal(current, groups.second);
    });
  });

  describe("given a version whose rows do not verify", () => {
    let store: MemoryFiles;

    before(async () => {
      store = await checkedStore(first);
    });

    it("returns in `refused` why, with nothing of the version kept", async () => {
      const cases: [string, () => Promise<Served>, RegExp][] = [
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
        ],
        [
          "rows that do not give the version's name",
          () =>
            withRows(feed, groups.second, (nquads) =>
              nquads.replace("/cvx/140>", "/cvx/149>"),
            ),
          /name/,
        ],
        [
          "a row outside the version's graph",
          () =>
            withRows(feed, groups.second, (nquads) =>
              nquads.replace(`<${groups.second}> .`, "<urn:example:other> ."),
            ),
          /outside the graph/,
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
        ],
        [
          "rows out of their canonical order",
          () =>
            withRows(feed, groups.second, (nquads) => {
              const lines = nquads.trimEnd().split("\n");
              return `${[lines.at(-1), ...lines.slice(0, -1)].join("\n")}\n`;
            }),
          /canonical order/,
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
        ],
        [
          "a row not written canonically",
          () =>
            withRows(feed, groups.second, (nquads) =>
              nquads.replace("> <", ">  <"),
            ),
          /not N-Quads/,
        ],
        [
          "a row with a term after its literal",
          () =>
            withRows(feed, groups.second, (nquads) =>
              nquads.replace(
                /(#annotatedProperty> )<[^>]*>/,
                '$1"broad" <urn:example:extra>',
              ),
            ),
          /not N-Quads/,
        ],
        [
          "a row whose IRI holds a space",
          () =>
            withRows(feed, groups.second, (nquads) =>
              nquads.replace(/(#annotatedProperty> <[^> ]*)>/, "$1 match>"),
            ),
          /not N-Quads/,
        ],
        [
          "rows that are not gzip",
          () =>
            withBytes(
              feed,
              groups.second,
              new TextEncoder().encode("not gzip"),
            ),
          /not gzip/,
        ],
        [
          "a version the feed gives no download for",
          async () => ({
            ...feed,
            catalog: feed.catalog.filter(
              ([subject, predicate]) =>
                !(
                  subject.value === groups.second &&
                  predicate.value === `${DCAT}distribution`
                ),
            ),
          }),
          /^the feed gives no download URL and checksum for it$/,
        ],
      ];
      for (const [input, served, reason] of cases) {
        const tables = tablesOver(await served(), store);
        const [checked] = await tables.check();
        const said =
          checked?.refused.find(({ version }) => version === groups.second)
            ?.reason ?? "";
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
  });

  describe("given a feed or rows that cannot be read now", () => {
    let store: MemoryFiles;

    before(async () => {
      store = await checkedStore(first);
    });

    it("returns in `later` what could not be read, with nothing kept", async () => {
      const cases: [string, Served, RegExp][] = [
        [
          "rows whose download breaks off",
          { ...feed, broken: rowsUrl(feed, groups.second) },
          /could not be read: the connection was reset/,
        ],
        [
          "a feed whose download breaks off",
          { ...feed, broken: FEED },
          /could not be read: the connection was reset/,
        ],
        [
          "rows the feed's site no longer serves",
          {
            ...feed,
            files: new Map(
              [...feed.files].filter(
                ([url]) => url !== rowsUrl(feed, groups.second),
              ),
            ),
          },
          /404/,
        ],
        [
          "a feed that is not Turtle",
          { ...feed, text: "<not> <Turtle" },
          /not Turtle/,
        ],
      ];
      for (const [input, served, reason] of cases) {
        const tables = tablesOver(served, store);
        const [checked] = await tables.check();
        assert.match(checked?.later ?? "", reason, input);
        assert.ok(!checked?.kept.includes(groups.second), input);
        assert.ok(!(await tables.current()).includes(groups.second), input);
        assert.equal(
          await store.read(`${fileStem(groups.second)}.ttl`),
          undefined,
          input,
        );
      }
    });
  });

  describe("given a feed that goes back to a version the app's own does not descend from", () => {
    it("refuses the version, naming in `refused` the version the app holds", async () => {
      // The app holds the second version and never held the first, which a feed whose current version it is offers.
      const tables = tablesOver(first, await checkedStore(feed));
      const [checked] = await tables.check();
      assert.deepEqual(checked?.kept, []);
      assert.deepEqual(
        checked?.refused
          .filter(({ version }) => version === groups.first)
          .map(({ reason }) => reason),
        [
          `it does not descend from ${groups.second}, the version of its series held`,
        ],
      );
      const current = await tables.current();
      assert.ok(current.includes(groups.second));
      assert.ok(!current.includes(groups.first));
    });
  });

  describe("given a feed whose series are of several table kinds", () => {
    const UNREAD = `${CASCADE}SubstanceIngredients`;
    const MARKED = `${CASCADE}CodeNames`;
    const PUBLISHED = `${CASCADE}NdcDrugs`;

    before(async () => {
      const { readByPages } = await tableTerms(
        parts.vocabulary,
        parts.newStore,
      );
      assert.ok(
        readByPages.has(MARKED) && !readByPages.has(PUBLISHED),
        "the vocabulary marks CodeNames and not NdcDrugs as read by pages",
      );
      for (const path of await parts.vocabulary.list(RULE_LIST)) {
        const bytes = path.endsWith(".ttl")
          ? await parts.vocabulary.read(path)
          : undefined;
        if (bytes === undefined) continue;
        assert.deepEqual(
          (await parts.newStore().parse(bytes, FEED)).filter(
            ([, predicate, object]) =>
              predicate.value === `${CASCADE}tableKind` &&
              [UNREAD, MARKED, PUBLISHED].includes(object.value),
          ),
          [],
          `${path} now names a kind this group needs no rule list to read`,
        );
      }
    });

    it("keeps a series whose kind the vocabulary's rule list reads", async () => {
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
                  .replace(
                    "cascade:VaccineGroups",
                    "cascade:SubstanceIngredients",
                  ),
              );
        },
        write: (path, bytes) => vocabulary.write(path, bytes),
        list: (folder) => vocabulary.list(folder),
      };
      const [kept] = await tablesOver(
        retyped(UNREAD),
        new MemoryFiles("urn:test:tables/"),
        naming,
      ).check();
      assert.ok(kept?.kept.includes(groups.first));
    });

    it("keeps a series whose kind the vocabulary marks as read by an app's pages", async () => {
      const [kept] = await tablesOver(retyped(MARKED)).check();
      assert.ok(kept?.kept.includes(groups.first));
    });

    it("keeps no series of a kind that neither reads", async () => {
      for (const kind of [UNREAD, PUBLISHED]) {
        const [unkept] = await tablesOver(retyped(kind)).check();
        assert.ok(!unkept?.kept.includes(groups.first), kind);
      }
    });

    it("reads no kind the vocabulary has stopped declaring, though the rule list or a page mark still names it", async () => {
      const vocabulary = new MemoryFiles("urn:test:vocabulary/");
      const write = (path: string, text: string) =>
        vocabulary.write(path, new TextEncoder().encode(text));
      await write(
        "ontologies/cascade.ttl",
        `@prefix cascade: <${CASCADE}> .
cascade:VaccineGroups a cascade:TableKind .
cascade:CodeNames a cascade:TableKind ; cascade:readByAppPages true .
cascade:NdcDrugs cascade:readByAppPages true .
`,
      );
      await write(
        "runtime/rule-list/rules.ttl",
        `@prefix cascade: <${CASCADE}> .
<urn:test:rule-1> cascade:tableKind cascade:VaccineGroups .
<urn:test:rule-2> cascade:tableKind cascade:RetiredKind .
`,
      );
      const read = [
        ...(await kindsRead({
          vocabulary,
          newStore: () => new OxigraphStore(),
        })),
      ].map((kind) => kind.replace(/^.*#/, ""));
      for (const stopped of ["RetiredKind", "NdcDrugs"])
        assert.ok(!read.includes(stopped), `${stopped} is read`);
      assert.deepEqual(read.sort(), ["CodeNames", "VaccineGroups"]);
    });
  });

  describe("given builders named in the app's settings", () => {
    let results: Checked[][];

    before(async () => {
      results = (await built()).checked;
    });

    it("runs each builder at a check and keeps the versions it builds", () => {
      const [fromFeed, cvx] = results[0] ?? [];
      assert.ok(fromFeed?.kept.includes(groups.second));
      assert.equal(cvx?.kept.length, 3);
      assert.deepEqual(cvx?.refused, []);
    });

    it("returns a builder's result after the feeds', under the feed the builder wrote in `.builds/`", () => {
      const [fromFeed, cvx, example] = results[0] ?? [];
      assert.equal(fromFeed?.feed, FEED);
      assert.match(cvx?.feed ?? "", /^file:.*\/\.builds\/cdc-cvx\/feed\.ttl$/);
      assert.match(example?.feed ?? "", /\/\.builds\//);
    });

    it("refuses a builder's version that does not descend from the one a feed gave", () => {
      const [, , example] = results[0] ?? [];
      assert.match(
        example?.refused.map(({ reason }) => reason).join("\n") ?? "",
        new RegExp(`does not descend from ${groups.second}`),
      );
    });

    it("keeps nothing more, of a feed or of a builder, at a check that finds nothing new", () => {
      assert.deepEqual(
        results[1]?.map(({ kept, later }) => ({ kept, later })),
        [
          { kept: [], later: undefined },
          { kept: [], later: undefined },
          { kept: [], later: undefined },
        ],
      );
    });
  });

  describe("given a check on open that is still waiting for its feed", () => {
    let started: StartedApp;

    before(async () => {
      started = await startedApp();
    });

    it("returns the tables without waiting for the feed", () => {
      assert.ok(!started.currentWhileChecking.includes(groups.second));
    });

    it("notes a pod's open without waiting for the feed", () => {
      assert.equal(started.fetchedWhileNoting, false);
      assert.deepEqual(started.openedWhileChecking, [groups.first]);
    });

    it("keeps the feed's newer version once the feed is read", () => {
      assert.deepEqual(
        started.checked.flatMap(({ kept }) => kept),
        [],
        "the queued check kept a version the check on open had not",
      );
      assert.ok(started.currentAfter.includes(groups.second));
    });

    it("keeps its note of the pod's open through the check", () => {
      assert.deepEqual(started.openedAfter, [groups.first]);
    });
  });
});

/**
 * The package carries starter copies of the reference tables, so a new app works before it has reached a feed. `start`
 * copies them into the app's store, and until it has, a version is copied the first time something reads it.
 */
describe("Starting from the tables the package carries · tables.start()", () => {
  const cvx141 = `${CVX}141`;

  describe("tables.start()", () => {
    it("returns the bytes it copied into an empty store", async () => {
      const { files } = await starterCopies();
      assert.ok((await startedOn(files).start()) > 0);
    });

    it("returns 0 for a store that holds every version", async () => {
      const { files } = await starterCopies();
      const tables = startedOn(files);
      await tables.start();
      assert.equal(await tables.start(), 0);
    });

    it("copies only the versions the starter names, and no other file it carries", async () => {
      const { files, carried, rowsCarried, order } = await starterCopies();
      const extra = new MemoryFiles("urn:test:starter-extra/");
      for (const path of carried)
        await extra.write(path, (await files.read(path)) as Uint8Array);
      await extra.write(
        `version-the-index-does-not-name${PUBLISHED_ROWS}`,
        (await files.read(rowsCarried[0] as string)) as Uint8Array,
      );
      const store = new MemoryFiles("urn:test:app-named/");
      await startedOn(extra, store).start();
      assert.deepEqual(
        (await store.list(""))
          .filter((path) => path.endsWith(".ttl") && path !== "references.ttl")
          .sort(),
        order.map((version) => `${version}.ttl`).sort(),
      );
    });

    it("reads at most three versions ahead of the one it is writing", async () => {
      const { files, rowsCarried } = await starterCopies();
      assert.ok(
        rowsCarried.length > READ_AHEAD,
        "the starter carries no more versions than are read ahead",
      );
      const { files: counted, reads } = readsOf(files);
      await startedOn(counted).start();
      assert.equal(reads.most, READ_AHEAD);
    });

    it("makes no search list that the starter already carries", async () => {
      const { files } = await starterCopies();
      // The copy's `listed` rejects: a search that finds a code read the list the starter carried.
      const tables = startedOn(files);
      await tables.start();
      assert.ok((await tables.search(groups.series, "141")).found.length > 0);
    });
  });

  describe("when a start is cut short", () => {
    let cut: unknown;
    let next: number;
    let readAtNext: readonly string[];
    let cutOffLast: unknown;
    let convertedAfterCut: number;

    before(async () => {
      const { files, stem, rowsCarried } = await starterCopies();
      // A lookup first copies the versions it reads, which leaves the vaccine groups' to the start.
      const firstRun = readsOf(files);
      firstRun.reads.failing = `${stem}${PUBLISHED_ROWS}`;
      const tables = startedOn(firstRun.files);
      await tables.about([cvx141]);
      cut = await thrownBy(() => tables.start());
      firstRun.reads.asked.length = 0;
      next = await tables.start();
      readAtNext = rowsRead(firstRun.reads);

      const last = readsOf(files);
      last.reads.failing = rowsCarried.at(-1);
      let converted = 0;
      const whole = startedOn(
        last.files,
        new MemoryFiles("urn:test:app-whole/"),
        () => {
          if (last.reads.failed) converted += 1;
        },
      );
      cutOffLast = await thrownBy(() => whole.start());
      convertedAfterCut = converted;
    });

    it("rejects with what failed", () => {
      assert.ok(cut instanceof Error);
      assert.match(cut.message, /the starter's network failed/);
    });

    it("copies, at the next start, only the version it had not written", async () => {
      const { stem } = await starterCopies();
      assert.ok(next > 0);
      assert.deepEqual(readAtNext, [`${stem}${PUBLISHED_ROWS}`]);
    });

    it("converts no version after the one that failed", () => {
      assert.ok(cutOffLast instanceof Error);
      assert.equal(convertedAfterCut, 0);
    });
  });

  describe("when a lookup comes before the start", () => {
    let current: readonly string[];
    let readAtCurrent: readonly string[];
    let named: boolean;
    let asked: readonly string[];
    let readTogether: readonly string[];
    let startAfter: number;
    let readDuringFailure: boolean;
    let copyError: unknown;

    before(async () => {
      const { files, order } = await starterCopies();
      const lookup = readsOf(files);
      const tables = startedOn(lookup.files);
      current = await tables.current();
      readAtCurrent = rowsRead(lookup.reads);
      named = (await tables.about([cvx141])).get(cvx141)?.name !== undefined;
      asked = [...lookup.reads.asked];

      const together = readsOf(files);
      const both = startedOn(together.files);
      await Promise.all([both.start(), both.about([cvx141])]);
      readTogether = rowsRead(together.reads).sort();
      startAfter = await both.start();

      // The second version's rows fail while the first's write waits.
      const failing = readsOf(files);
      failing.reads.failing = `${order[1]}${PUBLISHED_ROWS}`;
      const background = new MemoryFiles("urn:test:app-background/");
      let release = (): void => undefined;
      const gate = new Promise<void>((open) => (release = open));
      const behind = new StarterFiles(
        {
          iri: background.iri,
          list: (folder) => background.list(folder),
          read: (path) => background.read(path),
          write: async (path, bytes) => {
            if (path === `${order[0]}.ttl`) await gate;
            return background.write(path, bytes);
          },
        },
        failing.files,
        copying(),
      );
      const copy = behind.copyAll().then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        while (!failing.reads.failed)
          await new Promise((resolve) => setImmediate(resolve));
        readDuringFailure =
          (await behind.read(`${order[1]}.ttl`)) !== undefined;
      } finally {
        release();
      }
      copyError = await copy;
    });

    it("returns the starter's current versions before any is copied", () => {
      assert.ok(current.includes(groups.first));
      assert.deepEqual(readAtCurrent, []);
    });

    it("copies in only the versions the lookup reads", async () => {
      const { carried, stem } = await starterCopies();
      assert.ok(named);
      assert.deepEqual(
        [
          ...new Set(asked.filter((path) => versionsIn([path]).size === 0)),
        ].sort(),
        [HELD, "references.ttl"].sort(),
        "a first use reads of the starter what it holds and its index",
      );
      assert.deepEqual(
        [...versionsIn(asked).keys()].sort(),
        [...versionsIn(carried).keys()].filter((each) => each !== stem).sort(),
        "and the versions of the kinds it reads, names, status and ingredients, and not the vaccine groups'",
      );
    });

    it("reads each version once when a start and a lookup run together", async () => {
      const { rowsCarried } = await starterCopies();
      assert.deepEqual(readTogether, [...rowsCarried].sort());
      assert.equal(startAfter, 0, "the shared copy was written");
    });

    it("returns a version's rows to a read though the copy of another version has failed", () => {
      assert.ok(copyError instanceof Error);
      assert.ok(readDuringFailure);
    });
  });

  describe("given starter copies without search lists, as a browser's are", () => {
    let listings: { start: number; most: number; current: number };
    let afterCheck: { read: number; listed: number };
    let afterSearch: number;

    before(async () => {
      const { files, carried } = await starterCopies();
      const unlisted = new MemoryFiles("urn:test:starter-unlisted/");
      for (const path of carried)
        if (!path.endsWith(LISTED))
          await unlisted.write(path, (await files.read(path)) as Uint8Array);
      let listed = 0;
      let listing = 0;
      let most = 0;
      let read = 0;
      const store = new (class extends MemoryFiles {
        override read(pathOrIri: string): Promise<Uint8Array | undefined> {
          if (pathOrIri.endsWith(LISTED)) read += 1;
          return super.read(pathOrIri);
        }
      })("urn:test:app-unlisted/");
      const tables = new Tables({
        files: store,
        feeds: [FEED],
        vocabulary: parts.vocabulary,
        newStore: parts.newStore,
        fetch: fetchOf(first),
        starter: unlisted,
        work: {
          ...IN_THIS_THREAD,
          listed: async (...args) => {
            listed += 1;
            listing += 1;
            most = Math.max(most, listing);
            try {
              await new Promise((resolve) => setImmediate(resolve));
              return await IN_THIS_THREAD.listed(...args);
            } finally {
              listing -= 1;
            }
          },
        },
      });
      const searches = (): Promise<unknown> =>
        Promise.all([
          tables.search(groups.series, "141"),
          tables.search(groups.series, "141"),
        ]);
      const started = tables.start();
      await searches();
      await started;
      listings = {
        start: listed,
        most,
        current: (await tables.current()).length,
      };
      read = 0;
      await tables.check();
      afterCheck = { read, listed };
      await searches();
      afterSearch = listed;
    });

    it("makes each current version's search list once, for a start and two searches at once", () => {
      assert.equal(listings.start, listings.current);
    });

    it("makes at most two search lists at a time", () => {
      assert.ok(listings.most <= 2, `${listings.most} at a time`);
    });

    it("makes none at a check, and reads none", () => {
      assert.deepEqual(afterCheck, { read: 0, listed: listings.current });
    });

    it("makes none at a search after the start", () => {
      assert.equal(afterSearch, listings.current);
    });
  });

  describe("given a store whose search list is cut short, in another format or by other code systems", () => {
    it("makes the search list again at a start", async () => {
      const path = `${fileStem(groups.second)}${LISTED}`;
      const checked = await checkedStore(feed);
      const valid = JSON.parse(
        new TextDecoder().decode(await checked.read(path)),
      ) as Record<string, unknown>;
      const cases: [string, string][] = [
        ["cut short", "{"],
        [
          "in another format",
          JSON.stringify({ ...valid, codes: [], format: 0 }),
        ],
        [
          "by other code systems",
          JSON.stringify({
            ...valid,
            codes: [],
            uriSpaces: ["urn:test:other:"],
          }),
        ],
      ];
      for (const [input, kept] of cases) {
        const files = await checkedStore(feed);
        await files.write(path, new TextEncoder().encode(kept));
        await tablesOver(feed, files).start();
        assert.deepEqual(
          JSON.parse(new TextDecoder().decode(await files.read(path))),
          valid,
          input,
        );
      }
    });
  });

  describe("given a store emptied while the app runs", () => {
    it("returns the starter's current versions again", async () => {
      const { files } = await starterCopies();
      const app = join(scratch, "reset");
      const tables = startedOn(files, new FolderFiles(join(app, ".tables")));
      const shipped = await tables.current();
      await tables.start();
      await rm(app, { recursive: true, force: true });
      assert.deepEqual(await tables.current(), shipped);
    });
  });

  describe("given a newer package whose starter no longer carries a version the store names", () => {
    /** An app that has read a version, and the newer starter, which lacks it, over its store. */
    async function upgraded(): Promise<Tables> {
      const { files, carried, stem } = await starterCopies();
      const movedOn = new MemoryFiles("urn:test:starter-moved-on/");
      for (const path of carried)
        if (!path.startsWith(stem))
          await movedOn.write(path, (await files.read(path)) as Uint8Array);
      const stranded = new MemoryFiles("urn:test:app-stranded/");
      await startedOn(files, stranded).about([cvx141]);
      return startedOn(movedOn, stranded);
    }

    it("throws `Refusal` from a search of that version, naming it", async () => {
      await assert.rejects(
        (await upgraded()).search(groups.series, "141"),
        (error) =>
          error instanceof Refusal &&
          error.message === `the tables hold no rows for ${groups.first}`,
      );
    });

    it("finds the series' codes again once a check has kept its next version", async () => {
      const tables = await upgraded();
      await tables.check();
      assert.ok((await tables.search(groups.series, "141")).found.length > 0);
    });
  });

  describe("given rows a server sends already unzipped", () => {
    it("reads them the same as rows sent gzipped", async () => {
      // A Node `fetch` never hands back unzipped what it asked for gzipped; a browser's does, from a host that says so.
      const rows = `<urn:test:a> <urn:test:b> "c" <urn:test:graph> .\n`;
      const read = async (bytes: Uint8Array) =>
        new TextDecoder().decode(
          await IN_THIS_THREAD.published(new Uint8Array(bytes)),
        );
      assert.equal(
        await read(new TextEncoder().encode(rows)),
        await read(await gzipped(rows)),
      );
    });
  });
});

/**
 * An app sets its own reference tables in a `cascade-runtime.json` in the folder it runs in, or in code with
 * `configureTables`: the feeds it reads, whether it checks them when it starts, the series a code's name is read from,
 * and the builders it runs. Code wins over the file, and both are read once, before the first pod opens.
 */
describe("Choosing an app's feeds and settings · configureTables(), cascade-runtime.json", () => {
  describe("given an app's own `cascade-runtime.json`", () => {
    const packageConfig = join(
      findRoot(dirname(fileURLToPath(import.meta.url))),
      "cascade-runtime.json",
    );

    /** A new folder holding the app's file with the settings given. */
    async function appWith(file: unknown): Promise<string> {
      const app = await mkdtemp(join(scratch, "app-"));
      await writeFile(join(app, "cascade-runtime.json"), JSON.stringify(file));
      return app;
    }

    it("returns the package's settings with each one the file sets in its place", async () => {
      const packaged = parts.local.config;
      const preference = { [`${CASCADE}CodeNames`]: [EXAMPLE_NAMES] };
      const cases: [string, unknown, object][] = [
        [
          "a file that sets feeds and an order of preference",
          { tables: { feeds: [OTHER_FEED], preference } },
          {
            feeds: [OTHER_FEED],
            preference,
            checkOnOpen: packaged.tables.checkOnOpen,
          },
        ],
        ["a file that sets no feed", { tables: { feeds: [] } }, { feeds: [] }],
      ];
      for (const [input, file, expected] of cases)
        assert.deepEqual(
          withTables(
            packaged,
            await appSettings(await appWith(file), packageConfig),
          ).tables,
          { ...packaged.tables, ...expected },
          input,
        );
    });

    it("keeps a builder given by name, and resolves one given by path from the file's folder", async () => {
      const app = await appWith({
        tables: { builders: ["cdc-cvx", "../mine"] },
      });
      assert.deepEqual((await appSettings(app, packageConfig)).builders, [
        "cdc-cvx",
        resolve(app, "..", "mine"),
      ]);
    });

    it("throws, saying what is wrong, for a file that sets what it may not or sets it wrongly", async () => {
      const cases: [string, unknown, RegExp][] = [
        [
          "two builders built into one folder",
          { tables: { builders: ["loinc", "./mine/loinc"] } },
          /builders names more than one builder built into loinc/,
        ],
        [
          "a file naming more than tables",
          { tables: {}, lens: "everyday" },
          /names lens, and names nothing but tables/,
        ],
        [
          "an order of preference not of IRIs",
          { tables: { preference: { [`${CASCADE}CodeNames`]: ["names"] } } },
          /preference does not give/,
        ],
        [
          "a feed that is no URL",
          { tables: { feeds: ["feed.ttl"] } },
          /feeds is not a list of URLs/,
        ],
      ];
      for (const [input, file, expected] of cases)
        await assert.rejects(
          appSettings(await appWith(file), packageConfig),
          expected,
          input,
        );
    });
  });

  describe("given a folder whose `cascade-runtime.json` is the package's own", () => {
    it("reads nothing from a `cascade-runtime.json` that is the package's own", async () => {
      const app = await mkdtemp(join(scratch, "app-"));
      const own = join(app, "cascade-runtime.json");
      await writeFile(own, JSON.stringify({ tables: { feeds: [OTHER_FEED] } }));
      assert.deepEqual(await appSettings(app, own), {});
    });
  });

  describe("given a setting in the file and another in code", () => {
    let started: StartedApp;

    before(async () => {
      started = await startedApp();
    });

    it("uses the code's `feeds` and `checkOnOpen` in place of the file's", () => {
      // The file names another feed and turns the check on open off; the code names the test feed and turns it on.
      assert.deepEqual(
        [...new Set(started.checked.map(({ feed: read }) => read))],
        [FEED],
        "the feeds",
      );
      assert.ok(!started.asked.includes(OTHER_FEED), "the feeds");
      assert.ok(started.askedWhileChecking.includes(FEED), "the check on open");
    });
  });

  describe("configureTables(settings)", () => {
    let started: StartedApp;

    before(async () => {
      started = await startedApp();
    });

    it("throws for a setting that is not the tables' to set, naming it", () => {
      assert.match(
        String(started.unsettable),
        /configureTables names repository, which it cannot set/,
      );
    });

    it("throws once the first pod has opened", () => {
      assert.match(
        String(started.afterMade),
        /configureTables comes before the first pod opens: the tables are already made/,
      );
    });
  });

  describe("when the app's file is one the package cannot use", () => {
    let started: StartedApp;

    before(async () => {
      started = await startedApp();
    });

    it("rejects the app's first call, saying what the file may not name", () => {
      assert.match(String(started.failedStart), /names nothing but tables/);
    });

    it("accepts `configureTables` again after that", () => {
      assert.equal(started.afterFailedStart, undefined);
    });
  });
});

/**
 * When an app's reference tables have changed since a pod was last opened, opening the pod gives it the newer versions
 * and lets the matcher judge what they newly join. `pod.opened` is that act, and it and `pod.unheldTableVersions()`
 * name any version the pod uses that this app does not hold.
 * @rule runtime/opening.feature O1
 * @rule runtime/opening.feature O2
 * @rule runtime/matcher.feature M7
 */
describe("Opening a pod with newer reference tables · openPod(), pod.opened, pod.unheldTableVersions()", () => {
  describe("given tables with a newer version than the pod was last opened with", () => {
    let hana: Hana;

    before(async () => {
      hana = await hanaPod();
    });

    it("returns the open as `pod.opened`, with the files it wrote and nothing refused", () => {
      assert.ok(hana.adopted);
      assert.equal(hana.adopted.refused, undefined);
      assert.ok(hana.adopted.wrote.length > 0);
    });

    it("returns an empty `unheld` in it", () => {
      assert.deepEqual(hana.adopted?.unheld, []);
    });
  });

  describe("given the same tables as at the pod's last open", () => {
    let hana: Hana;

    before(async () => {
      hana = await hanaPod();
    });

    it("returns no `pod.opened`", () => {
      assert.equal(hana.again.opened, undefined);
    });

    it("returns none from `pod.unheldTableVersions()`", () => {
      assert.deepEqual(hana.again.unheld, []);
    });
  });

  describe("given only a newer version of the vocabulary's rule list", () => {
    let revised: Pod["opened"];

    before(async () => {
      const store = await checkedStore(feed);
      const folder = join(scratch, "pods", "empty");
      await opening(tablesOver(feed, store), folder, async () => undefined);
      revised = await opening(
        tablesOver(feed, store, await ruleListRevised()),
        folder,
        async (pod) => pod.opened,
      );
    });

    it("returns `pod.opened`, with nothing refused", () => {
      assert.ok(revised);
      assert.equal(revised.refused, undefined);
    });
  });

  describe("given tables that lack a version the pod uses", () => {
    let hana: Hana;

    before(async () => {
      hana = await hanaPod();
    });

    it("returns the version in `pod.opened.unheld`, with nothing written", () => {
      const [firstOpen] = hana.lacking;
      assert.deepEqual(
        firstOpen?.opened?.unheld,
        [groups.second, hana.ingredients.adopted].sort(),
      );
      assert.deepEqual(firstOpen?.opened?.wrote, []);
    });

    it("returns the version from `pod.unheldTableVersions()` at a later open, which has no `pod.opened`", () => {
      const [, later] = hana.lacking;
      assert.equal(later?.opened, undefined);
      assert.deepEqual(
        later?.unheld,
        [groups.second, hana.ingredients.adopted].sort(),
      );
    });
  });

  describe("given a check that has kept one version and not yet the next", () => {
    let lagging: readonly string[];
    let atGate: readonly string[];
    let heldAtGate: readonly string[];
    let asked: Row[];
    let readUnder: Row[] | undefined;
    let readUnderLagging: Row[] | undefined;

    before(async () => {
      const advil: [string, string] = ["153010", "5640"];
      const ibuprofen: [string, string] = ["5640", "5640"];
      const ingredientsFirst = await withMappings(first, INGREDIENTS, [
        [advil, ibuprofen],
      ]);
      const ingredientsLater = await withMappings(feed, INGREDIENTS, [
        [advil, ibuprofen],
        [advil, ibuprofen, ["723", "723"]],
      ]);
      const racing = new MemoryFiles("urn:test:tables-racing/");
      const midway = join(scratch, "pods", "midway");
      const answers = new MemoryFiles("urn:test:answers-midway/");
      const answering = {
        ...parts,
        answers: { runtime: "test", at: () => answers },
      };
      await tablesOver(ingredientsFirst.served, racing).check();
      await (
        await openPodWith(
          {
            ...answering,
            tables: tablesOver(ingredientsFirst.served, racing),
          },
          midway,
        )
      ).close();
      let reached!: () => void;
      const gated = new Promise<void>((resolve) => (reached = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let downloads = 0;
      const served = fetchOf(ingredientsLater.served);
      const checking = new Tables({
        files: racing,
        feeds: [FEED],
        vocabulary: parts.vocabulary,
        newStore: parts.newStore,
        fetch: async (input, init) => {
          if (String(input).endsWith(PUBLISHED_ROWS) && ++downloads === 2) {
            reached();
            await released;
          }
          return served(input, init);
        },
      });
      const withCurrent = (current: readonly string[]): Tables =>
        new Proxy(checking, {
          get: (target, property) =>
            property === "current"
              ? () => Promise.resolve(current)
              : (Reflect.get(target, property, target) as () => unknown).bind(
                  target,
                ),
        });
      lagging = await checking.current();
      const check = checking.check();
      try {
        await Promise.race([
          gated,
          check.then(() =>
            assert.fail(
              "the check kept fewer than two versions, so it never reached the gate",
            ),
          ),
        ]);
        atGate = await checking.current();
        heldAtGate = (await checking.held())
          .map(({ current }) => current.iri)
          .sort();
        // As a pod is opened that reads the references after a check writes the index and what is held before it does.
        const opened = await openPodWith(
          { ...answering, tables: withCurrent(lagging) },
          midway,
          { adopt: false },
        );
        asked = await opened.ask(QUESTION);
        await opened.close();
        release();
        await check;
        const kept = (tables: readonly string[]) =>
          keptPod(
            { ...parts, tables: withCurrent(tables) },
            new FolderFiles(midway),
            new Answers(answers, "test"),
          );
        readUnder = await (await kept(atGate))?.rows(QUESTION);
        readUnderLagging = await (await kept(lagging))?.rows(QUESTION);
      } finally {
        release();
        await check;
      }
    });

    it("returns from `tables.current()` the version just kept", () => {
      assert.notDeepEqual(lagging, atGate);
      assert.deepEqual(
        atGate,
        heldAtGate,
        "what is held names the current versions after each version a check keeps",
      );
    });

    it("keeps the pod's answers under the versions the pod was opened with", () => {
      assert.deepEqual(
        readUnder,
        asked,
        "a pod opened midway through a check keeps its answers under the versions it was opened with",
      );
      assert.equal(
        readUnderLagging,
        undefined,
        "the kept answers are a miss under the versions the pod did not open with",
      );
    });
  });
});

/**
 * A page that shows a person their reference tables lists each series the app holds, with its versions and where it
 * came from, and searches a series' codes by the code as written or by words of its name.
 */
describe("Listing and searching the reference tables · tables.held(), tables.uses(), tables.search(), tables.codeNamed()", () => {
  /** What the test feed says of a subject. */
  const of = (subject: string, predicate: string): string | undefined =>
    feed.catalog.find(
      ([s, p]) => s.value === subject && p.value === predicate,
    )?.[2].value;
  type Held = Awaited<ReturnType<Tables["held"]>>;
  const vaccineGroups = (held: Held) =>
    held.find(({ iri: series }) => series === groups.series);

  describe("tables.held()", () => {
    const watched = { at: "2026-10-08T19:00:00Z", found: "nothing new" };
    let held: Held;
    let alongside: Held;

    before(async () => {
      const source = of(groups.series, "http://purl.org/dc/terms/source") ?? "";
      const store = await checkedStore(first);
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
      const beside = tablesOver(first, store);
      await beside.held();
      await tables.check();
      held = await tables.held();
      alongside = await beside.held();
    });

    it("returns the series in the order of their labels", () => {
      const label = (series: string): string =>
        of(series, `${RDFS}label`) ?? series;
      assert.deepEqual(
        held.map((series) => series.label),
        held.map((series) => label(series.iri)).sort(),
      );
    });

    it("returns a series' versions, the current one first", () => {
      assert.deepEqual(
        vaccineGroups(held)?.versions.map((version) => version.iri),
        [groups.second, groups.first],
      );
    });

    it("returns the credit a series' publisher asks for, and the feed the series came from", () => {
      assert.equal(
        vaccineGroups(held)?.credit,
        of(groups.series, "http://purl.org/dc/terms/bibliographicCitation"),
      );
      assert.equal(vaccineGroups(held)?.feed, FEED);
    });

    it("returns, from the `checked.json` beside the feed, when the series' publisher was last checked for a newer release", () => {
      assert.deepEqual(vaccineGroups(held)?.watched, watched);
    });

    it("leaves out the vocabulary's rule list", () => {
      assert.deepEqual(
        held.filter((series) => series.kind === undefined),
        [],
      );
    });

    it("returns what another app on the same store has kept since", () => {
      assert.equal(vaccineGroups(alongside)?.current.iri, groups.second);
    });
  });

  describe("tables.current()", () => {
    it("returns the current version of each series `held()` lists", async () => {
      const tables = await checkedFeed();
      assert.deepEqual(
        await tables.current(),
        (await tables.held()).map((series) => series.current.iri).sort(),
      );
    });
  });

  describe("tables.uses() and tables.openedWith(pod)", () => {
    let uses: Awaited<ReturnType<Tables["uses"]>>;
    let openedInMemory: readonly string[] | undefined;

    before(async () => {
      const tables = tablesOver(first, await checkedStore(first));
      await opening(tables, join(scratch, "pods", "uses"), async () => {});
      uses = await tables.uses();
      openedInMemory = await opening(tables, undefined, (pod) =>
        tables.openedWith(pod.address),
      );
    });

    it("returns under each version the names of the pods last opened with it", () => {
      assert.deepEqual(uses[groups.first], ["uses"]);
    });

    it("returns undefined for a pod opened in memory", () => {
      assert.equal(openedInMemory, undefined);
    });

    it("returns undefined, and no use, for a pod whose versions an older package saved as null", async () => {
      const dir = await mkdtemp(join(scratch, "held-"));
      const pod = "https://example.org/pod/";
      await tablesOver(feed, new FolderFiles(dir)).recordOpen(pod, [
        "https://example.org/v1",
      ]);
      const saved = JSON.parse(
        await readFile(join(dir, "tables.json"), "utf8"),
      );
      saved.pods[pod] = null;
      await writeFile(join(dir, "tables.json"), JSON.stringify(saved));
      const again = tablesOver(feed, new FolderFiles(dir));
      assert.equal(await again.openedWith(pod), undefined);
      assert.deepEqual(await again.uses(), {});
    });
  });

  describe("tables.search(series, text, page)", () => {
    const count = PAGE_SIZE * 2 + 3;
    let tables: Tables;
    let held: Held;
    let paged: {
      found: string[][];
      totals: number[];
      offsets: number[];
      asked: string[][];
      aboutCodes: string[][];
    };

    before(async () => {
      tables = await checkedFeed();
      held = await tables.held();
      const { served } = await withMappings(feed, INGREDIENTS, [
        Array.from({ length: count }, (_, at) => [`${at + 1}`, "0"] as const),
      ]);
      const series = tablesOver(served);
      await series.check();
      const asked: string[] = [];
      const about = series.about.bind(series);
      series.about = (codes) => {
        asked.push(...codes);
        return about(codes);
      };
      paged = { found: [], totals: [], offsets: [], asked: [], aboutCodes: [] };
      for (const page of [1, 2, 3, 4]) {
        asked.length = 0;
        const searched = await series.search(INGREDIENTS.series, "", page);
        paged.found.push(searched.found.map(({ notation }) => notation));
        paged.totals.push(searched.total);
        paged.offsets.push(searched.offset);
        paged.asked.push([...new Set(asked)].sort());
        paged.aboutCodes.push(
          [
            ...new Set(
              searched.found.flatMap(({ code }) => [code, `${RXNORM}0`]),
            ),
          ].sort(),
        );
      }
    });

    it("finds a code by the code as written", async () => {
      const [shot, ...others] = (await tables.search(groups.series, "141"))
        .found;
      assert.equal(others.length, 0);
      assert.equal(shot?.notation, "141");
    });

    it("finds a code by words of its name, whatever their case", async () => {
      const names = held.find(({ kind }) => kind?.endsWith("#CodeNames"));
      assert.ok(names);
      const named = await tables.search(names.iri, "SPLIT VIRUS");
      assert.ok(named.found.some(({ notation }) => notation === "141"));
      for (const { about } of named.found)
        assert.ok(
          [about?.name?.label ?? "", ...(about?.name?.altLabels ?? [])].some(
            (text) => text.toLowerCase().includes("split virus"),
          ),
        );
    });

    it("returns with each code its name and the codes it maps to, each with its name", async () => {
      const names = held.find(({ kind }) => kind?.endsWith("#CodeNames"));
      assert.ok(names);
      const nameRows = await gunzipped(
        feed.files.get(rowsUrl(feed, names.current.iri)) ?? new Uint8Array(),
      );
      const nameOf = (code: string): string | undefined =>
        new RegExp(`/cvx/${code}> <[^>]*#prefLabel> "([^"]*)"`).exec(
          nameRows,
        )?.[1];
      const [shot] = (await tables.search(groups.series, "141")).found;
      assert.equal(shot?.about?.name?.label, nameOf("141"));
      assert.ok((shot?.mapsTo.length ?? 0) > 0);
      for (const group of shot?.mapsTo ?? [])
        assert.equal(group.about?.name?.label, nameOf(group.notation));
    });

    it("returns the codes of several series as one list, each code once", async () => {
      const listed = await Promise.all(
        held.map(async (series) =>
          (await tables.search(series.iri, "")).found.map(({ code }) => code),
        ),
      );
      const all = await tables.search(
        held.map(({ iri: series }) => series),
        "",
      );
      assert.deepEqual(
        new Set(all.found.map(({ code }) => code)),
        new Set(listed.flat()),
      );
      assert.equal(all.total, new Set(listed.flat()).size);
    });

    it("returns 50 codes a page, in the order of the codes as written", () => {
      assert.deepEqual(
        paged.found.map((page) => page.length),
        [PAGE_SIZE, PAGE_SIZE, 3, 0],
      );
      assert.deepEqual(
        paged.found.flat(),
        Array.from({ length: count }, (_, at) => `${at + 1}`),
      );
    });

    it("returns `total` and `offset` with every page, and no code past the last page", () => {
      assert.deepEqual(paged.totals, [count, count, count, count]);
      assert.deepEqual(
        paged.offsets,
        [1, 2, 3, 4].map((page) => (page - 1) * PAGE_SIZE),
      );
    });

    it("looks up the names of only the codes on the page and the codes they map to", () => {
      assert.deepEqual(paged.asked, paged.aboutCodes);
    });

    it("throws `Refusal` for a series whose version no file can be named for", async () => {
      await assert.rejects(
        (await nameless()).search("urn:test:series", ""),
        Refusal,
      );
    });
  });

  describe("merged(lists, spaces), which orders the codes `tables.search()` returns", () => {
    it("orders codes written alike but for leading zeros, such as `07` and `7`, with the earlier series first", () => {
      const spaces = ["urn:test:a:", "urn:test:b:", "urn:test:c:"];
      const [a1, a7, a11, b7, b07, b10, c07, c9] = [
        "urn:test:a:1",
        "urn:test:a:07",
        "urn:test:a:11",
        "urn:test:b:7",
        "urn:test:b:07",
        "urn:test:b:10",
        "urn:test:c:07",
        "urn:test:c:9",
      ];
      const [l0, l1, l2, l3, l4] = [
        [a1, c07],
        [b07, c9],
        [a7, b10],
        [b7],
        [a7, a11],
      ];
      for (const [lists, expected] of [
        [[], []],
        [[l1], l1],
        [
          [l0, l1, l2],
          [a1, c07, b07, a7, c9, b10],
        ],
        [
          [l0, l1, l2, l3],
          [a1, c07, b07, a7, b7, c9, b10],
        ],
        [
          [l0, l1, l2, l3, l4],
          [a1, c07, b07, a7, b7, c9, b10, a11],
        ],
        [
          [l2, [], l0],
          [a1, a7, c07, b10],
        ],
      ] as const)
        assert.deepEqual(
          [...merged(lists, spaces)],
          expected,
          `${lists.length} lists`,
        );
    });

  });

  describe("listing(text, spaces), which makes a version's search list", () => {
    it("puts in a version's search list every code with a preferred name, whatever its code system, and none with only an alternative name", () => {
      const space = "https://ns.cascadeprotocol.org/codes/cvx/";
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

  });

  describe("given a search list kept beside a version that cannot be used", () => {
    it("makes the search list again at a search, and finds the version's codes", async () => {
      const path = `${fileStem(groups.second)}${LISTED}`;
      const valid = JSON.parse(
        new TextDecoder().decode(await (await checkedStore(feed)).read(path)),
      ) as Record<string, unknown>;
      const cvx141 = `${CVX}141`;
      const cases: [string, string][] = [
        ["cut short", "{"],
        [
          "in another format",
          JSON.stringify({ ...valid, codes: [], format: 0 }),
        ],
        [
          "by other code systems",
          JSON.stringify({
            ...valid,
            codes: [],
            uriSpaces: ["urn:test:other:"],
          }),
        ],
        ["with no `mapsTo`", JSON.stringify({ ...valid, mapsTo: null })],
        [
          "with no `names`",
          JSON.stringify({ ...valid, codes: [], names: null }),
        ],
        [
          "with a name that is a number",
          JSON.stringify({ ...valid, names: { [cvx141]: 141 } }),
        ],
      ];
      for (const [input, kept] of cases) {
        const files = await checkedStore(feed);
        await files.write(path, new TextEncoder().encode(kept));
        const { found } = await tablesOver(feed, files).search(
          groups.series,
          "141",
        );
        assert.deepEqual(
          found.map(({ notation }) => notation),
          ["141"],
          input,
        );
        assert.deepEqual(
          JSON.parse(new TextDecoder().decode(await files.read(path))),
          valid,
          input,
        );
      }
    });
  });

  describe("tables.codeNamed(series, written)", () => {
    it("returns a code the series maps to, by the code as written", async () => {
      const { served } = await withMappings(feed, INGREDIENTS, [
        [
          ["1", "0"],
          ["2", "0"],
        ],
      ]);
      const tables = tablesOver(served);
      await tables.check();
      assert.equal(
        await tables.codeNamed(INGREDIENTS.series, "0"),
        `${RXNORM}0`,
      );
    });
  });
});

/**
 * `about` returns what the reference tables say of each code an app shows: the code as written, its name, whether it
 * is retired, and a product's ingredients. `facts` returns everything every table says of one code, each with the series
 * and version it came from, among them the panels a lab test is in and the drug classes a medicine is in.
 */
describe("Looking up a code in the reference tables · tables.about(), tables.facts(), tables.inPanels(), tables.classedElsewhere()", () => {
  const cvx141 = `${CVX}141`;
  const cvx57 = `${CVX}57`;
  const cvx03 = `${CVX}03`;
  const unknown = `${CVX}999999`;

  describe("tables.about(codes)", () => {
    let answered: {
      names: string;
      label: string;
      about: Awaited<ReturnType<Tables["about"]>>;
      references: Awaited<ReturnType<Tables["references"]>>;
    }[];
    let ingredients: Awaited<ReturnType<typeof brandIngredients>>;

    before(async () => {
      const { store } = await built();
      answered = [];
      for (const [names, status, label] of [
        [
          CVX_NAMES,
          CVX_STATUS,
          "Influenza, split virus, trivalent, preservative",
        ],
        [EXAMPLE_NAMES, EXAMPLE_STATUS, "flu, split"],
      ] as const) {
        const tables = (
          await partsOf(components, {
            tables: {
              feeds: [],
              preference: {
                [`${CASCADE}CodeNames`]: [names],
                [`${CASCADE}RetiredCodes`]: [status],
              },
            },
          })
        ).tablesIn(store);
        answered.push({
          names,
          label,
          references: await tables.references(),
          about: await tables.about([cvx141, cvx57, cvx03, unknown]),
        });
      }
      ingredients = await brandIngredients();
    });

    it("returns every code asked with the code as written, and nothing more for a code no table holds", () => {
      for (const { about, names } of answered) {
        assert.equal(about.get(cvx141)?.notation, "141", names);
        const unnamed = about.get(unknown);
        assert.equal(unnamed?.notation, "999999", names);
        assert.equal(unnamed?.name, undefined, names);
        assert.equal(unnamed?.status, undefined, names);
        assert.equal(unnamed?.ingredients, undefined, names);
      }
    });

    it("returns a code's name from the series the app's order of preference names first", () => {
      for (const { about, names, label, references } of answered) {
        const name = about.get(cvx141)?.name;
        assert.equal(name?.label, label, names);
        assert.equal(references.seriesOf(name?.origin ?? ""), names, names);
      }
    });

    it("returns a code's status from a later series where the first does not hold the code", () => {
      for (const { about, names, references } of answered)
        for (const [code, holder] of [
          [cvx57, CVX_STATUS],
          [cvx03, EXAMPLE_STATUS],
        ] as const) {
          const retired = about.get(code)?.status;
          assert.equal(retired?.deprecated, true, `${names} ${code}`);
          assert.equal(
            references.seriesOf(retired?.origin ?? ""),
            holder,
            `${names} ${code}`,
          );
        }
    });

    it("returns a product's ingredients from the first product ingredients series that maps it, with the version that says so", () => {
      const { about, versions, brand, ibuprofen } = ingredients;
      const mapped = about.get(brand)?.ingredients;
      assert.deepEqual([...(mapped?.codes ?? [])].sort(), [
        `${RXNORM}5640`,
        `${RXNORM}7052`,
      ]);
      assert.equal(mapped?.origin, versions[0]);
      assert.deepEqual(about.get(ibuprofen)?.ingredients?.codes, [
        `${RXNORM}5640`,
      ]);
    });

    it("returns no ingredients for a code no row maps", () => {
      assert.equal(
        ingredients.about.get(ingredients.unmapped)?.ingredients,
        undefined,
      );
    });

    it("returns a product's ingredient and never its precise ingredient", async () => {
      const { tables } = await plantedTables();
      const about = await tables.about([`${RXNORM}2588848`]);
      assert.deepEqual(about.get(`${RXNORM}2588848`)?.ingredients?.codes, [
        `${RXNORM}${KETOCONAZOLE}`,
      ]);
    });

    it("reads each version's rows from the store once, however many lookups follow", async () => {
      const reads: string[] = [];
      const inner = await checkedStore(feed);
      const counted: Files = {
        iri: inner.iri,
        read: (path) => {
          reads.push(path);
          return inner.read(path);
        },
        write: (path, bytes) => inner.write(path, bytes),
        list: (folder) => inner.list(folder),
      };
      const tables = tablesOver(feed, counted);
      const rowFiles = (): string[] =>
        reads.filter(
          (path) => path.endsWith(".ttl") && path !== "references.ttl",
        );
      await tables.about([cvx141]);
      assert.ok(rowFiles().length > 0, "the first lookup read no rows");
      reads.length = 0;
      await tables.about([cvx141]);
      await tables.about([`${CVX}88`]);
      assert.deepEqual(rowFiles(), []);
    });

    it("throws `Refusal` when a series it reads has a version no file can be named for", async () => {
      await assert.rejects(
        (await nameless()).about(["urn:test:code"]),
        Refusal,
      );
    });
  });

  describe("tables.facts(code)", () => {
    it("returns what each table kind says of the code, each with its series and current version", async () => {
      const tables = await checkedFeed();
      const held = await tables.held();
      const listed = await Promise.all(
        held.map(async (series) =>
          (await tables.search(series.iri, "")).found.map(({ code }) => code),
        ),
      );
      const [code] = listed.reduce((both, codes) =>
        both.filter((each) => codes.includes(each)),
      );
      assert.ok(code, "no code is in every series of the test feed");
      const facts = await tables.facts(code);
      const fact = (kind: string) => {
        const series = held.find((each) => each.kind?.endsWith(`#${kind}`));
        assert.ok(series, kind);
        return { series: series.iri, version: series.current.iri };
      };
      const from = ({
        series,
        version,
      }: {
        series: string;
        version: string;
      }) => ({
        series,
        version,
      });
      assert.deepEqual(facts.names.map(from), [fact("CodeNames")]);
      assert.deepEqual(facts.status.map(from), [fact("RetiredCodes")]);
      assert.deepEqual(facts.mappings.map(from), [fact("VaccineGroups")]);
    });

    it("returns only what the series named in `among` say", async () => {
      const tables = await checkedFeed();
      const names = (await tables.held()).find(({ kind }) =>
        kind?.endsWith("#CodeNames"),
      );
      assert.ok(names);
      const among = await tables.facts(cvx141, [names.iri]);
      assert.equal(among.names.length, 1);
      assert.equal(among.mappings.length, 0);
      const all = await tables.facts(cvx141);
      assert.equal(all.names.length, 1);
      assert.equal(all.mappings.length, 1);
    });

    it("returns a panel's tests in the panel's own order, each with whether the panel requires it and its name", async () => {
      const { tables } = await plantedTables();
      const facts = await tables.facts(`${LOINC}${PANEL}`);
      assert.deepEqual(
        facts.panels[0]?.members.map(
          ({ notation, sequence, required, about }) => [
            notation,
            sequence,
            required,
            about?.name?.label,
          ],
        ),
        [
          [
            "2823-3",
            1,
            undefined,
            "Potassium [Moles/volume] in Serum or Plasma",
          ],
          ["2951-2", 2, "R", "Sodium [Moles/volume] in Serum or Plasma"],
          ["17861-6", 3, "R-a", undefined],
        ],
      );
    });

    it("lists a panel's tests under `panels` and never under `mappings`", async () => {
      const { tables } = await plantedTables();
      const facts = await tables.facts(`${LOINC}${PANEL}`);
      assert.deepEqual(
        facts.mappings.filter(({ series }) => series === PANELS.series),
        [],
      );
    });

    it("returns a lab test's name and the panels that hold it, with its place in each", async () => {
      const { tables } = await plantedTables();
      const potassium = await tables.facts(`${LOINC}2823-3`);
      assert.equal(
        potassium.about?.name?.label,
        "Potassium [Moles/volume] in Serum or Plasma",
      );
      assert.deepEqual(
        potassium.panels.map(({ heldBy }) => [
          heldBy.total,
          heldBy.panels.map(({ notation, sequence }) => [notation, sequence]),
        ]),
        [[1, [[PANEL, 1]]]],
      );
    });

    it("returns a class given on the code itself with no `through`", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(
        (await tables.facts(`${RXNORM}1546022`)).classes.flatMap(
          ({ in: each }) => each.map(({ through }) => through),
        ),
        [undefined, undefined],
      );
    });

    it("returns no class for a combination product", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual((await tables.facts(`${RXNORM}197885`)).classes, []);
    });

    it("returns a product's classes through its own precise ingredient where that is classed, else through its ingredient", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(
        await classLines(tables, "197658"),
        [
          `establishedPharmacologicClass N0000175825 through ${ESTRADIOL}`,
          `mechanismOfActionClass N0000000100 through ${ESTRADIOL}`,
        ],
        "estradiol tablet",
      );
      assert.deepEqual(
        await classLines(tables, "2588848"),
        [
          `establishedPharmacologicClass N0000193183 through ${LEVOKETOCONAZOLE}`,
          `chemicalStructureClass ${AZOLES} through ${KETOCONAZOLE}`,
        ],
        "levoketoconazole tablet",
      );
    });

    it("returns `withheld`, naming the ingredient, where only a different form of the ingredient is classed", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(await classLines(tables, "314076"), [
        `establishedPharmacologicClass withheld, a different form of ${LISINOPRIL}`,
        `mechanismOfActionClass withheld, a different form of ${LISINOPRIL}`,
      ]);
    });

    it("returns a precise ingredient's own classes", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(await classLines(tables, FLUOROESTRADIOL), [
        "establishedPharmacologicClass N0000177914",
        "mechanismOfActionClass N0000175869",
      ]);
    });
  });

  describe("given a product ingredients version that states no precise ingredient", () => {
    let statesNone: string[];
    let statesThem: string[];

    before(async () => {
      const none = await withMappings(feed, PRECISE_INGREDIENTS, [
        ESTRADIOL_ROWS,
      ]);
      const them = await withMappings(feed, PRECISE_INGREDIENTS, [
        ESTRADIOL_ROWS,
        [...ESTRADIOL_ROWS, ["2588848", LEVOKETOCONAZOLE]],
      ]);
      const files = new MemoryFiles("urn:test:tables/");
      const classed = async (served: Served): Promise<string[]> => {
        const { served: withClasses } = await withMappings(
          served,
          CLASSES_BY_RELATION,
          [ESTRADIOL_CLASSES],
        );
        const tables = tablesOver(withClasses, files);
        await tables.check();
        return classLines(tables, "197658");
      };
      statesNone = await classed(none.served);
      statesThem = await classed(them.served);
    });

    it("returns no class for a product through its ingredient", () => {
      assert.deepEqual(
        statesNone,
        [],
        "a version that states no precise ingredient says nothing of other forms",
      );
    });

    it("returns the ingredient's classes once a check has kept a version that states them", () => {
      assert.deepEqual(statesThem, [
        `establishedPharmacologicClass N0000175825 through ${ESTRADIOL}`,
        `mechanismOfActionClass N0000000100 through ${ESTRADIOL}`,
      ]);
    });
  });

  describe("tables.inPanels(code)", () => {
    it("returns each panel that lists a lab test, with the panel's name and the test's place in it", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(
        (await tables.inPanels(`${LOINC}2823-3`)).map(({ total, panels }) => [
          total,
          panels.map(({ notation, about, sequence }) => [
            notation,
            about?.name?.label,
            sequence,
          ]),
        ]),
        [[1, [[PANEL, "Comprehensive metabolic 2000 panel", 1]]]],
      );
    });

    it("returns none for a code no panel lists", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(await tables.inPanels(`${LOINC}9999-9`), []);
    });
  });

  describe("tables.classedElsewhere(codes)", () => {
    it("returns only the codes with a class withheld, each with the ingredient whose other form is classed", async () => {
      const { tables } = await plantedTables();
      assert.deepEqual(
        await tables.classedElsewhere([
          `${RXNORM}314076`,
          `${RXNORM}197658`,
          `${RXNORM}197885`,
        ]),
        new Map([[`${RXNORM}314076`, [`${RXNORM}${LISINOPRIL}`]]]),
      );
    });
  });
});

/**
 * Three questions join a pod's records to the app's reference tables, which a pod does not hold itself: the drug
 * classes of its medications, its lab results in a panel the person picks, and the table versions that joined its
 * records. Each answer names the version of the table it read.
 */
describe("Asking a pod what the reference tables say of its records · pod.medicationClasses(), pod.panelResults(), pod.joinedBy()", () => {
  /** Which class a medication is in is the vocabulary's `tests/fixtures/medication-classes-through-precise-ingredients`. */
  describe("pod.medicationClasses()", () => {
    const names: Record<string, string> = {
      "314076": "Lisinopril 10 MG Oral Tablet",
      "197885": "Hydrochlorothiazide 12.5 MG / Lisinopril 10 MG Oral Tablet",
      "197658": "Estradiol 1 MG Oral Tablet",
      [FLUOROESTRADIOL]: "Fluoroestradiol F-18",
      "2588848": "Levoketoconazole 150 MG Oral Tablet",
    };
    let pod: Pod;
    let rows: Awaited<ReturnType<Pod["medicationClasses"]>>;
    let classes: string;

    before(async () => {
      const planted = await plantedTables();
      classes = planted.classes;
      pod = await openPodWith(
        { ...parts, tables: planted.tables },
        join(scratch, "pods", "classes"),
      );
      const medication = (code: string, index: number): string =>
        draft(
          index,
          "<https://ns.cascadeprotocol.org/cascade#PrescribedOrReportedMedication>",
          `<https://ns.cascadeprotocol.org/cascade#drugName> "${names[code]}" ;
  <https://ns.cascadeprotocol.org/cascade#rxNormCode> <${RXNORM}${code}> ;
  <https://ns.cascadeprotocol.org/cascade#prescribedOrReported> "prescribed" ;
  <https://ns.cascadeprotocol.org/cascade#workflowStatus> "active"`,
          pod,
        );
      const entered = await pod.enter(
        entering(pod, Object.keys(names).map(medication)),
      );
      assert.equal(entered.refused, undefined);
      rows = await pod.medicationClasses();
    });

    after(async () => {
      await pod.close();
    });

    /** What the rows say of a medication: its relation, class, what it is through and whether the code states it. */
    const said = (medication: string): (string | undefined)[][] =>
      rows
        .filter((row) => row.medication === medication)
        .map(({ relation = "", class: of = "", through, stated }) => [
          relation.slice(CASCADE.length),
          of.slice(MEDRT.length),
          through?.slice(RXNORM.length),
          stated,
        ])
        .sort();

    it("returns a medication's classes through its ingredient, where its product has no precise ingredient", () => {
      assert.deepEqual(said("Estradiol 1 MG Oral Tablet"), [
        ["establishedPharmacologicClass", "N0000175825", ESTRADIOL, "false"],
        ["mechanismOfActionClass", "N0000000100", ESTRADIOL, "false"],
      ]);
    });

    it("returns a precise ingredient's own classes as stated", () => {
      assert.deepEqual(said("Fluoroestradiol F-18"), [
        [
          "establishedPharmacologicClass",
          "N0000177914",
          FLUOROESTRADIOL,
          "true",
        ],
        ["mechanismOfActionClass", "N0000175869", FLUOROESTRADIOL, "true"],
      ]);
    });

    it("returns a product's class through its precise ingredient, and through its ingredient for a kind of class the precise ingredient lacks", () => {
      assert.deepEqual(said("Levoketoconazole 150 MG Oral Tablet"), [
        ["chemicalStructureClass", AZOLES, KETOCONAZOLE, "false"],
        [
          "establishedPharmacologicClass",
          "N0000193183",
          LEVOKETOCONAZOLE,
          "false",
        ],
      ]);
    });

    it("returns no class for a product classed only in a different form, nor for a combination", () => {
      for (const code of ["314076", "197885"])
        assert.deepEqual(said(names[code]!), [], names[code]);
    });

    it("returns with each class the version of the drug classes table that holds it", () => {
      assert.ok(rows.length > 0);
      for (const row of rows) assert.equal(row.origin, classes, row.medication);
    });

    it("returns the classes that `tables.facts()` gives each medication's code", async () => {
      const { tables } = await plantedTables();
      for (const [code, name] of Object.entries(names)) {
        const fromFacts = (
          await tables.facts(`${RXNORM}${code}`)
        ).classes.flatMap(({ in: each }) =>
          each.map(
            ({ relation, class: of }) => `${relation} ${MEDRT}${of.notation}`,
          ),
        );
        const asked = rows
          .filter((row) => row.medication === name)
          .map((row) => `${row.relation} ${row.class ?? ""}`);
        assert.deepEqual(fromFacts.sort(), asked.sort(), name);
      }
    });
  });

  /** Which tests count as missing is the vocabulary's `tests/fixtures/panel-results`. */
  describe("pod.panelResults(panel)", () => {
    const OTHER_PANEL = "99999-1";
    const NESTED = "99999-2";
    let pod: Pod;
    let panels: { served: Served; versions: string[] };
    let rows: Row[];
    let otherRows: Row[];
    let notPanel: Row[];

    /** What a row says of a test: the test, whether it is required, its place, the panel it is reached by and whether the pod has a result. */
    const said = (some: Row[]): string[] =>
      some
        .map(
          (row) =>
            `${row.member?.slice(LOINC.length)} ${row.required} ${row.sequence} via ${row.via?.slice(LOINC.length)} ${row.entry === undefined ? "missing" : "result"}`,
        )
        .sort();

    before(async () => {
      const place: Record<string, [string, string, number, string]> = {
        a: [PANEL, "2951-2", 1, "R"],
        b: [PANEL, "2823-3", 2, "R"],
        c: [PANEL, "2075-0", 3, "R"],
        d: [PANEL, "2028-9", 4, "O"],
        e: [PANEL, NESTED, 5, "O"],
        f: [NESTED, "2823-3", 1, "R"],
        g: [OTHER_PANEL, "2823-3", 1, "R"],
      };
      panels = await withMappings(
        feed,
        {
          ...PANELS,
          extra: (panel, member) => {
            const [, , sequence, required] = Object.values(place).find(
              ([of, each]) => of === panel && each === member,
            )!;
            return [
              [
                `${CASCADE}panelSequence`,
                literal(String(sequence), XSD_INTEGER),
              ],
              [`${CASCADE}observationRequiredInPanel`, literal(required)],
            ];
          },
        },
        [Object.values(place).map(([panel, member]) => [panel, member])],
      );
      const tables = tablesOver(panels.served);
      await tables.check();
      pod = await openPodWith(
        { ...parts, tables },
        join(scratch, "pods", "panel-results"),
      );
      const result = (day: string, index: number): string =>
        draft(
          index,
          "cascade:LaboratoryTestResult",
          `cascade:testCode <${LOINC}2823-3> ; cascade:testName "Potassium" ;
  cascade:resultValueKind cascade:TextResultValue ; cascade:resultValue "4.${index}" ;
  cascade:resultClinicallyRelevantTime "${day}T12:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
          pod,
        );
      const entered = await pod.enter(
        entering(pod, ["2025-03-01", "2025-06-01"].map(result)),
      );
      assert.equal(entered.refused, undefined);
      rows = await pod.panelResults(`${LOINC}${PANEL}`);
      otherRows = await pod.panelResults(`${LOINC}${OTHER_PANEL}`);
      notPanel = await pod.panelResults(`${LOINC}2823-3`);
    });

    after(async () => {
      await pod.close();
    });

    it("returns each test the panel requires, with the pod's result or with no `entry` where the pod has none", () => {
      const lines = said(rows);
      assert.ok(lines.includes(`2951-2 R 1 via ${PANEL} missing`));
      assert.ok(lines.includes(`2075-0 R 3 via ${PANEL} missing`));
      assert.ok(lines.includes(`2823-3 R 2 via ${PANEL} result`));
    });

    it("returns a test of a nested panel with the nested panel as `via`, beside its own place in the panel asked", () => {
      const lines = said(rows);
      assert.ok(lines.includes(`2823-3 R 1 via ${NESTED} result`));
      assert.ok(lines.includes(`2823-3 R 2 via ${PANEL} result`));
    });

    it("returns a row for each result a test has", () => {
      const lines = said(rows);
      for (const place of [
        `2823-3 R 1 via ${NESTED} result`,
        `2823-3 R 2 via ${PANEL} result`,
      ])
        assert.equal(lines.filter((line) => line === place).length, 2, place);
    });

    it("returns only the rows of the panel asked, with the version that lists its tests", () => {
      assert.ok(rows.every((row) => row.panel === `${LOINC}${PANEL}`));
      assert.ok(rows.every((row) => row.origin === panels.versions[0]));
      assert.deepEqual(said(otherRows), [
        `2823-3 R 1 via ${OTHER_PANEL} result`,
        `2823-3 R 1 via ${OTHER_PANEL} result`,
      ]);
    });

    it("returns no row for a code that is no panel", () => {
      assert.deepEqual(notPanel, []);
    });
  });

  /** What a view entry cites is the vocabulary's `tests/fixtures/joined-by`. */
  describe("pod.joinedBy()", () => {
    it("returns, for a view entry that a table joined, the version its matcher judgment used", async () => {
      const { cited, ingredients } = await hanaPod();
      assert.deepEqual(
        cited.ibuprofen,
        [ingredients.held],
        "a brand join cites the version its matcher judgment used, which the adopted one still joins",
      );
      assert.deepEqual(cited.cvx150, [groups.first]);
      assert.deepEqual(cited.cvx140, [groups.second]);
    });
  });
});

/**
 * A pod's records are compared with tables of hundreds of thousands of rows, so a pod reads from each version only the
 * rows its own codes find. `tables.references()` returns the tables as a pod reads them: asked for a version's rows by a
 * set of codes, it returns those rows and reads no more than it must.
 */
describe("Reading only the rows a pod's codes find · tables.references()", () => {
  const cvx141 = `${CVX}141`;
  const subjects = (rows: readonly Triple[]): string[] =>
    [...new Set(rows.map(([subject]) => subject.value))].sort();
  const lines = (rows: readonly Triple[]): string[] =>
    rows.map((row) => row.map((term) => term.value).join(" ")).sort();
  /** The current version of the test feed's names series. */
  const namesVersion = (): string => {
    const found = feed.catalog.find(
      ([subject, predicate]) =>
        predicate.value === CURRENT &&
        feed.catalog.some(
          ([s, , o]) =>
            s.value === subject.value && o.value.endsWith("#CodeNames"),
        ),
    )?.[2].value;
    assert.ok(found);
    return found;
  };
  const find = async (codes: ReadonlySet<string>) => ({
    codes,
    terms: await tableTerms(parts.vocabulary, parts.newStore),
  });

  describe("given a version whose rows are found by a property, as a vaccine group's are by its vaccine", () => {
    it("returns the rows that map the code asked, and no other row", async () => {
      const references = await (await checkedFeed()).references();
      const found = await references.rows(
        groups.second,
        await find(new Set([cvx141])),
      );
      assert.deepEqual(
        found
          .filter(([, predicate]) =>
            predicate.value.endsWith("#annotatedSource"),
          )
          .map(([, , object]) => object.value),
        [cvx141],
      );
      assert.ok(
        subjects(await references.rows(groups.second)).length >
          subjects(found).length,
      );
    });
  });

  describe("given a version whose rows are found by their own code, as a name's are", () => {
    let store: MemoryFiles;
    let afterFirst: { subjects: string[]; read: string[] };
    let indexes: string[];
    let everything: string[];
    let everyCode: string[];
    let noRows: readonly Triple[];
    let readAgain: string[];

    before(async () => {
      const names = namesVersion();
      const stem = fileStem(names);
      const reads: string[] = [];
      store = await checkedStore(feed);
      const counted: Files = {
        iri: store.iri,
        read: (path) => {
          reads.push(path);
          return store.read(path);
        },
        write: (path, bytes) => store.write(path, bytes),
        list: (folder) => store.list(folder),
      };
      const references = await tablesOver(feed, counted).references();
      const asked = await find(new Set([cvx141]));
      const halved = reads.length;
      afterFirst = {
        subjects: subjects(await references.rows(names, asked)),
        read: reads.slice(halved).filter((path) => path.startsWith(stem)),
      };
      indexes = (await store.list("")).filter(
        (path) => path.startsWith(`${stem}.`) && path.endsWith(".codes.json"),
      );
      const all = await references.rows(names);
      everything = lines(all);
      everyCode = lines(
        await references.rows(names, {
          ...asked,
          codes: new Set([...subjects(all), "urn:test:no-rows"]),
        }),
      );
      noRows = await references.rows(names, {
        ...asked,
        codes: new Set(["urn:test:x"]),
      });
      const readsBefore = reads.length;
      await references.rows(names, asked);
      await references.rows(names, asked);
      readAgain = reads
        .slice(readsBefore)
        .filter((path) => path.startsWith(stem));
    });

    it("returns the code's rows, reading the version's rows once and no index", () => {
      assert.deepEqual(afterFirst.subjects, [cvx141]);
      assert.deepEqual(afterFirst.read, [`${fileStem(namesVersion())}.ttl`]);
    });

    it("keeps no index beside the version", () => {
      assert.deepEqual(indexes, []);
    });

    it("returns every row when every code is asked, and none for a code with no row", () => {
      assert.deepEqual(everyCode, everything, "every code");
      assert.deepEqual(noRows, [], "a code with no row");
    });

    it("reads no file at a second call", () => {
      assert.deepEqual(readAgain, []);
    });

    it("ignores an index left beside the version", async () => {
      const names = namesVersion();
      const inner = await checkedStore(feed);
      await inner.write(
        `${fileStem(names)}.codes.json`,
        new TextEncoder().encode(
          JSON.stringify({ foundBy: [`${CASCADE}RowSubject`], rows: {} }),
        ),
      );
      assert.deepEqual(
        subjects(
          await (
            await tablesOver(feed, inner).references()
          ).rows(names, await find(new Set([cvx141]))),
        ),
        [cvx141],
      );
    });

    it("returns the code's rows from a version written as Turtle and not as sorted lines", async () => {
      const names = namesVersion();
      const asked = await find(new Set([cvx141]));
      const sorted = lines(
        await (await tablesOver(feed, store).references()).rows(names, asked),
      );
      const grouped = new Map<string, string[]>();
      for (const line of new TextDecoder()
        .decode(await store.read(`${fileStem(names)}.ttl`))
        .split("\n")
        .filter((each) => each !== "")) {
        const [subject = "", rest = ""] = line.split(/ (.*) \.$/s);
        grouped.set(subject, [...(grouped.get(subject) ?? []), rest]);
      }
      const turtle = new MemoryFiles(store.iri);
      for (const path of await store.list(""))
        if (!path.endsWith(".codes.json"))
          await turtle.write(
            path,
            (await store.read(path)) ?? new Uint8Array(),
          );
      await turtle.write(
        `${fileStem(names)}.ttl`,
        new TextEncoder().encode(
          `@prefix x: <urn:test:x#> .\n${[...grouped]
            .map(([subject, rest]) => `${subject} ${rest.join(" ;\n  ")} .`)
            .join("\n")}\n`,
        ),
      );
      assert.deepEqual(
        lines(
          await (
            await tablesOver(feed, turtle).references()
          ).rows(names, asked),
        ).filter((line) => line.startsWith(`${cvx141} `)),
        sorted,
      );
    });
  });

  describe("given an index that cannot be used", () => {
    it("returns every row the code finds", async () => {
      const all = await (
        await (await checkedFeed()).references()
      ).rows(groups.second);
      const [, , target] =
        all.find(([, predicate]) =>
          predicate.value.endsWith("#annotatedTarget"),
        ) ?? [];
      assert.ok(target !== undefined);
      const source = "cascade:foundBy owl:annotatedSource .";
      const cases: [string, Files, (files: Files) => Promise<void>, string][] =
        [
          [
            "an index that is unreadable",
            parts.vocabulary,
            (files) =>
              files.write(
                `${fileStem(groups.second)}.codes.json`,
                new TextEncoder().encode("{"),
              ),
            cvx141,
          ],
          [
            "an index built when the vocabulary gave the kind nothing to be found by",
            recordsChanged((turtle) =>
              turtle.replace(source, "rdfs:seeAlso owl:annotatedSource ."),
            ),
            async () => {},
            cvx141,
          ],
          [
            "an index built when the vocabulary gave the kind fewer properties to be found by",
            parts.vocabulary,
            async () => {},
            target.value,
          ],
        ];
      const reading = recordsChanged((turtle) =>
        turtle.replace(
          source,
          "cascade:foundBy owl:annotatedSource , owl:annotatedTarget .",
        ),
      );
      for (const [input, vocabulary, change, code] of cases) {
        const files = await checkedStore(feed, vocabulary);
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
        assert.ok(wanted.length > 0, input);
        for (const [subject] of wanted)
          assert.ok(found.has(subject.value), input);
      }
    });
  });
});

describe("Starter copies of the reference tables, as the package is built with them", () => {
  describe("writeStarterCopies(options, write)", () => {
    it("writes each version's rows as the feed published them, gzipped, and no copy as a store keeps them", async () => {
      const { carried, stem } = await starterCopies();
      assert.ok(carried.includes(`${stem}${PUBLISHED_ROWS}`));
      assert.ok(!carried.includes(`${stem}.ttl`));
    });

    it("writes each version's search list beside its rows", async () => {
      const { carried, stem } = await starterCopies();
      assert.ok(carried.includes(`${stem}${LISTED}`));
    });

    it("writes no version of a table kind the app reads nothing of", async () => {
      const written = new MemoryFiles("urn:test:starter/");
      await writeStarterCopies(
        {
          feeds: [FEED],
          vocabulary: parts.vocabulary,
          newStore: parts.newStore,
          fetch: fetchOf(retyped(`${CASCADE}SubstanceIngredients`)),
        },
        (path, bytes) => written.write(path, bytes),
      );
      assert.ok(
        !(await written.list("")).some((path) =>
          path.startsWith(fileStem(groups.first)),
        ),
      );
    });

    it("gives a store the same rows as a check of the feed keeps", async () => {
      const { files } = await starterCopies();
      const started = startedOn(files);
      await started.start();
      const checked = tablesOver(first);
      await checked.check();
      const rows = async (from: Tables) =>
        (await (await from.references()).rows(groups.first))
          .map((triple) => triple.map(({ value }) => value).join(" "))
          .sort();
      assert.deepEqual(await rows(started), await rows(checked));
    });
  });
});
