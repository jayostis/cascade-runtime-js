// What a pod holds, read from the rows of the `stored` scenario (packages/cascade-runtime/test/perf-scenarios/stored.ts): the files,
// statements and bytes of each kind of file the pod's layout names, grouped as the source's own data, history, bookkeeping and
// derived copies, in words for the pull request comment, the job summary, /perf/ and /perf/runs/. The kinds, their classes and
// the rule that gives them one are the glossary's (`storedKinds`, `storedClasses`, `storedRule`); this file only reads and
// words them. It sets no bound on any count and says nothing about one being too many.

import { readGlossary } from "./perf-glossary.mjs";

/** The rows of the stored scenario, whatever their group. */
export const STORED_ROW =
  /^stored-[^/]+\/(?:files|statements|bytes|predicates|database|count)\//;

/** The key of a pod's rows (`stored-<size>[-encrypted]`), for each pod a file counted, in the order its rows come. */
export function storedKeys(file) {
  return [
    ...new Set(
      (file.results ?? []).flatMap(({ name }) =>
        STORED_ROW.test(name ?? "") ? name.slice(0, name.indexOf("/")) : [],
      ),
    ),
  ];
}

const MEGABYTE = 1048576;

/** The name of a class of kinds as a table says it. */
export const CLASS_LABEL = {
  data: "The source's own data",
  history: "History",
  bookkeeping: "Bookkeeping",
  derived: "Derived: rebuildable copies",
};

/**
 * What a file says of one pod it counted (`key`): the kinds the pod holds, those kinds grouped by class, the totals, and the
 * database. Undefined for a file that did not count the pod, or counted none of its files.
 */
