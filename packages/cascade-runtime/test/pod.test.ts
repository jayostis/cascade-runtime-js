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
  Layout,
  MATCHER,
  MemoryFiles,
  ntriples,
  OxigraphStore,
  type Placed,
  questions,
  RDF,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  findRoot,
  FolderFiles,
  headerIn,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
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
import { kitDownload, kitStory, replayKit } from "cascade-runtime/fixtures";
import { Answers } from "../src/answers.js";
import { LOOKUPS, lookupsOf, withLookups } from "../src/lookups.js";
import { EFF_LARGE_WORDLIST_LINES } from "../src/eff-wordlist.js";
import { openFolderPod } from "../src/node/folder-pod.js";
import { answersToPublish, partsOf } from "../src/node/published.js";
import { answersBeside, resolved } from "../src/node/resolved.js";
// `samplesToPublish` throws outside a packed package; `samplesOf` is the body it hands its packed source to.
import { samplesOf } from "../src/node/samples.js";
// A browser's `openPod` reads published answers with `keptPod` and `withLookups`, which a Node test cannot call as a page does.
import { keptPod, openPodWith, type Parts } from "../src/pod.js";
// The race of two openings is in `podKey`, which the public `openPod` does not let two callers reach at once.
import { podKey } from "../src/encrypted.js";
import { settled } from "./settled.js";

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
const SESSION = "5c5734fb-433f-4ed1-8de7-1ad16d7d21cc";

type Looked = Awaited<ReturnType<Pod["look"]>>;
type Rows = Awaited<ReturnType<Pod["ask"]>>;
type Done = Awaited<ReturnType<Pod["enter"]>>;
type Imported = Awaited<ReturnType<Pod["import"]>>;

let kit: string;
let pods: string;
let root: string;
/** The parts a packed runtime opens a pod with: its answers kept beside it. */
let kept: Parts;

before(async () => {
  root = findRoot(dirname(fileURLToPath(import.meta.url)));
  kit = (await localVocabulary(root)).files.folder;
  pods = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
  kept = {
    ...(await resolved()),
    answers: { runtime: "test", at: answersBeside },
  };
});

