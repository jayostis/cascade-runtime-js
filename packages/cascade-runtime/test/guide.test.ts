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
import { after, before, describe, it } from "node:test";
import {
  lenses,
  OxigraphStore,
  questions,
  recordFromServerName,
  Shapes,
  type Triple,
} from "@cascade-runtime/runtime";
import {
  findRoot,
  type LocalVocabulary,
  localVocabulary,
} from "@cascade-runtime/runtime/node";
import { recordsAt } from "@the-cascade-protocol/sandbox";
import { loadHospital } from "@the-cascade-protocol/sandbox/node";
import {
  type ExportSource,
  openPod,
  type Pod,
  type Row,
} from "cascade-runtime";
import { settled } from "./settled.js";

const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
const PACKAGE = join(ROOT, "packages", "cascade-runtime");
const GUIDE = join(PACKAGE, "guide", "AGENTS.md");
const KIT = "conformance/alex-rivera";
const ALEX = `${KIT}/scripted-input/alex`;
/** The exports `pickExport()` gives, in turn. */
const PICKED = ["x-e2", "x-e4", "x-e10", "x-e12"];
/** Patient A at Cascade North, as whom `openBrowser()` signs in. */
const A_NORTH = "pt-1001";
const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
const HAD_MEMBER = "http://www.w3.org/ns/prov#hadMember";

interface Block {
  readonly heading: string;
  /** Its position among the blocks under that heading, from 1. */
  readonly position: number;
  readonly code: string;
}

/**
 * Each part of the guide, by its heading, and each block fenced as js in document order; a block fenced as ts is an
 * app's configuration, shown and not run.
 */
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
        assert.ok(
          ["js", "ts"].includes(fence.language),
          `a block under "${heading}" is fenced as "${fence.language}", not js or ts`,
        );
        if (fence.language === "ts") {
          fence = undefined;
          continue;
        }
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

/** The columns a query's outermost SELECT gives: a bare variable, or the one an expression is bound to with AS. */
function projected(text: string): Set<string> {
  let head =
    /\bSELECT\b(?:\s+DISTINCT)?([\s\S]*?)\bWHERE\b/.exec(text)?.[1] ?? "";
  for (let inner = /\(([^()]*)\)/; inner.test(head);)
    head = head.replace(
      inner,
      (_, body: string) => /\bAS\s+(\?\w+)\s*$/.exec(body)?.[1] ?? "",
    );
  return new Set(head.match(/\?\w+/g) ?? []);
}

/**
 * `guide/AGENTS.md` ships in the package and tells a developer, or a coding agent, how to build an app on a pod, with
 * JavaScript examples and with templates, the Turtle an app fills in for what a person enters and judges. These checks
 * run the examples as one program and hold the guide's lists to the vocabulary, so what the guide says is true of this
 * build.
 * @rule conformance/alex-rivera/alex-rivera.feature P8
 * @rule conformance/alex-rivera/alex-rivera.feature P11
 * @rule conformance/alex-rivera/alex-rivera.feature P13
 * @rule conformance/alex-rivera/alex-rivera.feature P16
 * @rule conformance/alex-rivera/alex-rivera.feature P24
 * @rule conformance/alex-rivera/alex-rivera.feature P25
 */
