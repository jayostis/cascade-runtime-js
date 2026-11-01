// What the front page reads, per case, model and repeat: each arm's key items counted from its judges, what it said
// beyond the key, its citations, its cost and time, and what judging that sitting cost, charged to neither arm.
import type { KeyItem } from "./cases.js";
import type { Arm } from "./prompts.js";
import type {
  ArmSummary,
  BeyondCounts,
  Grade,
  Instance,
  Job,
  SubjectChecks,
  Verdicts,
} from "./results.js";

const EXPECTED = ["found", "partly", "missed"] as const;
const TRAPS = ["avoided", "raised"] as const;
const isTrap = (kind: string) => kind === "trap" || kind === "near-trap";

/**
 * An arm's key items, counted: for each item of a question it answered, the verdict its judges share, else split; an
 * item a judge graded the question without naming is missed (or avoided, for a trap); a question no judge graded
 * leaves its items ungraded; a question it never answered leaves its items unanswered, still in the total, so skipping
 * a hard question never scores better than answering it badly. Beyond the key, each point by the verdict its judges share, else split.
 */
export function countsOf(
  items: readonly Pick<KeyItem, "id" | "kind" | "question">[],
  grades: readonly Pick<Grade, "subject" | "question" | "items" | "beyond">[],
  questions: readonly string[],
): Pick<ArmSummary, "expected" | "traps" | "beyond"> {
  const expected: Record<string, number> = {
    split: 0,
    ungraded: 0,
    unanswered: 0,
    of: 0,
  };
  const traps: Record<string, number> = {
    split: 0,
    ungraded: 0,
    unanswered: 0,
    of: 0,
  };
  for (const it of EXPECTED) expected[it] = 0;
  for (const it of TRAPS) traps[it] = 0;
  for (const item of items) {
    const trap = isTrap(item.kind);
    const counts = trap ? traps : expected;
    counts.of!++;
    if (!questions.includes(item.question)) {
      counts.unanswered!++;
      continue;
    }
    const graded = grades.filter((it) => it.question === item.question);
    const verdicts = new Set(
      graded.map(
        (grade) =>
          grade.items.find((it) => it.id === item.id)?.verdict ??
          (trap ? "avoided" : "missed"),
      ),
    );
    const [only] = verdicts;
    if (only === undefined) counts.ungraded!++;
    else if (verdicts.size > 1) counts.split!++;
    else counts[only] = (counts[only] ?? 0) + 1;
  }
  const beyond = {
    fair: 0,
    trueNotPlanted: 0,
    speculative: 0,
    contradicted: 0,
    split: 0,
  };
  const points = new Map<string, Set<string>>();
  for (const grade of grades)
    for (const it of grade.beyond) {
      const at = `${grade.subject}\n${grade.question}\n${it.item}`;
      (points.get(at) ?? points.set(at, new Set()).get(at)!).add(it.verdict);
    }
  for (const verdicts of points.values()) {
    const [only] = verdicts;
    if (verdicts.size > 1 || only === undefined) beyond.split++;
    else
      beyond[
        only === "true-not-planted"
          ? "trueNotPlanted"
          : (only as Exclude<keyof BeyondCounts, "trueNotPlanted" | "split">)
      ]++;
  }
  return {
    expected: expected as Verdicts<(typeof EXPECTED)[number]>,
    traps: traps as Verdicts<(typeof TRAPS)[number]>,
    beyond,
  };
}

export const instanceOf = (job: Pick<Job, "case" | "model" | "repeat">) =>
  `${job.case}.${job.model.replace(/^claude-/, "")}.r${job.repeat ?? 1}`;

/** One instance per case, model and repeat that has a subject job, with each arm it ran and its judging. */
export function instancesOf(
  jobs: readonly Job[],
  grades: readonly Grade[],
  checks: Readonly<Record<string, Readonly<Record<string, SubjectChecks>>>>,
  answered: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  keys: ReadonlyMap<string, readonly KeyItem[]>,
): Instance[] {
  const instances = new Map<string, Job[]>();
  for (const job of jobs)
    if (job.role === "subject" && job.case !== undefined) {
      const id = instanceOf(job);
      (instances.get(id) ?? instances.set(id, []).get(id)!).push(job);
    }
  return [...instances].map(([id, subjects]) => {
    const [first] = subjects as [Job];
    const arms: Partial<Record<Arm, ArmSummary>> = {};
    for (const arm of new Set(subjects.map((it) => it.arm!))) {
      const sessions = subjects.filter((it) => it.arm === arm);
      const ids = new Set(sessions.map((it) => it.id));
      const questions = sessions.flatMap((it) =>
        Object.keys(answered[it.id] ?? {}),
      );
      const citations = sessions.flatMap((it) =>
        Object.values(checks[it.id] ?? {}).flatMap((one) => one.citations),
      );
      const sum = (pick: (job: Job) => number | null | undefined) =>
        sessions.reduce((total, it) => total + (pick(it) ?? 0), 0);
      arms[arm] = {
        sessions: [...ids],
        questions: questions.length,
        ...countsOf(
          keys.get(first.case!) ?? [],
          grades.filter((it) => ids.has(it.subject)),
          questions,
        ),
        citations: {
          held: citations.filter((it) => it.ok).length,
          failed: citations.filter((it) => !it.ok).length,
        },
        tokens: sum((it) => it.stats?.tokens.total),
        usd: sessions.some((it) => it.stats?.cost.usd === null)
          ? null
          : sum((it) => it.stats?.cost.usd),
        seconds: sum((it) => it.stats?.wallSeconds),
      };
    }
    const judges = jobs.filter(
      (it) => it.role === "judge" && it.instance === id,
    );
    return {
      id,
      case: first.case!,
      model: first.model,
      repeat: first.repeat ?? 1,
      arms,
      judging: {
        judges: judges.map((it) => it.id),
        tokens: judges.reduce(
          (sum, it) => sum + (it.stats?.tokens.total ?? 0),
          0,
        ),
        usd: judges.some((it) => it.stats?.cost.usd === null)
          ? null
          : judges.reduce((sum, it) => sum + (it.stats?.cost.usd ?? 0), 0),
      },
    };
  });
}
