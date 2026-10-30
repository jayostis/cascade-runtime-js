// The report site, generated from results.json and the case files and never edited by hand: an index of the run (or
// of every recorded run, with the trend) and a page per case. Both arms get the same treatment on every page.
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
import { HISTORY } from "./paths.js";
import type { Grade, Job, Results, Score, Slice } from "./results.js";
import { runFolder } from "./results.js";

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
  n === undefined ? "–" : n < 90 ? `${n} s` : `${Math.round(n / 60)} min`;

const STYLE = `
:root{--bg:#fbfbfa;--fg:#1f2328;--muted:#5d6670;--line:#d8dde3;--card:#fff;--soft:#f2f4f6;
--found:#1a7f37;--found-bg:#dcf3e2;--partly:#9a6700;--partly-bg:#fbefc8;--missed:#57606a;--missed-bg:#eaeef2;
--false:#c0262d;--false-bg:#fde2e1;--know:#6639ba;--know-bg:#efe7fb;--ok:#1a7f37;--bad:#c0262d;--link:#0b5cad}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111418;--fg:#e6e9ee;--muted:#9aa4af;--line:#2f363e;
--card:#181c21;--soft:#20262d;--found:#4fc26b;--found-bg:#123821;--partly:#e3b341;--partly-bg:#3a2e0b;--missed:#9aa4af;
--missed-bg:#262c33;--false:#ff7b72;--false-bg:#45191a;--know:#b69cf4;--know-bg:#2a1f45;--ok:#4fc26b;--bad:#ff7b72;--link:#6cb6ff}}
:root[data-theme=dark]{--bg:#111418;--fg:#e6e9ee;--muted:#9aa4af;--line:#2f363e;--card:#181c21;--soft:#20262d;--found:#4fc26b;
--found-bg:#123821;--partly:#e3b341;--partly-bg:#3a2e0b;--missed:#9aa4af;--missed-bg:#262c33;--false:#ff7b72;--false-bg:#45191a;
--know:#b69cf4;--know-bg:#2a1f45;--ok:#4fc26b;--bad:#ff7b72;--link:#6cb6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}a{color:var(--link)}h1{font-size:1.6rem;margin:.2em 0 .1em}
h2{font-size:1.2rem;margin:2em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--line)}h3{font-size:1.02rem;margin:1.4em 0 .4em}
.muted{color:var(--muted)}.small{font-size:.86rem}code,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.84em}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:12px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.tile b{display:block;font-size:1.25rem}
.tile span{color:var(--muted);font-size:.82rem}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.8rem;color:var(--muted);font-weight:600;background:var(--soft)}tr:last-child td{border-bottom:0}
tr.link{cursor:pointer}tr.link:hover td{background:var(--soft)}
.chip{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.78rem;font-weight:600;white-space:nowrap;margin:1px 2px 1px 0}
.found{color:var(--found);background:var(--found-bg)}.partly{color:var(--partly);background:var(--partly-bg)}
.missed{color:var(--missed);background:var(--missed-bg)}.false,.raised{color:var(--false);background:var(--false-bg)}
.avoided{color:var(--found);background:var(--found-bg)}.ungraded{color:var(--muted);background:var(--soft)}
.ok{color:var(--ok)}.bad{color:var(--bad)}
.arms{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.arm{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.arm h4{margin:0 0 6px;font-size:.95rem}
.chain{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin:8px 0}
.chain>.col{flex:1 1 200px;display:flex;flex-direction:column;gap:6px;min-width:180px}
.card{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card);font-size:.88rem}
.card.knowledge{background:var(--know-bg);border-color:var(--know);color:var(--fg)}.card.knowledge .lab{color:var(--know);font-weight:600}
.card.question{border-width:2px}.card.expected{border-style:dashed;opacity:.65;background:transparent}
.card.absence{background:var(--soft)}.lab{font-size:.74rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.src{display:inline-block;font-size:.76rem;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 6px;margin-top:3px}
details{margin:6px 0}summary{cursor:pointer;color:var(--muted);font-size:.86rem}pre{white-space:pre-wrap;word-break:break-word;background:var(--soft);padding:8px;border-radius:6px;font-size:.78rem;max-height:240px;overflow:auto}
svg text{fill:var(--fg);font-size:11px}svg .muted{fill:var(--muted)}
.strip{display:flex;gap:2px;flex-wrap:wrap;margin:6px 0}.doc{height:22px;border-radius:3px;background:var(--missed-bg);border:1px solid var(--line);position:relative}
.doc.read{background:var(--found-bg);border-color:var(--found)}.doc .pin{position:absolute;top:-4px;width:3px;height:30px;background:var(--know)}
nav.top{display:flex;gap:14px;font-size:.86rem;margin-bottom:8px}.legend{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
`;

