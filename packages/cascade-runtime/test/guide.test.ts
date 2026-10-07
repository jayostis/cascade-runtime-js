import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import {
  lenses,
  OxigraphStore,
  questions,
  recordName,
  Shapes,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  findRoot,
  type LocalVocabulary,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { loadHospital } from "@cascade-runtime/demo-hospital/node";
import {
  type ExportSource,
  openPod,
  type Pod,
  type Row,
} from "cascade-runtime";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const PACKAGE = join(ROOT, "packages", "cascade-runtime");
const GUIDE = join(PACKAGE, "guide", "AGENTS.md");
const KIT = "conformance/alex-rivera";
const ALEX = `${KIT}/scripted-input/alex`;
/** The exports `pickExport()` gives, in turn. */
const PICKED = ["x-e2", "x-e4", "x-e10", "x-e12"];
/** Patient A at Cascade North, as whom `openBrowser()` signs in. */
const A_NORTH = "pt-1001";
const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const HAD_MEMBER = "http://www.w3.org/ns/prov#hadMember";

interface Block {
  readonly heading: string;
  /** Its position among the blocks under that heading, from 1. */
  readonly position: number;
  readonly code: string;
}

/** Each part of the guide, by its heading, and each fenced block in document order. */
function read(guide: string): {
  sections: Map<string, string[]>;
  blocks: Block[];
} {
  const sections = new Map<string, string[]>();
  const blocks: Block[] = [];
  let heading = "the guide's top";
  let fence: { language: string; lines: string[] } | undefined;
  for (const line of guide.split(/\r?\n/)) {
    if (fence !== undefined) {
      if (line.startsWith("```")) {
        assert.equal(
          fence.language,
          "js",
          `a block under "${heading}" is fenced as "${fence.language}", not js`,
        );
        const position =
          blocks.filter((block) => block.heading === heading).length + 1;
        blocks.push({ heading, position, code: fence.lines.join("\n") });
        fence = undefined;
      } else fence.lines.push(line);
      continue;
    }
    if (line.startsWith("```")) {
      fence = { language: line.slice(3).trim(), lines: [] };
      continue;
    }
    const titled = /^#{2,} (.*)$/.exec(line);
    if (titled) {
      heading = titled[1] ?? "";
      sections.set(heading, []);
    } else sections.get(heading)?.push(line);
  }
  assert.equal(fence, undefined, `a block under "${heading}" is never closed`);
  return { sections, blocks };
}

/** The name each item of a section's lists starts with, in backticks or bold. */
function itemsUnder(
  sections: Map<string, string[]>,
  heading: string,
): string[] {
  const lines = sections.get(heading);
  assert.ok(lines, `the guide has no section "${heading}"`);
  return lines
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const name = /^- (?:`([^`]+)`|\*\*([^*]+)\*\*)/.exec(line);
      assert.ok(
        name,
        `an item under "${heading}" starts with no name: ${line}`,
      );
      return name[1] ?? name[2] ?? "";
    });
}

function sorted(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

let vocabulary: LocalVocabulary;
let guide: { sections: Map<string, string[]>; blocks: Block[] };
let ran: { code: number; stderr: string };
let folder: string;
let opened: Pod | undefined;
let notTheirs: string;
let bronchitis: string;
/** Larkspur's old and new asthma records, which the person says are not the same. */
let notTheSame: readonly [string, string];

/** The pod the examples left, opened only when they all ran: a missing folder would open as a new, empty pod. */
function examplesPod(): Pod {
  assert.ok(opened, "the guide's examples did not all run, so no pod is read");
  return opened;
}

/** The profile a judgment of Alex's kit names. */
async function profileOf(judgment: string): Promise<string> {
  const triples = await new OxigraphStore().parse(
    await readFile(
      join(
        vocabulary.files.folder,
        ...`${ALEX}/judgments/${judgment}.ttl`.split("/"),
      ),
    ),
    `file:///${judgment}.ttl`,
  );
  const member = triples.find(([, p]) => p.value === HAD_MEMBER)?.[2].value;
  assert.ok(member, `${judgment} names no member`);
  return member;
}

