import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { instancesOf } from "../src/instances.js";
import type { Results } from "../src/results.js";
import { errorsOf } from "../src/schemas.js";
import { buildSite, renderSite } from "../src/site.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-site-"));
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const recorded = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../../test/fixtures/recorded-run/results.json", import.meta.url),
    ),
    "utf8",
  ),
) as Results;
const ID = "tamsin-vale.opus-5-5.r1";
const ARMS = ["pod", "records"] as const;
const QUESTIONS = ["checkup", "medications", "blood-clot", "allergies"];

/** The same run as another model's, to see two models and two runs side by side. */
const asModel = (name: string, model: string): Results => {
  const text = JSON.stringify(recorded)
    .replaceAll("opus-5-5", model.replace(/^claude-/, ""))
    .replaceAll("claude-opus-5-5", model)
    .replace('"id": "fixture-1"', `"id": "${name}"`);
  return JSON.parse(text) as Results;
};

/** Renders a site once, when a leaf first reads it, for the leaves of more than one level 2 that read it. */
const lazy = <T>(make: () => T) => {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
};

const one = renderSite([{ name: "fixture-1", results: recorded }]);
const page = (path: string, site = one) => {
  const html = site.get(path);
  assert.ok(html !== undefined, `${path} is rendered`);
  return html;
};
const run = page(`instances/${ID}.html`);

const text = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ");

/** The element whose opening tag matches, through its closing tag (same-name tags nested inside are counted). */
function element(html: string, open: RegExp): string {
  const start = open.exec(html);
  assert.ok(start !== null, `${open} is on the page`);
  const name = /^<(\w+)/.exec(start[0])![1]!;
  const tag = new RegExp(`<(/?)${name}\\b`, "g");
  tag.lastIndex = start.index + 1;
  let depth = 1;
  for (let m = tag.exec(html); m !== null; m = tag.exec(html)) {
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0)
      return html.slice(start.index, html.indexOf(">", m.index) + 1);
  }
  throw new Error(`${open} is never closed`);
}
const section = (q: string, from = run) =>
  element(from, new RegExp(`<section[^>]*id="q_${q}"`));
const arm = (q: string, which: string, from = run) =>
  element(
    section(q, from),
    new RegExp(`<div[^>]*class="arm[^"]*"[^>]*data-arm="${which}"`),
  );
const tab = (q: string, which: string, name: string, from = run) =>
  element(arm(q, which, from), new RegExp(`<div[^>]*data-tab="${name}"`));
/** An arm's reasoning and evidence for a question: full width under both arms, not inside either. */
const drill = (q: string, which: string, from = run) =>
  element(
    section(q, from),
    new RegExp(`<div[^>]*class="drill"[^>]*data-arm="${which}"`),
  );
const count = (html: string, pattern: RegExp) =>
  [...html.matchAll(pattern)].length;
const withPerson = (person: { name: string; pronoun: string }): Results => ({
  ...recorded,
  cases: recorded.cases.map((it) => ({ ...it, person })),
});

/** The recorded run with one point beyond the key that a judge found contradicted by the records. */
const contradicted = lazy(() => {
  const grades = recorded.grades.map((g, at) =>
    at === 0
      ? {
          ...g,
          beyond: [{ item: 3, verdict: "contradicted" as const, why: "no" }],
        }
      : g,
  );
  const [first] = recorded.instances;
  return renderSite([
    {
      name: "c",
      results: {
        ...recorded,
        grades,
        instances: [
          {
            ...first!,
            arms: {
              ...first!.arms,
              pod: {
                ...first!.arms.pod!,
                beyond: { ...first!.arms.pod!.beyond, contradicted: 1 },
              },
            },
          },
        ],
      },
    },
  ]);
});

/** The recorded run with its evidence removed from `results.json`. */
const bare = lazy(() =>
  renderSite([{ name: "bare", results: { ...recorded, evidence: [] } }]),
);

/**
 * One row per model, with what each arm found as counts, and one per instance, which opens its run.
 */
