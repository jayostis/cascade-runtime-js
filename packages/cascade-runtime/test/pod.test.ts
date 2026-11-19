import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFile,
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
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import {
  conversionBudget,
  type DeriveKey,
  EncryptedFiles,
  type Files,
  findingName,
  type FolderPack,
  HEADER,
  iri,
  isBridgeError,
  Layout,
  madeNewPod,
  MATCHER,
  MemoryFiles,
  newHeader,
  ntriples,
  openHeader,
  OxigraphStore,
  type Placed,
  type PodKey,
  questions,
  RDF,
  replaced,
  SEALED_INDEX,
  SealedIndex,
  type Triple,
  valuesOf,
} from "@cascade-runtime/runtime";
import {
  checkouts,
  findRoot,
  FolderFiles,
  headerIn,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { probing } from "@cascade-runtime/runtime/probe";
import { pullFiles } from "../src/connect/index.js";
import { shipped } from "../src/tables.js";
import {
  checkSecret,
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
import { checkFolderSecret, openFolderPod } from "../src/node/folder-pod.js";
import { answersToPublish, partsOf } from "../src/node/published.js";
import {
  answersBeside,
  builtCode,
  keptBeside,
  resolved,
} from "../src/node/resolved.js";
// `samplesToPublish` throws outside a packed package; `samplesOf` is the body it hands its packed source to.
import { samplesOf } from "../src/node/samples.js";
// A browser's `openPod` reads published answers with `keptPod` and `withLookups`, which a Node test cannot call as a page does.
import {
  keptPod,
  openPodWith,
  type Parts,
  type Row,
  type TextRow,
  textRow,
} from "../src/pod.js";
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
/** The pod's working copy, kept beside it in its answers' folder. */
const BUILT_BESIDE = "build.trig";
const SESSION = "5c5734fb-433f-4ed1-8de7-1ad16d7d21cc";

type Looked = Awaited<ReturnType<Pod["look"]>>;
type Rows = TextRow[];
type Done = Awaited<ReturnType<Pod["enter"]>>;
type Imported = Awaited<ReturnType<Pod["import"]>>;

let kit: string;
let pods: string;
let root: string;
/**
 * The parts a packed runtime opens a pod with, its answers kept beside it, but with no database beside it, as a
 * browser and a published pod keep answers: every question is answered from the kept answers or the build.
 */
let kept: Parts;

before(async () => {
  root = findRoot(dirname(fileURLToPath(import.meta.url)));
  kit = (await localVocabulary(root)).files.folder;
  pods = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
  kept = {
    ...(await resolved()),
    answers: { runtime: "test", at: answersBeside },
    databaseBeside: undefined,
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

/** Every file the folder holds, with its bytes and its modification time. */
async function heldIn(at: string): Promise<Map<string, [string, number]>> {
  const held = new Map<string, [string, number]>();
  for (const path of await filesIn(at))
    held.set(path, [
      (await readFile(path)).toString("base64"),
      (await stat(path)).mtimeMs,
    ]);
  return held;
}

/** A judgment as the guide's template writes it: by the owner, as the patient. */
function judgment(
  by: Pod,
  statements: readonly string[],
  named = "urn:cascade:this-judgment",
  ownerTypes: readonly string[] = ["prov:Person"],
): string {
  return `${PREFIXES}
<${named}> a cascade:Judgment ;
    ${statements.join(" ;\n    ")} ;
    prov:wasAttributedTo <${by.owner}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${by.owner}> ; prov:hadRole cascade:PatientRole ] ] .
${ownerTypes.length === 0 ? "" : `<${by.owner}> a ${ownerTypes.join(" , ")} .`}`;
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

/** The owner's statement that a hospital's patient is not them. */
function notAbout(by: Pod, profile: string): string {
  return judgment(by, [
    "cascade:verdict cascade:NotAbout",
    `cascade:subject <${by.subject}>`,
    `prov:hadMember <${profile}>`,
  ]);
}

/** The owner's retraction of a judgment they filed. */
function retraction(by: Pod, filed: string): string {
  return `${PREFIXES}
<urn:cascade:this-judgment> a prov:Activity ;
    prov:invalidated <${filed}> ;
    prov:wasAssociatedWith <${by.owner}> ;
    prov:qualifiedAssociation [ prov:agent <${by.owner}> ; prov:hadRole cascade:PatientRole ] .
<${by.owner}> a prov:Person .`;
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

/** The owner's Acknowledged of the warning kinds given, over what the warning is about. */
function acknowledged(
  by: Pod,
  kinds: readonly string[],
  members: readonly string[],
): string {
  return judgment(by, [
    "cascade:verdict cascade:Acknowledged",
    ...kinds.map((kind) => `cascade:answersWarningOfKind cascade:${kind}`),
    ...members.map((member) => `prov:hadMember <${member}>`),
  ]);
}

/** Alex's first entry session as the owner of `of` enters it; `session` names another act than the kit's. */
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
  return (await of.ask(QUESTION))
    .map(textRow)
    .map(({ allergenName }) => allergenName ?? "")
    .sort();
}

function select(of: Pod, query: string): Promise<TextRow[]> {
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
      const claimProfiles = [await profileOf("J1"), await profileOf("J2")];
      const e2 = await pod.import(exported("x-e2"), {
        claimProfiles,
        onProgress: (progress) => {
          told.push(progress);
        },
      });
      const e4 = await pod.import(exported("x-e4"), { claimProfiles });
      const e6 = await pod.import(exported("x-e6"), { claimProfiles });
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

/** A new pod, with Alex's first owner-entered record filed in it, and the view entry it is in and the record. */
async function enteredPod(
  name: string,
): Promise<{ pod: Pod; entry: string; record: string }> {
  const pod = await openPodWith(kept, join(pods, name));
  const entered = await pod.enter(await entryFor(pod));
  assert.ok(entered.activity);
  const [peanuts] = await select(
    pod,
    `SELECT ?entry ?record WHERE { ?entry cascade:allergenName "Peanuts" ; cascade:entryMember ?record }`,
  );
  const { entry = "", record = "" } = peanuts ?? {};
  assert.ok(entry && record);
  return { pod, entry, record };
}

/** An entry session by the owner of `of`, filed without the matcher, and the parents of the snapshot its act left. */
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
 * `openPod` makes a new pod in a folder, or in memory when no folder is given. Everything else an app does starts
 * from the pod it returns.
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

  it("gives an owner and files that all lie under its address", async () => {
    assert.ok(fresh.owner.startsWith(fresh.address));
    const rows = (await fresh.ask("pod/Which file states each thing")).map(
      textRow,
    );
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
 * `look` lists an export's sources and saves nothing, so an app can say whose records an export holds before it
 * imports them. An Apple Health export holds the records of every hospital the person's phone is connected to; a
 * C-CDA document is a summary file from one patient portal.
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
    it("returns one source named for the document's custodian, with its sections by title, when it was received, and no server", () => {
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
 * `import` stores an export's records in the pod. They show in answers only once the owner has claimed the export's
 * patient, and the matcher then joins records of the same thing from different hospitals.
 * @rule runtime/arrivals.feature A14
 * @rule conformance/alex-rivera/alex-rivera.feature P8
 * @rule conformance/alex-rivera/alex-rivera.feature P24
 */
describe("Importing a health export · pod.import()", () => {
  let waiting: Pod;
  let imported: Imported;
  let shown: Row[];
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
    it("returns the import as `activity`, with the files it stored in `wrote`", () => {
      assert.ok(imported.activity);
      assert.ok(imported.wrote.length > 0);
    });

    it("returns the export's patient in `unclaimedProfiles` and nobody in `claimedProfiles`", () => {
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

  describe("given a claim the owner retracted, and a later import naming the same patient", () => {
    it("returns the patient in `unclaimedProfiles` again, with the export's other patient", async () => {
      const retracting = await openPodWith(kept, join(pods, "retracted"));
      try {
        await retracting.import(exported("x-e2"), { match: false });
        const claim = await retracting.judge(about(retracting, profile));
        assert.ok(claim.judgment);
        await retracting.judge(retraction(retracting, claim.judgment));
        const later = await retracting.import(exported("x-e6"), {
          match: false,
        });
        assert.deepEqual(later.claimedProfiles, []);
        assert.deepEqual(
          later.unclaimedProfiles,
          [profile, await profileOf("J2")].sort(),
        );
      } finally {
        await retracting.close();
      }
    });
  });

  describe("given the owner's NotAbout over the export's patient, and a later import naming it", () => {
    it("claims nothing and files no About, with the list naming that patient and without it, and returns it in `disclaimedProfiles`", async () => {
      const [j1, j2] = [await profileOf("J1"), await profileOf("J2")];
      for (const [name, claimProfiles, claimed, unclaimed] of [
        ["without a list", undefined, [], [j2]],
        ["with a list naming it", [j1], [], [j2]],
        ["with a list naming it and the other patient", [j1, j2], [j2], []],
      ] as const) {
        const denying = await openPodWith(
          kept,
          join(pods, `not-about-${name}`),
        );
        try {
          await denying.import(exported("x-e2"), { match: false });
          await denying.judge(notAbout(denying, j1));
          const later = await denying.import(exported("x-e6"), {
            ...(claimProfiles === undefined ? {} : { claimProfiles }),
          });
          assert.deepEqual(
            later.claimedProfiles.map(({ profile }) => profile),
            claimed,
            name,
          );
          assert.deepEqual(later.unclaimedProfiles, unclaimed, name);
          assert.deepEqual(later.disclaimedProfiles, [j1], name);
          assert.deepEqual(later.heldBackProfiles, [], name);
          assert.deepEqual(
            await select(
              denying,
              `SELECT ?about WHERE { ?about cascade:verdict cascade:About ; prov:hadMember <${j1}> }`,
            ),
            [],
            `${name}: an About for the patient the owner said is not them`,
          );
          if (claimed.length === 0)
            assert.deepEqual(await allergens(denying), [], name);
        } finally {
          await denying.close();
        }
      }
    });

    it("returns the patient in `heldBackProfiles`, and claims nothing for it, when an About of the owner's stands against the NotAbout", async () => {
      const [j1, j2] = [await profileOf("J1"), await profileOf("J2")];
      const disagreeing = await openPodWith(kept, join(pods, "held-back"));
      try {
        await disagreeing.import(exported("x-e2"), { match: false });
        await disagreeing.judge(notAbout(disagreeing, j1));
        await disagreeing.judge(about(disagreeing, j1));
        const later = await disagreeing.import(exported("x-e6"), {
          match: false,
          claimProfiles: [j1, j2],
        });
        assert.deepEqual(
          later.claimedProfiles.map(({ profile }) => profile),
          [j2],
        );
        assert.deepEqual(later.heldBackProfiles, [j1]);
        assert.deepEqual(later.disclaimedProfiles, []);
        assert.deepEqual(later.unclaimedProfiles, []);
      } finally {
        await disagreeing.close();
      }
    });
  });

  describe("given a pull that names three patients", () => {
    it("returns all three in `unclaimedProfiles`, in order of their IRIs", async () => {
      const allergy = (id: string, patient: string) => ({
        resourceType: "AllergyIntolerance",
        id,
        clinicalStatus: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
            },
          ],
        },
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "91935009",
              display: "Peanuts",
            },
          ],
          text: "Peanuts",
        },
        patient: { reference: `Patient/${patient}` },
        onsetDateTime: "2020-01-01",
      });
      const fhirBase = "https://fhir.two-patients.invalid/r4";
      const ordering = await openPodWith(kept, join(pods, "two-patients"));
      try {
        const done = await ordering.import(
          pullFiles(
            {
              fhirBase,
              patient: "zeta",
              source: "Two Patients Hospital",
              retrievedAt: "2026-11-01T09:00:00Z",
              bundle: {
                resourceType: "Bundle",
                type: "collection",
                entry: [
                  {
                    fullUrl: `${fhirBase}/AllergyIntolerance/a1`,
                    resource: allergy("a1", "zeta"),
                  },
                  {
                    fullUrl: `${fhirBase}/AllergyIntolerance/a2`,
                    resource: allergy("a2", "mu"),
                  },
                  {
                    fullUrl: `${fhirBase}/AllergyIntolerance/a3`,
                    resource: allergy("a3", "alpha"),
                  },
                ],
              },
            },
            "pull",
          ),
          { match: false },
        );
        assert.equal(done.unclaimedProfiles.length, 3);
        assert.deepEqual(
          done.unclaimedProfiles,
          [...done.unclaimedProfiles].sort(),
        );
      } finally {
        await ordering.close();
      }
    });
  });

  describe("with `claimProfiles`, the list of the patients the person confirmed", () => {
    it("claims exactly the listed patients the import names, once each, and returns the rest in `unclaimedProfiles`", async () => {
      const [j1, j2] = [await profileOf("J1"), await profileOf("J2")];
      for (const [name, list, claimed, unclaimed] of [
        ["one of two", [j1], [j1], [j2]],
        ["the same one twice", [j2, j2], [j2], [j1]],
        ["none", [], [], [j1, j2]],
        ["one the import does not name", ["urn:uuid:not-in-it"], [], [j1, j2]],
      ] as const) {
        const claiming = await openPodWith(kept, join(pods, `list-${name}`));
        try {
          const done = await claiming.import(exported("x-e6"), {
            claimProfiles: list,
            match: false,
          });
          assert.deepEqual(
            done.claimedProfiles.map(({ profile }) => profile),
            claimed,
            name,
          );
          assert.deepEqual(done.unclaimedProfiles, [...unclaimed].sort(), name);
          assert.deepEqual(done.disclaimedProfiles, [], name);
        } finally {
          await claiming.close();
        }
      }
    });

    it("files no About for a pod's own subject, and none for a patient a counting About already ties", async () => {
      const [j1, j2] = [await profileOf("J1"), await profileOf("J2")];
      const tied = await openPodWith(kept, join(pods, "list-tied"));
      try {
        await tied.import(exported("x-e2"), { match: false });
        await tied.judge(about(tied, j1));
        const done = await tied.import(exported("x-e6"), {
          claimProfiles: [j1, j2, tied.subject],
          match: false,
        });
        assert.deepEqual(
          done.claimedProfiles.map(({ profile }) => profile),
          [j2],
        );
      } finally {
        await tied.close();
      }
    });
  });

  describe("with `claimProfiles` naming both of Alex's patients, on each of his exports", () => {
    it("returns one claim in `claimedProfiles` for each patient not yet claimed, and an empty `unclaimedProfiles`", async () => {
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

    it("returns the matcher's run in `matched`, with the files it wrote", async () => {
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

  describe("with `timeBudgetSeconds` or `memoryBudgetMiB`, the limits of a conversion", () => {
    it("rejects with the Bridge's budget error when a budget is smaller than the conversion needs, writing nothing, and then converts with the Bridge's own defaults", async () => {
      const at = join(pods, "budget");
      const small = await openPodWith(kept, at);
      try {
        const held = await filesIn(at);
        for (const budget of [
          { timeBudgetSeconds: 1e-9 },
          { memoryBudgetMiB: 1 },
        ])
          await assert.rejects(
            small.import(exported("x-e2"), { match: false, ...budget }),
            (error) =>
              isBridgeError(error) &&
              error.kind === "bridge" &&
              /budget/.test(error.message),
            JSON.stringify(budget),
          );
        assert.deepEqual(await filesIn(at), held);
        const after = await small.import(exported("x-e2"), {
          match: false,
          timeBudgetSeconds: 120,
          memoryBudgetMiB: 1024,
        });
        assert.equal(after.refused, undefined, "the next import");
        assert.ok(after.wrote.length > 0);
      } finally {
        await small.close();
      }
    });
  });

  describe("with no `timeBudgetSeconds`, the time a conversion may take by the size of its document", () => {
    it("holds each conversion to 120 seconds or 4 seconds a megabyte of the document, the more of the two, and to the Bridge's own heap; a budget given is kept", () => {
      const MB = 1_000_000;
      assert.deepEqual(
        [
          [0, {}],
          [30 * MB, {}],
          [30 * MB + 1, {}],
          [100 * MB, {}],
          [100 * MB, { memoryBudgetMiB: 2048 }],
          [100 * MB, { timeBudgetSeconds: 5 }],
        ].map(([bytes, given]) =>
          conversionBudget(given as object, bytes as number),
        ),
        [
          { timeBudgetSeconds: 120 },
          { timeBudgetSeconds: 120 },
          { timeBudgetSeconds: 120.000004 },
          { timeBudgetSeconds: 400 },
          { timeBudgetSeconds: 400, memoryBudgetMiB: 2048 },
          { timeBudgetSeconds: 5 },
        ],
      );
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

    it("throws the callback's own error when the callback throws at its first call, with no file added to the pod's folder", async () => {
      const at = join(pods, "stopped");
      const stopped = await openPodWith(kept, at);
      try {
        const held = await filesIn(at);
        const thrown = new Error("not told");
        await assert.rejects(
          stopped.import(exported("x-e2"), {
            onProgress: async () => {
              throw thrown;
            },
          }),
          (error) => error === thrown,
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
      assert.equal(loaded, 0, "the adapter was loaded");
    }

    it("returns `refused` before the adapter loads, with nothing written", async () => {
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

  it("returns the stored connection as `activity`, with its files in `wrote`", () => {
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
 * `ask` answers a named question, or the app's own SELECT query in SPARQL (the W3C query language), as rows of plain
 * strings. It answers under a lens, `everyday` unless the app names another.
 */
describe("Asking a pod questions · pod.ask()", () => {
  let alex: Pod;

  before(async () => {
    alex = await readingAlex();
  });

  after(async () => {
    await alex.close();
  });

  it("answers a named question with a string for each column and an array of strings for each column the vocabulary declares a list", async () => {
    const rows = await alex.ask(QUESTION);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      for (const [column, value] of Object.entries(row))
        if (column === "sources" || column === "reactionsByRecord") {
          assert.ok(Array.isArray(value), column);
          assert.ok(
            value.length > 0 && value.every((each) => each.startsWith("urn:")),
            `${column}: ${JSON.stringify(value)}`,
          );
        } else assert.equal(typeof value, "string", column);
    }
  });

  it("gives a query of its own's columns as strings, whatever their names", async () => {
    const [row] = await alex.ask({
      query: `SELECT ("a; urn:b" AS ?sources) WHERE {}`,
    });
    assert.equal(row?.sources, "a; urn:b");
  });

  it("ends a list column's value at every declared separator, so a value's own '; ' stays in it", () => {
    const records = { column: "x", separator: "\u001f" };
    assert.deepEqual(
      valuesOf("urn:a 5 mg; as needed, daily\u001furn:b 10 mg", records),
      ["urn:a 5 mg; as needed, daily", "urn:b 10 mg"],
    );
    assert.deepEqual(valuesOf("urn:a one", records), ["urn:a one"]);
    assert.deepEqual(valuesOf("", records), []);
  });

  it("runs the app's own SELECT under the lens named, and returns none of the `export` lens's rows when none is named", async () => {
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
 * A person can add a record no hospital holds, such as an allergy they know they have. The app writes the record in
 * Turtle from a template in the guide, and because it is the owner's own, it needs no claim.
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
      `SELECT ?entry ?record WHERE { ?entry cascade:allergenName "Peanuts" ; cascade:entryMember ?record }`,
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

  it("returns the entry session as `activity` and the matcher's run on it as `matched`", () => {
    assert.equal(entered.refused, undefined);
    assert.ok(entered.activity);
    assert.ok(entered.matched);
  });

  it("shows the record in answers with no claim", () => {
    assert.deepEqual(claims, []);
    assert.equal(peanuts.length, 1);
  });

  it("returns `refused`, with nothing written, for Turtle the pod's rules turn down", () => {
    assert.ok(twice.refused);
    assert.deepEqual(twice.wrote, []);
    assert.deepEqual(left, held);
  });
});

/**
 * `judge` files a judgment the owner has made: a claim, a Same, a Different or an Erroneous. The app writes it in
 * Turtle from the template in `packages/cascade-runtime/guide/AGENTS.md`, naming it `urn:cascade:this-judgment`, and
 * `judge` returns the lasting name the pod gives it.
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

    it("cites nothing for a record entered by hand, which came from no document, and never its version", () => {
      assert.equal(current.length, 1);
      assert.deepEqual(cited, []);
    });
  });

  describe("given an acknowledgement of a warning", () => {
    const KIND = "ClockBehind";
    const PAIR_KIND = "MatcherJudgmentsNoLongerReached";
    const elsewhere = "urn:uuid:3f6c2a8e-7d41-4b9a-a5e2-0c8d9b1f4e67";
    const another = "urn:uuid:5a1d7c3e-2b94-4e08-9f6a-1d3c8e7b2a40";

    it("files one of a kind of a pair over exactly the pair's two records", async () => {
      const filed = await owned.judge(
        acknowledged(owned, [PAIR_KIND], [record, elsewhere]),
      );
      assert.equal(filed.refused, undefined);
    });

    it("files one of a kind the vocabulary names that this runtime has no code for", async () => {
      const at = join(pods, "sixth-kind");
      await cp((await alexPod()).folder, at, { recursive: true });
      const ontology = "ontologies/cascade.ttl";
      const { vocabulary } = kept;
      const sixth: Files = {
        iri: vocabulary.iri,
        write: (path, bytes) => vocabulary.write(path, bytes),
        list: (folder) => vocabulary.list(folder),
        read: async (path) => {
          const bytes = await vocabulary.read(path);
          return bytes !== undefined &&
            (path === ontology || path === vocabulary.iri + ontology)
            ? new TextEncoder().encode(
                `${new TextDecoder().decode(bytes)}\n<${CASCADE}SixthKind> <http://www.w3.org/2004/02/skos/core#inScheme> <${CASCADE}FindingForReviewKinds> .\n`,
              )
            : bytes;
        },
      };
      const turtle = (by: Pod) =>
        judgment(by, [
          "cascade:verdict cascade:Acknowledged",
          "cascade:answersWarningOfKind cascade:SixthKind",
          `prov:hadMember <${elsewhere}>`,
        ]);
      const plain = await openPodWith(kept, at);
      try {
        await assert.rejects(plain.judge(turtle(plain)), /kind of warning/);
      } finally {
        await plain.close();
      }
      const named = await openPodWith({ ...kept, vocabulary: sixth }, at);
      try {
        assert.equal(await named.checkJudgment(turtle(named)), undefined);
        assert.equal((await named.judge(turtle(named))).refused, undefined);
      } finally {
        await named.close();
      }
    });

    it("refuses, saying the vocabulary names no warning kinds, an Acknowledged on a vocabulary that names none", async () => {
      const at = join(pods, "no-kinds");
      await cp((await alexPod()).folder, at, { recursive: true });
      const ontology = "ontologies/cascade.ttl";
      const { vocabulary } = kept;
      const none: Files = {
        iri: vocabulary.iri,
        write: (path, bytes) => vocabulary.write(path, bytes),
        list: (folder) => vocabulary.list(folder),
        read: async (path) => {
          const bytes = await vocabulary.read(path);
          return bytes !== undefined &&
            (path === ontology || path === vocabulary.iri + ontology)
            ? new TextEncoder().encode(
                new TextDecoder()
                  .decode(bytes)
                  .replaceAll(
                    "FindingForReviewKinds",
                    "FindingForReviewKindsGone",
                  ),
              )
            : bytes;
        },
      };
      const bare = await openPodWith({ ...kept, vocabulary: none }, at);
      try {
        const turtle = acknowledged(bare, [KIND], [elsewhere]);
        await assert.rejects(bare.judge(turtle), /names no warning kinds/);
        assert.match(
          (await bare.checkJudgment(turtle)) ?? "",
          /names no warning kinds/,
        );
      } finally {
        await bare.close();
      }
    });

    it("throws, writing nothing, for a verdict other than an Acknowledged that names a kind of warning", async () => {
      const held = await filesIn(join(pods, "judged"));
      for (const verdictName of ["Same", "Different", "Erroneous"]) {
        const turtle = judgment(owned, [
          `cascade:verdict cascade:${verdictName}`,
          `cascade:answersWarningOfKind cascade:${KIND}`,
          `prov:hadMember <${record}>`,
          `prov:hadMember <${elsewhere}>`,
        ]);
        await assert.rejects(owned.judge(turtle), /only an Acknowledged/);
        assert.match(
          (await owned.checkJudgment(turtle)) ?? "",
          /only an Acknowledged/,
          verdictName,
        );
      }
      assert.deepEqual(await filesIn(join(pods, "judged")), held);
    });

    it("throws, writing nothing, for an Acknowledged of a kind of a pair that does not name exactly two records", async () => {
      const held = await filesIn(join(pods, "judged"));
      for (const [what, members] of [
        ["one record", [record]],
        ["three records", [record, elsewhere, another]],
      ] as const)
        for (const kind of [
          PAIR_KIND,
          "DifferentResultValuesAtOneInstant",
          "DifferentResultUnitsAtOneInstant",
        ]) {
          const turtle = acknowledged(owned, [kind], members);
          await assert.rejects(owned.judge(turtle), /exactly the pair/);
          assert.match(
            (await owned.checkJudgment(turtle)) ?? "",
            /exactly the pair/,
            `${what} of ${kind}`,
          );
        }
      assert.deepEqual(await filesIn(join(pods, "judged")), held);
    });

    it("files one of a kind over the records it is about", async () => {
      const filed = await owned.judge(acknowledged(owned, [KIND], [record]));
      assert.equal(filed.refused, undefined);
      assert.deepEqual(
        await select(
          owned,
          `SELECT ?kind ?member WHERE { <${filed.judgment ?? ""}> cascade:answersWarningOfKind ?kind ; prov:hadMember ?member }`,
        ),
        [{ kind: `${CASCADE}${KIND}`, member: record }],
      );
    });

    it("throws, writing nothing, for an Acknowledged that names no one kind of warning or a member that is no IRI, a version, a revision or a judgment", async () => {
      const [{ revision = "" } = {}] = await select(
        owned,
        `SELECT ?revision WHERE { ?revision cascade:revisionOf <${record}> }`,
      );
      const version = current[0]?.version ?? "";
      assert.ok(revision && version && judged.judgment);
      const held = await filesIn(join(pods, "judged"));
      for (const [what, turtle, reason] of [
        ["no kind", acknowledged(owned, [], [record]), /kind/],
        [
          "a kind that is no kind of warning",
          acknowledged(owned, ["Same"], [record]),
          /kind/,
        ],
        [
          "two kinds",
          acknowledged(owned, [KIND, "SourceReportedOlderStates"], [record]),
          /kind/,
        ],
        [
          "a kind written as text",
          judgment(owned, [
            "cascade:verdict cascade:Acknowledged",
            `cascade:answersWarningOfKind "${CASCADE}${KIND}"`,
            `prov:hadMember <${record}>`,
          ]),
          /kind/,
        ],
        [
          "a member written as text",
          judgment(owned, [
            "cascade:verdict cascade:Acknowledged",
            `cascade:answersWarningOfKind cascade:${KIND}`,
            'prov:hadMember "the record"',
          ]),
          /IRI/,
        ],
        [
          "a version",
          acknowledged(owned, [KIND], [record, version]),
          /version/,
        ],
        [
          "a revision",
          acknowledged(owned, [KIND], [record, revision]),
          /revision/,
        ],
        [
          "a judgment",
          acknowledged(owned, [KIND], [record, judged.judgment ?? ""]),
          /judgment/,
        ],
      ] as const) {
        await assert.rejects(owned.judge(turtle), reason, what);
        assert.match((await owned.checkJudgment(turtle)) ?? "", reason, what);
      }
      assert.deepEqual(await filesIn(join(pods, "judged")), held);
    });
  });

  describe("given records imported from documents", () => {
    let imported: Pod;
    let at: string;
    let records: Rows;
    let documents: Rows;
    let different: Done;
    let cited: Rows;
    let versions: Rows;
    let matcherSame: string;
    let own: Done;

    before(async () => {
      at = await copied((await alexPod()).folder, "judged-from-documents");
      imported = await openPodWith(kept, at);
      records = await select(
        imported,
        `SELECT ?record (SAMPLE(?document) AS ?from) WHERE {
          ?record cascade:currentRevision/prov:wasDerivedFrom ?document .
          FILTER NOT EXISTS { ?record cascade:currentRevision/prov:wasDerivedFrom ?other FILTER (?other != ?document) }
        } GROUP BY ?record ORDER BY ?from ?record`,
      );
      const first = records[0];
      const other = records.find(({ from }) => from !== first?.from);
      assert.ok(first?.record && other?.record, "two records of two documents");
      documents = [first, other];
      const members = [first.record, other.record];
      different = await imported.judge(verdict(imported, "Different", members));
      const named = `<${different.judgment ?? ""}>`;
      cited = await select(
        imported,
        `SELECT ?document WHERE { ${named} prov:wasDerivedFrom ?document } ORDER BY ?document`,
      );
      versions = await select(
        imported,
        `SELECT ?version WHERE { ${named} prov:wasDerivedFrom ?version . ?record pav:hasCurrentVersion ?version }`,
      );
      const [same] = await select(
        imported,
        `SELECT ?judgment WHERE { ?judgment prov:wasAttributedTo <${MATCHER}> ; cascade:verdict cascade:Same } LIMIT 1`,
      );
      matcherSame = same?.judgment ?? "";
      own = await imported.judge(
        judgment(imported, [
          "cascade:verdict cascade:Different",
          `prov:hadMember <${first.record}>`,
          `prov:hadMember <${other.record}>`,
          `<http://purl.org/dc/terms/replaces> <${different.judgment ?? ""}>`,
        ]),
      );
    });

    after(async () => {
      await imported.close();
    });

    it("names the document each member was shown from, and no version", () => {
      assert.equal(different.refused, undefined);
      assert.deepEqual(
        cited.map(({ document }) => document),
        documents.map(({ from }) => from).sort(),
      );
      assert.deepEqual(versions, []);
    });

    it("names the same documents for an Acknowledged of those records, and none for a document it names itself", async () => {
      const [first, other] = documents;
      const filed = await imported.judge(
        acknowledged(
          imported,
          ["ClockBehind"],
          [first?.record ?? "", other?.record ?? "", first?.from ?? ""],
        ),
      );
      assert.equal(filed.refused, undefined);
      assert.deepEqual(
        (
          await select(
            imported,
            `SELECT ?document WHERE { <${filed.judgment ?? ""}> prov:wasDerivedFrom ?document } ORDER BY ?document`,
          )
        ).map(({ document }) => document),
        documents.map(({ from }) => from).sort(),
      );
    });

    it("throws, writing nothing, for an Acknowledged that names a matcher judgment assertion", async () => {
      const [{ assertion = "" } = {}] = await select(
        imported,
        `SELECT ?assertion WHERE { ?assertion a cascade:MatcherJudgmentAssertion } LIMIT 1`,
      );
      assert.ok(assertion, "the matcher asserted some judgment");
      const held = await filesIn(at);
      const turtle = acknowledged(
        imported,
        ["ClockBehind"],
        [documents[0]?.record ?? "", assertion],
      );
      await assert.rejects(
        imported.judge(turtle),
        /matcher judgment assertion/,
      );
      assert.match(
        (await imported.checkJudgment(turtle)) ?? "",
        /matcher judgment assertion/,
      );
      assert.deepEqual(await filesIn(at), held);
    });

    it("files a person's replacement of a person's judgment", () => {
      assert.ok(matcherSame, "the matcher judged some records the same");
      assert.equal(own.refused, undefined);
      assert.match(own.judgment ?? "", /^urn:uuid:/);
    });

    it("throws, writing nothing, for a person's judgment that replaces a matcher's, and for a retraction of one", async () => {
      const held = await filesIn(at);
      const [first, other] = documents;
      for (const [name, turtle] of [
        [
          "a replacement",
          judgment(imported, [
            "cascade:verdict cascade:Same",
            `prov:hadMember <${first?.record ?? ""}>`,
            `prov:hadMember <${other?.record ?? ""}>`,
            `<http://purl.org/dc/terms/replaces> <${matcherSame}>`,
          ]),
        ],
        [
          "a retraction",
          `@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:cascade:this-judgment> a prov:Activity ; prov:invalidated <${matcherSame}> ; prov:wasAssociatedWith <${imported.owner}> .
<${imported.owner}> a prov:Person .`,
        ],
      ] as const)
        await assert.rejects(
          imported.judge(turtle),
          (error: Error) =>
            error.message.includes(matcherSame) &&
            error.message.includes("matcher's judgment"),
          name,
        );
      assert.deepEqual(await filesIn(at), held);
    });
  });

  describe("given an About whose basis is a machine's, attributed to a person", () => {
    const profile = "urn:uuid:3f6c0f4e-8a52-4c1b-9d7e-5b2a1c8e0d44";
    const BASES = [
      "SameDemographics",
      "PortalAuthenticated",
      "RelatedPersonConnection",
    ];
    /** An About by the owner with `basis`, whose own Turtle types the owner as each of `types`, or as none. */
    const machines = (basis: string, types: readonly string[]): string =>
      judgment(
        owned,
        [
          "cascade:verdict cascade:About",
          `cascade:subject <${owned.subject}>`,
          `cascade:basis cascade:${basis}`,
          `prov:hadMember <${profile}>`,
        ],
        undefined,
        types,
      );

    it("throws, writing nothing, for each machine basis, the owner typed a person in the judgment, not typed in it, or typed also a software agent", async () => {
      const at = join(pods, "judged");
      const held = await filesIn(at);
      for (const basis of BASES)
        for (const types of [
          ["prov:Person"],
          [],
          ["prov:Person", "prov:SoftwareAgent"],
        ])
          await assert.rejects(
            owned.judge(machines(basis, types)),
            (error: Error) =>
              error.message.includes(`cascade:${basis}`) &&
              error.message.includes("software agent"),
            `${basis} typed ${types.join(" and ") || "nothing"}`,
          );
      assert.deepEqual(await filesIn(at), held);
    });

    it("files each machine basis by a software agent the judgment types", async () => {
      const portal = "urn:uuid:7c2a5f10-3d4e-4b86-a1f9-0e8d6b4c2a13";
      for (const basis of BASES)
        assert.equal(
          (
            await owned.judge(
              `${PREFIXES}
<urn:cascade:this-judgment> a cascade:Judgment ; cascade:verdict cascade:About ;
    cascade:subject <${owned.subject}> ; cascade:basis cascade:${basis} ; prov:hadMember <${profile}> ;
    prov:wasAttributedTo <${portal}> .
<${portal}> a prov:SoftwareAgent .`,
            )
          ).refused,
          undefined,
          basis,
        );
    });

    /** An About by `BASES[0]` whose author is written as `author`, with `more` stated beside it. */
    const authored = (author: string, more = ""): string =>
      `${PREFIXES}
<urn:cascade:this-judgment> a cascade:Judgment ; cascade:verdict cascade:About ;
    cascade:subject <${owned.subject}> ; cascade:basis cascade:SameDemographics ; prov:hadMember <${profile}> ;
    prov:wasAttributedTo ${author} .${more}`;

    it("files a machine basis by a software agent that is a blank node the judgment types", async () => {
      assert.equal(
        (await owned.judge(authored("[ a prov:SoftwareAgent ]"))).refused,
        undefined,
      );
    });

    it("checks the machine basis once for a judgment, not once to prepare it and again to file it", async () => {
      const { seen } = await probing(() =>
        owned.judge(authored("[ a prov:SoftwareAgent ]")),
      );
      assert.equal(seen.counts.get("shapes.machine-basis-check"), 1);
    });

    it("checks the machine basis again for a judgment of the same name that differs only in a subclass statement it states", async () => {
      const name = "urn:uuid:0c7b2e48-91d5-4a3f-b6e2-48d1f0a97c35";
      const host = "urn:uuid:5e1d9a73-2c46-4b08-8f35-a7d0c3b91e64";
      const named = (more: string): string =>
        authored(
          `<${host}>`,
          `
<${host}> a prov:SoftwareAgent, <urn:example:KindOfAgent> .${more}`,
        ).replaceAll("urn:cascade:this-judgment", name);
      // The first files what the pod then holds of the host, so the second reads the same types the third will.
      for (const again of ["first", "second"])
        assert.equal(
          (await owned.judge(named(""))).refused,
          undefined,
          `the kind is a software agent only, ${again}`,
        );
      await assert.rejects(
        owned.judge(
          named(
            "\n<urn:example:KindOfAgent> <http://www.w3.org/2000/01/rdf-schema#subClassOf> prov:Person .",
          ),
        ),
        (error: Error) => error.message.includes("software agent"),
        "the kind this judgment says is a person",
      );
    });

    it("files a machine basis by an author only the vocabulary types: cascade:CascadeMatcher, or an agent the judgment types a cascade:Server", async () => {
      assert.equal(
        (await owned.judge(authored("cascade:CascadeMatcher"))).refused,
        undefined,
        "cascade:CascadeMatcher",
      );
      const host = "urn:uuid:2b7e4c19-5d83-4f0a-9a61-c3e8d1f47a52";
      assert.equal(
        (
          await owned.judge(
            authored(`<${host}>`, `\n<${host}> a cascade:Server .`),
          )
        ).refused,
        undefined,
        "a cascade:Server",
      );
    });

    it("refuses a machine basis by an author that is a blank node with no type or a literal, with the shape's message", async () => {
      const held = await filesIn(join(pods, "judged"));
      for (const author of ["[ ]", '"the portal"', "[ a prov:Person ]"])
        await assert.rejects(
          owned.judge(authored(author)),
          (error: Error) =>
            error.message.includes("typed prov:SoftwareAgent") &&
            error.message.includes("cascade:OwnerStatement"),
          author,
        );
      assert.deepEqual(await filesIn(join(pods, "judged")), held);
    });

    it("says each machine basis, and that a person's About has the basis cascade:OwnerStatement", async () => {
      await assert.rejects(
        owned.judge(machines("RelatedPersonConnection", [])),
        (error: Error) =>
          BASES.every((basis) => error.message.includes(`cascade:${basis}`)) &&
          error.message.includes("cascade:OwnerStatement"),
      );
    });
  });

  describe("given a judgment that names itself, and states its time and its author", () => {
    const named = "urn:uuid:9e1d1f66-8f43-4a8e-9c7b-2f0c5e6d7a81";
    const stated = "2026-03-04T07:00:00Z";
    const author = "urn:uuid:5a1c7e30-2b94-4d68-8f13-6e0a9c2d4b75";
    const at = (): string => join(pods, "judged");
    /** A judgment by someone who is not the pod's owner, whose name and time (when given) the app minted. */
    const byAnother = (
      name: string,
      time?: string,
      kind = "Erroneous",
      role = "PatientRole",
      agent = author,
    ): string => `${PREFIXES}
<${name}> a cascade:Judgment ; cascade:verdict cascade:${kind} ; prov:hadMember <${record}> ;
    ${time === undefined ? "" : `prov:generatedAtTime ${time} ;`}
    prov:wasAttributedTo <${author}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${agent}> ; prov:hadRole cascade:${role} ] ] .
<${author}> a prov:Person .`;
    const dateTime = (value: string): string =>
      `"${value}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
    const stating = (name: string) =>
      select(
        owned,
        `SELECT ?made ?author WHERE { <${name}> prov:generatedAtTime ?made ; prov:wasAttributedTo ?author }`,
      );
    let first: Done;

    before(async () => {
      first = await owned.judge(byAnother(named, dateTime(stated)));
    });

    it("files it under that name, returns it, and keeps its time and its author as given", async () => {
      assert.equal(first.refused, undefined);
      assert.equal(first.judgment, named);
      assert.equal(first.wrote.length, 1);
      assert.deepEqual(await stating(named), [{ made: stated, author }]);
    });

    it("writes nothing for a retry, with its time or without, and the pod's files are the same", async () => {
      const held = await filesIn(at());
      for (const [name, time] of [
        ["as it was", dateTime(stated)],
        ["with no time", undefined],
        ["at another time", dateTime("2026-03-05T07:00:00Z")],
      ] as const) {
        const again = await owned.judge(byAnother(named, time));
        assert.deepEqual(
          [again.refused, again.wrote, again.judgment],
          [undefined, [], named],
          name,
        );
        assert.deepEqual(await filesIn(at()), held, name);
      }
      assert.deepEqual(await stating(named), [{ made: stated, author }]);
    });

    it("refuses another judgment under a name the pod holds, writing nothing", async () => {
      const held = await filesIn(at());
      const other = await owned.judge(byAnother(named, undefined, "Same"));
      assert.match(other.refused ?? "", /holds already/);
      assert.deepEqual(await filesIn(at()), held);
    });

    it("refuses a retry that states another role or another agent for its author, writing nothing", async () => {
      const held = await filesIn(at());
      for (const [name, turtle] of [
        [
          "another role",
          byAnother(named, undefined, "Erroneous", "ModelProposerRole"),
        ],
        [
          "another agent",
          byAnother(named, undefined, "Erroneous", "PatientRole", record),
        ],
      ] as const) {
        const again = await owned.judge(turtle);
        assert.match(again.refused ?? "", /holds already/, name);
      }
      assert.deepEqual(await filesIn(at()), held);
    });

    it("throws, writing nothing, for a name the pod gives something else, whether a record or the pod's subject", async () => {
      const held = await filesIn(at());
      for (const taken of [record, owned.subject]) {
        const turtle = byAnother(taken);
        await assert.rejects(owned.judge(turtle), /something else/, taken);
        assert.match(
          (await owned.checkJudgment(turtle)) ?? "",
          /something else/,
        );
      }
      assert.deepEqual(await filesIn(at()), held);
    });

    it("throws, writing nothing, for a retraction under the name of a judgment, and a judgment under the name of a retraction", async () => {
      const held = await filesIn(at());
      const retraction = (name: string, target: string): string => `${PREFIXES}
<${name}> a prov:Activity ; prov:invalidated <${target}> ; prov:wasAssociatedWith <${author}> .
<${author}> a prov:Person .`;
      await assert.rejects(
        owned.judge(retraction(named, named)),
        /something else/,
      );
      const fresh = "urn:uuid:a2f6c8e1-5b39-4d07-9c64-1e8b3a7d0f52";
      await owned.judge(retraction(fresh, named));
      const after = await filesIn(at());
      await assert.rejects(owned.judge(byAnother(fresh)), /something else/);
      assert.deepEqual(await filesIn(at()), after);
      assert.equal(after.length, held.length + 1);
    });

    it("throws, writing nothing, for a name that no file can be named after, and says to name it a urn:uuid:", async () => {
      const held = await filesIn(at());
      for (const unplaceable of [
        "https://app.example/j/1",
        "urn:example:j1",
        "ni:///sha-256;!!",
        "urn:uuid:abc",
        "urn:uuid:B2F6C8E1-4D3A-4F5B-9C7E-1A2B3C4D5E6F",
        "urn:uuid:--------",
        "ni:///sha-256;AAAA",
      ]) {
        const turtle = byAnother(unplaceable);
        await assert.rejects(owned.judge(turtle), /urn:uuid:/, unplaceable);
        assert.match((await owned.checkJudgment(turtle)) ?? "", /urn:uuid:/);
      }
      assert.deepEqual(await filesIn(at()), held);
    });

    it("names a judgment with no time the time now, and keeps a time in the future", async () => {
      const untimed = await owned.judge(
        byAnother("urn:uuid:0b7d3c52-6e18-4f49-a2d0-1c8f5a9e3b64"),
      );
      const future = await owned.judge(
        byAnother(
          "urn:uuid:7c2e9a14-3d58-4b06-9e71-5f0b8d4a2c93",
          dateTime("2999-01-01T00:00:00Z"),
        ),
      );
      assert.deepEqual(
        (await stating(untimed.judgment ?? "")).map(({ made }) =>
          /^\d{4}-/.test(made ?? ""),
        ),
        [true],
      );
      assert.deepEqual(await stating(future.judgment ?? ""), [
        { made: "2999-01-01T00:00:00Z", author },
      ]);
    });

    it("files a retraction under the name and the start time it gives, and writes nothing for a retry", async () => {
      const retracting = "urn:uuid:4e9a2c68-b013-4d75-8c3f-9a1e6d0b5f27";
      const turtle = `${PREFIXES}
<${retracting}> a prov:Activity ; prov:invalidated <${named}> ;
    prov:startedAtTime ${dateTime("2026-03-06T10:30:00+02:00")} ;
    prov:wasAssociatedWith <${author}> .
<${author}> a prov:Person .`;
      const done = await owned.judge(turtle);
      const again = await owned.judge(turtle);
      assert.equal(done.judgment, retracting);
      assert.deepEqual([again.refused, again.wrote], [undefined, []]);
      assert.deepEqual(
        await select(
          owned,
          `SELECT ?made ?author WHERE { <${retracting}> prov:startedAtTime ?made ; prov:wasAssociatedWith ?author }`,
        ),
        [{ made: "2026-03-06T10:30:00+02:00", author }],
      );
    });

    it("files a judgment's time and a retraction's start time at an offset of +14:00 and of -14:00, the bounds, as given", async () => {
      for (const [name, retracting, time] of [
        [
          "urn:uuid:7d2f9b41-3a60-4c85-9e1b-5f8a0c6e2d73",
          "urn:uuid:2f6c8a1d-5e93-4b07-a4d2-9c1e7b3f0a58",
          "+14:00",
        ],
        [
          "urn:uuid:b05c8e32-6f17-4a9d-8d24-1e7b3a9f4c60",
          "urn:uuid:8a3d5f19-c26e-4071-b9a4-6e0d2c7f1b35",
          "-14:00",
        ],
      ] as const) {
        const made = `2026-03-04T07:00:00${time}`;
        const done = await owned.judge(byAnother(name, dateTime(made)));
        assert.equal(done.refused, undefined, time);
        assert.deepEqual(await stating(name), [{ made, author }], time);
        const retracted = await owned.judge(`${PREFIXES}
<${retracting}> a prov:Activity ; prov:invalidated <${name}> ;
    prov:startedAtTime ${dateTime(made)} ;
    prov:wasAssociatedWith <${author}> .
<${author}> a prov:Person .`);
        assert.equal(retracted.refused, undefined, `a retraction at ${time}`);
        assert.deepEqual(
          await select(
            owned,
            `SELECT ?made WHERE { <${retracting}> prov:startedAtTime ?made }`,
          ),
          [{ made }],
          `a retraction at ${time}`,
        );
      }
    });

    it("throws, writing nothing, for a time that is no xsd:dateTime, for two times, and for a name that is a blank node", async () => {
      const held = await filesIn(at());
      const free = "urn:uuid:c3a81f06-92d4-4e7b-b5a8-0d6e2f1c7943";
      for (const [name, turtle, why] of [
        [
          "a time that is no dateTime",
          byAnother(free, dateTime("yesterday")),
          /no xsd:dateTime/,
        ],
        [
          "a time that is a plain string",
          byAnother(free, '"2026-03-04T07:00:00Z"'),
          /no xsd:dateTime/,
        ],
        [
          "a time that is not a date",
          byAnother(free, dateTime("2026-13-45T07:00:00Z")),
          /no xsd:dateTime/,
        ],
        [
          "a day the month lacks",
          byAnother(free, dateTime("2026-02-31T00:00:00Z")),
          /no xsd:dateTime/,
        ],
        [
          "the hour 24",
          byAnother(free, dateTime("2026-03-04T24:00:00Z")),
          /no xsd:dateTime/,
        ],
        [
          "an offset past +14:00",
          byAnother(free, dateTime("2026-03-04T07:00:00+14:30")),
          /no xsd:dateTime/,
        ],
        [
          "an offset past -14:00",
          byAnother(free, dateTime("2026-03-04T07:00:00-14:01")),
          /no xsd:dateTime/,
        ],
        [
          "two times",
          byAnother(
            free,
            `${dateTime("2026-03-04T07:00:00Z")}, ${dateTime("2026-03-04T08:00:00Z")}`,
          ),
          /2 times/,
        ],
        [
          "a blank node for a name",
          byAnother(free).replace(`<${free}> a`, "[] a"),
          /blank node/,
        ],
      ] as const)
        await assert.rejects(owned.judge(turtle), why, name);
      assert.deepEqual(await filesIn(at()), held);
    });
  });

  describe("given a judgment read from one pod and filed into a rebuilt one", () => {
    it("counts the same there, under the name, the time and the author it had", async () => {
      const [from, into] = await Promise.all([
        enteredPod("judged-from"),
        enteredPod("judged-into"),
      ]);
      try {
        assert.equal(
          from.record,
          into.record,
          "a rebuild names a record alike",
        );
        const named = "urn:uuid:e6b4a0d9-1f27-4c83-8a5e-3b9d7c2f6018";
        const filed = await from.pod.judge(
          judgment(
            from.pod,
            [
              "cascade:verdict cascade:Erroneous",
              `prov:hadMember <${from.record}>`,
              'prov:generatedAtTime "2026-03-04T07:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>',
            ],
            named,
          ),
        );
        const text = await readFile(
          join(pods, "judged-from", ...(filed.wrote[0] ?? "").split("/")),
          "utf8",
        );
        const again = await into.pod.judge(text);
        const read = (of: Pod) =>
          select(
            of,
            `SELECT ?verdict ?made ?author ?member ?counts WHERE {
              <${named}> cascade:verdict ?verdict ; prov:generatedAtTime ?made ; prov:wasAttributedTo ?author ;
                prov:hadMember ?member ; cascade:countsUnderLens ?counts }`,
          );
        assert.equal(again.judgment, named);
        assert.deepEqual(await read(into.pod), await read(from.pod));
        assert.equal((await read(into.pod)).length, 1);
      } finally {
        await Promise.all([from.pod.close(), into.pod.close()]);
      }
    });
  });

  describe("given a judgment of a member the pod does not hold", () => {
    const unknown = "urn:uuid:3f6c2a8e-7d41-4b9a-a5e2-0c8d9b1f4e67";

    it("keeps it, citing no document, and lists it with Who judged what", async () => {
      const kept = await owned.judge(verdict(owned, "Same", [unknown]));
      const both = await owned.judge(
        verdict(owned, "Erroneous", [record, unknown]),
      );
      assert.equal(kept.refused, undefined);
      assert.equal(both.refused, undefined);
      assert.equal(kept.wrote.length, 1);
      for (const { judgment } of [kept, both]) {
        assert.deepEqual(
          await select(
            owned,
            `SELECT ?document WHERE { <${judgment ?? ""}> prov:wasDerivedFrom ?document }`,
          ),
          [],
        );
        const listed = await owned.ask("judgment/Who judged what");
        assert.ok(
          listed.some(
            (row) => row.judgment === judgment && row.member === unknown,
          ),
        );
      }
    });
  });

  describe("given a judgment of a view entry", () => {
    it("throws, writing nothing, for an entry among the members, as it does on records, never entries", async () => {
      const held = await filesIn(join(pods, "judged"));
      for (const members of [[entry], [record, entry]]) {
        const turtle = verdict(owned, "Erroneous", members);
        await assert.rejects(owned.judge(turtle), /view entry/);
        assert.match((await owned.checkJudgment(turtle)) ?? "", /view entry/);
      }
      assert.deepEqual(await filesIn(join(pods, "judged")), held);
    });
  });

  describe("given a finding", () => {
    let finding: string;
    let holder: Pod;
    let at: string;

    before(async () => {
      at = join(pods, "a-finding");
      await (await openPodWith(kept, at)).close();
      const content = (subject: string): Triple[] => [
        [iri(subject), iri(`${RDF}type`), iri(`${CASCADE}FindingForReview`)],
        [
          iri(subject),
          iri(`${OA}hasBody`),
          iri(`${CASCADE}MatcherJudgmentsNoLongerReached`),
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
    });

    after(async () => {
      await holder.close();
    });

    it("throws, writing nothing, for a judgment of any verdict that names the finding", async () => {
      const elsewhere = "urn:uuid:3f6c2a8e-7d41-4b9a-a5e2-0c8d9b1f4e67";
      const held = await filesIn(at);
      for (const [what, turtle] of [
        ["a Same of it alone", verdict(holder, "Same", [finding])],
        ["a Different of it", verdict(holder, "Different", [finding])],
        [
          "an Erroneous of it and another",
          verdict(holder, "Erroneous", [elsewhere, finding]),
        ],
        [
          "an Acknowledged of its kind",
          acknowledged(holder, ["MatcherJudgmentsNoLongerReached"], [finding]),
        ],
      ] as const) {
        const reason = (error: Error) => error.message.includes(finding);
        await assert.rejects(holder.judge(turtle), reason, what);
        assert.ok(
          ((await holder.checkJudgment(turtle)) ?? "").includes(finding),
          what,
        );
      }
      assert.deepEqual(await filesIn(at), held);
    });
  });
});

const NOT_BUILT = new Error("the pod was built");

/**
 * So that a returning app is fast, a pod opened again returns a kept answer while nothing the answer was worked out
 * from has changed. `head` lets the app's next act carry on from its last one.
 * @rule runtime/naming.feature N14
 */
describe("Opening a pod again · openPod()", () => {
  let again: string;
  let made: { address: string; subject: string; owner: string };
  let rows: Row[];

  /** The parts that open a pod with a build that fails, whole or read back, so that an answer that is not kept shows it. */
  const unbuilt = (build: Partial<Parts["build"]> = {}): Parts => ({
    ...kept,
    build: {
      ...kept.build,
      ...build,
      files: () => Promise.reject(NOT_BUILT),
      closing: () => {
        throw NOT_BUILT;
      },
    },
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

  describe("given a pod an import built and closed in an earlier session", () => {
    const ASKED = [
      "pod/My active medications",
      "pod/My active allergies",
      "pod/My condition history",
      "pod/My immunizations",
    ];
    const DERIVING = /^(derive\.step:|build\.queried$|kept\.whole$)/;
    let first: string;
    let wholeRows: Row[][];

    /** The parts that keep nothing beside the pod, so every read builds it whole. */
    const keepingNothing = (): Parts => {
      const parts: { -readonly [K in keyof Parts]: Parts[K] } = { ...kept };
      delete parts.answers;
      delete parts.builtBeside;
      return parts;
    };

    /** The pod in the folder opened with the parts, each question asked, and the spans the asking took. */
    async function asked(parts: Parts, at: string) {
      return opened(parts, at, async (pod) => {
        const { result, seen } = await probing(async () => {
          const rows: Row[][] = [];
          for (const question of ASKED) rows.push(await pod.ask(question));
          return rows;
        });
        return { rows: result, spans: [...seen.spans.keys()] };
      });
    }

    /** A copy of the folder and what is kept beside it but its kept answers, which would answer without a build. */
    async function copiedWithBuild(from: string, name: string) {
      const to = join(pods, name);
      await cp(from, to, { recursive: true });
      await cp(
        join(pods, ".answers", basename(from)),
        join(pods, ".answers", name),
        { recursive: true },
      );
      await rm(join(pods, ".answers", name, "answers.json"), { force: true });
      return to;
    }

    /** The parts with the path of each file of a pod read through them recorded in `read`. */
    const reading = (read: string[]): Parts => ({
      ...kept,
      folder: (path, iri) => {
        const folder = kept.folder(path, iri);
        const { files } = folder;
        const recorded: Files = {
          iri: files.iri,
          read: (pathOrIri) => {
            read.push(
              pathOrIri.startsWith(files.iri)
                ? pathOrIri.slice(files.iri.length)
                : pathOrIri,
            );
            return files.read(pathOrIri);
          },
          write: (pathOrIri, bytes) => files.write(pathOrIri, bytes),
          list: (folder) => files.list(folder),
          ...(files.writeNew === undefined
            ? {}
            : { writeNew: files.writeNew.bind(files) }),
          ...(files.writeAll === undefined
            ? {}
            : { writeAll: files.writeAll.bind(files) }),
          ...(files.replace === undefined
            ? {}
            : { replace: files.replace.bind(files) }),
          ...(files.remove === undefined
            ? {}
            : { remove: files.remove.bind(files) }),
          ...(files.readRange === undefined
            ? {}
            : { readRange: files.readRange.bind(files) }),
        };
        return { ...folder, files: recorded };
      },
    });

    before(async () => {
      first = join(pods, "built-before");
      const pod = await openPodWith(kept, first);
      try {
        await pod.import(exported("x-e2"), {
          claimProfiles: [await profileOf("J1"), await profileOf("J2")],
        });
      } finally {
        await pod.close();
      }
      wholeRows = (await asked(keepingNothing(), first)).rows;
    });

    it("reads the build back instead of deriving and building every view, and answers as a build whole does", async () => {
      const at = await copiedWithBuild(first, "read-back");
      const { rows, spans } = await asked(kept, at);
      assert.ok(spans.includes("kept.readBack"), spans.join(", "));
      assert.deepEqual(
        spans.filter((span) => DERIVING.test(span)),
        [],
      );
      assert.ok(wholeRows.some((answered) => answered.length > 0));
      assert.deepEqual(rows, wholeRows);
    });

    it("opens from the working copy kept beside it, reading no file of the pod's snapshot set, and answers as a build whole does", async () => {
      const at = await copiedWithBuild(first, "restored");
      const read: string[] = [];
      const { rows, spans } = await asked(reading(read), at);
      assert.ok(spans.includes("kept.readBack.restore"), spans.join(", "));
      assert.ok(!spans.includes("kept.whole.podFiles"), spans.join(", "));
      assert.deepEqual(
        read.filter((path) => kept.layout.inSnapshotSet(path)),
        [],
      );
      assert.deepEqual(rows, wholeRows);
    });

    it("builds again when the working copy kept beside it was cut short, and the next session opens from the one it wrote", async () => {
      const at = await copiedWithBuild(first, "copy-cut-short");
      const file = join(pods, ".answers", "copy-cut-short", BUILT_BESIDE);
      const bytes = await readFile(file);
      await writeFile(
        file,
        bytes.subarray(0, bytes.lastIndexOf(0x0a, bytes.length - 2) + 1),
      );
      const rebuilt = await asked(kept, at);
      assert.ok(
        rebuilt.spans.some((span) => DERIVING.test(span)),
        rebuilt.spans.join(", "),
      );
      assert.deepEqual(rebuilt.rows, wholeRows);
      await rm(join(pods, ".answers", "copy-cut-short", "answers.json"), {
        force: true,
      });
      const again = await asked(kept, at);
      assert.ok(
        again.spans.includes("kept.readBack.restore"),
        again.spans.join(", "),
      );
      assert.deepEqual(
        again.spans.filter((span) => DERIVING.test(span)),
        [],
      );
      assert.deepEqual(again.rows, wholeRows);
    });

    it("writes nothing at close, neither the working copy nor a file of the pod, after a session that opened from the working copy and changed nothing", async () => {
      const at = await copiedWithBuild(first, "restored-unwritten");
      const copy = join(pods, ".answers", "restored-unwritten", BUILT_BESIDE);
      const before = await heldIn(at);
      const copyBefore = (await stat(copy)).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { spans } = await asked(kept, at);
      assert.ok(spans.includes("kept.readBack.restore"), spans.join(", "));
      assert.equal((await stat(copy)).mtimeMs, copyBefore);
      assert.deepEqual(await heldIn(at), before);
    });

    it("builds again when a byte of the working copy kept beside it changed", async () => {
      const at = await copiedWithBuild(first, "copy-changed");
      const file = join(pods, ".answers", "copy-changed", BUILT_BESIDE);
      const bytes = await readFile(file);
      const block = bytes.indexOf(
        "{\n",
        bytes.indexOf(0x0a, bytes.indexOf(0x0a) + 1) + 1,
      );
      assert.ok(block > 0, "the working copy holds no graph");
      const at1 = bytes.indexOf('"', block) + 1;
      assert.ok(at1 > 0, "the working copy's triples hold no literal");
      bytes[at1] = bytes[at1] === 0x41 ? 0x42 : 0x41;
      await writeFile(file, bytes);
      const { rows, spans } = await asked(kept, at);
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
      assert.deepEqual(rows, wholeRows);
    });

    it("builds again when a file of the snapshot set was removed from the pod", async () => {
      const at = await copiedWithBuild(first, "set-file-removed");
      const removed = (await filesIn(at))
        .map((file) => relative(at, file).split(sep).join("/"))
        .find(
          (path) =>
            kept.layout.inSnapshotSet(path) && kept.layout.inActFolder(path),
        );
      assert.ok(removed, "the pod has no act file");
      await rm(join(at, ...removed.split("/")));
      const { rows, spans } = await asked(kept, at);
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
      assert.ok(!spans.includes("kept.readBack.restore"), spans.join(", "));
      assert.deepEqual(rows, (await asked(keepingNothing(), at)).rows);
    });

    it("opens it, with tables that never opened it, by reading the build back: no derivation, no build and no matcher's view of its own, and answers as a build whole does", async () => {
      const at = await copiedWithBuild(first, "opened-fresh");
      const fresh: Parts = {
        ...kept,
        tables: (await resolved()).tablesIn(join(pods, ".tables-fresh")),
      };
      const { result, seen } = await probing(async () => {
        const pod = await openPodWith(fresh, at);
        try {
          const rows: Row[][] = [];
          for (const question of ASKED) rows.push(await pod.ask(question));
          return rows;
        } finally {
          await pod.close();
        }
      });
      const spans = [...seen.spans.keys()];
      assert.ok(spans.includes("core-pod.step.perform"), spans.join(", "));
      assert.ok(spans.includes("kept.readBack"), spans.join(", "));
      assert.deepEqual(
        spans.filter((span) => DERIVING.test(span) || span === "matcher.view"),
        [],
      );
      assert.deepEqual(result, wholeRows);
    });

    it("reads a sealed pod's build back, kept sealed beside it", async () => {
      const at = join(pods, "sealed-read-back");
      const parts = { ...kept, derive: fastDerive() };
      const made = await openFolderPod(parts, at, { secret: WORDS });
      try {
        await made.import(exported("x-e2"), {
          claimProfiles: [await profileOf("J1"), await profileOf("J2")],
        });
      } finally {
        await made.close();
      }
      const reopened = await openFolderPod(parts, at, { secret: WORDS });
      try {
        const { result, seen } = await probing(() =>
          reopened.ask("pod/My active allergies"),
        );
        const spans = [...seen.spans.keys()];
        assert.ok(spans.includes("kept.readBack.restore"), spans.join(", "));
        assert.ok(!spans.includes("kept.whole.podFiles"), spans.join(", "));
        assert.deepEqual(
          spans.filter((span) => DERIVING.test(span)),
          [],
        );
        const whole = await openFolderPod(
          { ...keepingNothing(), derive: fastDerive() },
          at,
          { secret: WORDS },
        );
        try {
          const rows = await whole.ask("pod/My active allergies");
          assert.ok(rows.length > 0);
          assert.deepEqual(result, rows);
        } finally {
          await whole.close();
        }
      } finally {
        await reopened.close();
      }
      assert.ok(
        (await filesIn(join(pods, ".answers", "sealed-read-back"))).some(
          (file) => basename(file) === BUILT_BESIDE,
        ),
        "no working copy is kept beside the sealed pod",
      );
      for (const file of await filesIn(
        join(pods, ".answers", "sealed-read-back"),
      ))
        assert.ok(
          !(await readFile(file, "latin1")).includes("ns.cascadeprotocol.org"),
          `${file} is not sealed`,
        );
    });

    it("builds a sealed pod again when its manifest names another hash, writes the build, and the next session reads it back", async () => {
      const at = join(pods, "sealed-another-hash");
      const parts = { ...kept, derive: fastDerive() };
      const made = await openFolderPod(parts, at, { secret: WORDS });
      try {
        await made.import(exported("x-e2"), {
          claimProfiles: [await profileOf("J1"), await profileOf("J2")],
        });
      } finally {
        await made.close();
      }
      const { build } = parts;
      const changed = {
        ...parts,
        build: { ...build, queries: [...build.queries, "# changed"] },
      };
      const session = async (question: string, using: Parts = changed) => {
        const pod = await openFolderPod(using, at, { secret: WORDS });
        try {
          const { result, seen } = await probing(() => pod.ask(question));
          return { rows: result, spans: [...seen.spans.keys()] };
        } finally {
          await pod.close();
        }
      };
      const rebuilt = await session("pod/My active medications");
      assert.ok(
        rebuilt.spans.some((span) => DERIVING.test(span)),
        rebuilt.spans.join(", "),
      );
      const back = await session("pod/My active allergies");
      assert.ok(back.spans.includes("kept.readBack"), back.spans.join(", "));
      assert.deepEqual(
        back.spans.filter((span) => DERIVING.test(span)),
        [],
      );
      const whole = await session("pod/My active allergies", {
        ...keepingNothing(),
        derive: fastDerive(),
      });
      assert.ok(whole.rows.length > 0);
      assert.deepEqual(back.rows, whole.rows);
    });

    it("builds again when a file the build read changed in place", async () => {
      const at = await copiedWithBuild(first, "card-changed");
      await appendFile(join(at, ...kept.layout.card.split("/")), "# changed\n");
      const { rows, spans } = await asked(kept, at);
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
      assert.deepEqual(rows, wholeRows);
    });

    it("builds again when a view the build wrote no longer holds what it wrote, writes that view again, and the next session reads it back", async () => {
      const at = await copiedWithBuild(first, "view-edited");
      const view = kept.layout.views.find(
        ({ writtenBy }) => writtenBy === "views/conditions.rq",
      )?.file;
      assert.ok(view);
      const file = join(at, ...view.split("/"));
      const held = await readFile(file);
      assert.ok(held.length > 0, "the pod has no conditions");
      await writeFile(file, "");
      const { rows, spans } = await asked(kept, at);
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
      assert.deepEqual(rows, wholeRows);
      assert.deepEqual(
        await readFile(file),
        held,
        "the view was not written again",
      );
      await rm(join(pods, ".answers", "view-edited", "answers.json"));
      const again = await asked(kept, at);
      assert.ok(again.spans.includes("kept.readBack"), again.spans.join(", "));
      assert.deepEqual(again.rows, wholeRows);
    });

    it("builds exactly once when its manifest names the hash taken over a wider set of files, a .DS_Store among them, and the next session reads the build back", async () => {
      const at = await copiedWithBuild(first, "wider-set");
      await writeFile(join(at, ".DS_Store"), "junk");
      const manifest = join(at, ...kept.layout.manifest.split("/"));
      const text = await readFile(manifest, "utf8");
      const named = /buildInputsHash> "([0-9a-f]+)"/.exec(text);
      assert.ok(named?.[1], "the manifest names no build inputs hash");
      await writeFile(
        manifest,
        text.replace(named[1], "0".repeat(named[1].length)),
      );
      const rebuilt = await asked(kept, at);
      assert.ok(
        rebuilt.spans.some((span) => DERIVING.test(span)),
        rebuilt.spans.join(", "),
      );
      assert.deepEqual(rebuilt.rows, wholeRows);
      await rm(join(pods, ".answers", "wider-set", "answers.json"), {
        force: true,
      });
      const again = await asked(kept, at);
      assert.ok(again.spans.includes("kept.readBack"), again.spans.join(", "));
      assert.deepEqual(
        again.spans.filter((span) => DERIVING.test(span)),
        [],
      );
      assert.deepEqual(again.rows, wholeRows);
    });

    it("builds again when what is kept beside the pod was kept under another hash than the manifest names, as when a process stops before it closes the pod", async () => {
      const at = await copiedWithBuild(first, "kept-under-another");
      const file = join(pods, ".answers", "kept-under-another", BUILT_BESIDE);
      const bytes = await readFile(file, "utf8");
      const end = bytes.indexOf("\n");
      const header = JSON.parse(bytes.slice(2, end)) as { inputsHash: string };
      header.inputsHash = "0".repeat(header.inputsHash.length);
      await writeFile(file, `# ${JSON.stringify(header)}${bytes.slice(end)}`);
      const { rows, spans } = await asked(kept, at);
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
      assert.deepEqual(rows, wholeRows);
    });

    it("builds again when the vocabulary's build queries changed", async () => {
      const at = await copiedWithBuild(first, "queries-changed");
      const { build } = kept;
      const { spans } = await asked(
        {
          ...kept,
          build: { ...build, queries: [...build.queries, "# changed"] },
        },
        at,
      );
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
    });

    it("keeps the build a read made whole when the manifest named its hash and nothing was kept beside it, and the next session reads it back", async () => {
      const at = await copiedWithBuild(first, "beside-lost");
      await rm(join(pods, ".answers", "beside-lost", BUILT_BESIDE));
      const manifest = await readFile(
        join(at, ...kept.layout.manifest.split("/")),
      );
      const built = await asked(kept, at);
      assert.ok(
        built.spans.some((span) => DERIVING.test(span)),
        built.spans.join(", "),
      );
      assert.deepEqual(
        await readFile(join(at, ...kept.layout.manifest.split("/"))),
        manifest,
        "a read rewrote a manifest that named its hash",
      );
      await rm(join(pods, ".answers", "beside-lost", "answers.json"));
      const { rows, spans } = await asked(kept, at);
      assert.ok(spans.includes("kept.readBack"), spans.join(", "));
      assert.deepEqual(rows, wholeRows);
    });

    it("leaves every file of the pod as it was, views included, when only the build kept beside it was lost", async () => {
      const at = await copiedWithBuild(first, "beside-lost-untouched");
      await rm(join(pods, ".answers", "beside-lost-untouched", BUILT_BESIDE));
      const before = await heldIn(at);
      assert.ok(before.size > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const built = await asked(kept, at);
      assert.ok(
        built.spans.some((span) => DERIVING.test(span)),
        built.spans.join(", "),
      );
      assert.deepEqual(await heldIn(at), before);
    });

    it("writes the build a read made whole again when the manifest named another hash, and the next session reads it back", async () => {
      const at = await copiedWithBuild(first, "hash-changed");
      const { build } = kept;
      const changed: Parts = {
        ...kept,
        build: { ...build, queries: [...build.queries, "# changed"] },
      };
      const built = await asked(changed, at);
      assert.ok(
        built.spans.some((span) => DERIVING.test(span)),
        built.spans.join(", "),
      );
      const unbuilding: Parts = {
        ...changed,
        build: {
          ...changed.build,
          closing: () => {
            throw NOT_BUILT;
          },
        },
      };
      const answeredFromKept = await opened(unbuilding, at, async (pod) => {
        const rows: Row[][] = [];
        for (const question of ASKED) rows.push(await pod.ask(question));
        return rows;
      });
      assert.deepEqual(
        answeredFromKept,
        built.rows,
        "the answers kept as the read wrote the build, under the pod's revision",
      );
      await rm(join(pods, ".answers", "hash-changed", "answers.json"));
      const { rows, spans } = await asked(changed, at);
      assert.ok(spans.includes("kept.readBack"), spans.join(", "));
      assert.deepEqual(rows, wholeRows);
    });

    it("answers when the manifest named another hash and the pod cannot be written", async () => {
      const at = await copiedWithBuild(first, "read-only");
      const { build } = kept;
      const refused = () => Promise.reject(new Error("read-only"));
      const readOnly: Parts = {
        ...kept,
        build: { ...build, queries: [...build.queries, "# changed"] },
        folder: (path, iri) => {
          const folder = kept.folder(path, iri);
          return {
            ...folder,
            files: new Proxy(folder.files, {
              get: (files, name) => {
                if (name === "write" || name === "writeAll") return refused;
                const value = Reflect.get(files, name, files) as unknown;
                return typeof value === "function" ? value.bind(files) : value;
              },
            }),
          };
        },
      };
      const { rows } = await asked(readOnly, at);
      assert.deepEqual(rows, wholeRows);
    });

    it("writes nothing when another session's step lands between what the read listed and its write, and answers all the same", async () => {
      const { build } = kept;
      const manifestIn = (at: string) =>
        join(at, ...kept.layout.manifest.split("/"));
      const landings: [string, (at: string) => Promise<void>][] = [
        ["file", (at) => writeFile(join(at, "landed.ttl"), "")],
        [
          "manifest",
          (at) => appendFile(manifestIn(at), "# another session's step\n"),
        ],
      ];
      const found: string[] = [];
      for (const [what, land] of landings) {
        const at = await copiedWithBuild(first, `landed-${what}`);
        let landed: Buffer | undefined;
        const landing: Parts = {
          ...kept,
          build: {
            ...build,
            queries: [...build.queries, "# changed"],
            queried: async (...args: Parameters<typeof build.queried>) => {
              if (landed === undefined) {
                await land(at);
                landed = await readFile(manifestIn(at));
              }
              return build.queried(...args);
            },
          },
        };
        const { rows } = await asked(landing, at);
        assert.deepEqual(rows, wholeRows, what);
        assert.ok(landed !== undefined, what);
        if (!(await readFile(manifestIn(at))).equals(landed))
          found.push(`${what}: the read wrote its manifest over the step's`);
      }
      assert.deepEqual(found, []);
    });

    it("rebuilds a step in part from the build it read back, and the next session reads back what that step wrote, answering as a build whole does", async () => {
      const at = await copiedWithBuild(first, "stepped");
      const claimProfiles = [await profileOf("J1"), await profileOf("J2")];
      await opened(kept, at, async (pod) => {
        const { seen } = await probing(() =>
          pod.import(exported("x-e4"), { claimProfiles }),
        );
        const spans = [...seen.spans.keys()];
        assert.ok(spans.includes("kept.readBack"), spans.join(", "));
        assert.ok(!spans.includes("kept.whole"), spans.join(", "));
      });
      const { rows, spans } = await asked(kept, at);
      assert.ok(spans.includes("kept.readBack.restore"), spans.join(", "));
      assert.deepEqual(rows, (await asked(keepingNothing(), at)).rows);
      assert.notDeepEqual(rows, wholeRows);
    });

    it("builds again when a step wrote its records and stopped before its views", async () => {
      const at = await copiedWithBuild(first, "torn");
      const before = new Map<string, Buffer | undefined>();
      for (const path of kept.layout.rebuilt)
        before.set(
          path,
          await readFile(join(at, ...path.split("/"))).catch(() => undefined),
        );
      const beside = join(pods, ".answers", "torn");
      const besideBefore = join(pods, "torn-beside-before");
      await cp(beside, besideBefore, { recursive: true });
      await opened(kept, at, async (pod) => {
        await pod.import(exported("x-e4"), {
          claimProfiles: [await profileOf("J1"), await profileOf("J2")],
        });
      });
      const after = (await asked(keepingNothing(), at)).rows;
      for (const [path, bytes] of before) {
        const file = join(at, ...path.split("/"));
        if (bytes === undefined) await rm(file, { force: true });
        else await writeFile(file, bytes);
      }
      await rm(beside, { recursive: true, force: true });
      await cp(besideBefore, beside, { recursive: true });
      const { rows, spans } = await asked(kept, at);
      assert.ok(
        spans.some((span) => DERIVING.test(span)),
        spans.join(", "),
      );
      assert.notDeepEqual(after, wholeRows);
      assert.deepEqual(rows, after);
    });
  });

  describe("given a runtime packed, or run from a checkout · keptBeside()", () => {
    it("keeps answers for a packed, committed runtime, and the build too wherever the runtime and its components are each at a commit, a checkout's under its built code, and the pod's database wherever either is kept", async () => {
      const COMMIT =
        "https://github.com/jayostis/cascade-runtime-js/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";
      const rows: [
        string,
        string,
        string,
        number,
        [boolean, boolean, string | undefined, boolean],
      ][] = [
        [
          "packed and committed",
          "0.0.0-commit-abc123",
          COMMIT,
          0,
          [true, true, undefined, true],
        ],
        [
          "a checkout at a commit",
          "0.0.0",
          COMMIT,
          0,
          [false, true, "built", true],
        ],
        [
          "a checkout with changes",
          "0.0.0",
          `${COMMIT}#uncommitted`,
          0,
          [false, false, undefined, false],
        ],
        [
          "a checkout no commit names",
          "0.0.0",
          "https://github.com/jayostis/cascade-runtime-js#unidentified",
          0,
          [false, false, undefined, false],
        ],
        [
          "components with changes",
          "0.0.0",
          COMMIT,
          2,
          [false, false, undefined, false],
        ],
      ];
      const found = [];
      for (const [what, version, performer, uncommitted] of rows) {
        const parts = await keptBeside(
          { performer, local: { resolved: { uncommitted } } },
          version,
          () => Promise.resolve("built"),
        );
        found.push([
          what,
          [
            parts.answers !== undefined,
            (parts.answers?.at ?? parts.builtBeside) !== undefined,
            parts.builtCode,
            parts.databaseBeside !== undefined,
          ],
        ]);
      }
      assert.deepEqual(
        found,
        rows.map(([what, , , , kept]) => [what, kept]),
      );
    });

    it("names a checkout's built code by paths written with a forward slash, so one pod synced between operating systems keeps its build", async () => {
      const root = await mkdtemp(join(tmpdir(), "built-code-slash-"));
      try {
        const files: Record<string, string> = {
          "cascade-runtime/package.json": JSON.stringify({
            name: "cascade-runtime",
          }),
          "cascade-runtime/dist/src/a-b.js": "export const b = 1;\n",
          "cascade-runtime/dist/src/a/c.js": "export const c = 2;\n",
          "cascade-runtime/dist/src/a.js": "export const a = 3;\n",
          "cascade-runtime/dist/src/a0.js": "export const d = 4;\n",
        };
        for (const [path, text] of Object.entries(files)) {
          await mkdir(dirname(join(root, path)), { recursive: true });
          await writeFile(join(root, path), text);
        }
        const hash = createHash("sha256");
        for (const path of Object.keys(files)
          .filter((path) => path.startsWith("cascade-runtime/dist/"))
          .map((path) => `/${path}`)
          .sort()) {
          hash.update(path);
          hash.update(new Uint8Array([0]));
          hash.update(files[path.slice(1)] as string);
          hash.update(new Uint8Array([0]));
        }
        assert.equal(
          await builtCode(join(root, "cascade-runtime")),
          hash.digest("hex"),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("names a checkout's built code by the bytes of what runs, so code built at another commit than the checkout's keeps its build apart", async () => {
      const root = await mkdtemp(join(tmpdir(), "built-code-"));
      try {
        const files: Record<string, string> = {
          "cascade-runtime/package.json": JSON.stringify({
            name: "cascade-runtime",
            dependencies: { "@cascade-runtime/runtime": "0.0.0" },
          }),
          "cascade-runtime/dist/src/index.js": "export {};\n",
          "runtime/package.json": JSON.stringify({
            name: "@cascade-runtime/runtime",
          }),
          "runtime/dist/src/core-pod.js": "export const at = 1;\n",
          "runtime/dist/src/core-pod.js.map": "{}",
          "site/package.json": JSON.stringify({
            name: "@cascade-runtime/site",
          }),
          "site/dist/src/page.js": "export {};\n",
        };
        const put = async (path: string, text: string) => {
          await mkdir(dirname(join(root, path)), { recursive: true });
          await writeFile(join(root, path), text);
        };
        for (const [path, text] of Object.entries(files)) await put(path, text);
        const code = () => builtCode(join(root, "cascade-runtime"));
        const own = await code();
        const rows: [string, string, string, boolean][] = [
          [
            "a file of a package it runs",
            "runtime/dist/src/core-pod.js",
            "export const at = 2;\n",
            true,
          ],
          [
            "a file of its own package",
            "cascade-runtime/dist/src/index.js",
            "export const at = 3;\n",
            true,
          ],
          ["a source map", "runtime/dist/src/core-pod.js.map", "{ }", false],
          [
            "a package it does not run",
            "site/dist/src/page.js",
            "export const at = 4;\n",
            false,
          ],
        ];
        const found: string[] = [];
        for (const [what, path, text, changes] of rows) {
          await put(path, text);
          if (((await code()) !== own) !== changes)
            found.push(`${what}: ${changes ? "same" : "another"} digest`);
          await put(path, files[path] ?? "");
        }
        assert.deepEqual(found, []);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
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

    it("is undefined in a new pod", () => {
      assert.equal(head0, undefined);
    });

    it("is set by the pod's first act, whose snapshot names none before it", () => {
      assert.ok(head1 !== undefined);
      assert.deepEqual(firstAct, { firstParent: [], merged: [] });
    });

    it("is the same after the pod is closed and opened again", () => {
      assert.ok(head1 !== undefined);
      assert.deepEqual(reopened, head1);
    });

    it("is the only snapshot the next act's snapshot names as the one before it, when the pod was reopened in between", () => {
      assert.ok(head1 !== undefined);
      assert.deepEqual(secondAct, {
        firstParent: [head1.snapshot],
        merged: [],
      });
    });
  });

  describe("when a pod is retitled · pod.retitle(title), pod.titled", () => {
    const DCT_TITLE = "http://purl.org/dc/terms/title";

    /** The pod as a packed runtime opens it, its answers kept beside it, and Argon2id stood in for. */
    const open = (
      at: string,
      options: { title?: string; secret?: string } = {},
    ) => openFolderPod({ ...kept, derive: fastDerive() }, at, options);

    /** The title the manifest and `pod.json` of the pod in the folder hold, read from the disk, with the key of a sealed pod. */
    async function titlesOf(at: string, key?: PodKey) {
      const own = new FolderFiles(at);
      const answers = kept.answers?.at(at);
      assert.ok(answers);
      const [files, described] =
        key === undefined
          ? [own, answers]
          : [
              new EncryptedFiles(own, key, {
                index: await SealedIndex.open(own, key),
              }),
              new EncryptedFiles(answers, key, { kind: "answers" }),
            ];
      const bytes = await files.read(kept.layout.manifest);
      assert.ok(bytes, "the pod has no manifest");
      const triples = await new OxigraphStore().parse(
        bytes,
        "pod://titles/manifest.ttl",
      );
      return {
        manifest: triples.find(([, p]) => p.value === DCT_TITLE)?.[2].value,
        described: await new Answers(described, "").described(),
      };
    }

    it("gives the new title in the manifest, in `pod.json` and on the reopened pod, and leaves the kept rows of a question as they were", async () => {
      const at = join(pods, "retitled");
      await cp((await alexPod()).folder, at, { recursive: true });
      const first = await open(at);
      let rows: Row[];
      try {
        assert.equal(first.titled, false);
        rows = await first.ask(QUESTION);
        assert.ok(rows.length > 0);
        await first.retitle("Ada Lovelace");
        assert.equal(first.titled, true);
      } finally {
        await first.close();
      }
      const stored = await titlesOf(at);
      assert.equal(stored.manifest, "Ada Lovelace");
      assert.equal(stored.described?.title, "Ada Lovelace");
      const second = await open(at);
      try {
        assert.equal(second.titled, true);
      } finally {
        await second.close();
      }
      assert.equal((await titlesOf(at)).manifest, "Ada Lovelace");
      await opened(unbuilt(), at, async (pod) => {
        assert.deepEqual(await pod.ask(QUESTION), rows);
      });
    });

    it("says a pod is titled only when a title was given when it was made or by `retitle`", async () => {
      const untitled = join(pods, "untitled");
      const named = join(pods, "named");
      const states: boolean[] = [];
      for (const [at, options] of [
        [untitled, {}],
        [named, { title: "ada" }],
        [untitled, {}],
        [named, {}],
      ] as const) {
        const pod = await open(at, options);
        states.push(pod.titled);
        await pod.close();
      }
      assert.deepEqual(states, [false, true, false, true]);
      const stored = await titlesOf(untitled);
      assert.equal(stored.manifest, undefined);
      assert.equal(stored.described?.title, "untitled");
      assert.equal(stored.described?.titled, false);
      assert.equal((await titlesOf(named)).manifest, "ada");
    });

    it("refuses an empty or all-whitespace title with a `Refusal`, leaving the pod untitled", async () => {
      const at = join(pods, "refusing");
      const pod = await open(at);
      try {
        for (const title of ["", " ", "\n\t "])
          await assert.rejects(
            pod.retitle(title),
            (error) => error instanceof Refusal,
            JSON.stringify(title),
          );
        assert.equal(pod.titled, false);
      } finally {
        await pod.close();
      }
      assert.equal((await titlesOf(at)).manifest, undefined);
    });

    it("seals the new title of an encrypted pod, which opens again with its secret as titled", async () => {
      const at = join(pods, "retitled-sealed");
      const made = await open(at, { secret: WORDS });
      try {
        assert.equal(made.titled, false);
        await made.retitle("Ada Lovelace");
      } finally {
        await made.close();
      }
      const reopened = await open(at, { secret: WORDS });
      try {
        assert.equal(reopened.titled, true);
      } finally {
        await reopened.close();
      }
      const key = await podKey(
        {
          files: new FolderFiles(at),
          header: await headerIn(at),
          reread: () => headerIn(at),
          held: async () => true,
        },
        WORDS,
        fastDerive(),
      );
      assert.ok(key);
      const stored = await titlesOf(at, key);
      assert.equal(stored.manifest, "Ada Lovelace");
      assert.equal(stored.described?.title, "Ada Lovelace");
      for (const file of [
        ...(await filesIn(at)),
        ...(await filesIn(join(pods, ".answers", "retitled-sealed"))),
      ])
        assert.ok(
          !(await readFile(file, "latin1")).includes("Ada Lovelace"),
          file,
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
    it("answers a question, once opened with the secret, with the rows it gave when it was made", async () => {
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

  describe("checkSecret(folder, secret)", () => {
    /** Each file under the folder with its size and mtime: what a write would change. */
    const stampsOf = async (at: string) =>
      Promise.all(
        (await filesIn(at).catch(() => [])).map(async (file) => {
          const { mtimeMs, size } = await stat(file);
          return [file, mtimeMs, size];
        }),
      );

    it("answers true for the secret, as typed or cleaned, and false for another, and writes nothing", async () => {
      const at = join(pods, "checked-sealed");
      const sealed = await openPod(at, { secret: WORDS, title: TITLE });
      await sealed.ask(HELD);
      await sealed.close();
      const answers = join(pods, ".answers", "checked-sealed");
      const before = [await stampsOf(at), await stampsOf(answers)];
      const answered = [];
      for (const secret of [
        WORDS,
        " T-SHIRT, Abacus yo yo zoom drop down felt-tip ",
        "a b c d e f",
      ])
        answered.push(await checkSecret(at, secret));
      assert.deepEqual(answered, [true, true, false]);
      assert.deepEqual(before, [await stampsOf(at), await stampsOf(answers)]);
    });

    it("throws `Unopened` with `not encrypted` for a pod that has no header, and writes nothing", async () => {
      const plain = join(pods, "plain-checked");
      const pod = await openPod(plain);
      await pod.close();
      const before = await stampsOf(plain);
      await assert.rejects(
        checkSecret(plain, WORDS),
        (error) =>
          error instanceof Unopened && error.outcome === "not encrypted",
      );
      assert.deepEqual(await stampsOf(plain), before);
    });

    it("leaves `configureTables` open, since it opens no pod and makes no tables", async () => {
      const script = `
        import { checkSecret, configureTables } from "cascade-runtime";
        await checkSecret(process.argv[1], "a b c d e f").catch(() => undefined);
        configureTables({});
      `;
      await promisify(execFile)(
        process.execPath,
        ["--input-type=module", "-e", script, join(pods, "nopod")],
        { cwd: dirname(fileURLToPath(import.meta.url)), timeout: 120_000 },
      );
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

    it("lets one opening read what the other sealed", async () => {
      const derive = fastDerive();
      const at = join(pods, "raced");
      const [first, second] = await Promise.all([
        opening(at, WORDS, derive),
        opening(at, WORDS, derive),
      ]);
      assert.ok(first !== undefined && second !== undefined);
      const sealed = async (key: PodKey) =>
        new EncryptedFiles(new FolderFiles(at), key, {
          index: await SealedIndex.open(new FolderFiles(at), key),
        });
      await (await sealed(first)).write("a.ttl", new TextEncoder().encode("a"));
      const read = await (await sealed(second)).read("a.ttl");
      assert.equal(new TextDecoder().decode(read), "a");
    });

    /** A folder as `openFolderPod` hands it to `podKey`: holding whatever it holds, its header read again as it is looked for. */
    const holding = (at: string) => {
      const files = new FolderFiles(at);
      return {
        files,
        header: undefined,
        reread: () => headerIn(at),
        held: async () => (await files.list("")).length > 0,
      };
    };

    /** The files as they are, but a write of the header that `before` runs first, or that throws. */
    const writingHeader = (
      files: FolderFiles,
      before: () => Promise<void> | void,
    ): Files => ({
      iri: files.iri,
      read: (path) => files.read(path),
      write: (path, bytes) => files.write(path, bytes),
      writeNew: async (path, bytes) => {
        if (path === HEADER) await before();
        return files.writeNew(path, bytes);
      },
      replace: (path, bytes, holds) => files.replace(path, bytes, holds),
      remove: (paths) => files.remove(paths),
      list: (folder) => files.list(folder),
    });

    it("makes the pod again with the secret given, when the opening that began it stopped between its two writes and left only its sealed index", async () => {
      const derive = fastDerive();
      const at = join(pods, "half-made");
      const { files } = holding(at);
      await assert.rejects(
        madeNewPod(
          writingHeader(files, () => {
            throw new Error("stopped");
          }),
          await newHeader(WORDS, derive),
        ),
        /stopped/,
      );
      assert.deepEqual(await files.list(""), [`${SEALED_INDEX}/0`]);
      const secret = "a b c d e f";
      const key = await podKey(holding(at), secret, derive, {
        looks: 3,
        every: 1,
      });
      assert.ok(key);
      assert.ok(
        await openHeader(
          (await headerIn(at)) ?? new Uint8Array(),
          secret,
          derive,
        ),
      );
      const sealed = new EncryptedFiles(files, key, {
        index: await SealedIndex.open(files, key),
      });
      await sealed.write("a.ttl", new TextEncoder().encode("a"));
      assert.equal(new TextDecoder().decode(await sealed.read("a.ttl")), "a");
    });

    it("makes the pod again when the opening that began it stopped after proving the layout, leaving a probe and no index, and its first write sweeps the probe", async () => {
      const derive = fastDerive();
      const at = join(pods, "probe-left");
      const { files } = holding(at);
      await files.write("sealed/probe-0a1b2c3d4e5f/file", new Uint8Array(16));
      const key = await podKey(holding(at), WORDS, derive, {
        looks: 3,
        every: 1,
      });
      assert.ok(key);
      const sealed = new EncryptedFiles(files, key, {
        index: await SealedIndex.open(files, key),
      });
      await sealed.write("a.ttl", new TextEncoder().encode("a"));
      assert.deepEqual(
        (await files.list("")).filter((path) => path.includes("probe-")),
        [],
      );
    });

    it("refuses a folder whose header was deleted and whose sealed records remain, removing nothing", async () => {
      const derive = fastDerive();
      const at = join(pods, "header-deleted");
      const { files } = holding(at);
      const made = await newHeader(WORDS, derive);
      assert.ok(await madeNewPod(files, made));
      const sealed = new EncryptedFiles(files, made.key, {
        index: await SealedIndex.open(files, made.key),
      });
      await sealed.write("a.ttl", new TextEncoder().encode("a"));
      await rm(join(at, HEADER));
      const before = (await files.list("")).sort();
      assert.ok(before.some((path) => /^sealed\/[0-9a-f]{2}\//.test(path)));
      await assert.rejects(
        podKey(holding(at), WORDS, derive, { looks: 3, every: 1 }),
        (error: unknown) =>
          error instanceof Unopened && error.outcome === "not encrypted",
      );
      assert.deepEqual((await files.list("")).sort(), before);
    });

    it("opens with the header of an opening that is still making the pod, after its sealed index and before its header", async () => {
      const derive = fastDerive();
      const at = join(pods, "being-made");
      const { files } = holding(at);
      let reached = () => {};
      const between = new Promise<void>((resolve) => (reached = resolve));
      const making = madeNewPod(
        writingHeader(files, async () => {
          reached();
          await new Promise((resolve) => setTimeout(resolve, 30));
        }),
        await newHeader(WORDS, derive),
      );
      await between;
      const key = await podKey(holding(at), WORDS, derive, {
        looks: 100,
        every: 5,
      });
      assert.ok(key);
      assert.ok(await making);
      const sealed = new EncryptedFiles(files, key, {
        index: await SealedIndex.open(files, key),
      });
      assert.deepEqual(await sealed.list(""), []);
    });

    it("opens for exactly one of two different secrets, with `incorrect secret` for the other", async () => {
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

  /** Alex's pod made with the six words from two downloads, each import's index writes counted. */
  describe("when a pod made with a secret holds records", () => {
    let sealedAlex: SealedAlex;

    before(async () => {
      sealedAlex = await sealedAlexPod();
    });

    it("names its files so its folder shows no record kind, no count by kind, and no hash of a record's triples", async () => {
      const { folder: at, logical } = sealedAlex;
      const stored = (await filesIn(at))
        .map((file) => relative(at, file).split(sep).join("/"))
        .filter((path) => path !== HEADER);
      assert.deepEqual(
        stored.filter(
          (path) =>
            !/^sealed\/[0-9a-f]{2}\/[0-9a-f]{62}$/.test(path) &&
            !/^sealed\/index\/\d+$/.test(path),
        ),
        [],
      );
      assert.equal(
        stored.filter((path) => path.startsWith(`${SEALED_INDEX}/`)).length,
        1,
      );
      const told = new Set(
        logical.flatMap((path) =>
          path.split(/[/.]/).filter((part) => part.length >= 8),
        ),
      );
      assert.ok(told.size > 20, [...told].join(" "));
      for (const path of stored)
        for (const part of told)
          assert.ok(!path.includes(part), `${path} holds ${part}`);
    });

    it("writes its sealed index as often for an import of x-e4 as for one of x-e2, which writes more files", () => {
      const [first, second] = sealedAlex.imports;
      assert.ok(
        first && second && first.wrote > second.wrote,
        JSON.stringify(sealedAlex.imports),
      );
      assert.equal(second.indexWrites, first.indexWrites);
    });

    it("throws `Unopened`, `changed outside the runtime`, on the next open after one of its files is deleted", async () => {
      const at = await copied(sealedAlex.folder, "sealed-alex-deleted");
      const [one] = (await filesIn(join(at, "sealed"))).filter(
        (file) => !/[\\/]index[\\/]\d+$/.test(file),
      );
      assert.ok(one);
      await rm(one);
      const refused = await unopenedBy(
        openFolderPod({ ...kept, derive: sealedAlex.derive }, at, {
          secret: WORDS,
        }),
      );
      assert.equal(refused.outcome, "changed outside the runtime");
    });

    it("throws `Unopened`, `changed outside the runtime`, from an import whose step reads a file changed since the pod opened, rather than refusing it", async () => {
      const at = await copied(sealedAlex.folder, "sealed-alex-changed");
      const watching = watched();
      const pod = await openFolderPod(
        { ...watching.parts, derive: sealedAlex.derive },
        at,
        { secret: WORDS },
      );
      try {
        watching.changeUnread();
        await assert.rejects(
          pod.import(exported("x-e6")),
          (error) =>
            error instanceof Unopened &&
            error.outcome === "changed outside the runtime",
        );
      } finally {
        await pod.close();
      }
    });
  });

  describe("when a 1.2 pod is opened with its secret", () => {
    it("leaves it 1.2 for a wrong secret; with its secret, upgrades it to 1.3, no file stored under its own path, a file the system put there left as it was, and answers as before", async () => {
      const sealedAlex = await sealedAlexPod();
      const at = await copied(sealedAlex.folder, "sealed-alex-1.2");
      await asEarlier(at, sealedAlex.derive);
      await writeFile(join(at, ".DS_Store"), "by the system");
      const version = async () =>
        (
          JSON.parse(
            await readFile(join(at, ...HEADER.split("/")), "utf8"),
          ) as {
            version: string;
          }
        ).version;
      const parts = { ...kept, derive: sealedAlex.derive };
      assert.equal(
        (await unopenedBy(openFolderPod(parts, at, { secret: "a b c d e f" })))
          .outcome,
        "incorrect secret",
      );
      assert.ok(await checkFolderSecret(parts, at, WORDS));
      assert.equal(await version(), "1.2");
      const opened = await openFolderPod(parts, at, { secret: WORDS });
      try {
        assert.equal(await version(), "1.3");
        const stored = await filesIn(at);
        for (const path of sealedAlex.logical)
          assert.ok(
            !stored.includes(join(at, ...path.split("/"))),
            `${path} is stored under its own path`,
          );
        assert.equal(
          await readFile(join(at, ".DS_Store"), "utf8"),
          "by the system",
        );
        assert.deepEqual(await opened.ask(HELD), sealedAlex.rows);
      } finally {
        await opened.close();
      }
    });
  });

  describe("when the same records are held plain and sealed", () => {
    it("answers every question in the vocabulary the same", async () => {
      const plainAt = join(pods, "plain-alex-same");
      const made = await openPodWith(kept, plainAt);
      try {
        await made.import(exported("x-e2"));
      } finally {
        await made.close();
      }
      const derive = fastDerive();
      const sealedAt = join(pods, "sealed-alex-same");
      await sealedCopy(plainAt, sealedAt, derive);
      const askedOnOpening = async (opening: Promise<Pod>) => {
        const pod = await opening;
        try {
          const rows: unknown[] = [];
          for (const question of (await questions(kept.vocabulary)).keys())
            rows.push([question, await pod.ask(question)]);
          return { rows, encrypted: pod.encrypted };
        } finally {
          await pod.close();
        }
      };
      const plain = await askedOnOpening(openPodWith(kept, plainAt));
      const sealed = await askedOnOpening(
        openFolderPod({ ...kept, derive }, sealedAt, { secret: WORDS }),
      );
      assert.deepEqual([plain.encrypted, sealed.encrypted], [false, true]);
      assert.deepEqual(sealed.rows, plain.rows);
    });
  });
});

const KEY = new Uint8Array(32).map((_, at) => (at * 73 + 41) % 256);

/**
 * An app that holds a key of its own, 32 random bytes, seals a pod under that key in place of six words. Nothing about
 * a key needs stretching, so the pod opens without Argon2id; a passphrase is never accepted as a key.
 */
describe("Encrypting a pod with an app's key · openPod()", () => {
  describe("when a new pod is made with a key", () => {
    it("seals it under a 1.4 header and opens it again with the key to the same answers, deriving nothing with Argon2id", async () => {
      const at = join(pods, "keyed");
      const derive = fastDerive();
      const made = await openFolderPod({ ...kept, derive }, at, {
        key: KEY,
        title: TITLE,
      });
      const rows = await made.ask(HELD);
      await made.close();
      const header = JSON.parse(
        await readFile(join(at, "settings", "encryption.json"), "utf8"),
      ) as { version: string };
      assert.equal(header.version, "1.4");
      const reopened = await openFolderPod({ ...kept, derive }, at, {
        key: new Uint8Array(KEY),
      });
      try {
        assert.ok(reopened.encrypted);
        assert.deepEqual(await reopened.ask(HELD), rows);
      } finally {
        await reopened.close();
      }
      assert.equal(derive.calls, 0);
      const parts = { ...kept, derive };
      for (const [name, opening] of [
        ["another key", { key: KEY.map((byte) => byte ^ 1) }],
        ["words", { secret: WORDS }],
      ] as const)
        assert.equal(
          (await unopenedBy(openFolderPod(parts, at, opening))).outcome,
          "incorrect secret",
          name,
        );
      assert.equal(derive.calls, 0);
      const opened = await openPod(at, { key: KEY });
      assert.ok(opened.encrypted);
      await opened.close();
    });
  });

  describe("given a key that is not 32 random bytes, or a key with a secret", () => {
    it("refuses it before reading the folder: a TypeError for the key, a Refusal for both", async () => {
      const at = join(pods, "never-keyed");
      for (const [name, key] of [
        ["the key as text", Buffer.from(KEY).toString("base64")],
        ["a passphrase's bytes", new TextEncoder().encode(WORDS.slice(0, 32))],
        ["16 bytes", KEY.subarray(16)],
      ] as const)
        await assert.rejects(
          openPod(at, { key: key as Uint8Array }),
          TypeError,
          name,
        );
      await assert.rejects(
        openPod(at, { key: KEY, secret: WORDS }),
        (error) => error instanceof Refusal && !(error instanceof Unopened),
      );
      assert.deepEqual(await filesIn(at).catch(() => []), []);
    });
  });
});

interface SealedAlex {
  readonly folder: string;
  readonly derive: DeriveKey;
  /** The path of each of its files above the sealing. */
  readonly logical: readonly string[];
  readonly rows: unknown;
  readonly imports: readonly { wrote: number; indexWrites: number }[];
}

let sealedAlexMade: Promise<SealedAlex> | undefined;

/** Parts whose pod files count each write of the sealed index and, once told, change any sealed file read that was not read before. */
function watched() {
  const read = new Set<string>();
  let changing = false;
  const counted = { indexWrites: 0 };
  const watch = (files: Files): Files => ({
    iri: files.iri,
    read: async (path) => {
      const bytes = await files.read(path);
      const at = path.startsWith(files.iri)
        ? path.slice(files.iri.length)
        : path;
      if (
        bytes !== undefined &&
        changing &&
        !read.has(at) &&
        /^sealed\/[0-9a-f]{2}\//.test(at)
      ) {
        const changed = new Uint8Array(bytes);
        changed[20] = (changed[20] ?? 0) ^ 1;
        return changed;
      }
      read.add(at);
      return bytes;
    },
    write: (path, bytes) => files.write(path, bytes),
    ...(files.writeNew === undefined
      ? {}
      : {
          writeNew: (path: string, bytes: Uint8Array) => {
            if (path.startsWith(`${SEALED_INDEX}/`)) counted.indexWrites += 1;
            return files.writeNew?.(path, bytes) ?? Promise.resolve(false);
          },
        }),
    replace: (path, bytes, holds) => replaced(files, path, bytes, holds),
    ...(files.remove === undefined ? {} : { remove: files.remove.bind(files) }),
    list: (folder) => files.list(folder),
  });
  const parts: Parts = {
    ...kept,
    folder: (path, iri) => {
      const folder = kept.folder(path, iri);
      return { ...folder, files: watch(folder.files) };
    },
  };
  return {
    parts,
    counted,
    changeUnread: () => {
      changing = true;
    },
  };
}

/** Alex's pod made with the six words, x-e2 then x-e4 imported, asked one question, and closed: made once. */
function sealedAlexPod(): Promise<SealedAlex> {
  sealedAlexMade ??= (async () => {
    const at = join(pods, "sealed-alex");
    const derive = fastDerive();
    const watching = watched();
    const pod = await openFolderPod({ ...watching.parts, derive }, at, {
      secret: WORDS,
    });
    const imports: { wrote: number; indexWrites: number }[] = [];
    let rows: unknown;
    try {
      for (const name of ["x-e2", "x-e4"]) {
        const before = watching.counted.indexWrites;
        const done = await pod.import(exported(name), { match: false });
        imports.push({
          wrote: done.wrote.length,
          indexWrites: watching.counted.indexWrites - before,
        });
      }
      rows = await pod.ask(HELD);
    } finally {
      await pod.close();
    }
    return {
      folder: at,
      derive,
      logical: await logicalIn(at, derive),
      rows,
      imports,
    };
  })();
  return sealedAlexMade;
}

/** The path of each file of the sealed pod in the folder, above the sealing. */
async function logicalIn(at: string, derive: DeriveKey): Promise<string[]> {
  const files = new FolderFiles(at);
  const key = await openHeader(
    (await files.read(HEADER)) ?? new Uint8Array(),
    WORDS,
    derive,
  );
  const index = await SealedIndex.open(files, key);
  return new EncryptedFiles(files, key, { index }).list("");
}

/** A copy of the folder, its sealed answers beside it left behind. */
async function copied(from: string, name: string): Promise<string> {
  const at = join(pods, name);
  await cp(from, at, { recursive: true });
  return at;
}

/** The sealed pod in the folder written back as a 1.2 runtime held it: a 1.2 header, each file sealed under its own path. */
async function asEarlier(at: string, derive: DeriveKey): Promise<void> {
  const files = new FolderFiles(at);
  const header = new TextDecoder().decode(await files.read(HEADER));
  const key = await openHeader(new TextEncoder().encode(header), WORDS, derive);
  const sealed = new EncryptedFiles(files, key, {
    index: await SealedIndex.open(files, key),
  });
  const held: [string, Uint8Array][] = [];
  for (const path of await sealed.list(""))
    held.push([path, (await sealed.read(path)) ?? new Uint8Array()]);
  const earlier = new TextEncoder().encode(
    header
      .replace('"version": "1.3"', '"version": "1.2"')
      .replace('"resourceFormat": 3', '"resourceFormat": 2'),
  );
  await rm(join(at, "sealed"), { recursive: true });
  await files.write(HEADER, earlier);
  await new EncryptedFiles(
    files,
    await openHeader(earlier, WORDS, derive),
  ).writeAll(held);
}

/** The plain pod's files sealed, as they are, into a new pod made with the six words in the other folder. */
async function sealedCopy(
  from: string,
  to: string,
  derive: DeriveKey,
): Promise<void> {
  const plain = new FolderFiles(from);
  const files = new FolderFiles(to);
  const made = await newHeader(WORDS, derive);
  assert.ok(await madeNewPod(files, made));
  const sealed = new EncryptedFiles(files, made.key, {
    index: await SealedIndex.open(files, made.key),
  });
  const held: [string, Uint8Array][] = [];
  for (const path of await plain.list(""))
    held.push([path, (await plain.read(path)) ?? new Uint8Array()]);
  await sealed.writeAll(held);
}

/**
 * `replayKit` builds a kit's pod by performing its story, and `kitDownload` returns the path of one of its exports.
 * Both come from `cascade-runtime/fixtures`, so a developer gets a realistic pod or export for a test without
 * writing one.
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

    it("returns the steps it performed, in the story's order, from making the pod to the step named", () => {
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

    it("builds a pod whose matcher judgments cite only reference tables the app holds", async () => {
      const used = await select(
        replayed,
        `SELECT DISTINCT ?version WHERE {
          ?judgment prov:wasAttributedTo <${MATCHER}> .
          { ?judgment prov:wasDerivedFrom ?version }
          UNION { ?assertion cascade:assertedJudgment ?judgment ; cascade:assertedUnderRuleListVersion ?version }
          ?version prov:specializationOf/a cascade:ReferenceSeries }`,
      );
      const cited = used.map(({ version }) => version ?? "");
      const held = shipped(await (await tablesBeside(parent())).references());
      assert.ok(cited.length > 0, "the matcher cites no reference");
      for (const version of cited)
        assert.ok(held.includes(version), `${version} is not the app's`);
    });

    it("builds a pod that `openPod` opens without matching it again", async () => {
      assert.equal(await replayed.opened, undefined);
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
 * A site can save a pod's answers as files, so a web page shows the pod without first downloading the query engine.
 * `samplesToPublish` saves kits' pods the same way, as samples a site can offer.
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
      Object.values(row).flatMap((value) =>
        typeof value === "string" && value.startsWith("http") ? [value] : [],
      ),
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

    it("returns the name and title of every kit the vocabulary carries, when one kit is asked for", async () => {
      const carried = (
        await readdir(inKit("conformance"), { withFileTypes: true })
      )
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort();
      assert.deepEqual([...samples.kits.keys()].sort(), carried);
      for (const title of samples.kits.values()) assert.ok(title.length > 0);
      assert.match(samples.kits.get("alex-rivera") ?? "", /Alex/);
    });

    it("returns a kit's sample as the pod's files, a list of them and one pack of them, beside its `answers.json`, `pod.json` and `lookups.json`", () => {
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
