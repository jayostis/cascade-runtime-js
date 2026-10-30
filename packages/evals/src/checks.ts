// The program checks: what is decided without a model. A key's evidence holds against its downloads; an answer is
// valid, each citation holds, each absence is backed, trap wording is flagged, and each job kept to its tools.
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pod } from "cascade-runtime";
import {
  type Absence,
  checkAbsence,
  checkCitation,
  checkRecordsAbsence,
  type Claim,
  downloadsSource,
  podRowsSource,
  type Ran,
} from "./citations.js";
import { type Key, loadKey, prepare, type Prepared } from "./cases.js";
import type { Job, SubjectChecks, ToolCallRecord, ToolUse } from "./results.js";
import { errorsOf } from "./schemas.js";

export type Fact = Omit<Claim, "cite"> & {
  readonly cite: Claim["cite"];
  readonly says: string;
  readonly provider: string;
};

export interface Answer {
  readonly questions: readonly {
    readonly n: number;
    readonly question: string;
    readonly why: string;
    readonly confidence: string;
    readonly facts: readonly Fact[];
    readonly absences: readonly Absence[];
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

/** Tools the agent runner itself calls (to load a tool, to hand back, to return structured output): no one's reading. */
const HARNESS_TOOLS = new Set([
  "ToolSearch",
  "SubagentHandback",
  "StructuredOutput",
]);

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
const samePath = (a: string, b: string) =>
  resolve(a).replaceAll("\\", "/").toLowerCase() ===
  resolve(b).replaceAll("\\", "/").toLowerCase();

/** A shell command's words, or undefined when it holds anything but plain words and quoted strings. */
export function words(command: string): string[] | undefined {
  const found: string[] = [];
  let word = "";
  let started = false;
  for (let at = 0; at < command.length; at++) {
    const char = command[at]!;
    if (char === "'") {
      const end = command.indexOf("'", at + 1);
      if (end === -1) return undefined;
      word += command.slice(at + 1, end);
      started = true;
      at = end;
    } else if (char === '"') {
      let end = at + 1;
      let text = "";
      while (end < command.length && command[end] !== '"') {
        if (command[end] === "\\" && /["\\$`]/.test(command[end + 1] ?? "")) {
          text += command[end + 1];
          end += 2;
          continue;
        }
        if (/[$`]/.test(command[end]!)) return undefined;
        text += command[end];
        end++;
      }
      if (end >= command.length) return undefined;
      word += text;
      started = true;
      at = end;
    } else if (char === " " || char === "\t") {
      if (started) found.push(word);
      word = "";
      started = false;
    } else if (/[;&|<>()$`\n\r\\*?{}]/.test(char)) return undefined;
    else {
      word += char;
      started = true;
    }
  }
  if (started) found.push(word);
  return found;
}

/** Whether a command is the pod arm's one command, for this job and run, and nothing else. */
export function isPodCommand(
  command: string,
  job: string,
  run: string,
): boolean {
  const said = words(command);
  if (said === undefined || said.length < 8) return false;
  const [node, cli, pod, runFlag, folder, jobFlag, id, ...rest] = said;
  return (
    /^node(\.exe)?$/.test(node!) &&
    samePath(cli!, CLI) &&
    pod === "pod" &&
    runFlag === "--run" &&
    samePath(folder!, run) &&
    jobFlag === "--job" &&
    id === job &&
    (rest.length === 1 || rest.length === 2) &&
    (rest[0] !== "--list" || rest.length === 1)
  );
}

const pathOf = (use: ToolUse) =>
  typeof use.input.file_path === "string" ? use.input.file_path : "";

/** The case's files a records-arm job read whole: every line within a Read's range. */
async function readWhole(
  uses: readonly ToolUse[],
  prepared: Prepared,
  reading: readonly string[],
): Promise<string[]> {
  const whole: string[] = [];
  for (const file of reading) {
    const path = join(prepared.downloads, file);
    const lines = (await readFile(path, "utf8")).split("\n").length;
    const covered = new Set<number>();
    for (const use of uses) {
      if (use.name !== "Read" || !samePath(pathOf(use), path)) continue;
      const offset =
        typeof use.input.offset === "number" ? use.input.offset : 1;
      const limit =
        typeof use.input.limit === "number" ? use.input.limit : 2000;
      for (let line = offset; line < offset + limit && line <= lines; line++)
        covered.add(line);
    }
    if (covered.size >= lines) whole.push(file);
  }
  return whole;
}

/** Each tool a subject used that its arm does not allow: the pod arm only its one command, the records arm reading. */
function subjectViolations(
  job: Job,
  uses: readonly ToolUse[],
  folder: string,
  prepared: Prepared,
  reading: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const use of uses) {
    if (HARNESS_TOOLS.has(use.name)) continue;
    if (
      use.name === "Write" &&
      samePath(pathOf(use), join(folder, job.answer ?? ""))
    )
      continue;
    if (
      use.name === "Read" &&
      samePath(pathOf(use), join(folder, job.prompt ?? ""))
    )
      continue;
    if (
      job.arm === "pod" &&
      use.name === "Bash" &&
      isPodCommand(String(use.input.command ?? ""), job.id, folder)
    )
      continue;
    if (
      job.arm === "records" &&
      use.name === "Read" &&
      reading.includes(
        relative(prepared.downloads, resolve(pathOf(use))).replaceAll(
          "\\",
          "/",
        ),
      )
    )
      continue;
    violations.push(`${use.name} ${JSON.stringify(use.input).slice(0, 200)}`);
  }
  return violations;
}

/** Each tool a judge used beyond reading its packet and writing its verdict. */
export function judgeViolations(job: Job, uses: readonly ToolUse[]): string[] {
  return uses
    .filter(
      (use) =>
        !HARNESS_TOOLS.has(use.name) &&
        !(
          use.name === "Read" &&
          job.packet !== undefined &&
          samePath(pathOf(use), job.packet)
        ) &&
        !(
          use.name === "Write" &&
          job.workdir !== undefined &&
          samePath(pathOf(use), join(job.workdir, "verdict.json"))
        ),
    )
    .map((use) => `${use.name} ${JSON.stringify(use.input).slice(0, 200)}`);
}

/** The claim a fact makes, without its words: what the checker compares with the record. */
const claimOf = ({ says: _says, provider: _provider, ...claim }: Fact): Claim =>
  claim;

/** The program checks of one subject's answer, from its tool uses and the run's tool calls; nothing is copied. */
export async function checkAnswer(options: {
  job: Job;
  answer: unknown;
  folder: string;
  prepared: Prepared;
  reading: readonly string[];
  key: Key;
  toolCalls: readonly ToolCallRecord[];
  pod: Pod | undefined;
}): Promise<SubjectChecks> {
  const { job, prepared, key, folder } = options;
  const uses = job.toolUses ?? [];
  const violations = subjectViolations(
    job,
    uses,
    folder,
    prepared,
    options.reading,
  );
  const read =
    job.arm === "records"
      ? await readWhole(uses, prepared, options.reading)
      : [];
  const discipline = { ok: violations.length === 0, violations };
  const answerErrors = errorsOf("answer", options.answer);
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
  const ran: Ran[] = options.toolCalls
    .filter((it) => it.job === job.id)
    .map(({ tool, input, ok, answer: text = "" }) => ({
      tool,
      input,
      ok,
      answer: text,
    }));
  const text = (file: string) =>
    readFile(join(prepared.downloads, file), "utf8");
  for (const question of answer.questions) {
    for (const [at, fact] of question.facts.entries()) {
      const source = "entry" in fact.cite ? entries : files;
      const verdict =
        source === undefined
          ? {
              ok: false as const,
              reason: "no such record" as const,
              missing: [],
            }
          : await checkCitation(claimOf(fact), source);
      citations.push({
        question: question.n,
        fact: at,
        cite: fact.cite,
        ...verdict,
      });
    }
    for (const [at, absence] of question.absences.entries()) {
      const backing =
        job.arm === "pod"
          ? checkAbsence(absence, ran)
          : await checkRecordsAbsence(absence, read, text);
      absences.push({ question: question.n, absence: at, ...backing });
    }
  }
  const trapWording: SubjectChecks["trapWording"][number][] = [];
  for (const item of key.items)
    for (const { pattern, means } of item.wording ?? []) {
      const expression = new RegExp(pattern, "i");
      for (const question of answer.questions) {
        const said = [
          question.question,
          question.why,
          question.knowledge.says,
          ...question.facts.map((it) => it.says),
        ].join(" ");
        const match = expression.exec(said);
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