describe("Reading the report's front page · renderSite()", () => {
  describe("given two runs of two models", () => {
    let index: string;
    const row = () => element(index, /<tr[^>]*data-model="claude-opus-5-5"/);

    before(() => {
      index = renderSite([
        { name: "fixture-1", results: recorded },
        {
          name: "fixture-2",
          results: asModel("fixture-2", "claude-sonnet-5-5"),
        },
      ]).get("index.html")!;
    });

    it("shows one row for each model", () => {
      const models = [...index.matchAll(/<tr[^>]*data-model="([^"]+)"/g)].map(
        (m) => m[1],
      );
      assert.deepEqual(models.sort(), ["claude-opus-5-5", "claude-sonnet-5-5"]);
    });

    it("shows what each arm got right as a count out of its key items", () => {
      const [instance] = recorded.instances;
      for (const which of ARMS) {
        const a = instance!.arms[which]!;
        const right = a.expected.found + a.traps.avoided;
        const of = a.expected.of + a.traps.of;
        assert.match(
          text(element(row(), new RegExp(`<td[^>]*data-arm="${which}"`))),
          new RegExp(`${right} of ${of}`),
          which,
        );
      }
    });

    it("shows a cost in dollars in each model's row", () => {
      assert.match(
        text(element(row(), /<td[^>]*data-cell="cost"/)),
        /\$0\.\d+/,
      );
    });

    it("shows no percentage", () => {
      assert.equal(/\d%/.test(text(index)), false, "counts, never percentages");
    });

    it("shows one row for each instance, each a link to that run's page", () => {
      const rows = [...index.matchAll(/<a[^>]*class="runrow"[^>]*>/g)].map(
        (m) => m[0],
      );
      assert.equal(rows.length, 2);
      for (const each of rows)
        assert.match(each, /href="runs\/fixture-[12]\/instances\//);
    });

    it("states an instance's judging cost in its row, as charged to neither arm", () => {
      const instance = text(
        element(
          index,
          /<a[^>]*class="runrow"[^>]*data-instance="tamsin-vale\.opus-5-5\.r1"/,
        ),
      );
      assert.match(instance, /judging \$0\.15\d? .*charged to neither arm/);
    });

    it("keeps judging out of both arms' blocks", () => {
      for (const which of ARMS)
        assert.equal(
          /judging/.test(
            text(element(index, new RegExp(`<div[^>]*data-arm="${which}"`))),
          ),
          false,
          `${which}'s block holds no judging`,
        );
    });

    it("links to how the test works", () => {
      assert.match(index, /href="how_it_works\.html"/);
    });
  });

  describe("given one run", () => {
    const front = page("index.html");
    const pod = () => element(front, /<td data-arm="pod"/);

    it("draws a filled dot for each key item an arm got right", () => {
      assert.equal(count(pod(), /class="dot d-yes"/g), 10);
    });

    // The recorded run has no key item the judges left ungraded, so an open dot here is a split or an unanswered question.
    it("draws an open dot for each key item the judges split on or the arm never answered", () => {
      assert.equal(count(pod(), /class="dot d-open"/g), 3);
    });

    it("draws no miss dot where the arm missed nothing", () => {
      assert.equal(count(pod(), /class="dot d-no"/g), 0);
    });

    it("explains the open dot and the `!` in its legend", () => {
      const legend = text(element(front, /<div class="legend"/));
      assert.match(legend, /not counted/);
      assert.match(legend, /! .*records contradict/);
    });

    it("shows an arm's points beyond the key that are possibly good as `+N beyond the key`", () => {
      const row = text(element(front, /<a class="runrow"[^>]*data-instance/));
      assert.match(row, /\+1 beyond the key/);
    });

    it("says apart how many points beyond the key the judges split on", () => {
      const row = text(element(front, /<a class="runrow"[^>]*data-instance/));
      assert.match(row, /judges split on 1 raised beyond the key/);
    });
  });

  describe("given a point a judge found contradicted by the records", () => {
    it("says how many answers said something the records contradict", () => {
      assert.match(
        text(contradicted().get("index.html")!),
        /1 said something the records contradict/,
      );
    });
  });
});

/**
 * Each question as the person asked it, both arms' answers as they were written, what each cost, and what the test
 * itself cost, charged to neither arm.
 */
