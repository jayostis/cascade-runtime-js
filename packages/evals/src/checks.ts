// The program checks: what is decided without a model. A key's evidence holds against its downloads; an answer is
// valid, each citation holds, each absence is backed, trap wording is flagged, and the job kept to its arm's tools.
import { dirname, join, relative, resolve } from "node:path";
import type { Pod } from "cascade-runtime";
import {
  type Call,
  checkAbsence,
  checkCitation,
  type Cite,
  downloadsSource,
  podRowsSource,
  type Source,
} from "./citations.js";
import { type Key, loadKey, prepare, type Prepared } from "./cases.js";
import type { Job, SubjectChecks, ToolCallRecord } from "./results.js";
import { errorsOf } from "./schemas.js";
import type { Transcript } from "./transcripts.js";

export interface Answer {
  readonly questions: readonly {
    readonly n: number;
    readonly question: string;
    readonly why: string;
    readonly confidence: string;
    readonly facts: readonly {
      readonly says: string;
      readonly provider: string;
      readonly date?: string;
      readonly values?: readonly string[];
      readonly cite: Cite;
    }[];
    readonly absences: readonly {
      readonly what: string;
      readonly coverage: string;
      readonly query?: Call;
    }[];
    readonly knowledge: { readonly says: string; readonly guideline?: string };
  }[];
}

/** Every claim of the case's key, checked against its downloads: a key whose evidence does not hold is no key. */
export async function checkKey(id: string, log: (line: string) => void) {
  const prepared = await prepare(id, log);
  const { key } = await loadKey(id);
  const source = downloadsSource(prepared.downloads);
  const failed: { item: string; claim: number; verdict: unknown }[] = [];
  let claims = 0;
  for (const item of key.items)
    for (const [at, claim] of item.evidence.entries()) {
      claims++;
      const verdict = await checkCitation(claim, source);
      if (!verdict.ok) failed.push({ item: item.id, claim: at, verdict });
    }
  return { case: id, claims, failed };
}

/** The rows `entry/What it shows` gives of one entry: each field, its value and the record it is from. */
export function entryRows(pod: Pod) {
  let all: Promise<readonly Readonly<Record<string, string>>[]> | undefined;
  return async (entry: string) => {
    all ??= pod.ask("entry/What it shows");
    const rows = (await all).filter((row) => row.entry === entry);
    return rows.length === 0 ? undefined : rows;
  };
}

const EXCERPT = 600;

/** Tools the agent runner itself calls (to load a tool, to hand back, to return structured output): no arm's reading. */
const HARNESS_TOOLS = new Set([
  "ToolSearch",
  "SubagentHandback",
  "StructuredOutput",
]);

async function excerptOf(
  source: Source,
  cite: Cite,
): Promise<string | undefined> {
  const pointed = await source.at(cite);
  if (pointed === undefined) return undefined;
  if ("line" in cite && pointed.lines !== undefined)
    return pointed.lines
      .slice(Math.max(0, cite.line - 3), cite.line + 2)
      .join("\n")
      .slice(0, EXCERPT);
  return pointed.text.slice(0, EXCERPT);
}

function disciplineOf(
  job: Job,
  transcript: Transcript | undefined,
  prepared: Prepared,
  answerPath: string,
  reading: readonly string[],
) {
  const violations: string[] = [];
  const read = new Set<string>();
  for (const tool of transcript?.tools ?? []) {
    const path =
      typeof tool.input.file_path === "string"
        ? resolve(tool.input.file_path)
        : "";
    if (tool.name === "Write" && path === resolve(answerPath)) continue;
    const prompt = join(dirname(dirname(answerPath)), job.prompt ?? "");
    if (tool.name === "Read" && path === resolve(prompt)) continue;
    if (HARNESS_TOOLS.has(tool.name)) continue;
    if (job.arm === "pod") {
      const command = String(tool.input.command ?? "");
      if (
        tool.name === "Bash" &&
        command.includes(" pod --run ") &&
        command.includes(`--job ${job.id}`)
      )
        continue;
    } else if (tool.name === "Read") {
      const file = relative(prepared.downloads, path).replaceAll("\\", "/");
      if (reading.includes(file)) {
        read.add(file);
        continue;
      }
    }
    violations.push(`${tool.name} ${JSON.stringify(tool.input).slice(0, 200)}`);
  }
  return {
    discipline: { ok: violations.length === 0, violations },
    read: reading.filter((file) => read.has(file)),
  };
}

