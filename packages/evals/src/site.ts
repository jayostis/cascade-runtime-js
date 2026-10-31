// The report site, generated from results.json and the case files and never edited by hand. Four levels, each a click
// deeper: the run's index (the result per input, then every key item), a page per case (its answer key, item by item),
// a page per key item (why the key expects it, what each input said, the evidence folded beneath), and one about page
// that explains the test, which every other page links to rather than repeats. Both inputs get the same treatment.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type Case,
  type Key,
  type KeyItem,
  loadCase,
  loadKey,
} from "./cases.js";
import type { Answer } from "./checks.js";
import type { Claim } from "./citations.js";
import { HISTORY } from "./paths.js";
import type { Grade, Job, Results, Score, Slice } from "./results.js";
import { runFolder } from "./results.js";
import { uncommittedIn } from "./history.js";

const esc = (text: unknown) =>
  String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const thousands = (n: number | undefined | null) =>
  n === undefined || n === null ? "–" : Math.round(n).toLocaleString("en-US");
const dollars = (n: number | undefined | null) =>
  n === undefined || n === null
    ? "–"
    : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const seconds = (n: number | undefined) =>
  n === undefined
    ? "–"
    : n < 90
      ? `${Math.round(n)} s`
      : `${Math.round(n / 60)} min`;
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const plural = (n: number, one: string, many = `${one}s`) =>
  `${num(n)} ${n === 1 ? one : many}`;
const shortModel = (model: string) => model.replace(/^claude-/, "");
const idOf = (item: string) => item.toLowerCase();

const STYLE = `
:root{--bg:#fbfbfa;--fg:#1f2328;--muted:#5d6670;--line:#d8dde3;--card:#fff;--soft:#f2f4f6;
--found:#1a7f37;--found-bg:#dcf3e2;--partly:#9a6700;--partly-bg:#fbefc8;--missed:#c0262d;--missed-bg:#fde2e1;
--know:#6639ba;--know-bg:#efe7fb;--ok:#1a7f37;--bad:#c0262d;--link:#0b5cad;--pod:#0b5cad;--bag:#8a4b08}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111418;--fg:#e6e9ee;--muted:#9aa4af;--line:#2f363e;
--card:#181c21;--soft:#20262d;--found:#4fc26b;--found-bg:#123821;--partly:#e3b341;--partly-bg:#3a2e0b;--missed:#ff7b72;
--missed-bg:#45191a;--know:#b69cf4;--know-bg:#2a1f45;--ok:#4fc26b;--bad:#ff7b72;--link:#6cb6ff;--pod:#6cb6ff;--bag:#e3a35a}}
:root[data-theme=dark]{--bg:#111418;--fg:#e6e9ee;--muted:#9aa4af;--line:#2f363e;--card:#181c21;--soft:#20262d;--found:#4fc26b;
--found-bg:#123821;--partly:#e3b341;--partly-bg:#3a2e0b;--missed:#ff7b72;--missed-bg:#45191a;--know:#b69cf4;--know-bg:#2a1f45;
--ok:#4fc26b;--bad:#ff7b72;--link:#6cb6ff;--pod:#6cb6ff;--bag:#e3a35a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1120px;margin:0 auto;padding:20px 16px 64px}a{color:var(--link)}
header{margin-bottom:18px}h1{font-size:1.65rem;line-height:1.25;margin:.15em 0 .3em}
h2{font-size:1.15rem;margin:2em 0 .5em}h3{font-size:1rem;margin:0 0 .4em}
.crumbs{font-size:.86rem;color:var(--muted);margin-bottom:10px}.crumbs a{text-decoration:none}.crumbs span{margin:0 6px}
.eyebrow{color:var(--muted);font-size:.86rem;margin:0}.lead{font-size:1.02rem;margin:.2em 0;max-width:820px}
.muted{color:var(--muted)}.small{font-size:.86rem}code,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.84em}
.pod-name{color:var(--pod);font-weight:600}.bag-name{color:var(--bag);font-weight:600}
.banner{border:1px solid var(--line);border-left:4px solid var(--partly);background:var(--card);border-radius:8px;padding:10px 12px;margin:12px 0;max-width:820px}
.note{color:var(--bad);font-size:.86rem}
.headline{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline;margin:6px 0 10px}
.better{display:inline-block;border-radius:6px;padding:2px 10px;font-weight:700;background:var(--soft);border:1px solid var(--line)}td .better.tie{background:none;border:0;padding:0;font-weight:400;color:var(--muted)}.table.narrow{max-width:760px}
.better.pod{color:var(--pod)}.better.records{color:var(--bag)}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.8rem;color:var(--muted);font-weight:600;background:var(--soft)}tr:last-child td{border-bottom:0}
table.score td:first-child{width:38%}table.score td{font-variant-numeric:tabular-nums}
.aim{display:block;font-size:.76rem;color:var(--muted)}.win{font-weight:700}
tr.section th{background:var(--card);color:var(--fg);font-size:.92rem;padding-top:14px}tr.section th span{font-weight:400;color:var(--muted)}
tr.person th{background:var(--soft);color:var(--fg);font-size:.95rem}
td.item a{font-weight:600}td.item .small{display:block}
.mark{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.8rem;font-weight:700;white-space:nowrap;margin:1px 4px 1px 0}
.mark.found,.mark.avoided,.mark.fair{color:var(--found);background:var(--found-bg)}.mark.partly{color:var(--partly);background:var(--partly-bg)}
.mark.missed,.mark.raised{color:var(--missed);background:var(--missed-bg)}.mark.unjudged{color:var(--muted);background:var(--soft)}
.kind{display:inline-block;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);margin-right:6px}
.said{display:block;font-size:.88rem;margin-top:3px}.said q{quotes:"“" "”"}
.ok{color:var(--ok)}.bad{color:var(--bad)}
.arms{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start}
.arm{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.arm.pod{border-top:4px solid var(--pod)}.arm.records{border-top:4px solid var(--bag)}
.arm h3 small{display:block;font-weight:400;color:var(--muted);font-size:.82rem}
.run+.run{border-top:1px dashed var(--line);margin-top:10px;padding-top:10px}
blockquote{margin:8px 0;padding:6px 10px;border-left:3px solid var(--line);background:var(--soft);border-radius:0 6px 6px 0}
blockquote .small{display:block;color:var(--muted)}
.why ul{margin:.3em 0 .8em;padding-left:20px}dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:4px 14px}
dt{color:var(--muted);font-size:.86rem}dd{margin:0}dd ul,dd ol{margin:0;padding-left:18px}
ol.when{list-style:none;padding:0;margin:0}ol.when li{padding:2px 0;display:grid;grid-template-columns:96px 1fr}ol.when time{font-variant-numeric:tabular-nums;color:var(--muted)}ol.when .where{display:block;font-size:.76rem;color:var(--muted)}
ol.when li.today{font-weight:600}
.chain{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin:8px 0}
.chain>.col{flex:1 1 200px;display:flex;flex-direction:column;gap:6px;min-width:180px}
.card{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);font-size:.88rem}
.card.knowledge{background:var(--know-bg);border-color:var(--know)}.card.knowledge .lab{color:var(--know);font-weight:600}
.card.question{border-width:2px}.card.absence{background:var(--soft)}
.lab{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.src{display:inline-block;font-size:.76rem;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 6px;margin-top:3px}
details{margin:8px 0}summary{cursor:pointer;color:var(--link);font-size:.88rem}details>:not(summary){margin-top:6px}
details.more{border-top:1px solid var(--line);padding-top:8px;margin-top:18px}details.more>summary{font-size:1rem;font-weight:600;color:var(--fg)}
pre{white-space:pre-wrap;word-break:break-word;background:var(--soft);padding:8px;border-radius:6px;font-size:.78rem;max-height:240px;overflow:auto}
svg text{fill:var(--fg);font-size:12px}svg .muted{fill:var(--muted)}
.strip{display:flex;gap:2px;margin:6px 0;width:100%}.doc{height:22px;min-width:3px;border-radius:3px;background:var(--soft);border:1px solid var(--line);position:relative}
.doc.read{background:var(--found-bg);border-color:var(--found)}.doc .pin{position:absolute;top:-4px;width:3px;height:30px;background:var(--know)}
.nodes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:6px 0}
.node{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card)}.node ul{margin:4px 0 0;padding-left:18px}
.node.cited{border:2px solid var(--fg)}.node.returned{border-style:dashed}.node.never{opacity:.55}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin:10px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px}.tile b{display:block}.tile span{color:var(--muted);font-size:.8rem}
.legend{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.about section{max-width:780px}.about h2{margin-top:1.6em}
footer{margin-top:40px;color:var(--muted);font-size:.8rem}
@media (max-width:640px){h1{font-size:1.35rem}
table.key thead{display:none}table.key,table.key tbody,table.key tr,table.key td,table.key th{display:block;width:100%}
table.key tr{border-bottom:1px solid var(--line)}table.key td{border:0;padding:4px 10px}
table.key td[data-label]::before{content:attr(data-label);display:block;font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase}
table.key td.item{padding-top:10px}dl{grid-template-columns:1fr}dt{margin-top:6px}ol.when li{grid-template-columns:1fr}ol.when time:empty{display:none}}
`;

