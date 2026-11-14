import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { speaksToPatient, visibleText } from "../src/audience.js";
import type { Results } from "../src/results.js";
import { renderSite } from "../src/site.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const sourcesIn = (folder: string): string[] =>
  readdirSync(join(root, folder), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(folder, f));

const recorded = JSON.parse(
  readFileSync(
    join(root, "evals/test/fixtures/recorded-run/results.json"),
    "utf8",
  ),
) as Results;

/**
 * The hub's pages are about a person's records, for the builders and adopters of a protocol; none speaks to a patient.
 */
describe("Keeping the hub's pages to builders · speaksToPatient()", () => {
  describe("given a sentence", () => {
    for (const sentence of [
      "Ask your health records a question.",
      "your doctor brings that",
      "List the medicines you take.",
      "Own your own health data.",
      "See <b>your</b> <em>health</em> story.",
      "We&rsquo;re here for you.",
    ])
      it(`flags "${sentence}"`, () => {
        assert.ok(speaksToPatient(visibleText(sentence)).length > 0);
      });

    for (const sentence of [
      "puts the patient at the center",
      "A patient's doctor reads the records.",
      "Your health app imports FHIR; your runtime files it.",
      "The person's records stay on the person's device.",
      "<style>.your-health { color: red }</style><p>Fine.</p>",
    ])
      it(`passes "${sentence}"`, () => {
        assert.deepEqual(speaksToPatient(visibleText(sentence)), []);
      });
  });

  it("finds no patient-addressed sentence in the hub's sources", () => {
    const found = [...sourcesIn("evals/src"), ...sourcesIn("site/src")].flatMap(
      (file) =>
        speaksToPatient(readFileSync(join(root, file), "utf8")).map(
          (s) => `${relative(root, join(root, file))}: ${s}`,
        ),
    );
    assert.deepEqual(found, []);
  });

  it("finds none on a rendered evals page", () => {
    const found = [...renderSite([{ name: "fixture-1", results: recorded }])]
      .filter(([path]) => path.endsWith(".html"))
      .flatMap(([path, html]) =>
        speaksToPatient(visibleText(html)).map((s) => `${path}: ${s}`),
      );
    assert.deepEqual(found, []);
  });
});
