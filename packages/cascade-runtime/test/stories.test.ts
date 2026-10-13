import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Story, StoryFinding } from "@cascade-runtime/demo-hospital";
import {
  loadHospital,
  loadStories,
  STORIES,
} from "@cascade-runtime/demo-hospital/node";
import { openPod, type Pod, type Pull, pullFiles } from "cascade-runtime";
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
    stories.flatMap(({ ccda }) => ccda ?? []),
    ["story-stopped.xml"],
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
  const story = stories.find(({ ccda }) => ccda !== undefined)!;
  const file = join(STORIES, story.ccda!);
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