const SCRIPT = `document.querySelectorAll("tr[data-href]").forEach(r=>r.addEventListener("click",e=>{if(!e.target.closest("a"))location.href=r.dataset.href}));
const t=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));
if(t){for(let d=t.closest("details");d;d=d.parentElement&&d.parentElement.closest("details"))d.open=true;t.scrollIntoView()}`;

/** Where a page sits: how far below the run's index, and the path from the run's index to the site's root. */
interface Place {
  readonly depth: number;
  readonly up: string;
  readonly history: boolean;
}
const back = (p: Place) => "../".repeat(p.depth);
const aboutOf = (p: Place) => `${back(p)}${p.up}about.html`;
const term = (p: Place, anchor: string, text: string) =>
  `<a href="${aboutOf(p)}#${anchor}">${text}</a>`;

function page(
  p: Place,
  o: {
    title: string;
    crumbs: readonly (readonly [string, string?])[];
    eyebrow?: string;
    h1: string;
    lead?: string;
    banner?: string;
    body: string;
  },
): string {
  const crumbs = [
    ...(p.history
      ? [["All runs", `${back(p)}${p.up}index.html`] as const]
      : []),
    ...o.crumbs,
  ]
    .map(([label, href]) =>
      href === undefined ? esc(label) : `<a href="${href}">${esc(label)}</a>`,
    )
    .join("<span>›</span>");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><style>${STYLE}</style></head><body><main>
<header>${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ""}${o.eyebrow ? `<p class="eyebrow">${o.eyebrow}</p>` : ""}<h1>${o.h1}</h1>${o.lead ? `<p class="lead">${o.lead}</p>` : ""}${o.banner ?? ""}</header>
${o.body}
<footer>Generated from results.json and the case files by <code>npm run evals:report</code>; never edited by hand.</footer>
</main><script>${SCRIPT}</script></body></html>`;
}

interface Loaded {
  readonly results: Results;
  readonly cases: Map<string, { found: Case; key: Key; keyChanged: boolean }>;
  /** The run's cases no longer in cases/, which its pages leave out and name. */
  readonly missing: readonly string[];
}

async function loaded(results: Results): Promise<Loaded> {
  const cases = new Map<
    string,
    { found: Case; key: Key; keyChanged: boolean }
  >();
  const missing: string[] = [];
  for (const { id, keySha256 } of results.cases) {
    try {
      const found = await loadCase(id);
      const { key, sha256 } = await loadKey(id);
      cases.set(id, { found, key, keyChanged: sha256 !== keySha256 });
    } catch {
      missing.push(id);
    }
  }
  return { results, cases, missing };
}

const ARMS = {
  pod: {
    name: "Cascade pod",
    gist: "the records joined and kept current, read through tools",
    anchor: "cascade-pod",
    css: "pod-name",
  },
  records: {
    name: "Grab bag",
    gist: "the person's raw downloaded files, read whole",
    anchor: "grab-bag",
    css: "bag-name",
  },
} as const;

/** What one input ran as, both inputs alike: its arm and model. */
interface Group {
  readonly key: string;
  readonly arm: "pod" | "records";
  readonly model: string;
  readonly name: string;
  readonly anchor: string;
}

const subjectsOf = (results: Results, caseId?: string) =>
  results.jobs.filter(
    (it) =>
      it.role === "subject" &&
      (caseId === undefined || it.case === caseId) &&
      (it.status === "done" || it.status === "reused"),
  );

function groupsOf(results: Results): Group[] {
  const subjects = subjectsOf(results);
  const several = new Set(subjects.map((j) => j.model)).size > 1;
  const seen = new Map<string, Group>();
  for (const job of subjects) {
    const arm = job.arm === "pod" ? "pod" : "records";
    const key = `${arm}|${job.model}`;
    if (!seen.has(key))
      seen.set(key, {
        key,
        arm,
        model: job.model,
        name: `${ARMS[arm].name}${several ? ` · ${shortModel(job.model)}` : ""}`,
        anchor: `${ARMS[arm].anchor}${several ? `-${shortModel(job.model)}` : ""}`,
      });
  }
  return [...seen.values()].sort(
    (a, b) =>
      (a.arm === b.arm ? 0 : a.arm === "pod" ? -1 : 1) ||
      a.model.localeCompare(b.model),
  );
}
const inGroup = (group: Group) => (job: Job) =>
  `${job.arm === "pod" ? "pod" : "records"}|${job.model}` === group.key;
const groupName = (g: Group) =>
  `<span class="${ARMS[g.arm].css}">${esc(g.name)}</span>`;

const judgeName = (r: Results, id: string) =>
  shortModel(r.jobs.find((it) => it.id === id)?.model ?? id);

type Verdict = Grade["items"][number]["verdict"];
const MARK: Record<Verdict, string> = {
  found: "✓ Found",
  partly: "◐ Partly",
  missed: "✗ Missed",
  avoided: "✓ Not raised",
  raised: "✗ Raised",
};
const POINTS: Record<Verdict, number> = {
  found: 1,
  partly: 0.5,
  missed: 0,
  avoided: 1,
  raised: 0,
};
const mark = (verdict: Verdict) =>
  `<span class="mark ${verdict}">${MARK[verdict]}</span>`;
const UNJUDGED = `<span class="mark unjudged">Not judged</span>`;

const gradesOf = (r: Results, job: Job): Grade[] =>
  r.grades.filter((g) => g.subject === job.id);
const verdictsOn = (r: Results, job: Job, item: string) =>
  gradesOf(r, job).flatMap((g) => {
    const v = g.items.find((it) => it.id === item);
    return v === undefined
      ? [
          {
            judge: g.judge,
            verdict: "missed" as Verdict,
            questions: [] as readonly number[],
            reason: "not graded on it",
          },
        ]
      : [{ judge: g.judge, ...v }];
  });

const answerOf = (r: Results, job: Job) => {
  const a = r.answers[job.id] as Answer | undefined;
  return a !== undefined && Array.isArray(a.questions) ? a : undefined;
};

/** For an unjudged run, the questions whose citations land on the item: on half its key evidence's records (or its pod
 * entries), two at most, so one shared record such as the diagnosis does not tie every question to it. */
function citedFor(
  item: KeyItem,
  slice: Slice | undefined,
  answer: Answer | undefined,
): number[] {
  const keys = new Set(
    item.evidence.map((e) =>
      "resource" in e.cite
        ? `${e.cite.file}#${e.cite.resource}`
        : "line" in e.cite
          ? `${e.cite.file}:${e.cite.line}`
          : e.cite.entry,
    ),
  );
  const nodes = new Set(
    slice?.nodes.filter((n) => n.kind !== "record").map((n) => n.id) ?? [],
  );
  const keyOf = (cite: Answer["questions"][number]["facts"][number]["cite"]) =>
    "entry" in cite
      ? cite.entry
      : "resource" in cite
        ? `${cite.file}#${cite.resource}`
        : `${cite.file}:${cite.line}`;
  return (answer?.questions ?? [])
    .filter((q) => {
      const hit = new Set(
        q.facts
          .map((f) => keyOf(f.cite))
          .filter((k) => keys.has(k) || nodes.has(k)),
      );
      const of = q.facts.some((f) => "entry" in f.cite)
        ? nodes.size
        : keys.size;
      return hit.size > 0 && hit.size >= Math.min(2, Math.ceil(of / 2));
    })
    .map((q) => q.n);
}

const sliceOf = (r: Results, caseId: string, item: string) =>
  r.slices.find((s) => s.case === caseId && s.item === item);

/** The questions of a job's answer that are about an item: the judges', or, unjudged, its citations'. */
function questionsOn(
  r: Results,
  job: Job,
  caseId: string,
  item: KeyItem,
): number[] {
  const verdicts = verdictsOn(r, job, item.id);
  return [
    ...new Set(
      verdicts.length > 0
        ? verdicts.flatMap((v) => v.questions)
        : citedFor(item, sliceOf(r, caseId, item.id), answerOf(r, job)),
    ),
  ].sort((a, b) => a - b);
}

/** One run's verdict on an item: one mark when its judges agree, each when they split. */
function runMark(r: Results, job: Job, item: string): string {
  const verdicts = verdictsOn(r, job, item);
  if (verdicts.length === 0) return UNJUDGED;
  const distinct = [...new Set(verdicts.map((v) => v.verdict))];
  return distinct.length === 1
    ? mark(distinct[0]!)
    : `${distinct.map(mark).join("")}<span class="small muted">judges split</span>`;
}

/** The mean points of a group's verdicts on an item, over its runs and judges; undefined when unjudged. */
function pointsOn(r: Results, jobs: readonly Job[], item: string) {
  const verdicts = jobs.flatMap((j) => verdictsOn(r, j, item));
  return verdicts.length === 0
    ? undefined
    : verdicts.reduce((s, v) => s + POINTS[v.verdict], 0) / verdicts.length;
}

function betterOf(
  entries: readonly { group: Group; value: number | undefined }[],
): string {
  const known = entries.filter((e) => e.value !== undefined);
  if (known.length < 2) return `<span class="muted">–</span>`;
  const top = Math.max(...known.map((e) => e.value!));
  const best = known.filter((e) => e.value === top);
  return best.length === known.length
    ? `<span class="better tie">Tie</span>`
    : best.length === 1
      ? `<span class="better ${best[0]!.group.arm}">${esc(best[0]!.group.name)}</span>`
      : `<span class="better">${best.map((e) => esc(e.group.name)).join(", ")}</span>`;
}