describe("Reading one run's page · renderSite()", () => {
  describe("with each question", () => {
    it("shows the question in the person's own words", () => {
      for (const [q, asks] of [
        ["checkup", /I have a check-up coming/],
        ["medications", /What medications am I on right now\?/],
        ["blood-clot", /Did I ever have a blood clot in my lung\?/],
        ["allergies", /Am I allergic to anything\?/],
      ] as const)
        assert.match(
          text(element(section(q), /<div[^>]*class="bubble"/)),
          asks,
          q,
        );
    });

    it("gives each arm's answer the tabs answer, reasoning and doctor", () => {
      for (const q of QUESTIONS)
        for (const which of ARMS) {
          const names = [
            ...arm(q, which).matchAll(/<label[^>]*data-tab-label="(\w+)"/g),
          ].map((m) => m[1]);
          assert.deepEqual(names, ["answer", "reasoning", "doctor"], q);
        }
    });

    it("shows each arm's answer as it was written", () => {
      assert.match(
        text(tab("checkup", "pod", "answer")),
        /Two things stand out for your check-up/,
      );
      assert.match(
        text(tab("medications", "records", "answer")),
        /so I treat it as stopped/,
      );
    });

    it("shows what an answer cost in tokens, dollars and time", () => {
      const cost = text(
        element(arm("checkup", "pod"), /<div[^>]*class="cost"/),
      );
      assert.match(cost, /30,440 tokens/);
      assert.match(cost, /\$0\.11/);
      assert.match(cost, /2 min/);
    });

    // The report calls the records arm "Grab bag", and says "the grab bag's files": quoted as it prints them.
    it("says how many of a records-arm answer's tokens were its files, read again", () => {
      assert.match(
        text(element(arm("checkup", "records"), /<div[^>]*class="cost"/)),
        /54,000 .*grab bag's files/,
      );
    });

    it("shows the question as it was put to the model", () => {
      const prompt = text(
        element(section("allergies"), /<details[^>]*class="fold prompt"/),
      );
      assert.match(prompt, /Am I allergic to anything\?/);
    });

    it("shows the whole opening prompt of each session under that session's first question", () => {
      const opening = text(
        element(section("checkup"), /<details[^>]*class="fold prompt"/),
      );
      const jobs = recorded.jobs.filter(
        (it) => it.role === "subject" && it.questions!.includes("checkup"),
      );
      assert.ok(jobs.length > 0);
      for (const job of jobs)
        assert.ok(opening.includes(job.promptText!), job.id);
    });

    it("shows a prompt's text, never the path of its file", () => {
      const opening = text(
        element(section("checkup"), /<details[^>]*class="fold prompt"/),
      );
      assert.equal(/prompts\/tamsin-vale/.test(opening), false);
    });

    // The report names the arms "With Cascade" and "Grab bag": quoted as it prints them.
    it("says what could have told a judge the arms apart, by the tell and the arm", () => {
      const tells = text(
        element(section("medications"), /<p class="tiny muted tells"/),
      );
      assert.match(
        tells,
        /Judges may have been able to tell the arms apart: merged, latest \(With Cascade\) · document \(Grab bag\)/,
      );
    });
  });

  describe("with the test's overhead", () => {
    const overhead = () => text(element(run, /<aside[^>]*class="overhead"/));

    it("names each judge's model, as charged to neither arm", () => {
      assert.match(overhead(), /haiku-5-5/);
      assert.match(overhead(), /sonnet-5-5/);
      assert.match(overhead(), /charged to neither arm/);
    });

    it("keeps every judge and the word judging out of each answer's cost", () => {
      for (const q of ["checkup", "blood-clot"])
        for (const which of ARMS)
          assert.equal(
            /haiku|sonnet|judging/i.test(
              text(element(arm(q, which), /<div[^>]*class="cost"/)),
            ),
            false,
            `${q} ${which}`,
          );
    });

    // The build is said once, on how the test works.
    it("says no pod build time", () => {
      assert.equal(/3\.1 s/.test(text(run)), false);
    });

    it("lists the letters each judge saw the answers under", () => {
      const judges = text(element(run, /<details class="fold" id="judges"/));
      for (const judge of ["haiku-5-5", "sonnet-5-5"])
        assert.match(judges, new RegExp(`${judge} saw the answers under`));
    });

    it("shows `unknown arm` for a letter whose job the results do not hold", () => {
      const unknown = {
        ...recorded,
        jobs: recorded.jobs.map((j) =>
          j.labels === undefined
            ? j
            : {
                ...j,
                labels: Object.fromEntries(
                  Object.entries(j.labels).map(([letter, l]) => [
                    letter,
                    letter === "A" ? { ...l, job: "gone" } : l,
                  ]),
                ),
              },
        ),
      };
      const judges = text(
        element(
          page(
            `instances/${ID}.html`,
            renderSite([{ name: "u", results: unknown }]),
          ),
          /<details class="fold" id="judges"/,
        ),
      );
      assert.match(judges, /A = unknown arm/);
    });
  });

  describe("with the key under each question", () => {
    const key = () =>
      element(section("checkup"), /<details[^>]*class="fold key"/);

    it("starts closed", () => {
      assert.equal(/^<details[^>]*\bopen\b/.test(key()), false);
    });

    it("calls itself a reference, not a verdict", () => {
      assert.match(text(key()), /a reference, not a verdict/);
    });

    it("lists the question's key items", () => {
      assert.match(text(key()), /Urine albumin-to-creatinine ratio never done/);
    });

    it("shows a point beyond the key as possibly good, with what the answer said", () => {
      const beyond = text(element(key(), /<tr[^>]*class="beyond"/));
      assert.match(beyond, /possibly good/);
      assert.match(beyond, /Your cholesterol may be due for a recheck/);
    });

    it("shows each judge's own verdict on a point they split on", () => {
      const split = text(
        element(section("allergies"), /<tr[^>]*class="beyond"/),
      );
      assert.match(split, /speculative/);
      assert.match(split, /true, not planted/);
    });

    // The other judge calls the same point possibly good, so what is not called that is this judge's line of the row.
    it("says that the records contradict a point a judge found contradicted, with the judge's name", () => {
      const row = element(
        section("checkup", page(`instances/${ID}.html`, contradicted())),
        /<tr[^>]*class="beyond"/,
      );
      const haiku = text(
        row.split("<br>").find((it) => it.includes("haiku-5-5"))!,
      );
      assert.match(haiku, /haiku-5-5: . contradicted by the records/);
      assert.equal(/possibly good/.test(haiku), false);
    });

    it("shows a judge's point that is outside every numbered item, with the judge's reason", () => {
      const grades = recorded.grades.map((g, at) =>
        at === 0
          ? {
              ...g,
              beyond: [
                {
                  item: 0,
                  verdict: "fair" as const,
                  why: "said between items",
                },
              ],
            }
          : g,
      );
      const site = renderSite([
        { name: "c", results: { ...recorded, grades } },
      ]);
      assert.match(
        text(section("checkup", page(`instances/${ID}.html`, site))),
        /said between items/,
      );
    });
  });

  describe("with the layout of each question", () => {
    it("places each arm's reasoning and evidence under both arms, inside neither", () => {
      for (const q of QUESTIONS) {
        const arms = element(section(q), /<div class="arms"/);
        assert.equal(/class="drill"/.test(arms), false, q);
        for (const which of ARMS) assert.ok(drill(q, which).length > 0, q);
      }
    });

    // The Reasoning radio sits before the arms, so that its panel can follow it.
    it("gives each arm one reasoning tab, switched by a control placed before the arms", () => {
      for (const q of QUESTIONS) {
        const whole = section(q);
        const before = whole.slice(
          0,
          whole.indexOf(element(whole, /<div class="arms"/)),
        );
        for (const which of ARMS) {
          const labels = [
            ...arm(q, which).matchAll(
              /<label for="([^"]+)"[^>]*data-tab-label="reasoning"/g,
            ),
          ];
          assert.equal(labels.length, 1, `${q} ${which} has a Reasoning tab`);
          assert.ok(
            new RegExp(`<input type="radio"[^>]*id="${labels[0]![1]}"`).test(
              before,
            ),
            `${q} ${which}: the Reasoning radio is before the arms`,
          );
        }
      }
    });

    it("draws no graph wider than 1000 px", () => {
      const widths = [
        ...run.matchAll(/<svg class="graph"[^>]* width="(\d+)"/g),
      ];
      assert.ok(widths.length > 0, "the page draws graphs");
      for (const m of widths)
        assert.ok(Number(m[1]) <= 1000, `a graph ${m[1]} px wide`);
    });
  });
});

