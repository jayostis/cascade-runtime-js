// The prompts a run gives its subjects and judges. A prompt's version is the hash of its template, so a changed
// prompt reruns what it changes and nothing else.
import { sha256 } from "./cases.js";
import { tagLine } from "./transcripts.js";

export type Arm = "pod" | "records";

const TASK = `You are a health assistant helping {NAME} prepare for {PRONOUN} next primary-care visit. Today is {TODAY}.

Using only {PRONOUN} health records (made available to you as described below), find the questions worth asking {PRONOUN}
doctor about possible gaps in {PRONOUN} care: tests, follow-ups, screenings, vaccines, or medication issues that may be
overdue, missed, unresolved or inconsistent between {PRONOUN} providers. Use your own medical knowledge to decide what
matters. Do not raise something {PRONOUN} records show is already done or not due.

Write your answer, and nothing else, as JSON to {ANSWER} with the Write tool: at most 10 questions, most important
first, in this form:

{EXAMPLE}

Each question is a chain:
- "facts": each record you rely on, with its provider, its date (YYYY-MM-DD) when it has one, the values you rely on
  exactly as the record writes them (a number, a code, a status), what it says in words, and "cite", where it is:
{CITE}
- "absences": each thing you say the records lack, with "coverage": what you looked through (which sources, which
  dates){ABSENCE}
- "knowledge": the medical knowledge of your own that links the facts to the question, and the guideline you have in
  mind if you can name one. It is yours, not the records'.
- "question", in plain words, as {PRONOUN_SUBJECT} would ask it; "why", one or two sentences; "confidence": high, medium or
  low.

Do not mention how you reached the records in "question", "why", "says" or "knowledge" (no file names, paths, tool or
command names): cite only in "cite" and "query". When the answer is written, reply with the word done.`;

const RECORDS = `Your access: {PRONOUN_POSSESSIVE} records are the {COUNT} files listed below, under {FOLDER}. Read every file in full, in
this order, with the Read tool, as if they were pasted into this conversation (a long file in several reads, until you
have read every line). Use no other tool except Write for the answer: no search, no shell.
{FILES}`;

const POD = `Your access: {PRONOUN_POSSESSIVE} records are in a pod, which you reach only through this one command, run with the Bash tool:

  {COMMAND} <tool> '<JSON input>'

It calls the pod's MCP server (cascade-mcp) and prints the tool's answer. \`{COMMAND} --list\` prints the tools and
their input schemas. {PRONOUN_POSSESSIVE} pod is named "{POD}". Use no other command and read no file; use no tool except Bash for
this command and Write for the answer.`;

const EXAMPLE = (cite: string, query: string) =>
  `{"questions": [{"n": 1, "question": "…", "why": "…", "confidence": "high",
  "facts": [{"says": "…", "provider": "…", "date": "2025-11-04", "values": ["Positive"], "cite": ${cite}}],
  "absences": [{"what": "…", "coverage": "…"${query}}],
  "knowledge": {"says": "…", "guideline": "…"}}]}`;

const FILE_CITE = `  {"file": "<path as listed>", "line": <line number>}, or for a FHIR JSON file {"file": "<path>", "resource":
  "<resourceType>/<id>"}`;
const ENTRY_CITE = `  {"entry": "<the entry IRI the row names>"}`;
const POD_ABSENCE = `, and "query": the tool call that looked, {"tool": "<name>", "input": <its JSON input, exactly as you ran it>}`;

export interface SubjectPrompt {
  readonly arm: Arm;
  readonly tag: string;
  readonly name: string;
  readonly pronoun: string;
  readonly today: string;
  readonly answer: string;
  /** The records arm's folder and files, in order. */
  readonly folder?: string;
  readonly files?: readonly string[];
  /** The pod arm's command and pod. */
  readonly command?: string;
  readonly pod?: string;
}

const PRONOUNS: Record<string, [string, string]> = {
  her: ["she", "Her"],
  his: ["he", "His"],
  their: ["they", "Their"],
};

function filled(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{([A-Z_]+)\}/g,
    (all, name: string) => values[name] ?? all,
  );
}

export function subjectPrompt(p: SubjectPrompt): string {
  const [subject, possessive] = PRONOUNS[p.pronoun] ?? ["they", "Their"];
  const values = {
    NAME: p.name,
    PRONOUN: p.pronoun,
    PRONOUN_SUBJECT: subject,
    PRONOUN_POSSESSIVE: possessive,
    TODAY: p.today,
    ANSWER: p.answer,
    EXAMPLE:
      p.arm === "pod"
        ? EXAMPLE(
            `{"entry": "pod://…#…"}`,
            `, "query": {"tool": "ask", "input": {…}}`,
          )
        : EXAMPLE(`{"file": "…", "line": 120}`, ""),
    CITE: p.arm === "pod" ? ENTRY_CITE : FILE_CITE,
    ABSENCE: p.arm === "pod" ? POD_ABSENCE : "",
    COUNT: String(p.files?.length ?? 0),
    FOLDER: p.folder ?? "",
    FILES: (p.files ?? []).map((file, at) => `${at + 1}. ${file}`).join("\n"),
    COMMAND: p.command ?? "",
    POD: p.pod ?? "",
  };
  return [
    tagLine(p.tag),
    filled(TASK, values),
    filled(p.arm === "pod" ? POD : RECORDS, values),
  ].join("\n\n");
}

const JUDGE = `You are a judge in a blind evaluation. Several assistants were each asked to list the questions a person should
ask {PRONOUN} doctor about gaps in {PRONOUN} care, from {PRONOUN} health records, as of {TODAY}. Their answers are labelled with
letters only; you are not told how each assistant reached the records, and must not guess.

Score every answer against the key, which was written before any assistant ran. Read the key's two parts and the
answers in {PACKET}: the scoring rules, every item (gap, trap, near-trap) with what counts as found, partly found or
wrong, the pre-existing items that are neither credit nor penalty, and the generic questions.

For each answer, give:
- for every key item: "found", "partly" or "missed" for a gap; for a trap or near-trap, "raised" when the answer raises
  it the way its "wrong" line says, else "avoided"; with the question numbers it rests on and a one-line reason;
- every false question: one the records contradict or a raised trap, with the item it is, if any, and why it is false;
- every legitimate extra find the key marks so;
- for every question: whether its chain is complete (the facts, the knowledge and the question all there, and for a
  key item, every link the item lists) and faithful (each fact it states is what the records say, as far as the key
  and the answer's own facts let you tell), with the steps it skips.

Write the verdict, and nothing else, as JSON to {VERDICT} with the Write tool, in the form the JSON schema {SCHEMA}
gives. Then reply with the word done.`;

export interface JudgePrompt {
  readonly tag: string;
  readonly pronoun: string;
  readonly today: string;
  readonly packet: string;
  readonly verdict: string;
  readonly schema: string;
}

export function judgePrompt(p: JudgePrompt): string {
  return [
    tagLine(p.tag),
    filled(JUDGE, {
      PRONOUN: p.pronoun,
      TODAY: p.today,
      PACKET: p.packet,
      VERDICT: p.verdict,
      SCHEMA: p.schema,
    }),
  ].join("\n\n");
}

/** The version of each template a run's results name. */
export const PROMPT_VERSIONS = {
  pod: sha256(TASK + POD + ENTRY_CITE + POD_ABSENCE + EXAMPLE("", "")).slice(
    0,
    16,
  ),
  records: sha256(TASK + RECORDS + FILE_CITE + EXAMPLE("", "")).slice(0, 16),
  judge: sha256(JUDGE).slice(0, 16),
};
