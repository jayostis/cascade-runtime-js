// What every page of the report writes the same way: escaping, numbers, names and the two arms' marks.
import type { Arm } from "./prompts.js";
import type { Results } from "./results.js";

export const esc = (text: unknown) =>
  String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const thousands = (n: number | undefined | null) =>
  n === undefined || n === null ? "–" : Math.round(n).toLocaleString("en-US");
export const dollars = (n: number | undefined | null) =>
  n === undefined || n === null
    ? "–"
    : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
export const seconds = (n: number | undefined | null) =>
  n === undefined || n === null
    ? "–"
    : n < 90
      ? `${Math.round(n * 10) / 10} s`
      : `${Math.round(n / 60)} min`;
export const compact = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
export const day = (iso: string | undefined) => (iso ?? "").slice(0, 10);
export const cut = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

export const ARMS: readonly Arm[] = ["pod", "records"];
export const ARM_NAME: Readonly<Record<Arm, string>> = {
  pod: "With Cascade",
  records: "Grab bag",
};
export const ARM_HOW: Readonly<Record<Arm, string>> = {
  pod: "the downloads joined into one pod, read through tools",
  records: "the same downloads read whole, as if pasted into the chat",
};
export const modelName = (id: string) => id.replace(/^claude-/, "");

type Person = Results["cases"][number]["person"];

/** The person a case is about, as the case file recorded them. */
export const personIn = (r: Results, id: string): Person =>
  r.cases.find((it) => it.id === id)?.person ?? { name: id, pronoun: "their" };

/** The person's subject pronoun, to go with the possessive the case file records. */
export const subjectOf = (person: Person) =>
  ({ her: "she", his: "he", their: "they" })[person.pronoun];

/** Where a person's page is, from the site's root. */
export const personPath = (id: string) => `people/${id}.html`;

export const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length === 0) return undefined;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export type Tone = "yes" | "part" | "no" | "beyond" | "none" | "contra";

/** A verdict as a small mark: a tick, a half, a cross, a plus, a dot. */
export const mark = (tone: Tone, label: string) =>
  `<span class="mark m-${tone}"><i>${{ yes: "✓", part: "◐", no: "✗", beyond: "+", none: "·", contra: "!" }[tone]}</i>${esc(label)}</span>`;

export const badge = (arm: Arm) =>
  `<span class="badge b-${arm}">${ARM_NAME[arm]}</span>`;
