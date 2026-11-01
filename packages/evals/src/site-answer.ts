// One arm's answer to one question, rendered: the reply as given, its reasoning (the chain the agent wrote and the
// graph of what it cited), the doctor card and the cost. Everything comes from results.json: the agent's own output,
// the program's checks, and the lookups the harness recorded. Nothing is inferred here.
import type { Answer } from "./checks.js";
import { instanceOf } from "./instances.js";
import type { Arm } from "./prompts.js";
import type {
  CitationCheck,
  Evidence,
  Grade,
  Instance,
  Job,
  Results,
} from "./results.js";
import { type GNode, type Graph, graphBlock, kv } from "./site-graph.js";
import {
  compact,
  day,
  dollars,
  esc,
  modelName,
  seconds,
  thousands,
} from "./site-text.js";

type Item = Answer["items"][number];
type Fact = Item["facts"][number];

/** One instance of the run, with the jobs that answered it and the evidence recorded for them. */
export interface Sitting {
  readonly results: Results;
  readonly instance: Instance;
  readonly jobs: Readonly<Record<Arm, readonly Job[]>>;
  readonly evidence: ReadonlyMap<string, Evidence>;
}

const evidenceKey = (
  job: string,
  question: string,
  item: number,
  part: string,
) => `${job}\n${question}\n${item}\n${part}`;

export function sittingOf(results: Results, instance: Instance): Sitting {
  const subjects = results.jobs.filter(
    (it) => it.role === "subject" && instanceOf(it) === instance.id,
  );
  const evidence = new Map<string, Evidence>();
  for (const it of results.evidence)
    evidence.set(
      evidenceKey(
        it.job,
        it.question,
        it.item,
        it.fact !== undefined ? `f${it.fact}` : `a${it.absence}`,
      ),
      it,
    );
  return {
    results,
    instance,
    jobs: {
      pod: subjects.filter((it) => it.arm === "pod"),
      records: subjects.filter((it) => it.arm === "records"),
    },
    evidence,
  };
}

/** An arm's answer to a question: the session that was asked it, and what it wrote. */
export interface Turn {
  readonly sitting: Sitting;
  readonly arm: Arm;
  readonly job: Job;
  readonly question: string;
  readonly answer: Answer | undefined;
}

export function turnOf(
  sitting: Sitting,
  arm: Arm,
  question: string,
): Turn | undefined {
  const job = sitting.jobs[arm].find((it) =>
    (it.questions ?? []).includes(question),
  );
  if (job === undefined) return undefined;
  const given = sitting.results.answers[job.id]?.[question] as
    Partial<Answer> | undefined;
  const answer =
    given !== undefined &&
    typeof given.answer === "string" &&
    Array.isArray(given.items)
      ? (given as Answer)
      : undefined;
  return { sitting, arm, job, question, answer };
}

const checksOf = (t: Turn) => t.sitting.results.checks[t.job.id]?.[t.question];
const gradesOf = (t: Turn): Grade[] =>
  t.sitting.results.grades.filter(
    (it) => it.subject === t.job.id && it.question === t.question,
  );
const evidenceOf = (t: Turn, item: number, part: string) =>
  t.sitting.evidence.get(evidenceKey(t.job.id, t.question, item, part));
const judgeName = (t: Turn, id: string) =>
  modelName(t.sitting.results.jobs.find((it) => it.id === id)?.model ?? id);

export const notAnswered = `<p class="muted">Not answered.</p>`;

/** The answer exactly as given: the reply, its short form and each point with its confidence. */
export function replyHtml(t: Turn): string {
  const a = t.answer;
  if (a === undefined) return notAnswered;
  return `<div class="reply"><p>${esc(a.answer)}</p><p class="small"><b>In short:</b> ${esc(a.short)}</p><ol>${a.items
    .map(
      (it) =>
        `<li><b>${esc(it.says)}</b><span class="conf">${esc(it.confidence)} confidence</span><span class="why">${esc(it.why)}</span></li>`,
    )
    .join("")}</ol></div>`;
}

// ---------------------------------------------------------------- what the agent relied on

