import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  canonical,
  codeIri,
  type Files,
  Layout,
  MemoryFiles,
  ntriples,
  OxigraphStore,
  type Placed,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  findRoot,
  FolderFiles,
} from "@cascade-runtime/runtime/node";
import { Answers } from "../src/answers.js";
import { publishedAnswers } from "../src/node/published.js";
import { answersBeside, partsOf } from "../src/node/resolved.js";
import { keptPod, openPodWith, type Parts, type Pod } from "../src/pod.js";
import {
  Tables,
  type VariantAsked,
  versionName,
  writeStarterCopies,
} from "../src/tables.js";

const FEED = "https://tables.example/feed.ttl";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const GENOMICS = "https://ns.cascadeprotocol.org/genomics/v1#";
const CLASSIFICATIONS = `${REC}VariantClassifications`;
const LYNCH = ["MLH1", "MSH2", "MSH6", "PMS2", "EPCAM"];
const TURTLE = `@prefix genomics: <${GENOMICS}> .
@prefix rec: <${REC}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix pav: <http://purl.org/pav/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix spdx: <http://spdx.org/rdf/terms#> .
`;
const HGVS = "http://varnomen.hgvs.org/";
const CLINVAR = "http://www.ncbi.nlm.nih.gov/clinvar/";
const A = "urn:uuid:0a1e2c3d-4b5a-4c6d-8e7f-a1b2c3d4e5f6";
const B = "urn:uuid:0b1e2c3d-4b5a-4c6d-8e7f-a1b2c3d4e5f6";
const CREDIT =
  "ClinVar, NCBI. Not intended for direct diagnostic use or medical decision-making without review by a genetics professional.";

/** A row of a variant classifications table: the variation, the expressions it is found by, and what it says. */
const row = (id: string, expressions: readonly string[], says: string) =>
  `<${CLINVAR}${id}> ${expressions.map((each) => `rec:hgvsExpression <${HGVS}${encodeURIComponent(each).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}> ;`).join(" ")} ${says} .`;

const LYNCH_ROWS = [
  row(
    "90011",
    ["NM_000249.3:c.2042C>T", "NM_000249.4:c.2042C>T"],
    `rec:clinvarClassification genomics:Pathogenic , genomics:LikelyPathogenic ;
      rec:clinvarReviewStatus rec:ClinVarMultipleSubmittersNoConflicts ;
      rec:lastEvaluated "2024-12-11"^^xsd:date ; rec:contributingSubmitters 5`,
  ),
  row(
    "90012",
    ["NM_000251.3:c.100A>G"],
    `rec:clinvarClassification rec:ClinVarConflicting ; rec:submitters 3`,
  ),
  row(
    "90013",
    ["NM_000251.3:c.200A>G"],
    `rec:clinvarClassification genomics:Benign`,
  ),
].join("\n");

interface Served {
  readonly catalog: readonly Triple[];
  readonly files: ReadonlyMap<string, Uint8Array>;
}

const components = await checkouts(
  findRoot(dirname(fileURLToPath(import.meta.url))),
);
const parts: Parts = await partsOf(components);
let scratch: string;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "cascade-variants-"));
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function gzipped(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}

async function hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The feed with a variant classifications series added: its versions, each holding the rows given and stating the genes
 * given, the last current; and the names of the versions.
 */
async function withClassifications(
  served: Served,
  series: string,
  line: readonly { rows: string; genes?: readonly string[] }[],
): Promise<{ served: Served; versions: string[] }> {
  const files = new Map(served.files);
  const versions: string[] = [];
  let turtle = `${TURTLE}<${series}> a rec:ReferenceSeries ; rdfs:label "ClinVar ${series.slice(9, 13)}" ;
  rec:tableKind rec:VariantClassifications ; dct:bibliographicCitation "${CREDIT}" .
`;
  for (const [index, { rows, genes = [] }] of line.entries()) {
    const triples = await new OxigraphStore().parse(
      `${TURTLE}${rows}`,
      "urn:test:rows",
    );
    const previous = versions.at(-1);
    const version = await versionName(series, previous, triples);
    const bytes = await gzipped(
      (await canonical(triples))
        .split("\n")
        .filter((nt) => nt.trim() !== "")
        .map((nt) => `${nt.replace(/\s*\.\s*$/, "")} <${version}> .`)
        .sort()
        .join("\n"),
    );
    const url = `https://tables.example/rows/${series.slice(9, 13)}-${index}.nq.gz`;
    files.set(url, bytes);
    turtle += `<${version}> prov:specializationOf <${series}> ; pav:version "${index + 1}" ;
  ${previous === undefined ? "" : `prov:wasRevisionOf <${previous}> ;`}
  ${genes.map((gene) => `rec:coversGene "${gene}" ;`).join(" ")}
  dcat:distribution [ dcat:downloadURL <${url}> ; spdx:checksum [ spdx:checksumValue "${await hex(bytes)}" ] ] .
`;
    versions.push(version);
  }
  turtle += `<${series}> dcat:hasCurrentVersion <${versions.at(-1)}> .`;
  return {
    served: {
      files,
      catalog: [
        ...served.catalog,
        ...(await new OxigraphStore().parse(turtle, FEED)),
      ],
    },
    versions,
  };
}

