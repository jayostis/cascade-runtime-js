import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  canonical,
  codeIri,
  fileStem,
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
import { answersToPublish } from "../src/node/published.js";
import { answersBeside, partsOf } from "../src/node/resolved.js";
import { keptPod, openPodWith, type Parts, type Pod } from "../src/pod.js";
import {
  Tables,
  type VariantAsked,
  versionName,
  writeStarterCopies,
} from "../src/tables.js";

const FEED = "https://tables.example/feed.ttl";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const CLASSIFICATIONS = `${CASCADE}VariantClassifications`;
const LYNCH = ["MLH1", "MSH2", "MSH6", "PMS2", "EPCAM"];
const TURTLE = `@prefix cascade: <${CASCADE}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix pav: <http://purl.org/pav/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix spdx: <http://spdx.org/rdf/terms#> .
`;
const HGVS = "https://ns.cascadeprotocol.org/codes/hgvs/";
const CLINVAR = "https://identifiers.org/clinvar:";
const A = "urn:uuid:0a1e2c3d-4b5a-4c6d-8e7f-a1b2c3d4e5f6";
const B = "urn:uuid:0b1e2c3d-4b5a-4c6d-8e7f-a1b2c3d4e5f6";
const CREDIT =
  "ClinVar, NCBI. Not intended for direct diagnostic use or medical decision-making without review by a genetics professional.";

/** A row of a variant classifications table: the variation, the expressions it is found by, and what it says. */
const row = (id: string, expressions: readonly string[], says: string) =>
  `<${CLINVAR}${id}> ${expressions.map((each) => `cascade:hgvsExpression <${HGVS}${encodeURIComponent(each).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}> ;`).join(" ")} ${says} .`;