/** A hospital's record in Alex's kit, by its handle. */
async function recordOf(handle: string): Promise<string> {
  const { records } = JSON.parse(
    await readFile(
      join(
        vocabulary.files.folder,
        ...`${KIT}/expected/handles.json`.split("/"),
      ),
      "utf8",
    ),
  ) as {
    records: Record<string, { server?: string; type?: string; id?: string }>;
  };
  const { server, type, id } = records[handle] ?? {};
  assert.ok(server && type && id, `${handle} is no hospital's record`);
  return recordName([server, type, id]);
}

/** The module the guide's blocks make, in order, after the stand-ins for the person. */
function examples(blocks: readonly Block[]): string {
  const exports = PICKED.map((name) =>
    join(
      vocabulary.files.folder,
      ...`${ALEX}/downloads/${name}/apple_health_export`.split("/"),
    ),
  );
  const prelude = `import { writeSync as __writeSync } from "node:fs";
let __example = "the stand-ins, before any example";
process.on("exit", (code) => {
  if (code !== 0) __writeSync(2, \`\\nThe example that failed: \${__example}\\n\`);
});
const __exports = ${JSON.stringify(exports)};
function pickExport() {
  const picked = __exports.shift();
  if (picked === undefined) throw new Error("pickExport() was called more often than the test has exports");
  return picked;
}
/**
 * The person, in their browser, signs in at North as patient A and presses Allow, on the page the app's server answers
 * with the example's \`demoHospitals\`.
 */
async function openBrowser(authorize) {
  const form = new URLSearchParams(authorize.searchParams);
  form.set("patient", ${JSON.stringify(A_NORTH)});
  form.set("decision", "allow");
  const answer = await demoHospitals(\`\${authorize.origin}\${authorize.pathname}\`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  return new URL(answer.headers.get("Location"));
}
async function askPerson(question, shown) {
  process.stderr.write(\`\${JSON.stringify({ example: __example, asked: shown })}\\n\`);
  const said = JSON.stringify(shown);
  if (said.includes(${JSON.stringify(notTheirs)})) return false;
  return !${JSON.stringify(notTheSame)}.every((record) => said.includes(record));
}
async function showPerson(shown) {
  process.stderr.write(\`\${JSON.stringify({ example: __example, shown })}\\n\`);
}
`;
  return [
    prelude,
    ...blocks.map(
      ({ heading, position, code }) =>
        `__example = ${JSON.stringify(`"${heading}", example ${position}`)};\n${code}`,
    ),
  ].join("\n");
}

before(async () => {
  vocabulary = await localVocabulary(ROOT);
  notTheirs = await profileOf("J22");
  bronchitis = await recordOf("H1-CON-BRONCH");
  notTheSame = [
    await recordOf("H2O-CON-ASTHMA"),
    await recordOf("H2F-CON-ASTHMA"),
  ];
  guide = read(await readFile(GUIDE, "utf8"));
  const module = join(ROOT, "build", "guide", "examples.mjs");
  await mkdir(dirname(module), { recursive: true });
  await writeFile(module, examples(guide.blocks));
  folder = await mkdtemp(join(tmpdir(), "cascade-guide-"));
  ran = await promisify(execFile)(process.execPath, [module], {
    cwd: folder,
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  }).then(
    ({ stderr }) => ({ code: 0, stderr }),
    (error: { code?: number; stderr?: string }) => ({
      code: error.code ?? -1,
      stderr: error.stderr ?? String(error),
    }),
  );
  if (ran.code === 0) opened = await openPod(join(folder, "pods", "mine"));
});

after(async () => {
  await opened?.close();
  if (folder !== undefined) await rm(folder, { recursive: true, force: true });
});