const NOTHING: Served = { catalog: [], files: new Map() };

function fetchOf(served: Served): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === FEED)
      return new Response(new TextDecoder().decode(ntriples(served.catalog)));
    const bytes = served.files.get(url);
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes.slice());
  };
}

/** An app started from the starter copies of the feed, as the package carries them. */
async function appOver(
  served: Served,
  files: Files = new MemoryFiles("urn:test:app/"),
): Promise<Tables> {
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
  return new Tables({
    files,
    feeds: [FEED],
    vocabulary: parts.vocabulary,
    newStore: parts.newStore,
    starter,
    preference: { [CLASSIFICATIONS]: [A, B] },
  });
}

/** Two series: the first states Lynch's genes and holds three rows, the second states none and holds one. */
async function twoSeries() {
  const first = await withClassifications(NOTHING, A, [
    { rows: LYNCH_ROWS, genes: LYNCH },
  ]);
  const second = await withClassifications(first.served, B, [
    {
      rows: row(
        "80001",
        ["NM_000059.4:c.1114A>C"],
        `rec:clinvarClassification genomics:VUS`,
      ),
    },
  ]);
  return {
    served: second.served,
    a: first.versions[0]!,
    b: second.versions[0]!,
  };
}

test("what ClinVar says of a variant is read from the app's current version of the first held series that covers its gene, by its ID when it has one and by its expression when it has none", async () => {
  const { served, a, b } = await twoSeries();
  const app = await appOver(served);
  const asked = (
    variant: Partial<VariantAsked> & { gene?: string },
  ): VariantAsked => ({ hgvs: [], variations: [], ...variant });
  const says = async (variant: Partial<VariantAsked>) =>
    app.variantClassification(asked(variant));
  const found = async (variant: Partial<VariantAsked>) => {
    const answered = await says(variant);
    return answered.found === "rows"
      ? [answered.version, answered.rows.map(({ variation }) => variation)]
      : answered.found;
  };
  const pathogenic = [a, [`${CLINVAR}90011`]];

  assert.deepEqual(
    await found({ gene: "MLH1", variations: ["90011"] }),
    pathogenic,
  );
  assert.deepEqual(
    await found({ gene: "MLH1", hgvs: ["NM_000249.3:c.2042C>T"] }),
    pathogenic,
  );
  assert.deepEqual(await found({ variations: ["90011"] }), pathogenic);
  // The ID is read and the expression is not: an ID on no row is not found, though its expression is on a row.
  assert.equal(
    await found({
      gene: "MLH1",
      variations: ["12345"],
      hgvs: ["NM_000249.4:c.2042C>T"],
    }),
    "not found",
  );
  assert.equal(
    await found({ gene: "MLH1", hgvs: ["NM_000249.9:c.1A>G"] }),
    "not found",
  );
  assert.equal(
    await found({
      gene: "MLH1",
      hgvs: ["NM_000251.3:c.100A>G", "NM_000251.3:c.200A>G"],
    }),
    "not found",
  );
  assert.deepEqual(
    await says({ gene: "BRCA2", hgvs: ["NM_000059.9:c.1A>G"] }),
    {
      found: "not covered",
      series: A,
      version: a,
      genes: ["EPCAM", "MLH1", "MSH2", "MSH6", "PMS2"],
    },
  );
  // A version that states no genes covers none by name, and answers where it holds a row.
  assert.deepEqual(
    await found({ gene: "BRCA2", hgvs: ["NM_000059.4:c.1114A>C"] }),
    [b, [`${CLINVAR}80001`]],
  );

  const alone = await says({ variations: ["90011"] });
  assert.deepEqual(alone.found === "rows" ? alone.rows : [], [
    {
      variation: `${CLINVAR}90011`,
      classification: [
        { iri: `${GENOMICS}LikelyPathogenic`, label: "Likely pathogenic" },
        { iri: `${GENOMICS}Pathogenic`, label: "Pathogenic" },
      ],
      reviewStatus: {
        iri: `${REC}ClinVarMultipleSubmittersNoConflicts`,
        label: "criteria provided, multiple submitters, no conflicts",
      },
      lastEvaluated: "2024-12-11",
      contributingSubmitters: 5,
    },
  ]);

  assert.deepEqual(
    await (
      await appOver(NOTHING)
    ).variantClassification(asked({ gene: "MLH1" })),
    { found: "no series" },
  );
});

