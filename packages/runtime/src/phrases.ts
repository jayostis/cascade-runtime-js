import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import { compared, differences } from "./compare.js";
import type { StatedStep } from "./features.js";
import type { Files } from "./files.js";
import { Graph } from "./graph.js";
import type { Layout } from "./layout.js";
import { MATCHER } from "./matcher.js";
import { documentName, inUtc } from "./names.js";
import {
  iri,
  literal,
  RDF,
  type Term,
  type Triple,
  written,
  XSD,
} from "./rdf.js";
import { versionsNumbered } from "./references.js";
import type { Replayed } from "./replay.js";
import { type Row, selected, type Store } from "./store.js";
import { REC } from "./step.js";
import type { Happened, Step } from "./story.js";
import {
  CLINICAL,
  HEALTH,
  JDG,
  JUSTIFICATIONS,
  KINDS,
  listed,
  PAV,
  type Person,
  PROV,
  type Words,
} from "./words.js";

const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const CASCADE = "https://ns.cascadeprotocol.org/core/v1#";
const MERGED_FROM = `${CASCADE}mergedFrom`;
const UUID_V4 =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const PREFIXES: Readonly<Record<string, string>> = {
  npx: "http://purl.org/nanopub/x/",
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD,
  prov: PROV,
  pav: PAV,
  bridge: "https://ns.cascadeprotocol.org/bridge/v1-draft#",
  rec: REC,
  jdg: JDG,
  health: HEALTH,
  clinical: CLINICAL,
  cascade: CASCADE,
};

type ReplayedStep = Replayed["steps"][number];

/** What an example's `Then` steps read: the pod as it stood at a step, under a lens. */
export interface Reading {
  readonly store: Store;
  readonly replayed: Replayed;
  readonly words: Words;
  readonly person: Person;
  readonly vocabulary: Files;
  /** The feature file's folder. */
  readonly folder: string;
  readonly layout: Layout;
}

/** Why the pod does not read as the step says, or undefined when it does. */
export type Check = (reading: Reading) => Promise<string | undefined>;

/** An example as its steps compile: whose pod it is, what happens to it, where it is read, and what must hold. */
export interface Compiled {
  person?: Person;
  readonly steps: Step[];
  /** The step the pod is read as it stood after, by its name, and the lens; the last step under everyday otherwise. */
  at?: { readonly index: number; readonly lens: string };
  readonly checks: { readonly text: string; readonly check: Check }[];
  /** The query the last `When the query is:` gave, which the `it answers` steps after it read. */
  query?: string;
}

export interface Compiling {
  readonly vocabulary: Files;
  readonly people: ReadonlyMap<string, Person>;
  /** Reads a person's reference index, to name a version that arrives. */
  readonly references: (person: Person) => Promise<Graph>;
}

/** What a step does to the example as it compiles; a `Then` step gives what must hold. */
type Act = (
  compiled: Compiled,
  args: readonly unknown[],
  stated: StatedStep,
  compiling: Compiling,
  label: string | undefined,
) => Promise<Check | void> | Check | void;

type Definition = readonly [string, Act];

/** A `Then` phrase: what must hold, made from the step as it compiles. */
const then = (
  expression: string,
  check: (
    args: readonly unknown[],
    stated: StatedStep,
    compiled: Compiled,
  ) => Check,
): Definition => [
  expression,
  (compiled, args, stated) => check(args, stated, compiled),
];

const registry = new ParameterTypeRegistry();
const parameter = (
  name: string,
  regexp: RegExp,
  transform: (text: string) => unknown = (text) => text,
): void => {
  registry.defineParameterType(
    new ParameterType(name, regexp, null, transform, false, false),
  );
};
const unquoted = (text: string): string => text.slice(1, -1);

/** A time as the steps write it, `2026-01-02 at 10:00`, as an xsd:dateTime in UTC. */
function timeOf(text: string): string {
  const found =
    /^(\d{4}-\d{2}-\d{2})(?: at | )(\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?$/.exec(
      text.trim(),
    );
  if (found === null) throw new Error(`"${text}" is no time`);
  return `${found[1]}T${found[2]}${found[3] ?? ":00"}Z`;
}

parameter("person", /[A-Z][a-z]+/);
parameter(
  "time",
  /\d{4}-\d{2}-\d{2} at \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/,
  timeOf,
);
parameter("name", /"[^"]*"/, unquoted);
parameter("step", /that step|that import|that entry|"[^"]*"/);
parameter(
  "steps",
  /that step|"[^"]*"(?:(?:, |, and | and |, or | or )"[^"]*")*/,
);
parameter("count", /no file|1 file|\d+ files/, (text) =>
  text === "no file" ? 0 : Number.parseInt(text, 10),
);
parameter(
  "view",
  /allergies|conditions|immunizations|procedures|medications|lab-results|patient-profile/,
);
parameter("lens", /[a-z]+/);
parameter("record", /[^:]+/);
parameter("records", /[^:]+/);
parameter("judgment", /[^:]+/);

/**
 * The steps a `{step}` or `{steps}` names among those taken: `that step` the last of them, `that import` or
 * `that entry` the last of its kind, and each quoted name the one step so named.
 */
function stepsNamed<T>(
  taken: readonly T[],
  said: string,
  stepOf: (taken: T) => Step,
): T[] {
  const kind = /^that (step|import|entry)$/.exec(said)?.[1];
  if (kind !== undefined) {
    const last = taken.findLast(
      (one) => kind === "step" || stepOf(one).happened.kind === kind,
    );
    if (last === undefined) throw new Error(`no step before this is ${said}`);
    return [last];
  }
  return [...said.matchAll(/"([^"]*)"/g)].map(([, name = ""]) => {
    const found = taken.filter((one) => stepOf(one).name === name);
    if (found.length !== 1)
      throw new Error(
        `the example has ${found.length === 0 ? "no" : String(found.length)} step${found.length === 1 ? "" : "s"} named "${name}"`,
      );
    return found[0] as T;
  });
}