function page(title: string, body: string, home: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
<nav class="top"><a href="${home}">Eval runs</a></nav>${body}
<p class="muted small">Generated from results.json and the case files by <code>npm run evals:report</code>; never edited by hand.</p>
</main><script>document.querySelectorAll("tr[data-href]").forEach(r=>r.addEventListener("click",()=>location.href=r.dataset.href))</script></body></html>`;
}

interface Loaded {
  readonly results: Results;
  readonly cases: Map<string, { found: Case; key: Key; keyChanged: boolean }>;
}

async function loaded(results: Results): Promise<Loaded> {
  const cases = new Map<
    string,
    { found: Case; key: Key; keyChanged: boolean }
  >();
  for (const { id, keySha256 } of results.cases) {
    const found = await loadCase(id);
    const { key, sha256 } = await loadKey(id);
    cases.set(id, { found, key, keyChanged: sha256 !== keySha256 });
  }
  return { results, cases };
}

const armName = (arm: string | undefined) =>
  arm === "pod" ? "pod (cascade-mcp)" : "records (pasted)";
const subjectsOf = (results: Results, caseId?: string) =>
  results.jobs.filter(
    (it) =>
      it.role === "subject" &&
      (caseId === undefined || it.case === caseId) &&
      (it.status === "done" || it.status === "reused"),
  );
/** The arm and model a subject ran as: the column pages group by, both arms alike. */
const groupOf = (job: Job) =>
  `${job.arm} · ${job.model.replace(/^claude-/, "")}`;

function chip(verdict: string, text = verdict) {
  return `<span class="chip ${esc(verdict)}">${esc(text)}</span>`;
}

function scoreLine(scores: readonly Score[]): string {
  if (scores.length === 0)
    return chip("ungraded", "not graded (programs only)");
  const mean = (pick: (s: Score) => number) =>
    scores.reduce((sum, s) => sum + pick(s), 0) / scores.length;
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return [
    chip("found", `${f(mean((s) => s.found))} found`),
    chip("partly", `${f(mean((s) => s.partly))} partly`),
    chip("missed", `${f(mean((s) => s.missed))} missed`),
    chip("false", `${f(mean((s) => s.falseQuestions))} false`),
  ].join("");
}

function programLine(results: Results, jobs: readonly Job[]): string {
  let cited = 0;
  let held = 0;
  let absent = 0;
  let backed = 0;
  let wording = 0;
  let disciplined = 0;
  for (const job of jobs) {
    const checks = results.checks[job.id];
    if (checks === undefined) continue;
    cited += checks.citations.length;
    held += checks.citations.filter((it) => it.ok).length;
    absent += checks.absences.length;
    backed += checks.absences.filter((it) => it.backed).length;
    wording += checks.trapWording.length;
    if (checks.discipline.ok) disciplined++;
  }
  return `<span class="small">citations verified <b>${held}/${cited}</b> · absences backed <b>${backed}/${absent}</b> · trap wording <b class="${wording ? "bad" : ""}">${wording}</b> · kept to its tools <b>${disciplined}/${jobs.length}</b></span>`;
}

const tokensOf = (jobs: readonly Job[]) =>
  jobs.reduce((sum, it) => sum + (it.stats?.tokens.total ?? 0), 0);
const usdOf = (jobs: readonly Job[]) =>
  jobs.reduce((sum, it) => sum + (it.stats?.cost.usd ?? 0), 0);

function trendSvg(
  points: readonly { label: string; values: Record<string, number> }[],
): string {
  if (points.length < 2)
    return `<p class="muted small">One run so far: the trend starts with the next recorded run.</p>`;
  const series = [...new Set(points.flatMap((p) => Object.keys(p.values)))];
  const max = Math.max(1, ...points.flatMap((p) => Object.values(p.values)));
  const w = 640;
  const h = 180;
  const x = (i: number) => 40 + (i * (w - 60)) / (points.length - 1);
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
        `<span class="chip ungraded"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" stroke-width="2" stroke-dasharray="${dash[s % dash.length]}"/></svg> ${esc(name)}</span>`,
    )
    .join("");
  const labels = points
    .map(
      (p, i) =>
        `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" class="muted">${esc(p.label)}</text>`,
    )
    .join("");
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Gaps found per run, by arm">${lines}${labels}</svg>`;
}

