import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadHospital, loadStories } from "@the-cascade-protocol/sandbox/node";
import {
  openPod,
  pullFiles,
  Refusal,
  sixWords,
  timelineIn,
  Unopened,
} from "cascade-runtime";
import { pulled } from "./hospitals.js";
import { settled } from "./settled.js";

type Input = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Output = Record<string, any>;
type Operation = (input: Input) => Promise<Output>;
type Api = Record<
  | "pods"
  | "held"
  | "pod"
  | "answers"
  | "said"
  | "trend"
  | "classes"
  | "panel"
  | "table"
  | "ask"
  | "tool",
  Operation
> & { close(): Promise<void> };
type Host = Record<string, unknown> & { tables: unknown };

const { podApi, maps, trendOf, notOpenedHere } = (await import(
  new URL("../../starter/pod-api.mjs", import.meta.url).href
)) as {
  podApi: (host: Host) => Api;
  maps: (output: Output) => Output;
  trendOf: (finding: unknown) => Input;
  notOpenedHere: (name: string) => string;
};
const { nodeHost } = (await import(
  new URL("../../starter/node-host.mjs", import.meta.url).href
)) as {
  nodeHost: (options: { folder: string; opensEncrypted?: boolean }) => Host;
};
const { entryId, testsIn } = (await import(
  new URL("../../starter/summary.mjs", import.meta.url).href
)) as {
  entryId: (entry: string) => string;
  testsIn: (labs: unknown[]) => { code: string; notation?: string }[];
};

const STATIN = "story-statin";
const EMPTY = "empty";
const SEALED = "sealed";
const LDL = "18262-6";
const ATORVASTATIN = "617310";
const LABS = "pod/My lab results";

let folder: string;
/** The IRIs of the LDL test and of atorvastatin, found in the statin pod by their notation. */
const iris = { ldl: "", atorvastatin: "" };
const named = (label: string) => ({ name: { label, altLabels: [] } });

/** A `Tables` holding one LOINC series, naming the LDL test and atorvastatin and nothing else. */
const FAKE = {
  held: async () => [
    {
      iri: "urn:uuid:loinc-terms",
      label: "LOINC terms",
      source: "urn:uuid:loinc",
      versions: [],
    },
  ],
  about: async (codes: string[]) =>
    new Map(
      codes.flatMap((code) =>
        code === iris.ldl
          ? [[code, named("LDL cholesterol")]]
          : code === iris.atorvastatin
            ? [[code, named("atorvastatin")]]
            : [],
      ),
    ),
  codeNamed: async (_: unknown, written: string) =>
    written === LDL ? iris.ldl : undefined,
  facts: async () => ({ notation: LDL, about: named("LDL cholesterol") }),
  search: async () => ({ found: [], total: 0, size: 50 }),
  uses: async () => [],
  inPanels: async () => [],
  classedElsewhere: async () => new Map(),
  labels: async () => new Map(),
  current: async () => [],
  check: async () => [{ feed: "f", kept: ["v"], refused: [] }],
};

function counted<T>(give: () => Promise<T>) {
  const wrapped = Object.assign(
    () => {
      wrapped.calls += 1;
      return give();
    },
    { calls: 0 },
  );
  return wrapped;
}

/** Whether `value` is plain JSON: no Map, Set, Date, function, class instance or non-finite number; undefined allowed. */
function plainJson(value: unknown, at = "output"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number")
    return assert.ok(Number.isFinite(value), `${at} is ${value}`);
  if (typeof value === "string" || typeof value === "boolean") return;
  assert.equal(typeof value, "object", `${at} is a ${typeof value}`);
  if (Array.isArray(value))
    return value.forEach((each, n) => plainJson(each, `${at}[${n}]`));
  assert.equal(
    Object.getPrototypeOf(value),
    Object.prototype,
    `${at} is a ${value.constructor?.name}`,
  );
  for (const [key, each] of Object.entries(value))
    plainJson(each, `${at}.${key}`);
}

const host = () => ({
  ...nodeHost({ folder }),
  tables: counted(async () => FAKE),
});
const made: Api[] = [];
function api(given: Host = host()) {
  const built = podApi(given);
  made.push(built);
  const checked = {} as Api;
  for (const [name, operation] of Object.entries(built))
    (checked as Record<string, unknown>)[name] =
      name === "close"
        ? operation
        : async (input: Input) => {
            const output = await (operation as Operation)(input);
            plainJson(output, name);
            return output;
          };
  return checked;
}

