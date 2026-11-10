import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkReply,
  type CheckedFact,
  downloadsSource,
  type PodAsker,
  replyErrors,
  replySchema,
  type Ran,
  recordsReplySchema,
  type Source,
} from "cascade-runtime";
import { checkCopiedReply } from "cascade-runtime/copied-reply";
import { readConfig, resolveVocabulary } from "@cascade-runtime/runtime/node";
// The package exports neither: they exist to be held to the vocabulary, which is what the last two leaves do.
import { POD_FIELDS, POD_NOT_CHECKABLE } from "../src/citations.js";

const read = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../test/fixtures/reply/${name}`, import.meta.url),
      ),
      "utf8",
    ),
  );

// The reply is a model's answer in a recorded eval run (history/2026-11-03-1822d32-custom), with the calls it ran, its
// facts re-pointed by hand to the contract in which a fact names an entry and a field and copies nothing.
const reply = read("blood-clot.json");
const ran = read("blood-clot.calls.json") as Ran[];

const NS = "https://ns.cascadeprotocol.org/cascade#";
const LOINC = "http://loinc.org/rdf/";
const MEMBER = "urn:uuid:1889f959-6178-8833-9850-96a22a25cc04";
const entry = (file: string, start: string) =>
  `pod://p/clinical/${file}.ttl#${start.padEnd(64, "0")}`;
const REPORT = entry(
  "reports",
  "de64c5136ee1f407e99705e33b2f3ecd40608a404c14e75d22a432798cce2d89",
);
const PROCEDURE = entry("procedures", "7eb7ac1d");
const CONDITION = entry("conditions", "9f080aa6");
const LAB = entry("lab-results", "41e35923");

const shown = (
  which: string,
  fields: [string, string][],
  from = "urn:uuid:other",
) =>
  fields.map(([field, value]) => ({
    entry: which,
    field: NS + field,
    value,
    from,
  }));

const WHAT_IT_SHOWS = [
  ...shown(
    REPORT,
    [
      ["reportName", "CT angiography chest (pulmonary embolism protocol)"],
      ["reportCode", `${LOINC}24627-2`],
      ["workflowStatus", "final"],
      ["reportEffectiveTime", "2025-07-08T22:30:00Z"],
      [
        "reportConclusion",
        "No pulmonary embolism. Lungs are clear. No pleural or pericardial effusion. Mild degenerative changes of the thoracic spine.",
      ],
    ],
    MEMBER,
  ),
  ...shown(PROCEDURE, [
    ["procedureName", "CT angiography of the chest"],
    ["workflowStatus", "completed"],
    ["procedureDate", "2025-07-08"],
  ]),
  ...shown(CONDITION, [
    ["conditionName", "Pulmonary embolism"],
    ["snomedCode", "http://snomed.info/id/59282003"],
    ["verificationStatus", "refuted"],
    ["onsetDate", "2025-07-08"],
  ]),
  ...shown(LAB, [
    ["testName", "D-dimer"],
    ["testCode", `${LOINC}48065-7`],
    ["resultValue", "0.92"],
    ["resultUnit", "mg/L{FEU}"],
    ["workflowStatus", "final"],
    ["resultClinicallyRelevantTime", "2025-07-08T09:00:00Z"],
  ]),
];

const ask = async (question: string) =>
  question === "entry/What it shows" ? WHAT_IT_SHOWS : [];

// Priya's pod (the eval case priya-natarajan), cut to the rows the checker reads of her and of two view entries, with one
// provenance row per document so its sources are named as a whole read of her pod names them: her hemoglobin A1c of
// 2025-09-22, which came from both her clinic (S3, Fernhill Family Clinic) and the lab (S12, Northbay Clinical
// Laboratories), and a plan of care note two records state, each with its own date.
const priya = read("priya.pod.json") as Record<
  string,
  Readonly<Record<string, string>>[]
>;
const askPriya = async (question: string) => priya[question] ?? [];
const POD = "pod://62c61be2-abd9-4485-b614-87ee83666495/clinical";
const HBA1C = "Lcd05f84f";
const NOTE = "Nfcb7c333";
const PERSON = "urn:uuid:a6a69b65-6745-4520-b1cd-fc8321062ab3";

