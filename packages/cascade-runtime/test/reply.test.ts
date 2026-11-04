import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkReply,
  replyErrors,
  replySchema,
  type Ran,
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

// The reply is a model's answer in a recorded eval run (history/2026-11-03-1822d32-custom), with the calls it ran.
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

test("a model's reply is checked citation by citation and absence by absence, against the pod's rows and the calls it ran", async () => {
  const checked = await checkReply(reply, { ask, ran });
  assert.deepEqual(checked.errors, []);
  const [clot, ruledOut, dimer, later] = checked.items;
  const facts = [...clot!.facts, ...ruledOut!.facts, ...dimer!.facts];
  assert.deepEqual(
    facts.map(({ verdict }) => verdict.ok),
    [false, true, true, true],
    "the report's cited identifier is nowhere in the record; the rest hold",
  );
  const failed = facts[0]!;
  assert.deepEqual(failed.verdict, {
    ok: false,
    reason: "says otherwise",
    missing: ["id urn:uuid:1889f959-6178-8833-9850-96a22a25cc04"],
    shows:
      "CT angiography chest (pulmonary embolism protocol) · status final · on 2025-07-08",
  });
  assert.deepEqual(failed.fact.cite, { entry: "Rde64c513" });
  assert.deepEqual(failed.record?.source, [MEMBER]);
  assert.deepEqual(failed.record?.fields.name, [
    "CT angiography chest (pulmonary embolism protocol)",
  ]);
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

test("an entry cite met by a call with no pod to ask is not checked, which is not the cite being invented", async () => {
  const files: Source = { at: async () => undefined };
  const checked = await checkReply(reply, { files, ran });
  assert.deepEqual(
    checked.items.flatMap(({ facts }) =>
      facts.map(({ verdict }) => !verdict.ok && verdict.reason),
    ),
    Array(4).fill("nothing to check against"),
  );
  // @ts-expect-error a call names a pod to ask or the downloads to read, and at least one of them
  void (() => checkReply(reply, { ran }));
});
