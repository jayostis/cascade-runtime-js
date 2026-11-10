import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CorePod,
  type IdsAndTime,
  MemoryFiles,
  type Performed,
  readEveryRecord,
} from "@cascade-runtime/runtime";
import { resolved } from "../src/node/resolved.js";

const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const ADDRESS = "https://pod.example/";
const SUBJECT = "urn:uuid:5b0c6a3e-2f41-4d8b-9e07-c1a4f8d26b93";
const OWNER = `${ADDRESS}profile/card.ttl#me`;
/** Allergen codes the records draw from, few enough that acts share them. */
const CODES = [
  "10180",
  "1191",
  "7980",
  "2670",
  "5640",
  "723",
  "8745",
  "2193",
  "4053",
  "6754",
].map((code) => `https://ns.cascadeprotocol.org/codes/rxnorm/${code}`);

const PAIRED = "https://ns.cascadeprotocol.org/codes/rxnorm/36567";
const LONE = "https://ns.cascadeprotocol.org/codes/rxnorm/3443";

/** A seeded generator, so the pod is the same on every run (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** IDs from a counter and a time set by hand, copied with a fork so two forks mint alike. */
class CountedTime implements IdsAndTime {
  constructor(
    public count = 0,
    public when = "2026-01-01T08:00:00Z",
  ) {}

  newId(): string {
    const hex = (this.count++).toString(16).padStart(12, "0");
    return `urn:uuid:00000000-0000-4000-8000-${hex}`;
  }

  now(): string {
    return this.when;
  }

  copy(): CountedTime {
    return new CountedTime(this.count, this.when);
  }
}

function entry(
  activity: string,
  outputs: readonly string[],
): { bytes: Uint8Array; base: string; name: string } {
  const text = `@prefix cascade: <${CASCADE}> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${activity}> a prov:Activity ; rdfs:label "entered in the Cascade app" ;
  prov:qualifiedAssociation [ prov:agent <${OWNER}> ; prov:hadRole cascade:PatientRole ] .
${outputs.join("\n")}
`;
  return {
    bytes: new TextEncoder().encode(text),
    base: ADDRESS,
    name: `${activity}.ttl`,
  };
}

function allergy(index: number, code: string): string {
  return `<urn:cascade:output-${index}> a cascade:AllergyOrIntolerance .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  cascade:allergen "Allergen ${code.slice(-4)}" ; cascade:allergenCode <${code}> ; cascade:patient <${SUBJECT}> .`;
}

function potassium(index: number, value: string): string {
  return `<urn:cascade:output-${index}> a cascade:LaboratoryTestResult .
<urn:cascade:output-${index}-version> prov:specializationOf <urn:cascade:output-${index}> ;
  cascade:testName "Potassium" ; cascade:testCode <http://loinc.org/rdf/2823-3> ;
  cascade:resultValueKind cascade:QuantityResultValue ;
  cascade:resultQuantity <urn:cascade:output-${index}-version#value> ;
  cascade:resultClinicallyRelevantTime "2025-03-27T12:00:00Z"^^xsd:dateTime ;
  cascade:workflowStatus "final" ; cascade:patient <${SUBJECT}> .
<urn:cascade:output-${index}-version#value> cascade:decimalValue "${value}"^^xsd:decimal ;
  cascade:writtenValue "${value}" ; cascade:ucumUnit "mmol/L" .`;
}

