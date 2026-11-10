import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
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

type Finding = ReturnType<typeof changesIn>[number];

describe("changesIn", () => {
  describe("given results that cannot be compared", () => {
    let found: Finding[];
    before(() => {
      found = changesIn(
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
    });

    it("finds one change, keyed by medication and test", () => {
      assert.equal(found.length, 1);
      assert.equal(found[0]!.key, "start:111:A");
    });

    it("counts a result on the medication's day as before it", () => {
      const [finding] = found;
      assert.deepEqual(
        [finding!.before.count, finding!.before.last, finding!.after.count],
        [3, "2024-03-04", 3],
      );
    });

    it("leaves out and counts non-numbers, other units and undated", () => {
      const [finding] = found;
      assert.deepEqual(finding!.left, {
        unparsed: 2,
        otherUnit: 1,
        undated: 1,
      });
      assert.equal(finding!.rows.left.length, 4);
    });

    it("gives the direction and the unit", () => {
      const [finding] = found;
      assert.deepEqual([finding!.direction, finding!.unit], ["down", "mg/dL"]);
    });
  });

  describe("given several tests for one medication", () => {
    const medications = [medicine("111", "2024-03-04")];
    let labs: Row[];
    let found: Finding[];
    before(() => {
      labs = [
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
      found = changesIn(medications, labs);
    });

    it("ranks by score, then too little data", () => {
      assert.deepEqual(
        found.map(({ key }) => key),
        ["start:111:BIG", "start:111:FLOOR", "start:111:TIE"],
      );
      assert.ok(found[0]!.score > found[1]!.score);
      assert.ok(Math.abs(found[1]!.score - 2) < 1e-9);
    });

    it("takes the unit most results carry, the earliest on a tie", () => {
      assert.deepEqual(
        [found[2]!.unit, found[2]!.left.otherUnit, found[2]!.score],
        ["mmol/L", 2, 0],
      );
    });

    it("gives no more than the limit", () => {
      assert.deepEqual(
        changesIn(medications, labs, { limit: 2 }).map(({ key }) => key),
        ["start:111:BIG", "start:111:FLOOR"],
      );
    });

    it("gives only the test asked for", () => {
      assert.deepEqual(
        changesIn(medications, labs, { test: `${LOINC}BIG` }).map(
          ({ key }) => key,
        ),
        ["start:111:BIG"],
      );
    });
  });

  describe("given renewals of one drug", () => {
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

    it("is one therapy from the earliest start to the latest end", () => {
      assert.deepEqual(days(renewals), expected);
    });

    it("is the same whatever order the rows come in", () => {
      assert.deepEqual(days([...renewals].reverse()), expected);
    });

    it("names the earliest renewal's entry for the start", () => {
      assert.equal(
        changesIn(renewals, labs).find(({ kind }) => kind === "after start")!
          .medication.entry,
        "urn:a",
      );
    });
  });

  describe("given a medication that ended", () => {
    let finding: Finding;
    before(() => {
      finding = changesIn(
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
      )[0]!;
    });

    it("finds the stop as a day of its own", () => {
      assert.equal(finding.key, "stop:222:A1C");
      assert.equal(finding.kind, "after stop");
      assert.equal(finding.direction, "up");
    });

    it("has a compact form without its rows and entry", () => {
      const small = compact(finding);
      assert.equal("rows" in small, false);
      assert.equal("entry" in small.medication, false);
      assert.equal(small.medication.date, "2024-04-15");
      assert.ok(
        JSON.stringify(small).length < JSON.stringify(finding).length / 2,
      );
    });
  });

  describe("given a prescription with no start of use", () => {
    const written: Row = {
      ...medicine("333", undefined),
      written: "2024-03-04",
    };
    const taken = medicine("444", "2024-03-10", "2024-06-20");
    const labs = series(
      "LDL",
      "mg/dL",
      ["2024-01-01", "160"],
      ["2024-02-01", "158"],
      ["2024-03-01", "165"],
      ["2024-05-01", "100"],
      ["2024-06-01", "98"],
      ["2024-07-01", "96"],
      ["2024-08-01", "95"],
      ["2024-09-01", "94"],
    );
    const dated = (rows: Row[]) =>
      changesIn(rows, labs, { limit: 10 })
        .map(({ key, medication: { date, dateIs } }) => [key, date, dateIs])
        .sort();

    it("is placed on the day it was written, and says so", () => {
      assert.deepEqual(dated([written]), [
        ["start:333:LDL", "2024-03-04", "prescription written"],
      ]);
    });

    it("is placed on the days of use where there are some", () => {
      assert.deepEqual(dated([taken]), [
        ["start:444:LDL", "2024-03-10", "start of use"],
        ["stop:444:LDL", "2024-06-20", "end of use"],
      ]);
    });

    it("keeps the written and started dates apart in the timeline", () => {
      assert.deepEqual(
        timelineIn([{ ...taken, written: "2024-03-01" }, written]).map(
          ({ notation, started, written: on }) => [notation, started, on],
        ),
        [
          ["333", undefined, "2024-03-04"],
          ["444", "2024-03-10", "2024-03-01"],
        ],
      );
    });
  });
});
