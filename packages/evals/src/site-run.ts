// One run instance of one model, as pages: the run page (the person's questions, both answers, the key as a reference, the
// run's own folds) and, for each arm, a print view of every doctor card.
import type { Arm } from "./prompts.js";
import type {
  BeyondVerdict,
  Grade,
  Instance,
  ItemVerdict,
  Job,
  Results,
} from "./results.js";
import {
  costHtml,
  doctorCardHtml,
  notAnswered,
  reasoningHtml,
  replyHtml,
  type Sitting,
  sittingOf,
  type Turn,
  turnOf,
} from "./site-answer.js";
import { hrefTo, page } from "./site-page.js";
import {
  ARM_HOW,
  ARM_NAME,
  ARMS,
  badge,
  dollars,
  day,
  esc,
  mark,
  modelName,
  personIn,
  personPath,
  seconds,
  subjectOf,
  thousands,
  type Tone,
} from "./site-text.js";

type KeyItem = Results["cases"][number]["key"][number];

/** Where an instance's pages are, from the site's root. */
export interface Where {
  readonly run: string;
  readonly print: Readonly<Record<Arm, string>>;
}

export const whereIs = (base: string, id: string): Where => ({
  run: `${base}${id}.html`,
  print: {
    pod: `${base}${id}.print-pod.html`,
    records: `${base}${id}.print-records.html`,
  },
});

const isTrap = (kind: string) => kind === "trap" || kind === "near-trap";

const LEGEND = `<div class="legend"><span>Against the answer key:</span>${mark("yes", "said what we expected")}${mark("part", "part of it")}${mark("no", "missed it")}${mark("beyond", "beyond the key: not wrong, possibly good")}</div>`;

const VERDICT: Readonly<Record<ItemVerdict, readonly [Tone, string]>> = {
  found: ["yes", "said what we expected"],
  partly: ["part", "part of it"],
  missed: ["no", "missed it"],
  avoided: ["yes", "did not say it"],
  raised: ["no", "said what the key warns against"],
};
const BEYOND: Readonly<Record<BeyondVerdict, readonly [Tone, string]>> = {
  fair: ["beyond", "fair find: possibly good"],
  "true-not-planted": ["beyond", "true, not planted: possibly good"],
  speculative: ["part", "speculative: not confirmed"],
  contradicted: ["no", "contradicted by the records"],
};
const POD_SEES: Readonly<Record<KeyItem["pod"], string>> = {
  visible: "the pod shows this directly",
  deeper: "the pod holds this, but not in an obvious view",
  "narrative-only": "only in report text, which the pod does not carry",
};

const judgeName = (r: Results, id: string) =>
  modelName(r.jobs.find((it) => it.id === id)?.model ?? id);
const gradesOf = (r: Results, t: Turn | undefined): Grade[] =>
  t === undefined
    ? []
    : r.grades.filter(
        (it) => it.subject === t.job.id && it.question === t.question,
      );

/** One arm's verdict on one key item: the judges' when they agree, else each judge's. */
function cellOf(s: Sitting, t: Turn | undefined, k: KeyItem): string {
  if (t?.answer === undefined)
    return mark("none", "did not answer this question");
  const grades = gradesOf(s.results, t);
  if (grades.length === 0) return mark("none", "not graded");
  const given = grades.map((g) => ({
    judge: judgeName(s.results, g.judge),
    verdict: (g.items.find((it) => it.id === k.id)?.verdict ??
      (isTrap(k.kind) ? "avoided" : "missed")) as ItemVerdict,
    reason: g.items.find((it) => it.id === k.id)?.reason ?? "",
  }));
  const reason = given.find((it) => it.reason !== "")?.reason;
  const said = (text: string | undefined) =>
    text === undefined || text === ""
      ? ""
      : `<span class="said"><q>${esc(text)}</q></span>`;
  if (new Set(given.map((it) => it.verdict)).size === 1) {
    const [tone, label] = VERDICT[given[0]!.verdict];
    return `${mark(tone, label)}${said(reason)}`;
  }
  return `${mark("part", "the judges split")}<span class="said">${given.map((it) => `${esc(it.judge)}: ${esc(it.verdict)}`).join(" · ")}</span>${said(reason)}`;
}

