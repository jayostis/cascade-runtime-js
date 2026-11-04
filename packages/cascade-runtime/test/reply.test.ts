import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkReply,
  type CheckedFact,
  replyErrors,
  replySchema,
  type Ran,
  recordsReplySchema,
  type Source,
} from "cascade-runtime";

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

test("a model's reply is checked fact by fact and absence by absence, against the pod's rows and the calls it ran", async () => {
  const checked = await checkReply(reply, { ask, ran });
  assert.deepEqual(checked.errors, []);
  const [scan, ruledOut, dimer, later] = checked.items;
  const facts = [...scan!.facts, ...ruledOut!.facts, ...dimer!.facts];
  assert.deepEqual(
    facts.map(({ verdict }) => verdict.ok),
    [true, true, true, true],
  );
  assert.deepEqual(dimer!.facts[0]!.filled, {
    entry: LAB,
    label: "D-dimer",
    value: "0.92 mg/L{FEU}",
    date: "2025-07-08",
    dateKind: "when",
    held: ["0.92"],
    sources: [],
  });
  assert.deepEqual(scan!.facts[0]!.record?.source, [MEMBER]);
  assert.deepEqual(
    later!.absences.map(({ backing }) => backing),
    [{ backed: true }],
  );
});

test("a reply that breaks the contract is reported with the schema's errors and checked for nothing", async () => {
  assert.equal(replySchema.required.join(), "answer,short,items");
  const broken = { answer: "x", short: "y", items: [] };
  assert.deepEqual(replyErrors(broken), [
    "/items must NOT have fewer than 1 items",
  ]);
  const checked = await checkReply(broken, { ask, ran });
  assert.deepEqual(checked.errors, replyErrors(broken));
  assert.deepEqual(checked.items, []);
});

test("a reply checked against downloads is held to the contract that cites a file and copies what it says", async () => {
  const files: Source = { at: async () => undefined };
  assert.notDeepEqual((await checkReply(reply, { files, ran })).errors, []);
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
  const checked = await checkReply(copied, { files, ran });
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(
    checked.items[0]!.facts.map(({ verdict }) => !verdict.ok && verdict.reason),
    ["nothing to check against"],
    "an entry cite with no pod to ask is not checked, which is not the cite being invented",
  );
  const answered = await checkReply(copied, { ask, copied: true, ran });
  assert.deepEqual(answered.errors, []);
  assert.deepEqual(
    answered.items[0]!.facts.map(({ verdict }) => verdict.ok),
    [true],
    "a reply a recorded run copied is held to the pod's rows, not turned away for lacking a field",
  );
  // @ts-expect-error a call names a pod to ask or the downloads to read, and at least one of them
  const neither = checkReply(reply, { ran });
  await assert.rejects(neither, /`ask`.*`files`.*neither/);
});

// Priya's pod (the eval case priya-natarajan), cut to the rows the checker reads of her and of two entries, with one provenance row
// per document so its sources are named as a whole read of her pod names them: her hemoglobin A1c of 2025-09-22, which
// came from both her clinic (S3, Fernhill Family Clinic) and the lab (S12, Northbay Clinical Laboratories), and a plan
// of care note two records state, each with its own date.
const priya = read("priya.pod.json") as Record<
  string,
  Readonly<Record<string, string>>[]
>;
const askPriya = async (question: string) => priya[question] ?? [];
const POD = "pod://62c61be2-abd9-4485-b614-87ee83666495/clinical";
const HBA1C = "Lcd05f84f";
const NOTE = "Nfcb7c333";
const PERSON = "urn:uuid:a6a69b65-6745-4520-b1cd-fc8321062ab3";

const pointed = async (...facts: Record<string, unknown>[]) => {
  const checked = await checkReply(
    {
      answer: "…",
      short: "…",
      items: [{ says: "…", why: "…", confidence: "high", facts }],
    },
    { ask: askPriya, ran: [] },
  );
  assert.deepEqual(checked.errors, []);
  return checked.items[0]!.facts;
};
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

