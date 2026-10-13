import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Story } from "@cascade-runtime/demo-hospital";
import { loadHospital, loadStories } from "@cascade-runtime/demo-hospital/node";
import {
  changesIn,
  changeTools,
  checkInput,
  compact,
  findChanges,
  type InputSchema,
  openPod,
  type Pod,
  pullFiles,
  Refusal,
  type Row,
} from "cascade-runtime";
import { pulled } from "./hospitals.js";

const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm/";
const LOINC = "http://loinc.org/";

let stories: Story[];
const pods = new Map<string, Pod>();

const day = (time: string | undefined) => (time ?? "").slice(0, 10);

before(async () => {
  stories = await loadStories();
  const north = await loadHospital("cascade-north");
  for (const { patient } of stories) {
    const { pull } = await pulled(north, patient);
    const pod = await openPod();
    const imported = await pod.import(pullFiles(pull, "north"), {
      aboutSubject: true,
    });
    assert.equal(imported.refused, undefined, patient);
    pods.set(patient, pod);
  }
});

after(async () => {
  await Promise.all([...pods.values()].map((pod) => pod.close()));
});

const medicine = (
  code: string,
  started: string | undefined,
  ended?: string,
): Row => ({
  medication: `Drug ${code}`,
  code: `${RXNORM}${code}`,
  ...(started ? { started } : {}),
  ...(ended ? { ended } : {}),
  entry: `urn:cascade:entry-${code}`,
});

const lab = (
  test: string,
  performed: string,
  value: string,
  unit = "mg/dL",
): Row => ({
  performed: `${performed}T16:00:00Z`,
  test: `Test ${test}`,
  code: `${LOINC}${test}`,
  value,
  unit,
});

const series = (test: string, unit: string, ...points: [string, string][]) =>
  points.map(([date, value]) => lab(test, date, value, unit));

test("each story patient's pod gives the finding its answer names, field by field, and nothing else", async () => {
  for (const story of stories) {
    const found = await findChanges(pods.get(story.patient)!, { limit: 20 });
    assert.equal(found.length, story.findings.length, story.patient);
    for (const gold of story.findings) {
      const key = `${gold.kind === "after start" ? "start" : "stop"}:${gold.medication}:${gold.test}`;
      const finding = found.find((each) => each.key === key);
      assert.ok(finding, `${story.patient}: ${key}`);
      assert.equal(finding.kind, gold.kind);
      assert.equal(finding.medication.notation, gold.medication);
      assert.equal(finding.medication.date, gold.date);
      assert.equal(finding.test.notation, gold.test);
      assert.equal(finding.direction, gold.direction);
      assert.equal(finding.unit, gold.unit);
      for (const side of ["before", "after"] as const) {
        const values = gold[side].map(({ value }) => value);
        assert.deepEqual(
          finding.rows[side].map((row) => ({
            date: day(row.performed),
            value: Number(row.value),
          })),
          gold[side],
          `${story.patient} ${side}`,
        );
        assert.equal(finding[side].count, values.length);
        assert.equal(finding[side].min, Math.min(...values));
        assert.equal(finding[side].max, Math.max(...values));
      }
      assert.deepEqual(finding.left, { unparsed: 0, otherUnit: 0 });
      assert.equal(
        finding.score === 0,
        gold.direction === "not enough results",
      );
    }
  }
});

test("a value that is not a number, or is in another unit, is left out and counted; a result on the medication's day is before it", () => {
  const found = changesIn(
    [medicine("111", "2024-03-04")],
    [
      ...series(
        "A",
        "mg/dL",
        ["2024-03-01", "160"],
        ["2024-03-03", "158"],
        ["2024-03-04", "165"],
        ["2024-02-01", "pending"],
        ["2024-03-10", "100"],
        ["2024-04-10", "98"],
        ["2024-05-10", "96"],
        ["2024-06-10", "<5"],
      ),
      lab("A", "2024-01-01", "4.1", "mmol/L"),
    ],
  );
  assert.equal(found.length, 1);
  const [finding] = found;
  assert.equal(finding!.key, "start:111:A");
  assert.deepEqual(
    [finding!.before.count, finding!.before.last, finding!.after.count],
    [3, "2024-03-04", 3],
  );
  assert.deepEqual(finding!.left, { unparsed: 2, otherUnit: 1 });
  assert.equal(finding!.rows.left.length, 3);
  assert.deepEqual([finding!.direction, finding!.unit], ["down", "mg/dL"]);
});

