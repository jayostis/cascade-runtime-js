import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { loadHospital, loadStories } from "@cascade-runtime/demo-hospital/node";
import { openPod, type Pod, pullFiles } from "cascade-runtime";
import { pulled } from "./hospitals.js";

const { podServer, QUESTIONS, WARNING } = (await import(
  new URL("../../starter/mcp-server.mjs", import.meta.url).href
)) as {
  podServer: (
    pods: {
      names(): Promise<string[]>;
      open(name: string): Promise<Pod>;
    },
    options?: {
      viewOf(pod: string, trend: object): string;
      worthOf(pod: Pod): Promise<unknown[]>;
    },
  ) => { build(): { connect(transport: unknown): Promise<void> } };
  QUESTIONS: string[];
  WARNING: string;
};
const { openWithoutWords, trendUrl } = (await import(
  new URL("../../starter/pods.mjs", import.meta.url).href
)) as {
  openWithoutWords: (name: string, folder: string) => Promise<Pod>;
  trendUrl: (pod: string, trend: object) => string;
};

const { worthLines } = (await import(
  new URL("../../starter/pod-tools.mjs", import.meta.url).href
)) as {
  worthLines: (
    pod: unknown,
    tables: {
      aboutCodes(answers: unknown): Promise<undefined>;
      variantsOf(answers: unknown, pod: unknown): Promise<undefined>;
    },
  ) => Promise<unknown[]>;
};
const { entryId, worthALook } = (await import(
  new URL("../../starter/summary.mjs", import.meta.url).href
)) as {
  entryId: (entry: string) => string;
  worthALook: (answers: Record<string, unknown[]>) => {
    sentence: string;
    entry: string;
    tag?: string;
  }[];
};

const STATIN = "story-statin";
/** A pod whose answers hold one entry that needs review, so its page has a line of Worth a look; it reads nothing else. */
const REVIEWED = "reviewed";
const REVIEW_ANSWERS: Record<string, unknown[]> = {
  "entry/What needs review": [
    {
      entry: "urn:uuid:0e1f",
      entryLabel: "Allergy entry · Latex",
      needs: "judged different, still joined",
    },
  ],
};
const reviewed = {
  ask: async (question: string) => REVIEW_ANSWERS[question] ?? [],
  close: async () => {},
} as unknown as Pod;
const unsaid = {
  aboutCodes: async () => undefined,
  variantsOf: async () => undefined,
};
const pods = new Map<string, Pod>();
let client: Client;

/** What a tool call gave: its text read as JSON, and whether it was a tool error. */
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  assert.equal(first!.type, "text");
  return { error: result.isError === true, text: first!.text };
}

before(async () => {
  const north = await loadHospital("cascade-north");
  const story = (await loadStories()).find(
    ({ patient }) => patient === STATIN,
  )!;
  const { pull } = await pulled(north, story.patient);
  const statin = await openPod();
  const imported = await statin.import(pullFiles(pull, "north"), {
    aboutSubject: true,
  });
  assert.equal(imported.refused, undefined);
  pods.set(STATIN, statin);
  pods.set("empty", await openPod());
  pods.set(REVIEWED, reviewed);

  const served = podServer(
    {
      names: async () => [...pods.keys()],
      open: async (name) => pods.get(name)!,
    },
    {
      viewOf: trendUrl,
      worthOf: (pod) => worthLines(pod, unsaid),
    },
  );
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await served.build().connect(toServer);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(toClient);
});

after(async () => {
  await client.close();
  await Promise.all([...pods.values()].map((pod) => pod.close()));
});

test("a client lists the pods and the tools, each but the list taking the pod's name, and is warned that a hosted client sends the answers to its provider", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    "ask",
    "find_changes",
    "finding_rows",
    "lab_series",
    "list_pods",
    "timeline",
    "worth_a_look",
  ]);
  for (const { name, inputSchema } of tools)
    assert.equal(
      (inputSchema.required as string[] | undefined)?.includes("pod") ?? false,
      name !== "list_pods",
      name,
    );
  const ask = tools.find(({ name }) => name === "ask")!;
  assert.deepEqual(
    (ask.inputSchema.properties as Record<string, { enum?: string[] }>)
      .question!.enum,
    QUESTIONS,
  );
  assert.ok(client.getInstructions()?.includes(WARNING));
  assert.match(
    client.getInstructions() ?? "",
    /worth_a_look is a good first call/,
  );

  assert.deepEqual(JSON.parse((await call("list_pods", {})).text), [
    STATIN,
    "empty",
    REVIEWED,
  ]);
});