after(async () => {
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

/** A judgment as the guide's template writes it: by the owner, as the patient. */
function judgment(
  by: Pod,
  statements: readonly string[],
  named = "urn:cascade:this-judgment",
): string {
  return `${PREFIXES}
<${named}> a cascade:Judgment ;
    ${statements.join(" ;\n    ")} ;
    prov:wasAttributedTo <${by.owner}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${by.owner}> ; prov:hadRole cascade:PatientRole ] ] .
<${by.owner}> a prov:Person .`;
}

/** The owner's claim that a hospital's patient is them. */
function about(by: Pod, profile: string): string {
  return judgment(by, [
    "cascade:verdict cascade:About",
    `cascade:subject <${by.subject}>`,
    "cascade:basis cascade:OwnerStatement",
    `prov:hadMember <${profile}>`,
  ]);
}

/** The owner's Same, Different or Erroneous over members. */
function verdict(
  by: Pod,
  kind: string,
  members: readonly string[],
  named?: string,
): string {
  return judgment(
    by,
    [
      `cascade:verdict cascade:${kind}`,
      ...members.map((member) => `prov:hadMember <${member}>`),
    ],
    named,
  );
}

/** Alex's first entry as the owner of `of` enters it; `session` names another act than the kit's. */
async function entryFor(of: Pod, session?: string): Promise<string> {
  const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
  const alex = people.find(
    ([, p, o]) => p.value === FOAF_NAME && o.value === "Alex",
  )?.[0].value;
  const storage = people.find(
    ([s, p]) => s.value === alex && p.value === STORAGE,
  )?.[2].value;
  assert.ok(alex && storage);
  const text = (await readFile(inKit(`${ALEX}/entries/a1.ttl`), "utf8"))
    .replaceAll(`<${alex}>`, `<${of.subject}>`)
    .replaceAll(`<${storage}profile/card.ttl#me>`, `<${of.owner}>`);
  return session === undefined ? text : text.replaceAll(SESSION, session);
}

async function allergens(of: Pod): Promise<string[]> {
  return (await of.ask(QUESTION)).map(({ allergen }) => allergen ?? "").sort();
}

function select(of: Pod, query: string): Promise<Rows> {
  return of.ask({ query: `${PREFIXES}${query}` });
}

/** The refusal an opening ends in, which is an `Unopened`. */
async function unopenedBy(opening: Promise<Pod>): Promise<Unopened> {
  try {
    await (await opening).close();
  } catch (error) {
    assert.ok(error instanceof Unopened, String(error));
    return error;
  }
  return assert.fail("the pod opened");
}

interface Alex {
  readonly folder: string;
  readonly imported: {
    readonly e2: Imported;
    readonly e4: Imported;
    readonly e6: Imported;
  };
  readonly told: readonly ImportProgress[];
}

let alexMade: Promise<Alex> | undefined;

/**
 * A pod of Alex's three exports, each imported with the claim, and closed: made once, and never written to again. A
 * reader opens it, reads and closes it; a test that changes something copies its folder first.
 */
function alexPod(): Promise<Alex> {
  alexMade ??= (async () => {
    const folder = join(pods, "alex");
    const pod = await openPodWith(kept, folder);
    try {
      const told: ImportProgress[] = [];
      const e2 = await pod.import(exported("x-e2"), {
        claimProfiles: true,
        onProgress: (progress) => {
          told.push(progress);
        },
      });
      const e4 = await pod.import(exported("x-e4"), { claimProfiles: true });
      const e6 = await pod.import(exported("x-e6"), { claimProfiles: true });
      return { folder, imported: { e2, e4, e6 }, told };
    } finally {
      await pod.close();
    }
  })();
  return alexMade;
}

/** Alex's pod opened to read; the caller closes it. */
async function readingAlex(): Promise<Pod> {
  return openPodWith(kept, (await alexPod()).folder);
}

/** The parts a page reads published answers with: the layout as it arrives, passed through JSON. */
function pageParts(): Pick<
  Parts,
  "vocabulary" | "build" | "lens" | "layout" | "tables"
> {
  const { vocabulary, build, lens, layout, tables } = kept;
  return {
    vocabulary,
    build,
    lens,
    tables,
    layout: Layout.of(
      layout.turtle,
      JSON.parse(JSON.stringify(layout.placements)) as Placed[],
    ),
  };
}

/** A new pod, with Alex's first entry filed in it, and the entry and the record it was merged into. */
async function enteredPod(
  name: string,
): Promise<{ pod: Pod; entry: string; record: string }> {
  const pod = await openPodWith(kept, join(pods, name));
  const entered = await pod.enter(await entryFor(pod));
  assert.ok(entered.activity);
  const [peanuts] = await select(
    pod,
    `SELECT ?entry ?record WHERE { ?entry cascade:allergen "Peanuts" ; cascade:mergedFrom ?record }`,
  );
  const { entry = "", record = "" } = peanuts ?? {};
  assert.ok(entry && record);
  return { pod, entry, record };
}

/** An entry by the owner of `of`, filed without the matcher, and the parents of the snapshot its act left. */
async function parentsOf(
  at: string,
  of: Pod,
  session: string,
): Promise<{ firstParent: string[]; merged: string[] }> {
  const done = await of.enter(await entryFor(of, session), { match: false });
  assert.equal(done.refused, undefined);
  const triples = await new OxigraphStore().parse(
    await readFile(join(at, ...(done.wrote.at(-1) ?? "").split("/"))),
    of.address,
  );
  const values = (local: string) =>
    triples
      .filter(([, p]) => p.value === `${CASCADE}${local}`)
      .map(([, , o]) => o.value);
  return {
    firstParent: values("firstParentSnapshot"),
    merged: values("mergedParentSnapshot"),
  };
}

/** Whether every name of `part` is among those of `whole`, in the same relative order. */
function inOrder(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0;
  return part.every((name) => {
    at = whole.indexOf(name, at) + 1;
    return at > 0;
  });
}

/**
 * A pod is one person's health records and their own judgments on them, kept in a folder on disk, or in memory when no
 * folder is given. Each pod has an address, an identifier made once when the pod is made.
 */
describe("Opening a pod · openPod()", () => {
  let fresh: Pod;
  let inMemory: Pod;
  let notAPod: string;
  let rejected: unknown;
  let held: string[];
  let left: string[];

  before(async () => {
    fresh = await openPodWith(kept, join(pods, "new"));
    inMemory = await openPod();
    notAPod = join(pods, "not-a-pod");
    await mkdir(notAPod, { recursive: true });
    await writeFile(join(notAPod, "notes.txt"), "");
    held = await filesIn(notAPod);
    rejected = await openPodWith(kept, notAPod).then(
      async (opened) => {
        await opened.close();
        return undefined;
      },
      (error: unknown) => error,
    );
    left = await filesIn(notAPod);
  });

  after(async () => {
    await fresh.close();
    await inMemory.close();
  });

  it("gives each new pod an address of its own: `pod://`, a random UUID and a slash", () => {
    const [, base] = /^pod:\/\/([^/]+)\/$/.exec(fresh.address) ?? [];
    assert.match(base ?? "", UUID4);
    assert.notEqual(inMemory.address, fresh.address);
  });

  it("names the pod's owner and every file under that address", async () => {
    assert.ok(fresh.owner.startsWith(fresh.address));
    const rows = await fresh.ask("pod/Which file states each thing");
    assert.ok(rows.length > 0);
    for (const { file } of rows)
      assert.ok(file?.startsWith(fresh.address), `${file}`);
    assert.deepEqual(await fresh.ask("pod/Which files are out of place"), []);
  });

  it("throws for a folder that holds files but no pod, leaving the folder as it was", () => {
    assert.match(String(rejected), /owner's profile/);
    assert.deepEqual(held, [join(notAPod, "notes.txt")]);
    assert.deepEqual(left, held);
  });
});

/**
 * An export is what a person downloads of their own records: an Apple Health export, which holds the records of every
 * hospital their phone is connected to, or a C-CDA document, a summary file from one patient portal. `look` lists the
 * export's sources, one for each hospital server or document, so an app can say whose records it holds before anything
 * is saved.
 */
describe("Looking into an export before importing · pod.look()", () => {
  let alex: Pod;
  let filesBefore: string[];
  let byPath: Looked;
  let fromBlobs: Looked;
  let filesAfter: string[];
  let priya: Pod;
  let first: Looked;
  let fromBytes: Looked;
  let stored: Looked;
  let afterClaim: Looked;
  let broken: unknown;

  before(async () => {
    alex = await readingAlex();
    const { folder } = await alexPod();
    filesBefore = await filesIn(folder);
    byPath = await alex.look(exported("x-e12"));
    fromBlobs = await alex.look(
      await heldExport(exported("x-e12"), (bytes) => new Blob([bytes])),
    );
    filesAfter = await filesIn(folder);

    const download = await kitDownload(
      "priya-natarajan",
      "kestrel-harbor-health-summary.xml",
    );
    priya = await openPodWith(kept, join(pods, "priya"));
    first = await priya.look(download);
    fromBytes = await priya.look(await heldExport(download, (bytes) => bytes));
    const imported = await priya.import(download, { match: false });
    stored = await priya.look(download);
    for (const profile of imported.unclaimedProfiles)
      await priya.judge(about(priya, profile));
    afterClaim = await priya.look(download);
    const notXml = join(pods, "broken.xml");
    await writeFile(notXml, '<ClinicalDocument xmlns="urn:hl7-org:v3"><id>');
    broken = await priya.look(notXml).then(
      () => undefined,
      (error: unknown) => error,
    );
  });

  after(async () => {
    await alex.close();
    await priya.close();
  });

  describe("given an Apple Health export", () => {
    it("returns one source for each hospital server, with its name, its address and a count of its records by kind", async () => {
      assert.deepEqual(
        byPath.map(({ name, server }) => [name, server]),
        [
          ["Larkspur Valley Health", "https://ehr.larkspur.example/fhir/R4"],
          ["Larkspur Valley Health", "https://fhir.larkspur.example/r4"],
          [
            "Meridian Health System",
            "https://fhir.meridian.example/api/FHIR/R4",
          ],
        ],
      );
      const exportXml = await readFile(
        join(exported("x-e12"), "export.xml"),
        "utf8",
      );
      const urls = [...exportXml.matchAll(/sourceURL="([^"]*)"/g)].map(
        ([, url]) => url ?? "",
      );
      for (const { server, records } of byPath) {
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

    it("writes nothing to the pod", () => {
      assert.deepEqual(filesAfter, filesBefore);
    });
  });

  describe("given a C-CDA document", () => {
    it("returns one source named for the document's custodian (the organisation that keeps it), with its sections by title, when it was received, and no server", () => {
      const [source, ...others] = first;
      assert.deepEqual(others, []);
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
      assert.deepEqual(source.records, {});
      assert.deepEqual(source.received, ["2025-04-03T09:15:22Z"]);
    });

    it("throws, naming the reader that failed, when the document is not well-formed XML", () => {
      assert.ok(broken !== undefined, "look did not throw");
      assert.match(String(broken), /^Error: ccda-download cannot read /);
    });
  });

  describe("given files the app holds in memory", () => {
    it("returns the same sources as for the path on disk", () => {
      assert.deepEqual(fromBlobs, byPath, "an Apple Health export as Blobs");
      assert.deepEqual(fromBytes, first, "a C-CDA document as bytes");
    });
  });

  describe("given a pod that has imported before", () => {
    it("marks a source `holdsSubjectsRecords` only once the owner has said its records are their own", () => {
      assert.deepEqual(
        stored.map((source) => source.holdsSubjectsRecords),
        [false],
        "a C-CDA stored and not claimed",
      );
      assert.deepEqual(
        afterClaim.map((source) => source.holdsSubjectsRecords),
        [true],
        "a C-CDA once the owner claims its patient",
      );
      assert.deepEqual(
        byPath.map((source) => source.holdsSubjectsRecords),
        [true, false, true],
        "an Apple Health export of which two servers were imported and claimed",
      );
    });
  });
});

/**
 * An export names the patient its records are about, as that hospital knows them. The pod stores everything it imports
 * but shows those records in answers only after the owner claims that patient as themselves; the matcher then joins
 * records of the same thing from different hospitals.
 * @rule runtime/arrivals.feature A14
 * @rule conformance/alex-rivera/alex-rivera.feature P8
 * @rule conformance/alex-rivera/alex-rivera.feature P24
 */
describe("Importing a health export · pod.import()", () => {
  let waiting: Pod;
  let imported: Imported;
  let shown: Rows;
  let afterClaim: string[];
  let matched: Done;
  let profile: string;

  before(async () => {
    profile = await profileOf("J1");
    waiting = await openPodWith(kept, join(pods, "unclaimed"));
    imported = await waiting.import(exported("x-e2"), { match: false });
    assert.ok(imported.activity);
    shown = await waiting.ask(QUESTION);
    await waiting.judge(about(waiting, profile));
    afterClaim = await allergens(waiting);
    matched = await waiting.match(imported.activity);
  });

  after(async () => {
    await waiting.close();
  });

  describe("when nobody has claimed the export's patient", () => {
    it("stores the export and returns the patient in `unclaimedProfiles`", () => {
      assert.ok(imported.activity);
      assert.ok(imported.wrote.length > 0);
      assert.deepEqual(imported.claimedProfiles, []);
      assert.deepEqual(imported.unclaimedProfiles, [profile]);
    });

    it("shows none of the export's records in answers", () => {
      assert.deepEqual(shown, []);
    });

    it("shows them once the owner claims the patient with `pod.judge()`", () => {
      assert.deepEqual(afterClaim, [
        "Codeine",
        "Latex",
        "Penicillin G",
        "Sulfamethoxazole",
      ]);
    });
  });

  describe("with `claimProfiles: true`, which claims the export's patient for the owner", () => {
    it("records one claim for each unclaimed patient and returns it in `claimedProfiles`", async () => {
      const { e2, e4, e6 } = (await alexPod()).imported;
      for (const [name, done, expected] of [
        ["x-e2", e2, [await profileOf("J1")]],
        ["x-e4", e4, [await profileOf("J2")]],
        ["x-e6, whose patients are claimed by then", e6, []],
      ] as const) {
        assert.deepEqual(
          done.claimedProfiles.map((claim) => claim.profile),
          expected,
          name,
        );
        assert.deepEqual(done.unclaimedProfiles, [], name);
      }
    });

    it("runs the matcher straight after the claims and returns what it wrote in `matched`", async () => {
      const ran = (await alexPod()).imported.e4.matched;
      assert.ok(ran);
      assert.equal(ran.refused, undefined);
      assert.ok(ran.wrote.length > 0);
    });
  });

  describe("with `match: false`", () => {
    it("skips the matcher, which a later `pod.match()` runs", () => {
      assert.equal(imported.matched, undefined);
      assert.equal(matched.refused, undefined);
    });
  });

  describe("with `onProgress`", () => {
    it("reports four parts in order: `loading the adapter`, `converting`, `saving`, `judging`", async () => {
      const { told } = await alexPod();
      assert.deepEqual(
        told
          .map(({ part }) => part)
          .filter((part, index, parts) => part !== parts[index - 1]),
        ["loading the adapter", "converting", "saving", "judging"],
      );
    });

    it("counts upward through the documents it converts and the claims it records", async () => {
      const { told } = await alexPod();
      const converting = told.filter(({ part }) => part === "converting");
      assert.ok(converting.length > 0);
      assert.ok(
        converting.every(
          ({ done = -1, of = 0 }, index) =>
            done < of && done > (converting[index - 1]?.done ?? -1),
        ),
      );
      assert.deepEqual(
        told.filter(({ part }) => part === "judging"),
        [
          { part: "judging", done: 0, of: 2 },
          { part: "judging", done: 1, of: 2 },
        ],
      );
    });

    it("stops with the callback's own error when the callback throws, writing nothing", async () => {
      const at = join(pods, "stopped");
      const stopped = await openPodWith(kept, at);
      try {
        const held = await filesIn(at);
        await assert.rejects(
          stopped.import(exported("x-e2"), {
            onProgress: async () => {
              throw new Error("not told");
            },
          }),
          /not told/,
        );
        assert.deepEqual(await filesIn(at), held);
      } finally {
        await stopped.close();
      }
    });
  });

  describe("given files that are not an export", () => {
    const nothing = new Uint8Array();
    let loaded = 0;
    let unloaded: Pod;

    before(async () => {
      unloaded = await openPodWith(
        {
          ...kept,
          loadBridge: () => {
            loaded += 1;
            return Promise.reject(new Error("the Bridge was loaded"));
          },
        },
        undefined,
        {},
      );
    });

    after(async () => {
      await unloaded.close();
    });

    async function refusedFor(
      examples: readonly (readonly [string, Exported, RegExp])[],
    ): Promise<void> {
      for (const [input, given, why] of examples) {
        const done = await unloaded.import(given);
        assert.match(done.refused ?? "", why, input);
        assert.deepEqual(done.wrote, [], input);
      }
      assert.equal(loaded, 0, "the converter was loaded");
    }

    it("returns `refused` before the converter loads, with nothing written", async () => {
      await refusedFor([
        ["no file", new Map(), /^no importer of .* reads no file$/],
        [
          "two top-level names",
          new Map([
            ["a/export.xml", nothing],
            ["b.xml", nothing],
          ]),
          /^no importer of .* reads a and b\.xml$/,
        ],
        [
          "a folder no importer reads",
          new Map([["Downloads/notes.txt", nothing]]),
          /^no importer of .* reads Downloads$/,
        ],
      ]);
    });

    it("returns `refused` for a file key that is not a relative path", async () => {
      await refusedFor([
        [
          "a key that is no path",
          new Map([["a/../b.xml", nothing]]),
          /^the export holds a\/\.\.\/b\.xml, which is no path$/,
        ],
        [
          "a key with a leading slash",
          new Map([["/export.xml", nothing]]),
          /^the export holds \/export\.xml, which is no path$/,
        ],
        [
          "an empty key",
          new Map([["", nothing]]),
          /^the export holds , which is no path$/,
        ],
      ]);
    });
  });
});

/**
 * When an app signs a person in to a hospital's server, `connectFiles()` saves what the server said about itself, and
 * `connect` stores that in the pod. From these records the matcher can tell that a hospital which moved its server to a
 * new address is still one hospital.
 * @rule runtime/arrivals.feature A16
 * @rule runtime/matcher.feature M20
 */
describe("Recording a hospital connection · pod.connect()", () => {
  let hospital: Pod;
  let first: Done;
  let moved: Done;

  before(async () => {
    const connects = "runtime/scripted-input/finn/connects";
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
    hospital = await openPod();
    first = await hospital.connect(await saved("hospital"));
    moved = await hospital.connect(await saved("hospital-at-a-new-path"));
  });

  after(async () => {
    await hospital.close();
  });

  it("stores the connection and returns it as `activity`", () => {
    assert.ok(first.activity);
    assert.ok(first.wrote.length > 0);
  });

  it("runs the matcher at once, which writes only when the same hospital connects again from a new address", () => {
    assert.equal(first.matched?.refused, undefined);
    assert.deepEqual(first.matched?.wrote, []);
    assert.equal(moved.matched?.refused, undefined);
    assert.ok(moved.matched?.wrote.length);
  });
});

/**
 * The vocabulary carries named questions, such as "pod/My active allergies", and `ask` answers one, or the app's own
 * SPARQL SELECT query, as rows of plain strings. A lens is a named view of the pod: `everyday` is the default, and
 * `export` is the stricter one for sharing.
 */
describe("Asking a pod questions · pod.ask()", () => {
  let alex: Pod;

  before(async () => {
    alex = await readingAlex();
  });

  after(async () => {
    await alex.close();
  });

  it("answers a named question with rows of plain strings", async () => {
    const rows = await alex.ask(QUESTION);
    assert.ok(rows.length > 0);
    for (const row of rows)
      for (const [column, value] of Object.entries(row))
        assert.equal(typeof value, "string", column);
  });

  it("runs the app's own SELECT under the lens named, or under `everyday` when none is named", async () => {
    const query = `SELECT ?s WHERE { GRAPH <urn:cascade:derived:export> { ?s ?p ?o } } LIMIT 1`;
    assert.equal((await alex.ask({ query }, { lens: "export" })).length, 1);
    assert.deepEqual(await alex.ask({ query }), []);
  });

  it("throws, listing the names there are, for a question or a lens the vocabulary doesn't have", async () => {
    await assert.rejects(
      alex.ask("pod/No such question"),
      /pod\/My active allergies/,
      "a question it doesn't have",
    );
    await assert.rejects(
      alex.ask(QUESTION, { lens: "no such lens" }),
      /everyday/,
      "a lens it doesn't have",
    );
  });

  it("throws for a query that is not a SELECT", async () => {
    await assert.rejects(
      alex.ask({ query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }" }),
      /SELECT/,
    );
  });
});

/**
 * A person can add a record no hospital holds, such as an allergy they know they have. The app writes it in Turtle, a
 * text format for the vocabulary's terms, from the guide's template; because it is the owner's own, it needs no claim.
 * @rule runtime/arrivals.feature A12
 * @rule runtime/arrivals.feature A14
 * @rule conformance/alex-rivera/alex-rivera.feature P16
 */
describe("Entering a record by hand · pod.enter()", () => {
  let owned: Pod;
  let entered: Done;
  let peanuts: Rows;
  let claims: Rows;
  let twice: Done;
  let held: string[];
  let left: string[];

  before(async () => {
    const at = join(pods, "entered");
    owned = await openPodWith(kept, at);
    const a1 = await entryFor(owned);
    entered = await owned.enter(a1);
    peanuts = await select(
      owned,
      `SELECT ?entry ?record WHERE { ?entry cascade:allergen "Peanuts" ; cascade:mergedFrom ?record }`,
    );
    claims = await select(
      owned,
      `SELECT ?about WHERE { ?about cascade:verdict cascade:About }`,
    );
    held = await filesIn(at);
    twice = await owned.enter(
      a1.replace(
        "<urn:cascade:output-0>",
        "<urn:cascade:another> a prov:Activity .\n<urn:cascade:output-0>",
      ),
    );
    left = await filesIn(at);
  });

  after(async () => {
    await owned.close();
  });

  it("stores the entry and runs the matcher at once, returning them as `activity` and `matched`", () => {
    assert.equal(entered.refused, undefined);
    assert.ok(entered.activity);
    assert.ok(entered.matched);
  });

  it("shows the record in answers with no claim", () => {
    assert.deepEqual(claims, []);
    assert.equal(peanuts.length, 1);
  });

  it("returns `refused`, with nothing written, for an entry the pod's rules turn down", () => {
    assert.ok(twice.refused);
    assert.deepEqual(twice.wrote, []);
    assert.deepEqual(left, held);
  });
});

/**
 * A judgment is the owner's own statement about one or more records, its members: a claim that a hospital's patient is
 * them, that records are the Same thing or Different things, or that one is Erroneous. The app writes it in Turtle from
 * the guide's template, naming it `urn:cascade:this-judgment`, and `judge` files it.
 * @rule conformance/alex-rivera/alex-rivera.feature P15
 * @rule runtime/matcher.feature M19
 */
describe("Recording the owner's judgment · pod.judge()", () => {
  let owned: Pod;
  let entry: string;
  let record: string;
  let current: Rows;
  let judged: Done;
  let cited: Rows;

  before(async () => {
    ({ pod: owned, entry, record } = await enteredPod("judged"));
    current = await select(
      owned,
      `SELECT ?version WHERE { <${record}> pav:hasCurrentVersion ?version }`,
    );
    judged = await owned.judge(verdict(owned, "Erroneous", [record]));
    cited = await select(
      owned,
      `SELECT ?version WHERE { <${judged.judgment ?? ""}> prov:wasDerivedFrom ?version }`,
    );
  });

  after(async () => {
    await owned.close();
  });

  describe("given a judgment about a record the pod holds", () => {
    it("returns the judgment's new name, a `urn:uuid:`", () => {
      assert.match(judged.judgment ?? "", /^urn:uuid:/);
    });

    it("records which version of the record the owner was looking at", () => {
      assert.equal(current.length, 1);
      assert.deepEqual(cited, current);
    });
  });

  describe("given Turtle it cannot file", () => {
    it("throws when the judgment has any name but `urn:cascade:this-judgment`", async () => {
      await assert.rejects(
        owned.judge(
          verdict(
            owned,
            "Erroneous",
            [record],
            "urn:uuid:9e1d1f66-8f43-4a8e-9c7b-2f0c5e6d7a81",
          ),
        ),
        /urn:cascade:this-judgment/,
      );
    });

    it("throws, naming the member and writing nothing, when a member is not a record the pod holds", async () => {
      const unknown = "urn:uuid:3f6c2a8e-7d41-4b9a-a5e2-0c8d9b1f4e67";
      const at = join(pods, "judged");
      const held = await filesIn(at);
      for (const [name, member, members] of [
        ["an entry in place of its record", entry, [entry, record]],
        ["a name the pod does not hold", unknown, [unknown]],
      ] as const) {
        await assert.rejects(
          owned.judge(verdict(owned, "Same", members)),
          (error: Error) => error.message.includes(member),
          name,
        );
        assert.deepEqual(await filesIn(at), held, name);
      }
    });
  });

  describe("given a finding, a note the matcher leaves for the owner to review", () => {
    let finding: string;
    let holder: Pod;
    let same: Done;
    let versions: Rows;

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
      holder = await openPodWith(kept, at);
      same = await holder.judge(verdict(holder, "Same", [finding]));
      versions = await select(
        holder,
        `SELECT ?version WHERE { <${same.judgment ?? ""}> prov:wasDerivedFrom ?version }`,
      );
    });

    after(async () => {
      await holder.close();
    });

    it("files a Same whose only member is the finding, citing no version", () => {
      assert.ok(same.judgment);
      assert.deepEqual(versions, []);
    });

    it("throws for a Different about the finding", async () => {
      await assert.rejects(
        holder.judge(verdict(holder, "Different", [finding])),
        (error: Error) => error.message.includes(finding),
      );
    });
  });
});

const NOT_BUILT = new Error("the pod was built");

/**
 * So that a returning app is fast, each answer to a named question is kept beside the pod's folder and returned again
 * while nothing it was worked out from has changed. Each act in a pod (an import, an entry, a judgment) leaves a
 * snapshot that names the one before it, and `head` is the snapshot of this app's latest act.
 * @rule runtime/naming.feature N14
 */
describe("Opening a pod again · openPod()", () => {
  let again: string;
  let made: { address: string; subject: string; owner: string };
  let rows: Rows;

  /** The parts that open a pod with a build that fails, so that an answer that is not kept shows it. */
  const unbuilt = (build: Partial<Parts["build"]> = {}): Parts => ({
    ...kept,
    build: { ...kept.build, ...build, files: () => Promise.reject(NOT_BUILT) },
  });

  async function opened<T>(
    parts: Parts,
    at: string,
    use: (pod: Pod) => Promise<T>,
  ): Promise<T> {
    const pod = await openPodWith(parts, at);
    try {
      return await use(pod);
    } finally {
      await pod.close();
    }
  }

  before(async () => {
    again = join(pods, "again");
    await cp((await alexPod()).folder, again, { recursive: true });
    await opened(kept, again, async (pod) => {
      made = { address: pod.address, subject: pod.subject, owner: pod.owner };
      rows = await pod.ask(QUESTION);
    });
  });

  describe("given the folder a pod was made in", () => {
    it("returns the same pod: address, subject, owner", async () => {
      await opened(kept, again, async (pod) => {
        assert.deepEqual(
          { address: pod.address, subject: pod.subject, owner: pod.owner },
          made,
        );
      });
    });
  });

  describe("with an answer kept from an earlier session", () => {
    it("returns it without building the pod again", async () => {
      assert.ok(rows.length > 0);
      await opened(unbuilt(), again, async (pod) => {
        assert.deepEqual(await pod.ask(QUESTION), rows);
      });
    });

    it("returns a copy, so a caller changing its rows changes nothing kept", async () => {
      await opened(unbuilt(), again, async (pod) => {
        (await pod.ask(QUESTION)).pop();
        assert.deepEqual(await pod.ask(QUESTION), rows);
      });
    });
  });

  describe("when no kept answer fits", () => {
    it("works the answer out again", async () => {
      await opened(unbuilt(), again, async (pod) => {
        await assert.rejects(
          pod.ask("pod/My active medications"),
          /the pod was built/,
          "a question not asked before",
        );
      });
      await opened(unbuilt({ queries: [] }), again, async (pod) => {
        await assert.rejects(
          pod.ask(QUESTION),
          /the pod was built/,
          "a vocabulary whose build queries changed",
        );
      });
      const nulled = join(pods, "again-null");
      await cp(again, nulled, { recursive: true });
      await opened(kept, nulled, async (pod) => {
        await pod.ask(QUESTION);
      });
      const answers = join(pods, ".answers", "again-null", "answers.json");
      const stored = JSON.parse(await readFile(answers, "utf8")) as Record<
        string,
        Record<string, { rows: unknown }>
      >;
      for (const lens of Object.values(stored))
        for (const answer of Object.values(lens)) answer.rows = null;
      await writeFile(answers, JSON.stringify(stored));
      await opened(kept, nulled, async (pod) => {
        assert.deepEqual(
          await pod.ask(QUESTION),
          rows,
          "kept rows that are not a list",
        );
      });
    });
  });

  describe("when answers cannot be saved", () => {
    it("answers all the same", async () => {
      assert.ok(rows.length > 0);
      const unwritable: Parts = {
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
      };
      await opened(unwritable, again, async (pod) => {
        assert.deepEqual(await pod.ask(QUESTION), rows);
      });
    });
  });

  describe("pod.head", () => {
    let head0: Pod["head"];
    let head1: Pod["head"];
    let firstAct: { firstParent: string[]; merged: string[] };
    let reopened: Pod["head"];
    let secondAct: { firstParent: string[]; merged: string[] };

    before(async () => {
      const at = join(pods, "two-sessions");
      const first = await openPodWith(kept, at);
      try {
        head0 = first.head;
        firstAct = await parentsOf(
          at,
          first,
          "0b6f3c1e-2d4a-4e8b-9c7f-1a2b3c4d5e6f",
        );
        head1 = first.head;
      } finally {
        await first.close();
      }
      const second = await openPodWith(kept, at);
      try {
        reopened = second.head;
        secondAct = await parentsOf(
          at,
          second,
          "7d1e9a4b-6c2f-4b3d-8e5a-2f1c0b9d8e7a",
        );
      } finally {
        await second.close();
      }
    });

    it("is undefined in a new pod and set by its first act", () => {
      assert.equal(head0, undefined);
      assert.ok(head1 !== undefined);
      assert.deepEqual(firstAct, { firstParent: [], merged: [] });
    });

    it("survives a reopen, so the next act's snapshot names it as the one before and merges nothing", () => {
      assert.ok(head1 !== undefined);
      assert.deepEqual(reopened, head1);
      assert.deepEqual(secondAct, {
        firstParent: [head1.snapshot],
        merged: [],
      });
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

interface Sealed {
  readonly folder: string;
  readonly rows: unknown;
  readonly encrypted: boolean;
}

let sealedMade: Promise<Sealed> | undefined;

/** A pod made with the six words, asked one question so its answer is kept, and closed: made once. */
function sealedPod(): Promise<Sealed> {
  sealedMade ??= (async () => {
    const at = join(pods, "sealed");
    const opened = await openFolderPod({ ...kept, derive: fastDerive() }, at, {
      secret: WORDS,
      title: TITLE,
    });
    try {
      return {
        folder: at,
        rows: await opened.ask(HELD),
        encrypted: opened.encrypted,
      };
    } finally {
      await opened.close();
    }
  })();
  return sealedMade;
}

/**
 * A pod made with a secret is sealed: its files, and the answers kept beside it, are encrypted on disk and open only
 * with that secret. The secret is six words from a public word list, which a person can write down and type back; one
 * file, the header, stays readable and says how the pod is sealed.
 */
describe("Encrypting a pod with six words · openPod(), sixWords(), typedWords()", () => {
  describe("sixWords()", () => {
    it("returns six words from the EFF long word list, different on each call", () => {
      const list = new Set(
        EFF_LARGE_WORDLIST_LINES.map((line) => line.split("\t")[1]),
      );
      const words = sixWords().split(" ");
      assert.equal(words.length, 6);
      for (const word of words) assert.ok(list.has(word), word);
      assert.notEqual(sixWords(), sixWords());
    });
  });

  describe("typedWords(typed)", () => {
    it("returns typed words the way the list writes them: lower case, single spaces, no commas, a hyphenated word rejoined", () => {
      assert.equal(
        typedWords(" T-Shirt, yo YO drop-down "),
        "t-shirt yo-yo drop-down",
      );
    });
  });

  describe("when a new pod is made with a secret", () => {
    it("seals every file but the header: none holds the pod's title, its Turtle or its answer rows in the clear", async () => {
      const { folder: at, encrypted } = await sealedPod();
      assert.ok(encrypted);
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
  });

  describe("when a sealed pod is opened", () => {
    it("opens with the secret and answers as before", async () => {
      const { folder: at, rows } = await sealedPod();
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

    it("opens with the words as a person types them: capitals, commas, a hyphen missing", async () => {
      const { folder: at } = await sealedPod();
      const typed = await openFolderPod({ ...kept, derive: fastDerive() }, at, {
        secret: " T-SHIRT, Abacus yo yo zoom drop down felt-tip ",
      });
      try {
        assert.ok(typed.encrypted);
      } finally {
        await typed.close();
      }
    });

    it("throws `Unopened` with the reason in `outcome`: `secret needed` without a secret, `incorrect secret` with other words", async () => {
      const { folder: at } = await sealedPod();
      const parts = { ...kept, derive: fastDerive() };
      assert.equal(
        (await unopenedBy(openFolderPod(parts, at, {}))).outcome,
        "secret needed",
      );
      assert.equal(
        (await unopenedBy(openFolderPod(parts, at, { secret: "a b c d e f" })))
          .outcome,
        "incorrect secret",
      );
    });

    it("throws `Unopened` for a header it cannot read, before working out any key and without writing", async () => {
      const newer = join(pods, "newer");
      await mkdir(join(newer, "settings"), { recursive: true });
      await writeFile(
        join(newer, "settings", "encryption.json"),
        JSON.stringify({ version: "2.0", algorithm: "aes-256-gcm", wraps: [] }),
      );
      const directory = join(pods, "directory");
      await mkdir(join(directory, "settings", "encryption.json"), {
        recursive: true,
      });
      const derive = fastDerive();
      const parts = { ...kept, derive };
      for (const [name, at, secret, outcome] of [
        [
          "a version 2.0 header, no secret",
          newer,
          undefined,
          "unsupported version",
        ],
        ["a version 2.0 header, a secret", newer, WORDS, "unsupported version"],
        ["a header that is a directory", directory, WORDS, "malformed"],
      ] as const) {
        const held = await filesIn(at);
        const refused = await unopenedBy(
          openFolderPod(parts, at, secret === undefined ? {} : { secret }),
        );
        assert.equal(refused.outcome, outcome, name);
        assert.deepEqual(await filesIn(at), held, name);
      }
      assert.equal(derive.calls, 0);
    });
  });

  describe("when a secret is given for a pod that is not sealed", () => {
    it("throws `Unopened` with `not encrypted` for a pod on disk", async () => {
      const plain = join(pods, "plain");
      const pod = await openPodWith(kept, plain);
      try {
        await pod.ask(HELD);
      } finally {
        await pod.close();
      }
      const refused = await unopenedBy(
        openFolderPod({ ...kept, derive: fastDerive() }, plain, {
          secret: WORDS,
        }),
      );
      assert.equal(refused.outcome, "not encrypted");
    });

    it("throws `Refusal` for a pod in memory, which is never encrypted", async () => {
      await assert.rejects(
        openFolderPod({ ...kept, derive: fastDerive() }, undefined, {
          secret: WORDS,
        }),
        (error) => error instanceof Refusal && !(error instanceof Unopened),
      );
    });
  });

  describe("when two openings make the same new pod at once", () => {
    const opening = (at: string, secret: string, derive: DeriveKey) =>
      podKey(
        {
          files: new FolderFiles(at),
          header: undefined,
          reread: () => headerIn(at),
          held: async () => false,
        },
        secret,
        derive,
      );

    it("leaves one header, so each opening reads what the other sealed", async () => {
      const derive = fastDerive();
      const at = join(pods, "raced");
      const [first, second] = await Promise.all([
        opening(at, WORDS, derive),
        opening(at, WORDS, derive),
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

    it("opens for one secret and throws `incorrect secret` for the other when the two differ", async () => {
      const derive = fastDerive();
      const other = join(pods, "raced-apart");
      const outcomes = await Promise.all(
        [WORDS, "a b c d e f"].map((secret) =>
          opening(other, secret, derive).then(
            () => "opened",
            (error: unknown) =>
              error instanceof Unopened ? error.outcome : "other",
          ),
        ),
      );
      assert.deepEqual(outcomes.sort(), ["incorrect secret", "opened"]);
    });
  });
});

/**
 * A kit is a scripted patient story that cascade-vocabulary carries for testing, such as `alex-rivera`: the exports the
 * patient downloaded and every step taken with them, in order. From `cascade-runtime/fixtures`, a developer gets a
 * realistic pod or export for a test without writing one.
 */
describe("Sample pods and exports to build against · replayKit(), kitDownload()", () => {
  describe("kitDownload(kit, name)", () => {
    it("returns the path of one of the kit's exports: a folder for an Apple Health export, a file for a C-CDA document", async () => {
      const x12 = await kitDownload("alex-rivera", "x-e12");
      assert.ok(
        (await readdir(x12)).includes("apple_health_export"),
        "an Apple Health export",
      );
      assert.match(
        await readFile(
          await kitDownload(
            "priya-natarajan",
            "kestrel-harbor-health-summary.xml",
          ),
          "utf8",
        ),
        /<ClinicalDocument/,
        "a C-CDA document",
      );
    });

    it("throws `Refusal`, naming the kits or the exports there are, for a name it doesn't have", async () => {
      for (const [name, refused, reason] of [
        [
          "a kit it doesn't carry",
          () => kitDownload("no-such-kit", "x-e12"),
          /there are .*alex-rivera/,
        ],
        [
          "an export the kit doesn't have",
          () => kitDownload("alex-rivera", "x-e99"),
          /it has .*x-e12/,
        ],
      ] as const)
        await assert.rejects(
          refused(),
          (error) => error instanceof Refusal && reason.test(error.message),
          name,
        );
    });
  });

  describe("replayKit(kit, folder, { through })", () => {
    const parent = () => join(pods, "kits");
    const at = () => join(parent(), "alex-rivera");
    let steps: Awaited<ReturnType<typeof replayKit>>;
    let story: readonly string[];
    let replayed: Pod;

    before(async () => {
      steps = await replayKit("alex-rivera", at(), { through: "J10" });
      story = (await kitStory("alex-rivera", { through: "J10" })).steps.map(
        ({ name }) => name,
      );
      replayed = await openPod(at());
    });

    after(async () => {
      await replayed.close();
      await settled(parent());
    });

    it("performs the story's steps in order, from making the pod to the step named, and returns them", () => {
      assert.deepEqual([steps[0]?.step, steps[0]?.kind], ["E1", "creation"]);
      assert.equal(steps.at(-1)?.step, "J10");
      // `replayKit` does not perform the story's `reference` and `open` steps, so its steps are some of the story's.
      assert.ok(
        inOrder(
          steps.map(({ step }) => step),
          story,
        ),
      );
    });

    it("builds a pod that `openPod` opens as the story's person, at the story's address", async () => {
      const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
      assert.ok(
        people.some(
          ([s, p, o]) =>
            s.value === replayed.subject &&
            p.value === STORAGE &&
            o.value === replayed.address,
        ),
      );
    });

    it("matches with the app's own reference tables (code lists such as RxNorm), so opening the pod afterwards changes nothing", async () => {
      assert.equal(replayed.opened, undefined);
      const used = await select(
        replayed,
        `SELECT DISTINCT ?version WHERE {
          ?judgment prov:wasAttributedTo <${MATCHER}> .
          { ?judgment prov:wasDerivedFrom ?version }
          UNION { ?assertion cascade:assertedClaim ?judgment ; cascade:assertedUnderRuleListVersion ?version }
          ?version prov:specializationOf/a cascade:ReferenceSeries }`,
      );
      const cited = used.map(({ version }) => version ?? "");
      const held = shipped(await (await tablesBeside(parent())).references());
      assert.ok(cited.length > 0, "the matcher cites no reference");
      for (const version of cited)
        assert.ok(held.includes(version), `${version} is not the app's`);
    });

    it("throws for a folder that already holds files, a kit it doesn't carry, or a step the story doesn't have", async () => {
      const empty = join(parent(), "next");
      await assert.rejects(
        replayKit("alex-rivera", at()),
        /holds files/,
        "a folder that holds files",
      );
      await assert.rejects(
        replayKit("no-such-kit", empty),
        /alex-rivera/,
        "a kit it doesn't carry",
      );
      await assert.rejects(
        replayKit("alex-rivera", empty, { through: "no such step" }),
        /no such step/,
        "a step the story doesn't have",
      );
    });
  });
});

/**
 * A site can save a pod's answers as files, so a web page shows the pod without first downloading the query engine. A
 * sample is a kit's pod saved this way, and a lookup is what the reference tables say about one code.
 */
describe("Publishing a pod for a browser · answersToPublish(), samplesToPublish()", () => {
  const NOT_ASKED = new Error("the tables were asked");
  let alex: Pod;
  let folder: string;
  let publishing: Awaited<ReturnType<typeof partsOf>>;
  let codes: string[];
  let published: Map<string, Uint8Array>;
  let files: MemoryFiles;

  /** The pod as a page reads it: its files and the published answers kept under the runtime. */
  const reading = (runtime: string) =>
    keptPod(pageParts(), new FolderFiles(folder), new Answers(files, runtime));

  /** The app's tables but for `about`, which fails: a lookup answered from a file does not ask them. */
  const unread = () =>
    new Proxy(publishing.tables, {
      get: (target, property) =>
        property === "about"
          ? () => Promise.reject(NOT_ASKED)
          : (Reflect.get(target, property, target) as () => unknown).bind(
              target,
            ),
    });

  before(async () => {
    alex = await readingAlex();
    folder = (await alexPod()).folder;
    const own = new FolderFiles(folder);
    const podFiles = new Map<string, Uint8Array>();
    for (const path of await own.list("")) {
      const bytes = await own.read(path);
      if (bytes !== undefined) podFiles.set(path, bytes);
    }
    publishing = await partsOf(await checkouts(root));
    codes = (await alex.ask(QUESTION)).flatMap((row) =>
      Object.values(row).filter((value) => value.startsWith("http")),
    );
    published = await answersToPublish(publishing, podFiles, {
      name: "pod",
      runtime: "published",
      lookups: (_pod, tables) => tables.about(codes),
    });
    files = new MemoryFiles("urn:test:answers/");
    for (const [path, bytes] of published) await files.write(path, bytes);
  });

  after(async () => {
    await alex.close();
  });

  describe("answersToPublish(parts, podFiles, { lookups })", () => {
    it("returns three files: `answers.json`, `pod.json` and, for the lookups it is given, `lookups.json`", () => {
      assert.deepEqual([...published.keys()].sort(), [
        "answers.json",
        "lookups.json",
        "pod.json",
      ]);
      assert.ok(lookupsOf(published.get(LOOKUPS)));
    });

    it("records in `pod.json` the versions of the reference tables it used", async () => {
      assert.deepEqual(
        (await new Answers(files, "published").described())?.tables,
        shipped(await publishing.tables.references()),
      );
    });
  });

  describe("when a browser reads the published files", () => {
    it("names the same pod as the open pod: address, subject, owner", async () => {
      const read = await reading("published");
      assert.ok(read);
      assert.deepEqual(
        [read.address, read.subject, read.owner],
        [alex.address, alex.subject, alex.owner],
      );
    });

    it("returns the same rows as the open pod for every question in the vocabulary", async () => {
      const read = await reading("published");
      assert.ok(read);
      for (const question of (await questions(kept.vocabulary)).keys())
        assert.deepEqual(
          await read.rows(question),
          await alex.ask(question),
          question,
        );
    });

    it("answers a lookup from `lookups.json`, without the reference tables", async () => {
      const lookups = lookupsOf(await files.read(LOOKUPS));
      assert.ok(lookups);
      assert.ok(codes.length > 0);
      assert.deepEqual(
        await withLookups(unread(), lookups, "published").about(codes),
        await publishing.tables.about(codes),
      );
    });

    it("ignores answers and lookups that a different version of the runtime wrote", async () => {
      assert.equal(
        await (await reading("another"))?.rows(QUESTION),
        undefined,
        "answers kept under another version",
      );
      const lookups = lookupsOf(await files.read(LOOKUPS));
      assert.ok(lookups);
      await assert.rejects(
        withLookups(unread(), lookups, "another runtime").about(codes),
        /the tables were asked/,
        "lookups kept under another version",
      );
    });

    it("throws `Refusal` for a question or a lens the vocabulary doesn't have", async () => {
      const read = await reading("published");
      assert.ok(read);
      await assert.rejects(
        read.rows("pod/No such question"),
        (error) =>
          error instanceof Refusal && /no question/.test(error.message),
        "a question it doesn't have",
      );
      await assert.rejects(
        read.rows(QUESTION, "no such lens"),
        (error) => error instanceof Refusal && /no lens/.test(error.message),
        "a lens it doesn't have",
      );
    });
  });

  describe("samplesToPublish({ kits })", () => {
    let samples: Awaited<ReturnType<typeof samplesOf>>;
    const sourceOf = async () => ({
      components: await checkouts(root),
      runtime: "copying",
    });

    before(async () => {
      samples = await samplesOf(await sourceOf(), {
        kits: ["alex-rivera"],
        lookups: async () => undefined,
      });
    });

    it("returns every kit's name and title, whichever kits were asked for", () => {
      assert.ok(samples.kits.size > 1);
      assert.match(samples.kits.get("alex-rivera") ?? "", /Alex/);
    });

    it("returns each sample as the pod's files, a list of them and one pack of them, beside its `answers.json`, `pod.json` and `lookups.json`", () => {
      const text = (path: string): string =>
        new TextDecoder().decode(samples.files.get(path));
      const POD = "alex-rivera/pod/";
      const listed = JSON.parse(text(`${POD}files.json`)) as string[];
      assert.ok(listed.length > 0);
      assert.deepEqual(
        [...samples.files.keys()].sort(),
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

    it("throws `Refusal`, naming the kits there are, for a kit the vocabulary doesn't carry", async () => {
      await assert.rejects(
        samplesOf(await sourceOf(), { kits: ["no-such-kit"] }),
        (error) =>
          error instanceof Refusal &&
          /there are .*alex-rivera/.test(error.message),
      );
    });

    it("throws a plain `Error`, naming the kit, the step and the file, when a file the kit needs is missing", async () => {
      const whole = await checkouts(root);
      const copy = join(pods, "lacking");
      const found = await whole.resolve(whole.config.vocabulary);
      await cp(found.folder, copy, {
        recursive: true,
        filter: (path) =>
          !/(^|[\\/])(\.[^\\/]+|node_modules)([\\/]|$)/.test(
            relative(found.folder, path),
          ),
      });
      await rm(join(copy, `${KIT}/scripted-input/alex/entries/a1.ttl`));
      const lacking = {
        ...whole,
        resolve: async (component: Parameters<typeof whole.resolve>[0]) =>
          component === whole.config.vocabulary
            ? { ...found, folder: copy }
            : whole.resolve(component),
      };
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
});
