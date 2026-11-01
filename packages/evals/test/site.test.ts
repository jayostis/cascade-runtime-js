import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import type { Results } from "../src/results.js";
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

/** The same run as another model's, to see two models and two runs side by side. */
const asModel = (name: string, model: string): Results => {
  const text = JSON.stringify(recorded)
    .replaceAll("opus-5-5", model.replace(/^claude-/, ""))
    .replaceAll("claude-opus-5-5", model)
    .replace('"id": "fixture-1"', `"id": "${name}"`);
  return JSON.parse(text) as Results;
};

const one = renderSite([{ name: "fixture-1", results: recorded }]);
const page = (path: string) => {
  const html = one.get(path);
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
const arm = (q: string, which: string) =>
  element(
    element(run, new RegExp(`<section[^>]*id="q_${q}"`)),
    new RegExp(`<div[^>]*class="arm"[^>]*data-arm="${which}"`),
  );
const tab = (q: string, which: string, name: string) =>
  element(arm(q, which), new RegExp(`<div[^>]*data-tab="${name}"`));

test("the front page: a row per model with each arm's key items right as counts, the typical cost per answer, and a row per run instance that opens its run; judging is the test's overhead, in no arm", () => {
  const sonnet = asModel("fixture-2", "claude-sonnet-5-5");
  const front = renderSite([
    { name: "fixture-1", results: recorded },
    { name: "fixture-2", results: sonnet },
  ]);
  const index = front.get("index.html")!;
  const models = [...index.matchAll(/<tr[^>]*data-model="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(models.sort(), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  const [instance] = recorded.instances;
  for (const which of ARMS) {
    const a = instance!.arms[which]!;
    const right = a.expected.found + a.traps.avoided;
    const of = a.expected.of + a.traps.of;
    const cell = text(
      element(
        element(index, /<tr[^>]*data-model="claude-opus-5-5"/),
        new RegExp(`<td[^>]*data-arm="${which}"`),
      ),
    );
    assert.match(cell, new RegExp(`${right} of ${of}`));
  }
  assert.match(
    text(
      element(
        element(index, /<tr[^>]*data-model="claude-opus-5-5"/),
        /<td[^>]*data-cell="cost"/,
      ),
    ),
    /\$0\.\d+/,
  );
  assert.equal(/\d%/.test(text(index)), false, "counts, never percentages");
  const rows = [...index.matchAll(/<a[^>]*class="runrow"[^>]*>/g)].map(
    (m) => m[0],
  );
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((it) => /href="runs\/fixture-[12]\/instances\//.test(it)),
  );
  const row = text(
    element(
      index,
      /<a[^>]*class="runrow"[^>]*data-instance="tamsin-vale\.opus-5-5\.r1"/,
    ),
  );
  assert.match(row, /judging \$0\.15\d? .*charged to neither arm/);
  for (const which of ARMS)
    assert.equal(
      /judging/.test(
        text(element(index, new RegExp(`<div[^>]*data-arm="${which}"`))),
      ),
      false,
      `${which}'s block holds no judging`,
    );
  assert.match(index, /href="how_it_works\.html"/);
});

test("a run page: each question in her words, both answers exactly as given with tabs Answer, Reasoning and Show my doctor, cost per answer, the exact prompt one click away", () => {
  for (const [q, asks] of [
    ["checkup", /I have a check-up coming/],
    ["medications", /What medications am I on right now\?/],
    ["blood-clot", /Did I ever have a blood clot in my lung\?/],
    ["allergies", /Am I allergic to anything\?/],
  ] as const) {
    const section = element(run, new RegExp(`<section[^>]*id="q_${q}"`));
    assert.match(text(element(section, /<div[^>]*class="bubble"/)), asks);
    for (const which of ARMS) {
      const names = [
        ...arm(q, which).matchAll(/<label[^>]*data-tab-label="(\w+)"/g),
      ].map((m) => m[1]);
      assert.deepEqual(names, ["answer", "reasoning", "doctor"]);
    }
  }
  assert.match(
    text(tab("checkup", "pod", "answer")),
    /Two things stand out for your check-up/,
  );
  assert.match(
    text(tab("medications", "records", "answer")),
    /so I treat it as stopped/,
  );
  const cost = text(element(arm("checkup", "pod"), /<div[^>]*class="cost"/));
  assert.match(cost, /30,440 tokens/);
  assert.match(cost, /\$0\.11/);
  assert.match(cost, /2 min/);
  assert.match(
    text(element(arm("checkup", "records"), /<div[^>]*class="cost"/)),
    /54,000 .*grab bag's files/,
  );
  const prompt = text(
    element(
      element(run, /<section[^>]*id="q_allergies"/),
      /<details[^>]*class="fold prompt"/,
    ),
  );
  assert.match(prompt, /Am I allergic to anything\?/);
  assert.match(
    text(run),
    /prompts\/tamsin-vale\.checkup\.pod\.opus-5-5\.r1\.txt/,
  );
});

test("a run page states the test's overhead apart from both arms, the pod build only by link, the key as a closed reference, and what is beyond it as possibly good", () => {
  const overhead = text(element(run, /<aside[^>]*class="overhead"/));
  assert.match(overhead, /haiku-5-5/);
  assert.match(overhead, /sonnet-5-5/);
  assert.match(overhead, /charged to neither arm/);
  for (const q of ["checkup", "blood-clot"])
    for (const which of ARMS)
      assert.equal(
        /haiku|sonnet|judging/i.test(
          text(element(arm(q, which), /<div[^>]*class="cost"/)),
        ),
        false,
      );
  assert.equal(
    /3\.1 s/.test(text(run)),
    false,
    "the build is said once, on how_it_works",
  );
  const key = element(
    element(run, /<section[^>]*id="q_checkup"/),
    /<details[^>]*class="fold key"/,
  );
  assert.equal(
    /^<details[^>]*\bopen\b/.test(key),
    false,
    "the key starts closed",
  );
  assert.match(text(key), /a reference, not a verdict/);
  assert.match(text(key), /Urine albumin-to-creatinine ratio never done/);
  const beyond = text(element(key, /<tr[^>]*class="beyond"/));
  assert.match(beyond, /possibly good/);
  assert.match(beyond, /Your cholesterol may be due for a recheck/);
  const split = text(
    element(
      element(run, /<section[^>]*id="q_allergies"/),
      /<tr[^>]*class="beyond"/,
    ),
  );
  assert.match(split, /speculative/);
  assert.match(split, /true, not planted/);
});

test("the pod's graph is the agent's citations plus the pod's own provenance lookups; where a lookup finds nothing it says so", () => {
  const reasoning = text(tab("medications", "pod", "reasoning"));
  for (const said of [
    "story-stopped-med-1",
    "3 revisions",
    "Cascade North Demo Hospital",
    "2024-02-01",
    "2026-10-15",
  ])
    assert.ok(reasoning.includes(said), `the medications graph shows ${said}`);
  const checkup = text(tab("checkup", "pod", "reasoning"));
  assert.match(checkup, /30 rows back/);
  assert.match(checkup, /41 ms/);
  const clot = tab("blood-clot", "pod", "reasoning");
  assert.match(text(clot), /no such record/);
  assert.ok(/class="ck bad"/.test(clot), "the failed citation is marked");
  assert.equal(
    /story-stopped-med-1|north-2026-10/.test(text(clot)),
    false,
    "nothing is drawn beyond what was looked up",
  );
  assert.match(
    text(checkup),
    /a later procedure would have been the colonoscopy/,
  );
  assert.match(
    text(checkup),
    /A lipid panel is usually repeated 4 to 12 weeks/,
  );
  assert.match(text(checkup), /not from the records/);
});

test("the grab bag's graph ends at the passage the agent's citation names; a link between files exists only where the agent wrote one", () => {
  const meds = tab("medications", "records", "reasoning");
  const said = text(meds);
  assert.match(said, /north-2026-10\/bundle\.json:300-318/);
  assert.match(said, /\/entry\/11\/resource/);
  assert.match(said, /retrieved 2026-10-15/);
  assert.match(said, /the later copy closes the earlier one/);
  const clot = text(tab("blood-clot", "records", "reasoning"));
  assert.match(clot, /No pulmonary embolism\. Lungs are clear/);
  assert.equal(
    /Agent's link/.test(clot),
    false,
    "the agent wrote no link here",
  );
  const checkup = text(tab("checkup", "records", "reasoning"));
  assert.match(checkup, /her diabetes is the usual reason a statin is started/);
  assert.match(checkup, /sources leave out north-2024-02\/bundle\.json/);
  const allergies = text(tab("allergies", "records", "reasoning"));
  assert.match(allergies, /6 files/);
  assert.match(allergies, /did not name its sources/);
});

test("the doctor card is a tab of its own: the question, the short answer and each dated fact with its source, without the model's own knowledge", () => {
  const pod = text(tab("checkup", "pod", "doctor"));
  assert.match(pod, /You asked/);
  assert.match(pod, /Ask about a urine albumin test/);
  assert.match(pod, /The stool test \(FIT\) was positive on 2025-11-04/);
  assert.match(
    pod,
    /2025-11-04 .*Cascade North Demo Hospital, download of 2026-10-15/,
  );
  assert.match(pod, /Looked for and not found: A colonoscopy after 2025-11-04/);
  assert.equal(/lipid panel is usually repeated/.test(pod), false);
  const bag = text(tab("blood-clot", "records", "doctor"));
  assert.match(bag, /D-dimer was 0\.92 mg\/L FEU/);
  assert.match(bag, /Cascade North Demo Hospital, download of 2026-10-15/);
});

test("each run has a print view of every doctor card for one arm, one click from the run page, with a link to the other arm's", () => {
  assert.match(run, new RegExp(`href="${ID}\\.print-pod\\.html"`));
  assert.match(run, new RegExp(`href="${ID}\\.print-records\\.html"`));
  for (const [which, other, answered] of [
    ["pod", "records", 4],
    ["records", "pod", 4],
  ] as const) {
    const print = page(`instances/${ID}.print-${which}.html`);
    assert.equal(
      [...print.matchAll(/<article[^>]*class="card"/g)].length,
      answered,
    );
    assert.match(print, new RegExp(`href="${ID}\\.print-${other}\\.html"`));
    assert.match(print, /@media print/);
    const said = text(print);
    assert.match(said, /I have a check-up coming/);
    assert.match(said, /Cascade North Demo Hospital, download of 2026-10-15/);
    assert.equal(
      /lipid panel is usually repeated|haiku|\$\d/.test(said),
      false,
    );
  }
});

test("a page renders only what results.json holds: with its evidence removed there is no passage, no provenance and no date a lookup would have given", () => {
  const bare = renderSite([
    { name: "bare", results: { ...recorded, evidence: [] } },
  ]).get(`instances/${ID}.html`)!;
  const pod = text(
    element(
      element(bare, /<section[^>]*id="q_medications"/),
      /<div[^>]*data-arm="pod"/,
    ),
  );
  const bag = text(
    element(
      element(bare, /<section[^>]*id="q_medications"/),
      /<div[^>]*data-arm="records"/,
    ),
  );
  assert.equal(/story-stopped-med-1|3 revisions/.test(pod), false);
  assert.equal(/:300-318|\/entry\/11/.test(bag), false);
  assert.match(pod, /Jardiance 10 mg is active/);
  assert.equal(/download of 2026/.test(pod + bag), false);
});

test("how the test works says the pod's build once, amortised per question, and the other pages leave it to a link", () => {
  const how = text(page("how_it_works.html"));
  assert.match(how, /3\.1 s/);
  assert.match(how, /0\.62 s/);
  assert.match(how, /no model calls/);
  const untimed = text(
    renderSite([
      {
        name: "u",
        results: {
          ...recorded,
          cases: recorded.cases.map((it) => ({ ...it, build: null })),
        },
      },
    ]).get("how_it_works.html")!,
  );
  assert.match(untimed, /not timed/);
});

test("every page links only to pages the site holds, in one run and in the history", async () => {
  const sets = [
    one,
    renderSite([
      { name: "fixture-1", results: recorded },
      { name: "fixture-2", results: asModel("fixture-2", "claude-haiku-5-5") },
    ]),
  ];
  for (const site of sets)
    for (const [path, html] of site) {
      for (const [, href] of html.matchAll(/\shref="([^"#]+)(?:#[^"]*)?"/g)) {
        if (/^(https?:|mailto:)/.test(href!)) continue;
        const target = posix.normalize(posix.join(posix.dirname(path), href!));
        assert.ok(
          site.has(target),
          `${path} links to ${href}, which is not a page`,
        );
      }
    }
  const results = join(folder, "run");
  await mkdir(results, { recursive: true });
  await writeFile(join(results, "results.json"), JSON.stringify(recorded));
  const out = join(folder, "site");
  const index = await buildSite({ run: results }, out);
  assert.equal(index, join(out, "index.html"));
  for (const path of one.keys())
    assert.ok(existsSync(join(out, ...path.split("/"))), path);
  assert.equal(dirname(index), out);
});