test("the labels are the vocabulary's, and a classification is a variation's fact and no mapping", async () => {
  const { served, a } = await twoSeries();
  const app = await appOver(served);
  assert.deepEqual(
    [
      ...(await app.labels([
        `${GENOMICS}VUS`,
        `${REC}ClinVarConflicting`,
        "urn:test:unlabelled",
      ])),
    ],
    [
      [`${GENOMICS}VUS`, "Uncertain significance"],
      [
        `${REC}ClinVarConflicting`,
        "Conflicting classifications of pathogenicity",
      ],
    ],
  );
  const facts = await app.facts(`${CLINVAR}90011`);
  assert.deepEqual(facts.mappings, []);
  assert.deepEqual(
    facts.classifications.map(({ series, version, contributingSubmitters }) => [
      series,
      version,
      contributingSubmitters,
    ]),
    [[A, a, 5]],
  );
  assert.deepEqual((await app.facts(`${CLINVAR}1`)).classifications, []);
});

test("an index of rows by code that is missing or was built for other properties is made again from the version's rows and kept beside it", async () => {
  const { served, a } = await twoSeries();
  const files = new MemoryFiles("urn:test:app/");
  const app = await appOver(served, files);
  await app.references();
  const path = (await files.list("")).find((each) =>
    each.endsWith(".codes.json"),
  );
  assert.ok(path);
  await files.write(path, new TextEncoder().encode('{"foundBy":[],"rows":{}}'));
  const again = await appOver(served, files);
  const answered = await again.variantClassification({
    gene: "MLH1",
    hgvs: [],
    variations: ["90013"],
  });
  assert.equal(answered.found, "rows");
  assert.ok(
    new TextDecoder()
      .decode(await files.read(path))
      .includes(codeIri("http://varnomen.hgvs.org/", "NM_000251.3:c.200A>G")),
  );
  assert.equal(
    (await again.facts(`${CLINVAR}90013`)).classifications[0]?.version,
    a,
  );
});

/** One variant and the report it was given, whose verdict the cases below name by its gene. */
interface Case {
  readonly gene: string;
  readonly variant: string;
  readonly report?: string;
  readonly verdict?: string;
}

const CASES: readonly Case[] = [
  {
    gene: "MLH1",
    variant: `genomics:clinvarVariationId "90021"`,
    report: "genomics:LikelyPathogenic",
    verdict: "agrees",
  },
  {
    gene: "MSH2",
    variant: `genomics:hgvsCDot "NM_000251.3:c.300A>G"`,
    report: "genomics:VUS",
    verdict: "differs",
  },
  {
    gene: "MSH6",
    variant: `genomics:clinvarVariationId "90023"`,
    report: "genomics:Pathogenic",
    verdict: "labs disagree",
  },
  {
    gene: "PMS2",
    variant: `genomics:hgvsCDot "NM_000535.7:c.400A>G"`,
    report: "genomics:Benign",
    verdict: "as ClinVar writes it",
  },
  { gene: "EPCAM", variant: `genomics:clinvarVariationId "90025"` },
  {
    gene: "BRCA1",
    variant: `genomics:hgvsCDot "NM_007294.4:c.500A>G"`,
    report: "genomics:Pathogenic",
  },
];

const PATHOGENIC = "genomics:Pathogenic , genomics:LikelyPathogenic";

/** The rows of the agreement cases, 90021 saying what is given. */
const agreementRows = (says90021: string): string =>
  [
    row("90021", [], `rec:clinvarClassification ${says90021}`),
    row(
      "90022",
      ["NM_000251.3:c.300A>G"],
      `rec:clinvarClassification genomics:Pathogenic , genomics:LikelyPathogenic`,
    ),
    row("90023", [], `rec:clinvarClassification rec:ClinVarConflicting`),
    row(
      "90024",
      ["NM_000535.7:c.400A>G"],
      `rec:clinvarClassification rec:ClinVarDrugResponse`,
    ),
    row("90025", [], `rec:clinvarClassification genomics:Benign`),
    row(
      "90026",
      ["NM_007294.4:c.500A>G"],
      `rec:clinvarClassification genomics:Pathogenic`,
    ),
  ].join("\n");