/** A group's tally over the run's cases: per case, the mean over its runs and judges; summed across cases. */
interface Tally {
  readonly judged: boolean;
  readonly found: number;
  readonly partly: number;
  readonly gaps: number;
  readonly trapsRaised: number;
  readonly traps: number;
  readonly falseQuestions: number;
  readonly extraFinds: number;
  readonly answers: number;
  readonly cited: number;
  readonly held: number;
  readonly absent: number;
  readonly backed: number;
  readonly wording: number;
  readonly disciplined: number;
  readonly tokens: number;
  readonly usd: number;
  readonly wall: number;
}

function tallyOf(l: Loaded, jobs: readonly Job[]): Tally {
  const r = l.results;
  let judged = false;
  const sums = {
    found: 0,
    partly: 0,
    gaps: 0,
    trapsRaised: 0,
    traps: 0,
    falseQuestions: 0,
    extraFinds: 0,
  };
  for (const caseId of new Set(jobs.map((j) => j.case!))) {
    const scores = r.scores.filter((s) =>
      jobs.some((j) => j.id === s.subject && j.case === caseId),
    );
    const key = l.cases.get(caseId)?.key;
    sums.traps += key?.items.filter((it) => it.kind !== "gap").length ?? 0;
    if (scores.length === 0) {
      sums.gaps += key?.items.filter((it) => it.kind === "gap").length ?? 0;
      continue;
    }
    judged = true;
    const mean = (pick: (s: Score) => number) =>
      scores.reduce((sum, s) => sum + pick(s), 0) / scores.length;
    sums.found += mean((s) => s.found);
    sums.partly += mean((s) => s.partly);
    sums.gaps += mean((s) => s.gaps);
    sums.trapsRaised += mean((s) => s.trapsRaised);
    sums.falseQuestions += mean((s) => s.falseQuestions);
    sums.extraFinds += mean((s) => s.extraFinds);
  }
  const checks = jobs.flatMap((j) => (r.checks[j.id] ? [r.checks[j.id]!] : []));
  return {
    judged,
    ...sums,
    answers: jobs.length,
    cited: checks.reduce((s, c) => s + c.citations.length, 0),
    held: checks.reduce(
      (s, c) => s + c.citations.filter((it) => it.ok).length,
      0,
    ),
    absent: checks.reduce((s, c) => s + c.absences.length, 0),
    backed: checks.reduce(
      (s, c) => s + c.absences.filter((it) => it.backed).length,
      0,
    ),
    wording: checks.reduce((s, c) => s + c.trapWording.length, 0),
    disciplined: checks.filter((c) => c.discipline.ok).length,
    tokens: jobs.reduce((s, j) => s + (j.stats?.tokens.total ?? 0), 0),
    usd: jobs.reduce((s, j) => s + (j.stats?.cost.usd ?? 0), 0),
    wall: jobs.reduce((s, j) => s + (j.stats?.wallSeconds ?? 0), 0),
  };
}

const gapRate = (t: Tally) =>
  t.judged ? (t.found + t.partly / 2) / Math.max(1, t.gaps) : undefined;

/** Who did better overall: more gaps found, and no more traps raised or false alarms; else a tie or mixed. */
function overall(tallies: readonly { group: Group; tally: Tally }[]): string {
  const judged = tallies.filter((t) => t.tally.judged);
  if (judged.length < 2) return "";
  const score = (t: Tally) => [
    gapRate(t)!,
    -t.trapsRaised / Math.max(1, t.traps),
    -t.falseQuestions,
  ];
  const beats = (a: Tally, b: Tally) => {
    const [x, y] = [score(a), score(b)];
    return x.every((v, i) => v >= y[i]!) && x.some((v, i) => v > y[i]!);
  };
  const winners = judged.filter((a) =>
    judged.every((b) => a === b || beats(a.tally, b.tally)),
  );
  if (winners.length === 1)
    return `<span class="better ${winners[0]!.group.arm}">${esc(winners[0]!.group.name)} did better</span>`;
  const same = judged.every(
    (a) => score(a.tally).join() === score(judged[0]!.tally).join(),
  );
  return same
    ? `<span class="better tie">Tie</span>`
    : `<span class="better">Mixed</span>`;
}