/**
 * Under each answer, a graph from the model's citations to what the harness resolved them to. It shows only what
 * `results.json` holds.
 */
describe("Seeing what an answer's citations cite · renderSite()", () => {
  describe("with the pod arm's graph", () => {
    it("shows a cited view entry's provenance: its record, how many versions, the source and its dates", () => {
      const reasoning = text(drill("medications", "pod"));
      for (const said of [
        "story-stopped-med-1",
        "3 revisions",
        "Cascade North Demo Hospital",
        "2024-02-01",
        "2026-10-15",
      ])
        assert.ok(
          reasoning.includes(said),
          `the medications graph shows ${said}`,
        );
    });

    it("shows the rows and the time of a logged call an answer points at", () => {
      const checkup = text(drill("checkup", "pod"));
      assert.match(checkup, /30 rows back/);
      assert.match(checkup, /41 ms/);
    });

    it("says `no such record` for a citation that resolves to nothing, and marks it failed", () => {
      const clot = drill("blood-clot", "pod");
      assert.match(text(clot), /no such record/);
      assert.ok(/class="ck bad"/.test(clot), "the failed citation is marked");
    });

    it("draws nothing beyond a citation that failed", () => {
      assert.equal(
        /story-stopped-med-1|north-2026-10/.test(
          text(drill("blood-clot", "pod")),
        ),
        false,
      );
    });

    it("shows the model's own knowledge, marked as not from the records", () => {
      const checkup = text(drill("checkup", "pod"));
      assert.match(
        checkup,
        /a later procedure would have been the colonoscopy/,
      );
      assert.match(checkup, /A lipid panel is usually repeated 4 to 12 weeks/);
      assert.match(checkup, /not from the records/);
    });
  });

  describe("with the pod arm's graph of a fact that points at a view entry", () => {
    let html: string;

    before(() => {
      const pointing = structuredClone(recorded) as unknown as {
        answers: Record<
          string,
          Record<string, { items: { facts: unknown[] }[] }>
        >;
        checks: Record<string, Record<string, { citations: object[] }>>;
      };
      const job = "tamsin-vale.checkup.pod.opus-5-5.r1";
      pointing.answers[job]!.medications!.items[0]!.facts[0] = {
        says: "Jardiance 10 mg is active.",
        cite: { entry: "M4c38f471" },
        field: "status",
      };
      pointing.checks[job]!.medications!.citations[0] = {
        item: 1,
        fact: 0,
        cite: { entry: "M4c38f471" },
        field: "status",
        ok: true,
        filled: {
          entry: "pod://tamsin/clinical/medications.ttl#4c38f471",
          label: "Jardiance 10 mg tablet",
          date: "2025-02-20",
          dateKind: "recorded",
          held: ["active"],
          sources: ["S2 Cascade North Demo Hospital"],
        },
      };
      assert.deepEqual(errorsOf("results", pointing), []);
      html = page(
        `instances/${ID}.html`,
        renderSite([
          { name: "fixture-1", results: pointing as unknown as Results },
        ]),
      );
    });

    it("shows the fact with what the pod holds of that view entry, then the handle and field the model named", () => {
      assert.match(
        text(html),
        /Jardiance 10 mg is active\. Jardiance 10 mg tablet · 2025-02-20 · S2 Cascade North Demo Hospital · M4c38f471, status/,
      );
    });

    it("shows the fact on the doctor card with its date and its source's name", () => {
      assert.match(
        text(tab("medications", "pod", "doctor", html)),
        /Jardiance 10 mg is active\. · 2025-02-20 · Cascade North Demo Hospital/,
      );
    });
  });

  describe("with the records arm's graph", () => {
    it("ends at the passage a citation names: its file and lines, its resource, the day it was retrieved", () => {
      const said = text(drill("medications", "records"));
      assert.match(said, /north-2026-10\/bundle\.json:300-318/);
      assert.match(said, /\/entry\/11\/resource/);
      assert.match(said, /retrieved 2026-10-15/);
    });

    it("shows the passage's own text", () => {
      assert.match(
        text(drill("blood-clot", "records")),
        /No pulmonary embolism\. Lungs are clear/,
      );
    });

    it("shows a link between two files where the answer wrote one", () => {
      assert.match(
        text(drill("medications", "records")),
        /the later copy closes the earlier one/,
      );
    });

    it("shows no link where the answer wrote none", () => {
      assert.equal(
        /Agent's link/.test(text(drill("blood-clot", "records"))),
        false,
      );
    });

    it("names a file that an absence's `sources` leave out", () => {
      assert.match(
        text(drill("checkup", "records")),
        /sources leave out north-2024-02\/bundle\.json/,
      );
    });

    it("says how many files an absence covers when the answer did not name its `sources`", () => {
      const allergies = text(drill("allergies", "records"));
      assert.match(allergies, /6 files/);
      assert.match(allergies, /did not name its sources/);
    });
  });

  describe("with the evidence removed from `results.json`", () => {
    let html: string;

    before(() => {
      html = page(`instances/${ID}.html`, bare());
    });

    it("shows no record, no count of versions, no passage and no resource", () => {
      const pod = text(
        element(section("medications", html), /<div[^>]*data-arm="pod"/),
      );
      const records = text(
        element(section("medications", html), /<div[^>]*data-arm="records"/),
      );
      assert.equal(/story-stopped-med-1|3 revisions/.test(pod), false);
      assert.equal(/:300-318|\/entry\/11/.test(records), false);
    });

    it("shows no download date", () => {
      const both = ARMS.map((which) =>
        text(
          element(
            section("medications", html),
            new RegExp(`<div[^>]*data-arm="${which}"`),
          ),
        ),
      ).join(" ");
      assert.equal(/download of 2026/.test(both), false);
    });

    it("shows each fact as the answer wrote it", () => {
      assert.match(
        text(element(section("medications", html), /<div[^>]*data-arm="pod"/)),
        /Jardiance 10 mg is active/,
      );
    });

    it("says that whether the records arm's files were read whole is not recorded", () => {
      assert.match(
        text(drill("checkup", "records", html)),
        /whether it was read whole is not recorded/,
      );
    });
  });
});