const claimOf = (f: Fact) =>
  [
    f.name !== undefined && `name ${f.name}`,
    f.code !== undefined && `code ${f.code}`,
    f.value !== undefined &&
      `value ${f.value}${f.unit === undefined ? "" : ` ${f.unit}`}`,
    f.status !== undefined && `status ${f.status}`,
    f.date !== undefined && `${f.dateKind ?? "when"} ${f.date}`,
    f.quote !== undefined && `words “${f.quote}”`,
  ]
    .filter((it) => it !== false)
    .join(" · ");

const factSub = (f: Fact) =>
  [
    f.date,
    f.value !== undefined &&
      `${f.value}${f.unit === undefined ? "" : ` ${f.unit}`}`,
    f.status,
  ]
    .filter((it) => it !== undefined && it !== false)
    .join(" · ");

const citationOf = (t: Turn, item: number, fact: number) =>
  checksOf(t)?.citations.find((it) => it.item === item && it.fact === fact);
const absenceCheckOf = (t: Turn, item: number, absence: number) =>
  checksOf(t)?.absences.find(
    (it) => it.item === item && it.absence === absence,
  );

const verdictOf = (c: CitationCheck | undefined) =>
  c === undefined
    ? `<span class="muted">not checked</span>`
    : esc(c.ok ? (c.shows ?? "holds") : `not borne out: ${c.reason ?? "?"}`);
const tick = (ok: boolean | undefined) =>
  ok === undefined ? "·" : ok ? "✓" : "✗";
const tone = (ok: boolean | undefined) =>
  ok === undefined ? "" : ok ? "ok" : "bad";

const matchOf = (a: Item["absences"][number]) =>
  [
    ...(a.match.codes ?? []).map((it) => `code ${it}`),
    ...(a.match.terms ?? []),
  ].join(", ");