test("every example in the guide runs, in order", () => {
  assert.equal(
    ran.code,
    0,
    `the guide's examples stopped: ${ran.stderr.split("\n").slice(-30).join("\n")}`,
  );
});

test("the hospital example brings patient A's North record into a pod of its own, after a look at it", async () => {
  const { hospital, patients } = await loadHospital("cascade-north");
  const looked = ran.stderr
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { example: string; asked?: unknown })
    .filter(
      ({ example, asked }) =>
        example === '"Connect to a hospital", example 1' && asked !== undefined,
    );
  assert.equal(looked.length, 1, "the hospital example asked nothing");
  const sources = looked[0]!.asked as ExportSource[];
  assert.deepEqual(
    sources.map(({ server, claimed }) => ({ server, claimed })),
    [{ server: hospital.fhirBase, claimed: false }],
  );
  const active = (patients[A_NORTH]!.entry ?? []).filter(
    ({ resource }) =>
      resource.resourceType === "AllergyIntolerance" &&
      (
        resource.clinicalStatus as { coding?: { code?: string }[] } | undefined
      )?.coding?.some(({ code }) => code === "active"),
  );
  assert.ok(active.length > 0);
  const pod = await openPod(join(folder, "pods", "hospital"));
  try {
    assert.equal(
      (await pod.ask("pod/My active allergies")).length,
      active.length,
    );
  } finally {
    await pod.close();
  }
});

test("the reading example shows each allergy as its entry states it, its records beneath", async () => {
  const reading = ran.stderr
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { example: string; shown: unknown })
    .filter(({ example }) => example === '"Ask", example 1');
  assert.equal(reading.length, 1, "the reading example showed no one thing");
  const allergies = reading[0]?.shown as {
    allergen?: string;
    status?: string;
    criticality?: string;
    records?: string;
    from: string[];
  }[];
  assert.ok(allergies.length > 0, "the reading example showed no allergy");
  const stated = new Map<string, Set<string>>();
  for (const { record, field, value } of await examplesPod().ask(
    "record/What each version says",
  ))
    if (record && value && field?.endsWith("#criticality"))
      stated.set(record, (stated.get(record) ?? new Set()).add(value));
  const severity = ["unable-to-assess", "low", "high"];
  const mostSevere = (records: readonly string[]): string | undefined =>
    records
      .flatMap((record) => [...(stated.get(record) ?? [])])
      .sort((a, b) => severity.indexOf(a) - severity.indexOf(b))
      .at(-1);
  for (const { allergen, status, criticality, records, from } of allergies) {
    assert.equal(status, "active", `${allergen} is shown with no status`);
    assert.equal(
      from.length,
      Number(records),
      `${allergen}'s records are not beneath it`,
    );
    assert.equal(
      criticality,
      mostSevere(from),
      `${allergen} is not shown with its entry's criticality`,
    );
  }
  const penicillin = allergies.find(
    ({ allergen }) => allergen === "Penicillin",
  );
  assert.equal(penicillin?.criticality, "high", "Penicillin is not shown high");
  assert.ok(
    penicillin.from.some((record) => !stated.has(record)),
    "every record beneath Penicillin states a criticality",
  );
});

test("the pod the examples leave conforms to the vocabulary's shapes", async () => {
  const pod = examplesPod();
  const at = join(folder, "pods", "mine");
  const labelled = new Set(
    vocabulary.layout.built
      .filter(({ kind }) => kind === undefined)
      .flatMap(({ file }) => file ?? []),
  );
  const store = new OxigraphStore();
  const triples: Triple[] = [];
  for (const entry of await readdir(at, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".ttl")) continue;
    const path = join(entry.parentPath, entry.name)
      .slice(at.length + 1)
      .split(/[\\/]/)
      .join("/");
    if (labelled.has(path)) continue;
    triples.push(
      ...(await store.parse(
        await readFile(join(at, ...path.split("/"))),
        pod.address + path,
      )),
    );
  }
  assert.ok(triples.length > 0);
  const shapes = await Shapes.read(vocabulary.files, () => new OxigraphStore());
  assert.deepEqual(await shapes.violations(triples), []);
});