/**
 * A doctor card is an answer cut down to what a doctor can check: the question, the short answer, and each dated fact
 * with its source.
 */
describe("Printing what to show a doctor · renderSite()", () => {
  describe("with the doctor card of an answer", () => {
    it("opens with the question the person asked", () => {
      assert.match(text(tab("checkup", "pod", "doctor")), /You asked/);
    });

    it("shows the answer's short form", () => {
      assert.match(
        text(tab("checkup", "pod", "doctor")),
        /Ask about a urine albumin test/,
      );
    });

    it("shows each dated fact with its source and the download it came from", () => {
      const pod = text(tab("checkup", "pod", "doctor"));
      assert.match(pod, /The stool test \(FIT\) was positive on 2025-11-04/);
      assert.match(
        pod,
        /2025-11-04 .*Cascade North Demo Hospital, download of 2026-10-15/,
      );
      const records = text(tab("blood-clot", "records", "doctor"));
      assert.match(records, /D-dimer was 0\.92 mg\/L FEU/);
      assert.match(
        records,
        /Cascade North Demo Hospital, download of 2026-10-15/,
      );
    });

    it("shows an absence as looked for and not found", () => {
      assert.match(
        text(tab("checkup", "pod", "doctor")),
        /Looked for and not found: A colonoscopy after 2025-11-04/,
      );
    });

    it("leaves out the model's own knowledge", () => {
      assert.equal(
        /lipid panel is usually repeated/.test(
          text(tab("checkup", "pod", "doctor")),
        ),
        false,
      );
    });

    it("dates the card the case's day, not the day the run finished", () => {
      assert.equal(recorded.run.finished.slice(0, 10), "2026-10-31");
      assert.match(
        text(tab("checkup", "pod", "doctor")),
        /Prepared with Cascade . opus-5-5 . 2026-10-30/,
      );
    });
  });

  describe("with the print view of one arm", () => {
    const view = (which: string) => page(`instances/${ID}.print-${which}.html`);

    it("holds one card for each question of the case", () => {
      for (const which of ARMS)
        assert.equal(
          count(view(which), /<article[^>]*class="card"/g),
          5,
          which,
        );
    });

    it("lists a question the arm never answered as not answered", () => {
      const printed = text(view("pod"));
      assert.match(printed, /When was my last A1c/);
      assert.match(printed, /Not answered/);
    });

    it("links to the other arm's print view", () => {
      assert.match(
        view("pod"),
        new RegExp(`href="${ID}\\.print-records\\.html"`),
      );
      assert.match(
        view("records"),
        new RegExp(`href="${ID}\\.print-pod\\.html"`),
      );
    });

    it("carries its own print styles", () => {
      for (const which of ARMS)
        assert.match(view(which), /@media print/, which);
    });

    it("shows each question and each fact's source", () => {
      for (const which of ARMS) {
        const said = text(view(which));
        assert.match(said, /I have a check-up coming/, which);
        assert.match(
          said,
          /Cascade North Demo Hospital, download of 2026-10-15/,
          which,
        );
      }
    });

    it("leaves out the model's own knowledge, every judge and every cost", () => {
      for (const which of ARMS)
        assert.equal(
          /lipid panel is usually repeated|haiku|\$\d/.test(text(view(which))),
          false,
          which,
        );
    });

    it("dates each card the case's day", () => {
      assert.match(text(view("pod")), /claude-opus-5-5 . 2026-10-30/);
    });
  });

  describe("with the run's page", () => {
    it("links to the print view of each arm", () => {
      assert.match(run, new RegExp(`href="${ID}\\.print-pod\\.html"`));
      assert.match(run, new RegExp(`href="${ID}\\.print-records\\.html"`));
    });
  });
});

