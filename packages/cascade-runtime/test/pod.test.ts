import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  type DeriveKey,
  EncryptedFiles,
  findingName,
  type FolderPack,
  iri,
  JUSTIFICATIONS,
  Layout,
  MATCHER,
  MemoryFiles,
  ntriples,
  OxigraphStore,
  type Placed,
  questions,
  RDF,
  recordFromServerName,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  findRoot,
  FolderFiles,
  headerIn,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { podKey } from "../src/encrypted.js";
import { shipped } from "../src/tables.js";
import {
  type Exported,
  type ImportProgress,
  openPod,
  type Pod,
  Refusal,
  sixWords,
  tablesBeside,
  typedWords,
  Unopened,
} from "cascade-runtime";
import { kitDownload, replayKit } from "cascade-runtime/fixtures";
import { Answers } from "../src/answers.js";
import { LOOKUPS, lookupsOf, withLookups } from "../src/lookups.js";
import { EFF_LARGE_WORDLIST_LINES } from "../src/eff-wordlist.js";
import { openFolderPod } from "../src/node/folder-pod.js";
import { partsOf, publishedAnswers } from "../src/node/published.js";
import { answersBeside, resolved } from "../src/node/resolved.js";
import { samplesOf } from "../src/node/samples.js";
import { keptPod, openPodWith, type Parts } from "../src/pod.js";

const KIT = "conformance/alex-rivera";
const ALEX = `${KIT}/scripted-input/alex`;
const QUESTION = "pod/My active allergies";
const PREFIXES = `PREFIX cascade: <https://ns.cascadeprotocol.org/cascade#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pav: <http://purl.org/pav/>
`;
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const OA = "http://www.w3.org/ns/oa#";
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const HAD_MEMBER = "http://www.w3.org/ns/prov#hadMember";
const UUID4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let kit: string;
let pods: string;
let folder: string;
let pod: Pod;
/** The parts a packed runtime opens a pod with: its answers kept beside it. */
let kept: Parts;

before(async () => {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  kit = (await localVocabulary(root)).files.folder;
  pods = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
  folder = join(pods, "pod");
  kept = {
    ...(await resolved()),
    answers: { runtime: "test", at: answersBeside },
  };
  pod = await openPodWith(kept, folder);
});

after(async () => {
  await pod.close();
  await rm(pods, { recursive: true, force: true });
});

function inKit(path: string): string {
  return join(kit, ...path.split("/"));
}

function exported(name: string): string {
  return inKit(`${ALEX}/downloads/${name}/apple_health_export`);
}

async function triplesOf(path: string) {
  return new OxigraphStore().parse(
    await readFile(inKit(path)),
    `file:///${path}`,
  );
}

/** The profile a judgment of Alex's kit claims. */
async function profileOf(judgment: string): Promise<string> {
  const [member] = (await triplesOf(`${ALEX}/judgments/${judgment}.ttl`))
    .filter(([, p]) => p.value === HAD_MEMBER)
    .map(([, , o]) => o.value);
  assert.ok(member, `${judgment} has no member`);
  return member;
}