function scoreboard(
  l: Loaded,
  p: Place,
  groups: readonly Group[],
  jobs: readonly Job[],
): string {
  const tallies = groups.map((group) => ({
    group,
    tally: tallyOf(l, jobs.filter(inGroup(group))),
  }));
  const row = (
    label: string,
    aim: string,
    cell: (t: Tally) => string,
    rank?: (t: Tally) => number | undefined,
  ) => {
    const values = tallies.map((t) => (rank ? rank(t.tally) : undefined));
    const known = values.filter((v) => v !== undefined) as number[];
    const top = known.length > 1 ? Math.max(...known) : undefined;
    const lone =
      top !== undefined && known.filter((v) => v === top).length === 1;
    return `<tr><td>${label}${aim ? `<span class="aim">${aim}</span>` : ""}</td>${tallies
      .map(
        (t, i) =>
          `<td${lone && values[i] === top ? ' class="win"' : ""}>${cell(t.tally)}</td>`,
      )
      .join("")}</tr>`;
  };
  const unjudged = `<span class="muted">not judged</span>`;
  const judgedRows = [
    row(
      term(p, "gap", "Gaps found"),
      "aim: all",
      (t) =>
        t.judged
          ? `${num(t.found)} of ${num(t.gaps)}${t.partly ? ` <span class="small muted">+ ${num(t.partly)} partly</span>` : ""}`
          : unjudged,
      gapRate,
    ),
    row(
      term(p, "trap", "Traps raised"),
      "aim: none",
      (t) => (t.judged ? `${num(t.trapsRaised)} of ${num(t.traps)}` : unjudged),
      (t) => (t.judged ? -t.trapsRaised : undefined),
    ),
    row(
      term(p, "false-alarm", "False alarms"),
      "aim: none",
      (t) => (t.judged ? num(t.falseQuestions) : unjudged),
      (t) => (t.judged ? -t.falseQuestions : undefined),
    ),
    row(term(p, "fair-find", "Fair finds outside the key"), "", (t) =>
      t.judged ? num(t.extraFinds) : unjudged,
    ),
  ];
  const checked = [
    row(
      term(p, "cited", "Cited facts the records bear out"),
      "aim: all",
      (t) => `${t.held} of ${t.cited}`,
      (t) => t.held / Math.max(1, t.cited),
    ),
    row(
      term(p, "absence", "“Not in the records” claims proven"),
      "aim: all",
      (t) => `${t.backed} of ${t.absent}`,
      (t) => t.backed / Math.max(1, t.absent),
    ),
    row(
      term(p, "trap-wording", "Trap wording"),
      "aim: none",
      (t) => String(t.wording),
      (t) => -t.wording,
    ),
    row(
      term(p, "kept-to-input", "Kept to its input"),
      "aim: all",
      (t) => `${t.disciplined} of ${t.answers}`,
    ),
  ];
  const per = (t: Tally) => Math.max(1, t.answers);
  const cost = [
    row(term(p, "cost", "Cost per answer"), "", (t) => dollars(t.usd / per(t))),
    row("Tokens per answer", "", (t) => thousands(t.tokens / per(t))),
    row("Time per answer", "", (t) => seconds(t.wall / per(t))),
    ...(tallies.some(
      (t) => t.tally.judged && t.tally.found + t.tally.partly > 0,
    )
      ? [
          row("Cost per gap found", "", (t) =>
            t.judged && t.found + t.partly / 2 > 0
              ? dollars(t.usd / (t.found + t.partly / 2))
              : "–",
          ),
        ]
      : []),
  ];
  const span = groups.length + 1;
  const head = (text: string) =>
    `<tr class="section"><th colspan="${span}">${text}</th></tr>`;
  const judged = tallies.some((t) => t.tally.judged);
  const sections = {
    key: judged ? head("Against the answer key") + judgedRows.join("") : "",
    checks: head("Checked by program") + checked.join(""),
    cost: head("Cost") + cost.join(""),
  };
  const table = (body: string) =>
    `<div class="table narrow"><table class="score"><thead><tr><th></th>${groups
      .map((g) => `<th>${groupName(g)}</th>`)
      .join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  return judged
    ? `${table(sections.key + sections.cost)}<details id="checks"><summary>Checked by program: cited facts, “not in the records” claims, trap wording</summary>${table(sections.checks)}</details>`
    : table(sections.checks + sections.cost);
}

/** One line per input of how it did against the key, for a page's headline. */
function summaryLine(
  l: Loaded,
  groups: readonly Group[],
  jobs: readonly Job[],
): string {
  const tallies = groups.map((group) => ({
    group,
    tally: tallyOf(l, jobs.filter(inGroup(group))),
  }));
  const said = tallies
    .filter((t) => t.tally.judged)
    .map(
      ({ group, tally: t }) =>
        `${groupName(group)} found ${num(t.found)} of ${num(t.gaps)} gaps${t.partly ? ` (+${num(t.partly)} partly)` : ""}, raised ${num(t.trapsRaised)} of ${num(t.traps)} traps`,
    )
    .join(" · ");
  return said ? `${overall(tallies)}<span class="small">${said}</span>` : "";
}

function unjudgedBanner(r: Results, p: Place, caseId?: string): string {
  const jobs = subjectsOf(r, caseId);
  if (jobs.some((j) => gradesOf(r, j).length > 0)) return "";
  if (jobs.length === 0)
    return `<div class="banner"><b>Not judged.</b> No answer finished in this run, so there is nothing to judge.</div>`;
  return `<div class="banner"><b>Not judged.</b> Both inputs answered, but no judge has scored the answers against the answer key, so nothing here is found or missed yet: only program checks and cost. ${term(p, "not-judged", "Why")}</div>`;
}

const kindLabel = (kind: KeyItem["kind"]) =>
  kind === "gap" ? "Should find" : "Should not raise";
const itemOrder = (a: KeyItem, b: KeyItem) =>
  (a.kind === "gap" ? 0 : a.kind === "trap" ? 1 : 2) -
  (b.kind === "gap" ? 0 : b.kind === "trap" ? 1 : 2);

/** The first sentence of the case's "who", without the name the heading already gives. */
function whoLine(found: Case): string {
  const first = found.description.who.split(/\.\s/)[0] ?? "";
  return first.startsWith(`${found.person.name}, `)
    ? first.slice(found.person.name.length + 2)
    : first;
}

function runIndex(l: Loaded, p: Place, trend: string): string {
  const r = l.results;
  const groups = groupsOf(r);
  const subjects = subjectsOf(r);
  const judges = [...new Set(r.grades.map((g) => g.judge))];
  const cases = [...l.cases.entries()].sort(
    ([, a], [, b]) =>
      a.found.person.name.localeCompare(b.found.person.name) ||
      a.found.id.localeCompare(b.found.id),
  );
  const span = groups.length + 2;
  const rows = cases
    .map(([caseId, { found, key }]) => {
      const jobs = subjectsOf(r, caseId);
      const items = [...key.items].sort(itemOrder).map((item) => {
        const cells = groups.map((group) => {
          const mine = jobs.filter(inGroup(group));
          return {
            group,
            html: mine.map((j) => runMark(r, j, item.id)).join("") || "–",
            value: pointsOn(r, mine, item.id),
          };
        });
        const href = `cases/${esc(caseId)}/${idOf(item.id)}.html`;
        return `<tr class="link" data-href="${href}"><td class="item"><span class="kind">${kindLabel(item.kind)}</span><a href="${href}">${esc(item.title)}</a></td>${cells
          .map((c) => `<td data-label="${esc(c.group.name)}">${c.html}</td>`)
          .join("")}<td data-label="Better">${betterOf(cells)}</td></tr>`;
      });
      return `<tr class="person"><th colspan="${span}"><a href="cases/${esc(caseId)}.html">${esc(found.person.name)}</a> <span class="small muted">${esc(whoLine(found))}</span></th></tr>${items.join("")}`;
    })
    .join("");
  const cfg = r.run.config as {
    arms: string[];
    subjects: string[];
    repeats: number;
    judges: string[];
  };
  const spent = r.budget.spent;
  const tiles = [
    ["tier", term(p, "tier", esc(r.run.tier))],
    ["people", String(l.cases.size)],
    ["inputs", groups.map(groupName).join(", ")],
    ["model answering", esc(cfg.subjects.map(shortModel).join(", "))],
    ["answers per input", String(cfg.repeats)],
    [
      "judges",
      esc(
        cfg.judges.length === 0
          ? "none"
          : cfg.judges.map(shortModel).join(", "),
      ),
    ],
    ["tokens spent", thousands(spent.tokens)],
    [
      "estimate",
      `${thousands(r.budget.estimate.tokens)} · ${dollars(r.budget.estimate.usd)}`,
    ],
    ["cap", `${thousands(r.budget.cap.tokens)} · ${dollars(r.budget.cap.usd)}`],
    [`cost (${esc(spent.basis)})`, dollars(spent.usd)],
    ["wall time", seconds(r.run.wallSeconds)],
    ["stopped at cap", r.run.stoppedAtCap ? "yes" : "no"],
  ]
    .map(([k, v]) => `<div class="tile"><b>${v}</b><span>${k}</span></div>`)
    .join("");
  const roles = Object.entries(r.budget.byRole)
    .map(
      ([role, it]) =>
        `${esc(role)}: ${thousands(it.tokens)} tokens, ${dollars(it.usd)}`,
    )
    .join(" · ");
  const commits = [
    `harness <code>${esc(r.versions.harness.commit.slice(0, 12))}</code>${r.versions.harness.uncommitted ? ` (+${r.versions.harness.uncommitted} uncommitted)` : ""}`,
    ...r.versions.components.map(
      (c) => `${esc(c.name)} <code>${esc(c.commit.slice(0, 12))}</code>`,
    ),
  ].join(" · ");
  const agreement = r.agreement
    .map(
      (a) =>
        `<li>${esc(l.cases.get(a.case)?.found.person.name ?? a.case)}: ${a.judges.map((j) => esc(judgeName(r, j))).join(" and ")} agreed on ${a.agreed} of ${a.items} verdicts${a.kappa === null ? "" : ` (kappa ${a.kappa.toFixed(2)})`}</li>`,
    )
    .join("");
  const others = r.jobs.filter((j) => j.case === undefined);
  const judged = judges.length > 0;
  return page(p, {
    title: `Cascade evals: run ${r.run.id}`,
    crumbs: [],
    eyebrow: `Cascade evals · run <code>${esc(r.run.id)}</code> · ${esc(r.run.finished.slice(0, 10))} · ${term(p, "tier", `${esc(r.run.tier)} tier`)}`,
    h1: "Does Cascade help an AI spot the gaps in a person’s care?",
    lead: `Same model, same question, two inputs: <span class="pod-name">Cascade pod</span> <span class="muted">(${ARMS.pod.gist})</span> vs <span class="bag-name">Grab bag</span> <span class="muted">(${ARMS.records.gist})</span>. <a href="${aboutOf(p)}">How the test works</a>`,
    banner: unjudgedBanner(r, p),
    body: `<div class="headline">${summaryLine(l, groups, subjects)}</div><p class="small muted">${plural(l.cases.size, "person", "people")} · ${plural(cfg.repeats, "answer")} per input${judged ? ` · ${term(p, "judges", `judged by ${judges.map((j) => esc(judgeName(r, j))).join(" and ")}`)}` : ""}</p>
<h2>Item by item</h2><p class="small muted">Each person’s ${term(p, "key", "answer key")}, written before any run. Open an item for why it is there and what each input said.</p>
<div class="table"><table class="key"><thead><tr><th>Item</th>${groups.map((g) => `<th>${groupName(g)}</th>`).join("")}<th>Better</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>The numbers</h2>${scoreboard(l, p, groups, subjects)}
${l.missing.length > 0 ? `<p class="note">Cases no longer in cases/, left out of these pages: ${esc(l.missing.join(", "))}.</p>` : ""}
<details class="more" id="run-details"><summary>Run details: models, judges, budget, versions</summary>
<div class="tiles">${tiles}</div>
${agreement ? `<p class="small" id="agreement">Judge agreement:</p><ul class="small">${agreement}</ul>` : ""}
<p class="small muted">Spent by role: ${roles || "–"}. Prices: list prices of ${esc(r.versions.priceTable)}; “exact” means every call’s usage as the API reported it.</p>
<p class="small muted">Tested: ${commits}</p>${uncommittedIn(r).length > 0 ? `<p class="note"><b>Not reproducible:</b> planned from uncommitted work (${esc(uncommittedIn(r).join("; "))}), so it cannot be recorded into history.</p>` : ""}
${others.length > 0 ? `<h3>Jobs outside the cases</h3>${statsTable(others, r)}` : ""}
<h3>Trend</h3>${trend}</details>`,
  });
}

/** The fields a claim names, as a reader sees them. */
function claimText(claim: Omit<Claim, "cite">): string {
  return [
    claim.name,
    claim.value === undefined
      ? undefined
      : `${claim.value}${claim.unit ? ` ${claim.unit}` : ""}`,
    claim.status,
    claim.code === undefined ? undefined : `code ${claim.code}`,
    claim.id === undefined ? undefined : `id ${claim.id}`,
    claim.date === undefined
      ? undefined
      : `${claim.dateKind && claim.dateKind !== "when" ? `${claim.dateKind} ` : ""}${claim.date}`,
    claim.quote === undefined ? undefined : `“${claim.quote}”`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Where a citation points, as a reader sees it. */
const whereOf = (cite: Claim["cite"]) =>
  "entry" in cite
    ? `pod entry <code>${esc(cite.entry.split("#").pop()?.slice(0, 12))}…</code>`
    : "line" in cite
      ? `${esc(cite.file)}:${cite.line}`
      : `${esc(cite.file)} ${esc(cite.resource)}`;

function factCard(
  fact: Answer["questions"][number]["facts"][number],
  check: Results["checks"][string]["citations"][number] | undefined,
  superseded: (file: string) => boolean,
): string {
  const verified =
    check === undefined
      ? ""
      : check.ok
        ? `<span class="ok">✓ the record says it</span>`
        : `<span class="bad">✗ ${esc(check.reason)}${check.missing?.length ? `: ${esc(check.missing.join(", "))}` : ""}</span>`;
  const older =
    "file" in fact.cite && superseded(fact.cite.file)
      ? ` <span class="small muted">(an older download of this source)</span>`
      : "";
  return `<div class="card"><div class="lab">from the records</div>${esc(fact.says)}<br><span class="src">${esc(fact.provider)}${fact.date ? ` · ${esc(fact.date)}` : ""}</span>
<div class="small">claims: ${esc(claimText(fact))}</div><div class="small">${verified}</div>
<details><summary>${whereOf(fact.cite)}${older}</summary>${check?.shows ? `<div class="small">the record says: ${esc(check.shows)}</div>` : `<span class="small muted">no record read</span>`}</details></div>`;
}

function chainOf(
  r: Results,
  job: Job,
  question: Answer["questions"][number],
  superseded: (file: string) => boolean,
): string {
  const checks = r.checks[job.id];
  const facts = question.facts
    .map((f, at) =>
      factCard(
        f,
        checks?.citations.find(
          (c) => c.question === question.n && c.fact === at,
        ),
        superseded,
      ),
    )
    .join("");
  const absences = question.absences
    .map((a, at) => {
      const backing = checks?.absences.find(
        (c) => c.question === question.n && c.absence === at,
      );
      return `<div class="card absence"><div class="lab">not in the records</div>${esc(a.what)}<br><span class="small muted">looks for: ${esc([...(a.match.codes ?? []), ...(a.match.terms ?? [])].join(", "))}; looked through: ${esc(a.coverage)}</span>${a.query ? `<br><code class="small">${esc(a.query.tool)} ${esc(JSON.stringify(a.query.input))}</code>` : ""}${a.sources?.length ? `<br><span class="small muted">sources: ${esc(a.sources.join(", "))}</span>` : ""}<br><span class="small ${backing?.backed ? "ok" : "bad"}">${backing?.backed ? "✓ proven" : `✗ not proven${backing?.reason ? `: ${esc(backing.reason)}` : ""}`}</span></div>`;
    })
    .join("");
  return `<div class="chain"><div class="col">${facts}${absences}</div><div class="col"><div class="card knowledge"><div class="lab">the model's own knowledge</div>${esc(question.knowledge.says)}${question.knowledge.guideline ? `<br><span class="small">names: ${esc(question.knowledge.guideline)}</span>` : ""}</div></div><div class="col"><div class="card question"><div class="lab">question ${question.n} · ${esc(question.confidence)} confidence</div><b>${esc(question.question)}</b><br><span class="small">${esc(question.why)}</span></div></div></div>`;
}