export function storedOf(file, key, glossary = readGlossary()) {
  const values = new Map(
    (file.results ?? []).flatMap(({ name, value }) =>
      name?.startsWith(`${key}/`) ? [[name.slice(key.length + 1), value]] : [],
    ),
  );
  const total = values.get("files/all");
  if (total === undefined || total <= 0) return undefined;
  const [, dataset = "", sealed] =
    /^stored-(.+?)(-encrypted)?$/.exec(key) ?? [];
  const kinds = Object.entries(glossary.storedKinds ?? {}).flatMap(
    ([id, { label, class: counts, says }]) => {
      const files = values.get(`files/${id}`);
      return files === undefined || files === 0
        ? []
        : [
            {
              id,
              label,
              says,
              class: counts,
              files,
              statements: values.get(`statements/${id}`) ?? 0,
              bytes: values.get(`bytes/${id}`) ?? 0,
            },
          ];
    },
  );
  // A version file's one statement that links it to its record is the pod's own: it counts as history, the rest of the file as data.
  const links = values.get("count/version-links") ?? 0;
  const classes = Object.keys(glossary.storedClasses ?? {}).map((each) => {
    const of = kinds.filter((kind) => kind.class === each);
    const sum = (pick) => of.reduce((all, kind) => all + pick(kind), 0);
    const moved =
      (of.some((kind) => kind.id === "versions") ? -links : 0) +
      (each === "history" ? links : 0);
    return {
      class: each,
      files: sum((kind) => kind.files),
      statements: sum((kind) => kind.statements) + moved,
      bytes: sum((kind) => kind.bytes),
    };
  });
  const predicates = Object.fromEntries(
    [...values]
      .filter(([name]) => name.startsWith("predicates/"))
      .map(([name, value]) => [name.slice("predicates/".length), value]),
  );
  const largest = [...values]
    .filter(([name]) => /^database\/(?:table|index)-/.test(name))
    .map(([name, bytes]) => ({ name: name.slice("database/".length), bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    key,
    dataset,
    encrypted: sealed !== undefined,
    entries: values.get("count/entries"),
    podRecords: values.get("count/pod-records"),
    versionLinks: links,
    kinds,
    classes,
    total: {
      files: total,
      statements: values.get("statements/all") ?? 0,
      bytes: values.get("bytes/all") ?? 0,
    },
    onDisk: {
      files: values.get("files/on-disk"),
      bytes: values.get("bytes/on-disk"),
      blocks: values.get("bytes/in-4k-blocks"),
    },
    beside: {
      files: values.get("files/beside"),
      bytes: values.get("bytes/beside"),
    },
    predicates,
    ...(values.has("database/file") && {
      database: {
        file: values.get("database/file"),
        statements: values.get("database/statements"),
        terms: values.get("database/terms"),
        tables: values.get("database/tables"),
        indexes: values.get("database/indexes"),
        largest,
      },
    }),
  };
}

const whole = (value) => Math.round(value).toLocaleString("en-US");
/** A figure with one decimal under a hundred, whole above: 4.1, 32.4, 100. */
const ratio = (value) => (value >= 100 ? whole(value) : value.toFixed(1));
/** Mebibytes (of 1,048,576 bytes) with one decimal. */
export const mebibytes = (bytes) =>
  (bytes / MEGABYTE).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
/** A share of a whole as a whole percent, `<1%` for one that is not nothing and rounds to it. */
const share = (part, all) => {
  if (all <= 0 || part <= 0) return "0%";
  const percent = (100 * part) / all;
  return percent < 0.5 ? "<1%" : `${Math.round(percent)}%`;
};

/** The measure of a row after the pod's key, in words: "files, Versions: what the source said", "pod.db size". */
const MEASURE_WORDS = {
  "count/entries": "source entries",
  "count/pod-records": "pod records",
  "count/version-links": "version-to-record links",
  "files/all": "files, all kinds",
  "files/on-disk": "files in the folder",
  "files/beside": "files beside the pod",
  "statements/all": "statements, all kinds",
  "bytes/all": "size of the files, all kinds",
  "bytes/on-disk": "size of the folder as the disk holds it",
  "bytes/in-4k-blocks": "size of the folder in 4 KiB blocks",
  "bytes/beside": "size of what is kept beside the pod",
  "database/file": "pod.db size",
  "database/statements": "pod.db statements",
  "database/terms": "pod.db terms",
  "database/tables": "pod.db tables size",
  "database/indexes": "pod.db indexes size",
};

/**
 * A row of the stored scenario as a person reads its name: the pod ("647 source entries, encrypted pod") and what is counted
 * ("statements, Versions: what the source said", "pod.db size"). `entries` is the pod's count of source entries, where the file
 * has it.
 */
export function storedRowName(name, entries, glossary = readGlossary()) {
  const key = name.slice(0, name.indexOf("/"));
  const rest = name.slice(key.length + 1);
  const [, dataset = "", sealed] =
    /^stored-(.+?)(-encrypted)?$/.exec(key) ?? [];
  const pod = storedTitle({
    entries,
    dataset,
    encrypted: sealed !== undefined,
  });
  const [measure, kind = ""] = rest.split("/");
  const label = glossary.storedKinds?.[kind]?.label;
  const words =
    MEASURE_WORDS[rest] ??
    (label !== undefined && ["files", "statements", "bytes"].includes(measure)
      ? `${measure === "bytes" ? "size" : measure}, ${label}`
      : measure === "predicates"
        ? `statements with a ${kind} property`
        : rest.replace(/\//g, " ").replace(/-/g, " "));
  return `${pod}: ${words}`;
}

/** The class of a page, by name. */
const classOf = (page, name) =>
  page.classes.find((each) => each.class === name);

/** The size a pod's rows were counted at, as a person reads it: "647 source entries", "16,833 source entries, measured nightly, encrypted pod". */
export function storedTitle(page) {
  return [
    `${whole(page.entries ?? 0)} source entries`,
    ...(page.dataset === "synthea-lifetime" ? ["measured nightly"] : []),
    ...(page.encrypted ? ["encrypted pod"] : []),
  ].join(", ");
}

/**
 * What a fresh import left, in one sentence: how many files and statements, in how many pod records from how many source
 * entries, how much of it is the source's own data and the rest, and the figures for each pod record and each source entry.
 * "Entries" are the source file's; "pod records" are the records the pod keeps: the two are never both called records.
 */
export function storedLine(page) {
  const { total, entries = 0, podRecords = 0 } = page;
  const of = (name) => classOf(page, name)?.statements ?? 0;
  const per = (count, by) => (by > 0 ? ratio(count / by) : "-");
  return `A fresh import${page.encrypted ? " into an encrypted pod" : ""} of ${whole(entries)} source entries left ${whole(podRecords)} pod records in ${whole(total.files)} files (${mebibytes(total.bytes)} MiB) and ${whole(total.statements)} statements; ${share(of("data"), total.statements)} of the statements are the source's own data, ${share(of("history"), total.statements)} history, ${share(of("bookkeeping"), total.statements)} bookkeeping and ${share(of("derived"), total.statements)} derived copies. That is ${per(total.files, podRecords)} files and ${per(total.statements, podRecords)} statements for each pod record, and ${per(total.statements, entries)} statements for each source entry.`;
}

/**
 * The words under the tables: what is counted and how, in plain terms, with the size the same files take on a disk and the
 * database's, where the file has them.
 */
export function storedNotes(page) {
  const out = [
    "Counts are exact, from the pod the fresh import left once it was closed. A statement is one fact the pod keeps as one line of a file: a thing, one of its properties and the value (this result's code is 4548-4). It is counted in every file that holds it, so a statement a view holds again is counted again; the kinds add up to the totals. The lines are counted as N-Triples, one statement to a line, which is how this runtime writes them. MiB are 1,048,576 bytes of what the files hold.",
  ];
  const { onDisk, beside, database, predicates } = page;
  if (onDisk.blocks !== undefined && onDisk.files !== undefined)
    out.push(
      `On a disk each file also takes a whole number of 4 KiB blocks: the ${whole(onDisk.files)} files of the folder take ${mebibytes(onDisk.blocks)} MiB that way, against ${mebibytes(onDisk.bytes ?? 0)} MiB of what they hold.`,
    );
  if (database !== undefined) {
    const split =
      database.tables === undefined || database.indexes === undefined
        ? " (this SQLite build does not say how it divides between tables and indexes)"
        : `: its tables take ${mebibytes(database.tables)} MiB and its indexes ${mebibytes(database.indexes)} MiB`;
    const biggest = database.largest?.[0];
    out.push(
      `Beside the pod, its database, pod.db, is ${mebibytes(database.file)} MiB${split}${biggest === undefined ? "" : `; the largest is ${biggest.name.replace("-", " ")} at ${mebibytes(biggest.bytes)} MiB`}${database.statements === undefined ? "" : `; it holds ${whole(database.statements)} statements: those of the pod's files, each loaded once, and the graphs derived from them, which no file holds`}. Everything kept beside the pod takes ${mebibytes(beside.bytes ?? 0)} MiB in ${whole(beside.files ?? 0)} files.`,
    );
  } else if (beside.files !== undefined && beside.files > 0)
    out.push(
      `Beside the pod, what it keeps takes ${mebibytes(beside.bytes ?? 0)} MiB in ${whole(beside.files)} files; its database is sealed and is not read here.`,
    );
  const vocabularies = Object.entries(predicates ?? {}).filter(
    ([, count]) => count > 0,
  );
  if (vocabularies.length > 0)
    out.push(
      `By the vocabulary of their property (cascade is Cascade's own, prov is PROV-O, pav is PAV, dct is Dublin Core terms, rdf is RDF itself; other is rdfs for labels, oa for where in a document a revision's source sits, solid, obo and the rest), the statements are ${vocabularies
        .map(
          ([name, count]) => `${share(count, page.total.statements)} ${name}`,
        )
        .join(", ")}.`,
    );
  return out;
}

/** The header of the table of classes. */
export const CLASS_HEAD = [
  "What it is",
  "Files",
  "Statements",
  "MiB",
  "Share of statements",
];

/** The cells under `CLASS_HEAD`, one row for each class that holds a file. */
export function classCells(page) {
  return page.classes
    .filter((each) => each.files > 0)
    .map((each) => [
      CLASS_LABEL[each.class] ?? each.class,
      whole(each.files),
      whole(each.statements),
      mebibytes(each.bytes),
      share(each.statements, page.total.statements),
    ]);
}

/** The header of the table of kinds. */
export const KIND_HEAD = [
  "What it is",
  "Counts as",
  "Files",
  "Statements",
  "MiB",
  "Share of statements",
];

/** The cells under `KIND_HEAD`, one row for each kind the pod holds. */
export function kindCells(page) {
  return page.kinds.map((kind) => [
    kind.label,
    kind.class,
    whole(kind.files),
    whole(kind.statements),
    mebibytes(kind.bytes),
    share(kind.statements, page.total.statements),
  ]);
}

const escaped = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** A table of the cells for a page, the first `textColumns` columns text and the rest numbers; each cell's text is made safe here. */
function htmlTable(head, rows, textColumns = 1) {
  const cell = (tag, text, at) =>
    `<${tag}${at >= textColumns ? ' class="n"' : ""}>${escaped(text)}</${tag}>`;
  return `<table class="held">
<thead><tr>${head.map((text, at) => cell("th", text, at)).join("")}</tr></thead>
<tbody>
${rows.map((row) => `<tr>${row.map((text, at) => cell("td", text, at)).join("")}</tr>`).join("\n")}
</tbody>
</table>`;
}

/**
 * What a pod held, for a page: its line, the classes in a small table, and, folded away, each kind and the notes. `heading`
 * is the HTML of the heading the block opens with, which the caller has made safe; `rule` is the glossary's sentence of how
 * a kind is given its class, when the page shows it.
 */
export function storedHtml(page, { heading = "", rule } = {}) {
  return `${heading}
<p class="speedline"><strong>${escaped(storedLine(page))}</strong></p>
<div class="scroll">${htmlTable(CLASS_HEAD, classCells(page))}</div>
<details><summary>Each kind of file</summary>
<div class="scroll">${htmlTable(KIND_HEAD, kindCells(page), 2)}</div>
</details>
${storedNotes(page)
  .map((text) => `<p class="note">${escaped(text)}</p>`)
  .join(
    "\n",
  )}${rule === undefined ? "" : `\n<p class="note">${escaped(rule)}</p>`}`;
}
