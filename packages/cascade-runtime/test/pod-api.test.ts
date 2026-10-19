import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { loadHospital, loadStories } from "@the-cascade-protocol/sandbox/node";
import {
  openPod,
  pullFiles,
  Refusal,
  sixWords,
  timelineIn,
  Unopened,
} from "cascade-runtime";
import { answering, type Loaded, pulled, routed, rowOf } from "./hospitals.js";
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
  | "tool"
  | "makePod"
  | "waitingWords"
  | "confirmWords"
  | "unlock"
  | "deleteAll"
  | "resetAll"
  | "checkTables"
  | "setWorldDate"
  | "hospitals"
  | "connect"
  | "connection"
  | "bring",
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
const { apiRoute, podApiOver } = (await import(
  new URL("../../starter/pod-api-http.mjs", import.meta.url).href
)) as {
  apiRoute: (
    api: Api,
    request: unknown,
    response: unknown,
    options: { origins: Set<string> },
  ) => Promise<void>;
  podApiOver: (origin: string) => Api;
};
const { nodeHost } = (await import(
  new URL("../../starter/node-host.mjs", import.meta.url).href
)) as {
  nodeHost: (options: { folder: string; opensEncrypted?: boolean }) => Host & {
    pods: {
      remove(names: string[], options: { all: boolean }): Promise<void>;
    };
  };
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
/** The words that open the encrypted pod. */
const SEALED_WORDS = sixWords();
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

let north: Loaded;
/** The world's date the test hosts' hospitals answer as of. */
const world = {
  asOf: undefined as string | undefined,
  get() {
    return this.asOf;
  },
  set(asOf: string | undefined) {
    this.asOf = asOf;
  },
};

/**
 * Cascade North, in the process, as a host's hospitals: its sign-in page answered as the statin pod's patient, who
 * cancels it when the pod is the empty one. `seen` gets each authorize URL the sign-in is given.
 */
function northHospitals(seen: URL[] = []) {
  const fetch = routed([{ ...north, autoApprove: undefined }], {
    requests: [],
    secrets: new Set(),
  });
  return {
    directory: async () => [rowOf(north)],
    registration: {
      clientId: "cascade-app",
      redirectUri: "https://app.test.invalid/callback",
    },
    fetch,
    ready: async () => undefined,
    signIn:
      (_: unknown, { pod }: { pod: string }, report: (href: string) => void) =>
      async (authorize: URL, signal?: AbortSignal) => {
        seen.push(new URL(authorize));
        report(authorize.href);
        return answering(STATIN, pod === EMPTY ? "cancel" : "allow")(fetch)(
          authorize,
          signal,
        );
      },
    pullName: () => "north",
  };
}

const host = (at = folder) => ({
  ...nodeHost({ folder: at }),
  tables: counted(async () => FAKE),
  checkTables: async () => FAKE.check(),
  hospitals: northHospitals(),
  world,
});
const made: Api[] = [];
const servers: Server[] = [];

/** What each call that reached the server's instance came back with, in order, for `both()` to compare. */
type Call = PromiseSettledResult<Output>;

/** Serves `built` at `POST /api/...` on an ephemeral port, and gives the address and what `built` answered each call. */
async function serve(built: Api): Promise<[string, Call[]]> {
  const origins = new Set<string>();
  const calls: Call[] = [];
  const recording = { ...built } as Api;
  for (const name of Object.keys(built) as (keyof Api)[]) {
    if (name === "close") continue;
    recording[name] = async (input: Input) => {
      try {
        const value = await built[name](input);
        calls.push({ status: "fulfilled", value });
        return value;
      } catch (reason) {
        calls.push({ status: "rejected", reason });
        throw reason;
      }
    };
  }
  const server = createServer((request, response) => {
    void apiRoute(recording, request, response, { origins });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;
  origins.add(origin);
  return [origin, calls];
}

/**
 * `built` in-process, and over HTTP. A call over HTTP runs once, on `built`; what comes back must be what `built`
 * answered that call, after a JSON round trip, and what is thrown the same kind with the same message. What `built`
 * threw other than a `Refusal` crosses as a 500 naming the operation.
 */
async function both(built: Api): Promise<[string, Api][]> {
  const [origin, calls] = await serve(built);
  const remote = podApiOver(origin);
  const over = {} as Api;
  for (const name of Object.keys(remote) as (keyof Api)[]) {
    if (name === "close") continue;
    over[name] = async (input: Input) => {
      const [crossed] = await Promise.allSettled([remote[name](input)]);
      const direct = calls.pop()!;
      assert.equal(calls.length, 0, `${name} ran once`);
      if (crossed.status === "fulfilled") {
        assert.equal(direct.status, "fulfilled", `${name} over HTTP`);
        assert.deepStrictEqual(
          crossed.value,
          JSON.parse(JSON.stringify(direct.value)),
          `${name} over HTTP`,
        );
        return crossed.value;
      }
      assert.equal(direct.status, "rejected", `${name} over HTTP`);
      const [was, is] = [direct.reason, crossed.reason];
      if (was instanceof Refusal) {
        assert.equal(is.constructor, was.constructor);
        assert.equal(is.message, was.message);
        if (was instanceof Unopened) assert.equal(is.outcome, was.outcome);
      } else assert.equal(is.message, `${name}: the server answered 500`);
      throw is;
    };
  }
  over.close = async () => undefined;
  return [
    ["in-process", built],
    ["http", over],
  ];
}
function api(given: Host = host()) {
  const built = podApi(given);
  made.push(built);
  const checked = {} as Api;
  for (const [name, operation] of Object.entries(built))
    (checked as Record<string, unknown>)[name] =
      name === "close" || name === "podFor"
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
  north = await loadHospital("cascade-north");
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
  const sealed = await openPod(join(folder, SEALED), { secret: SEALED_WORDS });
  await Promise.all([statin, empty, sealed].map((pod) => pod.close()));
  for (const [via, each] of await both(api())) apis.set(via, each);
});

/** The folders of the tests that write, each its own, so the shared pods stay as they were made. */
const folders: string[] = [];

/** A folder of its own, the host over it with `extra` given the folder, and its instance through `via`. */
async function fresh(via: string, extra: (at: string) => Input = () => ({})) {
  const at = await mkdtemp(join(tmpdir(), "pod-api-writes-"));
  folders.push(at);
  const given = { ...host(at), ...extra(at) };
  const built = api(given);
  return { built, host: given, api: new Map(await both(built)).get(via)! };
}

after(async () => {
  await Promise.all(made.map((each) => each.close()));
  await Promise.all(
    servers.map((each) => new Promise((done) => each.close(done))),
  );
  for (const each of [folder, ...folders]) {
    await settled(each);
    await rm(each, { recursive: true, force: true });
  }
});

const HOSTS = ["in-process", "http"];
/** One instance per way in, shared by the tests, made once the pods are. */
const apis = new Map<string, Api>();

for (const via of HOSTS) {
  const shared = new Proxy({} as Api, {
    get: (_, operation: keyof Api) => apis.get(via)![operation],
  });
  const labs = async (): Promise<Output[]> =>
    (await shared.ask({ pod: STATIN, question: LABS })).rows;

  test(`${via}: pods lists every pod by its name, and a pod's answers are read without the tables`, async () => {
    const counting = host();
    const first = new Map(await both(api(counting))).get(via)!;
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
    const reviewed = new Map(
      await both(
        api({
          ...host(),
          pods: {
            names: async () => ["reviewed"],
            title: async () => undefined,
            open: async () => ({
              ask: async (question: string) => answered[question] ?? [],
              close: async () => {},
            }),
          },
        }),
      ),
    ).get(via)!;
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

  test(`${via}: an encrypted pod is locked until its words are given, and refused where no words are asked`, async () => {
    assert.equal((await shared.pod({ pod: SEALED })).locked, "secret needed");
    await assert.rejects(
      shared.answers({ pod: SEALED }),
      (error) => error instanceof Unopened && error.outcome === "secret needed",
    );
    await assert.rejects(
      shared.unlock({ pod: SEALED, secret: "  " }),
      (error) =>
        error instanceof Unopened && error.outcome === "incorrect secret",
    );
    const elsewhere = new Map(
      await both(api({ ...host(), opensEncrypted: false })),
    ).get(via)!;
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
    await shared.makePod({ person: "Waiting", encrypt: true });
    const { words } = await shared.waitingWords({ pod: "waiting" });
    const [, word2, , , word5] = words.split(" ");
    const typed = {
      pod: "waiting",
      word2,
      word5,
      password: words,
      username: "waiting",
    };
    const { connection: cancelled } = await shared.connect({
      pod: EMPTY,
      fhirBase: rowOf(north).fhirBase,
    });
    const failed = await shared.connection({
      pod: EMPTY,
      connection: cancelled,
      wait: true,
    });
    assert.equal(failed.step, "failed");
    assert.equal(failed.failure, "cancelled");
    const refused: [keyof Api, Input, RegExp][] = [
      [
        "connect",
        { pod: STATIN, fhirBase: "https://nowhere.invalid/fhir" },
        /not in the directory/,
      ],
      ["connection", { pod: STATIN, connection: 999 }, /no connection 999/],
      [
        "connection",
        { pod: STATIN, connection: 1, wait: "soon" },
        /wait must be true or "change"/,
      ],
      [
        "bring",
        { pod: EMPTY, connection: cancelled },
        /nothing pulled to bring in/,
      ],
      ["makePod", { person: "!!!" }, /at least one letter/],
      ["makePod", { person: "Con" }, /Windows keeps for itself/],
      ["makePod", { person: "Ada", encrypt: "on" }, /encrypt must be true/],
      ["waitingWords", { pod: "nobody" }, /not waiting any more/],
      ["confirmWords", { ...typed, word2: "x" }, /aren't words 2 and 5/],
      ["confirmWords", { ...typed, password: "x" }, /Password field/],
      ["confirmWords", { ...typed, username: "x" }, /Pod field/],
      ["setWorldDate", { date: "soon" }, /"soon" is not a date/],
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
      ["trend", { pod: STATIN, medication: 5 }, /medication must be a string/],
      ["pod", { pod: 5 }, /pod must be a string/],
      ["said", { pod: STATIN, entry: 5 }, /entry must be a string/],
      ["table", { page: "2" }, /page must be a whole number from 1/],
      ["table", { page: 1.5 }, /page must be a whole number from 1/],
      ["ask", { pod: STATIN, question: LABS, limit: -1 }, /limit must be/],
      ["ask", { pod: STATIN, question: LABS, limit: NaN }, /limit must be/],
      ["ask", { pod: STATIN, question: 5 }, /question must be a string/],
      [
        "tool",
        { pod: STATIN, tool: "find_changes", input: "x" },
        /input must be an object/,
      ],
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

  test(`${via}: makePod makes a pod named after the person, goes to one there is, and loads a sample`, async () => {
    const { api: writes } = await fresh(via, (at) => ({
      samples: ["sample"],
      copySample: (name: string) => openPod(join(at, name)),
    }));
    const rowan = { pod: "rowan-ellery-marsh" };
    const person = { person: "Rowan Ellery Marsh" };
    assert.deepEqual(await writes.makePod(person), { ...rowan, made: true });
    assert.deepEqual(await writes.makePod(person), { ...rowan, made: false });
    assert.deepEqual(await writes.makePod({ person: "Sample" }), {
      pod: "sample",
      loaded: true,
    });
    assert.deepEqual(await writes.makePod({ person: "Sample" }), {
      pod: "sample",
      made: false,
    });
    assert.deepEqual(
      (await writes.pods({})).pods.map(({ name }: Output) => name),
      ["rowan-ellery-marsh", "sample"],
    );
  });

  test(`${via}: an encrypted pod is made once its words 2 and 5 are given, and opens with its words after`, async () => {
    const { built, host: given, api: writes } = await fresh(via);
    const confirm = async (pod: string) => {
      const { words } = await writes.waitingWords({ pod });
      const [, word2, , , word5] = words.split(" ");
      const typed = { pod, word2, word5, password: words, username: pod };
      return { words, made: writes.confirmWords(typed) };
    };
    assert.deepEqual(await writes.makePod({ person: "Ines", encrypt: true }), {
      pod: "ines",
      waiting: true,
    });
    assert.equal((await writes.waitingWords({ pod: "ines" })).person, "Ines");
    const { words, made } = await confirm("ines");
    assert.deepEqual(await made, { pod: "ines", made: true });
    assert.equal((await writes.pod({ pod: "ines" })).encrypted, true);
    await assert.rejects(writes.waitingWords({ pod: "ines" }), /not waiting/);

    await writes.makePod({ person: "Taken", encrypt: true });
    await writes.makePod({ person: "Taken" });
    await assert.rejects((await confirm("taken")).made, /exists already/);
    await assert.rejects(writes.waitingWords({ pod: "taken" }), /not waiting/);

    await built.close();
    const later = new Map(await both(api(given))).get(via)!;
    await assert.rejects(
      later.answers({ pod: "ines" }),
      (error) => error instanceof Unopened && error.outcome === "secret needed",
    );
    const opened = { pod: "ines", opened: true };
    assert.deepEqual(
      await later.unlock({ pod: "ines", secret: words }),
      opened,
    );
    assert.ok((await later.answers({ pod: "ines" })).answers);
    assert.deepEqual(await later.unlock({ pod: "ines", secret: "" }), opened);
  });

  test(`${via}: setWorldDate sets the world's date to the end of a day, and back to every version`, async () => {
    let asOf: string | undefined;
    const { api: writes } = await fresh(via, () => ({
      world: {
        get: () => asOf,
        set: (to: string | undefined) => {
          asOf = to;
        },
      },
    }));
    const end = "2024-02-01T23:59:59Z";
    assert.deepEqual(await writes.setWorldDate({ date: "2024-02-01" }), {
      asOf: end,
    });
    assert.equal(asOf, end);
    assert.deepEqual(await writes.setWorldDate({ date: "" }), {});
    assert.equal(asOf, undefined);
  });

  test(`${via}: hospitals finds a hospital of the directory by its name`, async () => {
    const { rows } = await shared.hospitals({ q: "north" });
    assert.deepEqual(
      rows.map(({ name }: Output) => name),
      ["Cascade North"],
    );
  });

  test(`${via}: connect signs in with every scope and pulls, and bring brings the record into the pod`, async () => {
    const authorized: URL[] = [];
    const { api: writes } = await fresh(via, () => ({
      hospitals: northHospitals(authorized),
    }));
    await writes.makePod({ person: "Ada" });
    const { connection: n, authorize } = await writes.connect({
      pod: "ada",
      fhirBase: rowOf(north).fhirBase,
    });
    assert.equal(authorize, authorized[0]!.href);
    assert.deepEqual(authorized[0]!.searchParams.get("scope")!.split(" "), [
      "launch/patient",
      "patient/*.read",
      "patient/*.rs",
    ]);
    const at = { pod: "ada", connection: n };
    const busy = (step: string) =>
      ["signing in", "pulling", "bringing in"].includes(step);
    const state = ({ step, requests, bringing }: Output) =>
      JSON.stringify([step, requests, bringing]);
    let shown = await writes.connection(at);
    while (busy(shown.step)) {
      const next = await writes.connection({ ...at, wait: "change" });
      assert.notEqual(state(next), state(shown));
      shown = next;
    }
    assert.equal(shown.step, "pulled");
    assert.ok(shown.requests > 0);
    assert.ok(
      shown.sources.some(({ server }: Output) =>
        rowOf(north).fhirBase.startsWith(server),
      ),
      JSON.stringify(shown.sources),
    );
    assert.equal(shown.patient, "Statin Story"); // replaced below once known
    const keys = (value: unknown): string[] =>
      value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([key, each]) => [key, ...keys(each)])
        : [];
    assert.ok(!keys(shown).includes("bundle"), "the connection has its bundle");

    assert.deepEqual(await writes.bring(at), { step: "bringing in" });
    const done = await writes.connection({ ...at, wait: true });
    assert.equal(done.broughtIn, true);
    assert.ok(
      (await writes.answers({ pod: "ada" })).changes.some(
        ({ key }: Output) => key === `start:${ATORVASTATIN}:${LDL}`,
      ),
    );
  });

  test(`${via}: a demo hospital's connection carries the world's date it was started under`, async () => {
    const { api: writes } = await fresh(via);
    await writes.makePod({ person: "Ada" });
    await writes.setWorldDate({ date: "2024-02-01" });
    try {
      const { connection } = await writes.connect({
        pod: "ada",
        fhirBase: rowOf(north).fhirBase,
      });
      const done = await writes.connection({
        pod: "ada",
        connection,
        wait: true,
      });
      assert.equal(done.asOf, "2024-02-01T23:59:59Z");
    } finally {
      await writes.setWorldDate({ date: "" });
    }
  });

  test(`${via}: checkTables, when a version was kept, opens the plaintext pods anew and keeps an unlocked one open`, async () => {
    const built = api(host());
    const { podFor } = built as unknown as {
      podFor(name: string): Promise<unknown>;
    };
    const each = new Map(await both(built)).get(via)!;
    await each.unlock({ pod: SEALED, secret: SEALED_WORDS });
    const before = await podFor(STATIN);
    const { checked } = await each.checkTables({});
    assert.deepEqual(checked, await FAKE.check());
    assert.notEqual(await podFor(STATIN), before);
    assert.equal((await each.pod({ pod: SEALED })).locked, undefined);
  });

  test(`${via}: deleteAll removes every pod and forgets the words, and resetAll restores the host's pods`, async () => {
    const { api: writes } = await fresh(via, (at) => ({
      restore: async () => {
        await (await openPod(join(at, "restored"))).close();
        return ["restored"];
      },
    }));
    for (const person of ["One", "Two"]) await writes.makePod({ person });
    await writes.makePod({ person: "Three", encrypt: true });
    const one = { pod: "one", connection: 0 };
    one.connection = (
      await writes.connect({ pod: "one", fhirBase: rowOf(north).fhirBase })
    ).connection;
    await writes.connection({ ...one, wait: true });
    assert.deepEqual(await writes.deleteAll({}), { deleted: ["one", "two"] });
    assert.deepEqual((await writes.pods({})).pods, []);
    await assert.rejects(writes.waitingWords({ pod: "three" }), /not waiting/);
    await writes.makePod({ person: "One" });
    await assert.rejects(writes.bring(one), /no connection/);
    await writes.deleteAll({});
    assert.deepEqual(await writes.resetAll({}), { pods: ["restored"] });
    assert.deepEqual((await writes.pods({})).pods, [
      { name: "restored", title: "restored" },
    ]);
  });
}

test("nodeHost's remove takes the pods and every answer, and keeps the reference tables", async () => {
  const at = await mkdtemp(join(tmpdir(), "pod-api-remove-"));
  folders.push(at);
  for (const name of ["a", "b"]) await (await openPod(join(at, name))).close();
  await mkdir(join(at, ".answers", "no-pod"), { recursive: true });
  await mkdir(join(at, ".tables"), { recursive: true });
  await writeFile(join(at, ".tables", "marker"), "");
  await nodeHost({ folder: at }).pods.remove(["a", "b"], { all: true });
  assert.deepEqual(await readdir(at), [".tables"]);
  assert.ok(existsSync(join(at, ".tables", "marker")), "the tables went");
});

test("classes and panel let a rejecting host.tables() reject, in the process as itself and over HTTP as a 500, and held says it failed", async (t: TestContext) => {
  t.mock.method(console, "error", () => undefined);
  const broken = api({
    ...host(),
    tables: async () => {
      throw new Error("tables are broken");
    },
  });
  for (const [via, each] of await both(broken)) {
    const failure = via === "http" ? /answered 500/ : /tables are broken/;
    await assert.rejects(each.classes({ pod: STATIN }), failure, via);
    await assert.rejects(each.panel({ pod: STATIN, panel: LDL }), failure, via);
    assert.deepEqual(await each.held({}), { held: [], failed: true }, via);
  }
});

test("over HTTP, a request the route cannot take gets its status, and a broken runtime says nothing of itself", async (t: TestContext) => {
  const [origin] = await serve(apis.get("in-process")!);
  const post = (
    base: string,
    path: string,
    headers: Record<string, string>,
    body = "{}",
  ) => fetch(`${base}${path}`, { method: "POST", headers, body });
  const json = (base: string) => ({
    "content-type": "application/json",
    origin: base,
  });
  const statuses: [string, Promise<Response>, number][] = [
    ["an unknown operation", post(origin, "/api/nothing", json(origin)), 404],
    [
      "podFor stays in the process",
      post(origin, "/api/podFor", json(origin)),
      404,
    ],
    [
      "closePods stays in the process",
      post(origin, "/api/closePods", json(origin)),
      404,
    ],
    [
      "close stays in the process",
      post(origin, "/api/close", json(origin)),
      404,
    ],
    [
      "a body that is not JSON",
      post(origin, "/api/pods", {
        ...json(origin),
        "content-type": "text/plain",
      }),
      415,
    ],
    [
      "another site",
      post(origin, "/api/pods", {
        ...json(origin),
        origin: "http://evil.example",
      }),
      403,
    ],
    [
      "a body that is no object",
      post(origin, "/api/pods", json(origin), "[]"),
      400,
    ],
    [
      "a body over 1 MiB",
      post(origin, "/api/pods", json(origin), " ".repeat(1024 * 1024 + 1)),
      400,
    ],
  ];
  for (const [what, response, status] of statuses)
    assert.equal((await response).status, status, what);

  t.mock.method(console, "error", () => undefined);
  const real = host();
  const [broken] = await serve(
    api({
      ...real,
      pods: {
        ...((real as Record<string, unknown>).pods as object),
        names: async () => {
          throw new Error("/secret/path");
        },
      },
    }),
  );
  const response = await post(broken, "/api/pods", json(broken));
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.equal(
    text,
    JSON.stringify({ error: "the server failed; its log says why" }),
  );
  assert.ok(!text.includes("/secret/path"));
});
