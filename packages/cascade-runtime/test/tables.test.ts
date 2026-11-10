import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  tableTerms,
  tablesSettings,
  type Term,
  type Triple,
  withTables,
  RULE_LIST,
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
import { tablesBeside } from "../src/index.js";
import { Answers } from "../src/answers.js";
import { keptPod, openPodWith, type Row } from "../src/pod.js";
import { IN_THIS_THREAD, listing, merged } from "../src/rows.js";
import {
  type Checked,
  HELD,
  currentOf,
  LISTED,
  PAGE_SIZE,
  PUBLISHED_ROWS,
  Tables,
  versionName,
  writeStarterCopies,
} from "../src/tables.js";
import { READ_AHEAD, StarterFiles, versionsIn } from "../src/tables/starter.js";

const FEED = "https://tables.example/feed.ttl";
const QUESTION = "pod/My active allergies";
const DCAT = "http://www.w3.org/ns/dcat#";
const SPDX = "http://spdx.org/rdf/terms#";
const PROV = "http://www.w3.org/ns/prov#";
const PAV = "http://purl.org/pav/";
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
const ICD10CM = spaceOf("ICD-10-CM");
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
  /** The row's SSSOM cardinality, when its kind gives one. */
  readonly cardinality?: (source: string, target: string) => string;
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