function chainHtml(t: Turn, item: Item): string {
  const facts = item.facts
    .map((f, i) => {
      const c = citationOf(t, item.n, i);
      return `<li><span class="ck ${tone(c?.ok)}">${tick(c?.ok)}</span> ${esc(f.says)} <span class="muted small">${esc([f.date, f.provider].filter(Boolean).join(" · "))}</span></li>`;
    })
    .join("");
  const absences = item.absences
    .map((a, i) => {
      const c = absenceCheckOf(t, item.n, i);
      return `<li><span class="ck ${tone(c?.backed)}">${tick(c?.backed)}</span> ${esc(a.what)} <span class="muted small">searched: ${esc(matchOf(a))}${a.match.after === undefined ? "" : `, after ${esc(a.match.after)}`} · ${esc(a.coverage)}</span>${c !== undefined && !c.backed ? `<span class="muted small"> · checker: ${esc(c.reason ?? "not backed")}</span>` : ""}</li>`;
    })
    .join("");
  const links = (item.links ?? [])
    .map(
      (l) =>
        `<li>fact ${l.from + 1} bears on fact ${l.to + 1}: ${esc(l.says)}</li>`,
    )
    .join("");
  const judges = gradesOf(t)
    .map((g) => {
      const c = g.chains.find((it) => it.item === item.n);
      return c === undefined
        ? ""
        : `<li><b>${esc(judgeName(t, g.judge))}</b>: ${c.complete ? "complete" : "incomplete"}, ${c.faithful ? "faithful" : "not faithful"}${c.skipped.length === 0 ? "" : ` · ${esc(c.skipped.join("; "))}`}</li>`;
    })
    .join("");
  return `<div class="chain">
<h4>Facts it relied on <span class="muted">· each checked against the record it cites</span></h4><ul>${facts || `<li class="muted">none</li>`}</ul>
<h4>Absences it stated <span class="muted">· what it searched for, and where</span></h4><ul>${absences || `<li class="muted">none stated</li>`}</ul>
${links === "" ? "" : `<h4>Links it stated between its facts</h4><ul>${links}</ul>`}
${item.knowledge === undefined ? "" : `<h4 class="kn">The model's own knowledge <span class="muted">· not from the records</span></h4><p class="small">${esc(item.knowledge.says)} <span class="muted">(${esc(item.knowledge.guideline ?? "no guideline named")})</span></p>`}
${judges === "" ? "" : `<h4>What the judges said of this chain</h4><ul class="small">${judges}</ul>`}</div>`;
}

// ---------------------------------------------------------------- the graphs

const factNode = (t: Turn, item: Item, f: Fact, i: number): GNode => {
  const c = citationOf(t, item.n, i);
  const sub = factSub(f);
  return {
    id: `f${i}`,
    col: 1,
    kind: "fact",
    label: f.says,
    ...(sub === "" ? {} : { sub }),
    ...(c === undefined
      ? {}
      : { check: c.ok ? ("ok" as const) : ("bad" as const) }),
    detail: kv([
      ["says", esc(f.says)],
      ["relies on the record for", esc(claimOf(f))],
      ["the record says", verdictOf(c)],
    ]),
  };
};

const absenceNode = (
  t: Turn,
  item: Item,
  a: Item["absences"][number],
  i: number,
  how: string,
): GNode => {
  const c = absenceCheckOf(t, item.n, i);
  return {
    id: `a${i}`,
    col: 1,
    kind: "absence",
    label: `Not found: ${a.what}`,
    sub: `looked for ${(a.match.terms ?? []).slice(0, 3).join(", ")}`,
    ...(c === undefined
      ? {}
      : { check: c.backed ? ("ok" as const) : ("bad" as const) }),
    detail: kv([
      ["what it says is missing", esc(a.what)],
      ["a record of it would carry", esc(matchOf(a))],
      [
        "only a record on or after",
        a.match.after === undefined ? undefined : esc(a.match.after),
      ],
      ["coverage, in its words", esc(a.coverage)],
      [
        "program check",
        c === undefined
          ? "not checked"
          : c.backed
            ? how
            : `not backed: ${esc(c.reason ?? "?")}`,
      ],
    ]),
  };
};

const rootNode = (item: Item): GNode => ({
  id: "q",
  col: 0,
  kind: "item",
  label: item.says,
  sub: `${item.confidence} confidence`,
  detail: `<p>${esc(item.why)}</p>`,
});

function sharedNodes(
  item: Item,
  nodes: GNode[],
  edges: Graph["edges"][number][],
) {
  if (item.knowledge !== undefined) {
    nodes.push({
      id: "k",
      col: 1,
      kind: "knowledge",
      label: item.knowledge.says,
      sub: item.knowledge.guideline ?? "no guideline named",
      detail: `<p>${esc(item.knowledge.says)}</p><p class="small muted">Guideline the model named: ${esc(item.knowledge.guideline ?? "none")}. This is the model's, not the records'; the report does not check it.</p>`,
    });
    edges.push({ from: "q", to: "k", dashed: true });
  }
  (item.links ?? []).forEach((l, i) => {
    if (item.facts[l.from] === undefined || item.facts[l.to] === undefined)
      return;
    nodes.push({
      id: `l${i}`,
      col: 2,
      kind: "link",
      label: "Agent's link",
      sub: l.says,
      detail: `<p>Fact ${l.from + 1} bears on fact ${l.to + 1}, in the agent's words: ${esc(l.says)}</p>`,
    });
    edges.push(
      { from: `f${l.from}`, to: `l${i}` },
      { from: `f${l.to}`, to: `l${i}` },
    );
  });
}

