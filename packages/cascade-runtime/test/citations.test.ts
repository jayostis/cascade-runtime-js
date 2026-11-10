import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  type Absence,
  type Citation,
  checkAbsence,
  checkCitation,
  checkRecordsAbsence,
  downloadsSource,
  isoDate,
  podRowsSource,
  type Source,
} from "cascade-runtime";

const FOLDER = fileURLToPath(
  new URL("../../test/fixtures/citations/", import.meta.url),
);
const downloads = downloadsSource(FOLDER);
const LDL = "pod://p/clinical/lab-results.ttl#ldl";
const REPORT = "pod://p/clinical/reports.ttl#ct";
const PERSON = "urn:uuid:a6bce037-019e-4220-92b1-cab8d308410a";
const NS = "https://ns.cascadeprotocol.org/cascade#";

const ldl = { file: "bundle.json", resource: "Observation/ldl-1" };
const fit = { file: "bundle.json", resource: "Observation/fit-1" };
const metformin = {
  file: "bundle.json",
  resource: "MedicationStatement/med-1",
};
const report = { file: "bundle.json", resource: "DiagnosticReport/dr-1" };
const condition = { file: "bundle.json", resource: "Condition/c-1" };
const order = { file: "bundle.json", resource: "MedicationRequest/m-1" };
const patient = { file: "bundle.json", resource: "Patient/p-1" };
const dead = { file: "bundle.json", resource: "Patient/p-2" };
const summary = (line: number) => ({ file: "summary.xml", line });
const recorded = (line: number) => ({ file: "recorded.xml", line });

/** A verdict as the test compares it: what was held, why not, what was missing and where it is. */
interface Expected {
  readonly ok: boolean;
  readonly reason?: string;
  readonly missing?: readonly string[];
  readonly foundAt?: readonly number[];
}

const ok: Expected = { ok: true };
const otherwise = (...missing: string[]): Expected => ({
  ok: false,
  reason: "says otherwise",
  missing,
});

/** What checking the citation against the source returns, without the one line summary of the record. */
async function verdictOf(
  citation: Citation,
  source: Source,
): Promise<Expected> {
  const verdict = (await checkCitation(citation, source)) as Expected;
  return {
    ok: verdict.ok,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(verdict.missing ? { missing: verdict.missing } : {}),
    ...(verdict.foundAt ? { foundAt: verdict.foundAt } : {}),
  };
}

/** Checks each citation against the source, and names the example whose verdict is not the one given. */
async function assertVerdicts(
  source: Source,
  examples: readonly (readonly [string, Citation, Expected])[],
): Promise<void> {
  for (const [what, citation, expected] of examples)
    assert.deepEqual(await verdictOf(citation, source), expected, what);
}

/** Checks each citation against the source, and names the example that does not hold, or holds, as given. */
async function assertHolds(
  source: Source,
  examples: readonly (readonly [string, Citation, boolean])[],
): Promise<void> {
  for (const [what, citation, held] of examples)
    assert.equal((await checkCitation(citation, source)).ok, held, what);
}

const stillBacked = { backed: true };
const found = { backed: false, reason: "query found it" };
const cut = { backed: false, reason: "query cut short" };

/** An `ask` call that ran, with its answer as the text a model was given. */
const asked = (
  input: Readonly<Record<string, unknown>>,
  answer: unknown,
  ok = true,
) => ({
  tool: "ask",
  input,
  ok,
  answer: JSON.stringify(answer),
});

/**
 * An absence is what a reply says the records lack, such as a colonoscopy after a positive stool test: the codes and
 * words a record of it would carry, and the tool call that looked. `checkAbsence` backs it only when that call ran,
 * returned every row and none matches, so a model cannot report "no record of it" after reading part of a pod.
 * @rule runtime/currency.feature C9
 */