/** What a judge could have told the arms apart by in the answers to one question, when the run recorded any. */
function tellsHtml(s: Sitting, q: string): string {
  const mine = new Set(ARMS.flatMap((arm) => s.jobs[arm].map((j) => j.id)));
  const found = (s.results.blinding?.tells ?? []).filter(
    (it) => it.question === q && mine.has(it.job),
  );
  const parts = ARMS.flatMap((arm) => {
    const terms = [
      ...new Set(found.filter((it) => it.arm === arm).map((it) => it.term)),
    ];
    return terms.length === 0
      ? []
      : [`${terms.map(esc).join(", ")} (${ARM_NAME[arm]})`];
  });
  return parts.length === 0
    ? ""
    : `<p class="tiny muted tells">Judges may have been able to tell the arms apart: ${parts.join(" · ")}</p>`;
}

function keyHtml(
  s: Sitting,
  found: Results["cases"][number],
  q: string,
): string {
  const items = found.key.filter((it) => it.question === q);
  const turns = ARMS.map((arm) => turnOf(s, arm, q));
  const rows = (group: string, sub: string, list: readonly KeyItem[]) =>
    list.length === 0
      ? ""
      : `<tr class="group"><th colspan="3">${group}<span>${sub}</span></th></tr>${list
          .map(
            (k) =>
              `<tr data-item="${esc(k.id)}"><td class="item">${esc(k.title)}<span class="why">${esc(k.lookingFor)}</span><span class="why">In the pod: ${POD_SEES[k.pod]}.</span></td>${ARMS.map((arm, at) => `<td data-arm="${ARM_NAME[arm]}">${cellOf(s, turns[at], k)}</td>`).join("")}</tr>`,
          )
          .join("")}`;
  const beyond = ARMS.flatMap((arm, at) => {
    const t = turns[at];
    if (t?.answer === undefined) return [];
    const grades = gradesOf(s.results, t);
    return t.answer.items
      .map((item) => ({
        arm,
        item,
        views: grades.flatMap((g) =>
          g.beyond
            .filter((b) => b.item === item.n)
            .map((b) => ({ judge: judgeName(s.results, g.judge), ...b })),
        ),
      }))
      .filter((it) => it.views.length > 0);
  });
  const beyondTable =
    beyond.length === 0
      ? ""
      : `<table><thead><tr><th>Raised beyond the key</th><th>By</th><th>The judges' view</th></tr></thead><tbody>${beyond
          .map(
            ({ arm, item, views }) =>
              `<tr class="beyond"><td class="item">${esc(item.says)}</td><td>${badge(arm)}</td><td>${views
                .map((v) => {
                  const [tone, label] = BEYOND[v.verdict];
                  return `${esc(v.judge)}: ${mark(tone, label)}${v.why === "" ? "" : `<span class="said"><q>${esc(v.why)}</q></span>`}`;
                })
                .join("<br>")}</td></tr>`,
          )
          .join("")}</tbody></table>`;
  return `<details class="fold key"><summary>The answer key, as a quiet reference <span class="sum">· written before any model ran · ${items.length} item${items.length === 1 ? "" : "s"}${beyond.length === 0 ? "" : ` · ${beyond.length} raised beyond it`}</span></summary><div class="body"><section class="expect">
<p class="small muted" style="margin:0 0 8px">The key is a reference, not a verdict: it says what a careful reader would say and would not, and what an answer raised beyond it is shown as possibly good, never as wrong (<a href="${esc(found.keyUrl)}">the key's rationale</a>).</p>${tellsHtml(s, q)}
<table><thead><tr><th>Expected</th>${ARMS.map((arm) => `<th>${ARM_NAME[arm]}</th>`).join("")}</tr></thead><tbody>${rows(
    "Should say",
    "what the records support",
    items.filter((it) => !isTrap(it.kind)),
  )}${rows(
    "Should not say",
    "looks true in one download; the full record shows it is not",
    items.filter((it) => isTrap(it.kind)),
  )}</tbody></table>${beyondTable}${LEGEND}</section></div></details>`;
}

