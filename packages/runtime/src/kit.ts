import type { Assertion } from "./conformance.js";
import { type Files, readText } from "./files.js";
import { Graph } from "./graph.js";
import type { Layout } from "./layout.js";
import { MATCHER } from "./matcher.js";
import {
  canonical,
  contentName,
  documentName,
  earlierInUtc,
  fileStem,
  inUtc,
  recordName,
  THIS_REVISION,
  THIS_VERSION,
} from "./names.js";
import { blank, iri, RDF, type Term, type Triple, written } from "./rdf.js";
import type { Replayed } from "./replay.js";
import type { Shapes } from "./shapes.js";
import type { Dataset } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";
const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const PAV = "http://purl.org/pav/";
const MERGED_FROM = "https://ns.cascadeprotocol.org/core/v1#mergedFrom";
const TYPE = `${RDF}type`;
const ENTRY = "urn:cascade:entry:";
const DRAFT = /^urn:cascade:output-(\d+)$/;
const UUID_V4 =
  /^urn:uuid:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const OUT_OF_PLACE =
  "queries/v1-draft/questions/pod/Which files are out of place.rq";
/** The lens the final views are built under, as the kit's check 2 says. */
export const KIT_LENS = "everyday";

/** The checks of runtime/rules.md's "The conformance kit" that are not entries of a manifest, as the kit's tests. */
export const KIT_CHECKS = {
  views: "check-2-each-final-view-equals-expected",
  shapes: "check-3-every-file-conforms-to-the-shapes",
  names: "check-4-every-name-follows-its-rule",
  layout: "check-5-every-file-is-where-the-layout-says",
} as const;

/** What the kit's checks read: one replay of its story, and the pod at its last step under `everyday`. */
export interface KitRun {
  readonly vocabulary: Files;
  /** The kit's folder in the vocabulary, as `conformance/<name>`. */
  readonly kit: string;
  /** The folder its story's steps name their files under. */
  readonly folder: string;
  readonly replayed: Replayed;
  /** The pod after the story's last step, as an example's dataset holds it. */
  readonly final: Dataset;
  readonly layout: Layout;
  readonly shapes: Shapes;
}

const failure = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const checkTest = (vocabulary: Files, kit: string, check: string) => ({
  test: `${vocabulary.iri}${kit}/#${check}`,
  name: check,
});

const base = (term: Term): string => term.value.split("#")[0] ?? "";

/** Every file of the pod that the dataset holds, written by a step or built, as its triples by its path. */
async function podFiles(
  store: Dataset,
  address: string,
): Promise<Map<string, Triple[]>> {
  const { rows } = await store.select(`SELECT ?g ?s ?p ?o WHERE {
      GRAPH ?g { ?s ?p ?o } FILTER (STRSTARTS(STR(?g), "${address}")) }`);
  const files = new Map<string, Triple[]>();
  for (const row of rows) {
    const path = (row.get("g")?.value ?? "").slice(address.length);
    const triple = [row.get("s"), row.get("p"), row.get("o")] as Triple;
    files.set(path, [...(files.get(path) ?? []), triple]);
  }
  return files;
}

/** Check 2: a view's entries with what they state, each entry IRI a blank node. */
function entriesOf(triples: readonly Triple[]): Triple[] {
  const kept = new Set(
    triples.filter(([, p]) => p.value === MERGED_FROM).map(([s]) => written(s)),
  );
  const node = (term: Term): Term =>
    term.termType === "NamedNode" && term.value.startsWith(ENTRY)
      ? blank(term.value.slice(ENTRY.length))
      : term;
  return triples
    .filter(([s]) => kept.has(written(s)))
    .map(([s, p, o]) => [node(s), p, node(o)] as unknown as Triple);
}

