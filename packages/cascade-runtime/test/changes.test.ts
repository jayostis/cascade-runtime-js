import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  changesIn,
  changeTools,
  compact,
  type LabChange,
  Refusal,
  type Row,
  timelineIn,
} from "cascade-runtime";

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

/** Three results a side of 2024-03-04 that fall: 160, 158 and 165, then 100, 98 and 96. */
const FALL: [string, string][] = [
  ["2024-01-01", "160"],
  ["2024-02-01", "158"],
  ["2024-03-01", "165"],
  ["2024-04-01", "100"],
  ["2024-05-01", "98"],
  ["2024-06-01", "96"],
];

const keysOf = (changes: readonly LabChange[]) => changes.map(({ key }) => key);

/**
 * `findChanges(pod)` compares each lab test's results before and after the day a medication started or stopped, and
 * returns each pair of a medication and a test whose results moved as a change, strongest first; `changesIn(medications,
 * labs)` does the same over rows an app already holds. A medication is placed on its day: the day its use started, else
 * the day its prescription was written, and for a stop the day its use ended. A change says what changed and never why,
 * so an app or a model can tell a person "your LDL fell after atorvastatin started" from their own records.
 */
describe("Finding lab changes after a medication starts or stops · findChanges(), changesIn()", () => {
  describe("changesIn(medications, labs)", () => {
    const pending = lab("A", "2024-02-01", "pending");
    const below = lab("A", "2024-06-10", "<5");
    const mmol = lab("A", "2024-01-01", "4.1", "mmol/L");
    const undated = { ...lab("A", "2024-03", "150"), performed: "2024-03" };
    const unusable = [pending, below, mmol, undated];
    const usable = series(
      "A",
      "mg/dL",
      ["2024-03-01", "160"],
      ["2024-03-03", "158"],
      ["2024-03-04", "165"],
      ["2024-03-10", "100"],
      ["2024-04-10", "98"],
      ["2024-05-10", "96"],
    );
    let change: LabChange;

    before(() => {
      const found = changesIn(
        [medicine("111", "2024-03-04")],
        [...usable, ...unusable],
      );
      assert.equal(found.length, 1);
      [change] = found as [LabChange];
    });

    it("returns one change for a medication and a test with three results before its day and three after, with `start:<medication code>:<test code>` as its `key`", () => {
      assert.equal(change.key, "start:111:A");
      assert.deepEqual([change.before.count, change.after.count], [3, 3]);
    });

    it("counts a result on the medication's own day as before it", () => {
      assert.equal(change.before.last, "2024-03-04");
    });

    it("returns `direction` `down` when the mean after is lower, and `up` when it is higher", () => {
      const rise = changesIn(
        [medicine("222", "2024-04-15")],
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
      assert.deepEqual([change.direction, rise[0]!.direction], ["down", "up"]);
    });

    it("leaves out of both sides a value that is not a number, a number in another unit and a result with no full day", () => {
      assert.deepEqual(
        [change.rows.before.length, change.rows.after.length],
        [3, 3],
      );
      for (const [what, row] of [
        ["a value that is not a number", pending],
        ["a value that is not a number, `<5`", below],
        ["a number in another unit", mmol],
        ["a result with no full day", undated],
      ] as const) {
        assert.equal(change.rows.before.includes(row), false, what);
        assert.equal(change.rows.after.includes(row), false, what);
      }
    });

    it("returns in `left` how many results it left out for each reason, and in `rows.left` their rows", () => {
      assert.deepEqual(change.left, { unparsed: 2, otherUnit: 1, undated: 1 });
      assert.equal(change.rows.left.length, 4);
      for (const row of unusable) assert.ok(change.rows.left.includes(row));
    });

    it("compares in the unit most of the results carry, and in the earliest on a tie", () => {
      const tie = changesIn(
        [medicine("111", "2024-03-04")],
        [
          lab("TIE", "2024-01-10", "5", "mmol/L"),
          lab("TIE", "2024-01-20", "90"),
          lab("TIE", "2024-04-01", "5", "mmol/L"),
          lab("TIE", "2024-04-10", "90"),
        ],
      );
      assert.equal(change.unit, "mg/dL");
      assert.deepEqual([tie[0]!.unit, tie[0]!.left.otherUnit], ["mmol/L", 2]);
    });

    it("returns `not enough results`, with a `score` of 0, for a pair with fewer than three results on one side", () => {
      const [thin] = changesIn(
        [medicine("111", "2024-03-04")],
        [
          lab("TIE", "2024-01-10", "5", "mmol/L"),
          lab("TIE", "2024-01-20", "90"),
          lab("TIE", "2024-04-01", "5", "mmol/L"),
          lab("TIE", "2024-04-10", "90"),
        ],
      );
      assert.deepEqual(
        [thin!.direction, thin!.score],
        ["not enough results", 0],
      );
    });

    it("returns no pair for a test with results on one side of the day only", () => {
      const found = changesIn(
        [medicine("111", "2024-03-04")],
        [
          ...series("BIG", "mg/dL", ...FALL),
          ...series(
            "ONESIDE",
            "mg/dL",
            ["2024-01-01", "1"],
            ["2024-02-01", "2"],
          ),
        ],
      );
      assert.deepEqual(keysOf(found), ["start:111:BIG"]);
    });

    it("returns no pair for results that moved less than they vary among themselves, a `score` under 1", () => {
      const found = changesIn(
        [medicine("111", "2024-03-04")],
        [
          ...series("BIG", "mg/dL", ...FALL),
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
        ],
      );
      assert.deepEqual(keysOf(found), ["start:111:BIG"]);
    });

    it("ranks changes by `score`, highest first, and puts the pairs without enough results after them", () => {
      const found = changesIn(
        [medicine("111", "2024-03-04")],
        [
          ...series("BIG", "mg/dL", ...FALL),
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
          lab("TIE", "2024-01-10", "5", "mmol/L"),
          lab("TIE", "2024-01-20", "90"),
          lab("TIE", "2024-04-01", "5", "mmol/L"),
          lab("TIE", "2024-04-10", "90"),
        ],
      );
      assert.deepEqual(keysOf(found), [
        "start:111:BIG",
        "start:111:FLOOR",
        "start:111:TIE",
      ]);
      assert.ok(found[0]!.score > found[1]!.score);
    });

    it("scores results that do not vary at all against 1% of the mean before", () => {
      const [floor] = changesIn(
        [medicine("111", "2024-03-04")],
        series(
          "FLOOR",
          "mg/dL",
          ["2024-01-01", "100"],
          ["2024-02-01", "100"],
          ["2024-03-01", "100"],
          ["2024-04-01", "102"],
          ["2024-05-01", "102"],
          ["2024-06-01", "102"],
        ),
      );
      assert.ok(Math.abs(floor!.score - 2) < 1e-9);
    });

    it("returns at most `limit` pairs, 5 when none is given", () => {
      const tests = ["a", "b", "c", "d", "e", "f", "g"];
      const medications = [medicine("111", "2024-03-04")];
      const labs = tests.flatMap((test) => series(test, "mg/dL", ...FALL));
      assert.deepEqual(keysOf(changesIn(medications, labs, { limit: 2 })), [
        "start:111:a",
        "start:111:b",
      ]);
      assert.deepEqual(keysOf(changesIn(medications, labs)), [
        "start:111:a",
        "start:111:b",
        "start:111:c",
        "start:111:d",
        "start:111:e",
      ]);
    });

    it("returns only the pairs of the `test` or the `medication` named: by code, by the code's IRI or, for a medication, by its name", () => {
      const medications = [
        medicine("111", "2024-03-04"),
        medicine("222", "2024-03-04"),
      ];
      const labs = [
        ...series("LDL", "mg/dL", ...FALL),
        ...series("HDL", "mg/dL", ...FALL),
      ];
      const named = (options: { test?: string; medication?: string }) =>
        keysOf(changesIn(medications, labs, { limit: 20, ...options }));
      for (const [what, options, expected] of [
        [
          "a test by its IRI",
          { test: `${LOINC}LDL` },
          ["start:111:LDL", "start:222:LDL"],
        ],
        [
          "a test by its code",
          { test: "LDL" },
          ["start:111:LDL", "start:222:LDL"],
        ],
        [
          "a medication by its code",
          { medication: "111" },
          ["start:111:HDL", "start:111:LDL"],
        ],
        [
          "a medication by its name",
          { medication: "DRUG 111" },
          ["start:111:HDL", "start:111:LDL"],
        ],
      ] as const)
        assert.deepEqual(named(options), expected, what);
    });

    it("throws `Refusal` for a medication or a test the rows do not hold, and for a `limit` under 1", () => {
      const medications = [medicine("111", "2024-03-04")];
      const labs = series("A", "mg/dL", ...FALL);
      for (const [what, options, message] of [
        [
          "a medication the rows lack",
          { medication: "no such drug" },
          /no medication/,
        ],
        ["a test the rows lack", { test: "0000-0" }, /no test/],
        ["a `limit` of 0", { limit: 0 }, /at least 1/],
      ] as const)
        assert.throws(
          () => changesIn(medications, labs, options),
          (error: unknown) =>
            error instanceof Refusal && message.test(error.message),
          what,
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
    const EXPECTED = [
      ["start:111:A", "2024-03-15"],
      ["stop:111:A", "2024-09-01"],
    ];

    it("returns one start, on the earliest start, and one stop, on the latest end", () => {
      assert.deepEqual(days(renewals), EXPECTED);
    });

    it("returns the same two changes whatever order the rows come in", () => {
      assert.deepEqual(days([...renewals].reverse()), EXPECTED);
    });

    it("names in `medication.entry` the view entry of the renewal that started first", () => {
      const start = changesIn(renewals, labs).find(
        ({ kind }) => kind === "after start",
      );
      assert.equal(start!.medication.entry, "urn:a");
    });
  });

  describe("given a medication whose use ended", () => {
    const labs = series(
      "A",
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
    const taken = medicine("444", "2024-03-10", "2024-06-20");

    it("returns a change of `kind` `after stop`, on the day its use ended, with `stop:<medication code>:<test code>` as its `key`", () => {
      const [stop] = changesIn(
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
      assert.deepEqual(
        [stop!.key, stop!.kind, stop!.medication.date],
        ["stop:222:A1C", "after stop", "2024-04-15"],
      );
    });

    it("returns `dateIs` `start of use` for the start and `end of use` for the stop", () => {
      const dated = changesIn([taken], labs, { limit: 10 })
        .map(({ key, medication: { date, dateIs } }) => [key, date, dateIs])
        .sort();
      assert.deepEqual(dated, [
        ["start:444:A", "2024-03-10", "start of use"],
        ["stop:444:A", "2024-06-20", "end of use"],
      ]);
    });
  });

  describe("given a prescription with no start of use stated", () => {
    it("places the medication on the day the prescription was written, with `dateIs` `prescription written`", () => {
      const written: Row = {
        ...medicine("333", undefined),
        written: "2024-03-04",
      };
      const found = changesIn(
        [written],
        series("LDL", "mg/dL", ...FALL, ["2024-08-01", "95"]),
        { limit: 10 },
      );
      assert.deepEqual(
        found.map(({ key, medication: { date, dateIs } }) => [
          key,
          date,
          dateIs,
        ]),
        [["start:333:LDL", "2024-03-04", "prescription written"]],
      );
    });
  });

  describe("compact(change)", () => {
    it("returns the change without its `rows` and without `medication.entry`, in under half the characters", () => {
      const [change] = changesIn(
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
      const small = compact(change!);
      assert.equal("rows" in small, false);
      assert.equal("entry" in small.medication, false);
      assert.ok(
        JSON.stringify(small).length < JSON.stringify(change).length / 2,
      );
    });
  });

  describe("timelineIn(medications)", () => {
    const written: Row = {
      ...medicine("333", undefined),
      written: "2024-03-04",
    };
    const taken = medicine("444", "2024-03-10", "2024-06-20");
    let timeline: ReturnType<typeof timelineIn>;

    before(() => {
      timeline = timelineIn([{ ...taken, written: "2024-03-01" }, written]);
    });

    it("returns each medication's start of use and the day its prescription was written as two fields, `started` and `written`", () => {
      assert.deepEqual(
        timeline.map(({ notation, started, written: on }) => [
          notation,
          started,
          on,
        ]),
        [
          ["333", undefined, "2024-03-04"],
          ["444", "2024-03-10", "2024-03-01"],
        ],
      );
    });

    it("orders the medications by start of use, and by the day written where no start is stated", () => {
      assert.deepEqual(
        timeline.map(({ notation }) => notation),
        ["333", "444"],
      );
    });
  });
});

describe("Tools a model reads a pod with · TOOLS", () => {
  describe("changeTools(pod)", () => {
    const medications: Row[] = [
      medicine("111", "2024-03-04"),
      { ...medicine("333", undefined), written: "2024-01-15" },
    ];
    const labs: Row[] = [
      ...series("LDL", "mg/dL", ...FALL),
      lab("LDL", "2024-07-01", "pending"),
      { ...lab("LDL", "2024-03", "150"), performed: "2024-03" },
    ];
    const pod = {
      ask: async (question: string) =>
        question === "pod/My medication history" ? medications : labs,
    };
    const tools = changeTools(pod);
    const toolNamed = (name: string) =>
      tools.find((tool) => tool.name === name)!;
    const refused = (name: string, input: unknown, message: RegExp) =>
      assert.rejects(
        toolNamed(name).execute(input),
        (error: unknown) =>
          error instanceof Refusal && message.test(error.message),
        `${name} ${JSON.stringify(input)}`,
      );

    it("returns four tools: `find_changes`, `finding_rows`, `lab_series` and `timeline`", () => {
      assert.deepEqual(
        tools.map(({ name }) => name),
        ["find_changes", "finding_rows", "lab_series", "timeline"],
      );
    });

    it("returns from `find_changes` each lab change in its compact form, with no `rows` and no `medication.entry`", async () => {
      const found = (await toolNamed("find_changes").execute(
        {},
      )) as LabChange[];
      assert.equal(found[0]!.key, "start:111:LDL");
      assert.equal("rows" in found[0]!, false);
      assert.equal("entry" in found[0]!.medication, false);
    });

    it("returns from `finding_rows` the rows behind the lab change a `key` names, those before and those after", async () => {
      const rows = (await toolNamed("finding_rows").execute({
        key: "start:111:LDL",
      })) as LabChange["rows"];
      assert.deepEqual([rows.before.length, rows.after.length], [3, 3]);
    });

    it("returns from `lab_series` one test's results by day, oldest first, with those it left out counted", async () => {
      const found = (await toolNamed("lab_series").execute({
        test: "LDL",
      })) as {
        results: { date: string }[];
        left: { unparsed: number; undated: number };
      };
      assert.deepEqual(
        [
          found.results.length,
          found.results[0]!.date,
          found.results.at(-1)!.date,
        ],
        [6, "2024-01-01", "2024-06-01"],
      );
      assert.deepEqual(found.left, { unparsed: 1, undated: 1 });
    });

    it("returns from `timeline` each medication with its start of use and the day its prescription was written", async () => {
      const found = (await toolNamed("timeline").execute({})) as {
        notation: string;
        started?: string;
        written?: string;
      }[];
      assert.deepEqual(
        found.map(({ notation, started, written }) => [
          notation,
          started,
          written,
        ]),
        [
          ["333", undefined, "2024-01-15"],
          ["111", "2024-03-04", undefined],
        ],
      );
    });

    it("throws `Refusal` for input outside a tool's schema: a `limit` of 0 or of 21, no `key`, a property it does not name", async () => {
      await refused("find_changes", { limit: 0 }, /at least 1/);
      await refused("find_changes", { limit: 21 }, /at most 20/);
      await refused("finding_rows", {}, /key is required/);
      await refused("timeline", { extra: true }, /not a property/);
    });

    it("throws `Refusal` for a medication, a test or a `key` the pod does not have", async () => {
      await refused(
        "find_changes",
        { medication: "no such drug" },
        /no medication/,
      );
      await refused("find_changes", { test: "0000-0" }, /no test/);
      await refused("finding_rows", { key: "start:0:0" }, /no finding/);
      await refused("lab_series", { test: "0000-0" }, /no test/);
    });
  });
});