function headToHead(l: Loaded): string {
  const rows: string[] = [];
  for (const [caseId, { key, found }] of l.cases)
    for (const item of key.items.filter((it) => it.kind === "gap")) {
      const groups = new Map<string, string[]>();
      for (const job of subjectsOf(l.results, caseId)) {
        const verdicts = l.results.grades
          .filter((g) => g.subject === job.id)
          .map(
            (g) => g.items.find((it) => it.id === item.id)?.verdict ?? "missed",
          );
        const list = groups.get(groupOf(job)) ?? [];
        list.push(...(verdicts.length > 0 ? verdicts : ["ungraded"]));
        groups.set(groupOf(job), list);
      }
      rows.push(
        `<tr><td>${esc(found.person.name)}</td><td><b>${esc(item.id)}</b> ${esc(item.lookingFor)}</td>${[
          ...groups.entries(),
        ]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(
            ([group, verdicts]) =>
              `<td><span class="muted small">${esc(group)}</span><br>${verdicts.map((v) => chip(v)).join("")}</td>`,
          )
          .join("")}</tr>`,
      );
    }
  return rows.length === 0
    ? ""
    : `<h2>Head to head, per gap</h2><p class="muted small">Each planted gap, as the judges graded each arm. Where one arm finds a gap the other misses, the row says so.</p><div class="table"><table><tr><th>Person</th><th>Gap</th><th colspan="9">Arms</th></tr>${rows.join("")}</table></div>`;
}

function verdictText(l: Loaded): string {
  const arms = new Map<string, Score[]>();
  for (const s of l.results.scores) {
    const job = l.results.jobs.find((it) => it.id === s.subject);
    if (job === undefined) continue;
    const list = arms.get(job.arm!) ?? [];
    list.push(s);
    arms.set(job.arm!, list);
  }
  if (arms.size === 0)
    return `<p>This run was not graded: it ran the program checks only (a smoke run, or judges left out). Its verdict on pod against pasted records is in the checks and the costs below, not in gaps found.</p>`;
  const rate = (list: Score[]) =>
    list.reduce((s, it) => s + it.found + it.partly / 2, 0) /
    Math.max(
      1,
      list.reduce((s, it) => s + it.gaps, 0),
    );
  const falses = (list: Score[]) =>
    list.reduce((s, it) => s + it.falseQuestions, 0) / list.length;
  const pod = arms.get("pod") ?? [];
  const records = arms.get("records") ?? [];
  if (pod.length === 0 || records.length === 0) return "";
  const better =
    rate(pod) > rate(records)
      ? "the pod arm found more"
      : rate(pod) < rate(records)
        ? "pasted records found more"
        : "the arms found as many";
  return `<p><b>Overall, ${better}:</b> pod ${(rate(pod) * 100).toFixed(0)}% of planted gaps (partly counts half) with ${falses(pod).toFixed(1)} false questions a run; pasted records ${(rate(records) * 100).toFixed(0)}% with ${falses(records).toFixed(1)}.</p>`;
}