/** Each entry by its members, with the statements it makes, the entry itself left out. */
function byMembers(triples: readonly Triple[]): Map<string, Set<string>> {
  const graph = new Graph(triples);
  const found = new Map<string, Set<string>>();
  for (const entry of graph.subjects(MERGED_FROM)) {
    const members = graph
      .objects(entry, MERGED_FROM)
      .map(written)
      .sort()
      .join(" ");
    found.set(
      members,
      new Set(
        graph
          .match(entry)
          .map(
            ([, p, o]) =>
              `${written(p)} ${o.termType === "BlankNode" ? "[]" : written(o)}`,
          ),
      ),
    );
  }
  return found;
}

function entryDifferences(
  expected: readonly Triple[],
  found: readonly Triple[],
): string[] {
  const [wanted, got] = [byMembers(expected), byMembers(found)];
  const lines: string[] = [];
  for (const members of [
    ...new Set([...wanted.keys(), ...got.keys()]),
  ].sort()) {
    const [a, b] = [wanted.get(members), got.get(members)];
    if (b === undefined) lines.push(`  the entry of ${members} is missing`);
    else if (a === undefined)
      lines.push(`  the entry of ${members} should not be there`);
    else {
      const missing = [...a].filter((s) => !b.has(s));
      const extra = [...b].filter((s) => !a.has(s));
      if (missing.length + extra.length > 0)
        lines.push(
          `  the entry of ${members}:`,
          ...missing.map((s) => `    lacks ${s}`),
          ...extra.map((s) => `    should not state ${s}`),
        );
    }
  }
  return lines.length > 0
    ? lines
    : ["  the entries differ in the blank nodes they lead to"];
}

async function viewsEqualExpected(
  run: KitRun,
  pod: ReadonlyMap<string, Triple[]>,
): Promise<string[]> {
  const { vocabulary, kit, replayed, final, layout } = run;
  const failures: string[] = [];
  const expectedFiles = (await vocabulary.list(`${kit}/expected`)).filter(
    (path) => path.endsWith(".ttl"),
  );
  if (expectedFiles.length === 0)
    return [`${kit}/expected/ holds no view to compare`];
  for (const path of expectedFiles) {
    const view = `${layout.viewsFolder}${path.slice(path.lastIndexOf("/") + 1)}`;
    const expected = await final.parse(
      await readText(vocabulary, path),
      vocabulary.iri + path,
    );
    const found = entriesOf(pod.get(view) ?? []);
    if ((await canonical(expected)) !== (await canonical(found)))
      failures.push(
        `${replayed.story.address}${view} is not ${path}:`,
        ...entryDifferences(expected, found),
      );
  }
  return failures;
}

/** Check 3: every RDF file but those that name things only to label them, read together with the vocabulary's terms. */
async function conformsToShapes(
  run: KitRun,
  pod: ReadonlyMap<string, Triple[]>,
): Promise<string[]> {
  const labelled = new Set(
    run.layout.built
      .filter(({ kind }) => kind === undefined)
      .map(({ file }) => file),
  );
  const triples = [...pod]
    .filter(([path]) => !labelled.has(path))
    .flatMap(([, held]) => held);
  return run.shapes.violations(triples);
}

/** A file's triples, with the thing named `name`, and every IRI under it, renamed to the placeholder. */
function placeheld(
  triples: readonly Triple[],
  name: string,
  placeholder: string,
): Triple[] {
  const swap = (term: Term): Term =>
    term.termType === "NamedNode" && base(term) === name
      ? iri(placeholder + term.value.slice(name.length))
      : term;
  return triples.map(([s, p, o]) => [swap(s), p, swap(o)] as unknown as Triple);
}

interface Written {
  /** Each RDF file a step wrote, by its path. */
  readonly files: ReadonlyMap<string, Triple[]>;
  readonly whole: Graph;
  /** The step that wrote each file, by its path. */
  readonly by: ReadonlyMap<string, ReplayedStep>;
}

type ReplayedStep = Replayed["steps"][number];

async function inputGraph(
  run: KitRun,
  path: string,
): Promise<Graph | undefined> {
  const bytes = await run.vocabulary.read(path);
  return bytes === undefined
    ? undefined
    : new Graph(await run.final.parse(bytes, run.vocabulary.iri + path));
}