describe("Checking what a reply says a pod lacks · checkAbsence()", () => {
  const input = { pod: "p", question: "pod/My procedures" };
  const procedures = (answer: unknown, ran = true) => asked(input, answer, ran);
  const none = {
    total: 1,
    rows: [{ procedure: "CT angiography of the chest" }],
  };
  const colonoscopy: Absence = {
    what: "a colonoscopy after the positive FIT",
    coverage: "every procedure the pod holds",
    match: { codes: ["73761001"], terms: ["colonoscopy"] },
    query: { tool: "ask", input: { question: "pod/My procedures", pod: "p" } },
  };

  describe("checkAbsence(absence, ran)", () => {
    it("returns `backed: true` when the query ran, returned every row and no row holds one of the absence's codes or words", () => {
      assert.deepEqual(
        checkAbsence(colonoscopy, [procedures(none)]),
        stillBacked,
      );
    });

    it("returns `no query` for an absence that names no tool call", () => {
      assert.deepEqual(
        checkAbsence({ ...colonoscopy, query: undefined }, [procedures(none)]),
        { backed: false, reason: "no query" },
      );
    });

    it("returns `query not run` when no call that ran has the query's tool and input", () => {
      const other = asked({ pod: "p", question: "pod/My lab results" }, none);
      assert.deepEqual(checkAbsence(colonoscopy, [other]), {
        backed: false,
        reason: "query not run",
      });
    });

    it("returns `query refused` when the call did not succeed", () => {
      assert.deepEqual(
        checkAbsence(colonoscopy, [
          procedures("no question pod/My procedures", false),
        ]),
        { backed: false, reason: "query refused" },
      );
    });

    it("returns `query found it` when a row holds one of the absence's codes or words", () => {
      const colonoscopyDone = procedures({
        total: 1,
        rows: [
          {
            procedure: "Colonoscopy",
            snomed: "http://snomed.info/id/73761001",
          },
        ],
      });
      assert.deepEqual(checkAbsence(colonoscopy, [colonoscopyDone]), found);
    });

    it("returns `query cut short` when the call returned fewer rows than its `total`", () => {
      assert.deepEqual(
        checkAbsence(colonoscopy, [
          procedures({ total: 80, rows: [{ procedure: "CT" }] }),
        ]),
        cut,
      );
    });

    it("returns `nothing to look for` for an absence with no code and no word", () => {
      assert.deepEqual(
        checkAbsence({ ...colonoscopy, match: {} }, [procedures(none)]),
        { backed: false, reason: "nothing to look for" },
      );
    });

    it("returns `no coverage` for an absence that does not say what was looked through", () => {
      assert.deepEqual(
        checkAbsence({ ...colonoscopy, coverage: " " }, [procedures(none)]),
        { backed: false, reason: "no coverage" },
      );
    });

    it("returns `no such call` when the query names a call by number and no call with that tool and input has it", () => {
      const ran = [
        { call: 1, ...procedures("no", false) },
        { call: 2, ...procedures(none) },
        {
          call: 3,
          ...asked({ pod: "p", question: "pod/My lab results" }, none),
        },
      ];
      const asking = (call: number): Absence => ({
        ...colonoscopy,
        query: { tool: "ask", input, call },
      });
      for (const [what, call] of [
        ["a number no call has", 99],
        ["the number of a call with another input", 3],
      ] as const)
        assert.deepEqual(
          checkAbsence(asking(call), ran),
          { backed: false, reason: "no such call" },
          what,
        );
      assert.deepEqual(checkAbsence(asking(2), ran), stillBacked);
    });
  });

  describe("given an absence after a day (`match.after`)", () => {
    const labsInput = { pod: "p", question: "pod/My lab results" };
    const a1cOn = (performed: string, more: object = {}) =>
      asked(labsInput, {
        total: 1,
        rows: [
          {
            test: "Hemoglobin A1c",
            code: "http://loinc.org/rdf/4548-4",
            performed,
            ...more,
          },
        ],
      });
    const a1cAfter = (after: string): Absence => ({
      what: "an A1c since February",
      coverage: "every lab result the pod holds",
      match: { codes: ["4548-4"], after },
      query: { tool: "ask", input: labsInput },
    });

    it("ignores a matching row whose date is before that day", () => {
      assert.deepEqual(
        checkAbsence(a1cAfter("2026-02-17"), [a1cOn("2026-02-16T16:00:00Z")]),
        stillBacked,
      );
    });

    it("returns `query found it` for a matching row dated after it", () => {
      assert.deepEqual(
        checkAbsence(a1cAfter("2026-01-01"), [a1cOn("2026-02-16T16:00:00Z")]),
        found,
      );
    });

    it("ignores the date a row was retrieved, which is not the date of what it records", () => {
      const written =
        "urn:uuid:91490b7d from ni:///sha-256;Uh, retrieved 2026-10-15T00:00:00Z, written by Cascade North Demo Hospital";
      for (const [what, more] of [
        ["sources written as one text", { sources: written }],
        [
          "sources written as a list",
          { sources: [{ retrieved: "2026-10-15" }] },
        ],
      ] as const)
        assert.deepEqual(
          checkAbsence(a1cAfter("2026-02-17"), [a1cOn("2026-02-16", more)]),
          stillBacked,
          what,
        );
    });

    it("reads no date in a code that is a long number", () => {
      const conditions = { pod: "p", question: "pod/My active conditions" };
      assert.deepEqual(
        checkAbsence(
          {
            what: "x",
            coverage: "every condition",
            match: { codes: ["44054006"], after: "2030-01-01" },
            query: { tool: "ask", input: conditions },
          },
          [
            asked(conditions, {
              total: 1,
              rows: [{ condition: "T2DM 44054006", onset: "2022-01-01" }],
            }),
          ],
        ),
        stillBacked,
      );
    });
  });

  describe("given a kind of record the absence is of", () => {
    const immunizations = asked(
      { pod: "p", question: "pod/My immunizations" },
      { total: 0, rows: [] },
    );
    const askedOfImmunizations: Absence = {
      ...colonoscopy,
      query: { tool: "ask", input: immunizations.input },
    };

    it("returns `a question of another kind` when the query asked for another kind of record than the tie's `kind`", () => {
      assert.deepEqual(
        checkAbsence(askedOfImmunizations, [immunizations], {
          kind: "procedure",
          terms: ["colonoscopy"],
        }),
        { backed: false, reason: "a question of another kind" },
      );
    });

    it("takes an absence whose codes are all LOINC codes to be of lab results", () => {
      assert.deepEqual(
        checkAbsence(
          {
            ...askedOfImmunizations,
            what: "no urine albumin",
            match: { codes: ["14959-1"] },
          },
          [immunizations],
        ),
        { backed: false, reason: "a question of another kind" },
      );
    });
  });

  describe("with a tie (`tied`)", () => {
    it("returns `query found it` when a row holds one of the tie's codes, though none of the absence's own", () => {
      const labs = asked(
        { pod: "p", question: "pod/My lab results" },
        {
          total: 1,
          rows: [{ test: "FIT", code: "http://loinc.org/rdf/29771-3" }],
        },
      );
      assert.deepEqual(
        checkAbsence(
          {
            what: "no stool test",
            coverage: "every result",
            match: { terms: ["guaiac"] },
            query: { tool: "ask", input: labs.input },
          },
          [labs],
          { kind: "lab", codes: ["29771-3"] },
        ),
        found,
      );
    });
  });

  describe("given a row its source withdrew", () => {
    const pulmonaryEmbolism: Absence = {
      what: "a pulmonary embolism",
      coverage: "every record",
      match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
    };
    const history = { pod: "p", question: "pod/My medication history" };
    const withStatus = (status: string) =>
      checkAbsence(
        { ...pulmonaryEmbolism, query: { tool: "ask", input: history } },
        [
          asked(history, {
            total: 1,
            rows: [{ medication: "Pulmonary embolism", status }],
          }),
        ],
      );
    const conditions = { pod: "p", question: "pod/My condition history" };
    const withConditionStatus = (row: Record<string, string>) =>
      checkAbsence(
        { ...pulmonaryEmbolism, query: { tool: "ask", input: conditions } },
        [
          asked(conditions, {
            total: 1,
            rows: [
              {
                condition: "Pulmonary embolism",
                snomed: "http://snomed.info/id/59282003",
                onset: "2025-07-08",
                abated: "2025-07-08",
                ...row,
              },
            ],
          }),
        ],
      );

    it("ignores a row whose `status` is `entered-in-error`, `refuted` or `ruled out`", () => {
      for (const status of ["entered-in-error", "refuted", "ruled out"])
        assert.deepEqual(withStatus(status), stillBacked, status);
    });

    it("returns `query found it` for a row whose `status` is `active` or `resolved`", () => {
      assert.deepEqual(withStatus("active"), found, "active");
      assert.deepEqual(
        withConditionStatus({ status: "resolved" }),
        found,
        "resolved",
      );
    });
  });

  describe("given a compact read", () => {
    const view = (
      question: string,
      header: string,
      lines: readonly string[],
      total = lines.length,
    ) => ({
      question,
      total,
      offset: 0,
      shown: lines.length,
      text: [header, ...lines].join("\n"),
    });
    const LABS = "id\tperformed\ttest\tcode\tvalue\tunit\tstatus\tfrom";
    const a1c2023 =
      "La1c00001\t2023-03-01\tHemoglobin A1c\tloinc:4548-4\t7.1\t%\tfinal\tS1";
    const egfr2026 =
      "Lef0000001\t2026-02-16\teGFR\tloinc:98979-8\t69\tmL/min\tfinal\tS2";
    const a1c2026 =
      "La1c00002\t2026-02-16\tHemoglobin A1c\tloinc:4548-4\t6.9\t%\tfinal\tS2";
    const labs = (lines: readonly string[], total?: number) =>
      view("pod/My lab results", LABS, lines, total);
    const conditions = view(
      "pod/My condition history",
      "id\tcondition\tsnomed\tstatus\tonset\tfrom",
      [
        "Cfe000001\tPulmonary embolism\tsnomed:59282003\truled out\t2025-07-08\tS2",
        "Cd00000001\tType 2 diabetes, followed by A1c\tsnomed:44054006\tactive\t2026-03-01\tS2",
      ],
    );
    const read = { pod: "p", format: "compact" };
    const ran = (
      views: readonly object[],
      input: Readonly<Record<string, unknown>> = read,
      more = {},
    ) => [
      asked(input, {
        format: "compact",
        sources: "source\twritten by\tretrieved\nS1\tLab\t2026-05-01",
        views,
        ...more,
      }),
    ];
    const a1c: Absence = {
      what: "an A1c since 2025",
      coverage: "every lab result",
      match: { codes: ["4548-4"], terms: ["A1c"], after: "2025-01-01" },
    };
    const withoutCode: Absence = {
      ...a1c,
      match: { terms: ["A1c"], after: "2025-01-01" },
    };
    const pe: Absence = {
      what: "a pulmonary embolism",
      coverage: "every condition",
      match: { codes: ["59282003"], terms: ["pulmonary embolism"] },
    };
    const lab = { kind: "lab" } as const;
    const check = (
      absence: Absence,
      calls: ReturnType<typeof ran>,
      tied?: { kind: "lab" },
    ) =>
      checkAbsence(
        { ...absence, query: { tool: "ask", input: calls[0]!.input } },
        calls,
        tied,
      );

    it("reads each line alone, so a date on another line counts for nothing", () => {
      assert.deepEqual(
        check(a1c, ran([labs([a1c2023, egfr2026])]), lab),
        stillBacked,
      );
    });

    it("reads only the views of the absence's kind", () => {
      const calls = ran([labs([a1c2023]), conditions]);
      assert.deepEqual(check(a1c, calls, lab), stillBacked, "a lab result");
      assert.deepEqual(
        check(withoutCode, calls),
        found,
        "an absence of no kind reads the conditions view too",
      );
    });

    it("returns `query found it` for a matching line dated after the absence's day", () => {
      assert.deepEqual(check(a1c, ran([labs([a1c2023, a1c2026])]), lab), found);
    });

    it("ignores a line whose status is `entered-in-error` or `ruled out`", () => {
      assert.deepEqual(
        check(
          a1c,
          ran([labs([a1c2023, a1c2026.replace("final", "entered-in-error")])]),
          lab,
        ),
        stillBacked,
        "entered-in-error",
      );
      assert.deepEqual(
        check(pe, ran([labs([a1c2023]), conditions])),
        stillBacked,
        "ruled out",
      );
    });

    it("returns `query cut short` when a view shows fewer rows than its `total`, or fewer lines than it says it shows", () => {
      assert.deepEqual(
        check(a1c, ran([labs([a1c2023], 2)]), lab),
        cut,
        "fewer rows than its total",
      );
      assert.deepEqual(
        check(a1c, ran([{ ...labs([a1c2023]), total: 2, shown: 2 }]), lab),
        cut,
        "fewer lines than it says it shows",
      );
    });

    it("returns `query cut short` when the read goes on to a page that was not read", () => {
      assert.deepEqual(
        check(
          a1c,
          ran([conditions], read, { next: { format: "compact", offset: 2 } }),
          lab,
        ),
        cut,
        "a page with no lab results on it",
      );
      assert.deepEqual(
        check(
          pe,
          ran([labs([a1c2023]), conditions], read, {
            next: { format: "compact", offset: 3 },
          }),
        ),
        cut,
        "an absence of no kind",
      );
    });

    it("returns `query cut short` for a read of only the view entries asked for", () => {
      assert.deepEqual(
        check(
          a1c,
          ran([labs([a1c2023])], { ...read, entries: ["La1c00001"] }),
          lab,
        ),
        cut,
      );
    });

    it("returns `query found it` for a word that is also a source's short name, when it stands in a record's own text", () => {
      const reports = (conclusion: string, statuses: string) =>
        ran([
          {
            question: "pod/My reports, notes and documents",
            total: 1,
            offset: 0,
            shown: 1,
            text: `id\tname\tconclusion\tstatuses\nR0000cafe1\tCardiac exam\t${conclusion}\t${statuses}`,
          },
        ]);
      const ofWord = (term: string): Absence => ({
        what: term,
        coverage: "every report",
        match: { terms: [term] },
      });
      for (const [what, term, conclusion] of [
        [
          "S1 and S2 in a conclusion",
          "S1 and S2",
          "Normal S1 and S2, no murmur",
        ],
        ["S2 after a semicolon", "S2 is loud", "Normal S1; S2 is loud"],
        ["S2 alone at the start of a conclusion", "S2", "S2 split."],
      ] as const)
        assert.deepEqual(
          check(ofWord(term), reports(conclusion, "S1 final")),
          found,
          what,
        );
    });

    it("ignores a source's short name where it only marks which source gave a status", () => {
      const calls = ran([
        {
          question: "pod/My reports, notes and documents",
          total: 1,
          offset: 0,
          shown: 1,
          text: "id\tname\tconclusion\tstatuses\nR0000cafe1\tCardiac exam\tNo murmur\tS2 final",
        },
      ]);
      assert.deepEqual(
        check(
          { what: "S2", coverage: "every report", match: { terms: ["S2"] } },
          calls,
        ),
        stillBacked,
      );
    });
  });

  describe("given a compact read of several pages", () => {
    const LABS = "id\tperformed\ttest\tcode\tvalue\tunit\tstatus\tfrom";
    const line = (n: number, test = "eGFR", code = "98979-8") =>
      `L0000000${n}\t2026-02-1${n}\t${test}\tloinc:${code}\t6${n}\tmL/min\tfinal\tS1`;
    const page = (
      offset: number,
      lines: readonly string[],
      total: number,
      next?: number,
    ) =>
      asked(
        { pod: "p", format: "compact", ...(offset === 0 ? {} : { offset }) },
        {
          format: "compact",
          views: [
            {
              question: "pod/My lab results",
              total,
              offset,
              shown: lines.length,
              text: [LABS, ...lines].join("\n"),
            },
          ],
          ...(next === undefined
            ? {}
            : { next: { pod: "p", format: "compact", offset: next } }),
        },
      );
    const first = page(0, [line(1), line(2)], 5, 2);
    const second = page(2, [line(3), line(4)], 5, 4);
    const last = page(4, [line(5)], 5);
    const query = { tool: "ask", input: first.input };
    const ofLabs: Absence = {
      what: "an A1c",
      coverage: "every lab result",
      match: { codes: ["4548-4"], terms: ["A1c"] },
      query,
    };
    const anywhere: Absence = {
      what: "an A1c",
      coverage: "every view",
      match: { terms: ["A1c"] },
      query,
    };
    const lab = { kind: "lab" } as const;

    it("returns `backed: true` when the pages that ran hold every row of the views of the absence's kind, in whatever order they ran", () => {
      for (const [what, calls] of [
        ["every page", [first, second, last]],
        ["the pages out of order", [last, first, second]],
      ] as const)
        assert.deepEqual(checkAbsence(ofLabs, calls, lab), stillBacked, what);
    });

    it("returns `backed: true` for an absence of no kind when the pages run from the first to the one with no `next`", () => {
      assert.deepEqual(
        checkAbsence(anywhere, [first, second, last]),
        stillBacked,
      );
    });

    it("returns `query cut short` when a page is missing", () => {
      for (const [what, absence, calls, tied] of [
        ["the first page only", ofLabs, [first], lab],
        ["a gap in the middle", ofLabs, [first, last], lab],
        ["no last page", ofLabs, [first, second], lab],
        ["a gap, of no kind", anywhere, [first, last], undefined],
        ["no last page, of no kind", anywhere, [first, second], undefined],
      ] as const)
        assert.deepEqual(checkAbsence(absence, calls, tied), cut, what);
    });

    it("returns `query found it` when the match is on a later page", () => {
      const matching = page(4, [line(5, "Hemoglobin A1c", "4548-4")], 5);
      assert.deepEqual(
        checkAbsence(ofLabs, [first, second, matching], lab),
        found,
      );
    });

    it("returns `query cut short` when one of the pages belongs to another read", () => {
      const another = {
        ...last,
        input: { ...last.input, entries: ["L1"] },
      };
      assert.deepEqual(
        checkAbsence(ofLabs, [first, second, another], lab),
        cut,
      );
    });
  });
});