function runIndex(l: Loaded, home: string, trend: string): string {
  const r = l.results;
  const subjects = subjectsOf(r);
  const groups = [...new Set(subjects.map(groupOf))].sort();
  const caseRows = [...l.cases.entries()]
    .sort(
      ([, a], [, b]) =>
        a.found.person.name.localeCompare(b.found.person.name) ||
        a.found.id.localeCompare(b.found.id),
    )
    .map(([id, { found, key }]) => {
      const cells = groups
        .map((group) => {
          const jobs = subjectsOf(r, id).filter((it) => groupOf(it) === group);
          const scores = r.scores.filter((s) =>
            jobs.some((j) => j.id === s.subject),
          );
          return `<td>${scoreLine(scores)}<br>${programLine(r, jobs)}<br><span class="small muted">${thousands(tokensOf(jobs))} tokens · ${dollars(usdOf(jobs))}</span></td>`;
        })
        .join("");
      const looking = key.items
        .filter((it) => it.kind === "gap")
        .map((it) => esc(it.lookingFor))
        .join("; ");
      return `<tr class="link" data-href="cases/${esc(id)}.html"><td><a href="cases/${esc(id)}.html"><b>${esc(found.person.name)}</b></a><br><span class="small muted">${esc(id)}</span></td><td class="small">Looking for: ${looking}</td>${cells}</tr>`;
    })
    .join("");
  const cfg = r.run.config as {
    cases: unknown;
    arms: string[];
    subjects: string[];
    repeats: number;
    judges: string[];
  };
  const spent = r.budget.spent;
  const tiles = [
    ["tier", r.run.tier],
    ["cases", String(l.cases.size)],
    ["arms", cfg.arms.join(", ")],
    ["subject models", cfg.subjects.join(", ")],
    ["repeats", String(cfg.repeats)],
    ["judges", cfg.judges.length === 0 ? "none" : cfg.judges.join(", ")],
    ["tokens spent", thousands(spent.tokens)],
    [
      "estimate",
      `${thousands(r.budget.estimate.tokens)} · ${dollars(r.budget.estimate.usd)}`,
    ],
    ["cap", `${thousands(r.budget.cap.tokens)} · ${dollars(r.budget.cap.usd)}`],
    [`cost (${spent.basis})`, dollars(spent.usd)],
    ["wall time", seconds(r.run.wallSeconds)],
    ["stopped at cap", r.run.stoppedAtCap ? "yes" : "no"],
  ]
    .map(
      ([k, v]) =>
        `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`,
    )
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
  return page(
    `Eval run ${r.run.id}`,
    `<h1>Eval run ${esc(r.run.id)}</h1><p class="muted">The pod, through cascade-mcp, against the same records pasted in, on synthetic people with keys written before any run.</p>
${verdictText(l)}<div class="tiles">${tiles}</div><p class="small muted">By role: ${roles || "–"}. Prices: list prices of ${esc(r.versions.priceTable)}; "exact" means every call's usage as the API reported it.</p>
<p class="small muted">Tested: ${commits}</p>
<h2>Cases</h2><div class="table"><table><tr><th>Person</th><th>What the key looks for</th>${groups.map((g) => `<th>${esc(g)}</th>`).join("")}</tr>${caseRows}</table></div>
${headToHead(l)}<h2>Trend</h2>${trend}`,
    home,
  );
}

function factCard(
  fact: Answer["questions"][number]["facts"][number],
  check: Results["checks"][string]["citations"][number] | undefined,
): string {
  const verified =
    check === undefined
      ? ""
      : check.ok
        ? `<span class="ok">✓ verified</span>`
        : `<span class="bad">✗ ${esc(check.reason)}${check.missing?.length ? `: ${esc(check.missing.join(", "))} not there` : ""}</span>`;
  const where =
    "entry" in fact.cite
      ? `entry <code>${esc(fact.cite.entry.split("#").pop()?.slice(0, 12))}…</code>`
      : "line" in fact.cite
        ? `${esc(fact.cite.file)}:${fact.cite.line}`
        : `${esc(fact.cite.file)} ${esc(fact.cite.resource)}`;
  return `<div class="card"><div class="lab">fact</div>${esc(fact.says)}<br><span class="src">${esc(fact.provider)}${fact.date ? ` · ${esc(fact.date)}` : ""}</span> <span class="small">${verified}</span>
<details><summary>${where}</summary>${check?.excerpt ? `<pre>${esc(check.excerpt)}</pre>` : `<span class="small muted">no excerpt</span>`}</details></div>`;
}

