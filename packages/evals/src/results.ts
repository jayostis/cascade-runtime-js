// What a run records, as results.json holds it (schemas/results.schema.json). A runner on the Claude API fills the
// same fields from each response's usage; a run driven from Claude Code fills them from each agent's transcript.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Cite } from "./citations.js";
import type { Case, Component, KeyItem, Prepared, Session } from "./cases.js";
import type { Asked } from "./sessions.js";
import { RUNS } from "./paths.js";
import type { Arm } from "./prompts.js";

export interface TokenCounts {
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
  /** All four: what the calls processed. */
  readonly total: number;
}

export interface CallRecord {
  readonly at: string;
  readonly model: string;
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
  readonly toolCalls: readonly string[];
  readonly usd: number | null;
}

export interface Stats {
  readonly calls: number;
  readonly models: readonly string[];
  readonly tokens: TokenCounts;
  /** The largest prompt one call sent: the context the job reached. */
  readonly contextPeak: number;
  readonly toolCalls: {
    readonly total: number;
    readonly byName: Readonly<Record<string, number>>;
  };
  readonly wallSeconds: number;
  readonly cost: {
    readonly usd: number | null;
    /** exact: every call's usage as the API reported it, priced; estimated: from an agent's totals. */
    readonly basis: "exact" | "estimated";
    readonly priceTable: string;
  };
  /** api: a runner's own responses; transcript: Claude Code's record of each call; agent-total: what an agent reported. */
  readonly usageSource: "api" | "transcript" | "agent-total";
}

/** A share of a session: its calls, their tokens and price, and its wall time. */
export interface Part {
  readonly calls: number;
  readonly tokens: TokenCounts;
  readonly usd: number | null;
  readonly seconds: number;
  /** The grab bag's shared part: the context its files added. */
  readonly recordsContext?: number;
  /** The grab bag's question: its files re-read as cache, the records context times its calls. */
  readonly recordsTokens?: number;
}

/** A session's cost: the part before its first question, then each question's. */
export interface Split {
  readonly shared: Part;
  readonly questions: Readonly<Record<string, Part>>;
}

