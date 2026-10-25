import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { type Exported, type Pod } from "cascade-runtime";
import { resolved } from "../src/node/resolved.js";
import { openPodWith, type Parts } from "../src/pod.js";

const PREFIXES = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
PREFIX prov: <http://www.w3.org/ns/prov#>
`;
const TURTLE_PREFIXES = `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;
const FIRST = "https://fhir.example-hospital.example/r4";
const SECOND = "https://fhir.example-hospital.example/api/FHIR/R4";
const FINN = "runtime/scripted-input/finn/connects";
const PRIYA = "conformance/priya-natarajan/scripted-input/priya/downloads";

let kit: string;
let scratch: string;
let parts: Parts;

before(async () => {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  kit = (await localVocabulary(root)).files.folder;
  scratch = await mkdtemp(join(tmpdir(), "cascade-server-same-"));
  parts = await resolved();
});

after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function connectFiles(name: string): Promise<Exported> {
  const saved = new Map<string, Uint8Array>();
  for (const file of [
    "connect.json",
    "capability.json",
    "smart-configuration.json",
  ])
    saved.set(
      `${name}/${file}`,
      await readFile(join(kit, ...FINN.split("/"), name, file)),
    );
  return saved;
}

/** A pull from the server at `base` of an allergy for each id. */
function pullFiles(
  name: string,
  base: string,
  ids: readonly string[],
  at: string,
): Exported {
  const encoded = (value: object) =>
    new TextEncoder().encode(JSON.stringify(value));
  return new Map([
    [
      `${name}/pull.json`,
      encoded({
        fhirBase: base,
        patient: "p-1",
        source: "Example Hospital",
        retrievedAt: at,
      }),
    ],
    [
      `${name}/bundle.json`,
      encoded({
        resourceType: "Bundle",
        type: "collection",
        entry: ids.map((id) => ({
          resource: {
            resourceType: "AllergyIntolerance",
            id,
            meta: { versionId: "1", lastUpdated: "2026-06-01T00:00:00Z" },
            code: { text: `Allergen ${id}` },
            patient: { reference: "Patient/p-1" },
          },
        })),
      }),
    ],
  ]);
}

function judgment(
  pod: Pod,
  verdict: string,
  members: readonly string[],
): string {
  return `${TURTLE_PREFIXES}
<urn:cascade:this-judgment> a cascade:Judgment ; cascade:verdict cascade:${verdict} ;
  prov:hadMember ${members.map((member) => `<${member}>`).join(" , ")} ;
  prov:wasAttributedTo <${pod.owner}> ;
  prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] ;
  prov:generatedAtTime "2026-07-01T12:00:00Z"^^xsd:dateTime .
<${pod.owner}> a prov:Person .
`;
}

function retraction(pod: Pod, claim: string): string {
  return `${TURTLE_PREFIXES}
<urn:cascade:this-judgment> a prov:Activity ;
  prov:invalidated <${claim}> ;
  prov:wasAssociatedWith <${pod.owner}> ;
  prov:startedAtTime "2026-07-02T12:00:00Z"^^xsd:dateTime .
<${pod.owner}> a prov:Person .
`;
}

/** Every triple of every graph but those naming a blank node, each as a line, sorted. */
async function everything(pod: Pod): Promise<string[]> {
  const rows = await pod.ask({
    query:
      "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } FILTER (!isBlank(?s) && !isBlank(?o)) }",
  });
  return rows
    .map(({ g, s, p, o }) => [g, s, p, o].map(String).join(" "))
    .sort();
}

/** What a build of the whole pod holds, read from a copy of its folder opened afresh. */
async function builtWhole(folder: string, step: string): Promise<string[]> {
  const copy = join(scratch, `whole-${step}`);
  await cp(folder, copy, { recursive: true });
  const whole = await openPodWith(parts, copy);
  try {
    return await everything(whole);
  } finally {
    await whole.close();
  }
}