function chainOf(
  r: Results,
  job: Job,
  question: Answer["questions"][number],
  expected: KeyItem | undefined,
): string {
  const checks = r.checks[job.id];
  const facts = question.facts
    .map((f, at) =>
      factCard(
        f,
        checks?.citations.find(
          (c) => c.question === question.n && c.fact === at,
        ),
      ),
    )
    .join("");
  const absences = question.absences
    .map((a, at) => {
      const backing = checks?.absences.find(
        (c) => c.question === question.n && c.absence === at,
      );
      return `<div class="card absence"><div class="lab">absent</div>${esc(a.what)}<br><span class="small muted">looked through: ${esc(a.coverage)}</span>${a.query ? `<br><code class="small">${esc(a.query.tool)} ${esc(JSON.stringify(a.query.input))}</code>` : ""}<br><span class="small ${backing?.backed ? "ok" : "bad"}">${backing?.backed ? "✓ backed" : `✗ unbacked${backing?.reason ? `: ${esc(backing.reason)}` : ""}`}</span></div>`;
    })
    .join("");
  const outline =
    expected === undefined
      ? ""
      : `<div class="col"><div class="card expected"><div class="lab">the key's chain</div>${expected.evidence.map((e) => esc(e.says ?? [e.date, ...(e.values ?? [])].filter(Boolean).join(" "))).join("<br>")}${expected.links.map((link) => `<br>→ ${esc(link)}`).join("")}</div></div>`;
  return `<div class="chain"><div class="col">${facts}${absences}</div><div class="col"><div class="card knowledge"><div class="lab">the model's own knowledge</div>${esc(question.knowledge.says)}${question.knowledge.guideline ? `<br><span class="small">names: ${esc(question.knowledge.guideline)}</span>` : ""}</div></div><div class="col"><div class="card question"><div class="lab">question ${question.n} · ${esc(question.confidence)}</div><b>${esc(question.question)}</b><br><span class="small">${esc(question.why)}</span></div></div>${outline}</div>`;
}

function sliceSvg(
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
  const entries = slice.nodes.filter((n) => n.kind !== "record");
  const records = slice.nodes.filter((n) => n.kind === "record");
  const rowH = 44;
  const h = Math.max(entries.length, records.length) * rowH + 16;
  const w = 640;
  const pos = new Map<string, [number, number]>();
  entries.forEach((n, i) => pos.set(n.id, [10, 8 + i * rowH]));
  records.forEach((n, i) => pos.set(n.id, [330, 8 + i * rowH]));
  const state = (id: string) =>
    job.arm !== "pod"
      ? "never"
      : cited.has(id)
        ? "cited"
        : returned.has(id)
          ? "returned"
          : "never";
  const edges = slice.edges
    .map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      return a && b
        ? `<line x1="${a[0] + 300}" y1="${a[1] + 18}" x2="${b[0]}" y2="${b[1] + 18}" stroke="currentColor" opacity=".35"/>`
        : "";
    })
    .join("");
  const nodes = slice.nodes
    .map((n) => {
      const [x, y] = pos.get(n.id)!;
      const s = n.kind === "record" ? "record" : state(n.id);
      const stroke = s === "cited" ? 3 : 1.2;
      const fade = s === "never" && n.kind !== "record" ? ' opacity=".45"' : "";
      const dash = s === "returned" ? ' stroke-dasharray="5 3"' : "";
      return `<g${fade}><rect x="${x}" y="${y}" width="300" height="36" rx="7" fill="none" stroke="currentColor" stroke-width="${stroke}"${dash}/><text x="${x + 8}" y="${y + 15}">${esc(n.label.slice(0, 48))}</text><text x="${x + 8}" y="${y + 29}" class="muted">${esc((n.source ? `${n.source} · ` : "") + (n.detail ?? "")).slice(0, 56)}</text></g>`;
    })
    .join("");
  return `<details><summary>The pod around this item (${slice.nodes.length} nodes): bold = cited, dashed = a tool returned it, faint = never reached</summary><svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Pod entries and their records">${edges}${nodes}</svg></details>`;
}

