import { createHash } from "node:crypto";
import { loadDataset, pullOf } from "../perf-data.js";
import { type Context } from "../perf-context.js";
import {
  type Job,
  maybeProbed,
  type Measured,
  measured,
  nameOf,
  openedAt,
  partsOf,
  samplesOf,
  secs,
  stepper,
  type TraceNote,
} from "../perf-job.js";
import { type Scenario } from "../perf-plan.js";
import { clockRow, countRow, outputRow, type Row } from "../perf-rows.js";
import { phaseRows } from "./fresh-first-screen.js";
import { PAGE_SIZE } from "./question-page.js";
import { classified, podFiles, type StoredKind } from "./stored.js";

/** How many source entries the changed document differs from the first one in. */
export const CHANGED_ENTRIES = 10;

/** How the document that is imported again differs from the first one: not at all, in some entries, or by one more. */
export type Again = "identical" | "changed" | "added";

/** The scenario each kind of second document is. */
export const SCENARIO_OF: Readonly<Record<Again, Scenario>> = {
  identical: "reimport-identical",
  changed: "reimport-changed",
  added: "add-one-record",
};

/** The question asked straight after the import, a first page of it: the lab results, which are most of a record. */
export const FIRST_ANSWER = "pod/My lab results";

/** A document edited from the one the first import took in, and what was edited. */
export interface Edited {
  readonly bundle: object;
  /** The source entries whose content was changed. */
  readonly changed: number;
  /** The source entries added. */
  readonly added: number;
  /** What was done to the document, in a sentence. */
  readonly says: string;
}

interface Resource {
  resourceType: string;
  id: string;
  category?: { coding?: { code?: string }[] }[];
  meta?: { versionId?: string; lastUpdated?: string };
  valueQuantity?: { value?: unknown };
  effectiveDateTime?: string;
  issued?: string;
}
interface BundleEntry {
  fullUrl: string;
  resource: Resource;
}
interface Bundle {
  entry: BundleEntry[];
}

const DAY = 86_400_000;

/** A date or date and time a day later, in the form it was written in: only its date moves. */
const nextDay = (text: string): string =>
  text.replace(/^\d{4}-\d{2}-\d{2}/, (date) =>
    new Date(Date.parse(date) + DAY).toISOString().slice(0, 10),
  );

/**
 * The entries that are a laboratory Observation with a number to change, by position in the Bundle: the ones the pod keeps as
 * lab results. Its vital signs carry numbers too, and are not kept as records yet, so changing one would change no record.
 */
const numbered = (bundle: Bundle): number[] =>
  bundle.entry.flatMap(({ resource }, at) =>
    resource.resourceType === "Observation" &&
    typeof resource.valueQuantity?.value === "number" &&
    (resource.category ?? []).some(({ coding = [] }) =>
      coding.some(({ code }) => code === "laboratory"),
    )
      ? [at]
      : [],
  );

/**
 * The Bundle with `count` of the laboratory Observations that carry a number changed, picked evenly through it (the first of them and
 * then every `floor(n / count)`th by position among those): each one's `valueQuantity.value` is 1 higher and, where it has
 * them, its `meta.versionId` one higher and its `meta.lastUpdated` a day later. These are what the fhir-r4 adapter maps (a
 * lab result's value, and the version and time the source gave it), so each is a new version of its record and a new
 * revision. The Bundle given is not touched; nothing else of the copy differs.
 */
export function changedBundle(bundle: object, count = CHANGED_ENTRIES): Edited {
  const eligible = numbered(bundle as Bundle);
  if (eligible.length < count)
    throw new Error(
      `the Bundle has fewer than ${count} laboratory Observations that carry a number to change (${eligible.length})`,
    );
  const copy = structuredClone(bundle) as Bundle;
  for (let at = 0; at < count; at++) {
    const entry = copy.entry[
      eligible[Math.floor((at * eligible.length) / count)] as number
    ] as BundleEntry;
    const { resource } = entry;
    const quantity = resource.valueQuantity as { value: number };
    quantity.value = Math.round((quantity.value + 1) * 1e6) / 1e6;
    if (resource.meta?.versionId !== undefined) {
      const next = Number(resource.meta.versionId) + 1;
      resource.meta.versionId = String(Number.isNaN(next) ? 2 : next);
    }
    if (resource.meta?.lastUpdated !== undefined)
      resource.meta.lastUpdated = nextDay(resource.meta.lastUpdated);
  }
  return {
    bundle: copy,
    changed: count,
    added: 0,
    says: `Changed ${count} of the ${eligible.length} laboratory Observations that carry a number, picked evenly through the Bundle (the first of them, then every ${Math.floor(eligible.length / count)}th): each one's valueQuantity.value is 1 higher and, where it has them, its meta.versionId one higher and its meta.lastUpdated a day later. Nothing else in the Bundle changed.`,
  };
}