test("each template does what the guide says, read through the vocabulary's questions", async () => {
  const pod = examplesPod();
  const ask = (question: string): Promise<Row[]> => pod.ask(question);
  const entryOf = new Map(
    (await ask("record/Which entry shows it")).flatMap(({ record, entry }) =>
      record !== undefined && entry !== undefined ? [[record, entry]] : [],
    ),
  );
  const entriesIn = async (question: string): Promise<Set<string>> =>
    new Set((await ask(question)).flatMap(({ entry }) => entry ?? []));

  const views = new Map(
    vocabulary.layout.views.map(({ file, title }) => [
      `${pod.address}${file ?? ""}`,
      title ?? "",
    ]),
  );
  const entered = new Set(
    (await ask("entry/Where it came from")).flatMap(({ entry, document }) =>
      entry !== undefined && document === undefined ? [entry] : [],
    ),
  );
  const shown = await ask("entry/What it shows");
  const enteredIn = new Map(
    [...entered].map((entry) => [
      views.get(shown.find((row) => row.entry === entry)?.view ?? "") ?? "",
      entry,
    ]),
  );
  assert.deepEqual(sorted(enteredIn.keys()), [
    "Allergies",
    "Conditions",
    "Immunizations",
    "Procedures",
  ]);
  for (const [title, question] of [
    ["Conditions", "pod/My active conditions"],
    ["Immunizations", "pod/My immunizations"],
    ["Procedures", "pod/My procedures"],
  ] as const)
    assert.ok(
      (await entriesIn(question)).has(enteredIn.get(title) ?? ""),
      `the entered ${title} is no row of ${question}`,
    );
  assert.ok(
    !(await entriesIn("pod/My active allergies")).has(
      enteredIn.get("Allergies") ?? "",
    ),
    "the entered allergy is a row of pod/My active allergies",
  );

  const counting = new Set(
    (await ask("judgment/Whether it counts")).flatMap(({ judgment, counts }) =>
      counts === "true" && judgment !== undefined ? [judgment] : [],
    ),
  );
  const judged = new Map<
    string,
    { verdict?: string; members: string[]; retracts?: string; byOwner: boolean }
  >();
  for (const row of await ask("judgment/Who judged what")) {
    const name = row.judgment ?? "";
    const one = judged.get(name) ?? {
      ...(row.verdict === undefined ? {} : { verdict: row.verdict }),
      ...(row.retracts === undefined ? {} : { retracts: row.retracts }),
      members: [],
      byOwner: row.author === pod.owner,
    };
    if (row.member !== undefined && !one.members.includes(row.member))
      one.members.push(row.member);
    judged.set(name, one);
  }
  const persons = [...judged].filter(([, { byOwner }]) => byOwner);
  const ofVerdict = (verdict: string) =>
    persons.filter(([, one]) => one.verdict === JDG + verdict);

  for (const verdict of ["Same", "Different", "Erroneous"])
    assert.ok(ofVerdict(verdict).length > 0, `no ${verdict} by the person`);
  for (const [name, { members }] of ofVerdict("Same")) {
    if (!counting.has(name)) continue;
    const entries = new Set(members.map((member) => entryOf.get(member)));
    assert.equal(
      entries.size,
      1,
      `the Same ${name} is in ${entries.size} entries`,
    );
    assert.ok(
      !entries.has(undefined),
      `a member of the Same ${name} is in no entry`,
    );
  }
  for (const [name, { members }] of ofVerdict("Different")) {
    assert.ok(counting.has(name), `the Different ${name} does not count`);
    const entries = new Set(members.map((member) => entryOf.get(member)));
    assert.equal(
      entries.size,
      members.length,
      `the Different ${name} shares an entry`,
    );
    assert.ok(
      !entries.has(undefined),
      `a member of the Different ${name} is in no entry`,
    );
  }
  const [oldAsthma, newAsthma] = notTheSame;
  const asthma = entryOf.get(newAsthma);
  assert.deepEqual(
    [...entryOf].flatMap(([record, entry]) =>
      entry === asthma ? [record] : [],
    ),
    [newAsthma],
    "the new asthma record is not alone in its entry",
  );
  assert.ok(
    (await ask("pod/My active conditions")).some(
      ({ entry, condition }) => entry === asthma && condition === "Asthma",
    ),
    "the new asthma record's entry is not active Asthma",
  );
  assert.equal(
    entryOf.get(oldAsthma),
    entryOf.get(bronchitis),
    "the old asthma record is no longer with bronchitis",
  );

  const hidden = await ask("record/Why it is in no view");
  const hiddenFor = (record: string, why: string) =>
    hidden.some((row) => row.record === record && row.why === REC + why);
  for (const [, { members }] of ofVerdict("Erroneous"))
    for (const member of members)
      assert.ok(
        hiddenFor(member, "JudgedErroneous"),
        `${member} is not hidden as erroneous`,
      );

  const retracted = persons.flatMap(([, { retracts }]) => retracts ?? []);
  assert.ok(retracted.length > 0, "the person retracted nothing");
  for (const judgment of retracted)
    assert.ok(
      !counting.has(judgment),
      `the retracted ${judgment} still counts`,
    );

  const abouts = (profile: string) =>
    [...judged].filter(
      ([name, one]) =>
        one.verdict === `${JDG}About` &&
        one.members.includes(profile) &&
        counting.has(name),
    );
  assert.deepEqual(
    abouts(notTheirs),
    [],
    "the son's profile has a counting About",
  );
  const his = (await ask("profile/Which records name it")).flatMap(
    ({ profile, record }) => (profile === notTheirs && record ? [record] : []),
  );
  assert.ok(his.length > 0, "no record names the son's profile");
  for (const record of his)
    assert.ok(
      hiddenFor(record, "PatientNotClaimed"),
      `the son's ${record} is in a view`,
    );
  const claimedLater = abouts(await profileOf("J12"));
  assert.ok(
    claimedLater.some(([, { byOwner }]) => byOwner),
    "the profile J12 claims has no counting About by the owner",
  );
});

