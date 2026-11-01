// A subject job is one chat session: its questions handed out one at a time by the job's `ask` command, each only
// once the last is answered with a valid answer, and its calls split at each hand-out into the session's own part and each question's.
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Case, type Session, sha256 } from "./cases.js";
import { PROMPT_VERSIONS, type Arm } from "./prompts.js";
import type { CallRecord, Job, Part, Split, TokenCounts } from "./results.js";
import { runFolder } from "./results.js";
import { errorsOf } from "./schemas.js";

/**
 * What a session's answers depend on: the case without its sessions, this session's own questions, the downloads, the
 * arm, model and effort, the arm's template and the question template, the repeat, and for the pod arm its commits.
 * A reworded question reruns only the sessions that ask it.
 */
export function sessionInputsHash(o: {
  found: Case;
  session: Session;
  downloads: string;
  arm: Arm;
  model: string;
  effort: string | undefined;
  repeat: number;
  pod: unknown;
}): string {
  const person = { ...o.found, sessions: undefined };
  return sha256(
    JSON.stringify({
      role: "subject",
      case: sha256(JSON.stringify(person)),
      session: o.session,
      downloads: o.downloads,
      arm: o.arm,
      model: o.model,
      effort: o.effort ?? null,
      prompt: [PROMPT_VERSIONS[o.arm], PROMPT_VERSIONS.question],
      repeat: o.repeat,
      ...(o.arm === "pod" ? { pod: o.pod } : {}),
    }),
  );
}

export interface Asked {
  readonly job: string;
  readonly question: string;
  readonly at: string;
  readonly message: string;
}

export const answerPath = (job: Job, question: string) =>
  `${job.answers}/${question}.json`;

export async function askedIn(folder: string): Promise<Asked[]> {
  const path = join(folder, "asked.jsonl");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Asked);
}

/** What is wrong with an answer file as an answer, in the schema's words; empty when it holds to the schema. */
async function answerErrors(path: string): Promise<string[]> {
  try {
    return errorsOf("answer", JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    return [
      `the file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

/**
 * The job's `ask` command: the next question's message, in her words, as written at planning; a reminder to write
 * the last answer first; or that there are no more questions. Each question handed out is logged once.
 */
export async function ask(given: string, id: string): Promise<string> {
  const folder = runFolder(given);
  const plan = JSON.parse(
    await readFile(join(folder, "plan.json"), "utf8"),
  ) as {
    jobs: Job[];
  };
  const job = plan.jobs.find((it) => it.id === id && it.role === "subject");
  if (job?.questions === undefined)
    throw new Error(`${id} is no session of this run`);
  const handed = new Set(
    (await askedIn(folder))
      .filter((it) => it.job === id)
      .map((it) => it.question),
  );
  for (const question of job.questions) {
    const answer = answerPath(job, question);
    if (existsSync(join(folder, answer))) {
      const errors = await answerErrors(join(folder, answer));
      if (errors.length === 0) continue;
      return `Your answer to the last question, ${join(folder, answer)}, is not a valid answer:\n  ${errors.join("\n  ")}\nRewrite the file so it is JSON that holds to the answer schema, then run this command again.`;
    }
    if (handed.has(question))
      return `Write your answer to the last question to ${join(folder, answer)} first, then run this command again.`;
    const message = await readFile(
      join(folder, "prompts", id, `${question}.txt`),
      "utf8",
    );
    const asked: Asked = {
      job: id,
      question,
      at: new Date().toISOString(),
      message,
    };
    await appendFile(join(folder, "asked.jsonl"), `${JSON.stringify(asked)}\n`);
    return message;
  }
  return "There are no more questions. Reply with the word done.";
}

const contextOf = (call: CallRecord) =>
  call.input + call.cacheCreation + call.cacheRead;

function partOf(
  calls: readonly CallRecord[],
  from: string,
  to: string,
): Omit<Part, "recordsContext" | "recordsTokens"> {
  const sum = (pick: (call: CallRecord) => number) =>
    calls.reduce((total, call) => total + pick(call), 0);
  const tokens: TokenCounts = {
    input: sum((it) => it.input),
    cacheCreation: sum((it) => it.cacheCreation),
    cacheRead: sum((it) => it.cacheRead),
    output: sum((it) => it.output),
    total: sum((it) => contextOf(it) + it.output),
  };
  return {
    calls: calls.length,
    tokens,
    usd: calls.every((it) => it.usd !== null) ? sum((it) => it.usd ?? 0) : null,
    seconds: Math.max(
      0,
      Math.round((Date.parse(to) - Date.parse(from)) / 1000),
    ),
  };
}

/**
 * A session's calls, split at each hand-out: those before the first are the session's own (its prompt; for the grab
 * bag, reading every file), those after hand-out k and before the next are question k's. For the grab bag, the
 * context its files added is the first call after the first hand-out less the session's first call, and a question's
 * records tokens are that context times its calls: the files re-read as cache.
 */
export function splitSession(
  calls: readonly CallRecord[],
  asked: readonly { readonly question: string; readonly at: string }[],
  ended: string,
  arm: Arm,
): Split {
  const order = [...asked].sort((a, b) => a.at.localeCompare(b.at));
  const before = (at: string) => calls.filter((it) => it.at <= at);
  const first = order[0]?.at ?? ended;
  const shared = before(first);
  const afterFirst = calls.find((it) => it.at > first);
  const recordsContext =
    arm === "records" && calls[0] !== undefined && afterFirst !== undefined
      ? Math.max(0, contextOf(afterFirst) - contextOf(calls[0]))
      : undefined;
  const questions: Record<string, Part> = {};
  order.forEach(({ question, at }, place) => {
    const next = order[place + 1]?.at ?? ended;
    const own = calls.filter(
      (it) => it.at > at && (place + 1 === order.length || it.at <= next),
    );
    questions[question] = {
      ...partOf(own, at, next),
      ...(recordsContext === undefined
        ? {}
        : { recordsTokens: recordsContext * own.length }),
    };
  });
  return {
    shared: {
      ...partOf(shared, calls[0]?.at ?? first, first),
      ...(recordsContext === undefined ? {} : { recordsContext }),
    },
    questions,
  };
}