/** The rows of a table an example of Alex's story gives under the line naming it, by column. */
async function tableUnder(
  example: string,
  line: string,
): Promise<Record<string, string>[]> {
  const lines = (await readFile(inKit(`${KIT}/alex-rivera.feature`), "utf8"))
    .split(/\r?\n/)
    .map((text) => text.trim());
  const start = lines.indexOf(line, lines.indexOf(`Example: ${example}`)) + 1;
  const table: string[][] = [];
  for (const text of lines.slice(start)) {
    if (!text.startsWith("|")) break;
    table.push(
      text
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
  }
  const [header = [], ...rows] = table;
  return rows.map((row) =>
    Object.fromEntries(header.map((column, i) => [column, row[i] ?? ""])),
  );
}

/** Each record of Alex's kit by the handle `expected/handles.json` gives it. */
async function handled(): Promise<(handle: string) => Promise<string>> {
  const handles = JSON.parse(
    await readFile(inKit(`${KIT}/expected/handles.json`), "utf8"),
  ) as { records: Record<string, Record<string, string>> };
  return (handle) => {
    const { server = "", type = "", id = "" } = handles.records[handle] ?? {};
    return recordFromServerName(server, type, id);
  };
}

/** The folder or file at the path as an app holds it: each file by its path under the folder's or file's own name. */
async function heldExport(
  at: string,
  as: (bytes: Uint8Array<ArrayBuffer>) => Blob | Uint8Array,
): Promise<Exported> {
  const files = (await stat(at)).isDirectory() ? await filesIn(at) : [at];
  const top = dirname(at);
  return new Map(
    await Promise.all(
      files.map(
        async (file) =>
          [
            relative(top, file).split(sep).join("/"),
            as(await readFile(file)),
          ] as const,
      ),
    ),
  );
}

/** Every file the folder holds, by its path in it. */
async function filesIn(at: string): Promise<string[]> {
  return (await readdir(at, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function about(profile: string, named = "urn:cascade:this-judgment"): string {
  return `${PREFIXES}
<${named}> a cascade:Judgment ;
    cascade:verdict cascade:About ; cascade:subject <${pod.subject}> ; cascade:basis cascade:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${pod.owner}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] ] .
<${pod.owner}> a prov:Person .`;
}

function judgment(
  verdict: string,
  members: readonly string[],
  by: Pod = pod,
): string {
  return `${PREFIXES}
<urn:cascade:this-judgment> a cascade:Judgment ; cascade:verdict cascade:${verdict} ;
    ${members.map((member) => `prov:hadMember <${member}> ;`).join(" ")}
    prov:wasAttributedTo <${by.owner}> .
<${by.owner}> a prov:Person .`;
}

async function allergens(of: Pod = pod): Promise<string[]> {
  return (await of.ask(QUESTION)).map(({ allergen }) => allergen ?? "").sort();
}

const refuses = (reason: RegExp) => (error: unknown) =>
  error instanceof Refusal && reason.test(error.message);

describe("pod.import", () => {
  describe("without the claim", () => {
    let profile: string;
    let imported: Awaited<ReturnType<Pod["import"]>>;
    const claimed = async (): Promise<boolean[]> =>
      (await pod.look(exported("x-e2"))).map((source) => source.claimed);

    before(async () => {
      profile = await profileOf("J1");
      imported = await pod.import(exported("x-e2"), { match: false });
    });

    it("files the export and does not match it", () => {
      assert.ok(imported.activity);
      assert.equal(imported.matched, undefined);
    });

    it("names its unclaimed profile", () => {
      assert.deepEqual(imported.claimed, []);
      assert.deepEqual(imported.unclaimed, [profile]);
    });

    it("brings nothing into the views", async () => {
      assert.deepEqual(await pod.ask(QUESTION), []);
    });

    it("leaves its source unclaimed", async () => {
      assert.deepEqual(await claimed(), [false]);
    });

    describe("when an About claims the profile", () => {
      let judged: Awaited<ReturnType<Pod["judge"]>>;

      before(async () => {
        judged = await pod.judge(about(profile));
      });

      it("refuses a judgment that names itself", async () => {
        await assert.rejects(
          pod.judge(
            about(profile, "urn:uuid:9e1d1f66-8f43-4a8e-9c7b-2f0c5e6d7a81"),
          ),
          /urn:cascade:this-judgment/,
        );
      });

      it("files the About and claims the source", async () => {
        assert.match(judged.judgment ?? "", /^urn:uuid:/);
        assert.deepEqual(await claimed(), [true]);
      });

      it("brings its records into the views once matched", async () => {
        assert.ok(imported.activity);
        const matched = await pod.match(imported.activity);
        assert.equal(matched.refused, undefined);
        assert.deepEqual(await allergens(), [
          "Codeine",
          "Latex",
          "Penicillin G",
          "Sulfamethoxazole",
        ]);
      });
    });
  });

  describe("with the claim", () => {
    describe("when its progress callback throws", () => {
      it("stops the import with that error", async () => {
        await assert.rejects(
          pod.import(exported("x-e4"), {
            onProgress: async () => {
              throw new Error("not told");
            },
          }),
          /not told/,
        );
      });
    });

    describe("once imported", () => {
      const told: ImportProgress[] = [];
      let imported: Awaited<ReturnType<Pod["import"]>>;

      before(async () => {
        imported = await pod.import(exported("x-e4"), {
          aboutSubject: true,
          onProgress: (progress) => {
            told.push(progress);
          },
        });
      });

      it("says each part as it begins", () => {
        assert.deepEqual(
          told
            .map(({ part }) => part)
            .filter((part, index, parts) => part !== parts[index - 1]),
          ["loading the adapter", "converting", "saving", "judging"],
        );
      });

      it("counts each document it converts, once and in order", () => {
        const converting = told.filter(({ part }) => part === "converting");
        assert.ok(
          converting.every(
            ({ done = -1, of = 0 }, index) =>
              done < of && done > (converting[index - 1]?.done ?? -1),
          ),
        );
      });

      it("counts each judgment it records", () => {
        assert.deepEqual(
          told.filter(({ part }) => part === "judging"),
          [
            { part: "judging", done: 0, of: 2 },
            { part: "judging", done: 1, of: 2 },
          ],
        );
      });

      it("records an About for each unclaimed profile", async () => {
        assert.deepEqual(
          imported.claimed.map(({ profile }) => profile),
          [await profileOf("J2")],
        );
        assert.deepEqual(imported.unclaimed, []);
      });

      it("gives every About's role to an association of the act that generated it", async () => {
        assert.deepEqual(
          await pod.ask({
            query: `${PREFIXES}SELECT ?about WHERE {
        ?about cascade:verdict cascade:About
        FILTER NOT EXISTS {
          ?about prov:wasAttributedTo ?owner ;
            prov:wasGeneratedBy/prov:qualifiedAssociation [ prov:agent ?owner ; prov:hadRole cascade:PatientRole ] }
      }`,
          }),
          [],
        );
      });

      it("states no role on an attribution", async () => {
        assert.deepEqual(
          await pod.ask({
            query: `${PREFIXES}SELECT ?about WHERE { ?about prov:qualifiedAttribution ?attribution }`,
          }),
          [],
        );
      });

      it("matches at once, writing the judgments the scenario gives", async () => {
        const wrote = imported.matched?.wrote ?? [];
        const judgments = await pod.ask({
          query: `${PREFIXES}SELECT ?justification (GROUP_CONCAT(STR(?member)) AS ?members) WHERE {
      VALUES ?file { ${wrote.map((path) => `<${pod.address}${path}>`).join(" ")} }
      GRAPH ?file { ?judgment a cascade:Judgment ; cascade:justification ?justification ; prov:hadMember ?member } }
      GROUP BY ?judgment ?justification`,
        });
        const expected = await tableUnder(
          "E5 writes J3 to J7 as the scenario gives them, and the reference descriptions it was the first to use",
          `Then "E5" wrote these matcher judgments:`,
        );
        const joined = (justification: string, members: string[]): string =>
          `${justification} ${members.sort().join(" ")}`;
        const named = await handled();
        assert.deepEqual(
          judgments
            .map(({ justification = "", members = "" }) =>
              joined(justification, members.split(" ")),
            )
            .sort(),
          (
            await Promise.all(
              expected
                // Alex's penicillin is joined by his kit's R3, SNOMED CT to RxNorm; the app's R3 reads product ingredients.
                .filter(
                  ({ justification }) => justification !== "same mapped code",
                )
                // Its conditions are joined by R1; the app's rule list gives conditions R8, by code and period.
                .map(async ({ justification = "", members = "" }) => {
                  const records = await Promise.all(
                    members.split(", ").map(named),
                  );
                  const kinds = await pod.ask({
                    query: `SELECT DISTINCT ?kind WHERE {
                VALUES ?record { ${records.map((record) => `<${record}>`).join(" ")} }
                ?record <https://ns.cascadeprotocol.org/cascade#recordKind> ?kind }`,
                  });
                  const conditions =
                    kinds.length === 1 && kinds[0]?.kind === "Condition";
                  return joined(
                    JUSTIFICATIONS[
                      justification === "same code" && conditions
                        ? "same code and period"
                        : justification
                    ] ?? justification,
                    records,
                  );
                }),
            )
          ).sort(),
        );
      });

      it("records no About for a profile already claimed", async () => {
        const again = await pod.import(exported("x-e6"), {
          aboutSubject: true,
        });
        assert.deepEqual(again.claimed, []);
      });
    });

    describe("when the profile is the subject itself", () => {
      let own: string;
      let itself: Pod;
      let imported: Awaited<ReturnType<Pod["import"]>>;

      before(async () => {
        own = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
        const profile = await profileOf("J1");
        const bridge = await kept.loadBridge();
        itself = await openPodWith(
          {
            ...kept,
            loadBridge: () =>
              Promise.resolve({
                ...bridge,
                adapters: (mediaType) =>
                  bridge.adapters(mediaType).map((adapter) => ({
                    accepts: (document) => adapter.accepts(document),
                    free: () => adapter.free(),
                    convert: async (document, options) => {
                      const converted = await adapter.convert(
                        document,
                        options,
                      );
                      return {
                        ...converted,
                        graph: new TextEncoder().encode(
                          new TextDecoder()
                            .decode(converted.graph)
                            .replaceAll(`<${profile}>`, `<${itself.subject}>`),
                        ),
                      };
                    },
                  })),
              }),
          },
          join(own, "pod"),
        );
        imported = await itself.import(exported("x-e2"), {
          aboutSubject: true,
          match: false,
        });
      });

      after(async () => {
        await itself.close();
        await rm(own, { recursive: true, force: true });
      });

      it("imports it without refusal", () => {
        assert.equal(imported.refused, undefined);
      });

      it("does not count it unclaimed", () => {
        assert.deepEqual(imported.unclaimed, []);
      });

      it("records no About for it", () => {
        assert.deepEqual(imported.claimed, []);
      });
    });
  });

  describe("of files no importer reads", () => {
    let unloaded: Pod;
    const nothing = new Uint8Array();
    const refused: [string, () => Exported, RegExp][] = [
      ["no file", () => new Map(), /^no importer of .* reads no file$/],
      [
        "two top-level names",
        () =>
          new Map([
            ["a/export.xml", nothing],
            ["b.xml", nothing],
          ]),
        /^no importer of .* reads a and b\.xml$/,
      ],
      [
        "a key that is no path",
        () => new Map([["a/../b.xml", nothing]]),
        /^the export holds a\/\.\.\/b\.xml, which is no path$/,
      ],
      [
        "a key with a leading slash",
        () => new Map([["/export.xml", nothing]]),
        /^the export holds \/export\.xml, which is no path$/,
      ],
      [
        "an empty key",
        () => new Map([["", nothing]]),
        /^the export holds , which is no path$/,
      ],
      [
        "a folder no importer reads",
        () => new Map([["Downloads/notes.txt", nothing]]),
        /^no importer of .* reads Downloads$/,
      ],
    ];

    before(async () => {
      unloaded = await openPodWith(
        {
          ...(await resolved()),
          loadBridge: () => Promise.reject(new Error("the Bridge was loaded")),
        },
        undefined,
        {},
      );
    });

    after(async () => {
      await unloaded.close();
    });

    for (const [input, given, why] of refused)
      it(`refuses ${input} before the Bridge loads, writing nothing`, async () => {
        const done = await unloaded.import(given());
        assert.match(done.refused ?? "", why);
        assert.deepEqual(done.wrote, []);
      });
  });
});

describe("pod.look", () => {
  describe("of an Apple Health export", () => {
    let filesBefore: string[];
    let sources: Awaited<ReturnType<Pod["look"]>>;

    before(async () => {
      filesBefore = await filesIn(folder);
      sources = await pod.look(exported("x-e12"));
    });

    it("reads the same from the files an app holds", async () => {
      assert.deepEqual(
        await pod.look(
          await heldExport(exported("x-e12"), (bytes) => new Blob([bytes])),
        ),
        sources,
      );
    });

    it("writes nothing", async () => {
      assert.deepEqual(await filesIn(folder), filesBefore);
    });

    it("names a FHIR source by its server, claimed once its records are filed", () => {
      assert.deepEqual(
        sources.map(({ name, server, claimed }) => [name, server, claimed]),
        [
          [
            "Larkspur Valley Health",
            "https://ehr.larkspur.example/fhir/R4",
            true,
          ],
          ["Larkspur Valley Health", "https://fhir.larkspur.example/r4", false],
          [
            "Meridian Health System",
            "https://fhir.meridian.example/api/FHIR/R4",
            true,
          ],
        ],
      );
    });

    it("counts a server's records as the export's source URLs do", async () => {
      const exportXml = await readFile(
        join(exported("x-e12"), "export.xml"),
        "utf8",
      );
      const urls = [...exportXml.matchAll(/sourceURL="([^"]*)"/g)].map(
        ([, url]) => url ?? "",
      );
      for (const { server, records } of sources) {
        const fromIt = urls.filter((url) =>
          url.toLowerCase().startsWith(`${server ?? ""}/`.toLowerCase()),
        );
        assert.equal(
          Object.values(records).reduce((sum, count) => sum + count, 0),
          fromIt.length,
          server,
        );
      }
    });
  });

  describe("of a C-CDA download", () => {
    let download: string;
    let at: string;
    let priya: Pod;

    before(async () => {
      download = await kitDownload(
        "priya-natarajan",
        "kestrel-harbor-health-summary.xml",
      );
      at = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
      priya = await openPod(at);
    });

    after(async () => {
      await priya.close();
      await rm(at, { recursive: true, force: true });
    });

    it("names its custodian and lists its sections", async () => {
      const [source, ...others] = await priya.look(download);
      assert.deepEqual(others, []);
      assert.deepEqual(
        await priya.look(await heldExport(download, (bytes) => bytes)),
        [source],
      );
      assert.ok(source);
      assert.equal(source.name, "Kestrel Harbor Hospital");
      assert.equal(source.server, undefined);
      assert.deepEqual(Object.keys(source.sections ?? {}).sort(), [
        "Allergies",
        "Medications",
        "Problems",
        "Results",
        "Social History",
        "Vital Signs",
      ]);
    });

    it("holds no records, gives when it was received, and is unclaimed", async () => {
      const [source] = await priya.look(download);
      assert.ok(source);
      assert.deepEqual(source.records, {});
      assert.deepEqual(source.received, ["2025-04-03T09:15:22Z"]);
      assert.equal(source.claimed, false);
    });

    it("refuses a document that is not well formed", async () => {
      const broken = join(at, "broken.xml");
      await writeFile(broken, '<ClinicalDocument xmlns="urn:hl7-org:v3"><id>');
      await assert.rejects(
        priya.look(broken),
        /^Error: ccda-download cannot read /,
      );
    });

    it("is claimed once the subject's records from it are filed", async () => {
      const imported = await priya.import(download, { aboutSubject: true });
      assert.equal(imported.refused, undefined);
      assert.deepEqual(
        (await priya.look(download)).map(({ claimed }) => claimed),
        [true],
      );
    });
  });
});

describe("an entry typed by hand", () => {
  let a1: string;
  let entered: Awaited<ReturnType<Pod["enter"]>>;
  let entry: string;
  let record: string;

  before(async () => {
    const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
    const alex = people.find(
      ([, p, o]) => p.value === FOAF_NAME && o.value === "Alex",
    )?.[0].value;
    const storage = people.find(
      ([s, p]) => s.value === alex && p.value === STORAGE,
    )?.[2].value;
    assert.ok(alex && storage);
    a1 = (await readFile(inKit(`${ALEX}/entries/a1.ttl`), "utf8"))
      .replaceAll(`<${alex}>`, `<${pod.subject}>`)
      .replaceAll(`<${storage}profile/card.ttl#me>`, `<${pod.owner}>`);
    entered = await pod.enter(a1);
    const peanuts = await pod.ask({
      query: `${PREFIXES}SELECT ?entry ?record WHERE {
      ?entry cascade:allergen "Peanuts" ; cascade:mergedFrom ?record }`,
    });
    assert.equal(peanuts.length, 1);
    ({ entry = "", record = "" } = peanuts[0] ?? {});
  });

  describe("pod.enter", () => {
    it("files and matches it by default", () => {
      assert.ok(entered.activity);
      assert.ok(entered.matched);
    });

    it("refuses an entry that holds two activities, writing nothing", async () => {
      const held = await filesIn(folder);
      const twice = await pod.enter(
        a1.replace(
          "<urn:cascade:output-0>",
          "<urn:cascade:another> a prov:Activity .\n<urn:cascade:output-0>",
        ),
      );
      assert.ok(twice.refused);
      assert.deepEqual(twice.wrote, []);
      assert.deepEqual(await filesIn(folder), held);
    });
  });

  describe("pod.judge", () => {
    it("records the versions the person saw", async () => {
      const [current] = await pod.ask({
        query: `${PREFIXES}SELECT ?version WHERE { <${record}> pav:hasCurrentVersion ?version }`,
      });
      const judged = await pod.judge(judgment("Erroneous", [record]));
      const used = await pod.ask({
        query: `${PREFIXES}SELECT ?version WHERE { <${judged.judgment ?? ""}> prov:wasDerivedFrom ?version }`,
      });
      assert.deepEqual(used, [current]);
    });

    it("refuses a step the rules refuse, writing nothing", async () => {
      const held = await filesIn(folder);
      await assert.rejects(
        pod.judge(judgment("Same", [entry, record])),
        (error: Error) => error.message.includes(entry),
      );
      assert.deepEqual(await filesIn(folder), held);
    });
  });
});

describe("pod.connect", () => {
  const connects = "runtime/scripted-input/finn/connects";
  let fresh: Pod;
  const saved = async (name: string): Promise<Exported> =>
    new Map(
      await Promise.all(
        ["connect.json", "capability.json", "smart-configuration.json"].map(
          async (file) =>
            [
              `${name}/${file}`,
              await readFile(inKit(`${connects}/${name}/${file}`)),
            ] as const,
        ),
      ),
    );

  before(async () => {
    fresh = await openPod();
  });

  after(async () => {
    await fresh.close();
  });

  it("matches by default, finding nothing to join the first time", async () => {
    const first = await fresh.connect(await saved("hospital"));
    assert.equal(first.matched?.refused, undefined);
    assert.deepEqual(first.matched?.wrote, []);
  });

  it("judges a hospital's server at a new path on its host the server it was", async () => {
    const moved = await fresh.connect(await saved("hospital-at-a-new-path"));
    assert.equal(moved.matched?.refused, undefined);
    assert.ok(moved.matched?.wrote.length);
    const sames = await fresh.ask({
      query: `${PREFIXES}SELECT ?base WHERE {
        ?claim cascade:justification cascade:SameSelfAssertedBaseUrlAndAuthorizationEndpointOnOneHost ;
          prov:hadMember ?server .
        ?server cascade:serverBaseUrl ?base }`,
    });
    assert.deepEqual(sames.map(({ base }) => base).sort(), [
      "https://fhir.example-hospital.example/api/FHIR/R4",
      "https://fhir.example-hospital.example/r4",
    ]);
  });
});

describe("a finding the pod holds", () => {
  let held: Pod;
  let finding: string;

  before(async () => {
    const at = join(pods, "a-finding");
    await (await openPodWith(kept, at)).close();
    const content = (subject: string): Triple[] => [
      [iri(subject), iri(`${RDF}type`), iri(`${CASCADE}FindingForReview`)],
      [
        iri(subject),
        iri(`${OA}hasBody`),
        iri(`${CASCADE}ClaimsNoLongerReached`),
      ],
    ];
    finding = await findingName(content("urn:cascade:this-finding"));
    const path = join(
      at,
      ...kept.layout
        .place(`${CASCADE}FindingForReview`)
        .path(finding)
        .split("/"),
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, ntriples(content(finding)));
    held = await openPodWith(kept, at);
  });

  after(async () => {
    await held.close();
  });

  it("is judged Same by a file that names no version", async () => {
    const same = await held.judge(judgment("Same", [finding], held));
    assert.ok(same.judgment);
    assert.deepEqual(
      await held.ask({
        query: `${PREFIXES}SELECT ?version WHERE { <${same.judgment}> prov:wasDerivedFrom ?version }`,
      }),
      [],
    );
  });

  it("is not judged Different", async () => {
    await assert.rejects(
      held.judge(judgment("Different", [finding], held)),
      (error: Error) => error.message.includes(finding),
    );
  });

  it("is not joined by a Same to a thing the pod does not hold", async () => {
    const unknown = "urn:uuid:3f6c2a8e-7d41-4b9a-a5e2-0c8d9b1f4e67";
    await assert.rejects(
      held.judge(judgment("Same", [unknown], held)),
      (error: Error) => error.message.includes(unknown),
    );
  });
});

describe("a pod's last snapshot", () => {
  let at: string;
  let head: Pod["head"];

  const entered = async (of: Pod, session: string) => {
    const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
    const alex = people.find(
      ([, p, o]) => p.value === FOAF_NAME && o.value === "Alex",
    )?.[0].value;
    assert.ok(alex);
    const a1 = await readFile(inKit(`${ALEX}/entries/a1.ttl`), "utf8");
    const done = await of.enter(
      a1
        .replaceAll("5c5734fb-433f-4ed1-8de7-1ad16d7d21cc", session)
        .replaceAll(`<${alex}>`, `<${of.subject}>`),
      { match: false },
    );
    assert.equal(done.refused, undefined);
    const triples = await new OxigraphStore().parse(
      await readFile(join(at, ...(done.wrote.at(-1) ?? "").split("/"))),
      of.address,
    );
    const values = (local: string) =>
      triples
        .filter(
          ([, p]) =>
            p.value === `https://ns.cascadeprotocol.org/cascade#${local}`,
        )
        .map(([, , o]) => o.value);
    return {
      firstParent: values("firstParentSnapshot"),
      merged: values("mergedParentSnapshot"),
    };
  };

  before(() => {
    at = join(pods, "two-sessions");
  });

  after(async () => {
    await rm(at, { recursive: true, force: true });
  });

  it("is none in a new pod, so its first session chains to nothing", async () => {
    const first = await openPodWith(kept, at);
    try {
      assert.equal(first.head, undefined);
      assert.deepEqual(
        await entered(first, "0b6f3c1e-2d4a-4e8b-9c7f-1a2b3c4d5e6f"),
        { firstParent: [], merged: [] },
      );
      head = first.head;
      assert.ok(head !== undefined);
    } finally {
      await first.close();
    }
  });

  it("is chained to by a session after a reopen, with no merge", async () => {
    const second = await openPodWith(kept, at);
    try {
      assert.ok(head);
      assert.deepEqual(second.head, head);
      assert.deepEqual(
        await entered(second, "7d1e9a4b-6c2f-4b3d-8e5a-2f1c0b9d8e7a"),
        { firstParent: [head.snapshot], merged: [] },
      );
    } finally {
      await second.close();
    }
  });
});

describe("pod.ask", () => {
  const query = `SELECT ?s WHERE { GRAPH <urn:cascade:derived:export> { ?s ?p ?o } } LIMIT 1`;

  it("runs the caller's own query under the lens named", async () => {
    assert.equal((await pod.ask({ query }, { lens: "export" })).length, 1);
    assert.deepEqual(await pod.ask({ query }), []);
  });

  it("refuses a question that does not exist, naming those that do", async () => {
    await assert.rejects(
      pod.ask("pod/No such question"),
      /pod\/My active allergies/,
    );
  });

  it("refuses a lens that does not exist, naming those that do", async () => {
    await assert.rejects(
      pod.ask(QUESTION, { lens: "no such lens" }),
      /everyday/,
    );
  });

  it("refuses a query that is not a SELECT", async () => {
    await assert.rejects(
      pod.ask({ query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }" }),
      /SELECT/,
    );
  });
});

describe("a new pod", () => {
  it("is named from a base of its own", async () => {
    const [, base] = /^pod:\/\/([^/]+)\/$/.exec(pod.address) ?? [];
    assert.match(base ?? "", UUID4);
    assert.ok(pod.owner.startsWith(pod.address));
    const inMemory = await openPod();
    assert.notEqual(inMemory.address, pod.address);
    await inMemory.close();
  });

  it("is found at that base by the vocabulary's queries", async () => {
    assert.deepEqual(await pod.ask("pod/Which files are out of place"), []);
    for (const question of [
      "pod/How many of each kind",
      "pod/What each folder holds",
      "pod/Which file states each thing",
    ]) {
      const rows = await pod.ask(question);
      assert.ok(rows.length > 0, question);
      for (const { file } of rows)
        if (file !== undefined) assert.ok(file.startsWith(pod.address), file);
    }
  });
});

describe("a pod opened again", () => {
  let address: string;
  let subject: string;
  let owner: string;
  let rows: string[];

  before(async () => {
    ({ address, subject, owner } = pod);
    rows = await allergens();
    await pod.close();
  });

  describe("with a build that fails", () => {
    let unbuilt: Pod;

    before(async () => {
      unbuilt = await openPodWith(
        {
          ...kept,
          build: {
            ...kept.build,
            files: () => Promise.reject(new Error("the pod was built")),
          },
        },
        folder,
      );
    });

    after(async () => {
      await unbuilt.close();
    });

    it("is the pod it was", () => {
      assert.deepEqual(
        [unbuilt.address, unbuilt.subject, unbuilt.owner],
        [address, subject, owner],
      );
    });

    it("answers what it answered without a build", async () => {
      (await unbuilt.ask(QUESTION)).pop();
      assert.deepEqual(await allergens(unbuilt), rows);
    });

    it("builds for a question it has not answered", async () => {
      await assert.rejects(
        unbuilt.ask("pod/My active medications"),
        /the pod was built/,
      );
    });
  });

  describe("with a build that fails and no questions kept", () => {
    let rebuilt: Pod;

    before(async () => {
      rebuilt = await openPodWith(
        {
          ...kept,
          build: {
            ...kept.build,
            queries: [],
            files: () => Promise.reject(new Error("the pod was built")),
          },
        },
        folder,
      );
    });

    after(async () => {
      await rebuilt.close();
    });

    it("builds for every question", async () => {
      await assert.rejects(allergens(rebuilt), /the pod was built/);
    });
  });

  describe("when a kept answer has lost its rows", () => {
    before(async () => {
      const answers = join(pods, ".answers", "pod", "answers.json");
      const stored = JSON.parse(await readFile(answers, "utf8")) as Record<
        string,
        Record<string, { rows: unknown }>
      >;
      for (const lens of Object.values(stored))
        for (const answer of Object.values(lens)) answer.rows = null;
      await writeFile(answers, JSON.stringify(stored));
      pod = await openPodWith(kept, folder);
    });

    it("answers as it did", async () => {
      assert.deepEqual(await allergens(), rows);
    });
  });

  describe("in a folder that holds no owner's profile", () => {
    let elsewhere: string;

    before(async () => {
      elsewhere = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
      await writeFile(join(elsewhere, "notes.txt"), "");
    });

    after(async () => {
      await rm(elsewhere, { recursive: true, force: true });
    });

    it("is refused", async () => {
      await assert.rejects(openPod(elsewhere), /owner's profile/);
    });

    it("answers though its kept answers cannot be written", async () => {
      const unwritable = await openPodWith(
        {
          ...kept,
          answers: {
            runtime: "test",
            at: () => ({
              iri: "file:///answers/",
              read: () => Promise.resolve(undefined),
              list: () => Promise.resolve([]),
              write: () => Promise.reject(new Error("read-only")),
            }),
          },
        },
        join(elsewhere, "pod"),
      );
      try {
        assert.deepEqual(await allergens(unwritable), []);
      } finally {
        await unwritable.close();
      }
    });
  });
});

describe("replayKit", () => {
  let at: string;
  let steps: Awaited<ReturnType<typeof replayKit>>;

  before(async () => {
    at = await mkdtemp(join(tmpdir(), "cascade-runtime-kit-"));
    steps = await replayKit("alex-rivera", at, { through: "E9" });
  });

  after(async () => {
    await rm(at, { recursive: true, force: true });
  });

  it("replays a kit's story through the step named", () => {
    assert.deepEqual(
      steps.map(({ step, kind }) => [step, kind]),
      [
        ["E1", "creation"],
        ["E2", "import"],
        ["M5", "matcher"],
        ["J1", "judgment"],
        ["E3", "entry"],
        ["M6", "matcher"],
        ["E4", "import"],
        ["J2", "judgment"],
        ["E5", "matcher"],
        ["E6", "import"],
        ["M7", "matcher"],
        ["E7", "import"],
        ["J8", "judgment"],
        ["J9", "judgment"],
        ["J10", "judgment"],
      ],
    );
  });

  it("files what the import and the matcher step write", () => {
    assert.ok((steps[1]?.wrote.length ?? 0) > 0);
    assert.ok(
      (steps.find(({ step }) => step === "E5")?.wrote.length ?? 0) > 0,
      "E5 files no Same",
    );
  });

  describe("the pod it leaves", () => {
    let replayed: Pod;

    before(async () => {
      replayed = await openPod(at);
    });

    after(async () => {
      await replayed.close();
    });

    it("is the subject's own storage, opened with nothing to adopt", async () => {
      const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
      assert.ok(
        people.some(
          ([s, p, o]) =>
            s.value === replayed.subject &&
            p.value === STORAGE &&
            o.value === replayed.address,
        ),
      );
      assert.equal(replayed.opened, undefined);
    });

    it("has its matcher cite only the references the app holds", async () => {
      const used = await replayed.ask({
        query: `${PREFIXES}SELECT DISTINCT ?version WHERE {
          ?judgment prov:wasAttributedTo <${MATCHER}> .
          { ?judgment prov:wasDerivedFrom ?version }
          UNION { ?assertion cascade:assertedClaim ?judgment ; cascade:assertedUnderRuleListVersion ?version }
          ?version prov:specializationOf/a cascade:ReferenceSeries }`,
      });
      const cited = used.map(({ version }) => version ?? "");
      const held = shipped(
        await (await tablesBeside(dirname(at))).references(),
      );
      assert.ok(cited.length > 0, "the matcher cites no reference");
      for (const version of cited)
        assert.ok(held.includes(version), `${version} is not the app's`);
    });

    it("gives the allergies the story's steps leave", async () => {
      assert.equal((await allergens(replayed)).length, 5);
    });
  });

  it("refuses a folder that holds files", async () => {
    await assert.rejects(replayKit("alex-rivera", at), /holds files/);
  });

  it("refuses an unknown kit, naming the kits", async () => {
    const empty = join(at, "..", `${at.split(/[\\/]/).at(-1)}-next`);
    await assert.rejects(replayKit("no-such-kit", empty), /alex-rivera/);
  });

  it("refuses an unknown step", async () => {
    const empty = join(at, "..", `${at.split(/[\\/]/).at(-1)}-next`);
    await assert.rejects(
      replayKit("alex-rivera", empty, { through: "no such step" }),
      /no such step/,
    );
  });
});

describe("tables kept beside a pod", () => {
  describe("when a browser saved the pod as null", () => {
    let dir: string;
    let again: ReturnType<Awaited<ReturnType<typeof resolved>>["tablesIn"]>;
    const held = "https://example.org/pod/";

    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "cascade-runtime-held-"));
      const first = (await resolved()).tablesIn(dir);
      await first.opened(held, ["https://example.org/v1"]);
      const saved = JSON.parse(
        await readFile(join(dir, "tables.json"), "utf8"),
      );
      saved.pods[held] = null;
      await writeFile(join(dir, "tables.json"), JSON.stringify(saved));
      again = (await resolved()).tablesIn(dir);
    });

    after(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("holds no version it was opened with", async () => {
      assert.equal(await again.openedWith(held), undefined);
    });

    it("counts it as using no version", async () => {
      assert.deepEqual(await again.uses(), {});
    });
  });
});

describe("kitDownload", () => {
  it("finds a folder by name", async () => {
    const x12 = await kitDownload("alex-rivera", "x-e12");
    assert.ok((await readdir(x12)).includes("apple_health_export"));
  });

  it("finds a file by name", async () => {
    assert.match(
      await readFile(
        await kitDownload(
          "priya-natarajan",
          "kestrel-harbor-health-summary.xml",
        ),
        "utf8",
      ),
      /<ClinicalDocument/,
    );
  });

  it("refuses an unknown kit, naming the kits", async () => {
    await assert.rejects(
      kitDownload("no-such-kit", "x-e12"),
      refuses(/there are .*alex-rivera/),
    );
  });

  it("refuses an unknown download, naming the kit's", async () => {
    await assert.rejects(
      kitDownload("alex-rivera", "x-e99"),
      refuses(/it has .*x-e12/),
    );
  });
});

describe("samplesOf", () => {
  const source = async () => ({
    components: await checkouts(
      findRoot(dirname(fileURLToPath(import.meta.url))),
    ),
    runtime: "copying",
  });

  it("refuses an unknown kit, naming the kits", async () => {
    await assert.rejects(
      samplesOf(await source(), { kits: ["no-such-kit"] }),
      refuses(/there are .*alex-rivera/),
    );
  });

  describe("when the install lacks a file of the kit", () => {
    let copy: string;
    let lacking: Awaited<ReturnType<typeof checkouts>>;

    before(async () => {
      const whole = await checkouts(
        findRoot(dirname(fileURLToPath(import.meta.url))),
      );
      copy = await mkdtemp(join(tmpdir(), "cascade-lacking-"));
      const found = await whole.resolve(whole.config.vocabulary);
      await cp(found.folder, copy, {
        recursive: true,
        filter: (path) =>
          !/[\\/](\.git|node_modules)([\\/]|$)/.test(path) &&
          !/^(\.[^\\/]*|tests)([\\/]|$)/.test(relative(found.folder, path)),
      });
      await rm(join(copy, `${KIT}/scripted-input/alex/entries/a1.ttl`));
      lacking = {
        ...whole,
        resolve: async (component: Parameters<typeof whole.resolve>[0]) =>
          component === whole.config.vocabulary
            ? { ...found, folder: copy }
            : whole.resolve(component),
      };
    });

    after(async () => {
      await rm(copy, { recursive: true, force: true });
    });

    it("makes no sample, as a step its story does not expect refused is refused", async () => {
      await assert.rejects(
        samplesOf(
          { components: lacking, runtime: "copying" },
          { kits: ["alex-rivera"] },
        ),
        (error) =>
          error instanceof Error &&
          !(error instanceof Refusal) &&
          /alex-rivera/.test(error.message) &&
          /E3/.test(error.message) &&
          /a1\.ttl does not exist/.test(error.message),
      );
    });
  });

  describe("of a kit", () => {
    const POD = "alex-rivera/pod/";
    let sample: Awaited<ReturnType<typeof samplesOf>>;
    let listed: string[];
    const text = (path: string): string =>
      new TextDecoder().decode(sample.files.get(path));

    before(async () => {
      sample = await samplesOf(await source(), {
        kits: ["alex-rivera"],
        look: async () => undefined,
      });
      listed = JSON.parse(text(`${POD}files.json`)) as string[];
    });

    it("lists the kits, describing each", () => {
      assert.ok(sample.kits.size > 1);
      assert.match(sample.kits.get("alex-rivera") ?? "", /Alex/);
    });

    it("lists the pod's files, and packs them beside its answers and lookups", () => {
      assert.ok(listed.length > 0);
      assert.deepEqual(
        [...sample.files.keys()].sort(),
        [
          "alex-rivera/answers.json",
          "alex-rivera/lookups.json",
          "alex-rivera/pod.json",
          "alex-rivera/pod.pack.json",
          `${POD}files.json`,
          ...listed.map((path) => POD + path),
        ].sort(),
      );
      const pack = JSON.parse(text("alex-rivera/pod.pack.json")) as FolderPack;
      assert.deepEqual(pack.paths, listed);
      assert.deepEqual(
        Object.keys({ ...pack.text, ...pack.base64 }).sort(),
        [...listed].sort(),
      );
    });

    it("keeps its lookups under the runtime that copies it", () => {
      assert.equal(
        lookupsOf(sample.files.get("alex-rivera/lookups.json"))?.runtime,
        "copying",
      );
    });

    it("keeps its answers for that runtime alone", async () => {
      const pod = new MemoryFiles("urn:test:sample/");
      for (const path of listed)
        await pod.write(path, sample.files.get(POD + path)!);
      const answers = new MemoryFiles("urn:test:sample-answers/");
      for (const path of ["answers.json", "pod.json"])
        await answers.write(path, sample.files.get(`alex-rivera/${path}`)!);
      const { vocabulary, build, lens, layout, tables } = kept;
      const reading = { vocabulary, build, lens, layout, tables };
      const copied = await keptPod(
        reading,
        pod,
        new Answers(answers, "copying"),
      );
      assert.ok(((await copied?.rows(QUESTION)) ?? []).length > 0);
      const other = await keptPod(
        reading,
        pod,
        new Answers(answers, "another"),
      );
      assert.equal(await other?.rows(QUESTION), undefined);
    });
  });
});

describe("a published pod's answers", () => {
  let files: FolderFiles;
  let answers: MemoryFiles;
  let publishing: Awaited<ReturnType<typeof partsOf>>;
  let codes: string[];
  let lookups: NonNullable<ReturnType<typeof lookupsOf>>;

  before(async () => {
    files = new FolderFiles(folder);
    const published = new Map<string, Uint8Array>();
    for (const path of await files.list("")) {
      const bytes = await files.read(path);
      if (bytes !== undefined) published.set(path, bytes);
    }
    const root = findRoot(dirname(fileURLToPath(import.meta.url)));
    answers = new MemoryFiles("urn:test:answers/");
    publishing = await partsOf(await checkouts(root));
    codes = (await pod.ask(QUESTION)).flatMap((row) =>
      Object.values(row).filter((value) => value.startsWith("http")),
    );
    for (const [path, bytes] of await publishedAnswers(
      publishing,
      "pod",
      published,
      "published",
      (_pod, tables) => tables.about(codes),
    ))
      await answers.write(path, bytes);
    const read = lookupsOf(await answers.read(LOOKUPS));
    assert.ok(read);
    lookups = read;
  });

  describe("as the site computes them", () => {
    const unread = () =>
      new Proxy(publishing.tables, {
        get: (target, property) =>
          property === "about"
            ? () => Promise.reject(new Error("the tables were asked"))
            : (Reflect.get(target, property, target) as () => unknown).bind(
                target,
              ),
      });

    it("tell what the tables said of the codes its page asked, without the tables", async () => {
      assert.ok(codes.length > 0);
      assert.deepEqual(
        await withLookups(unread(), lookups, "published").about(codes),
        await publishing.tables.about(codes),
      );
    });

    it("ask the tables again once the runtime is another", async () => {
      await assert.rejects(
        withLookups(unread(), lookups, "another runtime").about(codes),
        /the tables were asked/,
      );
    });

    it("name the tables they were computed with", async () => {
      assert.deepEqual(
        (await new Answers(answers, "published").described())?.tables,
        shipped(await publishing.tables.references()),
      );
    });
  });

  describe("read back without the engine", () => {
    let read: NonNullable<Awaited<ReturnType<typeof keptPod>>>;

    before(async () => {
      const { vocabulary, build, lens, layout, tables } = kept;
      const opened = await keptPod(
        {
          vocabulary,
          build,
          lens,
          tables,
          layout: Layout.of(
            layout.turtle,
            JSON.parse(JSON.stringify(layout.placements)) as Placed[],
          ),
        },
        files,
        new Answers(answers, "published"),
      );
      assert.ok(opened);
      read = opened;
    });

    it("is the pod it was", () => {
      assert.deepEqual(
        [read.address, read.subject, read.owner],
        [pod.address, pod.subject, pod.owner],
      );
    });

    it("gives every question the rows the pod gives", async () => {
      for (const question of (await questions(kept.vocabulary)).keys())
        assert.deepEqual(await read.rows(question), await pod.ask(question));
    });

    it("refuses a question that does not exist", async () => {
      await assert.rejects(
        read.rows("pod/No such question"),
        refuses(/no question/),
      );
    });

    it("refuses a lens that does not exist", async () => {
      await assert.rejects(
        read.rows(QUESTION, "no such lens"),
        refuses(/no lens/),
      );
    });
  });
});

const WORDS = "t-shirt abacus yo-yo zoom drop-down felt-tip";
const TITLE = "Sealed Example";
const HELD = "pod/What each folder holds";

/** A stand-in for Argon2id, a hash of what it is given, counting its calls. */
function fastDerive(): DeriveKey & { calls: number } {
  const derive = async (secret: Uint8Array, salt: Uint8Array) => {
    derive.calls += 1;
    const input = new Uint8Array([...secret, ...salt]);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  };
  derive.calls = 0;
  return derive;
}

let made:
  Promise<{ readonly folder: string; readonly rows: unknown }> | undefined;

/** A pod made with the six words, asked one question so its answer is kept, and closed: made once. */
function sealedPod(): Promise<{
  readonly folder: string;
  readonly rows: unknown;
}> {
  made ??= (async () => {
    const at = join(pods, "sealed");
    const opened = await openFolderPod({ ...kept, derive: fastDerive() }, at, {
      secret: WORDS,
      title: TITLE,
    });
    try {
      assert.ok(opened.encrypted);
      return { folder: at, rows: await opened.ask(HELD) };
    } finally {
      await opened.close();
    }
  })();
  return made;
}

/** What opening gives: "opened", an `Unopened`'s outcome, or "refused" for another refusal. */
async function outcomeOf(opening: Promise<Pod>): Promise<string> {
  try {
    await (await opening).close();
    return "opened";
  } catch (error) {
    if (error instanceof Unopened) return error.outcome;
    if (error instanceof Refusal) return "refused";
    throw error;
  }
}

describe("an encrypted pod", () => {
  describe("made with a secret", () => {
    let at: string;
    let rows: unknown;

    before(async () => {
      ({ folder: at, rows } = await sealedPod());
    });

    it("is sealed under a 1.2 header", async () => {
      const header = JSON.parse(
        await readFile(join(at, "settings", "encryption.json"), "utf8"),
      ) as { version: string; resourceFormat: number };
      assert.equal(header.version, "1.2");
      assert.equal(header.resourceFormat, 2);
    });

    it("holds nothing else of it or its answers in plaintext", async () => {
      const sealed = [
        ...(await filesIn(at)).filter(
          (file) => file !== join(at, "settings", "encryption.json"),
        ),
        ...(await filesIn(join(pods, ".answers", "sealed"))),
      ];
      assert.ok(sealed.some((file) => file.endsWith("answers.json")));
      for (const file of sealed) {
        const text = await readFile(file, "latin1");
        for (const plain of ["@prefix", TITLE, '"rows"'])
          assert.ok(!text.includes(plain), `${file} holds ${plain}`);
      }
    });

    it("answers as before when opened again with the secret", async () => {
      const reopened = await openFolderPod(
        { ...kept, derive: fastDerive() },
        at,
        { secret: WORDS },
      );
      try {
        assert.ok(reopened.encrypted);
        assert.deepEqual(await reopened.ask(HELD), rows);
      } finally {
        await reopened.close();
      }
    });
  });

  describe("opened", () => {
    const derive = fastDerive();
    let sealed: string;
    let newer: string;
    let directory: string;

    before(async () => {
      ({ folder: sealed } = await sealedPod());
      newer = join(pods, "newer");
      await mkdir(join(newer, "settings"), { recursive: true });
      await writeFile(
        join(newer, "settings", "encryption.json"),
        JSON.stringify({ version: "2.0", algorithm: "aes-256-gcm", wraps: [] }),
      );
      directory = join(pods, "directory");
      await mkdir(join(directory, "settings", "encryption.json"), {
        recursive: true,
      });
    });

    const cases: [
      string,
      () => string | undefined,
      string | undefined,
      string,
    ][] = [
      [
        "needs the secret, when none is given",
        () => sealed,
        undefined,
        "secret needed",
      ],
      [
        "refuses the wrong words as an incorrect secret",
        () => sealed,
        "a b c d e f",
        "incorrect secret",
      ],
      [
        "refuses a secret for a plaintext pod",
        () => folder,
        WORDS,
        "not encrypted",
      ],
      [
        "refuses a header of a newer version, with no secret",
        () => newer,
        undefined,
        "unsupported version",
      ],
      [
        "refuses a header of a newer version, with a secret",
        () => newer,
        WORDS,
        "unsupported version",
      ],
      [
        "calls a header that is a directory malformed",
        () => directory,
        WORDS,
        "malformed",
      ],
      [
        "refuses a secret for a pod in memory",
        () => undefined,
        WORDS,
        "refused",
      ],
    ];
    for (const [name, at, secret, outcome] of cases)
      it(name, async () => {
        assert.equal(
          await outcomeOf(
            openFolderPod(
              { ...kept, derive },
              at(),
              secret === undefined ? {} : { secret },
            ),
          ),
          outcome,
        );
      });

    it("derives a key only for the wrong words", () => {
      assert.equal(derive.calls, 1);
    });

    it("writes nothing into a header that is a directory", async () => {
      assert.deepEqual(await filesIn(directory), []);
    });
  });

  describe("made by two openings at once", () => {
    const derive = fastDerive();
    const opening = (at: string, secret: string) => {
      const files = new FolderFiles(at);
      return podKey(
        {
          files,
          header: undefined,
          reread: () => headerIn(at),
          held: async () => false,
        },
        secret,
        derive,
      );
    };

    it("ends with one header, so a file sealed by either opens by both", async () => {
      const at = join(pods, "raced");
      const [first, second] = await Promise.all([
        opening(at, WORDS),
        opening(at, WORDS),
      ]);
      assert.ok(first !== undefined && second !== undefined);
      await new EncryptedFiles(new FolderFiles(at), first).write(
        "a.ttl",
        new TextEncoder().encode("a"),
      );
      const read = await new EncryptedFiles(new FolderFiles(at), second).read(
        "a.ttl",
      );
      assert.equal(new TextDecoder().decode(read), "a");
    });

    it("refuses the loser that has another secret", async () => {
      const other = join(pods, "raced-apart");
      const outcomes = await Promise.all(
        [WORDS, "a b c d e f"].map((secret) =>
          opening(other, secret).then(
            () => "opened",
            (error: unknown) =>
              error instanceof Unopened ? error.outcome : "other",
          ),
        ),
      );
      assert.deepEqual(outcomes.sort(), ["incorrect secret", "opened"]);
    });
  });

  describe("opened with words typed otherwise", () => {
    it("opens on the second try", async () => {
      const { folder: at } = await sealedPod();
      const derive = fastDerive();
      const opened = await openFolderPod({ ...kept, derive }, at, {
        secret: " T-SHIRT, Abacus yo yo zoom drop down felt-tip ",
      });
      await opened.close();
      assert.equal(derive.calls, 2);
    });
  });
});

describe("sixWords", () => {
  it("draws six words from the list", () => {
    const words = sixWords().split(" ");
    const list = new Set(
      EFF_LARGE_WORDLIST_LINES.map((line) => line.split("\t")[1]),
    );
    assert.equal(words.length, 6);
    for (const word of words) assert.ok(list.has(word), word);
  });

  it("draws different words each time", () => {
    assert.notEqual(sixWords(), sixWords());
  });
});

describe("typedWords", () => {
  it("cleans what was typed", () => {
    assert.equal(
      typedWords(" T-Shirt, yo YO drop-down "),
      "t-shirt yo-yo drop-down",
    );
  });
});