test("the guide's lists are the vocabulary's and the starter's", async () => {
  const { sections } = guide;
  assert.deepEqual(
    sorted(itemsUnder(sections, "Questions")),
    sorted((await questions(vocabulary.files)).keys()),
  );
  assert.deepEqual(
    sorted(itemsUnder(sections, "Lenses")),
    sorted(await lenses(vocabulary.files)),
  );
  assert.deepEqual(
    sorted(itemsUnder(sections, "What a pod holds")),
    sorted(vocabulary.layout.views.flatMap(({ title }) => title ?? [])),
  );
  const starter = JSON.parse(
    await readFile(join(PACKAGE, "starter", "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.deepEqual(
    sorted(
      itemsUnder(sections, "The starter").map((command) => {
        const script = /^npm (?:run (\S+)|(start))/.exec(command);
        assert.ok(script, `"${command}" runs no npm script`);
        return script[1] ?? script[2] ?? "";
      }),
    ),
    sorted(Object.keys(starter.scripts)),
  );
});

test("the starter's AGENTS.md points at the guide that ships", async () => {
  const agents = await readFile(join(PACKAGE, "starter", "AGENTS.md"), "utf8");
  const path = /node_modules\/cascade-runtime\/([^\s`]+)/.exec(agents)?.[1];
  assert.equal(path, "guide/AGENTS.md");
  const { files } = JSON.parse(
    await readFile(join(PACKAGE, "package.json"), "utf8"),
  ) as { files: string[] };
  assert.ok(files.includes(path), `the package's files leave out ${path}`);
});