/** The program checks of one subject's answer. */
export async function checkAnswer(options: {
  job: Job;
  answer: unknown;
  answerPath: string;
  prepared: Prepared;
  reading: readonly string[];
  key: Key;
  transcript: Transcript | undefined;
  toolCalls: readonly ToolCallRecord[];
  pod: Pod | undefined;
}): Promise<SubjectChecks> {
  const { job, prepared, key, transcript } = options;
  const answerErrors = errorsOf("answer", options.answer);
  const { discipline, read } = disciplineOf(
    job,
    transcript,
    prepared,
    options.answerPath,
    options.reading,
  );
  if (answerErrors.length > 0)
    return {
      answerValid: false,
      answerErrors,
      citations: [],
      absences: [],
      trapWording: [],
      discipline,
      ...(job.arm === "records" ? { read } : {}),
    };
  const answer = options.answer as Answer;
  const files = downloadsSource(prepared.downloads);
  const entries =
    options.pod === undefined
      ? undefined
      : podRowsSource(entryRows(options.pod));
  const citations: SubjectChecks["citations"][number][] = [];
  const absences: SubjectChecks["absences"][number][] = [];
  // A refused call counts as run: lab_series refuses a test the pod holds none of, which states the absence.
  const ran: Call[] = options.toolCalls
    .filter((it) => it.job === job.id)
    .map(({ tool, input }) => ({ tool, input }));
  const everyFileRead = read.length === options.reading.length;
  for (const question of answer.questions) {
    for (const [at, fact] of question.facts.entries()) {
      const source = "entry" in fact.cite ? entries : files;
      if (source === undefined) {
        citations.push({
          question: question.n,
          fact: at,
          cite: fact.cite,
          ok: false,
          reason: "no such record",
        });
        continue;
      }
      const verdict = await checkCitation(
        {
          cite: fact.cite,
          ...(fact.date === undefined ? {} : { date: fact.date }),
          ...(fact.values === undefined ? {} : { values: fact.values }),
        },
        source,
      );
      const excerpt = await excerptOf(source, fact.cite);
      citations.push({
        question: question.n,
        fact: at,
        cite: fact.cite,
        ...verdict,
        ...(excerpt === undefined ? {} : { excerpt }),
      });
    }
    for (const [at, absence] of question.absences.entries()) {
      const backing =
        job.arm === "pod"
          ? checkAbsence(absence, ran)
          : absence.coverage.trim() === ""
            ? { backed: false as const, reason: "no coverage" }
            : everyFileRead
              ? { backed: true as const }
              : { backed: false as const, reason: "not every file read" };
      absences.push({ question: question.n, absence: at, ...backing });
    }
  }
  const trapWording: SubjectChecks["trapWording"][number][] = [];
  for (const item of key.items)
    for (const { pattern, means } of item.wording ?? []) {
      const expression = new RegExp(pattern, "i");
      for (const question of answer.questions) {
        const text = [
          question.question,
          question.why,
          question.knowledge.says,
          ...question.facts.map((it) => it.says),
        ].join(" ");
        const match = expression.exec(text);
        if (match !== null)
          trapWording.push({
            item: item.id,
            question: question.n,
            pattern,
            means,
            text: match[0],
          });
      }
    }
  return {
    answerValid: true,
    answerErrors: [],
    citations,
    absences,
    trapWording,
    discipline,
    ...(job.arm === "records" ? { read } : {}),
  };
}

export const answerFile = (folder: string, job: Job) =>
  join(folder, job.answer ?? "");