const shortEntry = (iri: string) =>
  iri.replace(/^.*\/clinical\//, "clinical/").replace(/#(.{8}).*$/, "#$1…");

function podGraph(t: Turn, item: Item): Graph {
  const nodes: GNode[] = [rootNode(item)];
  const edges: Graph["edges"][number][] = [];
  const entries = new Map<string, string>();
  const documents = new Map<string, string>();
  item.facts.forEach((f, i) => {
    nodes.push(factNode(t, item, f, i));
    edges.push({ from: "q", to: `f${i}` });
    if (!("entry" in f.cite)) return;
    const iri = f.cite.entry;
    let id = entries.get(iri);
    if (id === undefined) {
      id = `e${entries.size}`;
      entries.set(iri, id);
      const ev = evidenceOf(t, item.n, `f${i}`);
      const prov = ev?.entry;
      nodes.push({
        id,
        col: 2,
        kind: "entry",
        label: f.name ?? prov?.type ?? "Pod entry",
        sub:
          prov === null
            ? "no such record in the pod"
            : prov === undefined
              ? "no lookup recorded"
              : shortEntry(iri),
        ...(prov === null ? { check: "bad" as const } : {}),
        detail:
          `<p class="tiny mono muted">${esc(iri)}</p>` +
          (prov ? kv(prov.fields.map(([k, v]) => [k, esc(v)] as const)) : ""),
      });
      (prov?.members ?? []).forEach((m, mi) => {
        const rid = `${id}r${mi}`;
        nodes.push({
          id: rid,
          col: 3,
          kind: "record",
          label: m.sourceId ?? m.record,
          sub: `${m.revisions.length} revision${m.revisions.length === 1 ? "" : "s"} at the source`,
          detail: kv([
            ["record", `<span class="mono">${esc(m.record)}</span>`],
            ["its id at the source", esc(m.sourceId)],
            [
              "source URL",
              m.sourceUrl === undefined
                ? undefined
                : `<span class="mono">${esc(m.sourceUrl)}</span>`,
            ],
            [
              "revisions",
              m.revisions
                .map(
                  (r) =>
                    `${esc(day(r.observedAsOf))} (version ${esc(r.version)}${r.selector === undefined ? "" : `, in the download at <span class="mono">${esc(r.selector)}</span>`})`,
                )
                .join("<br>"),
            ],
          ]),
        });
        edges.push({ from: id!, to: rid });
        for (const r of m.revisions) {
          const d = r.document;
          if (d === undefined) continue;
          let did = documents.get(d.iri);
          if (did === undefined) {
            did = `d${documents.size}`;
            documents.set(d.iri, did);
            nodes.push({
              id: did,
              col: 4,
              kind: "document",
              label: d.author ?? "a source document",
              sub: `arrived ${day(d.retrievedOn)}`,
              detail: kv([
                ["author", esc(d.author)],
                ["retrieved (arrival)", esc(d.retrievedOn)],
                ["answered as of", esc(d.answeredAsOf)],
                [
                  "server",
                  d.server === undefined
                    ? undefined
                    : `<span class="mono">${esc(d.server)}</span>`,
                ],
                ["document", `<span class="mono">${esc(d.iri)}</span>`],
              ]),
            });
          }
          if (!edges.some((e) => e.from === rid && e.to === did))
            edges.push({ from: rid, to: did });
        }
      });
    }
    edges.push({ from: `f${i}`, to: id });
  });
  item.absences.forEach((a, i) => {
    nodes.push(
      absenceNode(
        t,
        item,
        a,
        i,
        "backed: the query ran and returned nothing matching",
      ),
    );
    edges.push({ from: "q", to: `a${i}` });
    if (a.query === undefined) return;
    const call = evidenceOf(t, item.n, `a${i}`)?.call;
    const input = a.query.input as { question?: unknown };
    nodes.push({
      id: `aq${i}`,
      col: 2,
      kind: "query",
      label: typeof input.question === "string" ? input.question : a.query.tool,
      sub:
        call === undefined
          ? "query as the agent wrote it"
          : call === null
            ? "no matching call in the run's log"
            : `${call.rows} rows back · ${call.milliseconds} ms`,
      detail: kv([
        ["tool", esc(a.query.tool)],
        [
          "input, as run",
          `<span class="mono">${esc(JSON.stringify(a.query.input))}</span>`,
        ],
        [
          "call",
          a.query.call === undefined ? undefined : `number ${a.query.call}`,
        ],
        [
          "what came back",
          call === undefined || call === null
            ? undefined
            : `${call.rows} rows in ${call.milliseconds} ms at ${esc(call.at.slice(11, 19))} UTC${call.ok ? "" : " (refused)"}`,
        ],
      ]),
    });
    edges.push({ from: `a${i}`, to: `aq${i}` });
  });
  sharedNodes(item, nodes, edges);
  return { nodes, edges };
}

function recordsGraph(t: Turn, item: Item): Graph {
  const nodes: GNode[] = [rootNode(item)];
  const edges: Graph["edges"][number][] = [];
  const seen = new Map<string, string>();
  item.facts.forEach((f, i) => {
    nodes.push(factNode(t, item, f, i));
    edges.push({ from: "q", to: `f${i}` });
    if (!("file" in f.cite)) return;
    const where = "resource" in f.cite ? f.cite.resource : String(f.cite.line);
    const key = `${f.cite.file}#${where}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = `r${seen.size}`;
      seen.set(key, id);
      const p = evidenceOf(t, item.n, `f${i}`)?.passage;
      nodes.push({
        id,
        col: 2,
        kind: "resource",
        label:
          "resource" in f.cite
            ? f.cite.resource
            : `${f.cite.file}:${f.cite.line}`,
        sub: f.cite.file,
        detail: kv([
          ["file", `<span class="mono">${esc(f.cite.file)}</span>`],
          [
            "resource",
            "resource" in f.cite
              ? `<span class="mono">${esc(f.cite.resource)}</span>`
              : undefined,
          ],
          ["line", "line" in f.cite ? String(f.cite.line) : undefined],
        ]),
      });
      if (p) {
        nodes.push({
          id: `p${id}`,
          col: 3,
          kind: "passage",
          label: `${p.file}:${p.from}-${p.to}`,
          sub:
            p.pointer === undefined
              ? `line ${p.line ?? p.from}`
              : `JSON pointer ${p.pointer}`,
          detail: `<p class="small muted">Lines ${p.from}-${p.to} of <span class="mono">${esc(p.file)}</span>${p.truncated === true ? ", cut short here" : ""}, as the file holds them:</p><pre>${esc(p.text)}</pre>${kv([["download", p.download === undefined ? undefined : `${esc(p.download.source)}, retrieved ${esc(day(p.download.retrievedAt))}`]])}`,
        });
        edges.push({ from: id, to: `p${id}` });
      }
    }
    edges.push({ from: `f${i}`, to: id });
  });
  item.absences.forEach((a, i) => {
    nodes.push(
      absenceNode(
        t,
        item,
        a,
        i,
        "backed: every named file was read whole and holds nothing matching",
      ),
    );
    edges.push({ from: "q", to: `a${i}` });
    const ev = evidenceOf(t, item.n, `a${i}`);
    const files =
      ev?.files ??
      a.sources?.map((file) => ({
        file,
        read: undefined as boolean | undefined,
        bytes: undefined as number | undefined,
      }));
    if (files === undefined) return;
    const stated = ev?.stated ?? a.sources !== undefined;
    nodes.push({
      id: `as${i}`,
      col: 2,
      kind: "sources",
      label: `${files.length} file${files.length === 1 ? "" : "s"}${stated ? " named" : ""}`,
      sub: stated
        ? files.map((f) => f.file.split("/")[0]).join(", ")
        : "did not name its sources",
      detail: `<ul class="small">${files.map((f) => `<li><span class="mono">${esc(f.file)}</span>${f.bytes === undefined ? "" : ` · ${thousands(f.bytes)} bytes`}${f.read === undefined ? " · whether it was read whole is not recorded" : f.read ? "" : " · not read whole"}</li>`).join("")}</ul><p class="small muted">${stated ? "The files the agent said it looked through for this absence; the checker wants each read whole." : "The agent did not name its sources, so the files its job was offered stand in for them."}</p>`,
    });
    edges.push({ from: `a${i}`, to: `as${i}` });
  });
  sharedNodes(item, nodes, edges);
  return { nodes, edges };
}

const NOTES: Readonly<Record<Arm, string>> = {
  pod: "Left to right: what the answer raises, then the facts, absences and knowledge the agent itself wrote, then the pod entry it cited, the member records the pod merged into that entry, and the source documents with their authors and arrival dates. Only the first two columns are the agent's; the rest is the pod's own provenance, looked up, not reasoned. Dashed: the model's own knowledge, not from the records.",
  records:
    "Left to right: what the answer raises, then the facts, absences and knowledge the agent itself wrote, then the file and resource it cited, then that passage of the file with its download's date. The graph stops where the agent's citations stop: no link between files exists unless the agent wrote one. Dashed: the model's own knowledge.",
};

/** The Reasoning tab: each point of the answer with its chain and the graph of what it cited. */
export function reasoningHtml(t: Turn): string {
  const a = t.answer;
  if (a === undefined) return notAnswered;
  const items = a.items
    .map(
      (item, at) =>
        `<details class="item" id="${t.arm}-${esc(t.question)}-${item.n}"${at === 0 ? " open" : ""}><summary>${item.n}. ${esc(item.says)}</summary><div class="dbody">${chainHtml(t, item)}<h4>The evidence, as a graph <span class="muted">· built only from what this agent cited, plus lookups</span></h4>${graphBlock(t.arm === "pod" ? podGraph(t, item) : recordsGraph(t, item), `${t.arm}-${t.question}-${item.n}`, NOTES[t.arm])}</div></details>`,
    )
    .join("");
  const across = (a.links ?? [])
    .map(
      (l) =>
        `<li>item ${l.from.item} fact ${l.from.fact + 1} bears on item ${l.to.item} fact ${l.to.fact + 1}: ${esc(l.says)}</li>`,
    )
    .join("");
  return `${items}${across === "" ? "" : `<h4>Links across its points, in the agent's words</h4><ul class="small">${across}</ul>`}`;
}

// ---------------------------------------------------------------- the doctor card

/** Where a fact came from, as far as results.json says: the document that brought it, else the agent's own words. */
function sourceOf(t: Turn, item: number, fact: number, f: Fact): string {
  const ev = evidenceOf(t, item, `f${fact}`);
  if (t.arm === "pod") {
    const documents = (ev?.entry?.members ?? [])
      .flatMap((m) => m.revisions.map((r) => r.document))
      .filter((d) => d !== undefined)
      .sort((x, y) => (x.retrievedOn ?? "").localeCompare(y.retrievedOn ?? ""));
    const d = documents.at(-1);
    if (d !== undefined)
      return `${d.author ?? f.provider}${d.retrievedOn === undefined ? "" : `, download of ${day(d.retrievedOn)}`}`;
  } else {
    const d = ev?.passage?.download;
    if (d !== undefined)
      return `${d.source ?? f.provider}${d.retrievedAt === undefined ? "" : `, download of ${day(d.retrievedAt)}`}`;
  }
  return f.provider;
}

/** What I'd show my doctor: the question, the short answer, each point's dated facts and sources. Never the model's own knowledge. */
export function doctorCardHtml(
  t: Turn,
  asks: string,
  prepared: string,
): string {
  const a = t.answer;
  if (a === undefined) return notAnswered;
  const how = t.arm === "pod" ? "with Cascade" : "from the grab bag";
  return `<article class="card"><header><span><b>You asked</b> <q>${esc(asks)}</q></span><span class="muted small">Prepared ${how} · ${esc(modelName(t.job.model))} · ${esc(prepared)}</span></header>
<p><b>In short:</b> ${esc(a.short)}</p>
<ol>${a.items
    .map((item) => {
      const facts = item.facts
        .map((f, i) => {
          const source = sourceOf(t, item.n, i, f);
          return `<li>${esc(f.says)} <span class="muted">· ${f.date === undefined ? "" : `${esc(f.date)} · `}${esc(source)}</span></li>`;
        })
        .join("");
      const absences = item.absences
        .map(
          (ab) =>
            `<li class="absence">Looked for and not found: ${esc(ab.what)}. <span>${esc(ab.coverage)}</span></li>`,
        )
        .join("");
      return `<li><b>${esc(item.says)}</b>${facts === "" && absences === "" ? "" : `<ul class="facts">${facts}${absences}</ul>`}</li>`;
    })
    .join("")}</ol>
<p class="tiny muted">Everything here is from the downloaded records. The assistant's own knowledge is left off this card on purpose: your doctor brings that.</p></article>`;
}

// ---------------------------------------------------------------- cost

/** An answer's time, tokens and price, and the session's own cost beside it. */
export function costHtml(t: Turn): string {
  const split = t.job.split;
  const part = split?.questions[t.question];
  if (part === undefined)
    return `<div class="cost"><span class="muted">cost not recorded</span></div>`;
  const shared = split!.shared;
  const sessionQuestions = (t.job.questions ?? []).length;
  return `<div class="cost"><span>⏱ <b>${seconds(part.seconds)}</b></span><span><b>${thousands(part.tokens.total)}</b> tokens <span class="tiny">(${compact(part.tokens.cacheRead)} cached reads · ${compact(part.tokens.output)} written)</span></span><span><b>${dollars(part.usd)}</b></span><span>${part.calls} model call${part.calls === 1 ? "" : "s"}</span>${part.recordsTokens === undefined ? "" : `<span><b>${thousands(part.recordsTokens)}</b> tokens of the grab bag's files re-read as cache</span>`}
<span class="shared">Plus the session's own start, shared by its ${sessionQuestions} question${sessionQuestions === 1 ? "" : "s"}: ${seconds(shared.seconds)} · ${thousands(shared.tokens.total)} tokens · ${dollars(shared.usd)}${shared.recordsContext === undefined ? "" : ` · reads the files once (${thousands(shared.recordsContext)} tokens of context)`}</span></div>`;
}