/** The reply of one item resting on the facts. */
const replyOf = (...facts: Record<string, unknown>[]) => ({
  answer: "…",
  short: "…",
  items: [{ says: "…", why: "…", confidence: "high", facts }],
});

/** The facts checked against the pod that `asking` reads; none breaks the contract. */
const pointedIn = async (
  asking: PodAsker["ask"],
  ...facts: Record<string, unknown>[]
) => {
  const checked = await checkReply(replyOf(...facts), {
    ask: asking,
    ran: [],
  });
  assert.deepEqual(checked.errors, []);
  return checked.items[0]!.facts;
};
const pointed = (...facts: Record<string, unknown>[]) =>
  pointedIn(askPriya, ...facts);
const fact = (entry: string, field: string, more = {}) => ({
  says: "…",
  cite: { entry },
  field,
  ...more,
});
const reasons = (facts: readonly CheckedFact[]) =>
  facts.map(({ verdict }) =>
    verdict.ok ? "ok" : `${verdict.reason}: ${verdict.missing.join(", ")}`,
  );
const A1C_LABEL = "Hemoglobin A1c/Hemoglobin.total in Blood";

/** Each place a schema uses what a provider's structured output does not take; a map of schemas by name is no schema. */
function beyondStructuredOutput(
  schema: unknown,
  at = "",
  map = false,
): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  if (Array.isArray(schema))
    return schema.flatMap((it, i) => beyondStructuredOutput(it, `${at}/${i}`));
  const it = schema as Record<string, unknown>;
  if (map)
    return Object.entries(it).flatMap(([name, value]) =>
      beyondStructuredOutput(value, `${at}/${name}`),
    );
  const found = [
    "$schema",
    "oneOf",
    "not",
    "if",
    "dependentRequired",
    "dependentSchemas",
    "pattern",
    "patternProperties",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "maxItems",
    "minProperties",
    "maxProperties",
    "uniqueItems",
  ]
    .filter((word) => word in it)
    .map((word) => `${at} ${word}`);
  if (typeof it.minItems === "number" && it.minItems > 1)
    found.push(`${at} minItems ${it.minItems}`);
  if (Array.isArray(it.type)) found.push(`${at} type ${String(it.type)}`);
  if (it.type === "object" && it.additionalProperties !== false)
    found.push(`${at} open object`);
  return [
    ...found,
    ...Object.entries(it).flatMap(([key, value]) =>
      key === "enum"
        ? []
        : beyondStructuredOutput(
            value,
            `${at}/${key}`,
            key === "properties" || key === "$defs",
          ),
    ),
  ];
}

/** Nodes the views construct beside the view entry, which the entry question leaves out; they are not fields. */
const APART = new Set([
  "valuesOfMember",
  "memberCurrentValues",
  "paddedDateTime",
  "paddedDateTimeProperty",
  "writtenDate",
  "referenceRangeLow",
  "referenceRangeHigh",
  "decimalValue",
  "writtenValue",
  "ucumUnit",
  "unitText",
]);

/** Fields a derivation, not a view, puts on a view entry. */
const DERIVED = [
  "dateFrom",
  "medicationUseStartDateFrom",
  "prescriptionWrittenDateFrom",
  "type",
];

/** The field names one view's CONSTRUCT template writes; it throws, saying what to do, on a view or a prefix it cannot read. */
function constructedBy(file: string, text: string): string[] {
  const from = text.indexOf("CONSTRUCT {");
  const to = text.search(/^WHERE/m);
  if (from === -1 || to < from)
    throw new Error(
      `${file} has no "CONSTRUCT {" block ending at a line that starts with WHERE, so its fields cannot be read: ` +
        `put the template in that shape, or teach this test the view's shape`,
    );
  const template = text.slice(from, to);
  const prefix = /\b([A-Za-z]\w*):([A-Za-z_]\w*)/g;
  const names: string[] = [];
  for (const [, at, name] of template.matchAll(prefix)) {
    if (!["cascade", "prov", "obo"].includes(at!))
      throw new Error(
        `${file} writes ${at}:${name}, a prefix this test does not read, so a field could be missed: ` +
          `add "${at}" to the prefixes read in constructedBy, then map the field in POD_FIELDS or POD_NOT_CHECKABLE`,
      );
    if (/^[a-z]|^RO_/.test(name!) && !APART.has(name!)) names.push(name!);
  }
  if (/<https?:/.test(template))
    throw new Error(
      `${file} writes a field by full IRI, which this test does not read: write it with a prefix`,
    );
  return names;
}