/** A new id for the copy of a resource: another UUID where the id is one, else the id and a suffix. */
function newId(id: string, taken: ReadonlySet<string>): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let made: string;
  if (uuid.test(id)) {
    const hex = createHash("sha256").update(`one more ${id}`).digest("hex");
    made = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  } else made = `${id}-more`;
  while (taken.has(made)) made = `${made}-more`;
  return made;
}

/**
 * The Bundle with one more entry at its end: a copy of the last laboratory Observation that carries a number, with a new id and its
 * dates (`effectiveDateTime`, `issued`, `meta.lastUpdated`) a day later. The Bundle given is not touched.
 */
export function oneMoreBundle(bundle: object): Edited {
  const given = bundle as Bundle;
  const last = numbered(given).at(-1);
  if (last === undefined)
    throw new Error(
      "the Bundle has no laboratory Observation that carries a number",
    );
  const copy = structuredClone(given.entry[last]) as BundleEntry;
  const was = copy.resource.id;
  const id = newId(
    was,
    new Set(given.entry.map(({ resource }) => resource.id)),
  );
  copy.resource.id = id;
  copy.fullUrl = copy.fullUrl.includes(was)
    ? copy.fullUrl.replace(was, id)
    : `${copy.fullUrl}-more`;
  if (copy.resource.effectiveDateTime !== undefined)
    copy.resource.effectiveDateTime = nextDay(copy.resource.effectiveDateTime);
  if (copy.resource.issued !== undefined)
    copy.resource.issued = nextDay(copy.resource.issued);
  if (copy.resource.meta?.lastUpdated !== undefined)
    copy.resource.meta.lastUpdated = nextDay(copy.resource.meta.lastUpdated);
  return {
    bundle: { ...given, entry: [...given.entry, copy] },
    changed: 0,
    added: 1,
    says: "Added one Observation at the end of the Bundle: a copy of the last laboratory Observation that carries a number, with a new id and its dates a day later. Nothing else in the Bundle changed.",
  };
}

/** The document of a job: the first one again, with some of it changed, or with one entry more. */
export function againBundle(bundle: object, again: Again): Edited {
  return again === "changed"
    ? changedBundle(bundle)
    : again === "added"
      ? oneMoreBundle(bundle)
      : {
          bundle,
          changed: 0,
          added: 0,
          says: "The same Bundle again, byte for byte.",
        };
}

/** What an import into a pod that held the record already added, counted from the files it wrote. */
export interface Added {
  /** The files the import wrote. */
  readonly files: number;
  /** The statements of the files it wrote, those of the views it rebuilt not counted: they replace what the views held. */
  readonly statements: number;
  readonly versions: number;
  readonly revisions: number;
  /** The records of the pod it named for the first time. */
  readonly records: number;
  /** How many times the document was converted: 0 where its hash showed the pod held it already. */
  readonly converts: number;
  readonly changed: number;
  readonly entriesAdded: number;
  readonly says: string;
  /** The files and statements it wrote, by kind of file. */
  readonly kinds: Readonly<
    Partial<Record<StoredKind, { files: number; statements: number }>>
  >;
}

/** The files `wrote` names in the pod in `folder` (read once the pod is closed), by what each is. */
export async function countWritten(
  folder: string,
  encrypted: boolean,
  wrote: readonly string[],
): Promise<
  Pick<
    Added,
    "files" | "statements" | "versions" | "revisions" | "records" | "kinds"
  >
> {
  const { files, layout } = await podFiles(folder, encrypted);
  const kinds: Partial<
    Record<StoredKind, { files: number; statements: number }>
  > = {};
  let records = 0;
  for (const path of wrote) {
    const bytes = await files.read(path);
    if (bytes === undefined) continue;
    const found = classified(layout, path, bytes);
    const held = (kinds[found.kind] ??= { files: 0, statements: 0 });
    held.files += 1;
    held.statements += found.statements;
    if (found.podRecord) records += 1;
  }
  return {
    files: wrote.length,
    statements: Object.entries(kinds).reduce(
      (sum, [kind, each]) => sum + (kind === "views" ? 0 : each.statements),
      0,
    ),
    versions: kinds.versions?.files ?? 0,
    revisions: kinds.revisions?.files ?? 0,
    records,
    kinds,
  };
}

/**
 * A pod that already holds the record takes in a document again (the same, with some entries changed, or with one more),
 * answers a first page of the lab results, and closes. The document comes from the record the harness loads in this
 * process and is dropped before the pod opens, as the first import's is.
 */