test("find_changes on the statin story patient's pod gives the LDL finding with its numbers; ask gives a question's rows, a capped few of them", async () => {
  const found = await call("find_changes", { pod: STATIN });
  assert.equal(found.error, false);
  const [finding] = JSON.parse(found.text) as {
    key: string;
    view: string;
    kind: string;
    direction: string;
    test: { notation: string };
    before: { count: number; mean: number };
    after: { count: number; mean: number };
  }[];
  assert.equal(finding!.key, "start:617310:18262-6");
  const view = new URL(finding!.view);
  assert.match(view.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(
    view.pathname + view.search,
    "/pods/story-statin/trend?test=18262-6&medication=617310",
  );
  assert.deepEqual(
    [finding!.kind, finding!.test.notation, finding!.direction],
    ["after start", "18262-6", "down"],
  );
  assert.deepEqual([finding!.before.count, finding!.after.count], [3, 3]);
  assert.ok(finding!.after.mean < finding!.before.mean);

  const asked = JSON.parse(
    (
      await call("ask", {
        pod: STATIN,
        question: "pod/My lab results",
        limit: 2,
      })
    ).text,
  ) as { total: number; rows: unknown[] };
  assert.equal(
    asked.total,
    (await pods.get(STATIN)!.ask("pod/My lab results")).length,
  );
  assert.equal(asked.rows.length, 2);
});

test("worth_a_look gives a pod's Worth a look lines as its page does, each with its sentence, its entry's ID and its tag, and none for a pod with no line", async () => {
  const expected = worthALook(REVIEW_ANSWERS).map(
    ({ sentence, entry, tag }) => ({
      sentence,
      entry: entryId(entry),
      tag,
    }),
  );
  assert.equal(expected.length, 1);
  const lines = await call("worth_a_look", { pod: REVIEWED });
  assert.equal(lines.error, false);
  assert.deepEqual(JSON.parse(lines.text), expected);
  assert.deepEqual(
    JSON.parse((await call("worth_a_look", { pod: "empty" })).text),
    [],
  );
});

test("input the rules refuse is a tool error that says why, never a crash: a question outside the list, a pod there is none of, a missing pod, a test the pod lacks", async () => {
  const refused: [string, Record<string, unknown>, RegExp][] = [
    [
      "ask",
      { pod: STATIN, question: "pod/Which files are out of place" },
      /data\/question must be equal to one of the allowed values/,
    ],
    [
      "ask",
      { pod: STATIN, question: "SELECT * WHERE { ?s ?p ?o }" },
      /data\/question must be equal to one of the allowed values/,
    ],
    ["ask", { pod: STATIN, question: QUESTIONS[0], limit: 0 }, /limit/],
    ["find_changes", { pod: "nobody" }, /no pod nobody; the pods are/],
    ["find_changes", {}, /required property 'pod'/],
    ["find_changes", { pod: STATIN, test: "0000-0" }, /no test/],
    ["lab_series", { pod: STATIN, test: "0000-0" }, /no test/],
    ["finding_rows", { pod: STATIN, key: "start:0:0" }, /no finding/],
    ["timeline", { pod: STATIN, extra: true }, /additional properties/],
    ["worth_a_look", { pod: "nobody" }, /no pod nobody; the pods are/],
    ["worth_a_look", { pod: STATIN, extra: true }, /additional properties/],
  ];
  for (const [name, args, reason] of refused) {
    const { error, text } = await call(name, args);
    assert.ok(error, `${name} ${JSON.stringify(args)}`);
    assert.match(text, reason, `${name} ${JSON.stringify(args)}`);
  }
});

test("an error that is not a refusal is logged and reaches the client as a fixed message, never its own, so a path in it does not leave", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const broken = podServer({
    names: async () => ["broken"],
    open: async () => {
      throw new Error("ENOENT: open 'C:/private/path'");
    },
  });
  const [toServer, toClient] = InMemoryTransport.createLinkedPair();
  await broken.build().connect(toServer);
  const other = new Client({ name: "test", version: "0.0.0" });
  await other.connect(toClient);
  const result = await other.callTool({
    name: "find_changes",
    arguments: { pod: "broken" },
  });
  const [first] = result.content as { text: string }[];
  assert.equal(result.isError, true);
  assert.doesNotMatch(first!.text, /private/);
  assert.equal(logged.mock.callCount(), 1);
  await other.close();
});

test("an encrypted pod is listed, and a tool asked about it says in one line that this server does not open it", async () => {
  const folder = await mkdtemp(join(tmpdir(), "t351-mcp-"));
  const words = "abacus abdomen abide abnormal abrasion abrupt";
  try {
    await (await openPod(folder, { secret: words })).close();
    const served = podServer({
      names: async () => ["sealed"],
      open: (name) => openWithoutWords(name, folder),
    });
    const [toServer, toClient] = InMemoryTransport.createLinkedPair();
    await served.build().connect(toServer);
    const sealed = new Client({ name: "test", version: "0.0.0" });
    await sealed.connect(toClient);
    try {
      const listed = await sealed.callTool({
        name: "list_pods",
        arguments: {},
      });
      assert.deepEqual(
        JSON.parse((listed.content as { text: string }[])[0]!.text),
        ["sealed"],
      );
      const asked = await sealed.callTool({
        name: "ask",
        arguments: { pod: "sealed", question: QUESTIONS[0] },
      });
      assert.equal(asked.isError, true);
      const [first] = asked.content as { text: string }[];
      assert.match(first!.text, /^sealed is encrypted: open it in the app/);
      assert.equal(first!.text.includes(words), false);
    } finally {
      await sealed.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