/**
 * A page per synthetic person, and one page that explains the test and what it cost to build each pod.
 */
describe("Reading about a case's person, and how the test works · renderSite()", () => {
  describe("with the person's page", () => {
    const person = page("people/tamsin-vale.html");

    it("shows the person's name and every part of the recorded description", () => {
      const said = text(person);
      assert.match(said, /Tamsin Vale/);
      const { summary, who, sources, planted } = recorded.cases[0]!.description;
      for (const part of [summary, who, sources, planted])
        assert.ok(said.includes(part), part);
    });

    it("links to each of that person's runs", () => {
      assert.match(person, new RegExp(`href="../instances/${ID}[.]html"`));
    });
  });

  describe("with the front page", () => {
    it("links to the person's page, by the person's name", () => {
      assert.match(
        page("index.html"),
        /href="people\/tamsin-vale\.html"[^>]*>Who Tamsin Vale is/,
      );
    });
  });

  describe("with each run's page", () => {
    it("links to the person's page", () => {
      assert.match(run, /href="\.\.\/people\/tamsin-vale\.html"/);
    });
  });

  describe("given a case recorded with another name and pronoun", () => {
    const sites = new Map<string, Map<string, string>>();

    before(() => {
      for (const pronoun of ["their", "his"])
        sites.set(
          pronoun,
          renderSite([
            {
              name: "p",
              results: withPerson({ name: "Sam Rivera", pronoun }),
            },
          ]),
        );
    });

    it("names that person on the run's page: its lead, its asker line, its initial and its title", () => {
      for (const [pronoun, site] of sites) {
        const html = page(`instances/${ID}.html`, site);
        assert.match(
          text(element(html, /<p class="lead"/)),
          /Sam Rivera.s records/,
          pronoun,
        );
        assert.match(
          text(element(html, /<div class="ask"/)),
          /Sam Rivera asks/,
          pronoun,
        );
        assert.match(element(html, /<div class="av"/), />S</, pronoun);
        assert.match(html, /<title>[^<]*Sam Rivera/, pronoun);
      }
    });

    it("writes the lead with the recorded pronoun", () => {
      for (const [pronoun, site] of sites) {
        const lead = text(
          element(page(`instances/${ID}.html`, site), /<p class="lead"/),
        );
        assert.ok(lead.includes(`${pronoun} words`), lead);
        assert.equal(/\b(her|she)\b/i.test(lead), false, lead);
      }
    });

    it("names that person on the front page, and no other", () => {
      for (const [pronoun, site] of sites) {
        const front = text(page("index.html", site));
        assert.match(front, /Sam Rivera/, pronoun);
        assert.equal(/Tamsin/.test(front), false, pronoun);
      }
    });

    it('names that person on how the test works, with no "her" and no "she"', () => {
      for (const [pronoun, site] of sites) {
        const how = text(page("how_it_works.html", site));
        assert.match(how, /Sam Rivera/, pronoun);
        assert.equal(/\b(her|she)\b/i.test(how), false, pronoun);
      }
    });

    it("names that person on the person's page", () => {
      for (const [pronoun, site] of sites)
        assert.match(
          text(page("people/tamsin-vale.html", site)),
          /Sam Rivera/,
          pronoun,
        );
    });
  });

  describe("with how the test works", () => {
    const how = text(page("how_it_works.html"));

    it("says each pod's build time, whole and per question", () => {
      assert.match(how, /3\.1 s/);
      assert.match(how, /0\.62 s/);
    });

    it("says that the build made no model calls", () => {
      assert.match(how, /no model calls/);
    });

    it("says `not timed` for a pod whose build time was not recorded", () => {
      const untimed = text(
        page(
          "how_it_works.html",
          renderSite([
            {
              name: "u",
              results: {
                ...recorded,
                cases: recorded.cases.map((it) => ({ ...it, build: null })),
              },
            },
          ]),
        ),
      );
      assert.match(untimed, /not timed/);
    });

    it("counts the tells: how many terms, in how many answers", () => {
      assert.match(how, /4 terms in 3 answers could have given an arm away/);
    });
  });

  describe("given results with no tells recorded", () => {
    it("says nothing of tells on any page", () => {
      const without = JSON.parse(
        JSON.stringify(recorded, (key, value: unknown) =>
          key === "blinding" ? undefined : value,
        ),
      ) as Results;
      const quiet = renderSite([{ name: "q", results: without }]);
      assert.equal(
        /tell the arms apart|given an arm away|left in and recorded/.test(
          [...quiet.values()].join(" "),
        ),
        false,
      );
    });
  });
});