/** A tool an agent used, with its input (a written file's content left out). */
export interface ToolUse {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface Job {
  readonly id: string;
  readonly role: "subject" | "judge" | "harness";
  readonly case?: string;
  readonly arm?: Arm;
  /** The model asked for, by API id; `stats.models` says which ran. */
  readonly model: string;
  /** The alias a Claude Code agent is asked for. */
  readonly alias?: string;
  readonly effort?: string;
  readonly repeat?: number;
  /** A subject job is one session: its id and its questions, in order. */
  readonly session?: string;
  readonly questions?: readonly string[];
  /** A judge's sitting: the case, model and repeat whose two arms it reads. */
  readonly instance?: string;
  readonly tag: string;
  readonly inputsHash?: string;
  status:
    | "pending"
    | "dispatched"
    | "running"
    | "done"
    | "reused"
    | "skipped"
    | "failed";
  reason?: string;
  reusedFrom?: string;
  /** Whether the meter handed it out. */
  dispatched?: boolean;
  readonly estimate: {
    readonly tokens: number;
    readonly usd: number;
    readonly basis?: string;
  };
  stats?: Stats;
  calls?: readonly CallRecord[];
  split?: Split;
  /** Paths in the run's folder: a session's answers are a folder, one file per question. */
  readonly answers?: string;
  readonly prompt?: string;
  /** A subject job's opening prompt, as handed out: the report shows it, so results.json holds it. */
  promptText?: string;
  readonly verdict?: string;
  /** A judge's letters: each the answer to one question of one subject job. */
  labels?: Readonly<Record<string, Label>>;
  /** The tools the agent used, from its transcript: what its discipline is checked on, kept when the job is reused. */
  toolUses?: readonly ToolUse[];
  /** A judge's own folder, outside the run, holding only its packet; and the packet. */
  readonly workdir?: string;
  readonly packet?: string;
  /** The SHA-256 of the packet a judge read, which its letters and its verdict belong to. */
  readonly packetSha256?: string;
}

export interface Label {
  readonly job: string;
  readonly question: string;
}

export interface ToolCallRecord {
  readonly job: string;
  /** The call's number in its job, printed with its answer so an absence can name it. */
  readonly call?: number;
  readonly at: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
  readonly error?: string;
  /** The rows the answer held (all of them, or how many there were), and the entries it named. */
  readonly rows: number;
  readonly entries: readonly string[];
  /** The answer's text, which an absence is checked against. */
  readonly answer?: string;
  readonly milliseconds: number;
}

export interface CitationCheck {
  readonly item: number;
  readonly fact: number;
  readonly cite: Cite;
  readonly ok: boolean;
  readonly reason?: string;
  readonly missing?: readonly string[];
  readonly foundAt?: readonly number[];
  /** The text the citation points at, cut short, for a page to show. */
  readonly excerpt?: string;
  /** What the cited record does say, as the checker read it. */
  readonly shows?: string;
}

export interface AbsenceCheck {
  readonly item: number;
  readonly absence: number;
  readonly backed: boolean;
  readonly reason?: string;
}

export interface SubjectChecks {
  readonly answerValid: boolean;
  readonly answerErrors: readonly string[];
  readonly citations: readonly CitationCheck[];
  readonly absences: readonly AbsenceCheck[];
  readonly trapWording: readonly {
    readonly id: string;
    readonly item: number;
    readonly pattern: string;
    readonly means: string;
    readonly text: string;
  }[];
  /** Whether the job kept to its arm's tools: the pod arm to the one command, the records arm to reading the files. */
  readonly discipline: {
    readonly ok: boolean;
    readonly violations: readonly string[];
  };
  /** The records arm: which of the case's files it read, and how many tokens of each by size. */
  readonly read?: readonly string[];
}

export type ItemVerdict = "found" | "partly" | "missed" | "raised" | "avoided";
export type BeyondVerdict =
  "fair" | "true-not-planted" | "speculative" | "contradicted";

/** One judge's grade of one subject's answer to one question. */
export interface Grade {
  readonly subject: string;
  readonly question: string;
  readonly judge: string;
  readonly items: readonly {
    readonly id: string;
    readonly verdict: ItemVerdict;
    /** The answer's items it rests on, by n. */
    readonly items: readonly number[];
    readonly reason: string;
  }[];
  /** Every point of the answer outside the key, by its n, with its verdict. */
  readonly beyond: readonly {
    readonly item: number;
    readonly verdict: BeyondVerdict;
    readonly why: string;
  }[];
  readonly chains: readonly {
    readonly item: number;
    readonly complete: boolean;
    readonly faithful: boolean;
    readonly skipped: readonly string[];
  }[];
}

/** Key items counted by verdict: the judges' shared verdict, else split; ungraded when no judge graded it. */
export type Verdicts<V extends string> = Readonly<Record<V, number>> & {
  readonly split: number;
  readonly ungraded: number;
  readonly unanswered: number;
  readonly of: number;
};

export type BeyondCounts = Readonly<
  Record<
    "fair" | "trueNotPlanted" | "speculative" | "contradicted" | "split",
    number
  >
>;

export interface ArmSummary {
  readonly sessions: readonly string[];
  readonly questions: number;
  readonly expected: Verdicts<"found" | "partly" | "missed">;
  readonly traps: Verdicts<"avoided" | "raised">;
  readonly beyond: BeyondCounts;
  readonly citations: { readonly held: number; readonly failed: number };
  readonly tokens: number;
  readonly usd: number | null;
  readonly seconds: number;
}

/** One case, model and repeat: both arms, and what judging that sitting cost, charged to neither. */
export interface Instance {
  readonly id: string;
  readonly case: string;
  readonly model: string;
  readonly repeat: number;
  readonly arms: Readonly<Partial<Record<Arm, ArmSummary>>>;
  readonly judging: {
    readonly judges: readonly string[];
    readonly tokens: number;
    readonly usd: number | null;
  };
}

/** A pod entry, followed mechanically: the records merged into it, their revisions and the documents they came in. */
export interface EntryProvenance {
  readonly entry: string;
  readonly type: string;
  readonly fields: readonly (readonly [string, string])[];
  readonly members: readonly {
    readonly record: string;
    readonly sourceId?: string;
    readonly sourceUrl?: string;
    readonly revisions: readonly {
      readonly revision: string;
      readonly version?: string;
      readonly observedAsOf?: string;
      readonly selector?: string;
      readonly document?: {
        readonly iri: string;
        readonly retrievedOn?: string;
        readonly author?: string;
        readonly server?: string;
        readonly answeredAsOf?: string;
      };
    }[];
  }[];
}

/** The most characters of a passage that results.json keeps. */
export const PASSAGE_CAP = 20_000;

/** The lines of a download a citation names, and the download it came in. */
export interface Passage {
  readonly file: string;
  readonly resource?: string;
  readonly line?: number;
  readonly from: number;
  readonly to: number;
  readonly pointer?: string;
  readonly text: string;
  /** The text was cut at `PASSAGE_CAP` characters. */
  readonly truncated?: boolean;
  readonly download?: {
    readonly source?: string;
    readonly retrievedAt?: string;
  };
}

/** One citation or absence of one answer, resolved: nothing inferred, only looked up. */
export interface Evidence {
  readonly job: string;
  readonly question: string;
  readonly item: number;
  readonly fact?: number;
  readonly absence?: number;
  readonly cite?: Cite;
  readonly entry?: EntryProvenance | null;
  readonly passage?: Passage | null;
  readonly call?: {
    readonly call?: number;
    readonly at: string;
    readonly ok: boolean;
    readonly rows: number;
    readonly milliseconds: number;
  } | null;
  /** A grab-bag absence: whether it named its sources (else the files offered stand in for them). */
  readonly stated?: boolean;
  readonly files?: readonly {
    readonly file: string;
    /** Whether the job read the whole file, as a records absence requires. */
    readonly read: boolean;
    readonly bytes: number;
  }[];
}

export interface Results {
  readonly schema: "cascade-evals/results/2";
  readonly run: {
    readonly id: string;
    readonly tier: string;
    readonly runner: "claude-code" | "api";
    readonly created: string;
    readonly finished: string;
    readonly wallSeconds: number;
    readonly stoppedAtCap: boolean;
    readonly config: unknown;
    readonly configSha256: string;
  };
  readonly versions: {
    readonly harness: { readonly commit: string; readonly uncommitted: number };
    readonly podPackages: Readonly<Record<string, string>>;
    readonly components: readonly Component[];
    readonly prompts: Readonly<Record<string, string>>;
    readonly priceTable: string;
  };
  readonly budget: {
    readonly cap: { readonly tokens?: number; readonly usd?: number };
    readonly estimate: { readonly tokens: number; readonly usd: number };
    readonly spent: {
      readonly tokens: number;
      readonly usd: number;
      readonly basis: "exact" | "estimated";
    };
    readonly byRole: Readonly<
      Record<string, { readonly tokens: number; readonly usd: number }>
    >;
  };
  readonly cases: readonly {
    readonly id: string;
    readonly person: Case["person"];
    /** The day the case is set on: what "now" means to its questions. */
    readonly today: string;
    readonly description: Pick<
      Case["description"],
      "summary" | "who" | "sources" | "planted"
    >;
    readonly downloadsSha256: string;
    readonly keySha256: string;
    readonly imports: Prepared["imports"];
    readonly documents: Prepared["documents"];
    readonly sessions: readonly Session[];
    readonly key: readonly Pick<
      KeyItem,
      "id" | "question" | "kind" | "title" | "lookingFor" | "pod"
    >[];
    readonly keyUrl: string;
    readonly build: Prepared["build"] | null;
  }[];
  readonly jobs: readonly Job[];
  readonly asked: readonly Asked[];
  readonly toolCalls: readonly ToolCallRecord[];
  /** By subject job, then question. */
  readonly checks: Readonly<
    Record<string, Readonly<Record<string, SubjectChecks>>>
  >;
  /** Each judge's tools beyond reading its packet and writing its verdict. */
  readonly judgeDiscipline: Readonly<
    Record<
      string,
      { readonly ok: boolean; readonly violations: readonly string[] }
    >
  >;
  /** By subject job, then question. */
  readonly answers: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly evidence: readonly Evidence[];
  readonly grades: readonly Grade[];
  readonly instances: readonly Instance[];
  readonly agreement: readonly {
    readonly instance: string;
    readonly judges: readonly string[];
    readonly items: number;
    readonly agreed: number;
    readonly kappa: number | null;
  }[];
}

/** A run's folder from its id or its path. */
export function runFolder(given: string): string {
  return existsSync(given) ? resolve(given) : join(RUNS, given);
}