function promptHtml(s: Sitting, q: string): string {
  const parts = ARMS.map((arm) => {
    const t = turnOf(s, arm, q);
    if (t === undefined) return "";
    const asked = s.results.asked.find(
      (it) => it.job === t.job.id && it.question === q,
    );
    return `<div><h4 class="${arm}">${ARM_NAME[arm]}</h4>${asked === undefined ? `<p class="muted small">Not handed out.</p>` : `<pre>${esc(asked.message)}</pre><p class="small muted">Handed out at ${esc(asked.at.slice(11, 19))} UTC.</p>`}${t.job.promptText === undefined ? `<p class="small muted">The session's opening prompt is not recorded.</p>` : `<details class="opening"><summary class="small">The session's opening prompt</summary><pre>${esc(t.job.promptText)}</pre></details>`}</div>`;
  }).join("");
  return `<details class="fold prompt"><summary>The exact prompt <span class="sum">· what each agent was handed for this question</span></summary><div class="body"><div class="two">${parts}</div></div></details>`;
}

const TABS = [
  ["answer", "Answer"],
  ["doctor", "Show my doctor"],
] as const;

function armHtml(
  s: Sitting,
  arm: Arm,
  q: string,
  asks: string,
  today: string,
): string {
  const t = turnOf(s, arm, q);
  const head = `<div class="head"><b>${ARM_NAME[arm]}</b><span class="how">${ARM_HOW[arm]}</span></div>`;
  if (t === undefined)
    return `<div class="arm ${arm}" data-arm="${arm}">${head}<div class="chat" style="padding:12px 16px">${notAnswered}</div></div>`;
  const group = `t-${arm}-${esc(q)}`;
  const panels = {
    answer: replyHtml(t),
    doctor: doctorCardHtml(t, asks, day(today)),
  };
  return `<div class="arm ${arm}" data-arm="${arm}">${head}<div class="tabset">${TABS.map(
    ([name, label], at) =>
      `<input type="radio" name="${group}" id="${group}-${name}" value="${name}"${at === 0 ? " checked" : ""}><label for="${group}-${name}" data-tab-label="${name}">${label}</label>`,
  ).join(
    "",
  )}${TABS.map(([name]) => `<div class="panel" data-tab="${name}">${panels[name]}</div>`).join("")}</div>${costHtml(t)}</div>`;
}

/** Each arm's reasoning and evidence for a question, full width under both arms: the graph is wider than half a page. */
function drillHtml(s: Sitting, q: string): string {
  return `<div class="drills">${ARMS.map((arm) => {
    const t = turnOf(s, arm, q);
    return t?.answer === undefined
      ? ""
      : `<details class="fold drill" data-arm="${arm}"><summary><b class="${arm}">${ARM_NAME[arm]}</b>: the reasoning and the evidence behind each point</summary><div class="body">${reasoningHtml(t)}</div></details>`;
  }).join("")}</div>`;
}

/** The letters one judge saw the answers under, each with the arm and question it stood for. */
function lettersOf(r: Results, judge: Job): string {
  const letters = Object.entries(judge.labels ?? {});
  if (letters.length === 0) return "";
  const arm = (job: string) => r.jobs.find((it) => it.id === job)?.arm;
  return `<p class="small muted">${esc(modelName(judge.model))} saw the answers under these letters: ${letters.map(([letter, l]) => `${esc(letter)} = ${arm(l.job) === undefined ? "unknown arm" : esc(ARM_NAME[arm(l.job)!])}, ${esc(l.question)}`).join("; ")}.</p>`;
}

