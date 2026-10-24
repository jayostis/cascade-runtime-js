import assert from "node:assert/strict";
import { test } from "node:test";
import { changesIn, compact, type Row, timelineIn } from "cascade-runtime";

const RXNORM = "https://ns.cascadeprotocol.org/codes/rxnorm/";
const LOINC = "http://loinc.org/";

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
      { ...lab("A", "2024-03", "150"), performed: "2024-03" },
    ],
  );
  assert.equal(found.length, 1);
  const [finding] = found;
  assert.equal(finding!.key, "start:111:A");
  assert.deepEqual(
    [finding!.before.count, finding!.before.last, finding!.after.count],
    [3, "2024-03-04", 3],
  );
  assert.deepEqual(finding!.left, { unparsed: 2, otherUnit: 1, undated: 1 });
  assert.equal(finding!.rows.left.length, 4);
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

test("renewals of one drug are one therapy: it starts on the earliest start and stops on the latest end, whatever order the rows come in", () => {
  const labs = series(
    "A",
    "mg/dL",
    ["2024-01-01", "160"],
    ["2024-02-01", "158"],
    ["2024-03-01", "165"],
    ["2024-05-01", "100"],
    ["2024-06-01", "98"],
    ["2024-07-01", "96"],
    ["2024-10-01", "90"],
    ["2024-11-01", "88"],
    ["2024-12-01", "86"],
  );
  const renewals = [
    { ...medicine("111", "2024-04-01", "2024-04-20"), entry: "urn:b" },
    { ...medicine("111", "2024-04-01", "2024-09-01"), entry: "urn:c" },
    { ...medicine("111", "2024-03-15", "2024-03-20"), entry: "urn:a" },
  ];
  const days = (rows: Row[]) =>
    changesIn(rows, labs)
      .map(({ key, medication }) => [key, medication.date])
      .sort();
  const expected = [
    ["start:111:A", "2024-03-15"],
    ["stop:111:A", "2024-09-01"],
  ];
  assert.deepEqual(days(renewals), expected);
  assert.deepEqual(days([...renewals].reverse()), expected);
  assert.equal(
    changesIn(renewals, labs).find(({ kind }) => kind === "after start")!
      .medication.entry,
    "urn:a",
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

test("a medication with no start of use starts on the day its prescription was written, and the timeline dates it so", () => {
  const written: Row = { ...medicine("333", undefined), written: "2024-03-04" };
  const [finding] = changesIn(
    [written],
    series(
      "LDL",
      "mg/dL",
      ["2024-01-01", "160"],
      ["2024-02-01", "158"],
      ["2024-03-01", "165"],
      ["2024-05-01", "100"],
      ["2024-06-01", "98"],
      ["2024-07-01", "96"],
    ),
  );
  assert.deepEqual(
    [finding?.key, finding?.medication.date],
    ["start:333:LDL", "2024-03-04"],
  );
  assert.equal(timelineIn([written])[0]?.started, "2024-03-04");
  assert.equal(
    timelineIn([{ ...written, started: "2024-03-10" }])[0]?.started,
    "2024-03-10",
  );
});