function sliceView(
  slice: Slice | undefined,
  r: Results,
  job: Job,
  answer: Answer | undefined,
): string {
  if (slice === undefined || slice.nodes.length === 0) return "";
  const cited = new Set(
    answer?.questions.flatMap((q) =>
      q.facts.flatMap((f) => ("entry" in f.cite ? [f.cite.entry] : [])),
    ) ?? [],
  );
  const returned = new Set(
    r.toolCalls.filter((c) => c.job === job.id).flatMap((c) => c.entries),
  );
  const state = (id: string) =>
    cited.has(id) ? "cited" : returned.has(id) ? "returned" : "never";
  const said = {
    cited: "cited",
    returned: "a tool returned it",
    never: "never reached",
  };
  const cards = slice.nodes
    .filter((n) => n.kind !== "record")
    .map((n) => {
      const records = slice.edges
        .filter((e) => e.from === n.id)
        .map((e) => slice.nodes.find((it) => it.id === e.to))
        .filter((it) => it !== undefined)
        .map(
          (it) =>
            `<li>${esc(it.source ?? it.label)}${it.detail ? `: ${esc(it.detail)}` : ""}</li>`,
        )
        .join("");
      return `<div class="node ${state(n.id)}"><b>${esc(n.label)}</b> <span class="small muted">${said[state(n.id)]}</span><div class="small">${esc(n.detail ?? "")}</div>${records ? `<ul class="small">${records}</ul>` : ""}</div>`;
    })
    .join("");
  return `<details><summary>What it reached in the pod</summary><p class="small muted">Each pod entry about this item, its records per source, and whether this answer cited it, a tool returned it, or it was never reached.</p><div class="nodes">${cards}</div></details>`;
}

function recordsStrip(
  r: Results,
  job: Job,
  caseId: string,
  answer: Answer | undefined,
): string {
  const docs = r.cases.find((c) => c.id === caseId)?.documents ?? [];
  const read = new Set(r.checks[job.id]?.read ?? []);
  const total = docs.reduce((s, d) => s + d.bytes, 0);
  const cites =
    answer?.questions.flatMap((q) =>
      q.facts.flatMap((f) => ("file" in f.cite ? [f.cite] : [])),
    ) ?? [];
  const blocks = docs
    .map((d) => {
      const share = Math.max(0.5, (d.bytes / Math.max(1, total)) * 100);
      const pins = cites
        .filter((c) => c.file === d.file)
        .map((c) => {
          const lines = (d as { lines?: number }).lines;
          const at =
            "line" in c && lines ? Math.min(98, (c.line / lines) * 100) : 50;
          return `<span class="pin" style="left:${at.toFixed(1)}%"></span>`;
        })
        .join("");
      return `<div class="doc ${read.has(d.file) ? "read" : ""}" style="flex:${share.toFixed(2)} 1 0" title="${esc(d.file)} · ${thousands(d.bytes)} bytes${pins ? " · cited here" : ""}">${pins}</div>`;
    })
    .join("");
  return `<details><summary>What it was given: ${docs.length} files, about ${thousands(total / 3.5)} tokens</summary><p class="small muted">${thousands(total)} bytes; ${read.size} of ${docs.length} files read whole (green); purple marks where it cited.</p><div class="strip">${blocks}</div></details>`;
}

function statsTable(jobs: readonly Job[], r?: Results): string {
  return `<div class="table"><table><tr><th>Job</th><th>Status</th><th>Model</th><th>Tokens (in / cache write / cache read / out)</th><th>Context peak</th><th>Tool calls</th><th>Time</th><th>Cost</th></tr>${jobs
    .map((j) => {
      const s = j.stats;
      return `<tr><td class="mono">${esc(j.id)}</td><td>${esc(j.status)}${j.reusedFrom ? `<br><span class="small muted">from ${esc(j.reusedFrom)}</span>` : ""}${j.reason ? `<br><span class="small muted">${esc(j.reason)}</span>` : ""}${(r?.judgeDiscipline?.[j.id]?.violations ?? []).map((v) => `<br><span class="small bad">outside its packet: ${esc(v)}</span>`).join("")}</td><td class="small">${esc(s?.models.join(", ") ?? j.model)}</td><td class="small">${s ? `${thousands(s.tokens.input)} / ${thousands(s.tokens.cacheCreation)} / ${thousands(s.tokens.cacheRead)} / ${thousands(s.tokens.output)}<br><b>${thousands(s.tokens.total)}</b> (estimate ${thousands(j.estimate.tokens)})` : `estimate ${thousands(j.estimate.tokens)}`}</td><td>${thousands(s?.contextPeak)}</td><td class="small">${
        s
          ? `${s.toolCalls.total}: ${esc(
              Object.entries(s.toolCalls.byName)
                .map(([k, v]) => `${k} ${v}`)
                .join(", "),
            )}`
          : "–"
      }</td><td>${seconds(s?.wallSeconds)}</td><td>${dollars(s?.cost.usd)}${s ? `<br><span class="small muted">${esc(s.cost.basis)}</span>` : ""}</td></tr>`;
    })
    .join("")}</table></div>`;
}

function toolCallList(
  calls: readonly Results["toolCalls"][number][],
  mark?: ReadonlySet<string>,
): string {
  return `<ol class="small">${calls
    .map(
      (c) =>
        `<li><code>${esc(c.tool)}</code> <code>${esc(JSON.stringify(c.input))}</code> → ${c.ok ? `${c.rows} row${c.rows === 1 ? "" : "s"}` : `<span class="bad">${esc(c.error ?? "failed")}</span>`} · ${c.milliseconds} ms${mark && c.entries.some((e) => mark.has(e)) ? " · <b>reached this item</b>" : ""}${c.answer ? `<details><summary>its answer</summary><pre>${esc(c.answer)}</pre></details>` : ""}</li>`,
    )
    .join("")}</ol>`;
}

interface CaseView {
  readonly l: Loaded;
  readonly caseId: string;
  readonly found: Case;
  readonly key: Key;
  readonly keyChanged: boolean;
  readonly groups: readonly Group[];
  readonly jobs: readonly Job[];
  readonly superseded: (file: string) => boolean;
}

