// What a run records, as results.json holds it (schemas/results.schema.json). A runner on the Claude API fills the
// same fields from each response's usage; a run driven from Claude Code fills them from each agent's transcript.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Cite } from "./citations.js";
import type { Component, Prepared } from "./cases.js";
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
  /** Paths in the run's folder. */
  readonly answer?: string;
  readonly prompt?: string;
  readonly verdict?: string;
  /** A judge's subjects, by job id, under the labels it saw. */
  labels?: Readonly<Record<string, string>>;
  /** The tools the agent used, from its transcript: what its discipline is checked on, kept when the job is reused. */
  toolUses?: readonly ToolUse[];
  /** A judge's own folder, outside the run, holding only its packet; and the packet. */
  readonly workdir?: string;
  readonly packet?: string;
  /** The SHA-256 of the packet a judge read, which its letters and its verdict belong to. */
  readonly packetSha256?: string;
}

export interface ToolCallRecord {
  readonly job: string;
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
  readonly question: number;
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
  readonly question: number;
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
    readonly item: string;
    readonly question: number;
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

export interface Grade {
  readonly subject: string;
  readonly judge: string;
  readonly items: readonly {
    readonly id: string;
    readonly verdict: "found" | "partly" | "missed" | "raised" | "avoided";
    readonly questions: readonly number[];
    readonly reason: string;
  }[];
  readonly falseQuestions: readonly {
    readonly question: number;
    readonly item?: string;
    readonly why: string;
  }[];
  readonly extraFinds: readonly {
    readonly question: number;
    readonly item?: string;
    readonly why: string;
  }[];
  readonly chains: readonly {
    readonly question: number;
    readonly complete: boolean;
    readonly faithful: boolean;
    readonly skipped: readonly string[];
  }[];
}

export interface Score {
  readonly subject: string;
  readonly judge: string;
  readonly found: number;
  readonly partly: number;
  readonly missed: number;
  readonly gaps: number;
  readonly trapsRaised: number;
  readonly falseQuestions: number;
  readonly extraFinds: number;
  readonly chainsComplete: number;
  readonly chainsFaithful: number;
  readonly questions: number;
}

export interface SliceNode {
  readonly id: string;
  readonly kind: "entry" | "record" | "lab" | "condition";
  readonly label: string;
  /** The source's state and date, for a record. */
  readonly detail?: string;
  readonly source?: string;
}

export interface Slice {
  readonly case: string;
  readonly item: string;
  readonly nodes: readonly SliceNode[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

export interface Results {
  readonly schema: "cascade-evals/results/1";
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
    readonly downloadsSha256: string;
    readonly keySha256: string;
    readonly imports: Prepared["imports"];
    readonly documents: Prepared["documents"];
  }[];
  readonly jobs: readonly Job[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly checks: Readonly<Record<string, SubjectChecks>>;
  /** Each judge's tools beyond reading its packet and writing its verdict. */
  readonly judgeDiscipline: Readonly<
    Record<
      string,
      { readonly ok: boolean; readonly violations: readonly string[] }
    >
  >;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly grades: readonly Grade[];
  readonly scores: readonly Score[];
  readonly agreement: readonly {
    readonly case: string;
    readonly judges: readonly string[];
    readonly items: number;
    readonly agreed: number;
    readonly kappa: number | null;
  }[];
  readonly slices: readonly Slice[];
}

/** A run's folder from its id or its path. */
export function runFolder(given: string): string {
  return existsSync(given) ? resolve(given) : join(RUNS, given);
}
