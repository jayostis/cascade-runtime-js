import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { KeptBuild, type Rebuilding } from "@cascade-runtime/runtime";
import {
  FolderFiles,
  findRoot,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
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

/** What was recorded after one act: the pod's statements, those of a copy opened afresh, and the ids joined. */
interface Recorded {
  readonly open: string[];
  readonly whole: string[];
  readonly joined: string[];
}

/** What was recorded of an act run through `inPart`: whether a kept build stepped through it, and what it found wrong. */
interface Stepped {
  readonly stepped: boolean;
  readonly verifyFailed: unknown;
}

async function connectFiles(kit: string, name: string): Promise<Exported> {
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
function allergiesPulled(
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
  prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] ] ;
  prov:generatedAtTime "2026-07-01T12:00:00Z"^^xsd:dateTime .
<${pod.owner}> a prov:Person .
`;
}

function retraction(pod: Pod, matcherJudgment: string): string {
  return `${TURTLE_PREFIXES}
<urn:cascade:this-judgment> a prov:Activity ;
  prov:invalidated <${matcherJudgment}> ;
  prov:wasAssociatedWith <${pod.owner}> ;
  prov:startedAtTime "2026-07-02T12:00:00Z"^^xsd:dateTime .
<${pod.owner}> a prov:Person .
`;
}

/**
 * A pod works its answers out from its files, and a pod that stays open keeps that work: after each act it works out
 * again only the records the act reached. These checks hold that shortcut to the full work, so a pod left open answers
 * exactly as one opened afresh.
 * @rule runtime/currency.feature C8
 * @rule runtime/matcher.feature M20
 */
describe("Keeping an open pod's answers current · pod.ask()", () => {
  describe("given two servers of one hospital, each holding allergies under the same ids, and an owner who judges the servers Same", () => {
    let scratch: string;
    let pod: Pod;
    /** After the owner's Same over the servers, a pull, a Different, a Same over the organizations and the Same's retraction. */
    let recorded: Recorded[];
    /** The ids joined before any act. */
    let joinedBefore: string[];
    /** The pull and the Different, run through a build kept from before them. */
    let stepped: Stepped[];

    before(async () => {
      const root = findRoot(dirname(fileURLToPath(import.meta.url)));
      const kit = (await localVocabulary(root)).files.folder;
      scratch = await mkdtemp(join(tmpdir(), "cascade-server-same-"));
      const parts: Parts = await resolved();
      const folder = join(scratch, "pod");
      pod = await openPodWith(parts, folder);

      /**
       * Every triple of every graph but the manifest, whose build names the writer's last snapshot, which a copy opened
       * afresh has none of, as a line, each blank node written `_:`, sorted, a line as often as it is held.
       */
      const everything = async (of: Pod): Promise<string[]> => {
        const rows = await of.ask({
          query: `SELECT ?line WHERE {
            GRAPH ?g { ?s ?p ?o }
            FILTER (?g != <${of.address}${parts.layout.manifest}>)
            BIND (CONCAT(STR(?g), " ", IF(isBlank(?s), "_:", STR(?s)), " ", STR(?p), " ",
              IF(isBlank(?o), "_:", IF(isLiteral(?o), CONCAT(STR(?o), "^^", STR(DATATYPE(?o)), "@", LANG(?o)), STR(?o))))
              AS ?line)
          }`,
        });
        return rows.map(({ line = "" }) => line).sort();
      };
      /** What a build of the whole pod holds, read from a copy of its folder opened afresh. */
      const builtWhole = async (step: string): Promise<string[]> => {
        const copy = join(scratch, `whole-${step}`);
        await cp(folder, copy, { recursive: true });
        const whole = await openPodWith(parts, copy);
        try {
          return await everything(whole);
        } finally {
          await whole.close();
        }
      };
      /** The records under each server judged one with a record of the same id under another. */
      const joinedIds = async (): Promise<string[]> => {
        const rows = await pod.ask({
          query: `${PREFIXES}SELECT DISTINCT ?id WHERE {
            ?a cascade:currentlySame ?b ; cascade:sourceRecordId ?id ; cascade:sourceUrl ?aUrl .
            ?b cascade:sourceRecordId ?id ; cascade:sourceUrl ?bUrl .
            FILTER (?aUrl != ?bUrl)
          }`,
        });
        return rows.map(({ id = "" }) => id).sort();
      };
      const recordUnder = async (base: string, id: string) => {
        const [row] = await pod.ask({
          query: `${PREFIXES}SELECT ?record WHERE { ?record cascade:sourceUrl <${base}/AllergyIntolerance/${id}> }`,
        });
        assert.ok(row?.record, `${base} ${id}`);
        return row.record;
      };

      const rebuilding: Rebuilding = {
        pod: new FolderFiles(folder),
        layout: parts.layout,
        address: pod.address,
        newStore: parts.newStore,
        build: parts.build,
        lens: parts.lens,
        keep: () => Promise.resolve([]),
      };
      const state = (at: string) => ({
        address: pod.address,
        at,
        title: "pod",
      });
      /**
       * The act, with a build kept from before it stepped through it, which must not fall back to a build of the whole
       * pod, and equals one.
       */
      const inPart = async (
        name: string,
        act: () => Promise<{ refused?: string; wrote: readonly string[] }>,
      ) => {
        const { kept } = await KeptBuild.whole(
          rebuilding,
          state("2026-07-01T00:00:00Z"),
        );
        try {
          const done = await act();
          assert.equal(done.refused, undefined, name);
          const afterAct = state("2026-07-02T00:00:00Z");
          const result = await kept.step({ written: done.wrote }, afterAct);
          let verifyFailed: unknown;
          try {
            await kept.verify(await KeptBuild.whole(rebuilding, afterAct));
          } catch (error) {
            verifyFailed = error;
          }
          stepped.push({ stepped: result !== undefined, verifyFailed });
        } finally {
          kept.free();
        }
        return { refused: undefined };
      };
      const performed = async (
        name: string,
        act: () => Promise<{ refused?: string }>,
      ) => {
        const done = await act();
        assert.equal(done.refused, undefined, name);
        recorded.push({
          open: await everything(pod),
          whole: await builtWhole(name),
          joined: await joinedIds(),
        });
      };

      recorded = [];
      stepped = [];
      for (const name of ["hospital", "hospital-at-a-new-path"]) {
        const done = await pod.connect(await connectFiles(kit, name), {
          match: false,
        });
        assert.equal(done.refused, undefined, name);
      }
      for (const [name, base, ids, at] of [
        ["first", FIRST, ["a", "b", "c"], "2026-06-08T09:00:00Z"],
        ["second", SECOND, ["a", "b", "d"], "2026-06-09T09:00:00Z"],
      ] as const) {
        const done = await pod.import(allergiesPulled(name, base, ids, at), {
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
      const beforeAny = await joinedIds();

      await performed("a server Same", () =>
        pod.judge(judgment(pod, "Same", servers)),
      );
      await performed("a pull under one of the servers", () =>
        inPart("a pull under one of the servers", () =>
          pod.import(
            allergiesPulled("again", SECOND, ["c"], "2026-06-10T09:00:00Z"),
            { match: false },
          ),
        ),
      );
      const different = judgment(pod, "Different", [
        await recordUnder(FIRST, "a"),
        await recordUnder(SECOND, "a"),
      ]);
      await performed("a Different over two records it joins", () =>
        inPart("a Different over two records it joins", () =>
          pod.judge(different),
        ),
      );
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
        query: `${PREFIXES}SELECT ?matcherJudgment WHERE { ?matcherJudgment a cascade:Judgment ; cascade:verdict cascade:Same ; prov:hadMember <${servers[0]}> }`,
      });
      assert.ok(same?.matcherJudgment);
      await performed("the server Same retracted", () =>
        pod.judge(retraction(pod, same.matcherJudgment ?? "")),
      );
      joinedBefore = beforeAny;
    });

    after(async () => {
      await pod.close();
      await rm(scratch, { recursive: true, force: true });
    });

    it("returns after each act every statement that a copy of the pod opened afresh returns", () => {
      assert.equal(recorded.length, 5);
      for (const [n, { open, whole }] of recorded.entries())
        assert.deepEqual(
          open,
          whole,
          `after act ${n + 1} of 5, the build kept across steps differs from the build whole`,
        );
    });

    it("shows as the same exactly the records the judgments leave joined: none, then `a` and `b`, then `c` too, then `b` and `c`, then none", () => {
      const [sameServers, pulled, different, , retracted] = recorded;
      assert.deepEqual(joinedBefore, []);
      assert.deepEqual(sameServers!.joined, ["a", "b"]);
      assert.deepEqual(pulled!.joined, ["a", "b", "c"]);
      assert.deepEqual(different!.joined, ["b", "c"]);
      assert.deepEqual(retracted!.joined, []);
    });

    it("works out again only what the act reached, for a pull and for a Different, without starting over", () => {
      assert.deepEqual(
        stepped.map(({ stepped: partly }) => partly),
        [true, true],
      );
    });

    it("holds after working out in part exactly what the full work holds", () => {
      assert.equal(stepped.length, 2);
      assert.deepEqual(
        stepped.map(({ verifyFailed }) => verifyFailed),
        [undefined, undefined],
      );
    });
  });
});
