import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  checkAbsence,
  checkCitation,
  downloadsSource,
  podRowsSource,
} from "../src/citations.js";

const downloads = downloadsSource(
  fileURLToPath(new URL("../../test/fixtures/citations/", import.meta.url)),
);
const pod = podRowsSource(async (entry) =>
  entry === "pod://p/clinical/labs.ttl#tsh"
    ? [
        { field: "cascade:testName", value: "TSH" },
        { field: "cascade:valueQuantity", value: "7.90" },
        { field: "cascade:performed", value: "2026-03-03T09:00:00Z" },
      ]
    : undefined,
);

test("a citation is verified where it points, or refused saying why", async () => {
  for (const [claim, source, verdict] of [
    [
      {
        cite: { file: "summary.xml", line: 5 },
        date: "2025-11-08",
        values: ["Shingrix"],
      },
      downloads,
      { ok: true },
    ],
    [
      {
        cite: { file: "bundle.json", resource: "Observation/fit-1" },
        date: "2025-11-04",
        values: ["Positive"],
      },
      downloads,
      { ok: true },
    ],
    [
      { cite: { entry: "pod://p/clinical/labs.ttl#tsh" }, values: ["7.9"] },
      pod,
      { ok: true },
    ],
    [
      {
        cite: { file: "summary.xml", line: 5 },
        date: "2026-03-03",
        values: ["7.9"],
      },
      downloads,
      {
        ok: false,
        reason: "not at that line",
        missing: ["2026-03-03", "7.9"],
        foundAt: [32, 33],
      },
    ],
    [
      {
        cite: { file: "bundle.json", resource: "Observation/egfr-2" },
        date: "2026-02-16",
        values: ["59"],
      },
      downloads,
      { ok: false, reason: "says otherwise", missing: ["59"] },
    ],
    [
      { cite: { entry: "pod://p/clinical/labs.ttl#tsh" }, values: ["4.6"] },
      pod,
      { ok: false, reason: "says otherwise", missing: ["4.6"] },
    ],
    [
      { cite: { file: "bundle.json", resource: "Observation/colonoscopy-1" } },
      downloads,
      { ok: false, reason: "no such record", missing: [] },
    ],
    [
      { cite: { file: "summary.xml", line: 400 } },
      downloads,
      { ok: false, reason: "no such record", missing: [] },
    ],
  ] as const)
    assert.deepEqual(
      await checkCitation(claim, source),
      verdict,
      JSON.stringify(claim),
    );
});

test("an absence is backed only by a query that ran, with its coverage stated", () => {
  const ran = [
    { tool: "ask", input: { pod: "p", question: "pod/My procedures" } },
  ];
  const absence = {
    what: "a colonoscopy after the positive FIT",
    coverage: "every procedure the pod holds, 2024-02 to 2026-10",
  };
  for (const [claim, verdict] of [
    [
      {
        ...absence,
        query: {
          tool: "ask",
          input: { question: "pod/My procedures", pod: "p" },
        },
      },
      { backed: true },
    ],
    [absence, { backed: false, reason: "no query" }],
    [
      {
        ...absence,
        query: {
          tool: "ask",
          input: { pod: "p", question: "pod/My lab results" },
        },
      },
      { backed: false, reason: "query not run" },
    ],
    [
      {
        ...absence,
        coverage: "",
        query: {
          tool: "ask",
          input: { pod: "p", question: "pod/My procedures" },
        },
      },
      { backed: false, reason: "no coverage" },
    ],
  ] as const)
    assert.deepEqual(checkAbsence(claim, ran), verdict, JSON.stringify(claim));
});