function foldsHtml(s: Sitting, from: string): string {
  const r = s.results;
  const subjects = ARMS.flatMap((arm) => s.jobs[arm]);
  const judges = r.jobs.filter(
    (it) => it.role === "judge" && it.instance === s.instance.id,
  );
  const agreement = r.agreement.filter((it) => it.instance === s.instance.id);
  const judgesFold = `<details class="fold" id="judges"><summary>What the judges said <span class="sum">· ${judges.map((it) => esc(modelName(it.model))).join(" and ") || "none"} · the test's overhead, ${dollars(s.instance.judging.usd)}</span></summary><div class="body"><p class="small">Models scored each answer against the key without knowing which arm produced it. Their verdicts are the evidence for the marks in each key, not the marks; their cost is the harness's, charged to neither arm.</p>
<table class="plain"><tr><th>Judge</th><th class="n">Tokens</th><th class="n">Cost</th><th class="n">Time</th></tr>${judges.map((it) => `<tr><td>${esc(modelName(it.model))}</td><td class="n">${thousands(it.stats?.tokens.total)}</td><td class="n">${dollars(it.stats?.cost.usd)}</td><td class="n">${seconds(it.stats?.wallSeconds)}</td></tr>`).join("")}</table>
${agreement.map((a) => `<p class="small">Agreement: ${a.agreed} of ${a.items} verdicts shared${a.kappa === null ? "" : `, kappa ${a.kappa}`}.</p>`).join("")}
${judges.map((j) => lettersOf(r, j)).join("")}</div></details>`;
  const calls = r.toolCalls.filter((it) =>
    s.jobs.pod.some((j) => j.id === it.job),
  );
  const read = new Map<string, number>();
  for (const job of s.jobs.records)
    for (const q of Object.values(r.checks[job.id] ?? {}))
      for (const file of q.read ?? [])
        read.set(file, (read.get(file) ?? 0) + 1);
  const found = r.cases.find((it) => it.id === s.instance.case);
  const lookedFold = `<details class="fold" id="looked"><summary>What each agent looked at <span class="sum">· ${calls.length} pod question${calls.length === 1 ? "" : "s"} · ${read.size} file${read.size === 1 ? "" : "s"}</span></summary><div class="body"><div class="two">
<div><h4 class="pod">With Cascade: every pod question it asked, in order</h4><table class="plain"><tr><th>Tool</th><th>Question</th><th class="n">Rows</th><th class="n">ms</th></tr>${calls.map((c) => `<tr><td>${esc(c.tool)}</td><td>${esc(typeof c.input.question === "string" ? c.input.question : JSON.stringify(c.input))}</td><td class="n">${c.rows}</td><td class="n">${c.milliseconds}</td></tr>`).join("")}</table></div>
<div><h4 class="records">Grab bag: every file it read, whole</h4><table class="plain"><tr><th>File</th><th class="n">Bytes</th><th class="n">Sessions</th></tr>${[...read].map(([file, n]) => `<tr><td>${esc(file)}</td><td class="n">${thousands(found?.documents.find((d) => d.file === file)?.bytes)}</td><td class="n">${n}</td></tr>`).join("")}</table></div></div></div></details>`;
  const checkRow = (arm: Arm) =>
    s.jobs[arm]
      .flatMap((job) =>
        Object.entries(r.checks[job.id] ?? {}).map(([q, c]) => ({ q, c })),
      )
      .flatMap(({ q, c }) => [
        ...c.citations.map(
          (x) =>
            `<tr><td>${esc(q)} ${x.item}.${x.fact + 1}</td><td>${esc(x.ok ? x.shows : `not borne out: ${x.reason}`)}</td><td class="${x.ok ? "ok" : "bad"}">${x.ok ? "✓" : "✗"}</td></tr>`,
        ),
        ...c.absences.map(
          (x) =>
            `<tr><td>${esc(q)} ${x.item} (absence)</td><td>${esc(x.backed ? "backed" : `not backed: ${x.reason}`)}</td><td class="${x.backed ? "ok" : "bad"}">${x.backed ? "✓" : "✗"}</td></tr>`,
        ),
      ])
      .join("");
  const sums = ARMS.map((arm) => {
    const a = s.instance.arms[arm];
    return a === undefined
      ? ""
      : `${ARM_NAME[arm]} ${a.citations.held}/${a.citations.held + a.citations.failed} cited facts borne out`;
  })
    .filter(Boolean)
    .join(" · ");
  const checksFold = `<details class="fold" id="checks"><summary>Every fact, checked by a program <span class="sum">· ${sums}</span></summary><div class="body"><p class="small">Each fact names the record it came from; a program opened that record and compared the fields the agent relied on. An absence is backed when the query that looked ran and returned nothing matching (pod), or every named file was read whole and holds nothing matching (grab bag).</p><div class="two">${ARMS.map((arm) => `<div><h4 class="${arm}">${ARM_NAME[arm]}</h4><table class="plain"><tr><th>Where</th><th>The record says</th><th></th></tr>${checkRow(arm)}</table></div>`).join("")}</div></div></details>`;
  const costRows = subjects
    .flatMap((job) => [
      ["the session's start", job, job.split?.shared] as const,
      ...Object.entries(job.split?.questions ?? {}).map(
        ([q, p]) => [q, job, p] as const,
      ),
    ])
    .map(
      ([what, job, p]) =>
        `<tr><td>${esc(ARM_NAME[job.arm!])}</td><td>${esc(job.session ?? "")}</td><td>${esc(what)}</td><td class="n">${seconds(p?.seconds)}</td><td class="n">${thousands(p?.tokens.total)}</td><td class="n">${dollars(p?.usd)}</td></tr>`,
    )
    .join("");
  const costFold = `<details class="fold" id="cost"><summary>Cost by session and question <span class="sum">· answering only; judging is above, the pod's build on <a href="${hrefTo(from, "how_it_works.html#build")}">how the test works</a></span></summary><div class="body"><table class="plain"><tr><th>Arm</th><th>Session</th><th>Part</th><th class="n">Time</th><th class="n">Tokens</th><th class="n">Cost</th></tr>${costRows}</table></div></details>`;
  const v = r.versions;
  const versionsFold = `<details class="fold" id="versions"><summary>What was tested <span class="sum">· commits, prompts, prices</span></summary><div class="body"><table class="plain"><tr><th>harness</th><td class="mono">${esc(v.harness.commit.slice(0, 12))}</td></tr>${v.components.map((c) => `<tr><th>${esc(c.name)}</th><td class="mono">${esc(c.commit.slice(0, 12))}</td></tr>`).join("")}<tr><th>prompts</th><td class="mono">${Object.entries(
    v.prompts,
  )
    .map(([k, x]) => `${esc(k)} ${esc(x)}`)
    .join(
      " · ",
    )}</td></tr><tr><th>prices</th><td>list prices of ${esc(v.priceTable)}</td></tr></table></div></details>`;
  return judgesFold + lookedFold + checksFold + costFold + versionsFold;
}