test("a fact names an entry the pod holds and the field it rests on, and comes back with what the pod holds of it", async () => {
  const [result, lab, clinic] = await pointed(
    fact(HBA1C, "value"),
    fact(HBA1C, "value", { source: "S12" }),
    fact(HBA1C, "date", { source: "S3" }),
  );
  assert.deepEqual(reasons([result!, lab!, clinic!]), ["ok", "ok", "ok"]);
  const filled = {
    entry: `${POD}/lab-results.ttl#cd05f84f584f21389ebd613489d46ab9634387697c9a20caf6af151360307712`,
    label: "Hemoglobin A1c/Hemoglobin.total in Blood",
    value: "6.9 %",
    date: "2025-09-22",
    dateKind: "when",
  };
  assert.deepEqual(result!.filled, {
    ...filled,
    held: ["6.9"],
    sources: [
      "S3 Fernhill Family Clinic",
      "S12 Northbay Clinical Laboratories",
    ],
  });
  assert.deepEqual(lab!.filled, {
    ...filled,
    held: ["6.9"],
    sources: ["S12 Northbay Clinical Laboratories"],
  });
  assert.deepEqual(clinic!.filled, {
    ...filled,
    held: ["2025-09-22T16:15:00Z"],
    sources: ["S3 Fernhill Family Clinic"],
  });
  const [born] = await pointed(fact(PERSON, "date"));
  assert.deepEqual(reasons([born!]), ["ok"], "the person, who has no entry");
  assert.deepEqual(
    [born!.filled?.entry, born!.filled?.date, born!.filled?.held],
    [PERSON, "1968-11-04", ["1968-11-04"]],
  );
});

test("a fact naming one of an entry's sources is held to what that source says", async () => {
  const facts = await pointed(
    fact(NOTE, "date"),
    fact(NOTE, "date", { source: "S6" }),
    fact(NOTE, "date", { source: "S3" }),
  );
  assert.deepEqual(reasons(facts), ["ok", "ok", "ok"]);
  assert.deepEqual(
    facts.map(({ filled }) => [filled?.date, filled?.held]),
    [
      ["2026-06-22", ["2026-06-22T18:03:44Z", "2026-01-05T17:12:05Z"]],
      ["2026-06-22", ["2026-06-22T18:03:44Z"]],
      ["2026-01-05", ["2026-01-05T17:12:05Z"]],
    ],
  );
});

test("a handle the pod does not hold, a field or source the entry lacks, and a quote not in its text each fail, by name", async () => {
  const facts = await pointed(
    fact("Lffffffff", "value"),
    fact(HBA1C, "end"),
    fact(HBA1C, "value", { source: "S1" }),
    fact(NOTE, "text", { quote: "new diagnosis of type 1 diabetes" }),
    fact(NOTE, "text", { quote: "new diagnosis of type 2 diabetes" }),
    fact(NOTE, "text"),
    fact(HBA1C, "value", { quote: "new diagnosis of type 2 diabetes" }),
    fact(NOTE, "text", { quote: "the" }),
    fact(NOTE, "text", { quote: "new diagnosis" }),
  );
  assert.deepEqual(reasons(facts), [
    "no such record: entry Lffffffff",
    "no such field: end",
    "no such source: source S1",
    "says otherwise: quote new diagnosis of type 1 diabetes",
    "ok",
    "nothing to check: quote",
    "says otherwise: quote new diagnosis of type 2 diabetes",
    "quote too short: quote the",
    "quote too short: quote new diagnosis",
  ]);
  assert.equal(facts[0]!.filled, undefined);
  assert.equal(
    facts[1]!.filled?.label,
    "Hemoglobin A1c/Hemoglobin.total in Blood",
  );
});

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

test("the contract of a reply about a pod is one a provider's structured output takes", () => {
  assert.deepEqual(beyondStructuredOutput(replySchema), []);
  assert.notDeepEqual(
    beyondStructuredOutput(recordsReplySchema),
    [],
    "the contract that copies what a file says is not",
  );
});
