import assert from "node:assert/strict";
import {
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
import { after, before, test } from "node:test";
import {
  JUSTIFICATIONS,
  OxigraphStore,
  recordName,
} from "@cascade-runtime/runtime";
import { findRoot, localVocabulary } from "@cascade-runtime/runtime/node";
import { type Exported, openPod, type Pod } from "cascade-runtime";
import { kitDownload, replayKit } from "cascade-runtime/fixtures";
import { resolved } from "../src/node/resolved.js";
import { openPodWith } from "../src/pod.js";

const KIT = "conformance/alex-rivera";
const ALEX = `${KIT}/scripted-input/alex`;
const QUESTION = "pod/My active allergies";
const PREFIXES = `PREFIX jdg: <https://ns.cascadeprotocol.org/judgments/v1-draft#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pav: <http://purl.org/pav/>
PREFIX health: <https://ns.cascadeprotocol.org/health/v1#>
PREFIX cascade: <https://ns.cascadeprotocol.org/core/v1#>
`;
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const HAD_MEMBER = "http://www.w3.org/ns/prov#hadMember";
const UUID4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let kit: string;
let folder: string;
let pod: Pod;

before(async () => {
  const root = findRoot(dirname(fileURLToPath(import.meta.url)));
  kit = (await localVocabulary(root)).files.folder;
  folder = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
  pod = await openPod(folder);
});

after(async () => {
  await pod.close();
  await rm(folder, { recursive: true, force: true });
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
    return recordName([server, type, id]);
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
<${named}> a jdg:Judgment ;
    jdg:verdict jdg:About ; jdg:subject <${pod.subject}> ; jdg:basis jdg:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${pod.owner}> ;
    prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <${pod.owner}> ; prov:hadRole jdg:patient ] .
<${pod.owner}> a prov:Person .`;
}

function judgment(verdict: string, members: readonly string[]): string {
  return `${PREFIXES}
<urn:cascade:this-judgment> a jdg:Judgment ; jdg:verdict jdg:${verdict} ;
    ${members.map((member) => `prov:hadMember <${member}> ;`).join(" ")}
    prov:wasAttributedTo <${pod.owner}> .
<${pod.owner}> a prov:Person .`;
}

async function allergens(of: Pod = pod): Promise<string[]> {
  return (await of.ask(QUESTION)).map(({ allergen }) => allergen ?? "").sort();
}

test("an import without the claim only files and names its unclaimed profile; an About judged and a match bring it into the views, and each read after a step sees it", async () => {
  const profile = await profileOf("J1");
  const claimed = async (): Promise<boolean[]> =>
    (await pod.look(exported("x-e2"))).map((source) => source.claimed);
  const imported = await pod.import(exported("x-e2"), { match: false });
  assert.ok(imported.activity);
  assert.equal(imported.matched, undefined);
  assert.deepEqual(imported.claimed, []);
  assert.deepEqual(imported.unclaimed, [profile]);
  assert.deepEqual(await pod.ask(QUESTION), []);
  assert.deepEqual(await claimed(), [false]);

  await assert.rejects(
    pod.judge(about(profile, "urn:uuid:9e1d1f66-8f43-4a8e-9c7b-2f0c5e6d7a81")),
    /urn:cascade:this-judgment/,
  );
  const judged = await pod.judge(about(profile));
  assert.match(judged.judgment ?? "", /^urn:uuid:/);
  assert.deepEqual(await claimed(), [true]);
  const matched = await pod.match(imported.activity);
  assert.equal(matched.refused, undefined);
  assert.deepEqual(await allergens(), [
    "Codeine",
    "Latex",
    "Penicillin G",
    "Sulfamethoxazole",
  ]);
});

test("an import with the claim records an About for each unclaimed profile and is matched at once", async () => {
  const imported = await pod.import(exported("x-e4"), { aboutSubject: true });
  assert.deepEqual(
    imported.claimed.map(({ profile }) => profile),
    [await profileOf("J2")],
  );
  assert.deepEqual(imported.unclaimed, []);
  const wrote = imported.matched?.wrote ?? [];
  const judgments = await pod.ask({
    query: `${PREFIXES}SELECT ?justification (GROUP_CONCAT(STR(?member)) AS ?members) WHERE {
      VALUES ?file { ${wrote.map((path) => `<${pod.address}${path}>`).join(" ")} }
      GRAPH ?file { ?judgment a jdg:Judgment ; jdg:justification ?justification ; prov:hadMember ?member } }
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
        expected.map(async ({ justification = "", members = "" }) =>
          joined(
            JUSTIFICATIONS[justification] ?? justification,
            await Promise.all(members.split(", ").map(named)),
          ),
        ),
      )
    ).sort(),
  );

  const again = await pod.import(exported("x-e6"), { aboutSubject: true });
  assert.deepEqual(again.claimed, []);
});