/** The records under each server judged one with a record of the same id under another. */
async function joinedIds(pod: Pod): Promise<string[]> {
  const rows = await pod.ask({
    query: `${PREFIXES}SELECT DISTINCT ?id WHERE {
      ?a cascade:currentlySame ?b ; cascade:sourceRecordId ?id ; cascade:sourceUrl ?aUrl .
      ?b cascade:sourceRecordId ?id ; cascade:sourceUrl ?bUrl .
      FILTER (?aUrl != ?bUrl)
    }`,
  });
  return rows.map(({ id = "" }) => id).sort();
}

async function recordUnder(pod: Pod, base: string, id: string) {
  const [row] = await pod.ask({
    query: `${PREFIXES}SELECT ?record WHERE { ?record cascade:sourceUrl <${base}/AllergyIntolerance/${id}> }`,
  });
  assert.ok(row?.record, `${base} ${id}`);
  return row.record;
}

test("the server Same's joins, kept across steps, are what a build of the whole pod derives after each step that files, retracts or reaches them (#518)", async () => {
  const folder = join(scratch, "pod");
  const pod = await openPodWith(parts, folder);
  try {
    const performed = async (
      name: string,
      act: () => Promise<{ refused?: string }>,
    ) => {
      const done = await act();
      assert.equal(done.refused, undefined, name);
      assert.deepEqual(
        await everything(pod),
        await builtWhole(folder, name),
        `after ${name}, the build kept across steps differs from the build whole`,
      );
    };
    for (const name of ["hospital", "hospital-at-a-new-path"]) {
      const done = await pod.connect(await connectFiles(name), {
        match: false,
      });
      assert.equal(done.refused, undefined, name);
    }
    for (const [name, base, ids, at] of [
      ["first", FIRST, ["a", "b", "c"], "2026-06-08T09:00:00Z"],
      ["second", SECOND, ["a", "b", "d"], "2026-06-09T09:00:00Z"],
    ] as const) {
      const done = await pod.import(pullFiles(name, base, ids, at), {
        match: false,
      });
      assert.equal(done.refused, undefined, name);
    }
    for (const summary of [
      "kestrel-harbor-health-summary.xml",
      "fernhill-family-clinic-summary.xml",
    ]) {
      const done = await pod.import(join(kit, ...PRIYA.split("/"), summary), {
        match: false,
      });
      assert.equal(done.refused, undefined, summary);
    }
    const servers = (
      await pod.ask({
        query: `${PREFIXES}SELECT ?server WHERE { ?server a cascade:Server }`,
      })
    ).map(({ server = "" }) => server);
    assert.equal(servers.length, 2);
    assert.deepEqual(await joinedIds(pod), []);

    await performed("a server Same", () =>
      pod.judge(judgment(pod, "Same", servers)),
    );
    assert.deepEqual(await joinedIds(pod), ["a", "b"]);

    await performed("a pull under one of the servers", () =>
      pod.import(pullFiles("again", SECOND, ["c"], "2026-06-10T09:00:00Z"), {
        match: false,
      }),
    );
    assert.deepEqual(await joinedIds(pod), ["a", "b", "c"]);

    await performed("a Different over two records it joins", async () =>
      pod.judge(
        judgment(pod, "Different", [
          await recordUnder(pod, FIRST, "a"),
          await recordUnder(pod, SECOND, "a"),
        ]),
      ),
    );
    assert.deepEqual(await joinedIds(pod), ["b", "c"]);

    const organizations = (
      await pod.ask({
        query: `${PREFIXES}SELECT ?organization WHERE { ?organization a cascade:Organization }`,
      })
    ).map(({ organization = "" }) => organization);
    assert.equal(organizations.length, 2);
    await performed("an organization Same", () =>
      pod.judge(judgment(pod, "Same", organizations)),
    );

    const [same] = await pod.ask({
      query: `${PREFIXES}SELECT ?claim WHERE { ?claim a cascade:Judgment ; cascade:verdict cascade:Same ; prov:hadMember <${servers[0]}> }`,
    });
    assert.ok(same?.claim);
    await performed("the server Same retracted", () =>
      pod.judge(retraction(pod, same.claim ?? "")),
    );
    assert.deepEqual(await joinedIds(pod), []);
  } finally {
    await pod.close();
  }
});