/** The field names the vocabulary's views construct on a view entry. */
async function viewFields(): Promise<string[]> {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const { folder } = await resolveVocabulary(root, await readConfig(root));
  const dir = join(folder, "queries", "views");
  const names = new Set<string>();
  for (const file of (await readdir(dir)).filter((it) => it.endsWith(".rq")))
    for (const name of constructedBy(
      file,
      await readFile(join(dir, file), "utf8"),
    ))
      names.add(name);
  return [...names].sort();
}

/**
 * A model that answers about a person's records replies in a fixed JSON form, the reply contract: items, each resting
 * on facts that cite a record and on absences. `checkReply` holds a reply to the contract and each fact to the record it
 * cites, and returns what the pod itself holds of that record, so an app shows the pod's words and never the model's.
 * @rule runtime/naming.feature N13
 */
describe("Checking a model's reply against a person's records · checkReply(), replyErrors(), replySchema", () => {
  describe("given a reply about a pod (`ask`)", () => {
    it("checks every fact and absence of a recorded reply: its four facts hold and its one absence is backed", async () => {
      const checked = await checkReply(reply, { ask, ran });
      assert.deepEqual(checked.errors, []);
      const [scan, ruledOut, dimer, later] = checked.items;
      const facts = [...scan!.facts, ...ruledOut!.facts, ...dimer!.facts];
      assert.deepEqual(
        facts.map(({ verdict }) => verdict.ok),
        [true, true, true, true],
      );
      assert.deepEqual(
        later!.absences.map(({ backing }) => backing),
        [{ backed: true }],
      );
    });

    it("returns in `record.source` the records the cited view entry's values came from", async () => {
      const checked = await checkReply(reply, { ask, ran });
      assert.deepEqual(checked.items[0]!.facts[0]!.record?.source, [MEMBER]);
    });

    it("returns in `filled` what the pod holds of the view entry: its IRI, its name, its value with its unit, and its date", async () => {
      const [result] = await pointed(fact(HBA1C, "value"));
      const { entry, label, value, date, dateKind } = result!.filled!;
      assert.deepEqual(
        { entry, label, value, date, dateKind },
        {
          entry: `${POD}/lab-results.ttl#cd05f84f584f21389ebd613489d46ab9634387697c9a20caf6af151360307712`,
          label: A1C_LABEL,
          value: "6.9 %",
          date: "2025-09-22",
          dateKind: "when",
        },
      );
    });

    it("returns in `held` every value the view entry holds of the field the fact names", async () => {
      const [result, note] = await pointed(
        fact(HBA1C, "value"),
        fact(NOTE, "date"),
      );
      assert.deepEqual(result!.filled!.held, ["6.9"], "one value");
      assert.deepEqual(
        note!.filled!.held,
        ["2026-06-22T18:03:44Z", "2026-01-05T17:12:05Z"],
        "a note two records state, each with its own time",
      );
      assert.equal(
        note!.filled!.date,
        "2026-06-22",
        "its date is the first of them",
      );
    });

    it("lists in `sources` each source of the view entry, by its short name and who wrote it", async () => {
      const [result] = await pointed(fact(HBA1C, "value"));
      assert.deepEqual(result!.filled!.sources, [
        "S3 Fernhill Family Clinic",
        "S12 Northbay Clinical Laboratories",
      ]);
    });

    it("checks a fact about the person, cited by the subject's IRI", async () => {
      const [born] = await pointed(fact(PERSON, "date"));
      assert.deepEqual(reasons([born!]), ["ok"]);
      assert.deepEqual(
        [born!.filled?.entry, born!.filled?.date, born!.filled?.held],
        [PERSON, "1968-11-04", ["1968-11-04"]],
      );
    });
  });

  describe("given a fact that names a `source`", () => {
    it("returns in `held` and `sources` only what that source says", async () => {
      const facts = await pointed(
        fact(HBA1C, "value", { source: "S12" }),
        fact(HBA1C, "date", { source: "S3" }),
        fact(NOTE, "date", { source: "S6" }),
        fact(NOTE, "date", { source: "S3" }),
      );
      assert.deepEqual(reasons(facts), ["ok", "ok", "ok", "ok"]);
      assert.deepEqual(
        facts.map(({ filled }) => filled?.held),
        [
          ["6.9"],
          ["2025-09-22T16:15:00Z"],
          ["2026-06-22T18:03:44Z"],
          ["2026-01-05T17:12:05Z"],
        ],
      );
      assert.deepEqual(
        facts.slice(0, 2).map(({ filled }) => filled?.sources),
        [["S12 Northbay Clinical Laboratories"], ["S3 Fernhill Family Clinic"]],
      );
      assert.deepEqual(
        facts.slice(2).map(({ filled }) => filled?.date),
        ["2026-06-22", "2026-01-05"],
        "the note's date is that source's own",
      );
    });

    it("returns `no such source` for a source that is none of the view entry's", async () => {
      const [lacking] = await pointed(fact(HBA1C, "value", { source: "S1" }));
      assert.deepEqual(reasons([lacking!]), ["no such source: source S1"]);
    });
  });

  describe("given a fact that cites by handle", () => {
    const sha = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    const [first, later] = [1, 2].map(
      (n) => `urn:uuid:00000000-0000-4000-8000-00000000000${n}`,
    );
    const joined = `pod://p/clinical/lab-results.ttl#${sha(first!)}`;
    const askJoined = async (question: string) =>
      question === "entry/What it shows"
        ? [first, later].map((from) => ({
            entry: joined,
            from: from!,
            field: `${NS}testName`,
            value: "LDL cholesterol",
          }))
        : [];

    it("finds the view entry whose name the handle begins", async () => {
      const [result] = await pointed(fact(HBA1C, "value"));
      assert.match(
        result!.filled!.entry,
        /\/lab-results\.ttl#cd05f84f[0-9a-f]{56}$/,
      );
    });

    it("finds, for a handle made before another record joined the view entry, the view entry that record is in now", async () => {
      const [named] = await pointedIn(
        askJoined,
        fact(`L${sha(later!).slice(0, 12)}`, "name"),
      );
      assert.deepEqual(reasons([named!]), ["ok"]);
      assert.equal(named!.filled?.entry, joined);
    });

    it("returns `no such record`, with nothing in `filled`, for a handle no view entry has", async () => {
      const [none] = await pointed(fact("Lffffffff", "value"));
      assert.deepEqual(reasons([none!]), ["no such record: entry Lffffffff"]);
      assert.equal(none!.filled, undefined);
    });
  });

  describe("given a fact the pod does not bear out", () => {
    it("returns `no such field` when the view entry holds no value of the field", async () => {
      const [lacking] = await pointed(fact(HBA1C, "end"));
      assert.deepEqual(reasons([lacking!]), ["no such field: end"]);
    });

    it("returns `says otherwise` for a quote that is not words of the view entry's text", async () => {
      const facts = await pointed(
        fact(NOTE, "text", { quote: "new diagnosis of type 1 diabetes" }),
        fact(HBA1C, "value", { quote: "new diagnosis of type 2 diabetes" }),
      );
      assert.deepEqual(reasons(facts), [
        "says otherwise: quote new diagnosis of type 1 diabetes",
        "says otherwise: quote new diagnosis of type 2 diabetes",
      ]);
    });

    it("returns `quote too short` for a quote of fewer than three words", async () => {
      const facts = await pointed(
        fact(NOTE, "text", { quote: "the" }),
        fact(NOTE, "text", { quote: "new diagnosis" }),
      );
      assert.deepEqual(reasons(facts), [
        "quote too short: quote the",
        "quote too short: quote new diagnosis",
      ]);
    });

    it("returns `ok: true` for a quote of three words or more, and for one that is the whole of a shorter text", async () => {
      const seen = entry("reports", "5ee00001");
      const askSeen = async (question: string) =>
        question === "entry/What it shows"
          ? shown(seen, [
              ["reportName", "Chest film"],
              ["reportConclusion", "Not seen"],
            ])
          : [];
      const [long] = await pointed(
        fact(NOTE, "text", { quote: "new diagnosis of type 2 diabetes" }),
      );
      const [whole, part] = await pointedIn(
        askSeen,
        fact("R5ee00001", "text", { quote: "Not seen" }),
        fact("R5ee00001", "text", { quote: "seen" }),
      );
      assert.deepEqual(reasons([long!]), ["ok"], "three words or more");
      assert.deepEqual(
        reasons([whole!]),
        ["ok"],
        "the whole of a shorter text",
      );
      assert.deepEqual(
        reasons([part!]),
        ["quote too short: quote seen"],
        "part of a shorter text",
      );
    });

    it("returns `nothing to check` for the field `text` with no quote", async () => {
      const [bare] = await pointed(fact(NOTE, "text"));
      assert.deepEqual(reasons([bare!]), ["nothing to check: quote"]);
    });

    it("returns `filled` whatever the verdict", async () => {
      const [lacking] = await pointed(fact(HBA1C, "end"));
      assert.equal(lacking!.filled?.label, A1C_LABEL);
    });
  });

  describe("given a pod that cannot be read", () => {
    it("rejects with the pod's own error, leaving no rejection unhandled", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (why: unknown) => unhandled.push(why);
      process.on("unhandledRejection", onUnhandled);
      try {
        for (const [what, cited] of [
          ["a fact citing a view entry", HBA1C],
          ["a fact citing the person", PERSON],
        ] as const) {
          const failing = (question: string) =>
            Promise.reject(new Error(`cannot read ${question}`));
          await assert.rejects(
            checkReply(replyOf(fact(cited, "value")), {
              ask: failing,
              ran: [],
            }),
            /cannot read/,
            what,
          );
        }
        await new Promise((done) => setImmediate(done));
        assert.deepEqual(unhandled, []);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });

  describe("given a reply that breaks the contract", () => {
    const broken = { answer: "x", short: "y", items: [] };

    it("returns the contract's errors, one line for each, saying where in the reply", async () => {
      assert.deepEqual(replyErrors(broken), [
        "/items must NOT have fewer than 1 items",
      ]);
      assert.deepEqual(
        (await checkReply(broken, { ask, ran })).errors,
        replyErrors(broken),
      );
    });

    it("returns no checked items", async () => {
      assert.deepEqual((await checkReply(broken, { ask, ran })).items, []);
    });

    it("returns an error for what `replySchema` cannot say: a blank `answer`, an eleventh item, two items numbered alike", () => {
      const item = (n?: number) => ({
        says: "…",
        why: "…",
        confidence: "high",
        facts: [],
        ...(n === undefined ? {} : { n }),
      });
      for (const [what, given, expected] of [
        [
          "a blank answer",
          { answer: "   ", short: "y", items: [item()] },
          ["/answer must NOT have fewer than 1 characters"],
        ],
        [
          "an eleventh item",
          {
            answer: "x",
            short: "y",
            items: Array.from({ length: 11 }, () => item()),
          },
          ["/items must NOT have more than 10 items"],
        ],
        [
          "two items numbered alike",
          { answer: "x", short: "y", items: [item(2), item()] },
          [
            "/items more than one item has n 2 (an item without n is numbered by its place)",
          ],
        ],
      ] as const)
        assert.deepEqual(replyErrors(given), expected, what);
    });
  });

  describe("given a reply written to the other contract", () => {
    const files: Source = { at: async () => undefined };
    const copied = {
      answer: "…",
      short: "…",
      items: [
        {
          says: "…",
          why: "…",
          confidence: "high",
          facts: [
            {
              says: "D-dimer was raised.",
              provider: "Cascade North Demo Hospital",
              cite: { entry: "L41e35923" },
              name: "D-dimer",
            },
          ],
        },
      ],
    };

    it("returns errors for a reply about a pod whose facts copy what the record says, and for a reply about downloads whose facts name a field", async () => {
      assert.notDeepEqual(
        (await checkReply(copied, { ask, ran })).errors,
        [],
        "an app's reply that copies is turned away",
      );
      assert.notDeepEqual(
        (await checkReply(reply, { files, ran })).errors,
        [],
        "a reply that names a field is no reply about downloads",
      );
    });
  });

  describe("given `files` in place of `ask`, for a reply about downloads", () => {
    it("checks each fact's citation against the file it cites, and returns that file in `record.source`", async () => {
      const files = downloadsSource(
        fileURLToPath(
          new URL("../../test/fixtures/citations/", import.meta.url),
        ),
      );
      const checked = await checkReply(
        replyOf({
          says: "LDL was 131 mg/dL.",
          provider: "Cascade North Demo Hospital",
          cite: { file: "bundle.json", resource: "Observation/ldl-1" },
          value: 131,
          unit: "mg/dL",
        }),
        { files, ran: [] },
      );
      assert.deepEqual(checked.errors, []);
      const [result] = checked.items[0]!.facts;
      assert.equal(result!.verdict.ok, true);
      assert.deepEqual(result!.record?.source, ["bundle.json"]);
    });

    it("returns `nothing to check against` for a fact that cites a view entry", async () => {
      const files: Source = { at: async () => undefined };
      const checked = await checkReply(
        replyOf({
          says: "D-dimer was raised.",
          provider: "Cascade North Demo Hospital",
          cite: { entry: "L41e35923" },
          name: "D-dimer",
        }),
        { files, ran },
      );
      assert.deepEqual(checked.errors, []);
      assert.deepEqual(
        checked.items[0]!.facts.map(
          ({ verdict }) => !verdict.ok && verdict.reason,
        ),
        ["nothing to check against"],
      );
    });
  });

  describe("given neither `ask` nor `files`", () => {
    it("rejects, naming both", async () => {
      // @ts-expect-error a call names a pod to ask or the downloads to read, and at least one of them
      const neither = checkReply(reply, { ran });
      await assert.rejects(neither, /`ask`.*`files`.*neither/);
    });
  });

  describe("checkCopiedReply(reply, { ask, ran })", () => {
    it("checks a reply that copies what a view entry says against the pod's rows", async () => {
      const copied = {
        answer: "…",
        short: "…",
        items: [
          {
            says: "…",
            why: "…",
            confidence: "high",
            facts: [
              {
                says: "D-dimer was raised.",
                provider: "Cascade North Demo Hospital",
                cite: { entry: "L41e35923" },
                name: "D-dimer",
              },
            ],
          },
        ],
      };
      const answered = await checkCopiedReply(copied, { ask, ran });
      assert.deepEqual(answered.errors, []);
      assert.deepEqual(
        answered.items[0]!.facts.map(({ verdict }) => verdict.ok),
        [true],
      );
    });
  });

  describe("replySchema", () => {
    it("uses only the JSON Schema keywords a provider's structured output takes", () => {
      assert.deepEqual(beyondStructuredOutput(replySchema), []);
      assert.notDeepEqual(
        beyondStructuredOutput(recordsReplySchema),
        [],
        "the check finds what the contract that copies what a file says uses",
      );
    });
  });

  describe("given the fields the vocabulary's views write on a view entry", () => {
    it("knows every field: each is one a fact can rest on, or is listed as one no fact can", async () => {
      const fields = await viewFields();
      assert.ok(fields.length > 40, "the views were read");
      const unmapped = fields.filter(
        (name) => !(name in POD_FIELDS) && !POD_NOT_CHECKABLE.includes(name),
      );
      assert.deepEqual(
        unmapped,
        [],
        `the views construct ${unmapped.join(", ")}, which the checker does not know. If a view now sends a field: map it in ` +
          `POD_FIELDS, or list it in POD_NOT_CHECKABLE. If the vocabulary change is not on this branch: land this runtime ` +
          `PR with the vocabulary PR, each naming the other on a Depends-On line. If it is a helper node beside the view entry: ` +
          `add it to APART in this test`,
      );
      assert.deepEqual(
        POD_NOT_CHECKABLE.filter((name) => name in POD_FIELDS),
        [],
        "a field is checkable or not, never both: remove it from one of POD_FIELDS and POD_NOT_CHECKABLE",
      );
    });

    it("lists no field that no view writes", async () => {
      const fields = await viewFields();
      assert.deepEqual(
        [...Object.keys(POD_FIELDS), ...POD_NOT_CHECKABLE].filter(
          (name) => !fields.includes(name) && !DERIVED.includes(name),
        ),
        [],
        "a field no view sends is no coverage: remove it from POD_FIELDS or POD_NOT_CHECKABLE, or add it to DERIVED if a derivation puts it on the view entry",
      );
    });
  });
});