/**
 * A download is a file of a person's records as a hospital gave it: FHIR resources in JSON, or a C-CDA document. A
 * citation names a resource or a line of one and gives what the record there holds, field by field, and `checkCitation`
 * returns `ok: true` only when that record's own fields say so: never its reference range, a neighbouring record or the
 * day the file was updated.
 */
describe("Checking a citation of a download · checkCitation(), downloadsSource(), isoDate()", () => {
  describe("given a citation of a FHIR resource", () => {
    it("returns `ok: true` for a result's own value, unit and date, the value given as a number or as text", async () => {
      await assertVerdicts(downloads, [
        [
          "as text",
          { cite: ldl, value: "131", unit: "mg/dL", date: "2025-02-18" },
          ok,
        ],
        ["as a number", { cite: ldl, value: 131 }, ok],
      ]);
    });

    it("returns `says otherwise`, with the value in `missing`, for a value that is the reference range's or the interpretation's", async () => {
      await assertVerdicts(downloads, [
        [
          "the reference range's high end",
          { cite: ldl, value: "99" },
          otherwise("value 99"),
        ],
        ["the interpretation", { cite: ldl, value: "H" }, otherwise("value H")],
        [
          "a range written as text",
          { cite: fit, value: "Negative" },
          otherwise("value Negative"),
        ],
      ]);
    });

    it("returns `ok: true` for a coded result's text, with its code and date", async () => {
      await assertVerdicts(downloads, [
        [
          "a positive stool test",
          { cite: fit, value: "Positive", code: "29771-3", date: "2025-11-04" },
          ok,
        ],
      ]);
    });

    it("returns `says otherwise` for a date that is only when the resource was last updated", async () => {
      await assertVerdicts(downloads, [
        [
          "the day it was last updated",
          { cite: fit, date: "2025-11-20" },
          otherwise("date 2025-11-20"),
        ],
      ]);
    });

    it("returns `ok: true` for the end of a period given as `end`, and `says otherwise` for it given as `start`", async () => {
      await assertVerdicts(downloads, [
        [
          "the stop date as the start",
          { cite: metformin, date: "2024-04-15", dateKind: "start" },
          otherwise("start 2024-04-15"),
        ],
        [
          "the stop date as the end",
          {
            cite: metformin,
            date: "2024-04-15",
            dateKind: "end",
            status: "completed",
          },
          ok,
        ],
      ]);
    });

    it("returns `ok: true` for a medication's name and code and the start of its period", async () => {
      await assertVerdicts(downloads, [
        [
          "metformin",
          {
            cite: metformin,
            name: "metformin",
            code: "861007",
            date: "2022-03-01",
            dateKind: "start",
          },
          ok,
        ],
      ]);
    });

    it("returns `ok: true` for a name only as whole words of the record's name, in any case", async () => {
      await assertHolds(downloads, [
        ["a fragment of a word", { cite: patient, name: "Tam" }, false],
        [
          "a whole name in lower case",
          { cite: patient, name: "tamsin vale" },
          true,
        ],
        [
          "a whole name with the birth date",
          { cite: patient, name: "Tamsin Vale", date: "1957-09-30" },
          true,
        ],
      ]);
    });

    it("returns `ok: true` for a status exactly as the resource writes it", async () => {
      await assertVerdicts(downloads, [
        ["a refuted condition", { cite: condition, status: "refuted" }, ok],
      ]);
    });

    it("returns `says otherwise` for another status, part of a status, or the resource's `intent`", async () => {
      await assertVerdicts(downloads, [
        [
          "another status",
          { cite: condition, status: "active" },
          otherwise("status active"),
        ],
        [
          "part of a status",
          { cite: metformin, status: "ted" },
          otherwise("status ted"),
        ],
        [
          "the intent",
          { cite: order, status: "order" },
          otherwise("status order"),
        ],
      ]);
    });

    it("returns `ok: true` for a code with the system the resource names for it, and `says otherwise` with another system", async () => {
      await assertVerdicts(downloads, [
        ["LOINC, which it names", { cite: fit, code: "loinc:29771-3" }, ok],
        [
          "SNOMED, which it does not",
          { cite: fit, code: "snomed:29771-3" },
          otherwise("code snomed:29771-3"),
        ],
      ]);
    });

    it("returns `ok: true` for words quoted from a report's conclusion, a medication's dosage text or its instruction to the patient", async () => {
      await assertHolds(downloads, [
        [
          "a report's conclusion",
          { cite: report, quote: "No pulmonary embolism" },
          true,
        ],
        [
          "a request's dosage text",
          {
            cite: order,
            quote: "Take 1 tablet by mouth once daily in the morning.",
          },
          true,
        ],
        [
          "a request's instruction to the patient",
          { cite: order, quote: "Take with food." },
          true,
        ],
        [
          "a statement's dosage text",
          { cite: metformin, quote: "500 mg twice daily" },
          true,
        ],
      ]);
    });

    it("returns `says otherwise` for a quote that is other words, or part of a word", async () => {
      await assertHolds(downloads, [
        ["other words", { cite: order, quote: "Take 2 tablets daily" }, false],
        [
          "words from mid-word",
          { cite: order, quote: "ake 1 tablet by mouth" },
          false,
        ],
      ]);
    });

    it("reads a patient's gender, and whether they have died, as a value", async () => {
      await assertHolds(downloads, [
        ["female", { cite: patient, value: "female" }, true],
        ["another gender", { cite: patient, value: "male" }, false],
        ["having died", { cite: dead, value: "true" }, true],
      ]);
    });

    it("reads a patient's death as an `end`, and never as the date the citation gives without a kind", async () => {
      await assertHolds(downloads, [
        [
          "the death as an end",
          { cite: patient, date: "2024-03-04", dateKind: "end" },
          true,
        ],
        [
          "the death as a birth date",
          { cite: patient, date: "2024-03-04" },
          false,
        ],
      ]);
    });
  });

  describe("given a citation of a line of a file", () => {
    it("returns `ok: true` for the id, code and date of the C-CDA record the line is in", async () => {
      await assertVerdicts(downloads, [
        [
          "a vaccine",
          {
            cite: summary(9),
            id: "VX-251108-2",
            code: "187",
            date: "2025-11-08",
          },
          ok,
        ],
      ]);
    });

    it("returns `ok: true` for a result in a panel, cited by any line of that result", async () => {
      await assertVerdicts(downloads, [
        [
          "a thyroid result",
          {
            cite: summary(27),
            value: "7.9",
            unit: "m[IU]/L",
            date: "2026-03-03",
          },
          ok,
        ],
      ]);
    });

    it("returns `says otherwise` for the low end of the reference range", async () => {
      await assertVerdicts(downloads, [
        ["0.40", { cite: summary(29), value: "0.40" }, otherwise("value 0.40")],
      ]);
    });

    it("returns `not at that line`, with the first line of the record that does say it in `foundAt`, for a neighbouring record's value", async () => {
      await assertVerdicts(downloads, [
        [
          "the next result in the same panel",
          { cite: summary(29), value: "1.0", code: "3024-7" },
          {
            ok: false,
            reason: "not at that line",
            missing: ["value 1.0", "code 3024-7"],
            foundAt: [34],
          },
        ],
        [
          "the next JSON resource",
          {
            cite: { file: "bundle.json", line: 34 },
            value: "7.1",
            date: "2025-08-18",
          },
          {
            ok: false,
            reason: "not at that line",
            missing: ["value 7.1", "date 2025-08-18"],
            foundAt: [7],
          },
        ],
      ]);
    });

    it("returns `ok: true` for words quoted from the narrative line cited", async () => {
      await assertVerdicts(downloads, [
        [
          "a discharge instruction",
          { cite: summary(47), quote: "repeated in 6-8 weeks" },
          ok,
        ],
      ]);
    });

    it("returns `ok: true` for a code with the system its OID names, and `says otherwise` with another system", async () => {
      await assertVerdicts(downloads, [
        ["CVX, which its OID names", { cite: summary(9), code: "cvx:187" }, ok],
        [
          "LOINC, which it does not",
          { cite: summary(9), code: "loinc:187" },
          otherwise("code loinc:187"),
        ],
      ]);
    });

    it("takes a C-CDA record's own author time as its recorded date", async () => {
      await assertVerdicts(downloads, [
        [
          "a result's author time",
          { cite: summary(29), date: "2026-03-04", dateKind: "recorded" },
          ok,
        ],
      ]);
    });

    it("takes the document's author time as the recorded date of a record or a narrative line that has none", async () => {
      await assertVerdicts(downloads, [
        [
          "a record with no author",
          { cite: summary(39), date: "2026-03-10", dateKind: "recorded" },
          ok,
        ],
        [
          "a narrative line",
          { cite: summary(47), date: "2026-03-10", dateKind: "recorded" },
          ok,
        ],
      ]);
    });

    it("returns `says otherwise` for a recorded date the document does not state", async () => {
      await assertVerdicts(downloads, [
        [
          "a day nothing was written",
          { cite: summary(39), date: "2026-03-03", dateKind: "recorded" },
          otherwise("recorded 2026-03-03"),
        ],
      ]);
    });

    it('takes a date that follows "reported", "recorded" or "documented" in a narrative line as its recorded date', async () => {
      await assertHolds(
        downloads,
        (
          [
            ["reported, the day written in words", 6],
            ["recorded", 7],
            ["documented", 8],
          ] as const
        ).map(([what, line]) => [
          what,
          { cite: recorded(line), date: "2026-05-14", dateKind: "recorded" },
          true,
        ]),
      );
    });

    it('takes no recorded date from a date that follows "started", a negated word, or a longer word that ends in one of them', async () => {
      await assertHolds(
        downloads,
        (
          [
            ["started", 9],
            ["unreported", 10],
            ["not documented", 11],
            ["never recorded", 12],
            ["misreported", 13],
          ] as const
        ).map(([what, line]) => [
          what,
          { cite: recorded(line), date: "2026-05-14", dateKind: "recorded" },
          false,
        ]),
      );
    });
  });

  describe("given a citation with nothing to find", () => {
    it("returns `nothing to check` for a citation that gives no field, or a unit with no value", async () => {
      const nothing = { ok: false, reason: "nothing to check", missing: [] };
      await assertVerdicts(downloads, [
        ["no field", { cite: ldl }, nothing],
        ["a unit alone", { cite: ldl, unit: "mg/dL" }, nothing],
      ]);
    });

    it("returns `no such record` for a resource the file does not hold, or a line past its end", async () => {
      const missing = { ok: false, reason: "no such record", missing: [] };
      await assertVerdicts(downloads, [
        [
          "a resource there is not",
          {
            cite: { file: "bundle.json", resource: "Procedure/colonoscopy-1" },
            value: "normal",
          },
          missing,
        ],
        ["a line past the end", { cite: summary(400), value: "7.9" }, missing],
      ]);
    });
  });

  describe("isoDate(written)", () => {
    it("returns the day, as YYYY-MM-DD, of a time written in digits, as a C-CDA document writes one", () => {
      assert.equal(isoDate("20250219120000"), "2025-02-19");
    });

    it("returns undefined for digits or a date that is no calendar day", () => {
      for (const written of ["44054006", "20250230", "2025-13-01"])
        assert.equal(isoDate(written), undefined, written);
    });
  });
});