test("the unit most results carry wins, the earliest on a tie; changes rank by score, then too little data, within the limit", () => {
  const medications = [medicine("111", "2024-03-04")];
  const labs = [
    ...series(
      "BIG",
      "mg/dL",
      ["2024-01-01", "160"],
      ["2024-02-01", "158"],
      ["2024-03-01", "165"],
      ["2024-04-01", "100"],
      ["2024-05-01", "98"],
      ["2024-06-01", "96"],
    ),
    ...series(
      "FLOOR",
      "mg/dL",
      ["2024-01-01", "100"],
      ["2024-02-01", "100"],
      ["2024-03-01", "100"],
      ["2024-04-01", "102"],
      ["2024-05-01", "102"],
      ["2024-06-01", "102"],
    ),
    ...series(
      "FLAT",
      "mg/dL",
      ["2024-01-01", "4.0"],
      ["2024-02-01", "4.2"],
      ["2024-03-01", "4.1"],
      ["2024-04-01", "4.1"],
      ["2024-05-01", "4.0"],
      ["2024-06-01", "4.2"],
    ),
    lab("TIE", "2024-01-10", "5", "mmol/L"),
    lab("TIE", "2024-01-20", "90"),
    lab("TIE", "2024-04-01", "5", "mmol/L"),
    lab("TIE", "2024-04-10", "90"),
    ...series("ONESIDE", "mg/dL", ["2024-01-01", "1"], ["2024-02-01", "2"]),
  ];
  const found = changesIn(medications, labs);
  assert.deepEqual(
    found.map(({ key }) => key),
    ["start:111:BIG", "start:111:FLOOR", "start:111:TIE"],
  );
  assert.ok(found[0]!.score > found[1]!.score);
  assert.ok(Math.abs(found[1]!.score - 2) < 1e-9);
  assert.deepEqual(
    [found[2]!.unit, found[2]!.left.otherUnit, found[2]!.score],
    ["mmol/L", 2, 0],
  );
  assert.deepEqual(
    changesIn(medications, labs, { limit: 2 }).map(({ key }) => key),
    ["start:111:BIG", "start:111:FLOOR"],
  );
  assert.deepEqual(
    changesIn(medications, labs, { test: `${LOINC}BIG` }).map(({ key }) => key),
    ["start:111:BIG"],
  );
});

test("a stop is a day of its own, and a finding's compact form drops its rows and entry", () => {
  const [finding] = changesIn(
    [medicine("222", "2020-01-01", "2024-04-15T00:00:00Z")],
    series(
      "A1C",
      "%",
      ["2024-01-01", "6.6"],
      ["2024-02-01", "6.5"],
      ["2024-03-01", "6.7"],
      ["2024-05-01", "7.4"],
      ["2024-06-01", "7.9"],
      ["2024-07-01", "8.3"],
    ),
  );
  assert.equal(finding!.key, "stop:222:A1C");
  assert.equal(finding!.kind, "after stop");
  assert.equal(finding!.direction, "up");
  const small = compact(finding!);
  assert.equal("rows" in small, false);
  assert.equal("entry" in small.medication, false);
  assert.equal(small.medication.date, "2024-04-15");
  assert.ok(JSON.stringify(small).length < JSON.stringify(finding).length / 2);
});

test("the tools give a story's findings, their rows, a test's series and the timeline, and refuse bad input with Refusal", async () => {
  const tools = new Map(
    changeTools(pods.get("story-statin")!).map((each) => [each.name, each]),
  );
  assert.deepEqual(
    [...tools.keys()],
    ["find_changes", "finding_rows", "lab_series", "timeline"],
  );

  const KEYWORDS = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "minimum",
    "maximum",
    "description",
  ]);
  const keywords = (schema: InputSchema): string[] => [
    ...Object.keys(schema),
    ...Object.values(schema.properties ?? {}).flatMap(keywords),
  ];
  for (const { name, inputSchema } of tools.values())
    for (const keyword of keywords(inputSchema))
      assert.ok(KEYWORDS.has(keyword), `${name}: ${keyword}`);

  const [change] = (await tools.get("find_changes")!.execute({})) as {
    key: string;
    medication: Record<string, unknown>;
  }[];
  assert.equal(change!.key, "start:617310:18262-6");
  assert.equal("entry" in change!.medication, false);
  assert.equal("rows" in change!, false);

  const rows = (await tools
    .get("finding_rows")!
    .execute({ key: change!.key })) as { before: Row[]; after: Row[] };
  assert.deepEqual([rows.before.length, rows.after.length], [3, 3]);

  const labs = (await tools
    .get("lab_series")!
    .execute({ test: "18262-6" })) as {
    results: { date: string; value: number; unit: string }[];
    left: { unparsed: number };
  };
  assert.equal(labs.results.length, 6);
  assert.equal(labs.left.unparsed, 0);

  const [medication] = (await tools.get("timeline")!.execute({})) as {
    notation: string;
    started: string;
  }[];
  assert.deepEqual(
    [medication!.notation, medication!.started],
    ["617310", "2024-03-04"],
  );

  const refused: [string, unknown, RegExp][] = [
    ["find_changes", { colour: "red" }, /not a property/],
    ["find_changes", { medication: 7 }, /must be a string/],
    ["find_changes", { limit: 1.5 }, /must be an integer/],
    ["find_changes", { limit: 0 }, /at least 1/],
    ["find_changes", { limit: 21 }, /at most 20/],
    ["find_changes", "all", /must be an object/],
    ["find_changes", { medication: "no such drug" }, /no medication/],
    ["find_changes", { test: "0000-0" }, /no test/],
    ["finding_rows", {}, /key is required/],
    ["finding_rows", { key: "start:0:0" }, /no finding/],
    ["lab_series", { test: "0000-0" }, /no test/],
    ["timeline", { extra: true }, /not a property/],
  ];
  for (const [name, input, reason] of refused)
    await assert.rejects(
      tools.get(name)!.execute(input),
      (error: unknown) =>
        error instanceof Refusal && reason.test(error.message),
      `${name} ${JSON.stringify(input)}`,
    );

  assert.throws(
    () => checkInput({ type: "string", enum: ["a"] }, "b"),
    Refusal,
  );
});
