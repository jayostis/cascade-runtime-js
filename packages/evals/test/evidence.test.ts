import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Client } from "@modelcontextprotocol/client";
import type { Prepared } from "../src/cases.js";
import { checkAbsence } from "../src/citations.js";
import { answer } from "../src/pod-client.js";
import { passageOf, unescaped } from "../src/evidence.js";
import { evidenceOf } from "../src/record.js";
import { type Job, PASSAGE_CAP, type ToolCallRecord } from "../src/results.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-evid-"));
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const input = { pod: "p", question: "pod/My procedures" };
const other = { pod: "p", question: "pod/My lab results" };
const refused = JSON.stringify({ error: "no" });
const none = JSON.stringify({ total: 1, rows: [{ procedure: "CT" }] });
const ran = [
  { call: 1, tool: "ask", input, ok: false, answer: refused },
  { call: 2, tool: "ask", input, ok: true, answer: none },
  { call: 3, tool: "ask", input: other, ok: true, answer: none },
];
const absence = {
  what: "a colonoscopy",
  coverage: "every procedure the pod holds",
  match: { terms: ["colonoscopy"] },
};

test("an absence's call number must name a call of its own tool and input; no other number is read as 'any call'", () => {
  const check = (query: { call?: number }) =>
    checkAbsence({ ...absence, query: { tool: "ask", input, ...query } }, ran);
  assert.deepEqual(check({}), { backed: true });
  assert.deepEqual(check({ call: 1 }), {
    backed: false,
    reason: "query refused",
  });
  assert.deepEqual(check({ call: 2 }), { backed: true });
  assert.deepEqual(check({ call: 99 }), {
    backed: false,
    reason: "no such call",
  });
  assert.deepEqual(check({ call: 3 }), {
    backed: false,
    reason: "no such call",
  });
});

const record = (call: number, tool = "ask", at = input): ToolCallRecord => ({
  job: "j",
  call,
  at: "2026-10-31T00:00:00Z",
  tool,
  input: at,
  ok: call !== 1,
  rows: call,
  entries: [],
  milliseconds: 5,
});

test("a pod absence's evidence is the call it names when that call is its query's, else null", async () => {
  const resolve = async (call: number | undefined, query = input) => {
    const [found] = await evidenceOf({
      job: { id: "j", arm: "pod" } as Job,
      question: "q",
      answer: {
        items: [
          {
            n: 1,
            facts: [],
            absences: [
              {
                ...absence,
                query: {
                  tool: "ask",
                  input: query,
                  ...(call === undefined ? {} : { call }),
                },
              },
            ],
          },
        ],
      } as never,
      prepared: {} as unknown as Prepared,
      reading: [],
      provenance: () => undefined,
      toolCalls: [record(1), record(2), record(3, "ask", other)],
    });
    return found!.call;
  };
  assert.equal((await resolve(1))?.call, 1);
  assert.equal((await resolve(1))?.ok, false);
  assert.equal((await resolve(2))?.call, 2);
  assert.equal(await resolve(99), null);
  assert.equal(await resolve(3), null);
  assert.equal((await resolve(undefined))?.call, 2);
});

test("a grab-bag absence's evidence says whether it named its sources and which files were read whole", async () => {
  const resolve = async (sources?: string[]) => {
    const [found] = await evidenceOf({
      job: { id: "j", arm: "records" } as Job,
      question: "q",
      answer: {
        items: [{ n: 1, facts: [], absences: [{ ...absence, sources }] }],
      } as never,
      prepared: {
        documents: [
          { file: "a.json", bytes: 10 },
          { file: "b.json", bytes: 20 },
        ],
      } as unknown as Prepared,
      reading: ["a.json", "b.json"],
      read: ["a.json"],
      provenance: () => undefined,
      toolCalls: [],
    });
    return found!;
  };
  const named = await resolve(["b.json"]);
  assert.equal(named.stated, true);
  assert.deepEqual(named.files, [{ file: "b.json", read: false, bytes: 20 }]);
  const defaulted = await resolve();
  assert.equal(defaulted.stated, false);
  assert.deepEqual(defaulted.files, [
    { file: "a.json", read: true, bytes: 10 },
    { file: "b.json", read: false, bytes: 20 },
  ]);
});

test("a passage is capped and marked truncated; a line past a trailing newline is out of range", async () => {
  const at = join(folder, "downloads");
  await mkdir(join(at, "d"), { recursive: true });
  await writeFile(join(at, "d", "long.json"), "x".repeat(PASSAGE_CAP + 5));
  const long = await passageOf(at, { file: "d/long.json", line: 1 });
  assert.equal(long?.text.length, PASSAGE_CAP);
  assert.equal(long?.truncated, true);
  await writeFile(join(at, "d", "two.txt"), "one\ntwo\n");
  const two = await passageOf(at, { file: "d/two.txt", line: 2 });
  assert.equal(two?.text, "two");
  assert.equal(two?.truncated, undefined);
  assert.equal(await passageOf(at, { file: "d/two.txt", line: 3 }), undefined);
});

test("a minified bundle's strings holding } ] \" { \\ , do not move a resource's span", async () => {
  const at = join(folder, "minified");
  await mkdir(join(at, "d"), { recursive: true });
  const tricky = 'a } ] " { \\ , [ b \\" \\\\';
  const resources = [
    { resourceType: "Observation", id: "o-1", note: tricky },
    { resourceType: "Condition", id: "c-1", note: [tricky, { x: tricky }] },
    { resourceType: "Observation", id: "o-2", note: "after" },
  ];
  const text = JSON.stringify({
    resourceType: "Bundle",
    entry: resources.map((resource) => ({ resource })),
  });
  assert.ok(!text.includes("\n"));
  await writeFile(join(at, "d", "bundle.json"), text);
  for (const [index, resource] of resources.entries()) {
    const passage = await passageOf(at, {
      file: "d/bundle.json",
      resource: `${resource.resourceType}/${resource.id}`,
    });
    assert.deepEqual(JSON.parse(passage!.text), resource);
    assert.equal(passage!.pointer, `/entry/${index}/resource`);
    assert.deepEqual([passage!.from, passage!.to], [1, 1]);
  }
});

test("a Turtle literal's escapes are undone", () => {
  assert.equal(
    unescaped('a \\"b\\" \\\\ c\\nd\\te\\rf'),
    'a "b" \\ c\nd\te\rf',
  );
  assert.equal(unescaped("\\q"), "\\q");
  assert.equal(unescaped(undefined), undefined);
});

test("a call that throws is logged under its number, so a restarted server does not reuse it", async () => {
  const log = join(folder, "run");
  await mkdir(log, { recursive: true });
  const client = {
    callTool: async () => {
      throw new Error("the pod went away");
    },
  } as unknown as Client;
  const counter = { made: 0 };
  await assert.rejects(
    answer(client, log, "j", ["ask", "{}"], counter),
    /pod went away/,
  );
  const lines = (await readFile(join(log, "tool-calls.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((it) => JSON.parse(it) as ToolCallRecord);
  assert.equal(lines.length, 1);
  assert.deepEqual(
    [lines[0]!.job, lines[0]!.call, lines[0]!.ok, lines[0]!.error],
    ["j", 1, false, "the pod went away"],
  );
});