/**
 * `renderSite()` returns every page by its path, and `buildSite()` writes them.
 */
describe("Publishing the report · renderSite(), buildSite()", () => {
  describe("renderSite(runs)", () => {
    it("returns pages whose every link is to a page it returns, for one run and for two", () => {
      const sets = [
        one,
        renderSite([
          { name: "fixture-1", results: recorded },
          {
            name: "fixture-2",
            results: asModel("fixture-2", "claude-haiku-5-5"),
          },
        ]),
      ];
      for (const site of sets)
        for (const [path, html] of site)
          for (const [, href] of html.matchAll(
            /\shref="([^"#]+)(?:#[^"]*)?"/g,
          )) {
            if (/^(https?:|mailto:)/.test(href!)) continue;
            const target = posix.normalize(
              posix.join(posix.dirname(path), href!),
            );
            assert.ok(
              site.has(target),
              `${path} links to ${href}, which is not a page`,
            );
          }
    });
  });

  describe("given a case with no questions", () => {
    it("renders no `NaN` and no `Infinity`, on any page", () => {
      const empty = renderSite([
        {
          name: "e",
          results: {
            ...recorded,
            cases: recorded.cases.map((it) => ({
              ...it,
              sessions: it.sessions.map((s) => ({ ...s, questions: [] })),
            })),
          },
        },
      ]);
      for (const [path, html] of empty)
        assert.equal(/NaN|Infinity/.test(html), false, path);
    });
  });

  describe("buildSite({ run }, out)", () => {
    let out: string;
    let index: string;

    before(async () => {
      const results = join(folder, "run");
      await mkdir(results, { recursive: true });
      await writeFile(join(results, "results.json"), JSON.stringify(recorded));
      out = join(folder, "site");
      index = await buildSite({ run: results }, out);
    });

    it("writes every page `renderSite()` returns, under `out`", () => {
      for (const path of one.keys())
        assert.ok(existsSync(join(out, ...path.split("/"))), path);
    });

    it("returns the path of the `index.html` it wrote", () => {
      assert.equal(index, join(out, "index.html"));
    });

    it("puts each page inside the header and footer it is given, but not a page made for paper", async () => {
      const chrome = {
        head: "<style>.given{}</style>",
        header: "<header>given header</header>",
        footer: "<footer>given footer</footer>",
      };
      const inside = join(folder, "inside");
      await buildSite({ run: join(folder, "run") }, inside, undefined, chrome);
      let paper = 0;
      for (const path of one.keys()) {
        const html = await readFile(join(inside, ...path.split("/")), "utf8");
        if (html.includes(`<body class="printpage">`)) {
          paper += 1;
          assert.ok(!html.includes("given"), path);
          continue;
        }
        const main = html.indexOf(`<main id="main">`);
        assert.ok(html.indexOf(chrome.head) < html.indexOf("</head>"), path);
        assert.ok(html.indexOf(chrome.head) > 0, path);
        assert.ok(html.indexOf(chrome.header) > html.indexOf("<body"), path);
        assert.ok(html.indexOf(chrome.header) < main, path);
        assert.ok(html.indexOf(chrome.footer) > html.indexOf("</main>"), path);
        assert.ok(html.indexOf(chrome.footer) > 0, path);
      }
      assert.ok(paper > 0, "the fixture has a page made for paper");
    });
  });

  describe("renderSite(runs, history, home)", () => {
    it("gives every page a first breadcrumb to `home`, from whatever folder the page is in", () => {
      const history = renderSite(
        [
          { name: "a", results: asModel("a", "claude-opus-5-5") },
          { name: "b", results: asModel("b", "claude-opus-5-5") },
        ],
        true,
        "../index.html",
      );
      assert.ok(history.size > 4);
      for (const [path, html] of history) {
        const up = "../".repeat(path.split("/").length - 1);
        assert.ok(
          html.includes(`<a href="${up}../index.html">Cascade pods</a>`),
          `${path} links the page above the report`,
        );
      }
    });
  });

  describe("with no `home`", () => {
    it("gives no page that breadcrumb", () => {
      for (const [path, html] of one)
        assert.ok(!html.includes("Cascade pods"), path);
    });
  });
});

