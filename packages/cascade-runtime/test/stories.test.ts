import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { after, before, test } from "node:test";
import type { Story, StoryFinding } from "@the-cascade-protocol/sandbox";
import { loadHospital, loadStories } from "@the-cascade-protocol/sandbox/node";
import {
  changeTools,
  checkInput,
  findChanges,
  type InputSchema,
  openPod,
  type Pod,
  type Pull,
  pullFiles,
  Refusal,
  type Row,
} from "cascade-runtime";
import { pulled } from "./hospitals.js";

const PREFIXES = `PREFIX clinical: <https://ns.cascadeprotocol.org/clinical/v1#>
PREFIX prov: <http://www.w3.org/ns/prov#>
`;

let stories: Story[];
let north: Awaited<ReturnType<typeof loadHospital>>;
const pulls = new Map<string, Pull>();
const pods = new Map<string, Pod>();

const day = (time: string | undefined) => (time ?? "").slice(0, 10);

/** The results a story's findings name, once each. */
function named(story: Story) {
  const seen = new Map<
    string,
    { test: string; date: string; value: number; unit: string }
  >();
  for (const finding of story.findings)
    for (const result of [...finding.before, ...finding.after])
      seen.set(`${finding.test} ${result.date}`, {
        test: finding.test,
        date: result.date,
        value: result.value,
        unit: finding.unit,
      });
  return [...seen.values()];
}

function resourcesOf(pull: Pull, type: string) {
  return pull.bundle.entry
    .map(({ resource }) => resource as Record<string, unknown>)
    .filter((resource) => resource.resourceType === type);
}

/** The days the pod's medication records say they ended. */
async function endDays(pod: Pod): Promise<string[]> {
  const rows = await pod.ask({
    query: `${PREFIXES}SELECT ?ended WHERE {
      ?record a clinical:Medication . ?version prov:specializationOf ?record ; clinical:endDate ?ended .
    }`,
  });
  return rows.map(({ ended }) => day(ended));
}

before(async () => {
  stories = await loadStories();
  north = await loadHospital("cascade-north");
  for (const { patient } of stories) {
    const { pull } = await pulled(north, patient);
    pulls.set(patient, pull);
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

test("the stories are five, each naming a patient North holds", () => {
  assert.equal(stories.length, 5);
  for (const { patient, hospital } of stories) {
    assert.equal(hospital, "cascade-north");
    assert.ok(north.patients[patient], patient);
  }
  assert.deepEqual(
    stories.flatMap(({ ccdaFile, patient }) => (ccdaFile ? [patient] : [])),
    ["story-stopped"],
  );
});

test("each story patient's pull is denied nothing, and imports with every result its answer names and every medication it starts or stops", async () => {
  for (const story of stories) {
    const { patient } = story;
    const pull = pulls.get(patient)!;
    const pod = pods.get(patient)!;
    assert.deepEqual([pull.denied, pull.missing], [[], []], patient);

    const labs = await pod.ask("pod/My lab results");
    assert.equal(labs.length, resourcesOf(pull, "Observation").length, patient);
    for (const want of named(story)) {
      assert.ok(
        labs.some(
          (row) =>
            row.code?.endsWith(`/${want.test}`) &&
            day(row.performed) === want.date &&
            Number(row.value) === want.value &&
            row.unit === want.unit,
        ),
        `${patient}: ${want.test} on ${want.date}`,
      );
    }

    const active = await pod.ask("pod/My active medications");
    const started = resourcesOf(pull, "MedicationRequest");
    assert.equal(active.length, started.length, patient);
    for (const request of started) {
      const code = (
        request.medicationCodeableConcept as {
          coding: { code: string }[];
        }
      ).coding[0]!.code;
      assert.ok(
        active.some(
          (row) =>
            row.code?.endsWith(`/${code}`) &&
            row.started === request.authoredOn,
        ),
        `${patient}: ${code} started ${String(request.authoredOn)}`,
      );
    }

    const stopped: StoryFinding[] = story.findings.filter(
      ({ kind }) => kind === "after stop",
    );
    assert.deepEqual(
      (await endDays(pod)).sort(),
      stopped.map(({ date }) => date),
      patient,
    );
  }
});

test("the stopped story's C-CDA copy joins its FHIR pull: the medication is one entry, each result one entry, both records ending on the day the answer names", async () => {
  const story = stories.find(({ ccdaFile }) => ccdaFile !== undefined)!;
  const file = story.ccdaFile!;
  await access(file);
  const pod = await openPod();
  try {
    const first = await pod.import(pullFiles(pulls.get(story.patient)!, "n"), {
      aboutSubject: true,
    });
    assert.equal(first.refused, undefined);
    const second = await pod.import(file, { aboutSubject: true });
    assert.equal(second.refused, undefined);

    const medications = await pod.ask({
      query: `PREFIX cascade: <https://ns.cascadeprotocol.org/core/v1#>
${PREFIXES}SELECT ?entry (COUNT(?record) AS ?records) WHERE {
        ?entry a clinical:Medication ; cascade:mergedFrom ?record .
      } GROUP BY ?entry`,
    });
    assert.deepEqual(
      medications.map(({ records }) => records),
      ["2"],
    );
    assert.deepEqual(
      await endDays(pod),
      story.findings.flatMap(({ date }) => [date, date]),
    );

    const labs = await pod.ask("pod/My lab results");
    assert.equal(labs.length, named(story).length);
    assert.ok(labs.every(({ records }) => records === "2"));
  } finally {
    await pod.close();
  }
});

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
      assert.deepEqual(finding.left, {
        unparsed: 0,
        otherUnit: 0,
        undated: 0,
      });
      assert.equal(
        finding.score === 0,
        gold.direction === "not enough results",
      );
    }
  }
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

  const medications = (await tools.get("timeline")!.execute({})) as {
    notation: string;
    started: string;
  }[];
  assert.deepEqual(
    medications.map(({ notation, started }) => [notation, started]),
    [
      ["197658", "2019-04-01"],
      ["617310", "2024-03-04"],
    ],
  );

  const refused: [string, unknown, RegExp][] = [
    ["find_changes", { colour: "red" }, /not a property/],
    ["find_changes", { toString: 1 }, /not a property/],
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
