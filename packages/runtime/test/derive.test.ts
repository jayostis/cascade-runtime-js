import assert from "node:assert/strict";
import { test } from "node:test";
import { Derivations } from "../src/derive.js";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { iri, literal, type Triple, written } from "../src/rdf.js";
import { Union } from "../src/store.js";
import { vocabulary } from "./vocabulary.js";

const P = "urn:test:p";
const triple = (subject: string, object: string): Triple => [
  iri(subject),
  iri(P),
  literal(object),
];
const rows = (triples: readonly Triple[]): string[] =>
  triples.map((t) => t.map(written).join(" "));
const construct = (...objects: string[]): string =>
  `CONSTRUCT { ${objects.map((o) => `<urn:test:a> <${P}> "${o}" .`).join(" ")} } WHERE {}`;
const NEVER = `CONSTRUCT { ?s <urn:test:never> ?o } WHERE { ?s <urn:test:none> ?o }`;

/** A store whose CONSTRUCT answers every triple twice, as a store need not deduplicate. */
class Repeating extends OxigraphStore {
  override async construct(
    query: string,
    union: ReadonlySet<string>,
  ): Promise<Triple[]> {
    const triples = await super.construct(query, union);
    return [...triples, ...triples];
  }
}

async function derivedBy(
  derivations: string[],
  asserted: Triple[],
  store: OxigraphStore = new OxigraphStore(),
): Promise<string[][]> {
  const vocabulary = new MemoryFiles("urn:test:vocabulary/");
  const enc = new TextEncoder();
  const graph = derivations.map((_, at) => ({
    "@id": `queries/derivations/${at}.rq`,
    position: at,
  }));
  await vocabulary.write(
    "ro-crate-metadata.json",
    enc.encode(
      JSON.stringify({
        "@graph": [...graph, { "@id": "queries/lenses/l.rq", position: 99 }],
      }),
    ),
  );
  for (const [at, query] of derivations.entries())
    await vocabulary.write(`queries/derivations/${at}.rq`, enc.encode(query));
  await vocabulary.write("queries/lenses/l.rq", enc.encode(NEVER));
  const union = new Union(store);
  await union.add(asserted, "urn:test:asserted");
  const steps = await (await Derivations.of(vocabulary)).derive(union, "l");
  return steps.slice(0, derivations.length).map((s) => rows(s.added));
}

test("a triple both asserted and constructed is not derived again", async () => {
  assert.deepEqual(
    await derivedBy([construct("1", "2")], [triple("urn:test:a", "1")]),
    [rows([triple("urn:test:a", "2")])],
  );
});

test("a triple a CONSTRUCT answers twice is derived once", async () => {
  assert.deepEqual(await derivedBy([construct("1")], [], new Repeating()), [
    rows([triple("urn:test:a", "1")]),
  ]);
});

test("a triple an earlier derivation added is not derived again", async () => {
  assert.deepEqual(await derivedBy([construct("1"), construct("1", "2")], []), [
    rows([triple("urn:test:a", "1")]),
    rows([triple("urn:test:a", "2")]),
  ]);
});

const EXPOSURE = "queries/derivations/medication-exposure-periods.rq";

/** Prescriptions each alone in its entry, written on a day, a month or a year, with a supply in a UCUM unit of time. */
function prescriptions(): string {
  const supplies: readonly [string, string, string, string?][] = [
    ['"2025-01-15"^^xsd:date', "90", "d", "3"],
    ['"2025-06-10T09:30:00-04:00"^^xsd:dateTime', "4", "wk", "0"],
    ['"2024-01-31"^^xsd:date', "3", "mo", "1"],
    ['"2025-04"^^xsd:gYearMonth', "60", "d"],
    ['"2025-08-01"^^xsd:date', "12", "h"],
    ['"2024-03-01"^^xsd:date', "1", "a"],
    ['"2024"^^xsd:gYear', "90", "d"],
  ];
  return [
    "@prefix : <urn:test:> . @prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .",
    "@prefix prov: <http://www.w3.org/ns/prov#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    ":subject a cascade:Subject .",
    ...supplies.map(
      ([written, value, unit, repeats], at) =>
        `:m${at} a cascade:PrescribedOrReportedMedication .
         :m${at}v prov:specializationOf :m${at} ; cascade:patient :subject ; cascade:drugName "${at}" ;
           cascade:prescribedOrReported "prescribed" ; cascade:workflowStatus "active" ;
           cascade:prescriptionWrittenDate ${written} ; cascade:expectedSupplyDuration <urn:test:m${at}v#expected-supply-duration>
           ${repeats === undefined ? "" : `; cascade:numberOfRepeatsAllowed "${repeats}"^^xsd:nonNegativeInteger`} .
         <urn:test:m${at}v#expected-supply-duration> cascade:decimalValue "${value}"^^xsd:decimal ;
           cascade:writtenValue "${value}" ; cascade:ucumUnit "${unit}" .
         :m${at}r a cascade:Revision ; cascade:revisionOf :m${at} ; cascade:version :m${at}v ;
           prov:generatedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime ; cascade:observedAsOf "2026-01-01T00:00:00Z"^^xsd:dateTime .`,
    ),
  ].join("\n");
}

test("a prescription's exposure ends at its start plus its supply times one plus its repeats, less a day, as CumulativeMedicationDuration ends it", async () => {
  const union = new Union(new OxigraphStore());
  await union.loadTurtle(prescriptions(), "urn:test:pod");
  await (
    await Derivations.of(await vocabulary())
  ).derive(union, "everyday", undefined, EXPOSURE);
  const { rows } =
    await union.select(`PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
    PREFIX pav: <http://purl.org/pav/>
    SELECT ?medication ?start ?end ?ongoing WHERE {
      ?record pav:hasCurrentVersion/cascade:drugName ?medication .
      OPTIONAL { ?record cascade:medicationExposureStart ?start }
      OPTIONAL { ?record cascade:medicationExposureEnd ?end }
      OPTIONAL { ?record cascade:medicationExposureOngoing ?ongoing }
    }`);
  const period = (row: (typeof rows)[number]): string =>
    ["medication", "start", "end", "ongoing"]
      .map((name) => row.get(name)?.value ?? "-")
      .join(" ");
  assert.deepEqual(rows.map(period).sort(), [
    "0 2025-01-15 2026-01-09 -",
    "1 2025-06-10 2025-07-07 -",
    "2 2024-01-31 2024-07-30 -",
    "3 2025-04-30 2025-05-30 -",
    "4 2025-08-01 2025-08-01 -",
    "5 2024-03-01 2025-02-28 -",
    "6 - - -",
  ]);
});