/** The questions of the case that this instance's jobs were asked, in the case's order. */
function questionsOf(s: Sitting, found: Results["cases"][number]) {
  const asked = new Set(
    ARMS.flatMap((arm) => s.jobs[arm].flatMap((j) => j.questions ?? [])),
  );
  return found.sessions
    .flatMap((it) => it.questions)
    .filter((it) => asked.has(it.id));
}

export function runPages(
  r: Results,
  instance: Instance,
  where: Where,
  crumbs: readonly (readonly [string, string?])[],
): Map<string, string> {
  const s = sittingOf(r, instance);
  const found = r.cases.find((it) => it.id === instance.case)!;
  const { name: person, pronoun } = personIn(r, instance.case);
  const questions = questionsOf(s, found);
  const title = `${modelName(instance.model)}, run ${instance.repeat}`;
  const head = `<div class="runhead">${ARMS.map((arm) => {
    const a = instance.arms[arm];
    return `<div class="rh ${arm}">${badge(arm)}<b>${a === undefined ? "–" : dollars(a.usd)}</b><span class="small muted">${a === undefined ? "did not run" : `${a.questions} answer${a.questions === 1 ? "" : "s"} · ${seconds(a.seconds)} · ${thousands(a.tokens)} tokens`}</span></div>`;
  }).join(
    "",
  )}<aside class="overhead"><span class="badge b-test">The test's overhead</span><b>${dollars(instance.judging.usd)}</b><span class="small muted">judging by ${instance.judging.judges.map((id) => esc(judgeName(r, id))).join(" and ") || "no judge"} · charged to neither arm · <a href="#judges">their verdicts</a></span></aside></div>`;
  const sections = questions
    .map(
      (q, at) =>
        `<section class="question" id="q_${esc(q.id)}"><h2 class="qh">Question ${at + 1}</h2>
<div class="ask"><div class="av">${esc(person.slice(0, 1))}</div><div class="bubble"><span class="from">${esc(person)} asks</span>${esc(q.asks)}</div></div>
<div class="arms">${ARMS.map((arm) => armHtml(s, arm, q.id, q.asks, found.today)).join("")}</div>
${drillHtml(s, q.id)}${promptHtml(s, q.id)}${keyHtml(s, found, q.id)}</section>`,
    )
    .join("\n");
  const body = `<p class="small muted"><a href="${hrefTo(where.run, "index.html")}">All runs</a> · run ${esc(r.run.id)} · ${esc(day(r.run.finished))} · <a href="${hrefTo(where.run, personPath(instance.case))}">${esc(person)}</a>, a synthetic person · <a href="${hrefTo(where.run, "how_it_works.html")}">how the test works</a></p>
<h1>${esc(title)}: With Cascade and the grab bag, side by side</h1>
<p class="lead">One model (${esc(instance.model)}), one sitting, ${esc(person)}'s records both ways. For each question: ${pronoun} words, both answers exactly as given, and under each answer two tabs, the answer and the card ${subjectOf({ name: person, pronoun })} would show ${pronoun} doctor, and under both answers the reasoning and the evidence graph behind each. The exact prompt each agent was handed is one click away under each question.</p>
${head}
<p class="printlinks noprint">Show my doctor, on paper: <a href="${hrefTo(where.run, where.print.pod)}">every card, With Cascade</a> · <a href="${hrefTo(where.run, where.print.records)}">every card, Grab bag</a></p>
${sections}
<h2>One level down, for the whole run</h2>
${foldsHtml(s, where.run)}`;
  const out = new Map<string, string>();
  out.set(
    where.run,
    page({
      path: where.run,
      title: `${title} — ${person} — Cascade evals`,
      crumbs: [...crumbs, [title]],
      body,
    }),
  );
  for (const arm of ARMS) {
    const cards = questions
      .map((q) => {
        const t = turnOf(s, arm, q.id);
        return t?.answer === undefined
          ? `<article class="card"><header><span><b>You asked</b> <q>${esc(q.asks)}</q></span></header>${notAnswered}</article>`
          : doctorCardHtml(t, q.asks, day(found.today));
      })
      .join("\n");
    const other = ARMS.find((it) => it !== arm)!;
    const path = where.print[arm];
    out.set(
      path,
      page({
        path,
        title: `What I'd show my doctor — ${ARM_NAME[arm]} — ${title}`,
        crumbs: [...crumbs, [title, where.run], ["Show my doctor"]],
        print: true,
        body: `<p class="noprint small"><a href="${hrefTo(path, where.run)}">Back to the run</a> · showing the ${ARM_NAME[arm]}'s cards · <a href="${hrefTo(path, where.print[other])}">show the ${ARM_NAME[other]}'s instead</a> · <a href="#" onclick="window.print();return false">Print this page</a></p>
<h1>What I'd show my doctor</h1><p class="muted">${esc(person)} · prepared ${arm === "pod" ? "with Cascade" : "from the grab bag"} · ${esc(instance.model)} · ${esc(day(found.today))}</p>
${cards}`,
      }),
    );
  }
  return out;
}