export async function measureAgain(job: Job): Promise<Measured> {
  const again = job.again;
  if (again === undefined) throw new Error("an `again` job says which one");
  const { seconds, step } = stepper();
  const notes: TraceNote[] = [];
  const taken = await (async () => {
    const data = await loadDataset(job.dataset);
    const { bundle, ...edited } = againBundle(data.bundle, again);
    return {
      pull: pullOf(data, bundle) as ReadonlyMap<string, Uint8Array> | undefined,
      said: edited,
    };
  })();
  const said = taken.said;
  let pull = taken.pull;
  let pod: Awaited<ReturnType<typeof openedAt>> | undefined;
  let wrote: readonly string[] = [];
  let parts: Record<string, number> = {};
  let converts = 0;
  const body = await maybeProbed(job, SCENARIO_OF[again], notes, async () => {
    pod = await step("open", () => openedAt(job.folder, job.encrypted));
    const opened = pod;
    const marks: { part: string; at: number }[] = [];
    const done = await step("import", () =>
      opened.import(pull as ReadonlyMap<string, Uint8Array>, {
        claimProfiles: job.claim,
        onProgress: ({ part: named }) => {
          marks.push({ part: named, at: performance.now() });
        },
      }),
    );
    pull = undefined;
    if (done.refused !== undefined)
      throw new Error(`the import was refused: ${done.refused}`);
    wrote = done.wrote;
    parts = partsOf(marks, performance.now());
    converts = marks.filter(({ part: named }) => named === "converting").length;
    await step("first-answer", () =>
      opened.askPage(FIRST_ANSWER, { size: PAGE_SIZE }),
    );
  });
  const rssBytes = process.memoryUsage.rss();
  await step("close", () => (pod as NonNullable<typeof pod>).close());
  const counted = await countWritten(job.folder, job.encrypted, wrote);
  return {
    ...measured({
      seconds,
      parts,
      rssBytes,
      wrote: wrote.length,
      seen: body.seen,
      notes,
    }),
    added: {
      ...counted,
      converts,
      changed: said.changed,
      entriesAdded: said.added,
      says: said.says,
    },
  };
}

/** The rows of one of the jobs that import a document again: its times, its parts and what it wrote. */
export function againRows(
  ctx: Context,
  scenario: Scenario,
  runs: readonly Measured[],
): Row[] {
  const name = nameOf(scenario, ctx.dataset, ctx.encrypted);
  const { how, about } = ctx;
  const from = (pick: (each: Measured) => number | undefined) =>
    samplesOf(runs, pick);
  const rows: Row[] = [
    clockRow(
      `${name}/total`,
      "s",
      runs.map((each) => secs(each, "open", "import", "first-answer")),
      `open + import + first answer; ${how}`,
    ),
    clockRow(
      `${name}/open`,
      "s",
      from((each) => each.seconds.open),
      how,
    ),
    clockRow(
      `${name}/import`,
      "s",
      from((each) => each.seconds.import),
      how,
    ),
    clockRow(
      `${name}/first-answer`,
      "s",
      from((each) => each.seconds["first-answer"]),
      `${FIRST_ANSWER}, a first page of ${PAGE_SIZE}; ${how}`,
    ),
    clockRow(
      `${name}/close`,
      "s",
      from((each) => each.seconds.close),
      how,
    ),
    clockRow(
      `${name}/rss`,
      "By",
      from((each) => each.rssBytes),
      `after the first answer, before close; ${how}`,
    ),
    clockRow(
      `${name}/peak-rss`,
      "By",
      from((each) => each.peakRssBytes),
      how,
    ),
    ...phaseRows(ctx, name, runs),
  ];
  const added = runs[0]?.added;
  if (added === undefined) return rows;
  const wrote = runs[0]?.wrote ?? added.files;
  rows.push(
    countRow(`${name}/count/files-written`, wrote, about),
    countRow(`${name}/count/converts`, added.converts, about),
    outputRow(`${name}/count/statements-added`, added.statements, about),
    outputRow(`${name}/count/versions-added`, added.versions, about),
    outputRow(`${name}/count/revisions-added`, added.revisions, about),
    outputRow(`${name}/count/records-added`, added.records, about),
    ...(scenario === "reimport-changed"
      ? [outputRow(`${name}/count/entries-changed`, added.changed, added.says)]
      : []),
    ...(scenario === "add-one-record"
      ? [
          outputRow(
            `${name}/count/entries-added`,
            added.entriesAdded,
            added.says,
          ),
        ]
      : []),
  );
  return rows;
}