const CONVERSIONS: Mapping = {
  series: "urn:uuid:6b1e0c3a-9f4d-4e27-8a5b-2d7c9e1f4a60",
  label: "Code conversions",
  kind: "CodeConversions",
  system: ICD10CM,
  predicate: "http://purl.org/dc/terms/isReplacedBy",
  justification: () => "ManualMappingCuration",
  cardinality: () => "1:1",
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
      ...(mapping.cardinality === undefined
        ? []
        : [
            [
              subject,
              iri("https://w3id.org/sssom/mapping_cardinality"),
              literal(mapping.cardinality(source, target)),
            ] as Triple,
          ]),
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

type Mapped = Awaited<ReturnType<typeof withMappings>>;

describe("a pod opened with the app's tables", () => {
  const advil: [string, string] = ["153010", "5640"];
  const ibuprofen: [string, string] = ["5640", "5640"];
  const relabelled = "Vaccine groups, relabelled";
  let ingredientsFirst: Mapped;
  let ingredientsLater: Mapped;
  let later: Mapped;
  let store: MemoryFiles;
  let folder: string;
  let firstTables: Tables;
  let newerTables: Tables;
  let keptFirst: Checked | undefined;
  let heldFirst: readonly string[];
  let keptNewer: Checked | undefined;
  let newerLabels: string[];

  before(async () => {
    ingredientsFirst = await withMappings(first, INGREDIENTS, [
      [advil, ibuprofen],
    ]);
    ingredientsLater = await withMappings(feed, INGREDIENTS, [
      [advil, ibuprofen],
      // A row the first lacks, so the later is a version of its own.
      [advil, ibuprofen, ["723", "723"]],
    ]);
    later = await withMappings(ingredientsLater.served, CONVERSIONS, [
      [["C88.0", "C88.00"]],
    ]);
    store = new MemoryFiles("urn:test:tables/");
    firstTables = tablesOver(ingredientsFirst.served, store);
    [keptFirst] = await firstTables.check();
    heldFirst = await firstTables.current();

    folder = join(scratch, "pods", "hana");
    const pod = await openPodWith({ ...parts, tables: firstTables }, folder);
    newerTables = tablesOver(
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
    [keptNewer] = await newerTables.check({ cache: "no-cache" });
    newerLabels = (await newerTables.references())
      .description(groups.series)
      .filter(([, predicate]) => predicate.value === `${RDFS}label`)
      .map(([, , label]) => label.value);
    const records = [
      ...[
        ["141", "2025-10-01"],
        ["150", "2025-10-01"],
        ["140", "2024-10-01"],
        ["141", "2024-10-01"],
      ].map(([code, date]) => [
        "cascade:Vaccination",
        `cascade:vaccineCode <${CVX}${code}> ; cascade:vaccinationOccurrenceTime "${date}"^^<http://www.w3.org/2001/XMLSchema#date>`,
      ]),
      ...["153010", "5640"].map((code) => [
        "cascade:AllergyOrIntolerance",
        `cascade:allergenCode <${RXNORM}${code}>`,
      ]),
      ...["C88.0", "C88.00"].map((code) => [
        "cascade:ProblemOrDiagnosis",
        `cascade:icd10Code <${ICD10CM}${code}>`,
      ]),
      ...[
        [
          "2019-01-05",
          `<https://ns.cascadeprotocol.org/cascade#abatementDate> "2019-02-01"^^<http://www.w3.org/2001/XMLSchema#date> ; cascade:clinicalStatus "resolved"`,
        ],
        ["2019-01-07", `cascade:clinicalStatus "resolved"`],
        ["2024-03-01", `cascade:clinicalStatus "active"`],
      ].map(([onset, rest]) => [
        "cascade:ProblemOrDiagnosis",
        `cascade:icd10Code <${ICD10CM}J18.9> ; cascade:onsetDate "${onset}"^^<http://www.w3.org/2001/XMLSchema#date> ; ${rest}`,
      ]),
    ].map(
      ([type, fields], index) => `<urn:cascade:output-${index}> a ${type} .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  ${fields} ; cascade:patient <${pod.subject}> .`,
    );
    const entered = await pod.enter(`${PREFIXES}
<urn:uuid:${crypto.randomUUID()}> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] .
${records.join("\n")}`);
    assert.equal(entered.refused, undefined);
    assert.equal(entered.matched?.refused, undefined);
    await pod.close();
  });

  describe("given a first check", () => {
    it("keeps each series' first version", () => {
      assert.equal(keptFirst?.kept.length, 4);
      assert.ok(heldFirst.includes(groups.first));
    });
  });

  describe("given a later check", () => {
    it("keeps the newer version and refuses none", () => {
      assert.deepEqual(keptNewer?.refused, []);
      assert.ok(keptNewer?.kept.includes(groups.second));
    });

    it("takes a series' label from the newer feed", () => {
      assert.deepEqual(newerLabels, [relabelled]);
    });
  });

  describe("when opened after a check kept the planted newer version", () => {
    let pod: Awaited<ReturnType<typeof openPodWith>>;

    before(async () => {
      pod = await openPodWith({ ...parts, tables: newerTables }, folder);
    });

    after(async () => {
      await pod.close();
    });

    it("adopts it, recording the version", async () => {
      assert.equal(pod.opened?.refused, undefined);
      assert.deepEqual(pod.opened?.unheld, []);
      assert.deepEqual(
        await pod.ask({
          query: `${PREFIXES}SELECT ?version WHERE { <${groups.series}> pav:hasCurrentVersion ?version }`,
        }),
        [{ version: groups.second }],
      );
    });

    it("files the Same it newly joins, and none again for one the replaced version joined", async () => {
      const sames = await pod.ask({
        query: `${PREFIXES}SELECT ?used (GROUP_CONCAT(STR(?code); separator=" ") AS ?codes) WHERE {
        ?judgment cascade:justification cascade:SameMappedCodeAndDate ; prov:wasDerivedFrom ?used ; prov:hadMember ?record .
        VALUES ?used { <${groups.first}> <${groups.second}> }
        ?record pav:hasCurrentVersion/cascade:vaccineCode ?code
      } GROUP BY ?judgment ?used`,
      });
      const codes = ({ used = "", codes = "" }) =>
        `${used === groups.first ? "first" : "second"}: ${codes.replaceAll(CVX, "").split(" ").sort().join(" ")}`;
      assert.deepEqual(sames.map(codes).sort(), [
        "first: 141 150",
        "second: 140 141",
      ]);
    });

    it("joins a brand allergy and its ingredient's by R3", async () => {
      const [held] = ingredientsFirst.versions;
      const [, adopted] = ingredientsLater.versions;
      const brands = await pod.ask({
        query: `${PREFIXES}SELECT ?used (GROUP_CONCAT(STR(?code); separator=" ") AS ?codes) WHERE {
        ?judgment cascade:justification cascade:SameMappedCode ; prov:wasDerivedFrom ?used ; prov:hadMember ?record .
        VALUES ?used { <${held}> <${adopted}> }
        ?record pav:hasCurrentVersion/cascade:allergenCode ?code
      } GROUP BY ?judgment ?used`,
      });
      const allergens = ({ used = "", codes = "" }) =>
        `${used === held ? "held" : "adopted"}: ${codes.replaceAll(RXNORM, "").split(" ").sort().join(" ")}`;
      assert.deepEqual(brands.map(allergens).sort(), ["held: 153010 5640"]);
    });

    it("joins, from a series it newly holds, a condition on a retired code and its conversion's by R7", async () => {
      const [converted] = later.versions;
      const { shipped } = await ruleList();
      const conversions = await pod.ask({
        query: `${PREFIXES}SELECT (GROUP_CONCAT(STR(?code); separator=" ") AS ?codes) WHERE {
        ?judgment cascade:justification cascade:SameConvertedCode ; prov:wasDerivedFrom <${converted}> ; prov:hadMember ?record .
        ?assertion cascade:assertedClaim ?judgment ; cascade:assertedUnderRuleListVersion <${shipped}> .
        ?record pav:hasCurrentVersion/cascade:icd10Code ?code
      } GROUP BY ?judgment`,
      });
      assert.deepEqual(
        conversions.map(({ codes = "" }) =>
          codes.replaceAll(ICD10CM, "").split(" ").sort().join(" "),
        ),
        ["C88.0 C88.00"],
      );
    });

    it("joins two conditions of one code whose periods overlap, and not one of a later episode, by R8", async () => {
      const { shipped } = await ruleList();
      const episodes = await pod.ask({
        query: `${PREFIXES}SELECT (GROUP_CONCAT(STR(?onset); separator=" ") AS ?onsets) WHERE {
        ?judgment cascade:justification cascade:SameCodeAndPeriod ; prov:hadMember ?record .
        ?assertion cascade:assertedClaim ?judgment ; cascade:assertedUnderRuleListVersion <${shipped}> .
        ?record pav:hasCurrentVersion/cascade:onsetDate ?onset
      } GROUP BY ?judgment`,
      });
      assert.deepEqual(
        episodes.map(({ onsets = "" }) => onsets.split(" ").sort().join(" ")),
        ["2019-01-05 2019-01-07"],
      );
    });

    describe("the table a join cites", () => {
      const joined = new Map<string, string[]>();
      let shipped: string;

      before(async () => {
        ({ shipped } = await ruleList());
        for (const { entry = "", used = "" } of await pod.joinedBy())
          joined.set(entry, [...(joined.get(entry) ?? []), used]);
      });

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

      it("for a brand join, is the version its claim used, which the adopted one still joins", async () => {
        const [held] = ingredientsFirst.versions;
        assert.deepEqual(
          await citedBy("allergenCode", `<${RXNORM}5640>`),
          [held],
          "a brand join cites the version its claim used, which the adopted one still joins",
        );
      });

      it("for a Same of vaccines, is the vaccine groups version it used", async () => {
        assert.deepEqual(await citedBy("vaccineCode", `<${CVX}150>`), [
          groups.first,
        ]);
        assert.deepEqual(await citedBy("vaccineCode", `<${CVX}140>`), [
          groups.second,
        ]);
      });

      it("for a conversion, is its table and not the rule list", async () => {
        const [converted] = later.versions;
        assert.deepEqual(
          await citedBy("icd10Code", `<${ICD10CM}C88.00>`),
          [converted],
          "a conversion cites its table and not the rule list",
        );
      });

      it("for a join by code and period, is none", async () => {
        assert.deepEqual(
          await citedBy(
            "onsetDate",
            '"2019-01-05"^^<http://www.w3.org/2001/XMLSchema#date>',
          ),
          [],
          "a join by code and period cites no table",
        );
      });

      it("for no join, is the rule list", () => {
        assert.ok(
          ![...joined.values()].flat().includes(shipped),
          "the rule list is cited as a table",
        );
      });
    });
  });

  describe("when opened again with the same tables", () => {
    it("records nothing and holds every version", async () => {
      const again = await openPodWith(
        { ...parts, tables: newerTables },
        folder,
      );
      try {
        assert.equal(again.opened, undefined);
        assert.deepEqual(await again.unheldTableVersions(), []);
      } finally {
        await again.close();
      }
    });
  });

  describe("when opened with tables that lack versions the pod names", () => {
    let older: Tables;

    before(async () => {
      const elsewhere = new MemoryFiles("urn:test:tables-elsewhere/");
      older = tablesOver(ingredientsFirst.served, elsewhere);
      await older.check();
      await (await openPodWith({ ...parts, tables: older }, folder)).close();
    });

    it("records nothing and says which versions it does not hold", async () => {
      const reopened = await openPodWith({ ...parts, tables: older }, folder);
      try {
        assert.equal(reopened.opened, undefined);
        assert.deepEqual(
          await reopened.unheldTableVersions(),
          [groups.second, ingredientsLater.versions[1]].sort(),
        );
      } finally {
        await reopened.close();
      }
    });
  });

  describe("when opened after the rule list is revised", () => {
    let empty: string;

    before(async () => {
      empty = join(scratch, "pods", "empty");
      await (
        await openPodWith({ ...parts, tables: newerTables }, empty)
      ).close();
    });

    it("is opened with that", async () => {
      const revised = await openPodWith(
        {
          ...parts,
          tables: tablesOver(feed, store, await ruleListRevised()),
        },
        empty,
      );
      try {
        assert.ok(revised.opened);
        assert.equal(revised.opened.refused, undefined);
      } finally {
        await revised.close();
      }
    });
  });

  describe("when the pod is in memory", () => {
    it("is recorded as opened with nothing", async () => {
      const inMemory = await openPodWith(
        { ...parts, tables: newerTables },
        undefined,
      );
      try {
        assert.equal(await newerTables.openedWith(inMemory.address), undefined);
      } finally {
        await inMemory.close();
      }
    });
  });

  describe("when opened while a check has kept one version and not yet the next", () => {
    const racing = new MemoryFiles("urn:test:tables-racing/");
    const answers = new MemoryFiles("urn:test:answers-midway/");
    const answering = {
      ...parts,
      answers: { runtime: "test", at: () => answers },
    };
    let midway: string;
    let reached!: () => void;
    const gated = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let checking: Tables;
    let check: Promise<unknown> = Promise.resolve();
    let lagging: readonly string[];
    let openedWith: readonly string[];
    let heldMidway: readonly string[];

    const withCurrent = (current: readonly string[]): Tables =>
      new Proxy(checking, {
        get: (target, property) =>
          property === "current"
            ? () => Promise.resolve(current)
            : (Reflect.get(target, property, target) as () => unknown).bind(
                target,
              ),
      });

    before(async () => {
      midway = join(scratch, "pods", "midway");
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
      let downloads = 0;
      const served = fetchOf(ingredientsLater.served);
      checking = new Tables({
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
      lagging = await checking.current();
      check = checking.check();
      await Promise.race([
        gated,
        check.then(() =>
          assert.fail(
            "the check kept fewer than two versions, so it never reached the gate",
          ),
        ),
      ]);
      openedWith = currentOf(await checking.references());
      heldMidway = await checking.current();
    });

    after(async () => {
      release();
      await check;
    });

    it("names the current versions it holds after each version a check keeps", () => {
      assert.notDeepEqual(lagging, openedWith);
      assert.deepEqual(
        heldMidway,
        openedWith,
        "what is held names the current versions after each version a check keeps",
      );
    });

    it("keeps a pod's answers under the versions it computes with", async () => {
      // As a pod is opened that reads the references after a check writes the index and what is held before it does.
      const opened = await openPodWith(
        { ...answering, tables: withCurrent(lagging) },
        midway,
        { adopt: false },
      );
      const asked = await opened.ask(QUESTION);
      await opened.close();
      release();
      await check;
      const read = await keptPod(
        { ...parts, tables: withCurrent(openedWith) },
        new FolderFiles(midway),
        new Answers(answers, "test"),
      );
      assert.deepEqual(
        await read?.rows(QUESTION),
        asked,
        "a pod opened midway through a check keeps its answers under the versions it was opened with",
      );
    });

    it("misses its kept answers under versions it did not open with", async () => {
      const stale = await keptPod(
        { ...parts, tables: withCurrent(lagging) },
        new FolderFiles(midway),
        new Answers(answers, "test"),
      );
      assert.equal(
        await stale?.rows(QUESTION),
        undefined,
        "the kept answers are a miss under the versions the pod did not open with",
      );
    });
  });
});

describe("the series the app holds", () => {
  const watched = { at: "2026-10-08T19:00:00Z", found: "nothing new" };
  const of = (subject: string, predicate: string): string | undefined =>
    feed.catalog.find(
      ([s, p]) => s.value === subject && p.value === predicate,
    )?.[2].value;
  let tables: Tables;
  let beside: Tables;
  let held: Awaited<ReturnType<Tables["held"]>>;

  before(async () => {
    const source = of(groups.series, "http://purl.org/dc/terms/source") ?? "";
    const store = new MemoryFiles("urn:test:tables/");
    await tablesOver(first, store).check();
    const folder = join(scratch, "pods", "uses");
    await (
      await openPodWith({ ...parts, tables: tablesOver(first, store) }, folder)
    ).close();
    tables = tablesOver(
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
    beside = tablesOver(first, store);
    await beside.held();
    await tables.check();
    held = await tables.held();
  });

  it("tells another app on the same store what a check kept", async () => {
    assert.equal(
      (await beside.held()).find((series) => series.iri === groups.series)
        ?.current.iri,
      groups.second,
      "another app on the store is told what a check kept",
    );
  });

  it("leaves out the rule list's series, which is no table", () => {
    assert.deepEqual(
      held.filter((series) => series.kind === undefined),
      [],
      "the rule list's series is no table the app holds",
    );
  });

  it("gives the current versions the references name", async () => {
    assert.deepEqual(
      await tables.current(),
      currentOf(await tables.references()),
    );
  });

  it("lists each series by its label", () => {
    const label = (series: string): string =>
      of(series, `${RDFS}label`) ?? series;
    assert.deepEqual(
      held.map((series) => series.label),
      held.map((series) => label(series.iri)).sort(),
    );
  });

  describe("a series", () => {
    let vaccineGroups: (typeof held)[number];

    before(() => {
      const found = held.find((series) => series.iri === groups.series);
      assert.ok(found);
      vaccineGroups = found;
    });

    it("lists its versions, the newest first", () => {
      assert.deepEqual(
        vaccineGroups.versions.map((version) => version.iri),
        [groups.second, groups.first],
      );
    });

    it("gives its credit", () => {
      assert.equal(
        vaccineGroups.credit,
        of(groups.series, "http://purl.org/dc/terms/bibliographicCitation"),
      );
    });

    it("says how fresh its feed is", () => {
      assert.deepEqual(vaccineGroups.watched, watched);
    });

    it("names the feed it came from", () => {
      assert.equal(vaccineGroups.feed, FEED);
    });

    it("names the pods that use each of its versions", async () => {
      assert.deepEqual((await tables.uses())[groups.first], ["uses"]);
    });
  });

  describe("a search", () => {
    let names: (typeof held)[number];
    let nameRows: string;

    before(async () => {
      const found = held.find((series) => series.kind?.endsWith("#CodeNames"));
      assert.ok(found);
      names = found;
      nameRows = await gunzipped(
        feed.files.get(rowsUrl(feed, names.current.iri)) ?? new Uint8Array(),
      );
    });

    const nameOf = (code: string): string | undefined =>
      new RegExp(`/cvx/${code}> <[^>]*#prefLabel> "([^"]*)"`).exec(
        nameRows,
      )?.[1];

    it("finds a code by its code, named and mapped", async () => {
      const [shot, ...others] = (await tables.search(groups.series, "141"))
        .found;
      assert.equal(others.length, 0);
      assert.equal(shot?.notation, "141");
      assert.equal(shot.about?.name?.label, nameOf("141"));
      assert.ok(shot.mapsTo.length > 0);
      for (const group of shot.mapsTo)
        assert.equal(group.about?.name?.label, nameOf(group.notation));
    });

    it("finds codes by name", async () => {
      const named = await tables.search(names.iri, "SPLIT VIRUS");
      assert.ok(named.found.some(({ notation }) => notation === "141"));
      for (const { about } of named.found)
        assert.ok(
          [about?.name?.label ?? "", ...(about?.name?.altLabels ?? [])].some(
            (text) => text.toLowerCase().includes("split virus"),
          ),
        );
    });
  });
});

describe("the codes of the held series", () => {
  let tables: Tables;
  let held: Awaited<ReturnType<Tables["held"]>>;
  let listed: string[][];
  let code: string;

  before(async () => {
    tables = tablesOver(feed);
    await tables.check();
    held = await tables.held();
    listed = await Promise.all(
      held.map(async (series) =>
        (await tables.search(series.iri, "")).found.map(({ code }) => code),
      ),
    );
    const [each] = listed.reduce((both, codes) =>
      both.filter((one) => codes.includes(one)),
    );
    assert.ok(each, "no code is in every series of the test feed");
    code = each;
  });

  describe("a code's facts", () => {
    let facts: Awaited<ReturnType<Tables["facts"]>>;
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
    const fact = (kind: string) => {
      const series = held.find((each) => each.kind?.endsWith(`#${kind}`));
      assert.ok(series, kind);
      return { series: series.iri, version: series.current.iri };
    };

    before(async () => {
      facts = await tables.facts(code);
    });

    it("hold what the names say of it, with the series and current version", () => {
      assert.deepEqual(facts.names.map(from), [fact("CodeNames")]);
    });

    it("hold what the retired codes say of it", () => {
      assert.deepEqual(facts.status.map(from), [fact("RetiredCodes")]);
    });

    it("hold what the vaccine groups map it to", () => {
      assert.deepEqual(facts.mappings.map(from), [fact("VaccineGroups")]);
    });
  });

  describe("a search over several series", () => {
    it("lists their codes once each", async () => {
      const all = await tables.search(
        held.map(({ iri }) => iri),
        "",
      );
      assert.deepEqual(
        new Set(all.found.map(({ code }) => code)),
        new Set(listed.flat()),
      );
      assert.equal(all.total, new Set(listed.flat()).size);
    });
  });
});

describe("merged lists of codes", () => {
  it("keep the earlier list first where notations collate equal, whatever the count of lists", () => {
    // Notations that collate equal across lists (07 and 7) keep the earlier list first, whatever the count of lists.
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
      assert.deepEqual([...merged(lists, spaces)], expected);
  });
});

describe("a search of a series of more codes than a page", () => {
  const count = PAGE_SIZE * 2 + 3;
  const pages: { found: string[]; total: number; offset: number }[] = [];
  const askedOn: string[][] = [];
  const foundOn: string[][] = [];
  let tables: Tables;

  before(async () => {
    const { served } = await withMappings(feed, INGREDIENTS, [
      Array.from({ length: count }, (_, at) => [`${at + 1}`, "0"] as const),
    ]);
    tables = tablesOver(served);
    await tables.check();
    const asked: string[] = [];
    const about = tables.about.bind(tables);
    tables.about = (codes) => {
      asked.push(...codes);
      return about(codes);
    };
    for (const page of [1, 2, 3, 4]) {
      asked.length = 0;
      const searched = await tables.search(INGREDIENTS.series, "", page);
      askedOn.push([...asked]);
      foundOn.push(searched.found.flatMap(({ code }) => [code, `${RXNORM}0`]));
      pages.push({
        found: searched.found.map(({ notation }) => notation),
        total: searched.total,
        offset: searched.offset,
      });
    }
  });

  it("counts every code and starts each page where the last ended", () => {
    for (const [at, page] of pages.entries()) {
      assert.equal(page.total, count);
      assert.equal(page.offset, at * PAGE_SIZE);
    }
  });

  it("asks the names and status of only the codes on the page and those they map to", () => {
    for (const [at, asked] of askedOn.entries())
      assert.deepEqual(new Set(asked), new Set(foundOn[at]));
  });

  it("fills each page, the last one short and the one after it empty", () => {
    assert.deepEqual(
      pages.map((page) => page.found.length),
      [PAGE_SIZE, PAGE_SIZE, 3, 0],
    );
  });

  it("lists the codes in the order of their codes", () => {
    assert.deepEqual(
      pages.flatMap((page) => page.found),
      Array.from({ length: count }, (_, at) => `${at + 1}`),
    );
  });

  it("finds a code they map to by its notation", async () => {
    assert.equal(await tables.codeNamed(INGREDIENTS.series, "0"), `${RXNORM}0`);
  });
});

describe("the listing kept beside a version", () => {
  const cvx141 = "https://ns.cascadeprotocol.org/codes/cvx/141";
  let path: string;
  let valid: Record<string, unknown>;

  before(async () => {
    path = `${fileStem(groups.second)}${LISTED}`;
    const checked = new MemoryFiles("urn:test:tables/");
    await tablesOver(feed, checked).check();
    valid = JSON.parse(
      new TextDecoder().decode(await checked.read(path)),
    ) as Record<string, unknown>;
  });

  /** Whether a start finds the listing wrong too, and what is kept in its place. */
  const cases: [string, boolean, (valid: Record<string, unknown>) => string][] =
    [
      ["it is not JSON", true, () => "{"],
      [
        "it was listed in another format",
        true,
        (valid) => JSON.stringify({ ...valid, codes: [], format: 0 }),
      ],
      [
        "it was listed by other code systems",
        true,
        (valid) =>
          JSON.stringify({
            ...valid,
            codes: [],
            uriSpaces: ["urn:test:other:"],
          }),
      ],
      [
        "its mapsTo is null",
        false,
        (valid) => JSON.stringify({ ...valid, mapsTo: null }),
      ],
      [
        "its names are null",
        false,
        (valid) => JSON.stringify({ ...valid, codes: [], names: null }),
      ],
      [
        "a name in it is not text",
        false,
        (valid) => JSON.stringify({ ...valid, names: { [cvx141]: 141 } }),
      ],
    ];

  for (const [why, startToo, kept] of cases)
    it(`is listed again by ${startToo ? "a start and " : ""}a search when ${why}`, async () => {
      const listedAs = kept(valid);
      const files = new MemoryFiles("urn:test:tables/");
      await tablesOver(feed, files).check();
      await files.write(path, new TextEncoder().encode(listedAs));
      const again = tablesOver(feed, files);
      await again.start();
      const listedAgain = async (): Promise<unknown> =>
        JSON.parse(new TextDecoder().decode(await files.read(path)));
      if (startToo)
        assert.deepEqual(
          await listedAgain(),
          valid,
          `a start lists it again: ${listedAs}`,
        );
      const { found } = await again.search(groups.series, "141");
      assert.deepEqual(
        found.map(({ notation }) => notation),
        ["141"],
        listedAs,
      );
      assert.deepEqual(
        await listedAgain(),
        valid,
        `a search lists it again: ${listedAs}`,
      );
    });
});

describe("a version's rows", () => {
  describe("the listing", () => {
    it("names every code its rows give a preferred name, in a code system's URI space or not", () => {
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

  describe("as published", () => {
    it("are read the same gzipped and as a server sends them already unzipped", async () => {
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

  describe("when the tables name no file for a version", () => {
    const series = "urn:test:series";
    let tables: Tables;

    before(async () => {
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
      tables = tablesOver(feed, files);
    });

    it("a search refuses it", async () => {
      await assert.rejects(tables.search(series, ""), Refusal);
    });

    it("what the tables say of a code refuses it", async () => {
      await assert.rejects(tables.about(["urn:test:code"]), Refusal);
    });
  });
});

describe("the starter copies", () => {
  const cvx141 = "https://ns.cascadeprotocol.org/codes/cvx/141";
  const starter = new MemoryFiles("urn:test:starter/");
  let carried: string[];
  let rowsCarried: string[];
  let stem: string;
  let order: string[];
  let app: string;
  let asked: string[] = [];
  let reading = 0;
  let mostRead = 0;
  let failing: string | undefined;
  let cut = false;
  let startedAgain = false;
  let convertedAfterCut = 0;

  const counted: Files = {
    iri: starter.iri,
    list: (folder) => starter.list(folder),
    write: (path, bytes) => starter.write(path, bytes),
    read: async (path) => {
      asked.push(path);
      if (!path.endsWith(PUBLISHED_ROWS)) return starter.read(path);
      reading += 1;
      mostRead = Math.max(mostRead, reading);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        if (path === failing) {
          failing = undefined;
          cut = true;
          throw new Error("the starter's network failed");
        }
        return await starter.read(path);
      } finally {
        reading -= 1;
      }
    },
  };
  const work = {
    ...IN_THIS_THREAD,
    listed: () => Promise.reject(new Error("listed what came listed")),
    published: (bytes: Uint8Array<ArrayBuffer>) => {
      if (cut && !startedAgain) convertedAfterCut += 1;
      return IN_THIS_THREAD.published(bytes);
    },
  };
  const tablesOn = (files: Files, from: Files = counted): Tables =>
    new Tables({
      files,
      feeds: [FEED],
      vocabulary: parts.vocabulary,
      newStore: parts.newStore,
      fetch: fetchOf(feed),
      starter: from,
      work,
    });
  const rowsRead = (): string[] =>
    asked.filter((path) => path.endsWith(PUBLISHED_ROWS));
  let tables: Tables;
  let shipped: readonly string[];

  before(async () => {
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
      (path, bytes) => starter.write(path, bytes),
    );
    carried = await starter.list("");
    stem = fileStem(groups.first);
    app = join(scratch, "reset");
    rowsCarried = carried.filter((path) => path.endsWith(PUBLISHED_ROWS));
    order = [...versionsIn(carried)]
      .filter(([, paths]) =>
        paths.some((path) => path.endsWith(PUBLISHED_ROWS)),
      )
      .map(([each]) => each);
  });

  describe("what they carry", () => {
    it("is each version's rows as published, and its listing, not the Turtle", () => {
      assert.ok(carried.includes(`${stem}${PUBLISHED_ROWS}`));
      assert.ok(!carried.includes(`${stem}.ttl`));
      assert.ok(carried.includes(`${stem}${LISTED}`));
    });

    it("holds more versions than are read ahead", () => {
      assert.ok(rowsCarried.length > READ_AHEAD);
    });
  });

  describe("on a first use", () => {
    let named: unknown;
    let read: string[];

    before(async () => {
      tables = tablesOn(new FolderFiles(join(app, ".tables")));
      shipped = await tables.current();
      named = (await tables.about([cvx141])).get(cvx141)?.name;
      read = [...asked];
    });

    it("names the current versions before they are copied", () => {
      assert.ok(shipped.includes(groups.first));
    });

    it("names a code", () => {
      assert.ok(named !== undefined);
    });

    it("reads of the starter what it holds and its index", () => {
      assert.deepEqual(
        [
          ...new Set(read.filter((path) => versionsIn([path]).size === 0)),
        ].sort(),
        [HELD, "references.ttl"].sort(),
        "a first use reads of the starter what it holds and its index",
      );
    });

    it("reads only the versions of the kinds it reads, names, status and ingredients, not the vaccine groups'", () => {
      assert.deepEqual(
        [...versionsIn(read).keys()].sort(),
        [...versionsIn(carried).keys()].filter((each) => each !== stem).sort(),
        "and the versions of the kinds it reads, names, status and ingredients, and not the vaccine groups'",
      );
    });
  });

  describe("when a copy is cut short", () => {
    let cutFailed = false;
    let resumed: number;
    let readOnResume: string[];
    let startedWhole: number;

    before(async () => {
      failing = `${stem}${PUBLISHED_ROWS}`;
      try {
        await tables.start();
      } catch {
        cutFailed = true;
      }
      asked = [];
      resumed = await tables.start();
      readOnResume = rowsRead();
      startedWhole = await tables.start();
    });

    it("fails the start", () => {
      assert.ok(cutFailed);
    });

    it("names the versions before the copies are written", () => {
      assert.ok(
        resumed > 0,
        "the versions are named before the copies are written",
      );
    });

    it("goes on where it stopped", () => {
      assert.deepEqual(
        readOnResume,
        [`${stem}${PUBLISHED_ROWS}`],
        "a copy cut short goes on where it stopped",
      );
    });

    it("leaves nothing to start in a store holding every version", () => {
      assert.equal(startedWhole, 0, "a store holding every version");
    });
  });

  describe("when the whole starter is copied and a version cannot be read", () => {
    let failed = false;
    let converted: number;
    let started: number;
    let mostReadAhead: number;

    before(async () => {
      cut = false;
      convertedAfterCut = 0;
      mostRead = 0;
      failing = rowsCarried.at(-1);
      const whole = tablesOn(new MemoryFiles("urn:test:app-whole/"));
      try {
        await whole.start();
      } catch {
        failed = true;
      }
      converted = convertedAfterCut;
      startedAgain = true;
      started = await whole.start();
      mostReadAhead = mostRead;
    });

    it("fails the start", () => {
      assert.ok(failed);
    });

    it("converts no version after the cut", () => {
      assert.equal(
        converted,
        0,
        "a copy cut short converts no version after the cut",
      );
    });

    it("copies the versions at the next start", () => {
      assert.ok(started > 0);
    });

    it("reads the starter ahead, bounded", () => {
      assert.equal(
        mostReadAhead,
        READ_AHEAD,
        "the starter is read ahead, bounded",
      );
    });
  });

  describe("when copied in the background", () => {
    let readWhileFailed: Uint8Array | undefined;
    let copyResult: unknown;

    before(async () => {
      const background = new MemoryFiles("urn:test:app-background/");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      cut = false;
      failing = `${order[1]}${PUBLISHED_ROWS}`;
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
        counted,
        work,
      );
      const copying = behind.copyAll().then(
        () => undefined,
        (error: unknown) => error,
      );
      while (!cut) await new Promise((resolve) => setImmediate(resolve));
      readWhileFailed = await behind.read(`${order[1]}.ttl`);
      release();
      copyResult = await copying;
    });

    it("answers a read while the copy has failed", () => {
      assert.ok(
        readWhileFailed !== undefined,
        "a read succeeds while the background copy has failed",
      );
    });

    it("fails with the error of the version it could not read", () => {
      assert.ok(copyResult instanceof Error);
    });
  });

  describe("when a copy and a read are at once", () => {
    let read: string[];
    let startedAfter: number;

    before(async () => {
      cut = false;
      asked = [];
      const both = tablesOn(new MemoryFiles("urn:test:app-both/"));
      await Promise.all([both.start(), both.about([cvx141])]);
      read = rowsRead();
      startedAfter = await both.start();
    });

    it("read each version once", () => {
      assert.deepEqual(
        read.sort(),
        [...rowsCarried].sort(),
        "a copy and a read at once read each version once",
      );
    });

    it("write the shared copy", () => {
      assert.equal(startedAfter, 0, "the shared copy was written");
    });
  });

  describe("when the starter carries a version the index does not name", () => {
    let copied: string[];

    before(async () => {
      const extra = new MemoryFiles("urn:test:starter-extra/");
      for (const path of carried)
        await extra.write(path, (await starter.read(path)) as Uint8Array);
      const unnamed = "version-the-index-does-not-name";
      await extra.write(
        `${unnamed}${PUBLISHED_ROWS}`,
        (await starter.read(rowsCarried[0] as string)) as Uint8Array,
      );
      const named = new MemoryFiles("urn:test:app-named/");
      await tablesOn(named, extra).start();
      copied = (await named.list(""))
        .filter((path) => path.endsWith(".ttl") && path !== "references.ttl")
        .sort();
    });

    it("copies at a start the versions the index names and no other", () => {
      assert.deepEqual(
        copied,
        order.map((each) => `${each}.ttl`).sort(),
        "a start copies the versions the index names and no other the starter carries",
      );
    });
  });

  describe("when a newer starter no longer carries a version", () => {
    let upgraded: Tables;

    before(async () => {
      const movedOn = new MemoryFiles("urn:test:starter-moved-on/");
      for (const path of carried)
        if (!path.startsWith(stem))
          await movedOn.write(path, (await starter.read(path)) as Uint8Array);
      const stranded = new MemoryFiles("urn:test:app-stranded/");
      await tablesOn(stranded).about([cvx141]);
      upgraded = tablesOn(stranded, movedOn);
    });

    it("refuses the version", async () => {
      await assert.rejects(
        upgraded.search(groups.series, "141"),
        (error) =>
          error instanceof Refusal &&
          error.message === `the tables hold no rows for ${groups.first}`,
      );
    });

    it("keeps the next version at a check", async () => {
      await upgraded.check();
      assert.ok(
        (await upgraded.search(groups.series, "141")).found.length > 0,
        "a check keeps the version a newer starter carries in place of the one it no longer does",
      );
    });
  });

  describe("a listing it carries", () => {
    it("is read, not listed again", async () => {
      assert.ok(
        (await tables.search(groups.series, "141")).found.length > 0,
        "a carried listing is read, not listed again",
      );
    });
  });

  describe("when it carries no listings, as a browser's does", () => {
    let listings = 0;
    let inProgress = 0;
    let mostListing = 0;
    let listingsRead = 0;
    let old: Tables;
    let current: number;
    let duringStart: [number, boolean];

    before(async () => {
      const unlisted = new MemoryFiles("urn:test:starter-unlisted/");
      for (const path of carried)
        if (!path.endsWith(LISTED))
          await unlisted.write(path, (await starter.read(path)) as Uint8Array);
      const store = new (class extends MemoryFiles {
        override read(pathOrIri: string): Promise<Uint8Array | undefined> {
          if (pathOrIri.endsWith(LISTED)) listingsRead += 1;
          return super.read(pathOrIri);
        }
      })("urn:test:app-unlisted/");
      old = new Tables({
        files: store,
        feeds: [FEED],
        vocabulary: parts.vocabulary,
        newStore: parts.newStore,
        fetch: fetchOf(first),
        starter: unlisted,
        work: {
          ...IN_THIS_THREAD,
          listed: async (...args) => {
            listings += 1;
            inProgress += 1;
            mostListing = Math.max(mostListing, inProgress);
            try {
              await new Promise((resolve) => setImmediate(resolve));
              return await IN_THIS_THREAD.listed(...args);
            } finally {
              inProgress -= 1;
            }
          },
        },
      });
      const started = old.start();
      await Promise.all([
        old.search(groups.series, "141"),
        old.search(groups.series, "141"),
      ]);
      await started;
      current = (await old.current()).length;
      duringStart = [listings, mostListing <= 2];
    });

    it("lists each current version once at a start and two searches during it, one at a time beside the start's", () => {
      assert.deepEqual(
        duringStart,
        [current, true],
        "a start and two searches during it list each current version once, a read listing beside the start's one at a time",
      );
    });

    it("neither reads a listing nor lists at a check", async () => {
      listingsRead = 0;
      await old.check();
      assert.deepEqual(
        [listingsRead, listings],
        [0, current],
        "a check neither reads a listing nor lists",
      );
    });

    it("lists nothing at a search after the start", async () => {
      await Promise.all([
        old.search(groups.series, "141"),
        old.search(groups.series, "141"),
      ]);
      assert.equal(listings, current, "a search after the start lists nothing");
    });
  });

  describe("a copied version", () => {
    it("holds the rows a check keeps", async () => {
      const checked = tablesOver(first);
      await checked.check();
      const rows = async (from: Tables) =>
        (await (await from.references()).rows(groups.first))
          .map((triple) => triple.map(({ value }) => value).join(" "))
          .sort();
      assert.deepEqual(await rows(tables), await rows(checked));
    });
  });

  describe("when the store is emptied while the app runs, as Reset all data empties it", () => {
    it("starts again from the copies", async () => {
      await rm(app, { recursive: true, force: true });
      assert.deepEqual(await tables.current(), shipped);
    });
  });
});

describe("the kinds an app keeps", () => {
  describe("a series of a kind nothing the app runs reads", () => {
    const unread = `${CASCADE}SubstanceIngredients`;
    let starter: MemoryFiles;
    let unkept: Checked | undefined;
    let kept: Checked | undefined;

    before(async () => {
      for (const path of await parts.vocabulary.list(RULE_LIST)) {
        const bytes = path.endsWith(".ttl")
          ? await parts.vocabulary.read(path)
          : undefined;
        if (bytes === undefined) continue;
        const named = (await parts.newStore().parse(bytes, FEED)).filter(
          ([, predicate, object]) =>
            predicate.value === `${CASCADE}tableKind` &&
            object.value === unread,
        );
        assert.deepEqual(
          named,
          [],
          `${path} now names ${unread}: this test needs a kind no rule list reads`,
        );
      }
      const served: Served = {
        ...first,
        catalog: first.catalog.map(([subject, predicate, object]) =>
          subject.value === groups.series &&
          predicate.value === `${CASCADE}tableKind`
            ? [subject, predicate, iri(unread)]
            : [subject, predicate, object],
        ),
      };
      starter = new MemoryFiles("urn:test:starter/");
      await writeStarterCopies(
        {
          feeds: [FEED],
          vocabulary: parts.vocabulary,
          newStore: parts.newStore,
          fetch: fetchOf(served),
        },
        (path, bytes) => starter.write(path, bytes),
      );
      [unkept] = await tablesOver(served).check();
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
      [kept] = await tablesOver(
        served,
        new MemoryFiles("urn:test:tables/"),
        naming,
      ).check();
    });

    it("is not carried as a starter copy", async () => {
      assert.ok(
        !(await starter.list("")).some((path) =>
          path.startsWith(fileStem(groups.first)),
        ),
      );
    });

    it("is not kept by a check", () => {
      assert.ok(!unkept?.kept.includes(groups.first));
    });

    it("is kept once a rule list names its kind", () => {
      assert.ok(kept?.kept.includes(groups.first));
    });
  });

  describe("a series of a kind the vocabulary marks as read by pages", () => {
    const marked = `${CASCADE}CodeNames`;
    const published = `${CASCADE}NdcDrugs`;
    const covers = `${CASCADE}coversGene`;
    let readByPages: ReadonlySet<string>;
    let unkept: Checked | undefined;
    let kept: Checked | undefined;
    let genesOf: (subject: string) => string[];

    before(async () => {
      ({ readByPages } = await tableTerms(parts.vocabulary, parts.newStore));
      for (const path of await parts.vocabulary.list(RULE_LIST)) {
        const bytes = path.endsWith(".ttl")
          ? await parts.vocabulary.read(path)
          : undefined;
        if (bytes === undefined) continue;
        assert.deepEqual(
          (await parts.newStore().parse(bytes, FEED)).filter(
            ([, predicate, object]) =>
              predicate.value === `${CASCADE}tableKind` &&
              [marked, published].includes(object.value),
          ),
          [],
          `${path} now names a kind this test needs no rule list to read`,
        );
      }
      const servedAs = (
        kind: string,
        genes: readonly Triple[] = [],
      ): Served => ({
        ...first,
        catalog: [
          ...first.catalog.map(([subject, predicate, object]): Triple =>
            subject.value === groups.series &&
            predicate.value === `${CASCADE}tableKind`
              ? [subject, predicate, iri(kind)]
              : [subject, predicate, object],
          ),
          ...genes,
        ],
      });
      [unkept] = await tablesOver(servedAs(published)).check();

      const files = new MemoryFiles("urn:test:tables/");
      [kept] = await tablesOver(
        servedAs(marked, [
          [iri(groups.first), iri(covers), literal("MLH1")],
          [iri(groups.first), iri(covers), literal("MSH2")],
          [iri(groups.series), iri(covers), literal("EPCAM")],
        ]),
        files,
      ).check();
      const index = await parts
        .newStore()
        .parse(
          (await files.read("references.ttl")) ?? new Uint8Array(),
          "urn:test:tables/references.ttl",
        );
      genesOf = (subject) =>
        index
          .filter(
            ([s, predicate]) =>
              s.value === subject && predicate.value === covers,
          )
          .map(([, , gene]) => gene.value)
          .sort();
    });

    it("is marked, and one of a kind published but not read by pages is not", () => {
      assert.ok(readByPages.has(marked) && !readByPages.has(published));
    });

    it("is kept, though no rule list names its kind", () => {
      assert.ok(kept?.kept.includes(groups.first));
    });

    it("is not kept when its kind is one no page reads", () => {
      assert.ok(!unkept?.kept.includes(groups.first));
    });

    it("carries the genes the kept version covers where its series carries none", () => {
      assert.deepEqual(genesOf(groups.first), ["MLH1", "MSH2"]);
      assert.deepEqual(genesOf(groups.series), []);
    });
  });
});

describe("the rows a pod's codes find", () => {
  const cvx141 = "https://ns.cascadeprotocol.org/codes/cvx/141";
  const reads: string[] = [];
  const inner = new MemoryFiles("urn:test:tables/");
  const counted: Files = {
    iri: inner.iri,
    read: (path) => {
      reads.push(path);
      return inner.read(path);
    },
    write: (path, bytes) => inner.write(path, bytes),
    list: (folder) => inner.list(folder),
  };
  const subjects = (rows: readonly Triple[]): string[] =>
    [...new Set(rows.map(([subject]) => subject.value))].sort();
  const sources = (rows: readonly Triple[]): string[] =>
    rows
      .filter(([, predicate]) => predicate.value.endsWith("#annotatedSource"))
      .map(([, , object]) => object.value);
  const lines = (rows: readonly Triple[]): string[] =>
    rows.map((row) => row.map((term) => term.value).join(" ")).sort();
  let tables: Tables;
  let references: Awaited<ReturnType<Tables["references"]>>;
  let names: string;
  let find: {
    codes: Set<string>;
    terms: Awaited<ReturnType<typeof tableTerms>>;
  };

  before(async () => {
    tables = tablesOver(feed, counted);
    await tables.check();
    references = await tables.references();
    const current = feed.catalog.find(
      ([subject, predicate]) =>
        predicate.value === CURRENT &&
        feed.catalog.some(
          ([s, , o]) =>
            s.value === subject.value && o.value.endsWith("#CodeNames"),
        ),
    )?.[2].value;
    assert.ok(current);
    names = current;
    find = {
      codes: new Set([cvx141]),
      terms: await tableTerms(parts.vocabulary, parts.newStore),
    };
  });

  it("are the same references each time they are read", async () => {
    assert.equal(await tables.references(), references);
  });

  it("are those found by the codes, by the kind's property", async () => {
    const found = await references.rows(groups.second, find);
    assert.deepEqual(sources(found), [cvx141]);
    assert.ok(
      subjects(await references.rows(groups.second)).length >
        subjects(found).length,
    );
  });

  it("are found by halving the rows for the row's own code, with no index of a kind found by that alone", async () => {
    assert.ok(
      !(await inner.list("")).some(
        (path) =>
          path.startsWith(`${fileStem(names)}.`) &&
          path.endsWith(".codes.json"),
      ),
    );
    const halved = reads.length;
    assert.deepEqual(subjects(await references.rows(names, find)), [cvx141]);
    assert.deepEqual(
      reads.slice(halved).filter((path) => path.startsWith(fileStem(names))),
      [`${fileStem(names)}.ttl`],
    );
  });

  it("are every row, whatever other codes are asked", async () => {
    const everything = await references.rows(names);
    assert.deepEqual(
      lines(
        await references.rows(names, {
          ...find,
          codes: new Set([...subjects(everything), "urn:test:no-rows"]),
        }),
      ),
      lines(everything),
    );
  });

  it("are no others", async () => {
    assert.deepEqual(
      await references.rows(names, {
        ...find,
        codes: new Set(["urn:test:x"]),
      }),
      [],
    );
  });

  it("are read from each version's files once", async () => {
    const readBefore = reads.length;
    await references.rows(names, find);
    await references.rows(names, find);
    assert.deepEqual(
      reads
        .slice(readBefore)
        .filter((path) => path.startsWith(fileStem(names))),
      [],
    );
  });

  it("are found without an index built for a kind found by the row's own code alone", async () => {
    await inner.write(
      `${fileStem(names)}.codes.json`,
      new TextEncoder().encode(
        JSON.stringify({ foundBy: [`${CASCADE}RowSubject`], rows: {} }),
      ),
    );
    assert.deepEqual(
      subjects(
        await (await tablesOver(feed, inner).references()).rows(names, find),
      ),
      [cvx141],
    );
  });

  it("are the same from a version's rows written as Turtle", async () => {
    const grouped = new Map<string, string[]>();
    for (const line of new TextDecoder()
      .decode(await inner.read(`${fileStem(names)}.ttl`))
      .split("\n")
      .filter((each) => each !== "")) {
      const [subject = "", rest = ""] = line.split(/ (.*) \.$/s);
      grouped.set(subject, [...(grouped.get(subject) ?? []), rest]);
    }
    const turtle = new MemoryFiles(inner.iri);
    for (const path of await inner.list(""))
      if (!path.endsWith(".codes.json"))
        await turtle.write(path, (await inner.read(path)) ?? new Uint8Array());
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
        await (await tablesOver(feed, turtle).references()).rows(names, find),
      ).filter((line) => line.startsWith(`${cvx141} `)),
      lines(await references.rows(names, find)),
    );
  });

  it("include a version once a later check keeps it", async () => {
    let served = first;
    const later = new Tables({
      files: new MemoryFiles("urn:test:tables/"),
      feeds: [FEED],
      vocabulary: parts.vocabulary,
      newStore: parts.newStore,
      fetch: (input, init) => fetchOf(served)(input, init),
    });
    await later.check();
    assert.ok(!(await later.references()).isVersion(groups.second));
    served = feed;
    await later.check();
    assert.ok((await later.references()).isVersion(groups.second));
  });
});

describe("the index of a version's rows by code", () => {
  const cvx141 = "https://ns.cascadeprotocol.org/codes/cvx/141";
  const source = "cascade:foundBy owl:annotatedSource .";
  const reading = recordsChanged((turtle) =>
    turtle.replace(
      source,
      "cascade:foundBy owl:annotatedSource , owl:annotatedTarget .",
    ),
  );
  let all: Triple[];
  let target: Term;

  before(async () => {
    const checked = tablesOver(feed);
    await checked.check();
    all = await (await checked.references()).rows(groups.second);
    const [, , found] =
      all.find(([, predicate]) =>
        predicate.value.endsWith("#annotatedTarget"),
      ) ?? [];
    assert.ok(found !== undefined);
    target = found;
  });

  const foundThrough = async (
    name: string,
    vocabulary: Files,
    change: (files: Files) => Promise<void>,
    code: string,
  ): Promise<void> => {
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
  };

  it("is not read when it is unreadable, and the rows a code finds are among them", async () => {
    await foundThrough(
      "unreadable",
      parts.vocabulary,
      (files) =>
        files.write(
          `${fileStem(groups.second)}.codes.json`,
          new TextEncoder().encode("{"),
        ),
      cvx141,
    );
  });

  it("is not read when it was built for a kind found by nothing, and the rows a code finds are among them", async () => {
    await foundThrough(
      "found by nothing",
      recordsChanged((turtle) =>
        turtle.replace(source, "rdfs:seeAlso owl:annotatedSource ."),
      ),
      async () => {},
      cvx141,
    );
  });

  it("is not read when it was built for a kind found by fewer properties, and the rows a code finds are among them", async () => {
    await foundThrough(
      "found by fewer",
      parts.vocabulary,
      async () => {},
      target.value,
    );
  });
});

describe("a check", () => {
  describe("whose read of the vocabulary fails", () => {
    it("keeps the version a later check reads it for", async () => {
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
      await assert.rejects(tables.check(), /could not be read/);
      await tables.check();
      assert.ok((await tables.references()).isVersion(groups.second));
    });
  });

  describe("of a version", () => {
    let store: MemoryFiles;

    before(async () => {
      store = new MemoryFiles("urn:test:tables/");
      await tablesOver(first, store).check();
    });

    const keepsNothing = async (
      input: string,
      served: Served,
      reason: RegExp,
      outcome: "refused" | "later",
    ): Promise<void> => {
      const tables = tablesOver(served, store);
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
    };

    describe("that does not verify", () => {
      const refused: [string, () => Promise<Served>, RegExp][] = [
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
      ];

      for (const [input, served, reason] of refused)
        it(`is refused, and nothing of it kept, for ${input}`, async () => {
          await keepsNothing(input, await served(), reason, "refused");
        });
    });

    describe("that cannot be read", () => {
      const later: [string, () => Promise<Served>, RegExp][] = [
        [
          "rows whose download breaks off",
          async () => ({ ...feed, broken: rowsUrl(feed, groups.second) }),
          /could not be read: the connection was reset/,
        ],
        [
          "a feed whose download breaks off",
          async () => ({ ...feed, broken: FEED }),
          /could not be read: the connection was reset/,
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
        ],
        [
          "a feed that is not Turtle",
          async () => ({ ...feed, text: "<not> <Turtle" }),
          /not Turtle/,
        ],
      ];

      for (const [input, served, reason] of later)
        it(`is tried later, and nothing of it kept, for ${input}`, async () => {
          await keepsNothing(input, await served(), reason, "later");
        });
    });
  });
});

describe("a builder the configuration names", () => {
  let firstCheck: Checked[];
  let secondCheck: Checked[];

  before(async () => {
    const {
      checked: [one, two],
    } = await built();
    firstCheck = one ?? [];
    secondCheck = two ?? [];
  });

  it("runs locally and its versions are kept as a feed's", () => {
    const [fromFeed, cvx] = firstCheck;
    assert.ok(fromFeed?.kept.includes(groups.second));
    assert.match(cvx?.feed ?? "", /^file:.*\/\.builds\/cdc-cvx\/feed\.ttl$/);
    assert.equal(cvx?.kept.length, 3);
    assert.deepEqual(cvx?.refused, []);
  });

  it("is refused for a version that does not descend from the version held", () => {
    const [, , example] = firstCheck;
    assert.match(
      example?.refused.map(({ reason }) => reason).join("\n") ?? "",
      new RegExp(`does not descend from ${groups.second}`),
    );
  });

  it("keeps nothing at a check finding nothing new", () => {
    assert.deepEqual(
      secondCheck.map(({ kept, later }) => ({ kept, later })),
      [
        { kept: [], later: undefined },
        { kept: [], later: undefined },
        { kept: [], later: undefined },
      ],
    );
  });
});

describe("a code's name and status", () => {
  const cvx141 = "https://ns.cascadeprotocol.org/codes/cvx/141";
  const cvx57 = "https://ns.cascadeprotocol.org/codes/cvx/57";
  const cvx03 = "https://ns.cascadeprotocol.org/codes/cvx/03";
  const unknown = "https://ns.cascadeprotocol.org/codes/cvx/999999";

  for (const [who, names, status, label] of [
    [
      "the CDC CVX",
      CVX_NAMES,
      CVX_STATUS,
      "Influenza, split virus, trivalent, preservative",
    ],
    ["the example builder's", EXAMPLE_NAMES, EXAMPLE_STATUS, "flu, split"],
  ] as const)
    describe(`with ${who} series preferred`, () => {
      let references: Awaited<ReturnType<Tables["references"]>>;
      let about: Awaited<ReturnType<Tables["about"]>>;

      before(async () => {
        const { store } = await built();
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
        references = await tables.references();
        about = await tables.about([cvx141, cvx57, cvx03, unknown]);
      });

      it("come from the first series of their kind, in the order of preference, that holds the code", () => {
        const name = about.get(cvx141)?.name;
        assert.equal(name?.label, label);
        assert.equal(references.seriesOf(name?.origin ?? ""), names);
      });

      it("come from a later series where the first does not hold the code", () => {
        for (const [code, holder] of [
          [cvx57, CVX_STATUS],
          [cvx03, EXAMPLE_STATUS],
        ] as const) {
          const retired = about.get(code)?.status;
          assert.equal(retired?.deprecated, true, code);
          assert.equal(
            references.seriesOf(retired?.origin ?? ""),
            holder,
            code,
          );
        }
      });

      it("answer every code asked, with how it is written", () => {
        assert.equal(about.get(cvx141)?.notation, "141");
        const unnamed = about.get(unknown);
        assert.equal(unnamed?.notation, "999999");
        assert.equal(unnamed?.name, undefined);
        assert.equal(unnamed?.status, undefined);
        assert.equal(unnamed?.ingredients, undefined);
      });
    });
});

describe("a code's ingredients", () => {
  describe("in a held product ingredients series", () => {
    let versions: string[];
    let about: Awaited<ReturnType<Tables["about"]>>;
    let brand: string;
    let ibuprofen: string;
    let unmapped: string;

    before(async () => {
      const mapped = await withMappings(feed, INGREDIENTS, [
        [
          ["153010", "5640"],
          ["153010", "7052"],
          ["5640", "5640"],
        ],
      ]);
      versions = mapped.versions;
      const tables = tablesOver(mapped.served);
      await tables.check();
      [brand, ibuprofen, unmapped] = ["153010", "5640", "999999"].map(
        (code) => RXNORM + code,
      ) as [string, string, string];
      about = await tables.about([brand, ibuprofen, unmapped]);
    });

    it("are the targets of the series that maps the code", () => {
      assert.deepEqual(
        [...(about.get(brand)?.ingredients?.codes ?? [])].sort(),
        [RXNORM + "5640", RXNORM + "7052"],
      );
    });

    it("are named by the version that says so", () => {
      assert.equal(about.get(brand)?.ingredients?.origin, versions[0]);
    });

    it("are the code itself for an ingredient", () => {
      assert.deepEqual(about.get(ibuprofen)?.ingredients?.codes, [
        RXNORM + "5640",
      ]);
    });

    it("are none for a code no row maps", () => {
      assert.equal(about.get(unmapped)?.ingredients, undefined);
    });
  });

  describe("of a product with a precise ingredient", () => {
    it("are its ingredient rows, never its precise ingredient rows", async () => {
      const { tables } = await plantedTables();
      const about = await tables.about([`${RXNORM}2588848`]);
      assert.deepEqual(about.get(`${RXNORM}2588848`)?.ingredients?.codes, [
        `${RXNORM}${KETOCONAZOLE}`,
      ]);
    });
  });
});

describe("a pod that joined two allergies through an older product ingredients version", () => {
  const advil: [string, string] = ["153010", "5640"];
  const ibuprofen: [string, string] = ["5640", "5640"];
  let next: Awaited<ReturnType<typeof withVersions>>;
  let store: MemoryFiles;
  let folder: string;
  let held: Tables;
  let joined: (
    pod: Awaited<ReturnType<typeof openPodWith>>,
  ) => Promise<string[]>;

  before(async () => {
    const written = {
      ...INGREDIENTS,
      predicate: "http://www.w3.org/2004/02/skos/core#broadMatch",
    };
    const old = await withMappings(feed, written, [[advil, ibuprofen]]);
    next = await withVersions(feed, INGREDIENTS, [
      mappingRows(written, [advil, ibuprofen]),
      mappingRows(INGREDIENTS, [advil, ibuprofen]),
    ]);
    // Version 8 of the rule list reads the relation as skos:broadMatch; the shipped one reads obo:RO_0002248.
    const { index, shipped, series } = await ruleList();
    const listed = await parts
      .newStore()
      .parse(index, `${parts.vocabulary.iri}${RULE_LIST}references.ttl`);
    const [eighth] = listed
      .filter(
        ([subject, property, version]) =>
          property.value === `${PAV}version` &&
          version.value === "8" &&
          listed.some(
            ([of, kind, to]) =>
              of.value === subject.value &&
              kind.value === `${PROV}specializationOf` &&
              to.value === series,
          ),
      )
      .map(([subject]) => subject.value);
    assert.ok(eighth !== undefined);
    const { vocabulary } = parts;
    const eighthRules: Files = {
      iri: vocabulary.iri,
      read: async (path) =>
        path === `${RULE_LIST}references.ttl`
          ? new TextEncoder().encode(
              index.replace(
                `cascade:defaultTableVersion <${shipped}>`,
                `cascade:defaultTableVersion <${eighth}>`,
              ),
            )
          : vocabulary.read(path),
      write: (path, bytes) => vocabulary.write(path, bytes),
      list: (at) => vocabulary.list(at),
    };
    store = new MemoryFiles("urn:test:tables/");
    folder = join(scratch, "pods", "broad-match");
    held = tablesOver(old.served, store, eighthRules);
    await held.check();
    const pod = await openPodWith({ ...parts, tables: held }, folder);
    const allergies = ["153010", "5640"].map(
      (
        code,
        index,
      ) => `<urn:cascade:output-${index}> a cascade:AllergyOrIntolerance .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  cascade:allergenCode <${RXNORM}${code}> ; cascade:patient <${pod.subject}> .`,
    );
    const entered = await pod.enter(`${PREFIXES}
<urn:uuid:${crypto.randomUUID()}> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] .
${allergies.join("\n")}`);
    assert.equal(entered.refused, undefined);
    await pod.close();
    const [oldVersion, newVersion] = next.versions;
    joined = async (opened) =>
      (
        await opened.ask({
          query: `${PREFIXES}SELECT ?used (GROUP_CONCAT(STR(?code); separator=" ") AS ?codes) WHERE {
          ?judgment cascade:justification cascade:SameMappedCode ; prov:wasDerivedFrom ?used ; prov:hadMember ?record .
          VALUES ?used { <${oldVersion}> <${newVersion}> }
          ?record pav:hasCurrentVersion/cascade:allergenCode ?code
        } GROUP BY ?judgment ?used`,
        })
      )
        .map(
          ({ used = "", codes = "" }) =>
            `${used === oldVersion ? "broadMatch" : "obo"}: ${codes.replaceAll(RXNORM, "").split(" ").sort().join(" ")}`,
        )
        .sort();
  });

  it("keeps that Same when opened with the older version", async () => {
    const pod = await openPodWith({ ...parts, tables: held }, folder);
    try {
      assert.deepEqual(await joined(pod), ["broadMatch: 153010 5640"]);
    } finally {
      await pod.close();
    }
  });

  it("gains the Same through the version written with the new relation", async () => {
    const after = tablesOver(next.served, store);
    await after.check({ cache: "no-cache" });
    const pod = await openPodWith({ ...parts, tables: after }, folder);
    try {
      assert.equal(pod.opened?.refused, undefined);
      assert.deepEqual(await joined(pod), [
        "broadMatch: 153010 5640",
        "obo: 153010 5640",
      ]);
    } finally {
      await pod.close();
    }
  });
});

describe("an app's tables", () => {
  const other = "https://tables.example/other.ttl";
  const preference = { [`${CASCADE}CodeNames`]: [EXAMPLE_NAMES] };
  const packaged = parts.local.config;
  const packageConfig = join(
    findRoot(dirname(fileURLToPath(import.meta.url))),
    "cascade-runtime.json",
  );
  let app: string;
  const configured = async (app: string, code: object) =>
    withTables(
      packaged,
      await appSettings(app, packageConfig),
      tablesSettings(code, "configureTables"),
    ).tables;

  before(async () => {
    app = await mkdtemp(join(scratch, "app-"));
  });

  describe("built from the package's, the app's file and the app's code, each field in its place", () => {
    const cases: [string, unknown, object, (app: string) => object][] = [
      [
        "the file's feeds and order of preference, the package's check on open",
        { tables: { feeds: [other], preference } },
        {},
        () => ({
          feeds: [other],
          preference,
          checkOnOpen: packaged.tables.checkOnOpen,
        }),
      ],
      [
        "the code's over the file's",
        { tables: { feeds: [FEED] } },
        { feeds: [other], checkOnOpen: false },
        () => ({ feeds: [other], checkOnOpen: false }),
      ],
      ["no feed", { tables: { feeds: [] } }, {}, () => ({ feeds: [] })],
      [
        "a builder by its name, and by its path from the file",
        { tables: { builders: ["cdc-cvx", "../mine"] } },
        {},
        (app) => ({ builders: ["cdc-cvx", resolve(app, "..", "mine")] }),
      ],
    ];

    for (const [name, file, code, expected] of cases)
      it(`take ${name}`, async () => {
        await writeFile(
          join(app, "cascade-runtime.json"),
          JSON.stringify(file),
        );
        assert.deepEqual(
          await configured(app, code),
          { ...packaged.tables, ...expected(app) },
          name,
        );
      });

    it("read nothing from the package's own file", async () => {
      await writeFile(
        join(app, "cascade-runtime.json"),
        JSON.stringify({ tables: {} }),
      );
      assert.deepEqual(
        await appSettings(app, join(app, "cascade-runtime.json")),
        {},
        "the package's own file",
      );
    });
  });

  describe("refused when an app sets what it cannot", () => {
    const cases: [string, unknown, object, RegExp][] = [
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
        { tables: { preference: { [`${CASCADE}CodeNames`]: ["names"] } } },
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

    for (const [name, file, code, expected] of cases)
      it(`refuse ${name}`, async () => {
        await writeFile(
          join(app, "cascade-runtime.json"),
          JSON.stringify(file),
        );
        await assert.rejects(configured(app, code), expected, name);
      });

    it("refuse a file naming more than tables, from the working folder", async () => {
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
    });

    it("accept configureTables after a start that failed", () => {
      assert.doesNotThrow(
        () => configureTables({}),
        "configureTables after a start that failed",
      );
    });
  });

  describe("while the check on open is still running", () => {
    const pod = "urn:uuid:5f0c2a64-8e1b-4d3a-9c7e-2b6a4f1d8e03";
    let release = (): void => undefined;
    const gate = new Promise<void>((open) => (release = open));
    let fetched = false;
    let tables: Tables;

    before(async () => {
      const served = fetchOf(feed);
      configureTables({
        feeds: [FEED],
        checkOnOpen: true,
        fetch: async (input, init) => {
          // The check on open gives up when its signal aborts: a record that waits for it is made only after this passes.
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
      tables = await tablesBeside(join(scratch, "opened"));
    });

    after(() => {
      release();
    });

    it("holds the version it held before the check", async () => {
      assert.ok(!(await tables.current()).includes(groups.second));
    });

    it("records a pod's open without waiting for the check", async () => {
      await tables.opened(pod, [groups.first], "alex");
      assert.equal(
        fetched,
        false,
        "the pod's open was recorded only once the check on open went on",
      );
      assert.deepEqual(await tables.openedWith(pod), [groups.first]);
    });

    it("keeps its versions after, with a queued check finding nothing left to keep", async () => {
      release();
      // A second check is queued behind the one on open, as every check is, and
      // finds nothing left to keep because the one on open kept it.
      assert.deepEqual(
        (await tables.check()).flatMap(({ kept }) => kept),
        [],
        "the queued check kept a version the check on open had not",
      );
      assert.ok((await tables.current()).includes(groups.second));
    });

    it("keeps the record of the pod's open when the check keeps its versions", async () => {
      assert.deepEqual(
        await tables.openedWith(pod),
        [groups.first],
        "the check's record of what is held lost the pod's open",
      );
    });
  });
});

describe("a panel's page", () => {
  let facts: Awaited<ReturnType<Tables["facts"]>>;

  before(async () => {
    const { tables } = await plantedTables();
    facts = await tables.facts(`${LOINC}${PANEL}`);
  });

  it("gives its members in order with the ones it requires", () => {
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
        ["2823-3", 1, undefined, "Potassium [Moles/volume] in Serum or Plasma"],
        ["2951-2", 2, "R", "Sodium [Moles/volume] in Serum or Plasma"],
        ["17861-6", 3, "R-a", undefined],
      ],
    );
  });

  it("is no generic mapping", () => {
    assert.deepEqual(
      facts.mappings.filter(({ series }) => series === PANELS.series),
      [],
    );
  });
});

describe("a lab result's code", () => {
  let tables: Tables;

  before(async () => {
    ({ tables } = await plantedTables());
  });

  it("is named by LOINC", async () => {
    const potassium = await tables.facts(`${LOINC}2823-3`);
    assert.equal(
      potassium.about?.name?.label,
      "Potassium [Moles/volume] in Serum or Plasma",
    );
  });

  it("gives the panels that hold it", async () => {
    const potassium = await tables.facts(`${LOINC}2823-3`);
    assert.deepEqual(
      potassium.panels.map(({ heldBy }) => [
        heldBy.total,
        heldBy.panels.map(({ notation, sequence }) => [notation, sequence]),
      ]),
      [[1, [[PANEL, 1]]]],
    );
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

  it("gives no panel for a code no panel holds", async () => {
    assert.deepEqual(await tables.inPanels(`${LOINC}9999-9`), []);
  });
});

describe("a code's classes", () => {
  let tables: Tables;

  before(async () => {
    ({ tables } = await plantedTables());
  });

  it("on the code itself is not reached through another", async () => {
    assert.deepEqual(
      (await tables.facts(`${RXNORM}1546022`)).classes.flatMap(({ in: each }) =>
        each.map(({ through }) => through),
      ),
      [undefined, undefined],
    );
  });

  it("is none for a combination", async () => {
    assert.deepEqual((await tables.facts(`${RXNORM}197885`)).classes, []);
  });

  describe("of a product", () => {
    it("is its ingredient's own when it has no precise ingredient", async () => {
      assert.deepEqual(await classLines(tables, "197658"), [
        `establishedPharmacologicClass N0000175825 through ${ESTRADIOL}`,
        `mechanismOfActionClass N0000000100 through ${ESTRADIOL}`,
      ]);
    });

    it("is its own precise ingredient's, else its ingredient's own", async () => {
      assert.deepEqual(await classLines(tables, "2588848"), [
        `establishedPharmacologicClass N0000193183 through ${LEVOKETOCONAZOLE}`,
        `chemicalStructureClass ${AZOLES} through ${KETOCONAZOLE}`,
      ]);
    });

    it("is never a different form's", async () => {
      assert.deepEqual(await classLines(tables, "314076"), [
        `establishedPharmacologicClass withheld, a different form of ${LISINOPRIL}`,
        `mechanismOfActionClass withheld, a different form of ${LISINOPRIL}`,
      ]);
      assert.deepEqual(
        await tables.classedElsewhere([
          `${RXNORM}314076`,
          `${RXNORM}197658`,
          `${RXNORM}197885`,
        ]),
        new Map([[`${RXNORM}314076`, [`${RXNORM}${LISINOPRIL}`]]]),
      );
    });

    it("is kept by a precise ingredient as its own", async () => {
      assert.deepEqual(await classLines(tables, FLUOROESTRADIOL), [
        "establishedPharmacologicClass N0000177914",
        "mechanismOfActionClass N0000175869",
      ]);
    });
  });

  describe("a product ingredients version", () => {
    const files = new MemoryFiles("urn:test:tables/");
    let withoutPrecise: Mapped;
    let withPrecise: Mapped;

    before(async () => {
      withoutPrecise = await withMappings(feed, PRECISE_INGREDIENTS, [
        ESTRADIOL_ROWS,
      ]);
      withPrecise = await withMappings(feed, PRECISE_INGREDIENTS, [
        ESTRADIOL_ROWS,
        [...ESTRADIOL_ROWS, ["2588848", LEVOKETOCONAZOLE]],
      ]);
    });

    const classed = async (served: Served): Promise<string[]> => {
      const { served: withClasses } = await withMappings(
        served,
        CLASSES_BY_RELATION,
        [ESTRADIOL_CLASSES],
      );
      const classedTables = tablesOver(withClasses, files);
      await classedTables.check();
      return classLines(classedTables, "197658");
    };

    it("that states no precise ingredient gives a product only a class on its own code", async () => {
      assert.deepEqual(
        await classed(withoutPrecise.served),
        [],
        "a version that states no precise ingredient says nothing of other forms",
      );
    });

    it("that states them, kept by a check, gives it its ingredient's class", async () => {
      assert.deepEqual(await classed(withPrecise.served), [
        `establishedPharmacologicClass N0000175825 through ${ESTRADIOL}`,
        `mechanismOfActionClass N0000000100 through ${ESTRADIOL}`,
      ]);
    });
  });
});

describe("the pod's medicines in a class", () => {
  let tables: Tables;
  let classes: string;
  let rows: Awaited<
    ReturnType<Awaited<ReturnType<typeof openPodWith>>["medicationClasses"]>
  >;
  const names: Record<string, string> = {
    "314076": "Lisinopril 10 MG Oral Tablet",
    "197885": "Hydrochlorothiazide 12.5 MG / Lisinopril 10 MG Oral Tablet",
    "197658": "Estradiol 1 MG Oral Tablet",
    [FLUOROESTRADIOL]: "Fluoroestradiol F-18",
    "2588848": "Levoketoconazole 150 MG Oral Tablet",
  };

  before(async () => {
    ({ tables, classes } = await plantedTables());
    const folder = join(scratch, "pods", "classes");
    const pod = await openPodWith({ ...parts, tables }, folder);
    try {
      const medication = (code: string, index: number): string =>
        `<urn:cascade:output-${index}> a <https://ns.cascadeprotocol.org/cascade#PrescribedOrReportedMedication> .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  <https://ns.cascadeprotocol.org/cascade#drugName> "${names[code]}" ;
  <https://ns.cascadeprotocol.org/cascade#rxNormCode> <${RXNORM}${code}> ;
  <https://ns.cascadeprotocol.org/cascade#prescribedOrReported> "prescribed" ;
  <https://ns.cascadeprotocol.org/cascade#workflowStatus> "active" ; cascade:patient <${pod.subject}> .`;
      const entered = await pod.enter(`${PREFIXES}
<urn:uuid:${crypto.randomUUID()}> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] .
${Object.keys(names).map(medication).join("\n")}`);
      assert.equal(entered.refused, undefined);
      rows = await pod.medicationClasses();
    } finally {
      await pod.close();
    }
  });

  it("are the classes the tables give them, through the code they come by", () => {
    assert.deepEqual(
      rows
        .map(
          ({
            medication,
            relation = "",
            class: of = "",
            through,
            stated,
            origin,
          }) => [
            medication,
            relation.slice(CASCADE.length),
            of.slice(MEDRT.length),
            through?.slice(RXNORM.length),
            stated,
            origin === classes,
          ],
        )
        .sort(),
      [
        [
          "Estradiol 1 MG Oral Tablet",
          "establishedPharmacologicClass",
          "N0000175825",
          ESTRADIOL,
          "false",
          true,
        ],
        [
          "Estradiol 1 MG Oral Tablet",
          "mechanismOfActionClass",
          "N0000000100",
          ESTRADIOL,
          "false",
          true,
        ],
        [
          "Fluoroestradiol F-18",
          "establishedPharmacologicClass",
          "N0000177914",
          FLUOROESTRADIOL,
          "true",
          true,
        ],
        [
          "Fluoroestradiol F-18",
          "mechanismOfActionClass",
          "N0000175869",
          FLUOROESTRADIOL,
          "true",
          true,
        ],
        [
          "Levoketoconazole 150 MG Oral Tablet",
          "chemicalStructureClass",
          AZOLES,
          KETOCONAZOLE,
          "false",
          true,
        ],
        [
          "Levoketoconazole 150 MG Oral Tablet",
          "establishedPharmacologicClass",
          "N0000193183",
          LEVOKETOCONAZOLE,
          "false",
          true,
        ],
      ],
    );
  });

  it("are asked of the tables by the same rule as a code's page", async () => {
    for (const [code, name] of Object.entries(names)) {
      const said = (await tables.facts(`${RXNORM}${code}`)).classes.flatMap(
        ({ in: each }) =>
          each.map(
            ({ relation, class: of }) => `${relation} ${MEDRT}${of.notation}`,
          ),
      );
      const asked = rows
        .filter((row) => row.medication === name)
        .map((row) => `${row.relation} ${row.class ?? ""}`);
      assert.deepEqual(said.sort(), asked.sort(), name);
    }
  });
});

describe("a person's results in the panel they pick", () => {
  const OTHER = "99999-1";
  const NESTED = "99999-2";
  const place: Record<string, [string, string, number, string]> = {
    a: [PANEL, "2951-2", 1, "R"],
    b: [PANEL, "2823-3", 2, "R"],
    c: [PANEL, "2075-0", 3, "R"],
    d: [PANEL, "2028-9", 4, "O"],
    e: [PANEL, NESTED, 5, "O"],
    f: [NESTED, "2823-3", 1, "R"],
    g: [OTHER, "2823-3", 1, "R"],
  };
  const said = (rows: Row[]): string[] =>
    rows
      .map(
        (row) =>
          `${row.member?.slice(LOINC.length)} ${row.required} ${row.sequence} via ${row.via?.slice(LOINC.length)} ${row.entry === undefined ? "missing" : "result"}`,
      )
      .sort();
  let versions: string[];
  let rows: Row[];
  let other: Row[];
  let notAPanel: Row[];

  before(async () => {
    const panels = await withMappings(
      feed,
      {
        ...PANELS,
        extra: (panel, member) => {
          const [, , sequence, required] = Object.values(place).find(
            ([of, each]) => of === panel && each === member,
          )!;
          return [
            [`${CASCADE}panelSequence`, literal(String(sequence), XSD_INTEGER)],
            [`${CASCADE}observationRequiredInPanel`, literal(required)],
          ];
        },
      },
      [Object.values(place).map(([panel, member]) => [panel, member])],
    );
    versions = panels.versions;
    const tables = tablesOver(panels.served);
    await tables.check();
    const folder = join(scratch, "pods", "panel-results");
    const pod = await openPodWith({ ...parts, tables }, folder);
    try {
      const result = (day: string, index: number): string =>
        `<urn:cascade:output-${index}> a cascade:LaboratoryTestResult .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  cascade:testCode <${LOINC}2823-3> ; cascade:testName "Potassium" ;
  cascade:resultValueKind cascade:TextResultValue ; cascade:resultValue "4.${index}" ;
  cascade:resultClinicallyRelevantTime "${day}T12:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ; cascade:patient <${pod.subject}> .`;
      const entered = await pod.enter(`${PREFIXES}
<urn:uuid:${crypto.randomUUID()}> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] .
${["2025-03-01", "2025-06-01"].map(result).join("\n")}`);
      assert.equal(entered.refused, undefined);
      rows = await pod.panelResults(`${LOINC}${PANEL}`);
      other = await pod.panelResults(`${LOINC}${OTHER}`);
      notAPanel = await pod.panelResults(`${LOINC}2823-3`);
    } finally {
      await pod.close();
    }
  });

  it("are the required tests missing and a result for each way a member is reached", () => {
    assert.deepEqual(said(rows), [
      `2075-0 R 3 via ${PANEL} missing`,
      `2823-3 R 1 via ${NESTED} result`,
      `2823-3 R 1 via ${NESTED} result`,
      `2823-3 R 2 via ${PANEL} result`,
      `2823-3 R 2 via ${PANEL} result`,
      `2951-2 R 1 via ${PANEL} missing`,
    ]);
  });

  it("name the panel picked and the version of the tables that holds it", () => {
    assert.ok(rows.every((row) => row.panel === `${LOINC}${PANEL}`));
    assert.equal(
      rows.every((row) => row.origin === versions[0]),
      true,
    );
  });

  it("are those of another panel's own members when that one is picked", () => {
    assert.deepEqual(said(other), [
      `2823-3 R 1 via ${OTHER} result`,
      `2823-3 R 1 via ${OTHER} result`,
    ]);
  });

  it("are none for a code that is no panel", () => {
    assert.deepEqual(notAPanel, []);
  });
});