before(async () => {
  folder = await mkdtemp(join(tmpdir(), "pod-api-"));
  const north = await loadHospital("cascade-north");
  const story = (await loadStories()).find(
    ({ patient }) => patient === STATIN,
  )!;
  const { pull } = await pulled(north, story.patient);
  const statin = await openPod(join(folder, STATIN));
  const imported = await statin.import(pullFiles(pull, "north"), {
    aboutSubject: true,
  });
  assert.equal(imported.refused, undefined);
  const labs = await statin.ask(LABS);
  iris.ldl = testsIn(labs).find(({ notation }) => notation === LDL)!.code;
  iris.atorvastatin = timelineIn(
    await statin.ask("pod/My medication history"),
  ).find(({ notation }) => notation === ATORVASTATIN)!.code!;
  const empty = await openPod(join(folder, EMPTY));
  const sealed = await openPod(join(folder, SEALED), { secret: sixWords() });
  await Promise.all([statin, empty, sealed].map((pod) => pod.close()));
  for (const [via, fresh] of HOSTS) apis.set(via, fresh());
});

after(async () => {
  await Promise.all(made.map((each) => each.close()));
  await settled(folder);
  await rm(folder, { recursive: true, force: true });
});

const HOSTS: [string, () => Api][] = [["in-process", () => api()]];
/** One instance per way in, shared by the tests, made once the pods are. */
const apis = new Map<string, Api>();