function entry(cases: readonly Case[], subject: string, owner: string): string {
  const draft = (position: number, kind: string, content: string): string =>
    `<urn:cascade:output-${position}> a ${kind} .
<urn:cascade:output-${position}-version> prov:specializationOf <urn:cascade:output-${position}> ;
  ${content} ; rec:patient <${subject}> .`;
  const records = cases.flatMap(({ gene, variant, report }, index) => [
    draft(
      2 * index,
      "genomics:Variant",
      `genomics:geneSymbol "${gene}" ; ${variant}`,
    ),
    draft(
      2 * index + 1,
      "genomics:VariantInterpretation",
      `genomics:variantInterpreted <urn:cascade:output-${2 * index}> ; ${report === undefined ? "" : `genomics:acmgClassification ${report} ; `}genomics:interpretedDate "2024-03-21"^^xsd:date`,
    ),
  ]);
  return `@prefix jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#> .
${TURTLE}
<urn:cascade:this-entry> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${owner}> ; prov:hadRole jdg:patient ] .
${records.join("\n")}`;
}

/** Every file a pod folder holds, by its path under it. */
async function filesOf(folder: string): Promise<string[]> {
  return (await readdir(folder, { recursive: true })).sort();
}

/** The gene of the variant each report is of, with the report's verdict: what the cases above name. */
async function verdictsByGene(pod: Pod): Promise<Record<string, string>> {
  const variants = await pod.ask("pod/My genetic variants");
  const reports = await pod.ask("pod/What each report says of a variant");
  const geneOf = (report?: string): string => {
    const variant = reports.find((each) => each.report === report)?.variant;
    return variants.find((each) => each.variant === variant)?.gene ?? "";
  };
  return Object.fromEntries(
    (await pod.agreement()).map(({ report, verdict }) => [
      geneOf(report),
      verdict ?? "",
    ]),
  );
}

test("a report agrees with ClinVar when its value is among the row's, differs when the row holds another of the five, and is left alone where the row says something else, the variant has two rows or the report has no value; the verdicts write nothing, a newer version of the series is a new key, and a kept pod reads them without the engine", async () => {
  const first = await withClassifications(NOTHING, A, [
    { rows: agreementRows(PATHOGENIC), genes: LYNCH },
  ]);
  // The same expression on a row of a second series, so that its variant finds two rows.
  const held = await withClassifications(first.served, B, [
    {
      rows: row(
        "80026",
        ["NM_007294.4:c.500A>G"],
        `rec:clinvarClassification genomics:Benign`,
      ),
    },
  ]);
  const app = await appOver(held.served);
  const folder = join(scratch, "martin");
  const withTables = (tables: Tables): Parts => ({
    ...parts,
    tables,
    answers: { runtime: "test", at: answersBeside },
  });
  const pod = await openPodWith(withTables(app), folder);
  try {
    const entered = await pod.enter(entry(CASES, pod.subject, pod.owner));
    assert.equal(entered.refused, undefined, entered.refused);
    const written = await filesOf(folder);
    const expected = Object.fromEntries(
      CASES.flatMap(({ gene, verdict }) =>
        verdict === undefined ? [] : [[gene, verdict]],
      ),
    );
    assert.deepEqual(await verdictsByGene(pod), expected);
    assert.deepEqual(await filesOf(folder), written);

    const files = new FolderFiles(folder);
    const published = new Map<string, Uint8Array>();
    for (const path of await files.list("")) {
      const bytes = await files.read(path);
      if (bytes !== undefined) published.set(path, bytes);
    }
    const answers = new MemoryFiles("urn:test:answers/");
    for (const [path, bytes] of await publishedAnswers(
      withTables(app),
      "martin",
      published,
      "published",
    ))
      await answers.write(path, bytes);
    const { vocabulary, build, lens, layout } = parts;
    const read = await keptPod(
      {
        vocabulary,
        build,
        lens,
        tables: app,
        layout: Layout.of(
          layout.turtle,
          JSON.parse(JSON.stringify(layout.placements)) as Placed[],
        ),
      },
      files,
      new Answers(answers, "published"),
    );
    assert.deepEqual(
      (await read?.agreement())?.map(({ verdict }) => verdict).sort(),
      Object.values(expected).sort(),
    );
  } finally {
    await pod.close();
  }

  // The series' next version reclassifies 90021; the pod, unchanged, is a new key.
  const next = await withClassifications(NOTHING, A, [
    { rows: agreementRows(PATHOGENIC), genes: LYNCH },
    { rows: agreementRows("genomics:VUS"), genes: LYNCH },
  ]);
  const later = await openPodWith(
    withTables(await appOver(next.served)),
    folder,
    { adopt: false },
  );
  try {
    assert.equal((await verdictsByGene(later)).MLH1, "differs");
  } finally {
    await later.close();
  }
});