const LYNCH_ROWS = [
  row(
    "90011",
    ["NM_000249.3:c.2042C>T", "NM_000249.4:c.2042C>T"],
    `cascade:clinvarClassification cascade:Pathogenic , cascade:LikelyPathogenic ;
      cascade:clinvarReviewStatus cascade:ClinVarMultipleSubmittersNoConflicts ;
      cascade:lastEvaluated "2024-12-11"^^xsd:date ; cascade:contributingSubmitterCount 5`,
  ),
  row(
    "90012",
    ["NM_000251.3:c.100A>G"],
    `cascade:clinvarClassification cascade:ClinVarConflicting ; cascade:submitterCount 3`,
  ),
  row(
    "90013",
    ["NM_000251.3:c.200A>G"],
    `cascade:clinvarClassification cascade:Benign`,
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
  let turtle = `${TURTLE}<${series}> a cascade:ReferenceSeries ; rdfs:label "ClinVar ${series.slice(9, 13)}" ;
  cascade:tableKind cascade:VariantClassifications ; dct:bibliographicCitation "${CREDIT}" .
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
  ${genes.map((gene) => `cascade:coversGene "${gene}" ;`).join(" ")}
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
        `cascade:clinvarClassification cascade:UncertainSignificance`,
      ),
    },
  ]);
  return {
    served: second.served,
    a: first.versions[0]!,
    b: second.versions[0]!,
  };
}

let twoSeriesMade: Promise<{ app: Tables; a: string; b: string }> | undefined;

/** An app over two series, made once and then only read. */
function twoSeriesApp(): Promise<{ app: Tables; a: string; b: string }> {
  twoSeriesMade ??= (async () => {
    const { served, a, b } = await twoSeries();
    return { app: await appOver(served), a, b };
  })();
  return twoSeriesMade;
}

const asked = (
  variant: Partial<VariantAsked> & { gene?: string },
): VariantAsked => ({ hgvs: [], variations: [], ...variant });

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
    variant: `cascade:clinvarVariationId "90021"`,
    report: "cascade:LikelyPathogenic",
    verdict: "agrees",
  },
  {
    gene: "MSH2",
    variant: `cascade:hgvsCodingDnaExpression "NM_000251.3:c.300A>G"`,
    report: "cascade:UncertainSignificance",
    verdict: "differs",
  },
  {
    gene: "BRCA1",
    variant: `cascade:hgvsCodingDnaExpression "NM_007294.4:c.500A>G"`,
    report: "cascade:Pathogenic",
  },
];

const PATHOGENIC = "cascade:Pathogenic , cascade:LikelyPathogenic";

/** The rows of the agreement cases, 90021 saying what is given. */
const agreementRows = (says90021: string): string =>
  [
    row("90021", [], `cascade:clinvarClassification ${says90021}`),
    row(
      "90022",
      ["NM_000251.3:c.300A>G"],
      `cascade:clinvarClassification cascade:Pathogenic , cascade:LikelyPathogenic`,
    ),
    row(
      "90026",
      ["NM_007294.4:c.500A>G"],
      `cascade:clinvarClassification cascade:Pathogenic`,
    ),
  ].join("\n");

function entry(cases: readonly Case[], subject: string, owner: string): string {
  const draft = (position: number, kind: string, content: string): string =>
    `<urn:cascade:output-${position}> a ${kind} .
<urn:cascade:output-${position}-version> prov:specializationOf <urn:cascade:output-${position}> ;
  ${content} ; cascade:patient <${subject}> .`;
  const records = cases.flatMap(({ gene, variant, report }, index) => [
    draft(
      2 * index,
      "cascade:GeneticVariantFinding",
      `cascade:geneSymbol "${gene}" ; ${variant}`,
    ),
    draft(
      2 * index + 1,
      "cascade:VariantInterpretation",
      `cascade:variantInterpreted <urn:cascade:output-${2 * index}> ; ${report === undefined ? "" : `cascade:acmgClassification ${report} ; `}cascade:interpretedDate "2024-03-21"^^xsd:date`,
    ),
  ]);
  return `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
${TURTLE}
<urn:uuid:${crypto.randomUUID()}> a prov:Activity ;
  prov:qualifiedAssociation [ prov:agent <${owner}> ; prov:hadRole cascade:PatientRole ] .
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

/** The parts a pod is opened with over the tables, keeping its answers beside it. */
const withTables = (tables: Tables): Parts => ({
  ...parts,
  tables,
  answers: { runtime: "test", at: answersBeside },
});

interface Martin {
  readonly folder: string;
  readonly app: Tables;
  /** The verdict of each report that has one, by the gene of its variant. */
  readonly verdicts: Record<string, string>;
  /** The files of the folder before the verdicts were asked, and after. */
  readonly written: { readonly before: string[]; readonly after: string[] };
}

let martinMade: Promise<Martin> | undefined;

/**
 * A pod of three variants, each with a report, over tables of two series: MLH1's variant is on a row by its ID, MSH2's
 * by an expression, and BRCA1's expression is on a row of each series. Entered, its verdicts read once, and closed.
 */
function martinPod(): Promise<Martin> {
  martinMade ??= (async () => {
    const first = await withClassifications(NOTHING, A, [
      { rows: agreementRows(PATHOGENIC), genes: LYNCH },
    ]);
    // The same expression on a row of a second series, so that its variant finds two rows.
    const held = await withClassifications(first.served, B, [
      {
        rows: row(
          "80026",
          ["NM_007294.4:c.500A>G"],
          `cascade:clinvarClassification cascade:Benign`,
        ),
      },
    ]);
    const app = await appOver(held.served);
    const folder = join(scratch, "martin");
    const pod = await openPodWith(withTables(app), folder);
    try {
      const entered = await pod.enter(entry(CASES, pod.subject, pod.owner));
      assert.equal(entered.refused, undefined, entered.refused);
      const filesBefore = await filesOf(folder);
      const verdicts = await verdictsByGene(pod);
      return {
        folder,
        app,
        verdicts,
        written: { before: filesBefore, after: await filesOf(folder) },
      };
    } finally {
      await pod.close();
    }
  })();
  return martinMade;
}

/**
 * ClinVar is a public archive of how laboratories classify genetic variants, which an app holds as reference tables.
 * `variantClassification` returns what the app's copy says of one variant, and `pod.agreement()` returns, for each
 * laboratory's report of a variant in a pod, whether the report agrees with it.
 * @rule runtime/matcher.feature M17
 */
describe("Reading what ClinVar says of a variant · tables.variantClassification(), pod.agreement()", () => {
  describe("tables.variantClassification(variant)", () => {
    let app: Tables;
    let a: string;
    let b: string;

    before(async () => {
      ({ app, a, b } = await twoSeriesApp());
    });

    const says = (variant: Partial<VariantAsked> & { gene?: string }) =>
      app.variantClassification(asked(variant));
    const found = async (
      variant: Partial<VariantAsked> & { gene?: string },
    ) => {
      const answered = await says(variant);
      return answered.found === "rows"
        ? [answered.version, answered.rows.map(({ variation }) => variation)]
        : answered.found;
    };

    it("finds the variant's row by its ClinVar ID", async () => {
      assert.deepEqual(await found({ gene: "MLH1", variations: ["90011"] }), [
        a,
        [`${CLINVAR}90011`],
      ]);
    });

    it("finds the row by a coding expression when the variant has no ID", async () => {
      assert.deepEqual(
        await found({ gene: "MLH1", hgvs: ["NM_000249.3:c.2042C>T"] }),
        [a, [`${CLINVAR}90011`]],
      );
    });

    it("reads the ID alone when the variant has both, returning `not found` for an ID on no row though its expression is on one", async () => {
      assert.equal(
        await found({
          gene: "MLH1",
          variations: ["12345"],
          hgvs: ["NM_000249.4:c.2042C>T"],
        }),
        "not found",
      );
    });

    it("returns `not found` for an expression on no row, and for two expressions on two rows", async () => {
      assert.equal(
        await found({ gene: "MLH1", hgvs: ["NM_000249.9:c.1A>G"] }),
        "not found",
        "an expression on no row",
      );
      assert.equal(
        await found({
          gene: "MLH1",
          hgvs: ["NM_000251.3:c.100A>G", "NM_000251.3:c.200A>G"],
        }),
        "not found",
        "two expressions on two rows",
      );
    });

    it("reads every series when the variant names no gene", async () => {
      assert.deepEqual(await found({ variations: ["90011"] }), [
        a,
        [`${CLINVAR}90011`],
      ]);
    });

    it("returns `not covered`, with the genes the first series covers, for a variant of another gene that no series holds", async () => {
      assert.deepEqual(
        await says({ gene: "BRCA2", hgvs: ["NM_000059.9:c.1A>G"] }),
        {
          found: "not covered",
          series: A,
          version: a,
          genes: ["EPCAM", "MLH1", "MSH2", "MSH6", "PMS2"],
        },
      );
    });

    it("returns the row from a series that states no genes, for a gene the first series does not cover", async () => {
      assert.deepEqual(
        await found({ gene: "BRCA2", hgvs: ["NM_000059.4:c.1114A>C"] }),
        [b, [`${CLINVAR}80001`]],
      );
    });

    it("returns the row's classifications by the vocabulary's labels, with its review status, when it was last evaluated and how many submitters contributed", async () => {
      const alone = await says({ variations: ["90011"] });
      assert.deepEqual(alone.found === "rows" ? alone.rows : [], [
        {
          variation: `${CLINVAR}90011`,
          classification: [
            { iri: `${CASCADE}LikelyPathogenic`, label: "Likely pathogenic" },
            { iri: `${CASCADE}Pathogenic`, label: "Pathogenic" },
          ],
          reviewStatus: {
            iri: `${CASCADE}ClinVarMultipleSubmittersNoConflicts`,
            label: "criteria provided, multiple submitters, no conflicts",
          },
          lastEvaluated: "2024-12-11",
          contributingSubmitters: 5,
        },
      ]);
    });

    it("returns `no series` when the app holds no variant classifications series", async () => {
      assert.deepEqual(
        await (
          await appOver(NOTHING)
        ).variantClassification(asked({ gene: "MLH1" })),
        { found: "no series" },
      );
    });
  });

  describe("given an app that read the feed with `tables.check()`, with no starter copies", () => {
    it("returns `not covered`, with the genes the version states, for a variant of another gene", async () => {
      const { served, a } = await twoSeries();
      const app = new Tables({
        files: new MemoryFiles("urn:test:app/"),
        feeds: [FEED],
        vocabulary: parts.vocabulary,
        newStore: parts.newStore,
        fetch: fetchOf(served),
        preference: { [CLASSIFICATIONS]: [A, B] },
      });
      await app.check();
      assert.deepEqual(
        await app.variantClassification(
          asked({ gene: "BRCA2", hgvs: ["NM_000059.9:c.1A>G"] }),
        ),
        {
          found: "not covered",
          series: A,
          version: a,
          genes: ["EPCAM", "MLH1", "MSH2", "MSH6", "PMS2"],
        },
      );
    });
  });

  describe("given an index by code, kept beside a version, that was built for other properties", () => {
    let files: MemoryFiles;
    let path: string;
    let again: Tables;
    let answered: Awaited<ReturnType<Tables["variantClassification"]>>;
    let version: string;
    let a: string;

    before(async () => {
      const series = await twoSeries();
      a = series.a;
      files = new MemoryFiles("urn:test:app/");
      await (await appOver(series.served, files)).start();
      const found = (await files.list("")).find((each) =>
        each.endsWith(`${fileStem(a)}.codes.json`),
      );
      assert.ok(found);
      path = found;
      await files.write(
        path,
        new TextEncoder().encode('{"foundBy":[],"rows":{}}'),
      );
      again = await appOver(series.served, files);
      answered = await again.variantClassification(
        asked({ gene: "MLH1", variations: ["90013"] }),
      );
      version = (await again.facts(`${CLINVAR}90013`)).classifications[0]
        ?.version as string;
    });

    it("finds the variant's row all the same", () => {
      assert.equal(answered.found, "rows", "by the lookup");
      assert.equal(version, a, "by what the tables say of the variation");
    });

    it("keeps a new index beside the version", async () => {
      assert.ok(
        new TextDecoder()
          .decode(await files.read(path))
          .includes(
            codeIri(
              "https://ns.cascadeprotocol.org/codes/hgvs/",
              "NM_000251.3:c.200A>G",
            ),
          ),
      );
    });
  });

  describe("tables.labels(concepts)", () => {
    it("returns the vocabulary's label for each concept it names, and nothing for any other", async () => {
      const { app } = await twoSeriesApp();
      assert.deepEqual(
        [
          ...(await app.labels([
            `${CASCADE}UncertainSignificance`,
            `${CASCADE}ClinVarConflicting`,
            "urn:test:unlabelled",
          ])),
        ],
        [
          [`${CASCADE}UncertainSignificance`, "Uncertain significance"],
          [
            `${CASCADE}ClinVarConflicting`,
            "Conflicting classifications of pathogenicity",
          ],
        ],
      );
    });
  });

  describe("tables.facts(code)", () => {
    it("returns under `classifications` what the series' current version says of a variation, and nothing under `mappings`", async () => {
      const { app, a } = await twoSeriesApp();
      const facts = await app.facts(`${CLINVAR}90011`);
      assert.deepEqual(facts.mappings, []);
      assert.deepEqual(
        facts.classifications.map(
          ({ series, version, contributingSubmitters }) => [
            series,
            version,
            contributingSubmitters,
          ],
        ),
        [[A, a, 5]],
      );
    });

    it("returns no classification for a variation on no row", async () => {
      const { app } = await twoSeriesApp();
      assert.deepEqual((await app.facts(`${CLINVAR}1`)).classifications, []);
    });

    it("returns the variation's page at ClinVar, and no page for a coding expression", async () => {
      const { app } = await twoSeriesApp();
      assert.deepEqual((await app.facts(`${CLINVAR}90011`)).page, {
        href: "https://www.ncbi.nlm.nih.gov/clinvar/variation/90011/",
        system: "ClinVar",
      });
      assert.equal(
        (
          await app.facts(
            "https://ns.cascadeprotocol.org/codes/hgvs/NM_000249.3%3Ac.2042C%3ET",
          )
        ).page,
        undefined,
      );
    });
  });

  /** Which `verdict` a report gets is the vocabulary's `tests/fixtures/variant-classifications-agreement`. */
  describe("pod.agreement()", () => {
    let martin: Martin;

    before(async () => {
      martin = await martinPod();
    });

    it("returns `agrees` for a report whose value is among the row's, the row found by the variant's ClinVar ID", () => {
      assert.equal(martin.verdicts.MLH1, "agrees");
    });

    it("returns `differs` for a report whose value the row does not hold, the row found by a coding expression", () => {
      assert.equal(martin.verdicts.MSH2, "differs");
    });

    it("returns no `verdict` for a variant that finds a row in each of two series", () => {
      assert.ok(!("BRCA1" in martin.verdicts));
    });

    it("writes nothing to the pod", () => {
      assert.deepEqual(martin.written.after, martin.written.before);
    });
  });

  describe("given the pod's published answers", () => {
    it("returns each report's `verdict` without the query engine", async () => {
      const { folder, app, verdicts } = await martinPod();
      const files = new FolderFiles(folder);
      const published = new Map<string, Uint8Array>();
      for (const path of await files.list("")) {
        const bytes = await files.read(path);
        if (bytes !== undefined) published.set(path, bytes);
      }
      const answers = new MemoryFiles("urn:test:answers/");
      for (const [path, bytes] of await answersToPublish(
        withTables(app),
        published,
        { name: "martin", runtime: "published" },
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
        Object.values(verdicts).sort(),
      );
    });
  });

  describe("given a newer version of the series that classifies a variant otherwise", () => {
    it("returns `differs` for the report that agreed", async () => {
      const { folder } = await martinPod();
      // The series' next version reclassifies 90021; the pod, unchanged, is a new key.
      const next = await withClassifications(NOTHING, A, [
        { rows: agreementRows(PATHOGENIC), genes: LYNCH },
        { rows: agreementRows("cascade:UncertainSignificance"), genes: LYNCH },
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
  });
});