describe("The recorded run the report's tests read", () => {
  describe("given the recorded run's `results.json`", () => {
    it("holds to the results schema", () => {
      assert.deepEqual(errorsOf("results", recorded), []);
    });

    it("holds the instances `instancesOf()` gives of its own jobs, grades, checks and answers", () => {
      assert.deepEqual(
        instancesOf(
          recorded.jobs,
          recorded.grades,
          recorded.checks,
          recorded.answers,
          new Map(recorded.cases.map((it) => [it.id, it.key as never])),
        ),
        recorded.instances,
      );
    });

    it("holds every subject job with as many calls as its stats count, and its opening prompt", () => {
      for (const job of recorded.jobs.filter((it) => it.role === "subject")) {
        assert.equal(job.calls?.length, job.stats?.calls, job.id);
        assert.ok((job.promptText ?? "") !== "", job.id);
      }
    });

    it("holds a question that both arms were asked and charged for and neither answered", () => {
      const jobs = recorded.jobs.filter(
        (it) => it.role === "subject" && it.session === "checkup",
      );
      assert.ok(jobs.length > 0);
      for (const job of jobs) {
        assert.ok(
          recorded.asked.some(
            (it) => it.job === job.id && it.question === "last-a1c",
          ),
          `${job.id} was asked it`,
        );
        assert.ok(
          job.split?.questions["last-a1c"],
          `${job.id} was charged for it`,
        );
        assert.equal(recorded.answers[job.id]?.["last-a1c"], undefined);
      }
    });

    it("holds the case's person, day and description", () => {
      const [only] = recorded.cases;
      assert.equal(only!.person.name, "Tamsin Vale");
      assert.equal(only!.today, "2026-10-30");
      assert.ok(only!.description.who.startsWith("Tamsin Vale, born"));
    });
  });
});
