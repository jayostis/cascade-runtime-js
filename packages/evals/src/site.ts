// The report site, generated from results.json and the case files and never edited by hand: an index of the run (or
// of every recorded run) with one row per instance, and a page per case with each question, both replies and the key.
// Both arms get the same treatment on every page.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Answer } from "./checks.js";
import { HISTORY } from "./paths.js";
import type { ArmSummary, Instance, Results } from "./results.js";
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
.stack{display:grid;gap:12px}.arms{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
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
svg text{fill:var(--fg);font-size:15px}svg .muted{fill:var(--muted)}
.strip{display:flex;gap:2px;margin:6px 0;width:100%}.doc{height:22px;min-width:3px;border-radius:3px;background:var(--missed-bg);border:1px solid var(--line);position:relative}
.nodes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:6px 0}
.node{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--card)}.node ul{margin:4px 0 0;padding-left:18px}
.node.cited{border:2px solid var(--fg)}.node.returned{border-style:dashed}.node.never{opacity:.55}
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

const ARMS = ["pod", "records"] as const;
const armName = (arm: string) =>
  arm === "pod" ? "Cascade pod (cascade-mcp)" : "Grab bag (records pasted)";
const model = (id: string) => id.replace(/^claude-/, "");

function chip(verdict: string, text = verdict) {
  return `<span class="chip ${esc(verdict)}">${esc(text)}</span>`;
}

/** An arm's counts, as counts: the key's expected items, its traps, what it said beyond the key, its citations, its cost. */
function armCell(arm: ArmSummary | undefined): string {
  if (arm === undefined) return `<td class="muted small">did not run</td>`;
  const { expected: e, traps: t, beyond: b } = arm;
  return `<td>${chip("found", `${e.found} of ${e.of} found`)}${e.partly ? chip("partly", `${e.partly} partly`) : ""}${e.split ? chip("ungraded", `${e.split} split`) : ""}${e.ungraded ? chip("ungraded", `${e.ungraded} ungraded`) : ""}
<br>${chip(t.raised ? "raised" : "avoided", `${t.avoided} of ${t.of} traps avoided`)}
<br><span class="small muted">beyond the key: ${b.fair} fair, ${b.trueNotPlanted} true not planted, ${b.speculative} speculative, ${b.contradicted} contradicted${b.split ? `, ${b.split} split` : ""} · citations ${arm.citations.held} held, ${arm.citations.failed} failed</span>
<br><span class="small muted">${arm.questions} question(s) · ${thousands(arm.tokens)} tokens · ${dollars(arm.usd)} · ${seconds(arm.seconds)}</span></td>`;
}

function instanceRows(r: Results, prefix: string): string {
  return r.instances
    .map(
      (it: Instance) =>
        `<tr class="link" data-href="${prefix}cases/${esc(it.case)}.html"><td><a href="${prefix}cases/${esc(it.case)}.html">${esc(it.case)}</a><br><span class="small muted">${esc(model(it.model))} r${it.repeat}</span></td>${ARMS.map((arm) => armCell(it.arms[arm])).join("")}<td class="small">${dollars(it.judging.usd)}<br><span class="muted">${it.judging.judges.length} judge(s), charged to neither arm</span></td></tr>`,
    )
    .join("");
}

const instanceTable = (r: Results, prefix = "") =>
  r.instances.length === 0
    ? `<p class="muted">No session answered.</p>`
    : `<div class="table"><table><tr><th>Instance</th>${ARMS.map((arm) => `<th>${armName(arm)}</th>`).join("")}<th>Judging</th></tr>${instanceRows(r, prefix)}</table></div>`;

function runIndex(r: Results, home: string): string {
  const build = r.cases
    .map(
      (it) =>
        `<li>${esc(it.id)}: ${it.build === null || it.build === undefined ? "not timed" : `${it.build.seconds} s, ${it.build.modelCalls} model calls`}</li>`,
    )
    .join("");
  return page(
    `Eval run ${r.run.id}`,
    `<h1>Eval run ${esc(r.run.id)}</h1><p class="muted">${esc(r.run.tier)} · ${r.cases.length} case(s) · spent ${thousands(r.budget.spent.tokens)} tokens, ${dollars(r.budget.spent.usd)} (${esc(r.budget.spent.basis)})</p>
<h2>Instances</h2>${instanceTable(r)}
<h2>The pods' build</h2><p class="small muted">Once per person, outside every answer's cost.</p><ul class="small">${build}</ul>`,
    home,
  );
}