function timelineSvg(item: KeyItem, today: string): string {
  const dates = item.evidence
    .filter((e) => e.date !== undefined)
    .map((e) => ({
      at: Date.parse(e.date!),
      text: (e.says ?? e.values?.join(" ") ?? "").slice(0, 28),
      date: e.date!,
    }));
  if (dates.length === 0) return "";
  const end = Date.parse(today);
  const start = Math.min(...dates.map((d) => d.at));
  const w = 640;
  const x = (t: number) =>
    20 + ((t - start) / Math.max(1, end - start)) * (w - 40);
  const last = Math.max(...dates.map((d) => d.at));
  const marks = dates
    .map(
      (d, i) =>
        `<circle cx="${x(d.at)}" cy="40" r="4" fill="currentColor"/><text x="${x(d.at)}" y="${i % 2 ? 66 : 24}" text-anchor="middle">${esc(d.date)}</text><text x="${x(d.at)}" y="${i % 2 ? 80 : 12}" text-anchor="middle" class="muted">${esc(d.text)}</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${w} 92" width="100%" role="img" aria-label="The item's dates up to today"><line x1="20" y1="40" x2="${w - 20}" y2="40" stroke="currentColor" opacity=".3"/><line x1="${x(last)}" y1="40" x2="${x(end)}" y2="40" stroke="currentColor" stroke-width="4" stroke-dasharray="2 4" opacity=".6"/>${marks}<circle cx="${x(end)}" cy="40" r="5" fill="none" stroke="currentColor" stroke-width="2"/><text x="${x(end)}" y="66" text-anchor="end">today ${esc(today)}</text></svg>`;
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
      q.facts.flatMap((f) => ("file" in f.cite ? [f.cite.file] : [])),
    ) ?? [];
  const blocks = docs
    .map((d) => {
      const width = Math.max(
        4,
        Math.round((d.bytes / Math.max(1, total)) * 900),
      );
      const pins = cites.filter((c) => c === d.file).length;
      return `<div class="doc ${read.has(d.file) ? "read" : ""}" style="width:${width}px" title="${esc(d.file)} · ${thousands(d.bytes)} bytes${pins ? ` · cited ${pins}×` : ""}">${pins ? '<span class="pin" style="left:45%"></span>' : ""}</div>`;
    })
    .join("");
  return `<details><summary>The records it was given: ${docs.length} documents, ${thousands(total)} bytes; ${read.size} read (green), purple marks where it cited</summary><div class="strip">${blocks}</div></details>`;
}