/** The step a `{step}` names, among the steps an example has taken so far. */
const named = (steps: readonly Step[], said: string): Step =>
  stepsNamed(steps, said, (step) => step)[0] as Step;

/** The steps a `{step}` or `{steps}` names, among those the pod is read after. */
const stepsOf = (reading: Reading, said: string): ReplayedStep[] =>
  stepsNamed(reading.replayed.steps, said, ({ step }) => step);

function happen(
  compiled: Compiled,
  label: string | undefined,
  quoted: string | undefined,
  when: string,
  happened: Happened,
): void {
  if (compiled.person === undefined)
    throw new Error("the example has no pod: its first step creates one");
  const before = compiled.steps.at(-1)?.when;
  if (before !== undefined && Date.parse(when) < Date.parse(before))
    throw new Error(`${when} is before the step before it, ${before}`);
  const name = label ?? quoted ?? happened.kind.replace("creation", "pod");
  if (!/^[A-Za-z0-9][\w.-]*$/.test(name))
    throw new Error(
      `"${name}" cannot name a step: a step's name is letters, digits, "-", "_" and "."`,
    );
  if (compiled.steps.some((step) => step.name === name))
    throw new Error(`two steps of the example are named "${name}": label one`);
  compiled.steps.push({
    name,
    when,
    happened,
  });
}

function table(
  stated: StatedStep,
  columns: readonly string[],
): Record<string, string>[] {
  const [header, ...rows] = stated.table ?? [];
  if (header === undefined) throw new Error("the step has no table");
  const unknown = header.filter((column) => !columns.includes(column));
  if (unknown.length > 0)
    throw new Error(
      `the table has columns this step does not: ${unknown.join(", ")}`,
    );
  return rows.map((row) =>
    Object.fromEntries(
      header.map((column, i) => [column, (row[i] ?? "").trim()]),
    ),
  );
}

const shownTime = (value: string): string =>
  value === ""
    ? ""
    : new Date(Date.parse(value)).toISOString().replace(".000Z", "Z");

const cellTime = (cell: string): string =>
  cell === "" ? "" : shownTime(timeOf(cell));

async function records(reading: Reading, words: string): Promise<string[]> {
  return Promise.all(
    listed(words).map((record) => reading.words.record(record)),
  );
}

/** The rows of a query over the RDF files the steps wrote, `?file` bound to each: none when they wrote none. */
async function inWritten(
  reading: Reading,
  steps: readonly ReplayedStep[],
  projection: string,
  where: string,
): Promise<readonly Row[]> {
  const address = reading.replayed.story.address;
  const files = steps.flatMap(({ wrote }) =>
    wrote
      .filter((path) => reading.layout.isRdf(path))
      .map((path) => `<${address}${path}>`),
  );
  if (files.length === 0) return [];
  return (
    await reading.store.select(
      `SELECT ${projection} WHERE { VALUES ?file { ${files.join(" ")} } ${where} }`,
    )
  ).rows;
}

/** The triples of the RDF files the steps wrote. */
async function wroteGraph(
  reading: Reading,
  steps: readonly ReplayedStep[],
): Promise<Graph> {
  return new Graph(
    (
      await inWritten(reading, steps, "?s ?p ?o", "GRAPH ?file { ?s ?p ?o }")
    ).map(
      (row) => [row.get("s"), row.get("p"), row.get("o")] as unknown as Triple,
    ),
  );
}

const valuesOf = (rows: readonly Row[], variable: string): string[] =>
  rows.map((row) => row.get(variable)?.value ?? "");

const localName = (name: string): string =>
  name.slice(Math.max(name.lastIndexOf("#"), name.lastIndexOf("/")) + 1);

/**
 * A field a table names in words, and the predicates that give it. An entry's field (`entry`) is read from the entry
 * in its view; a record's (`of`) from the record itself or from its current version.
 */
interface Field {
  readonly predicates: readonly string[];
  readonly entry?: true;
  readonly of?: "record" | "version";
  /** Its values are things, which a cell names in words. */
  readonly thing?: true;
  /** A value as a cell shows it, when not as itself; undefined leaves it out. */
  readonly shows?: (
    term: Term,
    reading: Reading,
    record: string,
  ) => Promise<string | undefined> | string | undefined;
}

const KIND_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(KINDS).map(([kind, type]) => [type, kind]),
);

const FIELDS: Readonly<Record<string, Field>> = {
  type: {
    predicates: [`${RDF}type`],
    entry: true,
    shows: ({ value }) => localName(value),
  },
  status: { predicates: [`${HEALTH}status`, `${CLINICAL}status`], entry: true },
  criticality: {
    predicates: [`${CLINICAL}criticality`],
    entry: true,
    of: "version",
  },
  "abatement date": { predicates: [`${CLINICAL}abatementDate`], entry: true },
  "status from": { predicates: [`${REC}statusFrom`], entry: true, thing: true },
  "latest member": {
    predicates: [`${REC}latestMember`],
    entry: true,
    thing: true,
  },
  kind: {
    predicates: [`${RDF}type`],
    of: "record",
    shows: ({ value }) => KIND_OF[value],
  },
  version: {
    predicates: [`${PAV}hasCurrentVersion`],
    of: "record",
    shows: async ({ value }, reading, record) =>
      String((await reading.words.versions(record)).indexOf(value) + 1),
  },
  subject: { predicates: [`${REC}subject`], of: "record", thing: true },
  patient: { predicates: [`${REC}patient`], of: "version", thing: true },
  "influenced by": {
    predicates: [`${PROV}wasInfluencedBy`],
    of: "version",
    thing: true,
  },
};

const ENTRY_FIELDS = Object.entries(FIELDS).filter(([, { entry }]) => entry);

const recordField = (words: string): Field | undefined =>
  FIELDS[words]?.of === undefined ? undefined : FIELDS[words];