/** Check 4: N1 to N7, N9 and N10, and A9 and A11, from the run's own inputs. */
async function namesFollowTheirRules(
  run: KitRun,
  held: Written,
): Promise<string[]> {
  const { replayed, vocabulary, kit, folder, layout } = run;
  const { story } = replayed;
  const { files, whole, by } = held;
  const failures: string[] = [];
  const at = (path: string): string => `${folder}/${path}`;
  const activityOf = new Map(
    replayed.steps.flatMap(({ step, activity }) =>
      activity === undefined ? [] : [[step.name, activity] as const],
    ),
  );

  // N1, N2: each record is named by the Bridge, or from an entry by the record rule.
  const expectedRecords = new Set<string>();
  for (const { name, when, happened } of story.steps) {
    if (happened.kind === "import") {
      for (const path of await vocabulary.list(at(happened.converted))) {
        if (!path.endsWith("/graph.ttl")) continue;
        const graph = await inputGraph(run, path);
        for (const record of graph?.subjects(TYPE, iri(`${REC}Record`)) ?? [])
          expectedRecords.add(record.value);
        for (const [, p, o] of graph?.triples ?? [])
          if (p.value === `${PROV}specializationOf`)
            expectedRecords.add(o.value);
      }
    }
    if (happened.kind === "entry") {
      const graph = await inputGraph(run, at(happened.file));
      const drafts = new Set(
        (graph?.triples ?? []).flatMap((triple) =>
          triple.flatMap((term) => DRAFT.exec(term.value)?.[1] ?? []),
        ),
      );
      for (const position of drafts)
        expectedRecords.add(
          await recordName([story.subject, inUtc(when), position]),
        );
      if (drafts.size === 0) failures.push(`entry ${name} holds no draft`);
    }
  }
  const records = new Set(
    whole.triples
      .filter(([, p]) => p.value === `${REC}revisionOf`)
      .map(([, , o]) => o.value),
  );
  for (const record of records)
    if (!expectedRecords.has(record))
      failures.push(`N1/N2: ${record} is named by no input`);
  for (const record of expectedRecords)
    if (!records.has(record))
      failures.push(`N1/N2: ${record}, which the inputs name, has no revision`);

  // N3, N4: each version and each revision is named from its own triples; a revision follows an earlier one of its record.
  let named = 0;
  for (const [path, triples] of files) {
    const graph = new Graph(triples);
    const versions = path.startsWith("records/")
      ? graph.subjects(`${PROV}specializationOf`)
      : [];
    for (const version of versions) {
      named++;
      if (
        (await contentName(placeheld(triples, version.value, THIS_VERSION))) !==
        version.value
      )
        failures.push(
          `N3: ${version.value} in ${path} is not named from its content`,
        );
    }
    for (const revision of graph.subjects(TYPE, iri(`${REC}Revision`))) {
      named++;
      if (
        (await contentName(
          placeheld(triples, revision.value, THIS_REVISION),
        )) !== revision.value
      )
        failures.push(
          `N4: ${revision.value} in ${path} is not named from its triples`,
        );
      const step = by.get(path);
      const made =
        step === undefined ? undefined : activityOf.get(step.step.name);
      const generatedBy = graph
        .objects(revision, `${PROV}wasGeneratedBy`)
        .map((t) => t.value);
      if (made === undefined || generatedBy.join() !== made)
        failures.push(
          `N4: ${revision.value} is generated by ${generatedBy.join(", ")}, not by the activity its step made`,
        );
      const record = graph.objects(revision, `${REC}revisionOf`)[0];
      const time = graph.objects(revision, `${PROV}generatedAtTime`)[0];
      for (const earlier of graph.objects(revision, `${PROV}wasRevisionOf`)) {
        const earlierRecord = whole.objects(earlier, `${REC}revisionOf`)[0];
        const earlierTime = whole.objects(earlier, `${PROV}generatedAtTime`)[0];
        if (
          record === undefined ||
          earlierRecord?.value !== record.value ||
          time === undefined ||
          earlierTime === undefined ||
          !earlierInUtc(earlierTime.value, time.value)
        )
          failures.push(
            `N4: ${revision.value} follows ${earlier.value}, which is no earlier revision of its record`,
          );
      }
    }
  }
  if (named === 0)
    failures.push("N3/N4: the pod holds no version and no revision");

  // N5: each stored document is named by its bytes, and described.
  for (const [path, step] of by) {
    if (layout.isRdf(path)) continue;
    const bytes = await replayed.pod.read(path);
    const name = bytes === undefined ? "" : await documentName(bytes);
    if (bytes === undefined || !path.endsWith(`/${fileStem(name)}`))
      failures.push(
        `N5: ${path}, which ${step.step.name} wrote, is not named by its bytes`,
      );
    else if (whole.match(iri(name), TYPE, iri(`${PROV}Entity`)).length === 0)
      failures.push(`N5: ${name}, stored at ${path}, is not described`);
  }

  // N6: each matcher judgment is named by the record rule from what it judged and used.
  const judged = whole.subjects(`${PROV}wasAttributedTo`, iri(MATCHER));
  for (const judgment of judged) {
    const sorted = (predicate: string): string[] =>
      whole
        .objects(judgment, predicate)
        .map((t) => t.value)
        .sort();
    const name = await recordName([
      MATCHER,
      ...whole.objects(judgment, `${JDG}justification`).map((t) => t.value),
      ...sorted(`${PROV}hadMember`),
      ...sorted(`${PROV}used`),
    ]);
    if (name !== judgment.value)
      failures.push(
        `N6: ${judgment.value} is not named from its members and what it used`,
      );
  }

  // N7: each import and entry session is a new version 4 UUID that no input gives.
  const given = await everyInput(vocabulary, kit);
  const made = story.steps.filter(
    ({ name, happened }) =>
      (happened.kind === "import" || happened.kind === "entry") &&
      replayed.steps.some(
        (done) => done.step.name === name && done.wrote.length > 0,
      ),
  );
  for (const { name } of made) {
    const activity = activityOf.get(name);
    const uuid =
      activity === undefined ? undefined : UUID_V4.exec(activity)?.[1];
    if (uuid === undefined)
      failures.push(
        `N7: step ${name} made ${activity ?? "nothing"}, not a version 4 UUID`,
      );
    else if (given.includes(uuid))
      failures.push(`N7: step ${name}'s ${activity} is given by an input`);
  }
  if (new Set(activityOf.values()).size !== activityOf.size)
    failures.push("N7: two steps made one activity");

  // N9: each file is named from the thing it holds, in the fan-out its folder gives.
  for (const [path, triples] of files) {
    const placement = layout.placements
      .filter(({ folder }) => folder !== undefined && path.startsWith(folder))
      .sort((a, b) => (b.folder?.length ?? 0) - (a.folder?.length ?? 0))[0];
    if (placement === undefined) continue;
    const things = new Set(
      triples.flatMap(([s]) => (s.termType === "NamedNode" ? [base(s)] : [])),
    );
    if (
      ![...things].some((thing) => {
        try {
          return placement.path(thing) === path;
        } catch {
          return false;
        }
      })
    )
      failures.push(`N9: ${path} is named for nothing it holds`);
  }

  // N10: each person's judgment keeps the IRI its input gives it.
  for (const { name, happened } of story.steps) {
    if (happened.kind !== "judgment") continue;
    const input = await inputGraph(run, at(happened.file));
    for (const judgment of input?.subjects(TYPE, iri(`${JDG}Judgment`)) ?? []) {
      const wrote = [...by]
        .filter(([, step]) => step.step.name === name)
        .map(([path]) => path);
      if (
        !wrote.some((path) =>
          files.get(path)?.some(([s]) => s.value === judgment.value),
        )
      )
        failures.push(`N10: step ${name} files no ${judgment.value}`);
    }
  }

  // A9, A11: each saved Bridge output is in the pod less its arrivals, with the import its step wrote.
  const stored = new Set(
    [...by.keys()]
      .filter((path) => !layout.isRdf(path))
      .map((path) => path.slice(path.lastIndexOf("/") + 1)),
  );
  const named9 = new Set(
    whole.triples.flatMap((triple) => triple.map((t) => t.value)),
  );
  /** The record's revisions written before the moment, latest last. */
  const revisionsBefore = (record: Term, moment: string): Term[] =>
    whole
      .subjects(`${REC}revisionOf`, record)
      .map((r) => [r, whole.objects(r, `${PROV}generatedAtTime`)[0]] as const)
      .filter(
        ([, t]) => t !== undefined && Date.parse(t.value) < Date.parse(moment),
      )
      .sort(
        ([, a], [, b]) =>
          Date.parse(a?.value ?? "") - Date.parse(b?.value ?? ""),
      )
      .map(([r]) => r);
  for (const { name, when, happened } of story.steps) {
    if (happened.kind !== "import") continue;
    const thisImport = activityOf.get(name);
    for (const path of await vocabulary.list(at(happened.converted))) {
      if (!path.endsWith("/graph.ttl")) continue;
      const graph = (await inputGraph(run, path)) ?? new Graph([]);
      const [document] = graph.subjects(TYPE, iri(`${PROV}Entity`));
      if (document === undefined) {
        failures.push(`A9: ${path} describes no document`);
        continue;
      }
      if (!stored.has(fileStem(document.value))) {
        if (named9.has(document.value))
          failures.push(
            `A11: ${document.value} is not kept, yet the pod names it`,
          );
        continue;
      }
      const [activity] = graph.subjects(`${PROV}used`, document);
      if (activity === undefined || thisImport === undefined) {
        failures.push(
          `A11: ${path} names no import, or step ${name} made none`,
        );
        continue;
      }
      const arrivals = new Set(
        graph.subjects(`${BRIDGE}arrivedAs`).map(written),
      );
      const swap = (term: Term): Term =>
        written(term) === written(activity) ? iri(thisImport) : term;
      const expected = graph.triples
        .filter(([s]) => !arrivals.has(written(s)))
        .map(([s, p, o]) => [swap(s), p, swap(o)] as unknown as Triple);
      const found: Triple[] = [];
      for (const subject of new Set(
        expected.flatMap(([s]) =>
          s.termType === "NamedNode" ? [s.value] : [],
        ),
      )) {
        for (const triple of whole.match(iri(subject))) {
          const [, p, o] = triple;
          if (
            subject === thisImport &&
            p.value === `${PROV}used` &&
            o.value !== document.value
          )
            continue;
          found.push(
            triple,
            ...(o.termType === "BlankNode" ? whole.closure(o) : []),
          );
        }
      }
      if ((await canonical(expected)) !== (await canonical(found)))
        failures.push(
          `A9/A11: the pod does not hold ${path} less its arrivals, with step ${name}'s import`,
        );
      for (const arrival of graph.subjects(`${BRIDGE}arrivedAs`)) {
        const version = graph.objects(arrival, `${BRIDGE}arrivedAs`)[0];
        const statements = graph
          .match(arrival)
          .filter(
            ([, p]) =>
              p.value !== `${BRIDGE}arrivedAs` &&
              p.value !== `${PROV}wasGeneratedBy`,
          );
        const revisions = whole
          .subjects(`${REC}version`, version)
          .filter(
            (r) => whole.match(r, `${PROV}wasDerivedFrom`, document).length > 0,
          );
        if (revisions.length === 0 && version !== undefined) {
          const record = graph.objects(version, `${PROV}specializationOf`)[0];
          const earlier =
            record === undefined ? [] : revisionsBefore(record, when);
          const current = earlier.at(-1);
          const sourceVersion = graph.objects(arrival, `${PAV}version`)[0];
          if (
            (current !== undefined &&
              whole.match(current, `${REC}version`, version).length > 0) ||
            (sourceVersion !== undefined &&
              earlier.some(
                (r) =>
                  whole.match(r, `${PAV}version`, sourceVersion).length > 0,
              ))
          )
            continue;
        }
        const held = new Set(
          revisions.flatMap((r) =>
            whole.match(r).map(([, p, o]) => `${written(p)} ${written(o)}`),
          ),
        );
        if (
          revisions.length !== 1 ||
          statements.some(
            ([, p, o]) => !held.has(`${written(p)} ${written(o)}`),
          )
        )
          failures.push(
            `A9: the revision of ${version?.value ?? "an arrival"} from ${document.value} does not hold its arrival's statements`,
          );
      }
    }
  }
  return failures;
}

