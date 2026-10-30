import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pod, Row } from "cascade-runtime";
import { podReads, TOOLS } from "cascade-runtime/tools";

const RXNORM = "https://ns.cascadeprotocol.org/codes/rxnorm/";
const LOINC = "http://loinc.org/";

const MEDICATIONS: Row[] = [
  {
    medication: "Drug 111",
    code: `${RXNORM}111`,
    started: "2024-03-04",
    entry: "urn:cascade:entry-medication",
  },
];
const LABS: Row[] = [
  ["2024-01-01", "160"],
  ["2024-02-01", "158"],
  ["2024-03-01", "165"],
  ["2024-04-01", "100"],
  ["2024-05-01", "98"],
  ["2024-06-01", "96"],
].map(([day, value], n) => ({
  performed: `${day}T16:00:00Z`,
  test: "Test A",
  code: `${LOINC}A`,
  value: value!,
  unit: "mg/dL",
  entry: `urn:cascade:entry-lab-${n}`,
}));

/** What each tool is given, and the read it calls. A tool added to `TOOLS` needs a row. */
const RUNS: Record<string, [Record<string, unknown>, string]> = {
  list_pods: [{}, "pods"],
  find_changes: [{ pod: "p" }, "tool"],
  finding_rows: [{ pod: "p", key: "k" }, "tool"],
  lab_series: [{ pod: "p", test: "t" }, "tool"],
  timeline: [{ pod: "p" }, "tool"],
  ask: [{ pod: "p", question: "pod/My lab results" }, "ask"],
};

test("each tool calls the one read it names, and nothing else", async () => {
  assert.deepEqual(
    TOOLS.map(({ name }) => name).sort(),
    Object.keys(RUNS).sort(),
  );
  for (const tool of TOOLS) {
    const [input, read] = RUNS[tool.name]!;
    const called: string[] = [];
    const recording = new Proxy(
      {},
      {
        get: (_, op: string) => async () => {
          called.push(op);
          return op === "pods" ? { pods: [] } : { value: [] };
        },
      },
    );
    await tool.run(recording as never, input);
    assert.deepEqual(called, [read], tool.name);
  }
});

test("find_changes, lab_series and timeline name the entry of each medication and result they give", async () => {
  const pod = {
    ask: async (question: string) =>
      question === "pod/My lab results" ? LABS : MEDICATIONS,
    close: async () => undefined,
  } as unknown as Pod;
  const reads = podReads({ names: async () => ["p"], open: async () => pod });
  const run = (name: string, input: Record<string, unknown>) =>
    TOOLS.find((tool) => tool.name === name)!.run(reads, {
      pod: "p",
      ...input,
    });
  const [finding] = (await run("find_changes", {})) as {
    medication: { entry: string };
  }[];
  assert.equal(finding!.medication.entry, "urn:cascade:entry-medication");
  const { results } = (await run("lab_series", { test: "A" })) as {
    results: { entry: string }[];
  };
  assert.deepEqual(
    results.map(({ entry }) => entry),
    LABS.map(({ entry }) => entry),
  );
  const [medication] = (await run("timeline", {})) as { entry: string }[];
  assert.equal(medication!.entry, "urn:cascade:entry-medication");
  await reads.close();
});
