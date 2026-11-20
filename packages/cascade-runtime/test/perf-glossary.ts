import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

interface Family {
  readonly startsWith?: string;
  readonly endsWith?: string;
  readonly says: string;
  readonly within?: string;
}

interface Glossary {
  readonly datasets: Readonly<Record<string, string>>;
  readonly variants: Readonly<Record<string, string>>;
  readonly scenarios: Readonly<Record<string, { says: string; total: string }>>;
  readonly measures: Readonly<Record<string, string>>;
  readonly measureFamilies: readonly Family[];
  readonly selfRows: string;
  readonly runs: string;
  readonly spans: Readonly<Record<string, { says: string; within?: string }>>;
  readonly families: readonly Family[];
  readonly counts: Readonly<Record<string, string>>;
  readonly countFamilies: readonly Family[];
}

/** The glossary file sits in the source tree; the compiled test folder is two levels below it. */
const FILE = new URL("../../test/perf-glossary.json", import.meta.url);
export const glossary = JSON.parse(readFileSync(FILE, "utf8")) as Glossary;

/** A row's name: `<scenario>-<dataset>[-encrypted]/<rest>`. */
const ROW = new RegExp(
  `^(${Object.keys(glossary.scenarios).join("|")})-(${Object.keys(glossary.datasets).join("|")})(-encrypted)?/(.+)$`,
);

export function parsed(
  rowName: string,
):
  | { scenario: string; dataset: string; encrypted: boolean; rest: string }
  | undefined {
  const found = ROW.exec(rowName);
  if (found === null) return undefined;
  return {
    scenario: found[1] as string,
    dataset: found[2] as string,
    encrypted: found[3] !== undefined,
    rest: found[4] as string,
  };
}

const spaced = (text: string) => text.replace(/[-.]+/g, " ").trim();

function fromFamily(
  families: readonly Family[],
  name: string,
): { says: string; within?: string } | undefined {
  for (const family of families) {
    const start = family.startsWith ?? "";
    const end = family.endsWith ?? "";
    if (
      name.length >= start.length + end.length &&
      name.startsWith(start) &&
      name.endsWith(end)
    )
      return {
        says: family.says.replace(
          "{name}",
          spaced(name.slice(start.length, name.length - end.length)),
        ),
        ...(family.within !== undefined && { within: family.within }),
      };
  }
  return undefined;
}

/** A name told apart from another by a trailing number (`unique` in perf-report.ts) is looked up without it. */
const lookup = <T>(find: (name: string) => T | undefined, name: string) =>
  find(name) ?? find(name.replace(/-\d+$/, ""));

const spanOf = (name: string) =>
  lookup(
    (each) => glossary.spans[each] ?? fromFamily(glossary.families, each),
    name,
  );

const countOf = (name: string): string | undefined =>
  lookup(
    (each) =>
      glossary.counts[each] ?? fromFamily(glossary.countFamilies, each)?.says,
    name,
  );

/** What a span is, from its name in the form a row has it (see `part` in perf-report.ts), or undefined for one the glossary lacks. */
export function explainSpan(name: string): string | undefined {
  const found = spanOf(name);
  if (found === undefined) return undefined;
  return found.within === undefined
    ? found.says
    : `${found.says} Sits inside ${found.within}.`;
}

/** The sentence a row's `extra` begins with, or undefined for a name the glossary lacks. */
export function explain(rowName: string): string | undefined {
  const row = parsed(rowName);
  if (row === undefined) return undefined;
  const { scenario, rest } = row;
  if (rest.startsWith("stage/")) return explainSpan(rest.slice(6));
  if (rest.startsWith("self/")) {
    const says = explainSpan(rest.slice(5));
    return says === undefined ? undefined : `${says} ${glossary.selfRows}`;
  }
  if (rest.startsWith("count/")) return countOf(rest.slice(6));
  if (rest === "total") return glossary.scenarios[scenario]?.total;
  const measure =
    glossary.measures[rest] ??
    lookup((each) => fromFamily(glossary.measureFamilies, each)?.says, rest);
  return measure;
}

/** The datasets' and variant's sentences for a row's name: what the row was measured on. */
export function measuredOn(rowName: string): string | undefined {
  const row = parsed(rowName);
  if (row === undefined) return undefined;
  return `${glossary.datasets[row.dataset]} ${glossary.variants[row.encrypted ? "encrypted" : "plain"]}`;
}

/** The glossary as the readable reference listing every term. */
export function glossaryMarkdown(): string {
  const table = (rows: [string, string][]) =>
    [
      "| Term | Meaning |",
      "|---|---|",
      ...rows.map(([k, v]) => `| \`${k}\` | ${v} |`),
    ].join("\n");
  const entries = (record: Readonly<Record<string, string>>) =>
    Object.entries(record) as [string, string][];
  const family = (list: readonly Family[]) =>
    list.map((each): [string, string] => [
      `${each.startsWith ?? ""}*${each.endsWith ?? ""}`,
      each.says.replace("{name}", "`<name>`") +
        (each.within ? ` Sits inside \`${each.within}\`.` : ""),
    ]);
  return [
    "# What the performance numbers mean",
    "",
    "Generated from `packages/cascade-runtime/test/perf-glossary.json`; edit that file, then run",
    "`node packages/cascade-runtime/dist/test/perf-glossary.js > docs/perf-glossary.md`. A test fails if this page is out of date or if the performance file names something the glossary lacks.",
    "",
    "## Scenarios",
    "",
    table(Object.entries(glossary.scenarios).map(([k, v]) => [k, v.says])),
    "",
    "## Datasets",
    "",
    table(entries(glossary.datasets)),
    "",
    "## Plain and encrypted",
    "",
    table(entries(glossary.variants)),
    "",
    "## Measurements of a scenario",
    "",
    "Each is a row named `<scenario>-<dataset>[-encrypted]/<measurement>`. `total` is the scenario's own sentence above.",
    "",
    table([
      ...Object.entries(glossary.scenarios).map(([k, v]): [string, string] => [
        `${k}/total`,
        v.total,
      ]),
      ...entries(glossary.measures),
      ...family(glossary.measureFamilies),
    ]),
    "",
    "## Stages of the probed run",
    "",
    "Rows named `<scenario>-<dataset>/stage/<stage>`: where time goes inside one run with the probe on. A stage's time includes the stages inside it, so stages overlap and do not add up to the total.",
    "",
    table([
      ...Object.entries(glossary.spans).map(([k, v]): [string, string] => [
        k,
        v.says + (v.within ? ` Sits inside \`${v.within}\`.` : ""),
      ]),
      ...family(glossary.families),
    ]),
    "",
    "## Own time of the probed run",
    "",
    "Rows named `<scenario>-<dataset>/self/<stage>`, for the same stages: " +
      glossary.selfRows,
    "",
    "## Flame graphs of every build",
    "",
    glossary.runs,
    "",
    "## Counts of the probed run",
    "",
    "Rows named `<scenario>-<dataset>/count/<count>`.",
    "",
    table([...entries(glossary.counts), ...family(glossary.countFamilies)]),
    "",
  ].join("\n");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  process.stdout.write(glossaryMarkdown());