test("a run that takes records writes what it writes reading every record, over a seeded pod of 200 allergies across eight acts and a sync, chained Sames one of which a Different splits, a reconnect and a finding", async () => {
  const parts = await resolved();
  const references = await parts.tables.references();
  const random = seeded(522);
  const time = new CountedTime();
  const options = {
    pod: new MemoryFiles(ADDRESS),
    address: ADDRESS,
    subject: SUBJECT,
    title: "seeded",
    vocabulary: parts.vocabulary,
    layout: parts.layout,
    newStore: parts.newStore,
    time,
    importers: parts.importers,
    runtime: parts.performer,
    references: () => Promise.resolve(references),
  };
  const pod = new CorePod(options);
  assert.equal((await pod.create()).refused, undefined);

  const compared: string[] = [];
  /** The run on the activity, scoped and reading every record, from one pod; then the run itself. */
  const match = async (on: CorePod, clock: CountedTime, activity: string) => {
    const outcome = async (every: boolean) => {
      const fork = await on.fork(clock.copy());
      readEveryRecord(every);
      let performed: Performed;
      try {
        performed = await fork.match(activity);
      } finally {
        readEveryRecord(false);
      }
      return {
        ...performed,
        files: await Promise.all(
          performed.wrote.map(async (path) => [
            path,
            new TextDecoder().decode(await fork.files.read(path)),
          ]),
        ),
      };
    };
    const scoped = await outcome(false);
    assert.deepEqual(scoped, await outcome(true), activity);
    compared.push(activity);
    const performed = await on.match(activity);
    assert.deepEqual(performed.wrote, scoped.wrote);
    return performed;
  };
  const enter = async (
    on: CorePod,
    clock: CountedTime,
    when: string,
    outputs: readonly string[],
  ) => {
    clock.when = when;
    const entered = await on.enter(entry(clock.newId(), outputs));
    assert.equal(entered.refused, undefined);
    return entered.activity as string;
  };
  const allergies = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      allergy(index, CODES[Math.floor(random() * CODES.length)] as string),
    );

  const judge = async (
    verdict: string,
    members: readonly string[],
    when: string,
  ) => {
    time.when = when;
    const judged = await pod.judge({
      name: "judgment.ttl",
      base: ADDRESS,
      bytes: new TextEncoder().encode(`@prefix cascade: <${CASCADE}> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${time.newId()}> a cascade:Judgment ; cascade:verdict cascade:${verdict} ;
  prov:hadMember ${members.map((member) => `<${member}>`).join(" , ")} ;
  prov:wasAttributedTo <${OWNER}> ; prov:generatedAtTime "${when}"^^xsd:dateTime .
<${OWNER}> a prov:Person .
`),
    });
    assert.equal(judged.refused, undefined);
  };
  const coded = async (code: string) =>
    (
      await pod.select(`SELECT ?record WHERE { ?record <http://purl.org/pav/hasCurrentVersion> ?version .
        ?version <${CASCADE}allergenCode> <${code}> }`)
    ).rows
      .map((row) => row.get("record")?.value as string)
      .sort();

  // A second writer, made now, whose two acts arrive between the first's.
  const writer = await pod.newWriter();
  const writerActs: string[] = [];
  for (let act = 0; act < 8; act++) {
    const day = String(act * 2 + 2).padStart(2, "0");
    const activity = await enter(
      pod,
      time,
      `2026-01-${day}T09:00:00Z`,
      allergies(22),
    );
    await match(pod, time, activity);
    // Two records of one code no run takes, so no Same joins them, arrive before the second writer's record of it.
    if (act === 0)
      await enter(pod, time, "2026-01-03T09:00:00Z", [
        allergy(0, PAIRED),
        allergy(1, PAIRED),
      ]);
    if (act === 2 || act === 5) {
      const later = String(act * 2 + 3).padStart(2, "0");
      writerActs.push(
        await enter(writer, time, `2026-01-${later}T09:00:00Z`, [
          ...allergies(12),
          ...(act === 2 ? [allergy(12, PAIRED)] : []),
        ]),
      );
    }
    if (act === 3) {
      const { rows } = await pod.select(`SELECT ?same ?member WHERE {
        ?same <${CASCADE}verdict> <${CASCADE}Same> ; <http://www.w3.org/ns/prov#hadMember> ?member }`);
      const members = new Map<string, string[]>();
      for (const row of rows) {
        const same = row.get("same")?.value as string;
        members.set(same, [
          ...(members.get(same) ?? []),
          row.get("member")?.value as string,
        ]);
      }
      // The two ends of a chain of Sames: records no one Same holds together, which the chain makes one entry.
      const chained = new Map<string, Set<string>>();
      for (const found of members.values()) {
        const joined = new Set(
          found.flatMap((one) => [...(chained.get(one) ?? [one])]),
        );
        for (const one of joined) chained.set(one, joined);
      }
      const chain = [...new Set(chained.values())].find(
        (found) => found.size >= 3,
      );
      assert.ok(chain, "a chain of Sames over three records to split");
      const [first, ...rest] = [...chain] as [string, ...string[]];
      const apart = rest.find(
        (other) =>
          ![...members.values()].some(
            (found) => found.includes(first) && found.includes(other),
          ),
      );
      assert.ok(apart, "two records of the chain no one Same holds");
      const star = [first, apart];
      await judge("Different", star, "2026-01-08T12:00:00Z");
    }
  }
  // A record arriving after the second writer's, which the person judges the same as each of the two: Sames the sync's
  // run skips, as one member arrived after the record it takes, but only if it reads that member.
  const lone = await enter(pod, time, "2026-01-18T09:00:00Z", [
    allergy(0, LONE),
  ]);
  await match(pod, time, lone);
  const [x] = await coded(LONE);
  const [p1, p2] = await coded(PAIRED);
  assert.ok(x !== undefined && p1 !== undefined && p2 !== undefined);
  await judge("Same", [p1, x], "2026-01-19T09:00:00Z");
  await judge("Same", [x, p2], "2026-01-19T10:00:00Z");
  time.when = "2026-01-20T09:00:00Z";
  const synced = await pod.receive(writer.files);
  assert.equal(synced.refused, undefined);
  await match(pod, time, synced.activity as string);

  const lab = await enter(pod, time, "2026-01-21T09:00:00Z", [
    potassium(0, "4.1"),
    potassium(1, "5.3"),
  ]);
  await match(pod, time, lab);

  for (const when of ["2026-01-22T09:00:00Z", "2026-01-23T09:00:00Z"]) {
    time.when = when;
    const connected = await pod.connect(
      parts.vocabulary,
      "runtime/scripted-input/finn/connects/hospital/",
    );
    assert.equal(connected.refused, undefined);
    await match(pod, time, connected.activity as string);
  }

  const counted = async (query: string) =>
    (await pod.select(`PREFIX cascade: <${CASCADE}> ${query}`)).rows.length;
  assert.ok(
    await counted("SELECT DISTINCT ?f WHERE { ?f a cascade:FindingForReview }"),
  );
  assert.ok(
    await counted(
      "SELECT DISTINCT ?d WHERE { ?d cascade:verdict cascade:Different }",
    ),
  );
  assert.ok(
    (await counted(
      "SELECT DISTINCT ?s WHERE { ?s cascade:verdict cascade:Same }",
    )) > 20,
  );
  assert.equal(compared.length, 13);
  assert.equal(writerActs.length, 2);
});