describe("Building an app from the guide · guide/AGENTS.md", () => {
  let vocabulary: LocalVocabulary;
  let guide: { sections: Map<string, string[]>; blocks: Block[] };
  let ran: { code: number; stderr: string };
  let folder: string | undefined;
  let opened: Pod | undefined;
  let notTheirs: string;
  let bronchitis: string;
  /** Larkspur's old and new asthma records, which the person says are not the same. */
  let notTheSame: readonly [string, string];
  /** The run of the guide's examples, made once by whichever group needs what they left. */
  let running: Promise<void> | undefined;

  /** The pod the examples left, opened only when they all ran: a missing folder would open as a new, empty pod. */
  function examplesPod(): Pod {
    assert.ok(
      opened,
      "the guide's examples did not all run, so no pod is read",
    );
    return opened;
  }

  /** What the examples showed the person, as `{ example, ...}` lines of JSON on standard error. */
  function shownBy<T extends object>(
    example: string,
    key: string,
  ): ({ example: string } & T)[] {
    return ran.stderr
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { example: string } & T)
      .filter((one) => one.example === example && key in one);
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
    return recordFromServerName(server, type, id);
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
import { answerSignIn as __answerSignIn } from "@the-cascade-protocol/sandbox/testing";
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
function openBrowser(authorize) {
  return __answerSignIn(demoHospitals, authorize, ${JSON.stringify(A_NORTH)});
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

  /** Runs every example once, as one program in a child process, and opens the pod it left. */
  function runExamples(): Promise<void> {
    running ??= (async () => {
      const module = join(ROOT, "build", "guide", "examples.mjs");
      await mkdir(dirname(module), { recursive: true });
      await writeFile(module, examples(guide.blocks));
      folder = await mkdtemp(join(tmpdir(), "cascade-guide-"));
      await writeFile(
        join(folder, "cascade-runtime.json"),
        JSON.stringify({ tables: { checkOnOpen: false } }),
      );
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
    })();
    return running;
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
  });

  after(async () => {
    await opened?.close();
    if (folder === undefined) return;
    if (opened !== undefined) await settled(join(folder, "pods"));
    await rm(folder, { recursive: true, force: true });
  });

  describe("given the guide's `js` examples, run in order as one program", () => {
    before(runExamples);

    it("runs every example to the end", () => {
      assert.equal(
        ran.code,
        0,
        `the guide's examples stopped: ${ran.stderr.split("\n").slice(-30).join("\n")}`,
      );
    });

    it("asks the person once before the hospital example imports, showing one source that holds none of the subject's records yet", async () => {
      const { hospital } = await loadHospital("cascade-north");
      const looked = shownBy<{ asked: unknown }>(
        '"Connect to a hospital", example 1',
        "asked",
      );
      assert.equal(looked.length, 1, "the hospital example asked nothing");
      const sources = looked[0]!.asked as ExportSource[];
      assert.deepEqual(
        sources.map(({ server, holdsSubjectsRecords }) => ({
          server,
          holdsSubjectsRecords,
        })),
        [{ server: hospital.fhirBase, holdsSubjectsRecords: false }],
      );
    });

    it("brings the record of the patient the example signs in as into a pod of its own: as many active allergies as the demo hospital holds", async () => {
      assert.equal(ran.code, 0, "the guide's examples did not all run");
      const { patients } = await loadHospital("cascade-north");
      const active = recordsAt(patients[A_NORTH]!).filter(
        (resource) =>
          resource.resourceType === "AllergyIntolerance" &&
          (
            resource.clinicalStatus as
              { coding?: { code?: string }[] } | undefined
          )?.coding?.some(({ code }) => code === "active"),
      );
      assert.ok(active.length > 0);
      const pod = await openPod(join(folder!, "pods", "hospital"));
      try {
        assert.equal(
          (await pod.ask("pod/My active allergies")).length,
          active.length,
        );
      } finally {
        await pod.close();
      }
    });

    it("shows each allergy as active, with the most severe criticality its records state and one record beneath for each it counts", async () => {
      const reading = shownBy<{ shown: unknown }>('"Ask", example 1', "shown");
      assert.equal(
        reading.length,
        1,
        "the reading example showed no one thing",
      );
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
        if (record && value && field?.endsWith("#allergyCriticality"))
          stated.set(record, (stated.get(record) ?? new Set()).add(value));
      const severity = ["unable-to-assess", "low", "high"];
      const mostSevere = (records: readonly string[]): string | undefined =>
        records
          .flatMap((record) => [...(stated.get(record) ?? [])])
          .sort((a, b) => severity.indexOf(a) - severity.indexOf(b))
          .at(-1);
      for (const {
        allergen,
        status,
        criticality,
        records,
        from,
      } of allergies) {
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
    });

    it("leaves a pod that conforms to the vocabulary's shapes", async () => {
      const pod = examplesPod();
      const at = join(folder!, "pods", "mine");
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
      const shapes = await Shapes.read(
        vocabulary.files,
        () => new OxigraphStore(),
      );
      assert.deepEqual(await shapes.violations(triples), []);
    });
  });

  describe("given the pod the examples leave, read through named questions", () => {
    /** The view entry each record is in. */
    let entryOf: Map<string, string>;
    /** The judgments that count. */
    let counting: Set<string>;
    /** Every judgment, by its name, with its verdict, members, what it retracts, and whether the owner filed it. */
    let judged: Map<
      string,
      {
        verdict?: string;
        members: string[];
        retracts?: string;
        byOwner: boolean;
      }
    >;
    /** The records left out of every view, and why. */
    let hidden: Row[];
    /** The view entry of each record the owner entered, by the title of its view. */
    let enteredIn: Map<string, string>;

    const hiddenFor = (record: string, why: string) =>
      hidden.some((row) => row.record === record && row.why === CASCADE + why);
    const persons = () => [...judged].filter(([, { byOwner }]) => byOwner);
    const ofVerdict = (verdict: string) =>
      persons().filter(([, one]) => one.verdict === CASCADE + verdict);
    const abouts = (profile: string) =>
      [...judged].filter(
        ([name, one]) =>
          one.verdict === `${CASCADE}About` &&
          one.members.includes(profile) &&
          counting.has(name),
      );

    before(async () => {
      await runExamples();
      const pod = examplesPod();
      const ask = (question: string): Promise<Row[]> => pod.ask(question);
      entryOf = new Map(
        (await ask("record/Which entry shows it")).flatMap(
          ({ record, entry }) =>
            record !== undefined && entry !== undefined
              ? [[record, entry]]
              : [],
        ),
      );
      const views = new Map(
        vocabulary.layout.views.map(({ file, title }) => [
          `${pod.address}${file ?? ""}`,
          title ?? "",
        ]),
      );
      const entered = new Set(
        (await ask("entry/Where it came from")).flatMap(
          ({ entry, document }) =>
            entry !== undefined && document === undefined ? [entry] : [],
        ),
      );
      const shown = await ask("entry/What it shows");
      enteredIn = new Map(
        [...entered].map((entry) => [
          views.get(shown.find((row) => row.entry === entry)?.view ?? "") ?? "",
          entry,
        ]),
      );
      counting = new Set(
        (await ask("judgment/Whether it counts")).flatMap(
          ({ judgment, counts }) =>
            counts === "true" && judgment !== undefined ? [judgment] : [],
        ),
      );
      judged = new Map();
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
      hidden = await ask("record/Why it is in no view");
    });

    it("shows an owner-entered record from each template in its view: an allergy, a condition, an immunization and a procedure", async () => {
      assert.deepEqual(sorted(enteredIn.keys()), [
        "Allergies",
        "Conditions",
        "Immunizations",
        "Procedures",
      ]);
      for (const [title, question] of [
        ["Allergies", "pod/My active allergies"],
        ["Conditions", "pod/My active conditions"],
        ["Conditions", "pod/My condition history"],
        ["Immunizations", "pod/My immunizations"],
        ["Procedures", "pod/My procedures"],
      ] as const) {
        const entries = new Set(
          (await examplesPod().ask(question)).flatMap(
            ({ entry }) => entry ?? [],
          ),
        );
        assert.ok(
          entries.has(enteredIn.get(title) ?? ""),
          `the entered ${title} is no row of ${question}`,
        );
      }
    });

    it("shows the members of each counting Same the person filed in one view entry", () => {
      assert.ok(ofVerdict("Same").length > 0, "no Same by the person");
      assert.ok(
        ofVerdict("Same").some(([name]) => counting.has(name)),
        "no Same by the person counts",
      );
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
    });

    it("shows the members of each Different in view entries of their own", () => {
      assert.ok(
        ofVerdict("Different").length > 0,
        "no Different by the person",
      );
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
    });

    it("shows the new asthma record alone in its view entry, as active Asthma, and the old one still with bronchitis", async () => {
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
        (await examplesPod().ask("pod/My active conditions")).some(
          ({ entry, condition }) => entry === asthma && condition === "Asthma",
        ),
        "the new asthma record's entry is not active Asthma",
      );
      assert.equal(
        entryOf.get(oldAsthma),
        entryOf.get(bronchitis),
        "the old asthma record is no longer with bronchitis",
      );
    });

    it("hides each record the person judged Erroneous", () => {
      assert.ok(
        ofVerdict("Erroneous").length > 0,
        "no Erroneous by the person",
      );
      for (const [, { members }] of ofVerdict("Erroneous"))
        for (const member of members)
          assert.ok(
            hiddenFor(member, "JudgedErroneous"),
            `${member} is not hidden as erroneous`,
          );
    });

    it("counts no judgment the person retracted", () => {
      const retracted = persons().flatMap(([, { retracts }]) => retracts ?? []);
      assert.ok(retracted.length > 0, "the person retracted nothing");
      for (const judgment of retracted)
        assert.ok(
          !counting.has(judgment),
          `the retracted ${judgment} still counts`,
        );
    });

    it("leaves the profile the person said was not theirs unclaimed, and its records in no view", async () => {
      assert.deepEqual(
        abouts(notTheirs),
        [],
        "the son's profile has a counting About",
      );
      const his = (
        await examplesPod().ask("profile/Which records name it")
      ).flatMap(({ profile, record }) =>
        profile === notTheirs && record ? [record] : [],
      );
      assert.ok(his.length > 0, "no record names the son's profile");
      for (const record of his)
        assert.ok(
          hiddenFor(record, "PatientProfileNotClaimed"),
          `the son's ${record} is in a view`,
        );
    });

    it("counts the About the person filed for a profile claimed on its own", async () => {
      const claimedLater = abouts(await profileOf("J12"));
      assert.ok(
        claimedLater.some(([, { byOwner }]) => byOwner),
        "the profile J12 claims has no counting About by the owner",
      );
    });
  });

  describe("given the guide's lists", () => {
    it("lists under Questions, Lenses and What a pod holds exactly the vocabulary's named questions, lenses and views", async () => {
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
    });

    it("names, for each question whose columns it gives, only columns the question returns, and all of them but those ending in `Label`", async () => {
      const lines = guide.sections.get("Questions") ?? [];
      const items: string[] = [];
      for (const line of lines)
        if (line.startsWith("- ")) items.push(line);
        else if (line.startsWith("  ") && items.length > 0)
          items[items.length - 1] += ` ${line.trim()}`;
      const asked = await questions(vocabulary.files);
      const wrong: string[] = [];
      let withColumns = 0;
      for (const item of items) {
        const name = /^- `([^`]+)`/.exec(item)?.[1] ?? "";
        const named = new Set(
          (item.match(/`\?\w+`/g) ?? []).map((column) => column.slice(1, -1)),
        );
        if (named.size === 0) continue;
        withColumns += 1;
        const given = projected(asked.get(name)?.text ?? "");
        for (const column of named)
          if (!given.has(column)) wrong.push(`${name} gives no ${column}`);
        for (const column of given)
          if (!named.has(column) && !column.endsWith("Label"))
            wrong.push(`${name}: the guide omits ${column}`);
      }
      assert.ok(withColumns > 0, "the guide names no question's columns");
      assert.deepEqual(wrong, []);
    });

    it("gives, as the line that installs cascade-reference-tables, the build this repository tests with", async () => {
      const { devDependencies } = JSON.parse(
        await readFile(join(ROOT, "package.json"), "utf8"),
      ) as { devDependencies: Record<string, string> };
      const pinned = devDependencies["cascade-reference-tables"];
      assert.ok(pinned);
      assert.ok(
        (await readFile(GUIDE, "utf8")).includes(
          `npm install --save-exact ${pinned}`,
        ),
        `the guide does not install ${pinned}`,
      );
    });
  });
});
