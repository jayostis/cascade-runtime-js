// The comparison page: every recorded run side by side, each arm's count of what it got right and the difference, by run,
// by model and by person. Only figures added up from results.json, by the measure the front page uses.
import type { Arm } from "./prompts.js";
import type { ArmSummary, Instance, Results } from "./results.js";
import { type Where } from "./site-run.js";
import { hrefTo, page } from "./site-page.js";
import {
  ARMS,
  ARM_NAME,
  badge,
  day,
  esc,
  modelName,
  personIn,
} from "./site-text.js";

export interface Entry {
  readonly name: string;
  readonly results: Results;
  readonly instance: Instance;
  readonly where: Where;
}

/** The crumbs ahead of the report's own: the page the report is published under, when it is. */
export type Above = readonly (readonly [string, string?])[];

/** What an arm got right: the key's expected items said and its traps avoided, as counts. */
export function tally(arms: readonly (ArmSummary | undefined)[]) {
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

/** Runs whose grab-bag counts are known to repeat another run's, because answers were reused. */
export const REUSED_ANSWERS = [
  "2026-11-04-1ea2f8f-custom",
  "2026-11-04-3d96d2f-custom",
];
export const REUSED_ISSUE =
  "https://github.com/jayostis/cascade-runtime-js/issues/783";

const note = (name: string, arm: Arm) =>
  arm === "records" && REUSED_ANSWERS.includes(name)
    ? `<div class="tiny muted">same counts as the other 2026-11-04 run: answers were reused, <a href="${REUSED_ISSUE}">#783</a></div>`
    : "";

const cell = (arm: Arm, group: readonly Entry[]) => {
  const ran = group.filter((e) => e.instance.arms[arm] !== undefined);
  if (ran.length === 0)
    return `<td data-arm="${arm}"><span class="small muted">did not run</span></td>`;
  const t = tally(ran.map((e) => e.instance.arms[arm]));
  return `<td data-arm="${arm}"><b>${t.right} of ${t.of}</b>${note(group[0]!.name, arm)}</td>`;
};

const difference = (group: readonly Entry[]) => {
  const [pod, records] = ARMS.map((arm) =>
    tally(group.map((e) => e.instance.arms[arm])),
  ) as [ReturnType<typeof tally>, ReturnType<typeof tally>];
  const ran = ARMS.every((arm) =>
    group.every((e) => e.instance.arms[arm] !== undefined),
  );
  if (!ran || pod.of !== records.of)
    return `<td data-cell="difference" class="n muted">–</td>`;
  const d = pod.right - records.right;
  return `<td data-cell="difference" class="n"><b>${d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"}</b></td>`;
};

const head = (first: string) =>
  `<thead><tr><th>${first}</th><th>${ARM_NAME.pod}: right</th><th>${ARM_NAME.records}: right</th><th title="${ARM_NAME.pod} minus ${ARM_NAME.records}">Difference</th></tr></thead>`;

const sha = (r: Results) => r.versions.harness.commit.slice(0, 7);

/** The runs in the order given, each with its entries. */
function runsOf(entries: readonly Entry[]): [string, Entry[]][] {
  const runs = new Map<string, Entry[]>();
  for (const e of entries) runs.set(e.name, [...(runs.get(e.name) ?? []), e]);
  return [...runs];
}

const instanceLinks = (from: string, group: readonly Entry[]) =>
  group
    .map(
      (e) =>
        `<a href="${hrefTo(from, e.where.run)}">${esc(modelName(e.instance.model))} · ${esc(personIn(e.results, e.instance.case).name)} · run ${e.instance.repeat}</a>`,
    )
    .join(" · ");

function byRun(from: string, entries: readonly Entry[]): string {
  const rows = runsOf(entries).map(([name, group]) => {
    const r = group[0]!.results;
    const models = [...new Set(group.map((e) => e.instance.model))].sort();
    const people = [...new Set(group.map((e) => e.instance.case))].map(
      (id) => personIn(r, id).name,
    );
    const questions = new Set(
      r.cases.flatMap((c) => c.sessions.flatMap((s) => s.questions)),
    ).size;
    return `<tr data-run="${esc(name)}"><td><b>${esc(day(r.run.finished))}</b> · commit <code>${esc(sha(r))}</code><div class="tiny muted">${esc(models.map(modelName).join(", "))}</div><div class="tiny muted">${people.map(esc).join(", ")} · ${group.length} instance${group.length === 1 ? "" : "s"}${questions === 0 ? "" : ` · ${questions} questions`} · ${r.run.config.repeats} repeat${r.run.config.repeats === 1 ? "" : "s"}</div><div class="tiny">${instanceLinks(from, group)}</div></td>${ARMS.map((arm) => cell(arm, group)).join("")}${difference(group)}</tr>`;
  });
  return `<div class="hl"><table class="headline" data-table="runs">${head("Run")}<tbody>${rows.join("")}</tbody></table></div>`;
}

/** One row per (group, run), in the order the groups first come, and each group's runs newest first. */
function breakdown(
  from: string,
  entries: readonly Entry[],
  table: string,
  first: string,
  key: (e: Entry) => [string, string],
): string {
  const groups = new Map<string, { label: string; entries: Entry[] }>();
  for (const e of entries) {
    const [id, label] = key(e);
    const g = groups.get(id) ?? { label, entries: [] };
    g.entries.push(e);
    groups.set(id, g);
  }
  const rows = [...groups].flatMap(([id, g]) =>
    runsOf(g.entries).map(([name, group]) => {
      const r = group[0]!.results;
      return `<tr data-group="${esc(id)}" data-run="${esc(name)}"><td><b>${esc(g.label)}</b><div class="tiny muted"><a href="${hrefTo(from, group[0]!.where.run)}">${esc(day(r.run.finished))} · <code>${esc(sha(r))}</code></a> · ${group.length} instance${group.length === 1 ? "" : "s"}</div></td>${ARMS.map((arm) => cell(arm, group)).join("")}${difference(group)}</tr>`;
    }),
  );
  return `<div class="hl"><table class="headline" data-table="${table}">${head(first)}<tbody>${rows.join("")}</tbody></table></div>`;
}

export function comparePage(entries: readonly Entry[], above: Above): string {
  const from = "compare.html";
  const reused = runsOf(entries).some(([name]) =>
    REUSED_ANSWERS.includes(name),
  );
  const body = `<p class="small muted">Cascade evals · <a href="${hrefTo(from, "index.html")}">the front page</a> · <a href="${hrefTo(from, "how_it_works.html")}">how the test works</a></p>
<h1>Runs side by side: ${badge("pod")} against ${badge("records")}</h1>
<p class="lead">Every recorded run, with what each way of giving a model a person's records got right. The same model answers the same questions both ways. &ldquo;Right&rdquo; counts the answer key's expected items said and its traps avoided, over every question asked, as counts, the same measure as the front page. The difference is ${ARM_NAME.pod} minus ${ARM_NAME.records}: above zero, the pod got more right.</p>
<p class="small muted">Added up from each run's results.json. These are ${new Set(entries.flatMap((e) => e.results.cases.map((c) => c.id))).size} made-up people and a few sittings; read a count as what happened in that run, not as a rate to expect.${reused ? ` Two runs share their grab-bag counts because their answers were reused: <a href="${REUSED_ISSUE}">#783</a> tracks it.` : ""}</p>
<h2>By run</h2>
${byRun(from, entries)}
<h2>By model, in each run</h2>
${breakdown(from, entries, "models", "Model", (e) => [e.instance.model, modelName(e.instance.model)])}
<h2>By person, in each run</h2>
${breakdown(from, entries, "people", "Person", (e) => [e.instance.case, personIn(e.results, e.instance.case).name])}`;
  return page({
    path: from,
    title: "Runs side by side — Cascade evals",
    crumbs: [...above, ["Cascade evals", "index.html"], ["Runs side by side"]],
    body,
  });
}