function replyOf(answer: unknown): string {
  const it = answer as Partial<Answer> | undefined;
  if (it === undefined) return `<p class="muted">Not answered.</p>`;
  if (typeof it.answer !== "string" || !Array.isArray(it.items))
    return `<p class="bad">Not a valid answer.</p>`;
  return `<p>${esc(it.answer)}</p><ol class="small">${it.items
    .map(
      (item) =>
        `<li>${esc(item.says)} <span class="muted">(${esc(item.confidence)} confidence; ${item.facts.length} fact(s), ${item.absences.length} absence(s)${item.knowledge === undefined ? "" : ", the model's own knowledge"})</span></li>`,
    )
    .join("")}</ol>`;
}

function casePage(r: Results, caseId: string, home: string): string {
  const found = r.cases.find((it) => it.id === caseId)!;
  const jobs = r.jobs.filter(
    (it) => it.role === "subject" && it.case === caseId,
  );
  const judgeName = (id: string) =>
    `judge ${model(r.jobs.find((it) => it.id === id)?.model ?? id)}`;
  const sections = found.sessions
    .flatMap((session) => session.questions)
    .map((question) => {
      const answering = jobs.filter((it) =>
        (it.questions ?? []).includes(question.id),
      );
      const columns = ARMS.map((arm) => {
        const own = answering.filter((it) => it.arm === arm);
        return `<div class="arm"><h4>${armName(arm)}</h4>${own
          .map((job) => {
            const grades = r.grades
              .filter(
                (it) => it.subject === job.id && it.question === question.id,
              )
              .map(
                (it) =>
                  `<div class="small">${esc(judgeName(it.judge))}: ${it.items.map((one) => chip(one.verdict, `${one.id} ${one.verdict}`)).join("")}${it.beyond.map((one) => chip("ungraded", `item ${one.item} ${one.verdict}`)).join("")}</div>`,
              )
              .join("");
            const cost = job.split?.questions[question.id];
            return `<p class="small muted">${esc(model(job.model))} r${job.repeat ?? 1} · ${cost === undefined ? "" : `${thousands(cost.tokens.total)} tokens · ${dollars(cost.usd)} · ${seconds(cost.seconds)}`}</p>${replyOf(r.answers[job.id]?.[question.id])}${grades}`;
          })
          .join("")}</div>`;
      }).join("");
      const key = found.key
        .filter((it) => it.question === question.id)
        .map(
          (it) =>
            `<li><b>${esc(it.id)}</b> (${esc(it.kind)}): ${esc(it.lookingFor)}</li>`,
        )
        .join("");
      return `<h2>${esc(question.asks)}</h2><div class="arms">${columns}</div><details><summary>The key, a reference</summary><ul class="small">${key}</ul></details>`;
    })
    .join("");
  return page(
    caseId,
    `<h1>${esc(caseId)}</h1><p class="muted">Her questions, both arms' replies, and the key. <a href="${esc(found.keyUrl)}">The key's rationale</a>.</p>${sections}`,
    home,
  );
}

async function writeRun(
  results: Results,
  out: string,
  home: string,
): Promise<string> {
  await mkdir(join(out, "cases"), { recursive: true });
  await writeFile(join(out, "index.html"), runIndex(results, home));
  for (const { id } of results.cases)
    await writeFile(
      join(out, "cases", `${id}.html`),
      casePage(results, id, `../${home}`),
    );
  return join(out, "index.html");
}

/** Builds the site of one run's folder, or of every run in history/. Returns the index. */
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
  for (const { name, results } of runs)
    await writeRun(results, join(target, "runs", name), "../../index.html");
  await mkdir(target, { recursive: true });
  const listed = runs
    .slice()
    .reverse()
    .map(
      ({ name, results: r }) =>
        `<h2><a href="runs/${esc(name)}/index.html">${esc(r.run.id)}</a></h2>${instanceTable(r, `runs/${esc(name)}/`)}`,
    )
    .join("");
  await writeFile(
    join(target, "index.html"),
    page(
      "Cascade eval runs",
      `<h1>Eval runs</h1><p class="muted">Every recorded run of the eval harness: a person's own questions answered through her Cascade pod and from the grab bag of her downloads, on synthetic people.</p>${runs.length === 0 ? `<p class="muted">No run is recorded yet: <code>npm run evals:record &lt;run&gt;</code> records one.</p>` : listed}`,
      "index.html",
    ),
  );
  return join(target, "index.html");
}