/** Every text file of the kit, which a run's random IDs must not come from. */
async function everyInput(vocabulary: Files, kit: string): Promise<string> {
  const texts: string[] = [];
  for (const path of await vocabulary.list(kit))
    if (/\.(json|ttl|rq|xml|feature)$/.test(path))
      texts.push(await readText(vocabulary, path));
  return texts.join("\n");
}

/** Check 5: no file the runtime wrote is out of place, by the vocabulary's question and, for stored documents, by path. */
async function whereTheLayoutSays(
  run: KitRun,
  by: ReadonlyMap<string, ReplayedStep>,
): Promise<string[]> {
  const query = await readText(run.vocabulary, OUT_OF_PLACE);
  const { rows } = await run.final.select(query);
  const failures = rows.map(
    (row) =>
      `${row.get("file")?.value} holds ${row.get("thing")?.value}, which the layout files at ${row.get("place")?.value}`,
  );
  const stores = run.layout.placements.filter(({ storesBytes }) => storesBytes);
  for (const path of by.keys()) {
    if (run.layout.isRdf(path)) continue;
    const bytes = await run.replayed.pod.read(path);
    const name = bytes === undefined ? undefined : await documentName(bytes);
    if (
      name === undefined ||
      !stores.some((placement) => placement.path(name) === path)
    )
      failures.push(`${path} is no stored document's place`);
  }
  return failures;
}

