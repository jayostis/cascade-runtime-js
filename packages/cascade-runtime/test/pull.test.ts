import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { loadHospital } from "@cascade-runtime/demo-hospital/node";
import { openPod, type Pod, type Pull, pullFiles } from "cascade-runtime";
import { pulled } from "./hospitals.js";

const PREFIXES = `PREFIX bridge: <https://ns.cascadeprotocol.org/bridge/v1-draft#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pav: <http://purl.org/pav/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rec: <https://ns.cascadeprotocol.org/records/v1-draft#>
PREFIX jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#>
`;
const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";

let north: Pull;
let south: Pull;
let pod: Pod;
let folder: string;

/** The `fullUrl` of the pull's one resource of the type whose code, or medication's code, is so. */
function coded(pulled: Pull, type: string, code: string): string {
  const found = pulled.bundle.entry.filter(({ resource }) => {
    const said = resource as {
      resourceType?: string;
      code?: { coding?: { code?: string }[] };
      medicationCodeableConcept?: { coding?: { code?: string }[] };
    };
    return (
      said.resourceType === type &&
      (said.code ?? said.medicationCodeableConcept)?.coding?.some(
        (coding) => coding.code === code,
      ) === true
    );
  });
  assert.equal(found.length, 1, `${pulled.source} has one ${type} ${code}`);
  return found[0]!.fullUrl;
}

/** A clock stopped at the time, whose milliseconds end in zeros, as a stored `xsd:dateTime` drops them. */
function stopped(time: string): { now: () => Date } {
  return { now: () => new Date(time) };
}

before(async () => {
  north = (
    await pulled(
      await loadHospital("cascade-north"),
      "pt-1001",
      stopped("2026-10-07T08:04:46.170Z"),
    )
  ).pull;
  south = (
    await pulled(
      await loadHospital("cascade-south"),
      "s-48213",
      stopped("2026-10-07T08:05:00.000Z"),
    )
  ).pull;
  pod = await openPod();
  folder = await mkdtemp(join(tmpdir(), "cascade-pull-"));
});

after(async () => {
  await pod.close();
  await rm(folder, { recursive: true, force: true });
});

test("patient A pulled from two hospitals is one subject in one pod, each record named under its hospital's base, a condition joined where its code and period agree", async () => {
  assert.deepEqual(
    [north.retrievedAt, south.retrievedAt],
    ["2026-10-07T08:04:46.17Z", "2026-10-07T08:05:00Z"],
  );
  const [looked] = await pod.look(pullFiles(north, "north"));
  assert.deepEqual(
    [looked?.name, looked?.server, looked?.received, looked?.claimed],
    [north.source, north.fhirBase, [north.retrievedAt], false],
  );

  for (const [pull, name] of [
    [north, "north"],
    [south, "south"],
  ] as const) {
    const imported = await pod.import(pullFiles(pull, name), {
      aboutSubject: true,
    });
    assert.equal(imported.refused, undefined, name);
  }

  const documents = await pod.ask({
    query: `${PREFIXES}SELECT ?server ?on ?patient ?author WHERE {
      ?document bridge:serverBaseUrl ?server ; pav:retrievedOn ?on ; bridge:authenticatedPatient ?patient ;
        prov:qualifiedAttribution [ prov:hadRole rec:author ; prov:agent/rdfs:label ?author ] .
    }`,
  });
  assert.deepEqual(
    documents
      .map(({ server, on, patient, author }) => [
        server,
        Date.parse(on ?? ""),
        patient,
        author,
      ])
      .sort(),
    [north, south]
      .map((pull) => [
        pull.fhirBase,
        Date.parse(pull.retrievedAt),
        `Patient/${pull.patient}`,
        pull.source,
      ])
      .sort(),
  );

  const named = (
    await pod.ask({
      query: `${PREFIXES}SELECT DISTINCT ?url WHERE { ?record rec:sourceUrl ?url }`,
    })
  ).map(({ url }) => url ?? "");
  for (const pull of [north, south]) {
    const urls = new Set(pull.bundle.entry.map(({ fullUrl }) => fullUrl));
    assert.ok(
      named.some((url) => urls.has(url)),
      `a record from ${pull.source}`,
    );
  }
  assert.ok(
    named.every((url) =>
      [north, south].some((pull) =>
        pull.bundle.entry.some(({ fullUrl }) => fullUrl === url),
      ),
    ),
  );

  const judgments = await pod.ask({
    query: `${PREFIXES}SELECT ?justification (GROUP_CONCAT(STR(?url); SEPARATOR=" ") AS ?urls) WHERE {
      ?judgment a jdg:Judgment ; jdg:justification ?justification ; prov:hadMember ?member .
      ?member rec:sourceUrl ?url .
    } GROUP BY ?judgment ?justification`,
  });
  const across = judgments
    .map(({ justification = "", urls = "" }) => ({
      justification,
      urls: urls.split(" ").sort(),
    }))
    .filter(
      ({ urls }) =>
        urls.every((url) => url.includes("/Condition/")) &&
        urls.some((url) => url.startsWith(`${north.fhirBase}/`)) &&
        urls.some((url) => url.startsWith(`${south.fhirBase}/`)),
    )
    .map(({ justification, urls }) => `${justification} ${urls.join(" ")}`)
    .sort();
  assert.deepEqual(
    across,
    [
      [
        `${JDG}SameCodeAndPeriod`,
        coded(north, "Condition", "59621000"),
        coded(south, "Condition", "59621000"),
      ],
    ]
      .map(
        ([justification, ...urls]) =>
          `${justification} ${urls.sort().join(" ")}`,
      )
      .sort(),
  );

  const [claimed] = await pod.look(pullFiles(north, "north"));
  assert.equal(claimed?.claimed, true);

  for (const [path, bytes] of pullFiles(north, "north")) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  const again = await pod.import(join(folder, "north"), { aboutSubject: true });
  assert.equal(again.refused, undefined);
  assert.deepEqual(again.wrote, []);
});
