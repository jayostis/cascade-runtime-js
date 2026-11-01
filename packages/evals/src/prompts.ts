// The prompts a run gives its subjects and judges: a session's prompt, each question's message in the person's own
// words, and a judge's. A prompt's version is the hash of its template, so a changed prompt reruns what it changes
// and nothing else.
import { sha256 } from "./cases.js";
import { tagLine } from "./transcripts.js";

export type Arm = "pod" | "records";

const SESSION = `You are a health assistant in a chat with {NAME} about {PRONOUN} own health records. Today is {TODAY}.

{PRONOUN_POSSESSIVE} questions come one at a time. Get the next one by running this command with the Bash tool, exactly as
written:

  {ASK}

It prints {PRONOUN} next question and the file to write your answer to, or says there are no more. Answer each question
fully before you ask for the next: the command gives no new question until the last answer is written. Answer from {PRONOUN}
records (made available to you as described below) and your own medical knowledge; say so when the records do not
settle something.

Write each answer, and nothing else, as JSON to the file its question names, with the Write tool, in this form:

{EXAMPLE}

- "answer": your reply, as {PRONOUN_SUBJECT} will read it, in plain words.
- "short": one or two sentences {PRONOUN_SUBJECT} could show {PRONOUN} doctor.
- "items": each point of your reply that rests on {PRONOUN} records or your knowledge (at most 10, most important
  first), each with "says" (the point, in plain words), "why" (one or two sentences) and "confidence" (high, medium
  or low), and its chain:
  - "facts": each record you rely on: what it says in words ("says"), its provider, and "cite", where it is:
{CITE}
    Then each thing you rely on that record for, as the record itself writes it, in the field it belongs to, so a
    program can check it against that record: "value" (its own result: 131, Positive; with "unit" if it has one),
    "status" (active, completed, final, refuted), "code" (a LOINC, SNOMED CT, RxNorm, CVX or ICD-10 code it carries),
    "name" (words of the test, condition, drug, vaccine or procedure), "id" (its identifier in its source), "date"
    (YYYY-MM-DD) with "dateKind": "when" it happened, "start", "end" or "recorded", and "quote" (words of its text,
    such as a report's conclusion). Give at least one; a fact with none cannot be checked. Never put a reference
    range, a flag or another record's value in "value".
  - "absences": each thing you say the records lack: "what"; "match", the codes and words a record of it would carry
    ({"codes": [...], "terms": [...]}), with "after": "YYYY-MM-DD" whenever the absence is about a period ("since
    February", "after the stool test", "in the last year"), since only a record from that day on would count against
    it; and "coverage", what you looked through (which sources, which dates){ABSENCE}
  - "knowledge", when you used any: the medical knowledge of your own that links the facts to the point, and the
    guideline you have in mind if you can name one. It is yours, not the records'.
  - "links", when you draw any: that one of your facts bears on another, as {"from": <fact's place, from 0>, "to":
    <fact's place>, "says": "how"}, such as an older copy of a record against a newer one.

When a fact of one item bears on a fact of another item, say so once in the same answer, beside "items", as "links":
[{"from": {"item": <n>, "fact": <place>}, "to": {"item": <n>, "fact": <place>}, "says": "how"}].

Do not mention how you reached the records in "answer", "short", "says", "why" or "knowledge" (no file names, paths,
tool or command names): cite only in "cite" and "query". When the command says there are no more questions, reply
with the word done.`;

const RECORDS = `Your access: {PRONOUN_POSSESSIVE} records are the {COUNT} files listed below, under {FOLDER}. Before you ask for the first
question, read every file in full, in this order, with the Read tool, as if they were pasted into this conversation (a
long file in several reads, until you have read every line). Use no other tool except Write for each answer and Bash
for the command above: no search, no shell. An absence names, in "sources", the files (as listed) it looked through;
leave "sources" out when it looked through every file.
{FILES}`;

const POD = `Your access: {PRONOUN_POSSESSIVE} records are in a pod, which you reach only through this one command, run with the Bash tool:

  {COMMAND} <tool> '<JSON input>'

It calls the pod's MCP server (cascade-mcp) and prints the tool's answer, then the call's number. \`{COMMAND} --list\`
prints the tools and their input schemas. {PRONOUN_POSSESSIVE} pod is named "{POD}". Run it once per Bash call,
exactly as written, with one tool and its input: no loops, variables, pipes or chained commands (several Bash calls in
one turn run together). Use no other command and read no file; use no tool except Bash for these two commands and
Write for each answer.`;

const QUESTION = `{ASKS}

(Write your answer to {ANSWER}.)`;

const EXAMPLE = (cite: string, query: string) =>
  `{"answer": "…", "short": "…",
  "items": [{"n": 1, "says": "…", "why": "…", "confidence": "high",
  "facts": [{"says": "…", "provider": "…", "cite": ${cite}, "name": "…", "value": "Positive", "date": "2025-11-04", "dateKind": "when"}],
  "absences": [{"what": "…", "match": {"codes": ["…"], "terms": ["…"], "after": "2025-11-05"}, "coverage": "…"${query}}],
  "knowledge": {"says": "…", "guideline": "…"},
  "links": [{"from": 0, "to": 1, "says": "…"}]}]}`;

const FILE_CITE = `    {"file": "<path as listed>", "line": <line number>}, or for a FHIR JSON file {"file": "<path>", "resource":
    "<resourceType>/<id>"}`;