/** A value as a table's cell shows it: a thing in the words that named it, an IRI or a typed literal written. */
async function shown(
  reading: Reading,
  term: Term,
  field?: Field,
  record = "",
): Promise<string | undefined> {
  if (field?.shows !== undefined) return field.shows(term, reading, record);
  if (term.termType !== "Literal")
    return field?.thing ? reading.words.shown(term.value) : `<${term.value}>`;
  return term.datatype.value === `${XSD}date` ||
    term.datatype.value === `${XSD}string` ||
    term.datatype.value === `${RDF}langString`
    ? term.value
    : `${term.value}^^<${term.datatype.value}>`;
}

/** A cell of a field, as `shown` would show the value it names. */
const cellShown = async (
  reading: Reading,
  cell: string,
  field: Field | undefined,
): Promise<string> =>
  field?.thing ? reading.words.shown(await reading.words.thing(cell)) : cell;

/** A property of a version named in words: `verification status` names any property whose local name is `verificationStatus`. */
const propertyOf = (words: string): string =>
  words.replace(/ ([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The values of a version's field, as a revision table's cell shows them. */
async function fieldOf(
  reading: Reading,
  version: string,
  field: string,
): Promise<string> {
  const wanted = propertyOf(field);
  return (
    await selected(
      reading.store,
      `SELECT DISTINCT ?p ?o WHERE { GRAPH ?file { <${version}> ?p ?o }
        FILTER (STRSTARTS(STR(?file), "${reading.replayed.story.address}")) }`,
    )
  )
    .filter(([p]) => localName(p ?? "") === wanted)
    .map(([, o]) => o ?? "")
    .sort()
    .join(", ");
}

/** The columns of a revision table that name a version's fields. */
const fieldsOf = (stated: StatedStep, fixed: readonly string[]): string[] =>
  (stated.table?.[0] ?? [])
    .map((cell) => cell.trim())
    .filter((column) => !fixed.includes(column));

const expectedFields = (
  row: Record<string, string>,
  fields: readonly string[],
): string =>
  fields
    .map((field) =>
      (row[field] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== "")
        .sort()
        .join(", "),
    )
    .map((cell) => ` | ${cell}`)
    .join("");

/** Each revision of the record: when it arrived, the number of the version it sets, the version's fields, and when the one it follows arrived. */
async function revisionsOf(
  reading: Reading,
  record: string,
  fields: readonly string[],
): Promise<string[]> {
  const versions = await reading.words.versions(record);
  const rows: string[] = [];
  for (const [, version, at, after] of await selected(
    reading.store,
    `SELECT ?revision ?version ?at ?after WHERE {
        ?revision <${REC}revisionOf> <${record}> ; <${REC}version> ?version ; <${PROV}generatedAtTime> ?at .
        OPTIONAL { ?revision <${PROV}wasRevisionOf> ?previous . ?previous <${PROV}generatedAtTime> ?after }
      }`,
  )) {
    let shown = "";
    for (const field of fields)
      shown += ` | ${await fieldOf(reading, version ?? "", field)}`;
    rows.push(
      `${shownTime(at ?? "")} | ${versions.indexOf(version ?? "") + 1}${shown} | ${shownTime(after ?? "")}`,
    );
  }
  return rows;
}

/** The revisions of the record named, or of each record the table's `record` column names, are the table's. */
function revisionsAre(stated: StatedStep, named?: string): Check {
  const fixed = [
    ...(named === undefined ? ["record"] : []),
    "arrived",
    "version",
    "after",
  ];
  const fields = fieldsOf(stated, fixed);
  const rows = table(stated, [...fixed, ...fields]);
  const of = (words: string, row: string): string =>
    named === undefined ? `${words} | ${row}` : row;
  return async (reading) => {
    const found: string[] = [];
    for (const words of named === undefined
      ? new Set(rows.map((row) => row.record ?? ""))
      : [named]) {
      const record = await reading.words.record(words);
      found.push(
        ...(await revisionsOf(reading, record, fields)).map((row) =>
          of(words, row),
        ),
      );
    }
    return compared(
      rows.map((row) =>
        of(
          row.record ?? "",
          `${cellTime(row.arrived ?? "")} | ${row.version ?? ""}${expectedFields(row, fields)} | ${cellTime(row.after ?? "")}`,
        ),
      ),
      found,
    );
  };
}

const MATCHER_JUDGMENTS = `SELECT ?judgment ?justification ?member ?at ?used WHERE {
  ?judgment <${PROV}wasAttributedTo> <${MATCHER}> ; <${JDG}verdict> <${JDG}Same> ;
    <${JDG}justification> ?justification ; <${PROV}hadMember> ?member .
  OPTIONAL { ?judgment <${PROV}generatedAtTime> ?at }
  OPTIONAL { ?judgment <${PROV}used> ?used }
}`;

interface Judged {
  readonly name: string;
  readonly justification: string;
  readonly members: Set<string>;
  readonly at: Set<string>;
  readonly used: Set<string>;
}

async function matcherJudgments(store: Store): Promise<Judged[]> {
  const found = new Map<string, Judged>();
  for (const [name, justification, member, at, used] of await selected(
    store,
    MATCHER_JUDGMENTS,
  )) {
    const judged =
      found.get(name ?? "") ??
      ({
        name: name ?? "",
        justification: justification ?? "",
        members: new Set(),
        at: new Set(),
        used: new Set(),
      } satisfies Judged);
    judged.members.add(member ?? "");
    if (at) judged.at.add(shownTime(at));
    if (used) judged.used.add(used);
    found.set(judged.name, judged);
  }
  return [...found.values()];
}

const JUSTIFIED = Object.fromEntries(
  Object.entries(JUSTIFICATIONS).map(([words, name]) => [name, words]),
);

/** A judgment as a row of the judgments table, in the columns the table gives. */
function judgmentRow(
  reading: Reading,
  judged: Judged,
  columns: readonly string[],
): string {
  const sorted = (names: Iterable<string>): string =>
    [...names]
      .map((name) => reading.words.shown(name))
      .sort()
      .join(", ");
  return columns
    .map((column) => {
      switch (column) {
        case "justification":
          return JUSTIFIED[judged.justification] ?? `<${judged.justification}>`;
        case "members":
          return sorted(judged.members);
        case "at":
          return [...judged.at].join(", ");
        case "used":
          return sorted(judged.used);
        case "inputs":
          return [
            MATCHER,
            judged.justification,
            ...[...judged.members].sort(),
            ...[...judged.used].sort(),
          ].join(", ");
        case "name":
          return judged.name;
        default:
          return "";
      }
    })
    .join(" | ");
}

async function expectedJudgmentRow(
  reading: Reading,
  row: Record<string, string>,
  columns: readonly string[],
): Promise<string> {
  const things = async (
    cell: string,
    as: (words: string) => Promise<string>,
  ): Promise<string> =>
    (
      await Promise.all(
        listed(cell).map(async (words) => reading.words.shown(await as(words))),
      )
    )
      .sort()
      .join(", ");
  const cells: string[] = [];
  for (const column of columns) {
    const cell = row[column] ?? "";
    if (column === "justification") {
      if (JUSTIFICATIONS[cell] === undefined)
        throw new Error(`"${cell}" is no justification`);
      cells.push(cell);
    } else if (column === "members")
      cells.push(await things(cell, (words) => reading.words.record(words)));
    else if (column === "at") cells.push(cellTime(cell));
    else if (column === "used")
      cells.push(await things(cell, (words) => reading.words.thing(words)));
    else cells.push(cell);
  }
  return cells.join(" | ");
}

const JUDGMENT_COLUMNS = [
  "justification",
  "members",
  "at",
  "used",
  "inputs",
  "name",
];

/**
 * How the judgments found differ from the table's: first everything but the names, the inputs among it, then the names,
 * so a wrong input and a wrong hash each fail with their own message.
 */
async function comparedJudgments(
  reading: Reading,
  rows: readonly Record<string, string>[],
  found: readonly Judged[],
  columns: readonly string[],
): Promise<string | undefined> {
  const unnamed = columns.filter((column) => column !== "name");
  const before = compared(
    await Promise.all(
      rows.map((row) => expectedJudgmentRow(reading, row, unnamed)),
    ),
    found.map((judged) => judgmentRow(reading, judged, unnamed)),
  );
  if (before !== undefined || unnamed.length === columns.length) return before;
  const names = compared(
    await Promise.all(
      rows.map((row) => expectedJudgmentRow(reading, row, columns)),
    ),
    found.map((judged) => judgmentRow(reading, judged, columns)),
  );
  return names === undefined
    ? undefined
    : `each judgment is as the table says but its name:
${names}`;
}

/** The matcher's judgments holding any of the records named are the table's rows, in its columns. */
const judgmentsHolding =
  (
    words: string,
    rows: readonly Record<string, string>[],
    columns: readonly string[],
  ): Check =>
  async (reading) => {
    const held = new Set(await records(reading, words));
    const found = (await matcherJudgments(reading.store)).filter((judged) =>
      [...judged.members].some((member) => held.has(member)),
    );
    return comparedJudgments(reading, rows, found, columns);
  };

const reasonWords = (reason: string): string =>
  localName(reason)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

function cellTerm(
  cell: string,
  prefixes: Readonly<Record<string, string>>,
): Term | undefined {
  const iriCell = /^<([^>]*)>$/.exec(cell);
  if (iriCell) return iri(iriCell[1] ?? "");
  const literalCell =
    /^"((?:[^"\\]|\\.)*)"(?:\^\^(?:<([^>]+)>|([A-Za-z][\w-]*):(\S*))|@([a-zA-Z-]+))?$/.exec(
      cell,
    );
  if (literalCell) {
    const [, text = "", full, prefix, local, language] = literalCell;
    const value = text.replace(/\\(.)/g, "$1");
    if (language !== undefined) return literal(value, { language });
    if (full !== undefined) return literal(value, full);
    if (prefix !== undefined) {
      const base = prefixes[prefix];
      if (base === undefined)
        throw new Error(`${prefix}: is no prefix the query declares`);
      return literal(value, base + (local ?? ""));
    }
    return literal(value);
  }
  if (/^(true|false)$/.test(cell)) return literal(cell, `${XSD}boolean`);
  if (/^-?\d+$/.test(cell)) return literal(cell, `${XSD}integer`);
  if (/^-?\d+\.\d+$/.test(cell)) return literal(cell, `${XSD}decimal`);
  const prefixed = /^([A-Za-z][\w-]*):(\S*)$/.exec(cell);
  if (prefixed) {
    const base = prefixes[prefixed[1] ?? ""];
    if (base !== undefined) return iri(base + (prefixed[2] ?? ""));
  }
  return undefined;
}

