// The report site, generated from results.json alone and never edited by hand: a front page (how each model did, then
// every run instance), a page and two print views per instance, and one page on how the test works. Both arms get the
// same treatment on every page.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { HISTORY } from "./paths.js";
import type { Arm } from "./prompts.js";
import type { ArmSummary, Instance, Results } from "./results.js";
import { runFolder } from "./results.js";
import { valid } from "./schemas.js";
import { hrefTo, page } from "./site-page.js";
import { runPages, whereIs } from "./site-run.js";
import {
  ARMS,
  ARM_NAME,
  badge,
  dollars,
  esc,
  mark,
  median,
  modelName,
  personIn,
  personPath,
  seconds,
  thousands,
} from "./site-text.js";

interface Entry {
  readonly name: string;
  readonly results: Results;
  readonly instance: Instance;
  readonly where: ReturnType<typeof whereIs>;
}

/** What an arm got right: the key's expected items said and its traps avoided, as counts. */
function tally(arms: readonly (ArmSummary | undefined)[]) {
  const of = (pick: (a: ArmSummary) => number) =>
    arms.reduce((sum, a) => sum + (a === undefined ? 0 : pick(a)), 0);
  return {
    right: of((a) => a.expected.found + a.traps.avoided),
    partly: of((a) => a.expected.partly),
    of: of((a) => a.expected.of + a.traps.of),
    split: of((a) => a.expected.split + a.traps.split),
    ungraded: of((a) => a.expected.ungraded + a.traps.ungraded),
    unanswered: of((a) => a.expected.unanswered + a.traps.unanswered),
    contradicted: of((a) => a.traps.raised + a.beyond.contradicted),
    beyond: of(
      (a) => a.beyond.fair + a.beyond.trueNotPlanted + a.beyond.speculative,
    ),
    beyondSplit: of((a) => a.beyond.split),
  };
}

const dots = (t: ReturnType<typeof tally>) => {
  if (t.of === 0 || t.of > 30) return "";
  const open = t.split + t.ungraded + t.unanswered;
  const cells = [
    ...Array<string>(t.right).fill("d-yes"),
    ...Array<string>(t.partly).fill("d-part"),
    ...Array<string>(open).fill("d-open"),
    ...Array<string>(Math.max(0, t.of - t.right - t.partly - open)).fill(
      "d-no",
    ),
  ];
  return `<span class="dots">${cells.map((c) => `<span class="dot ${c}"></span>`).join("")}${t.contradicted === 0 ? "" : `<span class="dot d-contra" title="said something the records contradict">!</span>`}</span>`;
};

const extras = (t: ReturnType<typeof tally>) => {
  const parts = [
    t.partly > 0 && `${t.partly} partly`,
    t.split > 0 && `judges split on ${t.split}`,
    t.ungraded > 0 && `${t.ungraded} not graded`,
    t.unanswered > 0 && `${t.unanswered} unanswered`,
    t.beyondSplit > 0 &&
      `judges split on ${t.beyondSplit} raised beyond the key`,
  ].filter((it) => it !== false);
  return `${parts.length === 0 ? "" : `<div class="tiny muted">${parts.join(" · ")}</div>`}${t.contradicted === 0 ? "" : `<div class="tiny bad">${t.contradicted} said something the records contradict</div>`}`;
};

const perAnswer = (a: ArmSummary | undefined) =>
  a === undefined || a.usd === null || a.questions === 0
    ? undefined
    : a.usd / a.questions;

