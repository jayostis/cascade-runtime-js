// What the reply contracts (`reply-schema.ts`) ask of a model, in the words a model is given. Templates, so a harness
// can build its own session prompt around one; `replyContract` fills the pod's for an app that has no harness.

/** The words a pronoun is written with: the subject form and the possessive. */
export const PRONOUNS: Record<string, [string, string]> = {
  her: ["she", "Her"],
  his: ["he", "His"],
  their: ["they", "Their"],
};

/**
 * The template of a reply about a pod, whose facts point at entries and copy nothing: the form of a reply and what
 * each part of it is. Its places are `{PRONOUN}`, `{PRONOUN_SUBJECT}`, `{EXAMPLE}`, `{CITE}` and `{ABSENCE}`; the
 * parts (`podReplyParts`) fill the last three.
 */
export const REPLY_CONTRACT = `{EXAMPLE}

- "answer": your reply, as {PRONOUN_SUBJECT} will read it, in plain words.
- "short": one or two sentences {PRONOUN_SUBJECT} could show {PRONOUN} doctor.
- "items": each point of your reply that rests on {PRONOUN} records or your knowledge (at most 10, most important
  first), each with "says" (the point, in plain words), "why" (one or two sentences) and "confidence" (high, medium
  or low), and its chain:
  - "facts": each entry you rely on. A program shows it beside your point as the pod holds it (its name, value, date
    and source), so write none of those: give "says", what it says in your words; "cite", the entry:
{CITE}
    "field", the one field of it your point rests on: "value" (its own result), "status", "code", "name", "id",
    "date" (when it happened), "start", "end", "recorded" or "text" (words of its text, such as a note or a report's
    conclusion); with "text", "quote", the words your point rests on, copied exactly from that entry's text. When the
    entry came from more than one source and your point rests on what one of them says, "source": that source's
    short name, as the read's legend names it ("S3").
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
tool or command names): cite only in "cite" and "query".`;

/**
 * The template of a reply about downloads, which cites a file and copies what it says, field by field (the eval's
 * records arm): the form of a reply and what each part of it is. Its places are `{PRONOUN}`, `{PRONOUN_SUBJECT}`,
 * `{EXAMPLE}`, `{CITE}` and `{ABSENCE}`; an arm's parts fill the last three.
 */
export const RECORDS_REPLY_CONTRACT = `{EXAMPLE}

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
tool or command names): cite only in "cite" and "query".`;

/** The example reply about downloads, given how a cite and an absence's sources are written. */
export const replyExample = (cite: string, query: string) =>
  `{"answer": "…", "short": "…",
  "items": [{"n": 1, "says": "…", "why": "…", "confidence": "high",
  "facts": [{"says": "…", "provider": "…", "cite": ${cite}, "name": "…", "value": "Positive", "date": "2025-11-04", "dateKind": "when"}],
  "absences": [{"what": "…", "match": {"codes": ["…"], "terms": ["…"], "after": "2025-11-05"}, "coverage": "…"${query}}],
  "knowledge": {"says": "…", "guideline": "…"},
  "links": [{"from": 0, "to": 1, "says": "…"}]}]}`;

/** What differs by where the records are: how a fact is cited, the absence's query line and the example. */
export interface ReplyParts {
  readonly cite: string;
  readonly absence: string;
  readonly example: string;
}

/** A reply about a pod: a fact names an entry, and an absence names the tool call that looked. */
export const podReplyParts: ReplyParts = {
  cite: `    {"entry": "<the entry's handle in a compact answer (its id), or the entry IRI a row names>"};`,
  absence: `, and "query": the tool call that looked, {"tool": "<name>", "input": <its JSON input, exactly as you ran it>, "call": <the number the command printed after its answer>}`,
  example: `{"answer": "…", "short": "…",
  "items": [{"n": 1, "says": "…", "why": "…", "confidence": "high",
  "facts": [{"says": "…", "cite": {"entry": "L…"}, "field": "value", "source": "S3"}, {"says": "…", "cite": {"entry": "N…"}, "field": "text", "quote": "…"}],
  "absences": [{"what": "…", "match": {"codes": ["…"], "terms": ["…"], "after": "2025-11-05"}, "coverage": "…", "query": {"tool": "ask", "input": {…}, "call": 3}}],
  "knowledge": {"says": "…", "guideline": "…"},
  "links": [{"from": 0, "to": 1, "says": "…"}]}]}`,
};

/** The template with `{PRONOUN}`-style places filled from `values`; a place with no value is left as written. */
export function filled(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(
    /\{([A-Z_]+)\}/g,
    (all, name: string) => values[name] ?? all,
  );
}

/** The contract as an app gives it to a model that answers about a person's pod, `pronoun` being her, his or their. */
export function replyContract(
  pronoun: string,
  parts: ReplyParts = podReplyParts,
  template: string = REPLY_CONTRACT,
): string {
  const [subject] = PRONOUNS[pronoun] ?? ["they"];
  return `Reply, and nothing else, as JSON in this form:\n\n${filled(template, {
    PRONOUN: pronoun,
    PRONOUN_SUBJECT: subject!,
    EXAMPLE: parts.example,
    CITE: parts.cite,
    ABSENCE: parts.absence,
  })}`;
}