async function queryAnswers(
  reading: Reading,
  query: string,
  stated: StatedStep,
  none: boolean,
): Promise<string | undefined> {
  const declared = new Map(
    [...query.matchAll(/PREFIX\s+([\w-]*):\s*<([^>]*)>/gi)].map(
      ([, prefix = "", base = ""]) => [prefix, base],
    ),
  );
  const prefixes = { ...PREFIXES, ...Object.fromEntries(declared) };
  const found = await reading.store.select(
    Object.entries(PREFIXES)
      .filter(([prefix]) => !declared.has(prefix))
      .map(
        ([prefix, base]) => `PREFIX ${prefix}: <${base}>
`,
      )
      .join("") + query,
  );
  const [header = [], ...rows] = none
    ? [found.variables]
    : (stated.table ?? []);
  const expected: Row[] = [];
  for (const row of rows) {
    const terms = new Map<string, Term>();
    for (const [i, variable] of header.entries()) {
      const cell = (row[i] ?? "").trim();
      if (cell === "") continue;
      terms.set(
        variable,
        cellTerm(cell, prefixes) ?? iri(await reading.words.thing(cell)),
      );
    }
    expected.push(terms);
  }
  const why = differences({ variables: header, rows: expected }, found);
  if (why === undefined) return undefined;
  return why.replace(/<([^>]+)>/g, (whole, name: string) => {
    const shown = reading.words.shown(name);
    return shown === whole ? whole : `${shown} ${whole}`;
  });
}