for (const [via] of HOSTS) {
  const shared = new Proxy({} as Api, {
    get: (_, operation: keyof Api) => apis.get(via)![operation],
  });
  const labs = async (): Promise<Output[]> =>
    (await shared.ask({ pod: STATIN, question: LABS })).rows;

  test(`${via}: pods lists every pod by its name, and a pod's answers are read without the tables`, async () => {
    const counting = host();
    const first = api(counting);
    assert.deepEqual(
      (await first.pods({})).pods,
      [EMPTY, SEALED, STATIN].map((name) => ({ name, title: name })),
    );
    const { answers, changes } = await first.answers({ pod: STATIN });
    assert.ok(answers[LABS].length > 0);
    assert.ok(
      changes.some(
        ({ key }: { key: string }) => key === `start:${ATORVASTATIN}:${LDL}`,
      ),
    );
    assert.equal((counting.tables as { calls: number }).calls, 0);
  });

  test(`${via}: held gives the series the tables hold`, async () => {
    assert.deepEqual(
      (await shared.held({})).held.map(({ source }: Output) => source),
      ["urn:uuid:loinc"],
    );
  });

  test(`${via}: said names the codes of the pod's answers, and of one entry its panels`, async () => {
    assert.equal(
      maps(await shared.said({ pod: STATIN })).about.get(iris.ldl).name.label,
      "LDL cholesterol",
    );
    const row = (await labs()).find((each) => each.code === iris.ldl)!;
    const out = await shared.said({ pod: STATIN, entry: entryId(row.entry) });
    assert.equal(out.entry.entry, row.entry);
    assert.ok(Array.isArray(out.panels));
  });

  test(`${via}: trend with nothing asked is the strongest change's, and every finding's trend opens`, async () => {
    const out = await shared.trend({ pod: STATIN });
    assert.equal(out.series.test.notation, LDL);
    assert.equal(out.medication, ATORVASTATIN);
    const { value } = await shared.tool({ pod: STATIN, tool: "find_changes" });
    assert.ok(value.length > 0);
    for (const finding of value)
      await shared.trend({ pod: STATIN, ...trendOf(finding) });
  });

  test(`${via}: classes gives the pod's medications and what is classed elsewhere`, async () => {
    const out = await shared.classes({ pod: STATIN });
    assert.ok(
      out.medications.some(({ code }: Output) => code === iris.atorvastatin),
    );
    assert.ok(maps(out).elsewhere instanceof Map);
  });

  test(`${via}: panel gives the panel's rows and the pod's lab results`, async () => {
    const out = await shared.panel({ pod: STATIN, panel: "24331-1" });
    assert.deepEqual(out.rows, []);
    assert.ok(out.labs.some(({ code }: Output) => code === iris.ldl));
  });

  test(`${via}: table gives the first source, and a code's facts`, async () => {
    assert.equal((await shared.table({})).source.iri, "urn:uuid:loinc");
    assert.equal(
      (await shared.table({ id: "loinc", code: LDL })).facts.notation,
      LDL,
    );
  });

  test(`${via}: ask gives as many rows as the limit, and how many there are`, async () => {
    const out = await shared.ask({ pod: STATIN, question: LABS, limit: 2 });
    assert.equal(out.total, (await labs()).length);
    assert.equal(out.rows.length, 2);
  });

  test(`${via}: find_changes gives the finding, and worth_a_look the page's lines`, async () => {
    const { value } = await shared.tool({ pod: STATIN, tool: "find_changes" });
    assert.ok(
      value.some(({ key }: Output) => key === `start:${ATORVASTATIN}:${LDL}`),
    );
    const answered: Record<string, unknown[]> = {
      "entry/What needs review": [
        {
          entry: "urn:uuid:0e1f",
          entryLabel: "Allergy entry · Latex",
          needs: "judged different, still joined",
        },
      ],
    };
    const reviewed = api({
      ...host(),
      pods: {
        names: async () => ["reviewed"],
        title: async () => undefined,
        open: async () => ({
          ask: async (question: string) => answered[question] ?? [],
          close: async () => {},
        }),
      },
    });
    const lines = await reviewed.tool({
      pod: "reviewed",
      tool: "worth_a_look",
    });
    assert.equal(lines.value.length, 1);
    assert.match(lines.value[0].sentence, /Latex/);
    assert.equal(lines.value[0].entry, entryId("urn:uuid:0e1f"));
    assert.ok(lines.value[0].tag);
    assert.deepEqual(
      (await shared.tool({ pod: STATIN, tool: "worth_a_look" })).value,
      [],
    );
  });

  test(`${via}: classes and panel let a rejecting host.tables() reject, and held says it failed`, async () => {
    const broken = api({
      ...host(),
      tables: async () => {
        throw new Error("tables are broken");
      },
    });
    await assert.rejects(broken.classes({ pod: STATIN }), /tables are broken/);
    await assert.rejects(
      broken.panel({ pod: STATIN, panel: LDL }),
      /tables are broken/,
    );
    assert.deepEqual(await broken.held({}), { held: [], failed: true });
  });

  test(`${via}: an encrypted pod is locked until its words are given, and refused where no words are asked`, async () => {
    assert.equal((await shared.pod({ pod: SEALED })).locked, "secret needed");
    await assert.rejects(
      shared.answers({ pod: SEALED }),
      (error) => error instanceof Unopened,
    );
    const elsewhere = api({ ...host(), opensEncrypted: false });
    assert.equal(
      (await elsewhere.pod({ pod: SEALED })).locked,
      "secret needed",
    );
    await assert.rejects(
      elsewhere.answers({ pod: SEALED }),
      (error) =>
        error instanceof Refusal &&
        !(error instanceof Unopened) &&
        error.message === notOpenedHere(SEALED),
    );
  });

  test(`${via}: input the rules refuse is a Refusal saying why`, async () => {
    const refused: [keyof Api, Input, RegExp][] = [
      ["answers", { pod: "nobody" }, /no pod nobody; the pods are/],
      ["said", { pod: STATIN, entry: "0" }, /holds no entry 0/],
      ["trend", { pod: STATIN, test: "0000-0" }, /the tests it holds are/],
      ["trend", { pod: STATIN, test: LDL, medication: "0" }, /no medication 0/],
      ["trend", { pod: EMPTY }, /holds no test results/],
      ["panel", { pod: STATIN }, /a panel is a LOINC code/],
      ["panel", { pod: STATIN, panel: "" }, /a panel is a LOINC code/],
      ["table", { id: "nothing" }, /no reference table nothing/],
      ["table", { id: "loinc", code: "0000-0" }, /holds no code 0000-0/],
      ["ask", { pod: STATIN, question: "pod/No such question" }, /no question/],
      ["ask", { pod: STATIN, question: LABS, limit: 0 }, /limit/],
      ["tool", { pod: STATIN, tool: "nothing" }, /no tool nothing/],
      [
        "tool",
        { pod: STATIN, tool: "find_changes", input: { test: "0000-0" } },
        /no test/,
      ],
    ];
    for (const [operation, input, reason] of refused)
      await assert.rejects(
        shared[operation](input),
        (error) =>
          error instanceof Refusal &&
          !(error instanceof Unopened) &&
          reason.test(error.message),
        `${operation} ${JSON.stringify(input)}`,
      );
  });
}