const ENTRY_CITE = `    {"entry": "<the entry IRI the row names>"}`;
const POD_ABSENCE = `, and "query": the tool call that looked, {"tool": "<name>", "input": <its JSON input, exactly as you ran it>, "call": <the number the command printed after its answer>}`;

export interface SessionPrompt {
  readonly arm: Arm;
  readonly tag: string;
  readonly name: string;
  readonly pronoun: string;
  readonly today: string;
  /** The job's `ask` command. */
  readonly ask: string;
  /** The records arm's folder and files, in order. */
  readonly folder?: string;
  readonly files?: readonly string[];
  /** The pod arm's command and pod. */
  readonly command?: string;
  readonly pod?: string;
}

/** What differs by arm in a session's prompt: its access, how a fact is cited, the absence line and the example. */
export const ARM_PARTS = {
  pod: {
    access: POD,
    cite: ENTRY_CITE,
    absence: POD_ABSENCE,
    example: EXAMPLE(
      `{"entry": "pod://…#…"}`,
      `, "query": {"tool": "ask", "input": {…}, "call": 3}`,
    ),
  },
  records: {
    access: RECORDS,
    cite: FILE_CITE,
    absence: "",
    example: EXAMPLE(`{"file": "…", "line": 120}`, `, "sources": ["…"]`),
  },
};

export const PRONOUNS: Record<string, [string, string]> = {
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

/** A session's prompt: who, today, the arm's access, how to ask for each question and how to write each answer. */
export function sessionPrompt(p: SessionPrompt): string {
  const [subject, possessive] = PRONOUNS[p.pronoun] ?? ["they", "Their"];
  const parts = ARM_PARTS[p.arm];
  const values = {
    NAME: p.name,
    PRONOUN: p.pronoun,
    PRONOUN_SUBJECT: subject,
    PRONOUN_POSSESSIVE: possessive,
    TODAY: p.today,
    ASK: p.ask,
    EXAMPLE: parts.example,
    CITE: parts.cite,
    ABSENCE: parts.absence,
    COUNT: String(p.files?.length ?? 0),
    FOLDER: p.folder ?? "",
    FILES: (p.files ?? []).map((file, at) => `${at + 1}. ${file}`).join("\n"),
    COMMAND: p.command ?? "",
    POD: p.pod ?? "",
  };
  return [
    tagLine(p.tag),
    filled(SESSION, values),
    filled(parts.access, values),
  ].join("\n\n");
}

/** One question's message, as the `ask` command prints it: the person's words and where the answer goes. */
export const questionMessage = (asks: string, answer: string) =>
  filled(QUESTION, { ASKS: asks, ANSWER: answer });

const JUDGE = `You are a judge in a blind evaluation. Two assistants were each asked {PRONOUN} questions, one at a time, by a person
about {PRONOUN} own health records, as of {TODAY}. Each answer is labelled with a letter only; you are not told which
assistant wrote it or how it reached the records, and must not guess.

Read {PACKET}: the key's two parts, written before any assistant ran, then each question in the person's words, the key
items for that question, and the answers to it. The key is a reference, not the whole truth: an answer may say true
and useful things it does not list.

For each answer, give:
- for every key item of its question: "found", "partly" or "missed" for a fact, absence, negation or gap; "raised"
  when the answer says what a trap or near-trap's "wrong" line says, else "avoided"; with the answer's items it rests
  on (by "n") and a one-line reason;
- every item of the answer that no key item covers, with your verdict: "fair" (true and fair to raise),
  "true-not-planted" (true, and a find the key does not list), "speculative" (not supported by the records), or
  "contradicted" (the records say otherwise), and why;
- for every item of the answer: whether its chain is complete (its facts, any knowledge it needs and its point all
  there, and for a key item, every link that item lists) and faithful (each fact it states is what the records say,
  as far as the key and the answer's own facts let you tell), with the steps it skips.

Read only that file. Write the verdict, and nothing else, as JSON to {VERDICT} with the Write tool, in this form,
one entry of "outputs" per answer:

{"outputs": [{"label": "A",
  "items": [{"id": "<key item id>", "verdict": "found | partly | missed | raised | avoided", "items": [1], "reason": "…"}],
  "beyond": [{"item": 2, "verdict": "fair | true-not-planted | speculative | contradicted", "why": "…"}],
  "chains": [{"item": 1, "complete": true, "faithful": true, "skipped": []}]}]}

Then reply with the word done.`;

export interface JudgePrompt {
  readonly tag: string;
  readonly pronoun: string;
  readonly today: string;
  readonly packet: string;
  readonly verdict: string;
}

export function judgePrompt(p: JudgePrompt): string {
  return [
    tagLine(p.tag),
    filled(JUDGE, {
      PRONOUN: p.pronoun,
      TODAY: p.today,
      PACKET: p.packet,
      VERDICT: p.verdict,
    }),
  ].join("\n\n");
}

/** An arm's prompt version: the hash of everything that reaches its prompt, so editing any of it reruns the arm. */
export const versionOf = (
  arm: Arm,
  parts: (typeof ARM_PARTS)[Arm] = ARM_PARTS[arm],
) =>
  sha256(SESSION + JSON.stringify(parts) + JSON.stringify(PRONOUNS)).slice(
    0,
    16,
  );

/** The version of each template a run's results name. */
export const PROMPT_VERSIONS = {
  pod: versionOf("pod"),
  records: versionOf("records"),
  question: sha256(QUESTION).slice(0, 16),
  judge: sha256(JUDGE).slice(0, 16),
};