/**
 * Whether an entry's record holds the inputs N2 names it from: the pod's subject and its entry's start, as the rule
 * writes it. The draft's position reaches the pod only through the name, so the name checks it.
 */
async function entryInputs(
  reading: Reading,
  words: string,
  inputs: string,
): Promise<string | undefined> {
  const [subject, start, position] = inputs.split(", ");
  if (position === undefined || !/^\d+$/.test(position))
    return `"${inputs}" is no subject, start and position`;
  const record = await reading.words.record(words);
  const [first] = await selected(
    reading.store,
    `SELECT ?at WHERE { ?revision <${REC}revisionOf> <${record}> ; <${PROV}generatedAtTime> ?at .
      FILTER NOT EXISTS { ?revision <${PROV}wasRevisionOf> ?earlier } }`,
  );
  const held = [reading.person.subject, inUtc(first?.[0] ?? "")];
  const wrong = [
    ...(held[0] === subject
      ? []
      : [`its subject is ${held[0]}, not ${subject ?? ""}`]),
    ...(held[1] === start
      ? []
      : [`its entry started ${held[1]}, not ${start ?? ""}`]),
  ];
  return wrong.length === 0 ? undefined : wrong.join("; ");
}

/** The entry holding the record shows the table's fields; with `only`, nothing else but its members. */
const entryShows =
  (only: boolean) =>
  ([words]: readonly unknown[], stated: StatedStep): Check => {
    const rows = table(stated, ["field", "value"]);
    for (const row of rows)
      if (FIELDS[row.field ?? ""]?.entry === undefined)
        throw new Error(`"${row.field ?? ""}" is no field of an entry`);
    return async (reading) => {
      const record = await reading.words.record(words as string);
      const views = `${reading.replayed.story.address}${reading.layout.viewsFolder}`;
      const entries = await selected(
        reading.store,
        `SELECT DISTINCT ?view ?entry WHERE { GRAPH ?view { ?entry <${MERGED_FROM}> <${record}> } FILTER (STRSTARTS(STR(?view), "${views}")) }`,
      );
      if (entries.length !== 1)
        return `${entries.length} entries hold ${String(words)}`;
      const [[view, entry]] = entries as [[string, string]];
      const said = (
        await reading.store.select(
          `SELECT ?p ?o WHERE { GRAPH <${view}> { <${entry}> ?p ?o } }`,
        )
      ).rows.map(
        (row) => [row.get("p")?.value ?? "", row.get("o") as Term] as const,
      );
      const fields = new Set(rows.map((row) => row.field ?? ""));
      const expected: string[] = [];
      const found: string[] = [];
      for (const row of rows)
        if ((row.value ?? "") !== "")
          expected.push(
            `${row.field ?? ""} | ${await cellShown(reading, row.value ?? "", FIELDS[row.field ?? ""])}`,
          );
      for (const [predicate, value] of said) {
        if (predicate === MERGED_FROM) continue;
        const field = ENTRY_FIELDS.find(([, { predicates }]) =>
          predicates.includes(predicate),
        );
        if (field === undefined || !fields.has(field[0])) {
          if (only) found.push(`${predicate} | ${await shown(reading, value)}`);
          continue;
        }
        found.push(`${field[0]} | ${await shown(reading, value, field[1])}`);
      }
      return compared(expected, found);
    };
  };

/** A random import's or entry session's name: the one activity that step wrote matching the pattern is a v4 UUID. */
const newRandomUuid = (pattern: string) => (): Check => async (reading) => {
  const activities = valuesOf(
    await inWritten(
      reading,
      stepsOf(reading, "that step"),
      "DISTINCT ?activity",
      `GRAPH ?file { ${pattern} }`,
    ),
    "activity",
  );
  if (activities.length !== 1)
    return `the step wrote ${activities.length} of them`;
  const [name] = activities as [string];
  return UUID_V4.test(name) ? undefined : `${name} is no version 4 urn:uuid:`;
};

const viewGraph = (reading: Reading, view: unknown): string =>
  `${reading.replayed.story.address}${reading.layout.viewsFolder}${String(view)}.ttl`;

const readAfter: Act = (compiled, [said, lens]) => {
  compiled.at = {
    index: compiled.steps.lastIndexOf(named(compiled.steps, said as string)),
    lens: (lens as string | undefined) ?? "everyday",
  };
};