/**
 * A reply recorded before facts named a field cites a view entry and copies what it says. `podRowsSource` reads the
 * cited view entry, or the person by the subject's IRI, from the pod's rows, so `checkCitation` holds such a reply to
 * the pod as it holds one to a download.
 * @rule runtime/currency.feature C9
 */
describe("Checking a citation of a view entry · checkCitation(), podRowsSource()", () => {
  const rowsOf = (
    rows: Record<string, readonly { field: string; value: string }[]>,
  ) => podRowsSource(async (entry) => rows[entry]);
  const results = rowsOf({
    [LDL]: [
      { field: "cascade:testName", value: "LDL cholesterol" },
      { field: "cascade:testCode", value: "http://loinc.org/rdf/13457-7" },
      { field: "cascade:resultValue", value: "131" },
      { field: "cascade:resultUnit", value: "mg/dL" },
      { field: "cascade:referenceRange", value: "<=99 mg/dL" },
      {
        field: "cascade:resultClinicallyRelevantTime",
        value: "2025-02-18T16:00:00Z",
      },
    ],
  });
  const lisinopril = "pod://p/clinical/medications.ttl#lisinopril";
  const colonoscopy = "pod://p/clinical/procedures.ttl#colonoscopy";
  const tsh = "pod://p/clinical/lab-results.ttl#tsh";
  const variant = "pod://p/genetics.ttl#v1";
  const refuted = "pod://p/clinical/conditions.ttl#pe";
  const texts = rowsOf({
    [lisinopril]: [
      { field: `${NS}drugName`, value: "lisinopril 10 MG Oral Tablet" },
      { field: `${NS}dosage`, value: "1 tablet by mouth every morning" },
    ],
    [colonoscopy]: [
      { field: `${NS}procedureName`, value: "Colonoscopy" },
      { field: `${NS}narrativeText`, value: "Normal; repeat in 10 years." },
    ],
    [tsh]: [
      { field: `${NS}testName`, value: "TSH" },
      {
        field: `${NS}narrativeText`,
        value: "TSH\n2.1 mIU/L\nhistorical result",
      },
    ],
    [variant]: [
      {
        field: `${NS}hgvsCodingDnaExpression`,
        value: "NM_000249.3:c.2042C>T",
      },
    ],
    [refuted]: [
      { field: `${NS}conditionName`, value: "Pulmonary embolism" },
      { field: `${NS}clinicalStatus`, value: "resolved" },
      { field: `${NS}verificationStatus`, value: "refuted" },
    ],
  });
  const person = podRowsSource(
    async (entry) =>
      entry === REPORT
        ? [
            {
              field: `${NS}reportName`,
              value: "CT angiography chest (pulmonary embolism protocol)",
            },
            { field: `${NS}reportCode`, value: "http://loinc.org/rdf/24627-2" },
            {
              field: `${NS}reportEffectiveTime`,
              value: "2025-07-08T22:30:00Z",
            },
            { field: `${NS}reportIssuedTime`, value: "2025-07-08T23:05:00Z" },
            { field: `${NS}workflowStatus`, value: "final" },
            {
              field: `${NS}reportConclusion`,
              value:
                "No pulmonary embolism. Lungs are clear. Mild degenerative changes of the thoracic spine.",
            },
          ]
        : undefined,
    async () => [
      {
        subject: PERSON,
        subjectLabel: "The person this pod is about",
        dateOfBirth: "urn:uuid:04cd6e3f-922b-8f2d-ad65-81a0a7842efc 1957-09-30",
        dateOfDeath: "urn:uuid:04cd6e3f-922b-8f2d-ad65-81a0a7842efc 2024-03-04",
        administrativeGender:
          "urn:uuid:04cd6e3f-922b-8f2d-ad65-81a0a7842efc female",
      },
    ],
  );
  const codes = podRowsSource(async () => [
    {
      field: "cascade:rxNormCode",
      value: "https://ns.cascadeprotocol.org/codes/rxnorm/199903",
    },
    { field: "cascade:snomedCode", value: "http://snomed.info/id/59282003" },
    { field: "cascade:testCode", value: "https://loinc.org/rdf/4548-4" },
  ]);
  const onReport = { entry: REPORT };

  it("returns `ok: true` for a view entry's own result and date", async () => {
    await assertVerdicts(results, [
      [
        "a lab result",
        { cite: { entry: LDL }, value: "131", date: "2025-02-18" },
        ok,
      ],
    ]);
  });

  it("returns `says otherwise` for a value that is its reference range's", async () => {
    await assertVerdicts(results, [
      [
        "the range's high end",
        { cite: { entry: LDL }, value: "99" },
        otherwise("value 99"),
      ],
    ]);
  });

  /** The citations of a code of each of the examples, which `held` says the source holds or does not. */
  const ofCodes = (
    held: boolean,
    ...examples: string[]
  ): [string, Citation, boolean][] =>
    examples.map((code) => [code, { cite: { entry: "e" }, code }, held]);

  it("returns `ok: true` for a code with the system its IRI belongs to, whichever of the vocabulary's namespaces writes it", async () => {
    await assertHolds(
      codes,
      ofCodes(true, "rxnorm:199903", "snomed:59282003", "loinc:4548-4"),
    );
    await assertHolds(results, [
      [
        "a system written in capitals",
        { cite: { entry: LDL }, code: "LOINC:13457-7" },
        true,
      ],
    ]);
  });

  it("returns `says otherwise` for a code with another system", async () => {
    await assertHolds(
      codes,
      ofCodes(false, "snomed:199903", "rxnorm:59282003", "loinc:59282003"),
    );
    await assertVerdicts(results, [
      [
        "a LOINC code with SNOMED as its system",
        { cite: { entry: LDL }, code: "snomed:13457-7" },
        otherwise("code snomed:13457-7"),
      ],
    ]);
  });

  it("reads a gene variant's coding expression as a code, never as a name", async () => {
    await assertHolds(texts, [
      [
        "as a code",
        { cite: { entry: variant }, code: "NM_000249.3:c.2042C>T" },
        true,
      ],
      ["as a name", { cite: { entry: variant }, name: "c.2" }, false],
    ]);
  });

  it("returns `ok: true` for a report's name, code and date, and for its issue time as its recorded date", async () => {
    await assertHolds(person, [
      [
        "name, code, date and words",
        {
          cite: onReport,
          name: "CT angiography chest",
          code: "24627-2",
          date: "2025-07-08",
          quote: "No pulmonary embolism. Lungs are clear.",
        },
        true,
      ],
      [
        "the issue time",
        { cite: onReport, date: "2025-07-08", dateKind: "recorded" },
        true,
      ],
    ]);
  });

  it("returns `ok: true` for words quoted from a report's conclusion, a medication's dosage or the text a source wrote, across its line breaks", async () => {
    await assertHolds(person, [
      [
        "a report's conclusion",
        { cite: onReport, quote: "No pulmonary embolism. Lungs are clear." },
        true,
      ],
    ]);
    await assertHolds(texts, [
      [
        "a medication's dosage",
        {
          cite: { entry: lisinopril },
          quote: "1 tablet by mouth every morning",
        },
        true,
      ],
      [
        "the finding beside a procedure",
        { cite: { entry: colonoscopy }, quote: "repeat in 10 years" },
        true,
      ],
      [
        "a label across the lines of a lab result's text",
        { cite: { entry: tsh }, quote: "2.1 mIU/L historical result" },
        true,
      ],
    ]);
  });

  it("returns `ok: false` for a quote that is other words", async () => {
    await assertHolds(person, [
      [
        "a report's conclusion",
        { cite: onReport, quote: "A large pulmonary embolism" },
        false,
      ],
    ]);
    await assertHolds(texts, [
      [
        "a medication's dosage",
        {
          cite: { entry: lisinopril },
          quote: "2 tablets by mouth every night",
        },
        false,
      ],
      [
        "the finding beside a procedure",
        { cite: { entry: colonoscopy }, quote: "repeat in 5 years" },
        false,
      ],
    ]);
  });

  it("returns `ok: true` for a quote or a name only as whole words, in any case and spacing", async () => {
    await assertHolds(person, [
      [
        "a quote from mid-word to mid-word",
        { cite: onReport, quote: "m. Lungs are cl" },
        false,
      ],
      [
        "a quote that starts mid-word",
        { cite: onReport, quote: "ungs are clear" },
        false,
      ],
      [
        "a quote of whole words",
        { cite: onReport, quote: "lungs  ARE clear." },
        true,
      ],
      ["a name that is a fragment", { cite: onReport, name: "pulm" }, false],
      [
        "a name that starts mid-word",
        { cite: onReport, name: "ulmonary" },
        false,
      ],
      [
        "a name of whole words",
        { cite: onReport, name: "pulmonary embolism" },
        true,
      ],
    ]);
  });

  it("reads the person, cited by the subject's IRI: a birth date, a gender as a value, a death as an `end`", async () => {
    const onPerson = { entry: PERSON };
    await assertHolds(person, [
      ["a birth date", { cite: onPerson, date: "1957-09-30" }, true],
      ["a gender", { cite: onPerson, value: "female" }, true],
      [
        "a death",
        { cite: onPerson, date: "2024-03-04", dateKind: "end" },
        true,
      ],
    ]);
  });

  it("returns `ok: false` for another birth date, another gender, the death given as a birth date, or an IRI that is not the subject's", async () => {
    const onPerson = { entry: PERSON };
    await assertHolds(person, [
      ["another birth date", { cite: onPerson, date: "1957-09-29" }, false],
      ["another gender", { cite: onPerson, value: "male" }, false],
      [
        "the death as a birth date",
        { cite: onPerson, date: "2024-03-04" },
        false,
      ],
      [
        "an IRI that is not the subject's",
        { cite: { entry: "urn:uuid:other" }, date: "1957-09-30" },
        false,
      ],
    ]);
  });

  it("returns `ok: true` for `ruled out` or `refuted` of a condition its source refutes, and never for `resolved`", async () => {
    const onCondition = { entry: refuted };
    await assertHolds(
      texts,
      (
        [
          ["ruled out", true],
          ["ruled-out", true],
          ["refuted", true],
          ["resolved", false],
          ["active", false],
        ] as const
      ).map(([status, held]) => [status, { cite: onCondition, status }, held]),
    );
  });
});