/** Checks 2 to 5 of the kit, each one assertion, named under the kit's folder. */
export async function kitChecks(run: KitRun): Promise<Assertion[]> {
  const address = run.replayed.story.address;
  const pod = await podFiles(run.final, address);
  const by = new Map<string, ReplayedStep>();
  for (const step of run.replayed.steps)
    for (const path of step.wrote) by.set(path, step);
  const files = new Map(
    [...pod].filter(([path]) => by.has(path) && run.layout.isRdf(path)),
  );
  const held: Written = {
    files,
    whole: new Graph([...files.values()].flat()),
    by,
  };
  const checks: [string, () => Promise<string[]>][] = [
    [KIT_CHECKS.views, () => viewsEqualExpected(run, pod)],
    [KIT_CHECKS.shapes, () => conformsToShapes(run, pod)],
    [KIT_CHECKS.names, () => namesFollowTheirRules(run, held)],
    [KIT_CHECKS.layout, () => whereTheLayoutSays(run, by)],
  ];
  const assertions: Assertion[] = [];
  for (const [check, made] of checks) {
    const test = checkTest(run.vocabulary, run.kit, check);
    try {
      const failures = await made();
      assertions.push(
        failures.length === 0
          ? { ...test, outcome: "passed" }
          : { ...test, outcome: "failed", why: failures.join("\n") },
      );
    } catch (error) {
      assertions.push({ ...test, outcome: "failed", why: failure(error) });
    }
  }
  return assertions;
}

const KIT_STORY = /^conformance\/([^/]+)\/([^/]+)\.feature$/;

/** Whether the feature file is a kit's: `conformance/<name>/<name>.feature`, whose Background is the kit's story. */
export function isKitStory(path: string): boolean {
  const found = KIT_STORY.exec(path);
  return found !== null && found[1] === found[2];
}

/** Every kit of the vocabulary: each folder `conformance/<name>/` holding `<name>.feature`. */
export async function kitsOf(vocabulary: Files): Promise<string[]> {
  return (await vocabulary.list("conformance"))
    .filter(isKitStory)
    .map((path) => path.slice(0, path.lastIndexOf("/")));
}