function headline(entries: readonly Entry[]): string {
  const models = [...new Set(entries.map((it) => it.instance.model))].sort();
  return `<div class="hl"><table class="headline"><thead><tr><th>Model</th><th>Runs</th><th>${ARM_NAME.pod}: right</th><th>${ARM_NAME.records}: right</th><th>Typical cost per answer<br><span class="tiny">${ARM_NAME.pod} · ${ARM_NAME.records}</span></th></tr></thead><tbody>${models
    .map((model) => {
      const own = entries.filter((it) => it.instance.model === model);
      const cells = ARMS.map((arm) => {
        const t = tally(own.map((it) => it.instance.arms[arm]));
        return `<td data-arm="${arm}"><b>${t.right} of ${t.of}</b> ${dots(t)}${extras(t)}</td>`;
      }).join("");
      const typical = ARMS.map((arm) =>
        dollars(
          median(own.flatMap((it) => perAnswer(it.instance.arms[arm]) ?? [])),
        ),
      );
      return `<tr data-model="${esc(model)}"><td><b>${esc(modelName(model))}</b><div class="tiny muted">${esc(model)}</div></td><td>${own.length} run${own.length === 1 ? "" : "s"}</td>${cells}<td class="money" data-cell="cost"><b>${typical[0]}</b> · <b>${typical[1]}</b></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function runRow(from: string, e: Entry): string {
  const { instance: i } = e;
  const arm = (which: Arm) => {
    const a = i.arms[which];
    if (a === undefined)
      return `<div class="res" data-arm="${which}">${badge(which)} <span class="small muted">did not run</span></div>`;
    const t = tally([a]);
    return `<div class="res" data-arm="${which}"><div>${badge(which)} ${dots(t)} <span class="small"><b>${t.right} of ${t.of}</b>${t.beyond === 0 ? "" : ` · +${t.beyond} beyond the key`}</span></div>${extras(t)}<div class="money"><b>${dollars(a.usd)}</b> · ${seconds(a.seconds)} · ${thousands(a.tokens)} tokens</div><div class="tiny muted">${a.citations.held} of ${a.citations.held + a.citations.failed} cited facts borne out</div></div>`;
  };
  return `<a class="runrow" data-instance="${esc(i.id)}" href="${hrefTo(from, e.where.run)}"><div class="who"><b>${esc(modelName(i.model))} · run ${i.repeat}</b><div class="tiny muted">${esc(personIn(e.results, i.case).name)} · ${esc(e.name)} · ${esc(e.results.run.finished.slice(0, 10))}</div></div>${ARMS.map(arm).join("")}<div class="overhead">judging ${dollars(i.judging.usd)} (the test's overhead, charged to neither arm)</div></a>`;
}

/** Each person the runs are about, once, in the order the runs come. */
function people(entries: readonly Entry[]): [string, string][] {
  const seen = new Map<string, string>();
  for (const e of entries)
    for (const c of e.results.cases)
      if (!seen.has(c.id)) seen.set(c.id, c.person.name);
  return [...seen];
}

function personPage(id: string, entries: readonly Entry[]): string {
  const path = personPath(id);
  const own = entries.filter((e) => e.results.cases.some((c) => c.id === id));
  const c = own[0]!.results.cases.find((it) => it.id === id)!;
  const { name } = c.person;
  const body = `<p class="small muted">A synthetic person · as of ${esc(c.today)} · <a href="https://github.com/jayostis/cascade-runtime-js/tree/main/packages/evals/cases/${esc(id)}">the case files and answer key</a></p>
<h1>${esc(name)}</h1>
<dl class="story"><dt>Who</dt><dd>${esc(c.description.who)}</dd>
<dt>The records</dt><dd>${esc(c.description.sources)}</dd>
<dt>What is planted</dt><dd>${esc(c.description.planted)}</dd>
<dt>Why ${esc(name)} is here</dt><dd>${esc(c.description.summary)}</dd></dl>
<h2>Runs about ${esc(name)}</h2>
<div class="runs">${own
    .filter((e) => e.instance.case === id)
    .map((e) => runRow(path, e))
    .join("")}</div>`;
  return page({
    path,
    title: `${name} — Cascade evals`,
    crumbs: [["Cascade evals", "index.html"], [name]],
    body,
  });
}

function frontPage(entries: readonly Entry[]): string {
  const from = "index.html";
  const latest = entries[0];
  const body = `<p class="small muted">Cascade evals${latest === undefined ? "" : ` · latest run ${esc(latest.results.run.id)} · ${esc(latest.results.run.finished.slice(0, 10))}`} · <a href="${hrefTo(from, "how_it_works.html")}">how the test works</a></p>
<h1>Ask your health records a question. Which answer would you rather get?</h1>
<p class="lead">Cascade joins a person's downloaded health records into one <b>pod</b>: one entry per real thing, with its history across sources, read by a model through tools. The <b>grab bag</b> is the same downloads read whole, as if pasted into the chat. The same model answers the same questions both ways. Below: how each model did, then every run, one row per model per sitting. Open a row to read both answers and the evidence behind each.</p>
<div class="links"><a href="https://github.com/jayostis/cascade-runtime-js#readme">What Cascade is</a><a href="${hrefTo(from, "how_it_works.html")}">How this test works</a>${people(
    entries,
  )
    .map(
      ([id, name]) =>
        `<a href="${hrefTo(from, personPath(id))}">Who ${esc(name)} is →</a>`,
    )
    .join("")}</div>
${
  entries.length === 0
    ? `<p class="muted">No run is recorded yet: <code>npm run evals:record &lt;run&gt;</code> records one.</p>`
    : `<h2>Per model</h2>
<p class="small muted">&ldquo;Right&rdquo; counts the answer key's expected items said and its traps avoided, over every question asked, as counts. An item an answer only half said, a split between judges, a question not answered or not graded is not counted right and is shown beside the count.</p>
${headline(entries)}
<h2>Every run</h2>
<div class="runs">${entries.map((e) => runRow(from, e)).join("")}</div>
<div class="legend"><span>Marks used inside a run:</span>${mark("yes", "said what we expected")}${mark("part", "part of it")}${mark("no", "missed it")}${mark("beyond", "beyond the key: not wrong, possibly good")}${mark("none", "not counted: judges split, unanswered or not graded")}${mark("contra", "said something the records contradict")}</div>`
}`;
  return page({
    path: from,
    title: "Cascade evals — ask your records a question",
    crumbs: [["Cascade evals"]],
    body,
  });
}

/** Each case's pod build, once, from the first run that holds it. */
function builds(runs: readonly { results: Results }[]): string {
  const seen = new Map<string, [string, string]>();
  for (const { results } of runs)
    for (const c of results.cases) {
      if (seen.has(c.id)) continue;
      const questions = c.sessions.reduce(
        (sum, s) => sum + s.questions.length,
        0,
      );
      const b = c.build;
      seen.set(c.id, [
        c.person.name,
        b === null || b === undefined
          ? "not timed"
          : `${b.seconds} s for ${c.imports.length} import${c.imports.length === 1 ? "" : "s"}, ${b.modelCalls === 0 ? "no model calls" : `${b.modelCalls} model calls, ${thousands(b.tokens)} tokens, ${dollars(b.usd)}`}${questions === 0 ? "" : `. Amortised over ${questions} question${questions === 1 ? "" : "s"}: ${(b.seconds / questions).toFixed(2)} s and ${b.usd === 0 ? "$0.00" : dollars(b.usd / questions)} each`}`,
      ]);
    }
  return `<ul>${[...seen.values()].map(([name, what]) => `<li><b>${esc(name)}</b>: ${what}.</li>`).join("")}</ul>`;
}

/** How many answers kept a word that could give the arm away, when the runs recorded it; nothing when they did not. */
function tellsLine(runs: readonly { results: Results }[]): string {
  const recorded = runs.filter((it) => it.results.blinding !== undefined);
  if (recorded.length === 0) return "";
  const tells = recorded.flatMap((it, run) =>
    (it.results.blinding?.tells ?? []).map((t) => ({ ...t, run })),
  );
  const answers = new Set(
    tells.map(
      (t) => `${t.run}
${t.job}
${t.question}`,
    ),
  );
  return ` In the runs recorded here, ${tells.length} term${tells.length === 1 ? "" : "s"} in ${answers.size} answer${answers.size === 1 ? "" : "s"} could have given an arm away.`;
}

function howPage(runs: readonly { results: Results }[]): string {
  const body = `<h1>How the test works</h1>
<p class="lead">A synthetic person with real-shaped downloads and an answer key written before any model ran. The same model answers the person's questions twice: once with the records joined into a Cascade pod and read through tools, once with the same downloads read whole, as if pasted into the chat. Judges score both blind. A program checks every cited fact.</p>
<h2>The two arms</h2>
<dl class="story"><dt>${ARM_NAME.pod}</dt><dd>The downloads are imported into a pod once. The model reaches it only through cascade-mcp's tools, each call logged with its rows and time. It cites a fact as the pod entry a row named: <code>{"entry": "pod://…#…"}</code>.</dd>
<dt>${ARM_NAME.records}</dt><dd>The model is told to read every download file in full, in order, once per chat session. It cites a fact as <code>{"file", "resource"}</code> for FHIR JSON or <code>{"file", "line"}</code> for anything else, and an absence names the files it looked through.</dd></dl>
<h2>No free work</h2>
<p>Everything the report shows as an answer's reasoning or evidence was produced by the answering agent itself: which facts support which point, which absence matters and what was searched for it, what is the model's own knowledge, and any link between records. The harness may only do mechanical work, and does exactly three things:</p>
<ol><li><b>Resolve a citation</b> to the record it names and compare the fields the agent relied on. That is the tick or cross on a fact.</li>
<li><b>Follow the pod's provenance</b> from a cited entry to the member records the pod merged into it, their revisions, and the source documents with their authors and arrival dates; for the grab bag, follow a file and resource to the passage and the folder's download date. That is the right-hand side of every evidence graph. It is a lookup: the joining was done when the pod was built, and the grab bag's graph has no link between files unless the agent wrote one.</li>
<li><b>Render.</b></li></ol>
<p>Nothing infers a link the agent did not state, and nothing explains an answer after the fact. Each arm's graph is exactly as rich as its agent's own output. Were a secondary agent ever used to explain or link, its cost would be added to that arm and shown.</p>
<h2>Judging</h2>
<p>Models score each answer against the key without being told which arm produced it. Answers are scrubbed of what names the arm, but a fixed list of words that cannot be taken out without damaging the prose is left in and recorded.${tellsLine(runs)}</p>
<h2>Costs</h2>
<p>Each answer's cost is shown under it: time, tokens with the cache split, dollars at list prices, and the session's own start beside it (the grab bag reads its files once per session). <b>Judging</b> is the harness's own judgment and is paid by the harness: shown as the test's overhead, separately, never charged to either arm.</p>
<h3 id="build">The pod is built once per person</h3>
<p>The pod's build (import, matching, derivations) sits outside the answering agent's cost: it happens once per person and is reused for every question, in every session, while the grab bag pays to read its files in every chat session. As recorded:</p>
${builds(runs)}
<p class="small muted">Wall time is the build as the harness timed it; any model calls would show their tokens and dollars the same way, per person and per question.</p>
<h2>Scale and small numbers</h2>
<p>A full run is cases × questions × 2 arms × models × repeats, a person's questions batched into chat sessions, in tiers (smoke, full). Results are counts and paired comparisons on the same question, never percentages of a small number.</p>
<h2>The key</h2>
<p>Each person's key says what a careful reader would say and would not, with the records that support each line, written before any run. It is a reference, not the truth: what an answer raises beyond it is shown as possibly good, with the judges' view, never as wrong.</p>
<p class="small muted">Case files and keys: <a href="https://github.com/jayostis/cascade-runtime-js/tree/main/packages/evals/cases">packages/evals/cases</a>. Harness: <a href="https://github.com/jayostis/cascade-runtime-js/tree/main/packages/evals#readme">packages/evals</a>.</p>`;
  return page({
    path: "how_it_works.html",
    title: "How the test works — Cascade evals",
    crumbs: [["Cascade evals", "index.html"], ["How the test works"]],
    body,
  });
}

/**
 * Every page of the site, by path from its root. One run is laid out at the root; several are each under
 * `runs/<name>/`, newest first as given.
 */
export function renderSite(
  runs: readonly { name: string; results: Results }[],
  history = runs.length !== 1,
): Map<string, string> {
  const site = new Map<string, string>();
  const entries: Entry[] = [];
  for (const { name, results } of runs)
    for (const instance of results.instances) {
      const where = whereIs(
        history ? `runs/${name}/instances/` : "instances/",
        instance.id,
      );
      entries.push({ name, results, instance, where });
      for (const [path, html] of runPages(results, instance, where, [
        ["Cascade evals", "index.html"],
      ]))
        site.set(path, html);
    }
  for (const [id] of people(entries))
    site.set(personPath(id), personPage(id, entries));
  site.set("index.html", frontPage(entries));
  site.set("how_it_works.html", howPage(runs));
  return site;
}

async function write(site: Map<string, string>, out: string): Promise<string> {
  for (const [path, html] of site) {
    const file = join(out, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
  }
  return join(out, "index.html");
}

async function load(path: string): Promise<Results> {
  return valid<Results>(
    "results",
    JSON.parse(await readFile(path, "utf8")),
    path,
  );
}

/** Builds the site of one run's folder, or of every run in history/. Returns the index. */
export async function buildSite(
  from: { run?: string; history?: boolean },
  out?: string,
): Promise<string> {
  if (from.history !== true) {
    const folder = runFolder(from.run ?? "");
    const results = await load(join(folder, "results.json"));
    return write(
      renderSite([{ name: results.run.id, results }], false),
      resolve(out ?? join(folder, "site")),
    );
  }
  const runs: { name: string; results: Results }[] = [];
  if (existsSync(HISTORY))
    for (const name of (await readdir(HISTORY)).sort().reverse()) {
      const path = join(HISTORY, name, "results.json");
      if (existsSync(path)) runs.push({ name, results: await load(path) });
    }
  return write(
    renderSite(runs, true),
    resolve(out ?? join(HISTORY, "..", "site")),
  );
}