/**
 * For a reply about downloads, an absence names the files that were looked through in place of a tool call.
 * `checkRecordsAbsence` backs it only when those are all the files that could hold it, each was read, and no record in
 * them matches.
 */
describe("Checking what a reply says downloads lack · checkRecordsAbsence()", () => {
  const text = (file: string) => readFile(`${FOLDER}${file}`, "utf8");
  const both = ["bundle.json", "summary.xml"];
  const colonoscopy: Absence = {
    what: "a colonoscopy",
    coverage: "both documents",
    match: { terms: ["colonoscopy"], codes: ["73761001"] },
    sources: both,
  };
  const stoolTest: Absence = {
    what: "no stool test",
    coverage: "every document",
    match: { terms: ["guaiac"] },
  };
  const holdsIt = (file: string) => ({
    backed: false,
    reason: `records hold it: ${file}`,
  });
  const inFolder = (absence: Absence, read: readonly string[] = both) =>
    checkRecordsAbsence(absence, { files: both, read, text });

  /** One document, `b`, read whole: the absence is of `terms` and `codes`, and after the day when one is given. */
  const inRecords = (
    after: string | undefined,
    terms: string[],
    doc: string,
    codes: string[] = [],
  ) =>
    checkRecordsAbsence(
      {
        what: "x",
        coverage: "every record",
        match: { codes, terms, ...(after === undefined ? {} : { after }) },
      },
      { files: ["b"], read: ["b"], text: async () => doc },
    );
  const observation = (fields: Record<string, unknown>) => ({
    resourceType: "Observation",
    id: "o",
    code: { coding: [{ code: "4548-4" }], text: "Hemoglobin A1c" },
    effectiveDateTime: "2026-02-16",
    ...fields,
  });
  /** A bundle of the resources and always a patient born 2026-03-01: a JSON document misread as XML has no records, so its latest date, that birth date, would be taken. */
  const bundle = (...resources: unknown[]) =>
    JSON.stringify({
      resourceType: "Bundle",
      entry: [
        ...resources.map((resource) => ({ resource })),
        {
          resource: {
            resourceType: "Patient",
            id: "pt",
            birthDate: "2026-03-01",
          },
        },
      ],
    });
  const ccda = (...inside: string[]) =>
    `<ClinicalDocument><component><structuredBody><component><section>${inside.join("")}</section></component></structuredBody></component></ClinicalDocument>`;
  const ccdaObservation = (attributes: string, ...parts: string[]) =>
    ccda(
      `<entry><observation classCode="OBS" moodCode="EVN"${attributes}>${parts.join("")}</observation></entry>`,
    );
  const narrativeRow = (cells: string) =>
    ccda(`<text><table><tbody><tr>${cells}</tr></tbody></table></text>`);
  const paragraph = (line: string) =>
    ccda(`<text><paragraph>${line}</paragraph></text>`);
  const pulmonaryEmbolism = (verification: string) =>
    bundle({
      resourceType: "Condition",
      id: "pe",
      verificationStatus: { coding: [{ code: verification }] },
      code: { coding: [{ code: "59282003" }], text: "Pulmonary embolism" },
      onsetDateTime: "2025-07-08",
    });
  const THE_DAYS: (string | undefined)[] = [undefined, "2025-01-01"];

  describe("checkRecordsAbsence(absence, { files, read, text })", () => {
    it("returns `backed: true` when the absence names every file, each was read and none holds a match", async () => {
      assert.deepEqual(await inFolder(colonoscopy), { backed: true });
    });

    it("returns `source not read`, naming the file, for a named file that was not read", async () => {
      assert.deepEqual(await inFolder(colonoscopy, ["bundle.json"]), {
        backed: false,
        reason: "source not read: summary.xml",
      });
    });

    it("returns `sources leave out`, naming the files, when the absence's `sources` miss a file", async () => {
      assert.deepEqual(await inFolder({ ...colonoscopy, sources: [] }), {
        backed: false,
        reason: "sources leave out: bundle.json, summary.xml",
      });
      assert.deepEqual(
        await inFolder({ ...stoolTest, sources: ["summary.xml"] }),
        { backed: false, reason: "sources leave out: bundle.json" },
      );
    });

    it("takes an absence that names no `sources` to name every file", async () => {
      assert.deepEqual(await inFolder(stoolTest), { backed: true });
    });

    it("returns `records hold it`, naming the file, when a record holds one of the absence's codes or words", async () => {
      assert.deepEqual(
        await inFolder({
          ...colonoscopy,
          match: { terms: ["pulmonary embolism"] },
        }),
        holdsIt("bundle.json"),
      );
    });
  });

  describe("with a tie (`tied`)", () => {
    it("returns `records hold it` when a record holds one of the tie's codes, though none of the absence's own", async () => {
      assert.deepEqual(
        await checkRecordsAbsence(
          stoolTest,
          { files: both, read: both, text },
          { codes: ["29771-3"] },
        ),
        holdsIt("bundle.json"),
      );
    });
  });

  describe("given an absence after a day (`match.after`)", () => {
    const a1cAfter = (after: string): Absence => ({
      ...colonoscopy,
      match: { codes: ["4548-4"], after },
    });

    it("ignores a matching record dated before that day, and returns `records hold it` for one dated after it", async () => {
      assert.deepEqual(
        await inFolder(a1cAfter("2025-08-19")),
        { backed: true },
        "before the day",
      );
      assert.deepEqual(
        await inFolder(a1cAfter("2025-08-01")),
        holdsIt("bundle.json"),
        "after the day",
      );
    });

    it("ignores when a record was written or updated: FHIR `meta.lastUpdated`, a C-CDA author's time", async () => {
      const written = '<author><time value="20261015"/></author>';
      const a1cOn = (author: string) =>
        ccdaObservation(
          "",
          '<code code="4548-4"/><effectiveTime value="20260216"/>',
          author,
        );
      assert.deepEqual(
        await inRecords(
          "2026-02-17",
          [],
          bundle(
            observation({ meta: { lastUpdated: "2026-10-15T16:00:00Z" } }),
          ),
          ["4548-4"],
        ),
        { backed: true },
        "FHIR lastUpdated",
      );
      assert.deepEqual(
        await inRecords("2026-02-17", [], a1cOn(written), ["4548-4"]),
        { backed: true },
        "a C-CDA author's time",
      );
      assert.deepEqual(
        await inRecords("2026-02-01", [], a1cOn(written), ["4548-4"]),
        holdsIt("b"),
        "the same record, found when its own day is after the day",
      );
    });

    it("returns `records hold it` for a narrative row dated in words on that day, and ignores one dated the day before", async () => {
      const row = narrativeRow(
        "<td>Hemoglobin A1c 4548-4</td><td>February 16, 2026</td>",
      );
      assert.deepEqual(
        await inRecords("2026-02-16", [], row, ["4548-4"]),
        holdsIt("b"),
        "after the day before",
      );
      assert.deepEqual(
        await inRecords("2026-02-17", [], row, ["4548-4"]),
        { backed: true },
        "after the day itself",
      );
    });

    it("takes a partial date, a year or a year and month, to be the whole period it names", async () => {
      const period = (value: string) =>
        ccdaObservation(
          "",
          `<code code="4548-4"/><effectiveTime value="${value}"/>`,
        );
      const fhirMonth = bundle(observation({ effectiveDateTime: "2025-07" }));
      for (const [what, doc, after, backed] of [
        ["2025", period("2025"), "2026-01-01", true],
        ["2025", period("2025"), "2025-12-31", false],
        ["202507", period("202507"), "2025-08-01", true],
        ["202507", period("202507"), "2025-07-31", false],
        ["FHIR 2025-07", fhirMonth, "2025-08-01", true],
        ["FHIR 2025-07", fhirMonth, "2025-07-15", false],
      ] as const)
        assert.deepEqual(
          await inRecords(after, [], doc, ["4548-4"]),
          backed ? { backed: true } : holdsIt("b"),
          `${what} after ${after}`,
        );
    });

    it("reads no partial date in a quantity's value or inside a longer number", async () => {
      assert.deepEqual(
        await inRecords(
          "2026-01-01",
          [],
          ccdaObservation(
            "",
            '<code code="4548-4"/><effectiveTime value="20200101"/><value xsi:type="PQ" value="2050" unit="mg"/>',
          ),
          ["4548-4"],
        ),
        { backed: true },
        "a quantity's value",
      );
      assert.deepEqual(
        await inRecords(
          "2026-01-01",
          [],
          narrativeRow(
            "<td>Hemoglobin A1c 4548-4 lot 1000-2050-12</td><td>January 5, 2025</td>",
          ),
          ["4548-4"],
        ),
        { backed: true },
        "a lot number",
      );
    });

    it("reads no date in a code that is a long number", async () => {
      const diabetes = (onset: string) =>
        bundle({
          resourceType: "Condition",
          id: "c",
          code: { coding: [{ code: "44054006" }], text: "Type 2 diabetes" },
          onsetDateTime: onset,
        });
      assert.deepEqual(
        await inRecords("2030-01-01", [], diabetes("2022-01-01"), ["44054006"]),
        { backed: true },
        "after 2030",
      );
      assert.deepEqual(
        await inRecords("2020-01-01", [], diabetes("2022-01-01"), ["44054006"]),
        holdsIt("b"),
        "after 2020",
      );
    });
  });

  describe("given a record its source withdrew", () => {
    const ofPulmonaryEmbolism = ["pulmonary embolism"];

    it("ignores a FHIR condition that is `refuted` or `entered-in-error`, with or without a day", async () => {
      for (const status of ["refuted", "entered-in-error"])
        for (const after of THE_DAYS)
          assert.deepEqual(
            await inRecords(
              after,
              ofPulmonaryEmbolism,
              pulmonaryEmbolism(status),
              ["59282003"],
            ),
            { backed: true },
            `${status}, after ${after}`,
          );
    });

    it("returns `records hold it` for a `confirmed` one", async () => {
      for (const after of THE_DAYS)
        assert.deepEqual(
          await inRecords(
            after,
            ofPulmonaryEmbolism,
            pulmonaryEmbolism("confirmed"),
            ["59282003"],
          ),
          holdsIt("b"),
          `after ${after}`,
        );
    });

    it("ignores a C-CDA record that is negated or nullified, with or without a day", async () => {
      const pe = (attributes: string, status: string) =>
        ccdaObservation(
          attributes,
          `<code code="59282003" displayName="Pulmonary embolism"/>${status}<effectiveTime value="20250708"/>`,
        );
      const completed = '<statusCode code="completed"/>';
      const live = pe("", completed);
      for (const after of THE_DAYS) {
        assert.deepEqual(
          await inRecords(after, ofPulmonaryEmbolism, live, ["59282003"]),
          holdsIt("b"),
          `a live record, after ${after}`,
        );
        for (const [what, doc] of [
          ["negated", pe(' negationInd="true"', completed)],
          ["nullified", pe("", '<statusCode code="nullified"/>')],
        ] as const)
          assert.deepEqual(
            await inRecords(after, ofPulmonaryEmbolism, doc, ["59282003"]),
            { backed: true },
            `${what}, after ${after}`,
          );
      }
    });

    it("ignores a narrative row that says it was entered in error, even after a cell or a clause that says no", async () => {
      const row = (status: string, cells = "") =>
        narrativeRow(
          `<td>Hives</td>${cells}<td>${status}</td><td>July 8, 2025</td>`,
        );
      for (const after of THE_DAYS) {
        assert.deepEqual(
          await inRecords(
            after,
            ofPulmonaryEmbolism,
            narrativeRow(
              "<td>Pulmonary embolism</td><td>active</td><td>July 8, 2025</td>",
            ),
          ),
          holdsIt("b"),
          `a live row, after ${after}`,
        );
        assert.deepEqual(
          await inRecords(
            after,
            ofPulmonaryEmbolism,
            narrativeRow(
              "<td>Pulmonary embolism</td><td>entered in error</td><td>July 8, 2025</td>",
            ),
          ),
          { backed: true },
          `entered in error, after ${after}`,
        );
      }
      for (const [what, doc] of [
        [
          "a cell that says no before it",
          row("Entered in error", "<td>No</td>"),
        ],
        ["a clause of not applicable", row("Not applicable; entered in error")],
        [
          "a clause of no known allergy",
          row("No known allergy. Entered in error"),
        ],
        ["a cell that says yes", row("Entered in error: Yes")],
      ] as const)
        assert.deepEqual(
          await inRecords(undefined, ["hives"], doc),
          { backed: true },
          what,
        );
    });

    it("returns `records hold it` for a narrative row that denies being entered in error, however it is worded", async () => {
      const row = (status: string, name = "Hives") =>
        narrativeRow(`<td>${name}</td><td>${status}</td><td>July 8, 2025</td>`);
      for (const status of [
        "Not entered in error",
        "Entered in error: none",
        "Entered in error: no",
      ])
        assert.deepEqual(
          await inRecords(
            undefined,
            ofPulmonaryEmbolism,
            row(status, "Pulmonary embolism"),
          ),
          holdsIt("b"),
          status,
        );
      for (const status of [
        "Has not been entered in error",
        "Not marked as entered in error",
        "No longer entered in error",
        "Entered in error? No",
        "Entered in error - no",
        "Entered in error (none)",
        "Entered in error: not",
      ])
        assert.deepEqual(
          await inRecords(undefined, ["hives"], row(status)),
          holdsIt("b"),
          status,
        );
    });

    it("ignores a narrative line that says a condition was ruled out", async () => {
      for (const line of [
        "Pulmonary embolism was ruled out by CT",
        "Pulmonary embolism ruled out",
        "Pulmonary embolism has been ruled out",
        "On May 3, 2025, PE was ruled out by CTA",
        "May 2025: pulmonary embolism ruled out",
        "CTA obtained to rule out PE, PE ruled out",
        "Chest pain thought to be musculoskeletal, PE ruled out",
        "Patient unable to walk far, PE ruled out by CTA",
        "No acute distress, PE ruled out",
      ])
        assert.deepEqual(
          await inRecords(
            undefined,
            ["pulmonary embolism", "PE"],
            paragraph(line),
          ),
          { backed: true },
          line,
        );
    });

    it("returns `records hold it` for a line that says it was not ruled out, or has yet to be", async () => {
      for (const line of [
        "Pulmonary embolism could not be ruled out",
        "Pulmonary embolism not yet ruled out",
        "Pulmonary embolism hasn't been ruled out",
        "Pulmonary embolism has not been ruled out",
        "Pulmonary embolism should be ruled out",
        "Pulmonary embolism must be ruled out",
        "Pulmonary embolism needs to be ruled out",
        "Pulmonary embolism: to rule out",
        "Pulmonary embolism not ruled out; to be ruled out",
      ])
        assert.deepEqual(
          await inRecords(
            undefined,
            ["pulmonary embolism", "PE"],
            paragraph(line),
          ),
          holdsIt("b"),
          line,
        );
    });
  });

  describe("given a JSON download that begins with a newline or a byte-order mark", () => {
    it("reads it as JSON", async () => {
      const doc = bundle(observation({}));
      for (const [what, written] of [
        ["a newline", `\n${doc}`],
        ["a byte-order mark", String.fromCharCode(0xfeff) + doc],
      ] as const)
        assert.deepEqual(
          await inRecords("2026-02-17", [], written, ["4548-4"]),
          { backed: true },
          what,
        );
    });
  });
});