function caseView(l: Loaded, caseId: string): CaseView {
  const { found, key, keyChanged } = l.cases.get(caseId)!;
  const reading = found.reading;
  const seriesOf = (file: string) =>
    file
      .split("/")[0]!
      .replace(/.(xml|json)$/, "")
      .replace(/(-d+)+$/, "");
  /** Whether a later file of the same source is in the reading order: a citation of this one is of an older download. */
  const superseded = (file: string) => {
    const at = reading.indexOf(file);
    return (
      at >= 0 &&
      reading
        .slice(at + 1)
        .some(
          (later) =>
            seriesOf(later) === seriesOf(file) &&
            later.split("/")[0] !== file.split("/")[0],
        )
    );
  };
  const jobs = subjectsOf(l.results, caseId).sort(
    (a, b) => (a.repeat ?? 0) - (b.repeat ?? 0) || a.id.localeCompare(b.id),
  );
  return {
    l,
    caseId,
    found,
    key,
    keyChanged,
    groups: groupsOf(l.results).filter((g) => jobs.some(inGroup(g))),
    jobs,
    superseded,
  };
}

const runLabel = (jobs: readonly Job[], job: Job) =>
  jobs.length > 1
    ? `<span class="small muted">answer ${job.repeat ?? jobs.indexOf(job) + 1}:</span> `
    : "";

function caseHeader(v: CaseView, p: Place) {
  const r = v.l.results;
  const docs = r.cases.find((c) => c.id === v.caseId)?.documents ?? [];
  const bytes = docs.reduce((s, d) => s + d.bytes, 0);
  return {
    eyebrow: `${term(p, "key", "Synthetic person")} · as of ${esc(v.found.today)} · ${docs.length} downloaded files, ${thousands(bytes / 1024)} KB`,
    banner: `${unjudgedBanner(r, p, v.caseId)}${v.keyChanged ? `<p class="small muted">The answer key was edited after this run; these pages show the current key.</p>` : ""}`,
  };
}

function casePage(v: CaseView, p: Place): string {
  const r = v.l.results;
  const { found, key, groups, jobs } = v;
  const d = found.description;
  const span = groups.length + 2;
  const tied = new Map<string, Set<number>>();
  const rowsOf = (items: readonly KeyItem[]) =>
    items
      .map((item) => {
        const cells = groups.map((group) => {
          const mine = jobs.filter(inGroup(group));
          const html = mine
            .map((job) => {
              const ns = questionsOn(r, job, v.caseId, item);
              const set = tied.get(job.id) ?? new Set();
              ns.forEach((n) => set.add(n));
              tied.set(job.id, set);
              const answer = answerOf(r, job);
              const quoted = ns
                .map((n) => answer?.questions.find((q) => q.n === n))
                .filter((q) => q !== undefined)
                .map(
                  (q) =>
                    `<span class="said"><span class="muted">Q${q.n}</span> <q>${esc(q.question)}</q></span>`,
                )
                .join("");
              const none =
                ns.length === 0
                  ? `<span class="said muted">${item.kind === "gap" ? "no question on it" : "did not bring it up"}</span>`
                  : "";
              return `<div>${runLabel(mine, job)}${runMark(r, job, item.id)}${quoted}${none}</div>`;
            })
            .join("");
          return { group, html, value: pointsOn(r, mine, item.id) };
        });
        const href = `${esc(v.caseId)}/${idOf(item.id)}.html`;
        return `<tr id="${idOf(item.id)}"><td class="item"><a href="${href}">${esc(item.title)}</a><span class="small muted">${esc(item.lookingFor)}</span></td>${cells
          .map((c) => `<td data-label="${esc(c.group.name)}">${c.html}</td>`)
          .join("")}<td data-label="Better">${betterOf(cells)}</td></tr>`;
      })
      .join("");
  const items = [...key.items].sort(itemOrder);
  const gaps = items.filter((it) => it.kind === "gap");
  const traps = items.filter((it) => it.kind !== "gap");
  const pronoun = found.person.pronoun;
  const section = (label: string, anchor: string, gloss: string) =>
    `<tr class="section"><th colspan="${span}">${term(p, anchor, label)} <span>${gloss}</span></th></tr>`;
  const table = `<div class="table"><table class="key"><thead><tr><th>Item</th>${groups.map((g) => `<th>${groupName(g)}</th>`).join("")}<th>Better</th></tr></thead><tbody>${gaps.length ? section("Should find", "gap", `· gaps in ${pronoun} care that ${pronoun} records show`) + rowsOf(gaps) : ""}${traps.length ? section("Should not raise", "trap", `· look like gaps, but ${pronoun} records show they are not`) + rowsOf(traps) : ""}</tbody></table></div>`;
  const others = groups
    .map((group) => {
      const mine = jobs.filter(inGroup(group));
      const lists = mine
        .map((job) => {
          const answer = answerOf(r, job);
          const notes = new Map<
            number,
            { kind: "false" | "fair"; judge: string; text: string }[]
          >();
          const note = (
            kind: "false" | "fair",
            judge: string,
            f: { question: number; item?: string; why: string },
          ) =>
            notes.set(f.question, [
              ...(notes.get(f.question) ?? []),
              { kind, judge, text: `${f.why}${f.item ? ` (${f.item})` : ""}` },
            ]);
          for (const g of gradesOf(r, job)) {
            for (const f of g.falseQuestions) note("false", g.judge, f);
            for (const f of g.extraFinds) note("fair", g.judge, f);
          }
          const said = (n: number) => {
            const list = notes.get(n) ?? [];
            if (list.length === 0) return "";
            const kinds = [...new Set(list.map((it) => it.kind))];
            return `<br>${kinds.map((k) => (k === "false" ? `<span class="mark raised">✗ False alarm</span>` : `<span class="mark fair">✓ Fair find</span>`)).join("")}<details><summary>why</summary><ul>${list.map((it) => `<li><b>${esc(judgeName(r, it.judge))}</b>: ${esc(it.text)}</li>`).join("")}</ul></details>`;
          };
          const shown = (answer?.questions ?? []).filter(
            (q) => !tied.get(job.id)?.has(q.n) || notes.has(q.n),
          );
          return `${runLabel(mine, job)}${
            shown.length === 0
              ? `<p class="small muted">None.</p>`
              : `<ul class="small">${shown
                  .map(
                    (q) =>
                      `<li><span class="muted">Q${q.n}</span> ${esc(q.question)}${said(q.n)}</li>`,
                  )
                  .join("")}</ul>`
          }`;
        })
        .join("");
      return `<section class="arm ${group.arm}"><h3>${groupName(group)}</h3>${lists}</section>`;
    })
    .join("");
  const answers = groups
    .map((group) => {
      const mine = jobs.filter(inGroup(group));
      return `<section class="arm ${group.arm}"><h3>${groupName(group)}</h3>${mine
        .map((job) => {
          const answer = answerOf(r, job);
          const checks = r.checks[job.id];
          return `<div class="run">${runLabel(mine, job)}<span class="small muted">${esc(job.model)}</span>${(checks?.discipline.violations ?? []).map((x) => `<br><span class="small bad">outside its input: ${esc(x)}</span>`).join("")}${(checks?.trapWording ?? []).map((w) => `<br><span class="small bad">trap wording in Q${w.question}: “${esc(w.text)}” (${esc(w.means)})</span>`).join("")}
${answer === undefined ? `<p class="bad">No valid answer: ${esc((checks?.answerErrors ?? []).join("; "))}</p>` : answer.questions.map((q) => chainOf(r, job, q, v.superseded)).join("")}</div>`;
        })
        .join("")}</section>`;
    })
    .join("");
  const pods = jobs.filter((j) => j.arm === "pod");
  const calls = pods
    .map((job) => {
      const mine = r.toolCalls.filter((c) => c.job === job.id);
      return `<p class="small"><b>${esc(job.id)}</b>: ${plural(mine.length, "call")}</p>${toolCallList(mine)}`;
    })
    .join("");
  const { eyebrow, banner } = caseHeader(v, p);
  return page(p, {
    title: `${found.person.name}: Cascade eval`,
    crumbs: [[`Run ${r.run.id}`, "../index.html"], [found.person.name]],
    eyebrow,
    h1: esc(found.person.name),
    lead: esc(whoLine(found)),
    banner,
    body: `<div class="headline">${summaryLine(v.l, groups, jobs)}</div>
<h2 id="key">The answer key, item by item</h2><p class="small muted">Written ${esc(key.written)}, before any run. Open an item for why it is there, each answer, and its evidence.</p>${table}
<h2 id="other-questions">Its other questions</h2><p class="small muted">Questions about nothing in the key, and the ones a judge called a ${term(p, "false-alarm", "false alarm")} or a ${term(p, "fair-find", "fair find")}.</p><div class="arms">${others}</div>
<details class="more" id="numbers"><summary>The numbers: program checks and cost</summary>${scoreboard(v.l, p, groups, jobs)}</details>
<details class="more" id="about-case"><summary>About this case</summary><p>${esc(d.summary)}</p><dl><dt>Who</dt><dd>${esc(d.who)}</dd><dt>Records</dt><dd>${esc(d.sources)}</dd><dt>Planted gaps</dt><dd>${esc(d.planted)}</dd><dt>Traps</dt><dd>${esc(d.traps)}</dd><dt>Guidelines</dt><dd><ul>${d.guidelines.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></dd><dt>Where from</dt><dd class="muted">${esc(d.from)}</dd></dl></details>
<details class="more" id="answers"><summary>Each answer in full, with every fact checked</summary><div class="arms">${answers}</div></details>
${calls ? `<details class="more" id="tool-calls"><summary>Every tool call the ${ARMS.pod.name} made</summary>${calls}</details>` : ""}
<details class="more" id="cost"><summary>Tokens, time and cost of every job</summary>${statsTable(
      r.jobs.filter((j) => j.case === v.caseId),
      r,
    )}</details>`,
  });
}