function statsTable(jobs: readonly Job[]): string {
  return `<div class="table"><table><tr><th>Job</th><th>Status</th><th>Model</th><th>Tokens (in / cache write / cache read / out)</th><th>Context peak</th><th>Tool calls</th><th>Time</th><th>Cost</th></tr>${jobs
    .map((j) => {
      const s = j.stats;
      return `<tr><td class="mono">${esc(j.id)}</td><td>${esc(j.status)}${j.reusedFrom ? `<br><span class="small muted">from ${esc(j.reusedFrom)}</span>` : ""}${j.reason ? `<br><span class="small muted">${esc(j.reason)}</span>` : ""}</td><td class="small">${esc(s?.models.join(", ") ?? j.model)}</td><td class="small">${s ? `${thousands(s.tokens.input)} / ${thousands(s.tokens.cacheCreation)} / ${thousands(s.tokens.cacheRead)} / ${thousands(s.tokens.output)}<br><b>${thousands(s.tokens.total)}</b> (estimate ${thousands(j.estimate.tokens)})` : `estimate ${thousands(j.estimate.tokens)}`}</td><td>${thousands(s?.contextPeak)}</td><td class="small">${
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

function casePage(l: Loaded, caseId: string, home: string): string {
  const r = l.results;
  const { found, key, keyChanged } = l.cases.get(caseId)!;
  const d = found.description;
  const subjects = subjectsOf(r, caseId).sort(
    (a, b) => groupOf(a).localeCompare(groupOf(b)) || a.id.localeCompare(b.id),
  );
  const answerOf = (job: Job) => {
    const a = r.answers[job.id] as Answer | undefined;
    return a !== undefined && Array.isArray(a.questions) ? a : undefined;
  };
  const gradesOf = (job: Job): Grade[] =>
    r.grades.filter((g) => g.subject === job.id);
  const items = key.items
    .map((item) => {
      const slice = r.slices.find(
        (s) => s.case === caseId && s.item === item.id,
      );
      const arms = subjects
        .map((job) => {
          const answer = answerOf(job);
          const grades = gradesOf(job);
          const verdicts = grades
            .map((g) => g.items.find((it) => it.id === item.id))
            .filter(Boolean);
          const questions = new Set(verdicts.flatMap((v) => v!.questions));
          const shown =
            answer?.questions.filter((q) => questions.has(q.n)) ?? [];
          const grade =
            grades.length === 0
              ? chip("ungraded", "not graded")
              : verdicts
                  .map(
                    (v) =>
                      `${chip(v!.verdict)} <span class="small">${esc(v!.reason)}</span>`,
                  )
                  .join("<br>");
          const wording = (r.checks[job.id]?.trapWording ?? [])
            .filter((w) => w.item === item.id)
            .map(
              (w) =>
                `<br><span class="small bad">trap wording in Q${w.question}: “${esc(w.text)}” (${esc(w.means)})</span>`,
            )
            .join("");
          return `<div class="arm"><h4>${esc(armName(job.arm))} <span class="muted small">${esc(job.model)} · run ${job.repeat}</span></h4>${grade}${wording}
${shown.map((q) => chainOf(r, job, q, item)).join("") || (grades.length === 0 ? "" : `<p class="small muted">No question of this answer is about it.</p>`)}
${job.arm === "pod" ? sliceSvg(slice, r, job, answer) : recordsStrip(r, job, caseId, answer)}</div>`;
        })
        .join("");
      return `<h3>${esc(item.id)} · ${esc(item.title)} ${chip(item.kind === "gap" ? "found" : "false", item.kind)}</h3>
<p class="small">Looking for: ${esc(item.lookingFor)}. <span class="muted">Found means ${esc(item.found)}${item.partly ? `; partly: ${esc(item.partly)}` : ""}. Wrong: ${esc(item.wrong.join("; "))}. The pod holds it: ${esc(item.pod)}.${item.guideline ? ` Guideline: ${esc(item.guideline)}.` : ""}</span></p>
${timelineSvg(item, found.today)}<div class="arms">${arms}</div>`;
    })
    .join("");
  const falseOnes = subjects
    .flatMap((job) =>
      gradesOf(job).flatMap((g) =>
        g.falseQuestions.map((fq) => {
          const q = answerOf(job)?.questions.find((it) => it.n === fq.question);
          return `<div class="arm"><h4>${esc(armName(job.arm))} <span class="muted small">${esc(job.model)} · run ${job.repeat}</span> ${chip("false")}</h4><p class="small">${esc(fq.why)}${fq.item ? ` (${esc(fq.item)})` : ""}</p>${q ? chainOf(r, job, q, undefined) : ""}</div>`;
        }),
      ),
    )
    .join("");
  const answers = subjects
    .map((job) => {
      const answer = answerOf(job);
      return `<div class="arm"><h4>${esc(armName(job.arm))} <span class="muted small">${esc(job.model)} · run ${job.repeat}</span></h4>${programLine(r, [job])}
${(r.checks[job.id]?.discipline.violations ?? []).map((v) => `<br><span class="small bad">outside its tools: ${esc(v)}</span>`).join("")}
${answer === undefined ? `<p class="bad">No valid answer: ${esc((r.checks[job.id]?.answerErrors ?? []).join("; "))}</p>` : answer.questions.map((q) => chainOf(r, job, q, undefined)).join("")}</div>`;
    })
    .join("");
  return page(
    `${found.person.name}: eval case`,
    `<h1>${esc(found.person.name)}</h1><p class="muted">${esc(caseId)} · synthetic · as of ${esc(found.today)} · run ${esc(r.run.id)}</p>
${keyChanged ? `<p class="bad small">The key has changed since this run; the page shows the current key.</p>` : ""}
<p>${esc(d.summary)}</p><div class="arms"><div class="arm"><h4>Who</h4><p class="small">${esc(d.who)}</p><h4>Sources</h4><p class="small">${esc(d.sources)}</p></div>
<div class="arm"><h4>Planted</h4><p class="small">${esc(d.planted)}</p><h4>Traps</h4><p class="small">${esc(d.traps)}</p></div>
<div class="arm"><h4>Guidelines the key cites</h4><ul class="small">${d.guidelines.map((g) => `<li>${esc(g)}</li>`).join("")}</ul><p class="small muted">${esc(d.from)}</p></div></div>
<h2>Each key item, both arms side by side</h2>${items}
<h2>False questions</h2>${falseOnes || `<p class="muted small">${r.grades.length === 0 ? "Not graded in this run." : "None."}</p>`}
<h2>The answers in full</h2><p class="small muted">Every question each arm asked, as a chain: facts (each checked by the program), what it says is absent (and what backs that), the model's own knowledge, and the question.</p><div class="arms">${answers}</div>
<h2>Statistics</h2>${statsTable(r.jobs.filter((j) => j.case === caseId))}`,
    home,
  );
}

async function writeRun(
  results: Results,
  out: string,
  home: string,
  trend: string,
): Promise<string> {
  const l = await loaded(results);
  await mkdir(join(out, "cases"), { recursive: true });
  await writeFile(join(out, "index.html"), runIndex(l, home, trend));
  for (const id of l.cases.keys())
    await writeFile(
      join(out, "cases", `${id}.html`),
      casePage(l, id, `../${home}`),
    );
  return join(out, "index.html");
}

function trendPoints(all: readonly Results[]) {
  return all.map((r) => {
    const values: Record<string, number> = {};
    for (const arm of ["pod", "records"]) {
      const scores = r.scores.filter(
        (s) => r.jobs.find((j) => j.id === s.subject)?.arm === arm,
      );
      if (scores.length > 0)
        values[`${arm}: share of gaps found`] =
          scores.reduce((sum, s) => sum + s.found + s.partly / 2, 0) /
          Math.max(
            1,
            scores.reduce((sum, s) => sum + s.gaps, 0),
          );
    }
    return { label: r.run.id.slice(0, 13), values };
  });
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
    return writeRun(
      results,
      resolve(out ?? join(folder, "site")),
      "index.html",
      trendSvg(trendPoints([results])),
    );
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
    await writeRun(
      results,
      join(target, "runs", name),
      "../../index.html",
      trend,
    );
  await mkdir(target, { recursive: true });
  const rows = runs
    .slice()
    .reverse()
    .map(({ name, results: r }) => {
      const subjects = subjectsOf(r);
      const byArm = ["pod", "records"]
        .map(
          (arm) =>
            `<td>${scoreLine(r.scores.filter((s) => subjects.find((j) => j.id === s.subject)?.arm === arm))}</td>`,
        )
        .join("");
      return `<tr class="link" data-href="runs/${esc(name)}/index.html"><td><a href="runs/${esc(name)}/index.html">${esc(r.run.id)}</a><br><span class="small muted">${esc(r.run.tier)} · ${r.cases.length} case(s)</span></td>${byArm}<td class="small">${thousands(r.budget.spent.tokens)} tokens<br>${dollars(r.budget.spent.usd)} (${esc(r.budget.spent.basis)})</td></tr>`;
    })
    .join("");
  await writeFile(
    join(target, "index.html"),
    page(
      "Cascade eval runs",
      `<h1>Eval runs</h1><p class="muted">Every recorded run of the eval harness: the pod, through cascade-mcp, against the same records pasted in, on synthetic people. Each run's page has its cases, both arms side by side, every citation checked and every cost.</p>
<h2>Trend</h2>${trend}<h2>Runs</h2>${runs.length === 0 ? `<p class="muted">No run is recorded yet: <code>npm run evals:record &lt;run&gt;</code> records one.</p>` : `<div class="table"><table><tr><th>Run</th><th>pod (cascade-mcp)</th><th>records (pasted)</th><th>Spent</th></tr>${rows}</table></div>`}`,
      "index.html",
    ),
  );
  return join(target, "index.html");
}