const DEFINITIONS: Definition[] = [
  // Given and When: what happened.
  [
    "a new pod for {person} on {time}",
    (compiled, [name, when], _stated, { people }, label) => {
      const person = people.get(name as string);
      if (person === undefined)
        throw new Error(`people.ttl names no ${String(name)}`);
      if (compiled.person !== undefined)
        throw new Error("the example has a pod already");
      compiled.person = person;
      happen(compiled, label, undefined, when as string, { kind: "creation" });
    },
  ],
  [
    "the export {name} is imported on {time}",
    (compiled, [name, when], _stated, _compiling, label) => {
      const step = label ?? (name as string);
      happen(compiled, label, name as string, when as string, {
        kind: "import",
        export: `downloads/${String(name)}/apple_health_export`,
        converted: `bridge/${step}`,
      });
    },
  ],
  [
    "the download {name} is imported on {time}",
    (compiled, [name, when], _stated, _compiling, label) => {
      const step = label ?? (name as string);
      happen(compiled, label, name as string, when as string, {
        kind: "import",
        export: `downloads/${String(name)}`,
        converted: `bridge/${step}`,
      });
    },
  ],
  [
    "{person} enters {name} on {time}",
    (compiled, [, name, when], _stated, _compiling, label) => {
      happen(compiled, label, name as string, when as string, {
        kind: "entry",
        file: `entries/${String(name)}.ttl`,
      });
    },
  ],
  [
    "{person} files the judgment {name} on {time}",
    (compiled, [, name, when], _stated, _compiling, label) => {
      happen(compiled, label, name as string, when as string, {
        kind: "judgment",
        file: `judgments/${String(name)}.ttl`,
      });
    },
  ],
  [
    "version {name} of {name} arrives on {time}",
    async (
      compiled,
      [version, series, when],
      _stated,
      { references },
      label,
    ) => {
      if (compiled.person === undefined)
        throw new Error("the example has no pod");
      const found = versionsNumbered(
        await references(compiled.person),
        series as string,
        version as string,
      );
      if (found.length !== 1)
        throw new Error(
          `references.ttl lists no version "${String(version)}" of "${String(series)}"`,
        );
      happen(compiled, label, undefined, when as string, {
        kind: "reference",
        name: found[0] ?? "",
      });
    },
  ],
  [
    "the matcher runs on the records of {step} on {time}",
    (compiled, [said, when], _stated, _compiling, label) => {
      happen(compiled, label, undefined, when as string, {
        kind: "matcher",
        takes: named(compiled.steps, said as string).name,
      });
    },
  ],
  [
    "the matcher rechecks on {time}",
    (compiled, [when], _stated, _compiling, label) => {
      happen(compiled, label ?? "recheck", undefined, when as string, {
        kind: "matcher",
      });
    },
  ],
  ["the pod is read as it stood after {step}", readAfter],
  [
    "the pod is read as it stood after {step}, under the {lens} lens",
    readAfter,
  ],
  [
    "the query is:",
    (compiled, _args, stated) => {
      if (stated.docString === undefined)
        throw new Error("the step gives no query beneath it");
      const prologue =
        /^(?:\s+|#[^\n]*|BASE\s*<[^>]*>|PREFIX\s+[\w-]*:\s*<[^>]*>)*/i;
      if (!/^SELECT\b/i.test(stated.docString.replace(prologue, "")))
        throw new Error("the query is no SELECT: an answer is rows");
      compiled.query = stated.docString;
    },
  ],

  // Then: what the pod holds.
  then("{steps} wrote {count}", ([said, count]) => async (reading) => {
    const wrong = stepsOf(reading, said as string)
      .filter(({ wrote }) => wrote.length !== count)
      .map(
        ({ step, wrote }) =>
          `${step.name} wrote ${wrote.length} files: ${wrote.join(", ")}`,
      );
    return wrong.length === 0 ? undefined : wrong.join("\n");
  }),
  then("that step is refused", () => async (reading) => {
    const [last] = stepsOf(reading, "that step");
    return last?.refused === undefined
      ? `${last?.step.name ?? "the step"} was not refused`
      : undefined;
  }),
  then(
    "the pod holds no revision",
    () =>
      async ({ store }) =>
        (await store.ask(`ASK { ?revision a <${REC}Revision> }`))
          ? "the pod holds a revision"
          : undefined,
  ),
  then(
    "no file that {steps} wrote names {record}",
    ([said, words]) =>
      async (reading) => {
        const record = await reading.words.record(words as string);
        const naming = valuesOf(
          await inWritten(
            reading,
            stepsOf(reading, said as string),
            "DISTINCT ?file",
            `GRAPH ?file { { <${record}> ?p ?o } UNION { ?s ?p <${record}> } }`,
          ),
          "file",
        );
        return naming.length === 0
          ? undefined
          : `named in ${naming.join(", ")}`;
      },
  ),
  then(
    "the pod neither names nor stores the document {name}",
    ([path]) =>
      async (reading) => {
        const file = `${reading.person.folder}/downloads/${String(path)}`;
        const bytes = await reading.vocabulary.read(file);
        if (bytes === undefined) return `${file} does not exist`;
        const name = await documentName(bytes);
        const failures: string[] = [];
        if (
          await reading.store.ask(
            `ASK { { GRAPH ?g { { <${name}> ?p ?o } UNION { ?s ?p <${name}> } } } UNION { { <${name}> ?p ?o } UNION { ?s ?p <${name}> } } }`,
          )
        )
          failures.push(`the pod names ${name}`);
        const stored = new Set(
          reading.layout.placements
            .filter(({ storesBytes }) => storesBytes)
            .map((placement) => placement.path(name)),
        );
        for (const { step, wrote } of reading.replayed.steps)
          for (const written of wrote)
            if (stored.has(written))
              failures.push(`${step.name} stored it at ${written}`);
        return failures.length === 0 ? undefined : failures.join("\n");
      },
  ),
  then("{record} has these revisions:", ([words], stated) =>
    revisionsAre(stated, words as string),
  ),
  then("the records have these revisions:", (_args, stated) =>
    revisionsAre(stated),
  ),
  then("these records have:", (_args, stated) => {
    const rows = table(stated, ["record", "field", "value"]);
    return async (reading) => {
      const expected: string[] = [];
      const found: string[] = [];
      for (const row of rows) {
        const cell = row.value ?? "";
        if (cell === "") continue;
        expected.push(
          `${row.record ?? ""} | ${row.field ?? ""} | ${await cellShown(reading, cell, recordField(row.field ?? ""))}`,
        );
      }
      const asked = new Set(
        rows.map((row) => JSON.stringify([row.record, row.field])),
      );
      for (const key of asked) {
        const [words = "", name = ""] = JSON.parse(key) as string[];
        const record = await reading.words.record(words);
        const field = recordField(name);
        if (field === undefined)
          throw new Error(`"${name}" is no field of a record`);
        const subject =
          field.of === "record"
            ? `<${record}>`
            : `<${record}> <${PAV}hasCurrentVersion> ?version . ?version`;
        const { rows: values } = await reading.store.select(
          `SELECT ?value WHERE { ${subject} ?p ?value VALUES ?p { ${field.predicates.map((p) => `<${p}>`).join(" ")} } }`,
        );
        for (const row of values) {
          const value = await shown(
            reading,
            row.get("value") as Term,
            field,
            record,
          );
          if (value !== undefined) found.push(`${words} | ${name} | ${value}`);
        }
      }
      return compared(expected, found);
    };
  }),
  then("the matcher's judgments holding {records} are:", ([words], stated) =>
    judgmentsHolding(
      words as string,
      table(stated, JUDGMENT_COLUMNS),
      JUDGMENT_COLUMNS.filter((column) => stated.table?.[0]?.includes(column)),
    ),
  ),
  then("the matcher has no judgment holding {records}", ([words]) =>
    judgmentsHolding(words as string, [], ["justification", "members"]),
  ),
  then("{step} wrote these matcher judgments:", ([said], stated) => {
    const rows = table(
      stated,
      JUDGMENT_COLUMNS.filter((column) => column !== "at"),
    );
    const columns = JUDGMENT_COLUMNS.filter((column) =>
      stated.table?.[0]?.includes(column),
    );
    return async (reading) => {
      const [step] = stepsOf(reading, said as string);
      if (step === undefined) return "no such step";
      const failures: string[] = [];
      const heldGraph = await wroteGraph(reading, [step]);
      const judgments = new Set(
        heldGraph
          .subjects(`${RDF}type`, iri(`${JDG}Judgment`))
          .map(({ value }) => value),
      );
      const found = (await matcherJudgments(reading.store)).filter(({ name }) =>
        judgments.has(name),
      );
      const allowed = new Set([
        `${RDF}type`,
        `${JDG}verdict`,
        `${JDG}justification`,
        `${PROV}wasAttributedTo`,
        `${PROV}generatedAtTime`,
        `${PROV}hadMember`,
        `${PROV}used`,
      ]);
      for (const name of judgments) {
        for (const [, p, o] of heldGraph.match(iri(name)))
          if (
            !allowed.has(p.value) ||
            (p.value === `${RDF}type` && o.value !== `${JDG}Judgment`)
          )
            failures.push(`${name} also states ${p.value} ${written(o)}`);
        const at = heldGraph
          .objects(iri(name), `${PROV}generatedAtTime`)
          .map(({ value }) => shownTime(value));
        if (at.length !== 1 || at[0] !== shownTime(step.step.when))
          failures.push(
            `${name} is made at ${at.join(", ") || "no time"}, not the step's ${step.step.when}`,
          );
        if (!found.some((judged) => judged.name === name))
          failures.push(`${name} is no Same the matcher made`);
      }
      for (const subject of heldGraph
        .subjects(`${RDF}type`)
        .concat(heldGraph.triples.map(([s]) => s))) {
        const value = subject.value;
        if (judgments.has(value)) continue;
        if (value === MATCHER) {
          const described = heldGraph
            .match(iri(MATCHER))
            .map(([, p, o]) => `${p.value} ${written(o)}`)
            .sort();
          const wanted = [
            `${RDF}type <${PROV}SoftwareAgent>`,
            `${RDFS}label "Cascade matcher"`,
          ].sort();
          if (described.join("\n") !== wanted.join("\n"))
            failures.push(
              `the matcher is described as ${described.join("; ")}`,
            );
          continue;
        }
        const isReference =
          heldGraph.match(
            iri(value),
            `${RDF}type`,
            iri(`${REC}ReferenceSeries`),
          ).length > 0 ||
          heldGraph.match(iri(value), `${PROV}specializationOf`).length > 0;
        if (!isReference) failures.push(`the step also wrote of ${value}`);
      }
      const problem = await comparedJudgments(reading, rows, found, columns);
      if (problem !== undefined) failures.push(problem);
      return failures.length === 0
        ? undefined
        : [...new Set(failures)].join("\n");
    };
  }),
  then("{step} wrote these reference descriptions:", ([said], stated) => {
    const rows = table(stated, ["reference"]);
    return async (reading) => {
      const [step] = stepsOf(reading, said as string);
      if (step === undefined) return "no such step";
      const described = valuesOf(
        await inWritten(
          reading,
          [step],
          "DISTINCT ?thing",
          `GRAPH ?file {
              { ?thing a <${REC}ReferenceSeries> } UNION { ?thing <${PROV}specializationOf> ?series }
            } FILTER NOT EXISTS { ?thing <${REC}revisionOf> ?any } FILTER (!STRSTARTS(STR(?thing), "ni:"))`,
        ),
        "thing",
      );
      const expected: string[] = [];
      for (const row of rows) {
        const name = await reading.words.reference(row.reference ?? "");
        if (name === undefined)
          return `references.ttl names no "${row.reference ?? ""}"`;
        expected.push(reading.words.shown(name));
      }
      const problem = compared(
        expected,
        described.map((thing) => reading.words.shown(thing)),
      );
      if (problem !== undefined) return problem;
      const heldTriples = (await wroteGraph(reading, [step])).triples.map(
        (triple) => triple.map(written).join(" "),
      );
      const wrong: string[] = [];
      for (const thing of described) {
        const why = compared(
          await reading.words.described(thing),
          heldTriples.filter((triple) => triple.startsWith(`<${thing}> `)),
        );
        if (why !== undefined)
          wrong.push(
            `${reading.words.shown(thing)} is not described as references.ttl does:\n${why}`,
          );
      }
      return wrong.length === 0 ? undefined : wrong.join("\n");
    };
  }),
  ...[true, false].map((counts) =>
    then(
      `{judgment} ${counts ? "counts" : "does not count"}`,
      ([words]) =>
        async (reading) => {
          const judgment = await reading.words.judgment(words as string);
          const does = await reading.store.ask(
            `ASK { <${judgment}> <${REC}counts> true }`,
          );
          if (does === counts) return undefined;
          return does ? "it counts" : "it does not count";
        },
    ),
  ),
  then("the {view} view holds these entries:", ([view], stated) => {
    const rows = table(stated, ["members"]);
    return async (reading) => {
      const expected: string[] = [];
      const held = new Set<string>();
      for (const row of rows) {
        const members = await records(reading, row.members ?? "");
        members.forEach((member) => held.add(member));
        expected.push(
          members
            .map((member) => reading.words.shown(member))
            .sort()
            .join(", "),
        );
      }
      const entries = new Map<string, string[]>();
      for (const [entry, member] of await selected(
        reading.store,
        `SELECT ?entry ?member WHERE { GRAPH <${viewGraph(reading, view)}> { ?entry <${MERGED_FROM}> ?member } }`,
      ))
        entries.set(entry ?? "", [
          ...(entries.get(entry ?? "") ?? []),
          member ?? "",
        ]);
      return compared(
        expected,
        [...entries.values()]
          .filter((members) => members.some((member) => held.has(member)))
          .map((members) =>
            members
              .map((member) => reading.words.shown(member))
              .sort()
              .join(", "),
          ),
      );
    };
  }),
  then(
    "the {view} view has no entry",
    ([view]) =>
      async (reading) =>
        (await reading.store.ask(
          `ASK { GRAPH <${viewGraph(reading, view)}> { ?entry <${MERGED_FROM}> ?member } }`,
        ))
          ? "it has an entry"
          : undefined,
  ),
  then("the entry of {record} shows:", entryShows(false)),
  then("the entry of {record} shows only:", entryShows(true)),
  then("{records} is/are in no view", ([words]) => async (reading) => {
    const shown: string[] = [];
    for (const thing of listed(words as string)) {
      const name = await reading.words.thing(thing);
      if (
        await reading.store.ask(
          `ASK { GRAPH ?view { ?entry <${MERGED_FROM}> <${name}> } }`,
        )
      )
        shown.push(thing);
    }
    return shown.length === 0 ? undefined : `in a view: ${shown.join(", ")}`;
  }),
  then("these records are in no view, for these reasons:", (_args, stated) => {
    const rows = table(stated, ["record", "reason", "because"]);
    return async (reading) => {
      const expected: string[] = [];
      const found: string[] = [];
      for (const row of rows)
        expected.push(
          `${row.record ?? ""} | ${row.reason ?? ""} | ${row.because ? reading.words.shown(await reading.words.thing(row.because)) : ""}`,
        );
      for (const words of new Set(rows.map((row) => row.record ?? ""))) {
        const record = await reading.words.record(words);
        if (
          await reading.store.ask(
            `ASK { GRAPH ?view { ?entry <${MERGED_FROM}> <${record}> } }`,
          )
        )
          found.push(`${words} is in a view`);
        for (const [why, because] of await selected(
          reading.store,
          `SELECT ?why ?because WHERE { <${record}> <${REC}leftOutFor> ?left . ?left <${REC}reason> ?why . OPTIONAL { ?left <${REC}because> ?because } }`,
        ))
          found.push(
            `${words} | ${reasonWords(why ?? "")} | ${because ? reading.words.shown(because) : ""}`,
          );
      }
      return compared(expected, found);
    };
  }),
  then("these are named:", (_args, stated) => {
    const rows = table(stated, ["thing", "inputs", "name"]);
    return async (reading) => {
      const failures: string[] = [];
      for (const row of rows) {
        if (row.inputs !== undefined && row.inputs !== "") {
          const why = await entryInputs(reading, row.thing ?? "", row.inputs);
          if (why !== undefined) {
            failures.push(`${row.thing ?? ""}: ${why}`);
            continue;
          }
        }
        const name = await reading.words.thing(row.thing ?? "");
        if (name !== row.name)
          failures.push(
            `${row.thing ?? ""} is named ${name}, not ${row.name ?? ""}`,
          );
      }
      return failures.length === 0 ? undefined : failures.join("\n");
    };
  }),
  then(
    "that step's import is named by a new random UUID",
    newRandomUuid(`?activity a <${PROV}Activity> ; <${PROV}used> ?document`),
  ),
  then(
    "that step's entry session is named by a new random UUID",
    newRandomUuid(
      `?activity a <${PROV}Activity> FILTER NOT EXISTS { ?activity <${PROV}used> ?document }`,
    ),
  ),
  ...[false, true].map((none) =>
    then(
      none ? "it answers nothing" : "it answers:",
      (_args, stated, { query }) => {
        if (query === undefined)
          throw new Error("no query comes before this step");
        return (reading) => queryAnswers(reading, query, stated, none);
      },
    ),
  ),
];

const EXPRESSIONS = DEFINITIONS.map(
  ([expression, act]) =>
    [new CucumberExpression(expression, registry), act, expression] as const,
);

const LABEL = / \(([A-Za-z0-9][\w-]*)\)$/;

/** Compiles one stated step into the example: what it says happened, where the pod is read, or what must hold. */
async function compileStep(
  compiled: Compiled,
  stated: StatedStep,
  compiling: Compiling,
): Promise<void> {
  const label = LABEL.exec(stated.text)?.[1];
  const text =
    label === undefined ? stated.text : stated.text.replace(LABEL, "");
  const matches = EXPRESSIONS.flatMap(([expression, act, source]) => {
    const args = expression.match(text);
    return args === null ? [] : [{ act, source, args }];
  });
  if (matches.length !== 1)
    throw new Error(
      matches.length === 0
        ? `no step of runtime/steps.md reads "${stated.text}"`
        : `"${stated.text}" reads as ${matches.map(({ source }) => source).join(" and as ")}`,
    );
  const [{ act, args }] = matches as [(typeof matches)[number]];
  const check = await act(
    compiled,
    await Promise.all(args.map((arg) => arg.getValue(null))),
    { ...stated, text },
    compiling,
    label,
  );
  if (check) compiled.checks.push({ text, check });
}

/** Compiles an example's steps, or a background's: whose pod it is, what happens to it, where it is read and what must hold. */
export async function compile(
  steps: readonly StatedStep[],
  compiling: Compiling,
): Promise<Compiled & { readonly person: Person }> {
  const compiled: Compiled = { steps: [], checks: [] };
  for (const step of steps) await compileStep(compiled, step, compiling);
  const { person } = compiled;
  if (person === undefined)
    throw new Error("no step creates the example's pod");
  return Object.assign(compiled, { person });
}