const DEPTH = {
  visible: "a first answer of one of its questions holds it",
  deeper: "one question deeper than a first answer",
  "narrative-only": "not held: only in a document’s text",
} as const;

function findingPage(v: CaseView, item: KeyItem, p: Place): string {
  const r = v.l.results;
  const { found, groups, jobs } = v;
  const slice = sliceOf(r, v.caseId, item.id);
  const today = Date.parse(found.today);
  const dated = item.evidence
    .map((e) => ({
      e,
      at: e.date === undefined ? undefined : Date.parse(e.date),
    }))
    .sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity));
  const last = Math.max(
    ...dated.flatMap((d) => (d.at === undefined ? [] : [d.at])),
  );
  const months = Number.isFinite(last)
    ? Math.round((today - last) / (30.44 * 86400000))
    : undefined;
  const evidence = dated
    .map(
      ({ e }) =>
        `<li><time>${esc(e.date ?? "")}</time><span>${esc(e.says ?? claimText({ ...e, date: undefined }))}<span class="where">${whereOf(e.cite)}</span></span></li>`,
    )
    .join("");
  const pronoun = found.person.pronoun;
  const why = `<section class="why"><h2>Why the key expects it</h2><ul>${item.links.map((link) => `<li>${esc(link)}</li>`).join("")}</ul>
<dl><dt>In ${pronoun} records</dt><dd><ol class="when">${evidence}<li class="today"><time>${esc(found.today)}</time><span>today${months !== undefined ? `, ${plural(months, "month")} after the last` : ""}</span></li></ol></dd>
${item.absent?.length ? `<dt>Not in ${pronoun} records</dt><dd>${item.absent.map(esc).join("<br>")}</dd>` : ""}
${item.guideline ? `<dt>Guideline</dt><dd>${esc(item.guideline)}</dd>` : ""}
<dt>${item.kind === "gap" ? "Counts as found" : "Passes when"}</dt><dd>${esc(item.found)}${item.partly ? `<br><span class="muted">Partly: ${esc(item.partly)}</span>` : ""}</dd>
<dt>Counts against</dt><dd>${esc(item.wrong.join("; "))}</dd>
${item.notWrong?.length ? `<dt>Fine to ask</dt><dd>${esc(item.notWrong.join("; "))}</dd>` : ""}
<dt>${term(p, "pod-depth", "In the pod")}</dt><dd>${esc(DEPTH[item.pod])}</dd></dl></section>`;
  const arms = groups
    .map((group) => {
      const mine = jobs.filter(inGroup(group));
      const runs = mine
        .map((job) => {
          const answer = answerOf(r, job);
          const verdicts = verdictsOn(r, job, item.id);
          const ns = questionsOn(r, job, v.caseId, item);
          const shown = answer?.questions.filter((q) => ns.includes(q.n)) ?? [];
          const said = shown
            .map(
              (q) =>
                `<blockquote><span class="muted">Q${q.n}</span> ${esc(q.question)}<span class="small">${esc(q.why)}</span></blockquote>`,
            )
            .join("");
          const none =
            shown.length === 0
              ? `<p class="small muted">${item.kind === "gap" ? "No question on it." : "Did not bring it up."}</p>`
              : "";
          const unjudgedNote =
            verdicts.length === 0 && shown.length > 0
              ? `<p class="small muted">Tied to it by the records its questions cite; no judge has read it.</p>`
              : "";
          const wording = (r.checks[job.id]?.trapWording ?? [])
            .filter((w) => w.item === item.id)
            .map(
              (w) =>
                `<p class="small bad">${term(p, "trap-wording", "Trap wording")} in Q${w.question}: “${esc(w.text)}” (${esc(w.means)})</p>`,
            )
            .join("");
          const judged =
            verdicts.length === 0
              ? ""
              : `<details><summary>Judged by ${verdicts.map((x) => esc(judgeName(r, x.judge))).join(" and ")}${new Set(verdicts.map((x) => x.verdict)).size === 1 ? (verdicts.length > 1 ? ": they agree" : "") : ": they split"}</summary><ul class="small">${verdicts.map((x) => `<li>${mark(x.verdict)} <b>${esc(judgeName(r, x.judge))}</b>: ${esc(x.reason)}</li>`).join("")}</ul></details>`;
          const checks = r.checks[job.id];
          const facts = shown.flatMap((q) =>
            (checks?.citations ?? []).filter((c) => c.question === q.n),
          );
          const evidence =
            shown.length === 0
              ? ""
              : `<details><summary>Its evidence: ${plural(facts.length, "cited fact")}, ${facts.filter((c) => c.ok).length} borne out, and the model’s own knowledge</summary>${shown.map((q) => chainOf(r, job, q, v.superseded)).join("")}</details>`;
          const looked =
            job.arm === "pod"
              ? sliceView(slice, r, job, answer)
              : recordsStrip(r, job, v.caseId, answer);
          const reach = new Set(
            slice?.nodes.filter((n) => n.kind !== "record").map((n) => n.id) ??
              [],
          );
          const calls = r.toolCalls.filter(
            (c) => c.job === job.id && c.entries.some((e) => reach.has(e)),
          );
          const tools =
            calls.length === 0
              ? ""
              : `<details><summary>${plural(calls.length, "tool call")} that reached it</summary>${toolCallList(calls, reach)}</details>`;
          return `<div class="run">${runLabel(mine, job)}${runMark(r, job, item.id)}${said}${none}${unjudgedNote}${wording}${judged}${evidence}${looked}${tools}</div>`;
        })
        .join("");
      return `<section class="arm ${group.arm}" id="${group.anchor}"><h3>${groupName(group)}<small>${ARMS[group.arm].gist}</small></h3>${runs}</section>`;
    })
    .join("");
  const cells = groups.map((group) => ({
    group,
    value: pointsOn(r, jobs.filter(inGroup(group)), item.id),
  }));
  const { banner } = caseHeader(v, p);
  return page(p, {
    title: `${item.title}: ${found.person.name}`,
    crumbs: [
      [`Run ${r.run.id}`, "../../index.html"],
      [found.person.name, `../${esc(v.caseId)}.html`],
      [item.title],
    ],
    eyebrow: `${term(p, item.kind === "gap" ? "gap" : "trap", `${kindLabel(item.kind)}${item.kind === "near-trap" ? " (near-trap)" : ""}`)} · key item ${esc(item.id)} · ${esc(found.person.name)}, as of ${esc(found.today)}`,
    h1: esc(item.title),
    lead: `${kindLabel(item.kind)}: ${esc(item.lookingFor)}`,
    banner,
    body: `${why}<h2>What each said <span class="small">${betterOf(cells)}</span></h2><div class="arms">${arms}</div>`,
  });
}