test("the look reads an export's or a download's index and writes nothing: a FHIR source by its server, a C-CDA by its custodian with its sections, claimed once the subject's records from it are filed", async () => {
  const before = await filesIn(folder);
  const sources = await pod.look(exported("x-e12"));
  assert.deepEqual(
    await pod.look(
      await heldExport(exported("x-e12"), (bytes) => new Blob([bytes])),
    ),
    sources,
  );
  assert.deepEqual(await filesIn(folder), before);
  assert.deepEqual(
    sources.map(({ name, server, claimed }) => [name, server, claimed]),
    [
      ["Larkspur Valley Health", "https://ehr.larkspur.example/fhir/R4", true],
      ["Larkspur Valley Health", "https://fhir.larkspur.example/r4", false],
      [
        "Meridian Health System",
        "https://fhir.meridian.example/api/FHIR/R4",
        true,
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

  const download = join(
    findRoot(dirname(fileURLToPath(import.meta.url))),
    "developer-story",
    "priya-natarajan",
    "kestrel-harbor-health-summary.xml",
  );
  const at = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
  const priya = await openPod(at);
  try {
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
    assert.deepEqual(source.records, {});
    assert.deepEqual(source.received, ["2025-04-03T09:15:22Z"]);
    assert.equal(source.claimed, false);
    const broken = join(at, "broken.xml");
    await writeFile(broken, '<ClinicalDocument xmlns="urn:hl7-org:v3"><id>');
    await assert.rejects(
      priya.look(broken),
      /^Error: ccda-download cannot read /,
    );

    const imported = await priya.import(download, { aboutSubject: true });
    assert.equal(imported.refused, undefined);
    assert.deepEqual(
      (await priya.look(download)).map(({ claimed }) => claimed),
      [true],
    );
  } finally {
    await priya.close();
    await rm(at, { recursive: true, force: true });
  }
});

test("an entry is filed and matched by default; a person's judgment records the versions they saw; a step the rules refuse comes back refused", async () => {
  const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
  const alex = people.find(
    ([, p, o]) => p.value === FOAF_NAME && o.value === "Alex",
  )?.[0].value;
  const storage = people.find(
    ([s, p]) => s.value === alex && p.value === STORAGE,
  )?.[2].value;
  assert.ok(alex && storage);
  const a1 = (await readFile(inKit(`${ALEX}/entries/a1.ttl`), "utf8"))
    .replaceAll(`<${alex}>`, `<${pod.subject}>`)
    .replaceAll(`<${storage}profile/card.ttl#me>`, `<${pod.owner}>`);
  const entered = await pod.enter(a1);
  assert.ok(entered.activity);
  assert.ok(entered.matched);
  const peanuts = await pod.ask({
    query: `${PREFIXES}SELECT ?entry ?record WHERE {
      ?entry health:allergen "Peanuts" ; cascade:mergedFrom ?record }`,
  });
  assert.equal(peanuts.length, 1);
  const { entry = "", record = "" } = peanuts[0] ?? {};

  const [current] = await pod.ask({
    query: `${PREFIXES}SELECT ?version WHERE { <${record}> pav:hasCurrentVersion ?version }`,
  });
  const judged = await pod.judge(judgment("Erroneous", [record]));
  const used = await pod.ask({
    query: `${PREFIXES}SELECT ?version WHERE { <${judged.judgment ?? ""}> prov:used ?version }`,
  });
  assert.deepEqual(used, [current]);

  const held = await filesIn(folder);
  await assert.rejects(
    pod.judge(judgment("Same", [entry, record])),
    (error: Error) => error.message.includes(entry),
  );
  assert.deepEqual(await filesIn(folder), held);

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

test("files no importer reads are refused before the Bridge loads, and write nothing", async () => {
  const unloaded = await openPodWith(
    {
      ...(await resolved()),
      loadBridge: () => Promise.reject(new Error("the Bridge was loaded")),
    },
    undefined,
    {},
  );
  const nothing = new Uint8Array();
  const refused: [string, Exported, RegExp][] = [
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
    [
      "a folder no importer reads",
      new Map([["Downloads/notes.txt", nothing]]),
      /^no importer of .* reads Downloads$/,
    ],
  ];
  try {
    for (const [input, given, why] of refused) {
      const done = await unloaded.import(given);
      assert.match(done.refused ?? "", why, input);
      assert.deepEqual(done.wrote, [], input);
    }
  } finally {
    await unloaded.close();
  }
});

test("ask runs a question by name or the caller's own query, under the lens named", async () => {
  const query = `SELECT ?s WHERE { GRAPH <urn:cascade:derived:export> { ?s ?p ?o } } LIMIT 1`;
  assert.equal((await pod.ask({ query }, { lens: "export" })).length, 1);
  assert.deepEqual(await pod.ask({ query }), []);
  await assert.rejects(
    pod.ask("pod/No such question"),
    /pod\/My active allergies/,
  );
  await assert.rejects(pod.ask(QUESTION, { lens: "no such lens" }), /everyday/);
  await assert.rejects(
    pod.ask({ query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }" }),
    /SELECT/,
  );
});

test("a new pod is named from a base of its own, and the vocabulary's queries find it there; opened again it is the pod it was", async () => {
  const [, base] = /^pod:\/\/([^/]+)\/$/.exec(pod.address) ?? [];
  assert.match(base ?? "", UUID4);
  assert.ok(pod.owner.startsWith(pod.address));
  const inMemory = await openPod();
  assert.notEqual(inMemory.address, pod.address);
  await inMemory.close();

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

  const { address, subject, owner } = pod;
  const rows = await allergens();
  await pod.close();
  pod = await openPod(folder);
  assert.deepEqual(
    [pod.address, pod.subject, pod.owner],
    [address, subject, owner],
  );
  assert.deepEqual(await allergens(), rows);

  const notAPod = await mkdtemp(join(tmpdir(), "cascade-runtime-"));
  try {
    await writeFile(join(notAPod, "notes.txt"), "");
    await assert.rejects(openPod(notAPod), /owner's profile/);
  } finally {
    await rm(notAPod, { recursive: true, force: true });
  }
});

test("a kit's story replayed through a step is a pod openPod continues", async () => {
  const at = await mkdtemp(join(tmpdir(), "cascade-runtime-kit-"));
  try {
    const steps = await replayKit("alex-rivera", at, { through: "J1" });
    assert.deepEqual(
      steps.map(({ step, kind }) => [step, kind]),
      [
        ["E1", "creation"],
        ["E2", "import"],
        ["M5", "matcher"],
        ["J1", "judgment"],
      ],
    );
    assert.ok((steps[1]?.wrote.length ?? 0) > 0);
    const people = await triplesOf(`${KIT}/scripted-input/people.ttl`);
    const replayed = await openPod(at);
    try {
      assert.ok(
        people.some(
          ([s, p, o]) =>
            s.value === replayed.subject &&
            p.value === STORAGE &&
            o.value === replayed.address,
        ),
      );
      assert.equal((await allergens(replayed)).length, 4);
    } finally {
      await replayed.close();
    }
    await assert.rejects(replayKit("alex-rivera", at), /holds files/);
    const empty = join(at, "..", `${at.split(/[\\/]/).at(-1)}-next`);
    await assert.rejects(replayKit("no-such-kit", empty), /alex-rivera/);
    await assert.rejects(
      replayKit("alex-rivera", empty, { through: "no such step" }),
      /no such step/,
    );
  } finally {
    await rm(at, { recursive: true, force: true });
  }
});

test("a kit's download, a folder or a file, is found by name, or refused naming the choices", async () => {
  const x12 = await kitDownload("alex-rivera", "x-e12");
  assert.ok((await readdir(x12)).includes("apple_health_export"));
  const summary = "kestrel-harbor-health-summary.xml";
  assert.match(
    await readFile(await kitDownload("priya-natarajan", summary), "utf8"),
    /<ClinicalDocument/,
  );
  for (const [kit, download, reason] of [
    ["no-such-kit", "x-e12", /there are .*alex-rivera/],
    ["alex-rivera", "x-e99", /it has .*x-e12/],
  ] as const)
    await assert.rejects(kitDownload(kit, download), reason);
});