function aboutPage(p: Place): string {
  const sec = (id: string, title: string, body: string) =>
    `<section id="${id}"><h2>${title}</h2>${body}</section>`;
  return page(p, {
    title: "How the Cascade eval works",
    crumbs: [["Results", "index.html"], ["How the test works"]],
    eyebrow: "Cascade evals",
    h1: "How the test works",
    lead: "Does an AI model spot more gaps in a person’s care when it reads their records through Cascade than when it is handed the raw files?",
    body: `<div class="about">
${sec("cascade", "What Cascade gives a model", `<p>A person’s health records arrive from many places, again and again: each hospital, clinic, lab and pharmacy download repeats, overlaps or contradicts the last. Cascade joins them into one <b>pod</b>: one entry per real thing (a test, a medicine, a diagnosis), its history across sources, and its current state. A model reads the pod by asking it questions through tools.</p>`)}
${sec("same-model", "Two inputs, one model, one question", `<p>The same model gets the same task twice, in a fresh session each time: <i>help this person prepare for their next primary-care visit; list at most ten questions about gaps in their care, from their records only, and cite the record behind each fact.</i> Only the input differs.</p>`)}
${sec("cascade-pod", ARMS.pod.name, `<p>${ARMS.pod.gist[0]!.toUpperCase()}${ARMS.pod.gist.slice(1)}. The model may only call the pod’s tools (cascade-mcp); it reads no file.</p>`)}
${sec("grab-bag", ARMS.records.name, `<p>${ARMS.records.gist[0]!.toUpperCase()}${ARMS.records.gist.slice(1)}, as if pasted into a chat: every download, every older copy, in the order they arrived. No search, no tools.</p>`)}
${sec("key", "Synthetic people and their answer keys", `<p>Every person is made up; no real records are used. Each has an <b>answer key</b>, written and independently reviewed before any model ran: the gaps a careful reader should find, and the traps that look like gaps but are not, each with the records that make it true and the guideline behind it.</p>`)}
${sec("gap", "Should find: gaps", `<p>Something the records show is overdue, missed or inconsistent: a test never done, a follow-up that never happened. Verdicts: <b>found</b>, <b>partly</b> (the gist, without what makes it a gap), <b>missed</b>.</p>`)}
${sec("trap", "Should not raise: traps", `<p>Something that looks like a gap in one record but the full history shows is not: a result since corrected, a medicine replaced, a diagnosis ruled out, a test done elsewhere. <b>Not raised</b> is the right answer; <b>raised</b> means the model fell for it. A <b>near-trap</b> is a common wrong suggestion the records do not support.</p>`)}
${sec("judges", "Judges", `<p>Cheaper models score each answer against the key. They read the answers labelled by letter only, never told which input produced which. In a full run two judges score every answer, and the report shows how often they agree. Verdicts sit one level down, under each answer.</p>`)}
${sec("not-judged", "Not judged", `<p>A smoke run checks the plumbing: both inputs answer, the program checks run, and no judge is paid for. Its pages show each answer and the program checks, never found or missed. Where an answer’s questions are tied to a key item, it is by the records they cite, not by a judge.</p>`)}
${sec("false-alarm", "False alarms", `<p>A question the records contradict, or a trap raised, as a judge reads it. Aim: none.</p>`)}
${sec("fair-find", "Fair finds", `<p>A question outside the key that the key marks as a legitimate find: neither credit nor penalty, but worth seeing.</p>`)}
${sec("cited", "Cited facts the records bear out", `<p>Every fact a model states names the record it comes from and the field it relies on (a value, a date, a code). A program opens that record and checks the field. Aim: all of them.</p>`)}
${sec("absence", "“Not in the records” claims proven", `<p>A gap is often an absence. When a model says something is missing, it names what it looked for and where. For the pod, a program checks that the query ran, answered whole, and returned nothing matching; for the grab bag, that each file it names was read whole and holds nothing matching.</p>`)}
${sec("trap-wording", "Trap wording", `<p>Phrases the key flags as a known wrong answer, such as offering a repeat stool test as the follow-up to a positive one. Found by program; aim: none.</p>`)}
${sec("kept-to-input", "Kept to its input", `<p>Whether the model stayed within its input: the pod’s tools only, or reading the files only.</p>`)}
${sec("pod-depth", "Where the pod holds an item", `<p>From the key: in a first answer of one of the pod’s questions, one question deeper, or not at all (only in a document’s free text).</p>`)}
${sec("cost", "Cost", `<p>Tokens and dollars for each answer, from every model call’s own usage, priced at list prices. “Exact” means the usage the API reported; “estimated”, a fallback.</p>`)}
${sec("tier", "Tiers", `<p><b>smoke</b>: one person, one answer per input, no judges. <b>standard</b>: every person, one answer, one judge. <b>full</b>: three answers per input, two judges and their agreement.</p>`)}
</div>`,
  });
}

async function writeRun(
  results: Results,
  out: string,
  up: string,
  history: boolean,
  trend: string,
): Promise<string> {
  const l = await loaded(results);
  await mkdir(join(out, "cases"), { recursive: true });
  await writeFile(
    join(out, "index.html"),
    runIndex(l, { depth: 0, up, history }, trend),
  );
  for (const id of l.cases.keys()) {
    const v = caseView(l, id);
    await writeFile(
      join(out, "cases", `${id}.html`),
      casePage(v, { depth: 1, up, history }),
    );
    await mkdir(join(out, "cases", id), { recursive: true });
    for (const item of v.key.items)
      await writeFile(
        join(out, "cases", id, `${idOf(item.id)}.html`),
        findingPage(v, item, { depth: 2, up, history }),
      );
  }
  return join(out, "index.html");
}

function trendPoints(all: readonly Results[]) {
  return all.map((r) => {
    const values: Record<string, number> = {};
    for (const arm of ["pod", "records"] as const) {
      const scores = r.scores.filter(
        (s) => r.jobs.find((j) => j.id === s.subject)?.arm === arm,
      );
      if (scores.length > 0)
        values[`${ARMS[arm].name}: share of gaps found`] =
          scores.reduce((sum, s) => sum + s.found + s.partly / 2, 0) /
          Math.max(
            1,
            scores.reduce((sum, s) => sum + s.gaps, 0),
          );
    }
    return { label: r.run.id.slice(0, 13), values };
  });
}

function trendSvg(
  points: readonly { label: string; values: Record<string, number> }[],
): string {
  if (points.length < 2)
    return `<p class="muted small">One run so far: the trend starts with the next recorded run.</p>`;
  const series = [...new Set(points.flatMap((p) => Object.keys(p.values)))];
  const max = Math.max(1, ...points.flatMap((p) => Object.values(p.values)));
  const w = 640;
  const h = 180;
  const x = (i: number) => 90 + (i * (w - 180)) / (points.length - 1);
  const y = (v: number) => h - 24 - (v / max) * (h - 44);
  const dash = ["", "6 4", "2 3", "8 3 2 3"];
  const lines = series
    .map((name, s) => {
      const pts = points
        .map((p, i) =>
          p.values[name] === undefined
            ? undefined
            : `${x(i)},${y(p.values[name]!)}`,
        )
        .filter(Boolean)
        .join(" ");
      return `<polyline fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="${dash[s % dash.length]}" points="${pts}"/>`;
    })
    .join("");
  const legend = series
    .map(
      (name, s) =>
        `<span class="small"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" stroke-width="2" stroke-dasharray="${dash[s % dash.length]}"/></svg> ${esc(name)}</span>`,
    )
    .join("");
  const labels = points
    .map(
      (p, i) =>
        `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" class="muted">${esc(p.label)}</text>`,
    )
    .join("");
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Share of gaps found per run, by input">${lines}${labels}</svg>`;
}

/** Builds the site of one run's folder, or of every run in history/ with the trend across them. Returns the index. */
export async function buildSite(
  from: { run?: string; history?: boolean },
  out?: string,
): Promise<string> {
  if (from.history !== true) {
    const folder = runFolder(from.run ?? "");
    const results = JSON.parse(
      await readFile(join(folder, "results.json"), "utf8"),
    ) as Results;
    const target = resolve(out ?? join(folder, "site"));
    const index = await writeRun(
      results,
      target,
      "",
      false,
      trendSvg(trendPoints([results])),
    );
    await writeFile(
      join(target, "about.html"),
      aboutPage({ depth: 0, up: "", history: false }),
    );
    return index;
  }
  const target = resolve(out ?? join(HISTORY, "..", "site"));
  const runs: { name: string; results: Results }[] = [];
  if (existsSync(HISTORY))
    for (const name of (await readdir(HISTORY)).sort()) {
      const path = join(HISTORY, name, "results.json");
      if (existsSync(path))
        runs.push({
          name,
          results: JSON.parse(await readFile(path, "utf8")) as Results,
        });
    }
  const trend = trendSvg(trendPoints(runs.map((it) => it.results)));
  for (const { name, results } of runs)
    await writeRun(results, join(target, "runs", name), "../../", true, trend);
  await mkdir(target, { recursive: true });
  const home: Place = { depth: 0, up: "", history: false };
  await writeFile(join(target, "about.html"), aboutPage(home));
  const rows = runs
    .slice()
    .reverse()
    .map(({ name, results: r }) => {
      const l: Loaded = { results: r, cases: new Map(), missing: [] };
      const subjects = subjectsOf(r);
      const byArm = (["pod", "records"] as const)
        .map((arm) => {
          const scores = r.scores.filter(
            (s) => subjects.find((j) => j.id === s.subject)?.arm === arm,
          );
          const t = tallyOf(
            l,
            subjects.filter(
              (j) => j.arm === arm && scores.some((s) => s.subject === j.id),
            ),
          );
          return `<td>${scores.length === 0 ? `<span class="mark unjudged">Not judged</span>` : `${num(t.found)} of ${num(t.gaps)} gaps found${t.partly ? `, ${num(t.partly)} partly` : ""}<br><span class="small muted">${num(t.trapsRaised)} traps raised, ${num(t.falseQuestions)} false alarms</span>`}</td>`;
        })
        .join("");
      return `<tr class="link" data-href="runs/${esc(name)}/index.html"><td><a href="runs/${esc(name)}/index.html">${esc(r.run.id)}</a><br><span class="small muted">${esc(r.run.tier)} tier · ${plural(r.cases.length, "person", "people")}</span></td>${byArm}<td class="small">${dollars(r.budget.spent.usd)} (${esc(r.budget.spent.basis)})<br>${thousands(r.budget.spent.tokens)} tokens</td></tr>`;
    })
    .join("");
  await writeFile(
    join(target, "index.html"),
    page(home, {
      title: "Cascade evals",
      crumbs: [],
      eyebrow: "Cascade evals",
      h1: "Does Cascade help an AI spot the gaps in a person’s care?",
      lead: `Every recorded run: the same model given a person’s <span class="pod-name">Cascade pod</span> or their <span class="bag-name">Grab bag</span> of raw files. <a href="about.html">How the test works</a>`,
      body: `<h2>Runs</h2>${runs.length === 0 ? `<p class="muted">No run is recorded yet: <code>npm run evals:record &lt;run&gt;</code> records one.</p>` : `<div class="table"><table><tr><th>Run</th><th>${ARMS.pod.name}</th><th>${ARMS.records.name}</th><th>Spent</th></tr>${rows}</table></div>`}<h2>Trend</h2>${trend}`,
    }),
  );
  return join(target, "index.html");
}
