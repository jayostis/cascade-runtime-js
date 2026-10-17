// A pod as a person reads it: who it is for, where its records came from, what is worth a look, and a tile for each
// kind of record. Preact components written with `htm`: functions from a pod's question rows to the page's elements,
// which `server.mjs` renders to HTML and a page in a browser can render too, keeping a table's sort and filter in its
// state. It imports only `preact`, `preact/hooks` and `htm`, with no build step. Rewrite it freely: it is only this
// app's view.
import { Fragment, h } from "preact";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import htm from "htm";

/**
 * Markup as Preact's elements: `${…}` in the template is a value, escaped when rendered, or more elements. A run of
 * spaces with a line break between two tags is dropped, so a space that matters stays on its line.
 */
export const html = htm.bind(h);

/** A column of a section's table: its heading, what a cell shows, and what the column sorts by. */
const text = (head, of) => ({ head, type: "text", key: of, show: of });
const date = (head, of) => ({
  head,
  type: "date",
  key: of,
  show: (row) => day(of(row)),
});
const number = (head, of) => ({
  head,
  type: "number",
  key: of,
  show: (row) => rounded(of(row)),
});

const SEVERITY = { high: "High severity", low: "Low severity" };

/**
 * One tile for each of these questions, in this order: its title, what one of its rows is called, the column of the
 * record's own name for it, the columns holding its codes in the order a name is taken from them, the table's columns,
 * the column the table opens sorted by, and whether it opens with the newest first.
 */
export const SECTIONS = [
  {
    title: "Allergies",
    one: "allergy",
    question: "pod/My active allergies",
    field: "allergen",
    codes: ["code"],
    columns: [
      text("Allergen", (row) => row.allergen),
      {
        head: "Severity",
        type: "number",
        key: (row) =>
          String(
            row.criticality === undefined
              ? 4
              : ({ high: 1, low: 2 }[row.criticality] ?? 3),
          ),
        show: (row) =>
          row.criticality === undefined
            ? ""
            : (SEVERITY[row.criticality] ??
              row.criticality.replaceAll("-", " ")),
        warm: (row) => row.criticality === "high",
        tag: true,
      },
    ],
    sortBy: 1,
  },
  {
    title: "Medications",
    one: "medication",
    question: "pod/My active medications",
    field: "medication",
    codes: ["code"],
    columns: [
      text("Medication", (row) => row.medication),
      date("Since", (row) => row.started),
    ],
    sortBy: 0,
  },
  {
    title: "Conditions",
    one: "condition",
    question: "pod/My active conditions",
    field: "condition",
    codes: ["icd10", "snomed"],
    columns: [
      text("Condition", (row) => row.condition),
      date("Since", (row) => row.onset),
    ],
    sortBy: 0,
  },
  {
    title: "Lab results",
    one: "lab result",
    question: "pod/My lab results",
    field: "test",
    codes: ["code"],
    columns: [
      text("Test", (row) => row.test),
      number("Value", (row) => row.value),
      text("Unit", (row) => row.unit),
      date("Date", (row) => row.performed),
    ],
    sortBy: 3,
    newestFirst: true,
  },
  {
    title: "Immunizations",
    one: "immunization",
    question: "pod/My immunizations",
    field: "vaccine",
    codes: ["code"],
    columns: [
      text("Vaccine", (row) => row.vaccine),
      date("Date", (row) => row.given),
    ],
    sortBy: 1,
    newestFirst: true,
  },
  {
    title: "Procedures",
    one: "procedure",
    question: "pod/My procedures",
    field: "procedure",
    codes: ["snomed"],
    columns: [
      text("Procedure", (row) => row.procedure),
      date("Date", (row) => row.performed),
    ],
    sortBy: 1,
    newestFirst: true,
  },
  {
    title: "Genetic variants",
    one: "variant",
    field: "variant",
    codes: [],
    rows: variantRows,
    columns: [
      text("Variant", (row) => row.variant),
      number("Reports", (row) => row.reports),
    ],
    sortBy: 0,
  },
];

export const SOURCES = "entry/Where it came from";
const REVIEW = "entry/What needs review";

const DIFFERS = "Differs";
const NEEDS_REVIEW = "Needs review";
const RETIRED = "Retired code";

/** The one set of tags a line, a row and an entry share, in the order they are drawn, and whether each is warm. */
const TAGS = [
  { tag: DIFFERS, warm: true },
  { tag: NEEDS_REVIEW, warm: true },
  { tag: RETIRED, warm: false },
];

/** The tags that hold, in `TAGS` order. */
function tagsOf({ differs = false, review = false, retired = false }) {
  const holds = {
    [DIFFERS]: differs,
    [NEEDS_REVIEW]: review,
    [RETIRED]: retired,
  };
  return TAGS.filter(({ tag }) => holds[tag]).map(({ tag }) => tag);
}

/** The entries `answers` say need review. */
const reviewed = (answers) =>
  new Set((answers[REVIEW] ?? []).map((row) => row.entry));

/** A tag as it is drawn, after a line, a row's name or an entry's heading. */
const tagged = (tag) =>
  html` <span class="tag${TAGS.find((each) => each.tag === tag)?.warm ? " warm" : ""}">${tag}</span>`;

const SEEN = "pod/What was seen more than once";
const VARIANTS = "pod/My genetic variants";
const REPORTS = "pod/What each report says of a variant";
export const HISTORY = "pod/My medication history";
export const MEDICATIONS = "pod/My active medications";
export const LABS = "pod/My lab results";
const IMPORTS = "pod/What each import brought in";
const REVISIONS = "record/Its revisions, in the order they arrived";
const VERSIONS = "record/What each version says";

/** The questions only the mechanism under What changed reads: see `withMechanism`. */
export const MECHANISM = [REVISIONS, VERSIONS];

/** Every question `podPage` reads: ask each, and hand it the rows by question. */
export const QUESTIONS = [
  SOURCES,
  SEEN,
  REVIEW,
  VARIANTS,
  REPORTS,
  HISTORY,
  IMPORTS,
  ...SECTIONS.flatMap(({ question }) => question ?? []),
];

/**
 * The rows of `section` in `answers`: the only way a section's rows are read. A section with `rows` builds them from
 * several questions and `said` (`variantsSaid`'s answer, none until the tables can say) rather than from one.
 */
export function sectionRows(section, answers, said) {
  return section.rows === undefined
    ? (answers[section.question] ?? [])
    : section.rows(answers, said);
}

const isCode = (code) => /^[a-z][a-z\d+.-]*:/i.test(code ?? "");

/**
 * The codes the sections' rows in `answers`, and the medication history's, hold, each once: what to ask the tables'
 * `about` of. The history is no section, but the change cards name their medication by it, stopped or not.
 */
export function codesOf(answers) {
  const codes = [
    ...SECTIONS.flatMap((section) =>
      sectionRows(section, answers).flatMap((row) =>
        section.codes.map((column) => row[column]),
      ),
    ),
    ...(answers[HISTORY] ?? []).map((row) => row.code),
  ];
  return [...new Set(codes.filter(isCode))];
}

/**
 * What the tables' `about` makes of a row of `section`: `label`, the name of the first of its codes `about` names,
 * `origin`, the version of the table that named it, and `retired`, whether the code that named it, or with none the first
 * of its codes with a status, is retired.
 */
function namingOf(section, row, about) {
  const said = section.codes.map((column) => about.get(row[column]));
  const naming = said.find((each) => each?.name !== undefined);
  return {
    label: naming?.name.label,
    origin: naming?.name.origin,
    retired:
      statusOf(naming ?? said.find((each) => each?.status !== undefined)) !==
      "",
  };
}

/**
 * The credit each series asks for that named a row of the sections in `answers` (by `about`), once, among `held`: a
 * credit travels with what a table says, and a series whose names a page shows is one of them.
 */
function namingCredits(answers, about, held) {
  const origins = SECTIONS.flatMap((section) =>
    section.question === undefined || answers[section.question] === undefined
      ? []
      : sectionRows(section, answers).flatMap((row) => {
          const { origin } = namingOf(section, row, about);
          return origin === undefined ? [] : [origin];
        }),
  );
  return [
    ...new Set(
      [...new Set(origins)].flatMap(
        (origin) => heldAt(origin, held)?.series.credit ?? [],
      ),
    ),
  ];
}

/**
 * The sections' rows in `answers`, each named by the first of its codes `about` (the tables' `about`) names, else by
 * the record's own text, and `tags` when it has any: `Retired code` when the code that named it, or with none the first
 * of its codes with a status, is retired, and `Needs review` when What needs review names its entry.
 */
export function named(answers, about) {
  const renamed = { ...answers };
  const review = reviewed(answers);
  for (const section of SECTIONS) {
    if (
      section.question === undefined ||
      answers[section.question] === undefined
    )
      continue;
    renamed[section.question] = sectionRows(section, answers).map((row) => {
      const { label, retired } = namingOf(section, row, about);
      const tags = tagsOf({ retired, review: review.has(row.entry) });
      return {
        ...row,
        ...(label !== undefined && { [section.field]: label }),
        ...(tags.length > 0 && { tags }),
      };
    });
  }
  return renamed;
}

/**
 * What the tables say of the codes `answers` hold, as the tables' `about` answers (`tables` is the tables), and of the
 * ingredients those codes map to, which the sentences that name an ingredient need. An ingredient the tables cannot say
 * is left unnamed; the codes' own answer failing throws.
 */
export async function codesSaid(answers, { tables }) {
  const about = await tables.about(codesOf(answers));
  const ingredients = new Set(
    [...about.values()].flatMap((each) => each.ingredients?.codes ?? []),
  );
  for (const [code, said] of await tables.about(
    [...ingredients].filter((code) => !about.has(code)),
  ))
    about.set(code, said);
  return about;
}

/** A measurement to three significant figures, as a lab report gives it: `60.967166` is `61`, `4.7055` is `4.71`. */
export function rounded(value) {
  if (value === undefined) return "";
  const n = Number(value);
  return String(value).trim() !== "" && Number.isFinite(n)
    ? String(Number(n.toPrecision(3)))
    : String(value);
}

/** A date or a time, as the day it fell on where it was written: `Apr 22, 2025`. */
export function day(text) {
  if (text === undefined) return "";
  const date = new Date(`${String(text).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? String(text)
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

/**
 * How two cells compare, by what they sort by: numbers and dates by value, and text as text. A cell with nothing to
 * sort by, or what is no number or date, comes after every other. The page's script runs this same function.
 */
export function compare(type, a, b) {
  if (type === "text")
    return a === "" || b === ""
      ? Number(a === "") - Number(b === "")
      : a.localeCompare(b);
  const value = (key) => {
    const n =
      key === "" ? NaN : type === "date" ? Date.parse(key) : Number(key);
    return Number.isNaN(n) ? Infinity : n;
  };
  const [x, y] = [value(a), value(b)];
  return x === y ? 0 : x < y ? -1 : 1;
}

/** `a`, `a and b`, `a, b and c`. */
export function listed(items) {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * A pod's name made from a person's: `Rowan Ellery Marsh` is `rowan-ellery-marsh`, `Zoë` is `zoe`. Empty when it has
 * no letter from a to z and no digit.
 */
export function slug(person) {
  return String(person)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

/**
 * A pod's name as a person's: the title `titles` (a Map of the pods' titles by their names) holds for it when that
 * is the name the pod was made under, that is, when `slug` of it is the pod's name, as typed; else the pod's own name
 * capitalised, `rowan-ellery-marsh` as `Rowan Ellery Marsh`.
 */
export function personName(pod, titles) {
  const typed = titles?.get(pod)?.trim().replace(/s+/g, " ");
  return typed !== undefined && typed !== pod && slug(typed) === pod
    ? typed
    : pod
        .split(/[-_.]+/)
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");
}

/** A hospital's name as a person says it: `Cascade North Demo Hospital` is `Cascade North`. */
export function hospitalName(name) {
  return name.replace(/ Demo Hospital$/, "");
}

/** Where a row of "Where it came from" came from, as a person would say it: see `placeName`. */
export function placeOf(row) {
  return placeName(row.hospital ?? row.importLabel);
}

/**
 * A place records came from, a hospital's name or an import's label, as a person would say it: the hospital without
 * " Demo Hospital", the person's own entries (`entered by Alex …` is "Alex's own entries", `entered by the person` is
 * "Own entries"), or how it arrived, without " export".
 */
export function placeName(place = "") {
  if (place.startsWith("entered by ")) {
    const name = /^entered by (\p{Lu}\S*)/u.exec(place)?.[1];
    return name === undefined ? "Own entries" : `${name}'s own entries`;
  }
  return place === ""
    ? "Somewhere unnamed"
    : hospitalName(place).replace(/ export$/, "");
}

/** How many of each kind, in words, from `look`'s counts: `1 allergy, 2 conditions, 3 lab results`. */
export function counted(records) {
  return Object.entries(records)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => {
      const word = kind.toLowerCase();
      if (count === 1) return `1 ${word}`;
      return `${count} ${word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
    })
    .join(", ");
}

const UNNAMED = "An entry";

const capitalised = (sentence) => sentence[0].toUpperCase() + sentence.slice(1);

const SAID = {
  "members disagree on criticality": ({ name, one }) =>
    `Sources disagree on how severe ${name === UNNAMED ? `an unnamed ${one}` : `the ${name} ${one}`} is.`,
  "joined through two kinds of machine sameness": ({ name }) =>
    `${name} was matched in two different ways.`,
  "judged different, still joined": ({ name, one }) =>
    `${name} was marked as different, but is still shown as one ${one}.`,
  "same code, dates cannot tell": ({ name, one }) =>
    `${name} was recorded more than once, and its dates cannot tell whether it is one ${one} or several.`,
  "joined before, apart under newer tables or rules": ({ name, one }) =>
    `${name === UNNAMED ? `An unnamed ${one}` : name} was kept as one ${one} with another before; newer reference tables or rules no longer match them, so they are shown apart.`,
  "possibly the same medication": ({ name, one }, { otherRecordLabel }) =>
    `${name === UNNAMED ? `An unnamed ${one}` : name} shares a code with ${otherNamed(otherRecordLabel, one)}, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same.`,
};

/** The other record of a pair, named from its label `Medication · Name · …`, or `another medication` when it has no name. */
function otherNamed(label, one) {
  const name = label?.split(" · ")[1];
  return name === undefined || name === "no name" ? `another ${one}` : name;
}

/** `at A and B`, `at A and in Alex's own entries`: records are at a hospital, but in a person's own entries. */
function where(places) {
  let said;
  return listed(
    places.map((place) => {
      const own = / own entries$|^Own entries$/.test(place);
      const word = own ? "in" : "at";
      const named =
        place === "Own entries" ? "the person's own entries" : place;
      const phrase = word === said ? named : `${word} ${named}`;
      said = word;
      return phrase;
    }),
  );
}

/**
 * Each entry `answers` say is seen more than once, by its IRI: the places its records came from, as a person says
 * them, and `across`, from how many places (a record with no place counts in none).
 */
export function seenAt(answers) {
  const seen = new Map();
  for (const row of answers[SEEN] ?? []) {
    if (!seen.has(row.entry))
      seen.set(row.entry, { places: [], across: Number(row.places) });
    const { places } = seen.get(row.entry);
    const place = row.place === undefined ? undefined : placeName(row.place);
    if (place !== undefined && !places.includes(place)) places.push(place);
  }
  return seen;
}

/** An entry the sections do not show, named from its label: `Allergy entry · Latex` is a latex allergy. */
function fromLabel(label = "") {
  const [kind = "", name = label] = label.split(" · ");
  return {
    name: name || UNNAMED,
    one: kind.replace(/ entry$/, "").toLowerCase() || "entry",
  };
}

/**
 * What is worth a look, as `{ sentence, entry, tag }` lines, `entry` the entry each is about and `tag` as `TAGS`
 * holds it, none for a shared ingredient: each entry that needs review; then each report that differs from ClinVar
 * today, which `said` (`variantsSaid`'s answer, none until the tables can say) gives; then each pair of medications in
 * two entries whose codes have an ingredient in common, which the tables' `about` gives. A line that needs the tables
 * comes after those that do not, so the part only grows when they load. `answers` holds the rows of each of
 * `QUESTIONS`, by question.
 *
 * The pair is a hint the starter gives, not something the pod knows: a pod's questions never read the tables' rows.
 * A combination maps to its own multiple-ingredient concept (MIN), never to each of its ingredients, so lisinopril and
 * lisinopril with hydrochlorothiazide share none; two drugs that map to the same MIN share the combination.
 */
export function worthALook(answers, about = new Map(), said) {
  const entries = new Map();
  for (const section of SECTIONS)
    for (const row of sectionRows(section, answers))
      entries.set(row.entry, {
        name: row[section.field] || fromLabel(row.entryLabel).name,
        one: section.one,
      });
  const review = new Map();
  for (const row of answers[REVIEW] ?? [])
    review.set(reviewKey(row), {
      sentence: reviewSaid(
        row,
        entries.get(row.entry) ?? fromLabel(row.entryLabel),
      ),
      entry: row.entry,
      tag: NEEDS_REVIEW,
    });
  const differing = [...variantReports(answers, said)].flatMap(
    ([entry, { name, reports }]) =>
      reports
        .filter(({ tag }) => tag === DIFFERS)
        .map(({ when, place }) => ({
          sentence: `${name}: ${when === undefined ? "an undated" : `your ${when}`} report${place === undefined ? "" : ` from ${place}`} differs from ClinVar today.`,
          entry,
          tag: DIFFERS,
        })),
  );
  return [
    ...review.values(),
    ...differing,
    ...sharedIngredients(answers, about).map(({ sentence, entries }) => ({
      sentence,
      entry: entries[0].entry,
    })),
  ].map((line) => ({ ...line, sentence: capitalised(line.sentence) }));
}

/**
 * The part of a pod's page that lists `lines`, as `worthALook` gives them: each line's sentence a link to
 * `entryHref(line.entry)`, or plain text with no `entryHref`, then its tag. Absent with no line. With `ask`, each line has
 * an "Ask about this" button naming its entry (`{ kind: "worth", entry }`), which `worth_a_look` reaches.
 */
export function worthPart(lines, entryHref, ask) {
  if (lines.length === 0) return undefined;
  return html`<div class="card worth"><h2>Worth a look</h2><ul>${lines.map(
    ({ sentence, entry, tag }) =>
      html`<li>${entryHref === undefined ? sentence : html`<a href=${entryHref(entry)}>${sentence}</a>`}${tag !== undefined && tagged(tag)}${ask && askButton({ kind: "worth", entry: entryId(entry) }, sentence)}</li>`,
  )}</ul></div>`;
}

/**
 * A button that starts a chat about `context`: `{ kind: "finding", key }`, `{ kind: "entry", id }`, `{ kind: "worth", entry }` or `{ kind: "trend",
 * test, medication? }`, which `chatStrip` listens for. It names the thing, never its text, so the model reaches it through
 * its tools. `label` says which one to a screen reader.
 */
function askButton(context, label) {
  return html` <button type="button" class="quiet ask" data-ask=${JSON.stringify(context)} data-ask-label=${label} title="Ask about this" aria-label=${`Ask about this: ${label}`}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 20.5l1.5-4.9A8 8 0 1 1 21 12z" /></svg></button>`;
}

/** What a row of "What needs review" is told apart by: its entry, what it needs, and for a pair of medications, the other. */
function reviewKey(row) {
  return JSON.stringify([
    row.entry,
    row.needs,
    row.needs === "possibly the same medication" ? row.otherRecord : null,
  ]);
}

/** The sentence a row of "What needs review" is told in, of `item`, the entry's `name` and what `one` of its kind is called. */
function reviewSaid(row, item) {
  return (SAID[row.needs] ?? (() => `${item.name}: ${row.needs}.`))(item, row);
}

/**
 * A `{ sentence, entries }` for each pair of medications in two entries whose codes share an ingredient, in the order of
 * the section, once for the pair of entries whatever codes their rows show, and none for a pair whose rows share a
 * code, which What needs review lists. `entries` are the pair's `{ entry, origin }`, the first the sentence's subject and
 * `origin` the table version its code's ingredients were read from.
 */
function sharedIngredients(answers, about) {
  const medications = SECTIONS.find(({ one }) => one === "medication");
  const rows = sectionRows(medications, answers).map((row) => ({
    entry: row.entry,
    name: row.medication || fromLabel(row.entryLabel).name,
    code: row.code,
    ingredients: about.get(row.code)?.ingredients?.codes ?? [],
  }));
  const same = new Set(
    rows.flatMap((one, at) =>
      rows
        .slice(at + 1)
        .filter((other) => other.code !== undefined && other.code === one.code)
        .map((other) => JSON.stringify([one.entry, other.entry].sort())),
    ),
  );
  const said = new Set(same);
  const sentences = [];
  for (const [at, one] of rows.entries())
    for (const other of rows.slice(at + 1)) {
      const pair = JSON.stringify([one.entry, other.entry].sort());
      const shared = one.ingredients.find((each) =>
        other.ingredients.includes(each),
      );
      if (one.entry === other.entry || shared === undefined || said.has(pair))
        continue;
      said.add(pair);
      const name = about.get(shared)?.name?.label ?? shared.split("/").at(-1);
      const what = name.includes(" / ") ? "the combination" : "an ingredient";
      sentences.push({
        sentence: `${one.name} and ${other.name} share ${what}, ${name}, and are shown apart.`,
        entries: [one, other].map(({ entry, code }) => ({
          entry,
          origin: about.get(code)?.ingredients?.origin,
        })),
      });
    }
  return sentences;
}

const GENOMICS = "https://ns.cascadeprotocol.org/genomics/v1#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
/** The five ACMG values, in the order a classification names them. */
const ACMG = [
  "Pathogenic",
  "LikelyPathogenic",
  "VUS",
  "LikelyBenign",
  "Benign",
].map((name) => GENOMICS + name);
const LABS_DISAGREE = ["ClinVarConflicting", "ClinVarConflictingData"].map(
  (name) => REC + name,
);
const COMBINATION_ONLY = `${REC}ClinVarCombinationOnly`;
const COUNSELLOR =
  "Your clinician or a genetic counsellor can explain what this means for you.";
const DIGITS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

/**
 * Each variant entry in `answers`, by its IRI, as the tables' `variantClassification` is asked of it: its distinct HGVS
 * expressions and ClinVar IDs, and its gene when its rows give one symbol, none when they give none or two.
 */
export function variantsAsked(answers) {
  const asked = new Map();
  const genes = new Map();
  for (const row of answers[VARIANTS] ?? []) {
    const variant = asked.get(row.variant) ?? { hgvs: [], variations: [] };
    asked.set(row.variant, variant);
    if (row.hgvs !== undefined && !variant.hgvs.includes(row.hgvs))
      variant.hgvs.push(row.hgvs);
    if (
      row.variation !== undefined &&
      !variant.variations.includes(row.variation)
    )
      variant.variations.push(row.variation);
    if (row.gene !== undefined)
      genes.set(
        row.variant,
        new Set([...(genes.get(row.variant) ?? []), row.gene]),
      );
  }
  for (const [variant, symbols] of genes)
    if (symbols.size === 1) asked.get(variant).gene = [...symbols][0];
  return asked;
}

/** A variant as the page names it: its gene and first expression, else its ClinVar ID. */
function variantName({ gene, hgvs, variations }) {
  const named = [gene, hgvs[0]].filter(Boolean).join(" ");
  return named !== ""
    ? named
    : variations.length > 0
      ? `ClinVar ${variations[0]}`
      : UNNAMED;
}

/** A concept's label as a sentence holds it: its first letter lower-case unless the second is upper-case. */
function lowered(label) {
  return /^.[A-Z]/.test(label)
    ? label
    : label.slice(0, 1).toLowerCase() + label.slice(1);
}

/** A concept's last part of its IRI, in words, for a label nobody has given. */
function wordsOf(concept) {
  return concept
    .replace(/^.*[/#]/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((word) => (/^[A-Z]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}

/** How many submitters a row counts, in words. */
function counting({ contributingSubmitters: contributing, submitters }) {
  const number = (n) => (n < 10 ? DIGITS[n] : String(n));
  if (contributing !== undefined)
    return `${number(contributing)} contributing ${contributing === 1 ? "submitter" : "submitters"}`;
  if (submitters === undefined) return undefined;
  return submitters === 1
    ? "one submitter"
    : `${submitters === 0 ? "no" : submitters} submitters`;
}

/** What a variant classifications row says, as the sentence ClinVar's page and a code's page give it. */
export function rowSaid(row) {
  const iris = new Set(row.classification.map(({ iri }) => iri));
  const said = [
    ACMG.filter((acmg) => iris.has(acmg))
      .map((acmg) =>
        lowered(row.classification.find(({ iri }) => iri === acmg).label),
      )
      .join("/"),
    ...row.classification
      .filter(({ iri }) => !ACMG.includes(iri))
      .map(({ iri, label }) =>
        LABS_DISAGREE.includes(iri)
          ? "labs that submit to ClinVar disagree"
          : iri === COMBINATION_ONLY
            ? "classified only as part of a combination"
            : lowered(label),
      ),
  ].filter((each) => each !== "");
  const status =
    row.reviewStatus === undefined
      ? ""
      : `: ${lowered(row.reviewStatus.label)}`;
  const count = counting(row);
  const lead =
    said.length === 0
      ? "ClinVar today gives no classification"
      : `ClinVar today says ${said.join("; ")}`;
  return `${lead}${status}${count === undefined ? "" : `, ${count}`}.`;
}

/**
 * What ClinVar says of one variant, as `variantClassification` answers (`says`): one sentence, none while it is not
 * known. `gene` is the variant's, for a gene the series does not cover.
 */
function clinvarSaid(says, gene) {
  if (says === undefined) return undefined;
  switch (says.found) {
    case "rows":
      return rowSaid(says.rows[0]);
    case "not found":
      return "ClinVar, as this app holds it, has no row for this variant.";
    case "not covered":
      return `ClinVar, as this app holds it, covers ${listed(says.genes)}, not ${gene}.`;
    default:
      return "This app holds no ClinVar table.";
  }
}

/** The year a report is named by, or its day when another report of the variant is of the same year. */
function whenOf(date, dates) {
  if (date === undefined) return undefined;
  const year = String(date).slice(0, 4);
  return dates.filter((each) => String(each).slice(0, 4) === year).length > 1
    ? day(date)
    : year;
}

/**
 * What a variant's page says: a sentence for each of its `reports` (rows of "What each report says of a variant"),
 * oldest first, each with a tag when `verdicts` (`Pod.agreement()`'s rows) say it differs from the row `says` read; and
 * what ClinVar says today. Each is `{ report, when, place, sentence, tag }`, the year or day it is named by and the lab
 * it came from (`places`, a report's IRI to its lab) only when it has them. A report's classification is named by
 * `labels` (`Tables.labels`' answer). `variant` is as `variantsAsked` gives it.
 */
export function variantSaid({
  variant,
  reports,
  says,
  verdicts = [],
  labels = new Map(),
  places = new Map(),
}) {
  const row = says?.found === "rows" ? says.rows[0] : undefined;
  const dates = reports.flatMap((report) => report.date ?? []);
  const ordered = [...reports].sort((a, b) =>
    a.date === undefined || b.date === undefined
      ? Number(a.date === undefined) - Number(b.date === undefined)
      : a.date.localeCompare(b.date),
  );
  return {
    reports: ordered.map((report) => {
      const when = whenOf(report.date, dates);
      const place = places.get(report.report);
      const head = `${when === undefined ? "An undated report" : `Your ${when} report`}${place === undefined ? "" : ` from ${place}`}`;
      const sentence =
        report.classification === undefined
          ? `${head} gives no ACMG classification.`
          : `${head} said ${lowered(labels.get(report.classification) ?? wordsOf(report.classification))}.`;
      const differs =
        row !== undefined &&
        verdicts.some(
          (each) =>
            each.report === report.report &&
            each.row === row.variation &&
            each.origin === says.version &&
            each.verdict === "differs",
        );
      return {
        report: report.report,
        ...(when !== undefined && { when }),
        ...(place !== undefined && { place }),
        sentence,
        ...(differs && { tag: DIFFERS }),
      };
    }),
    clinvar: clinvarSaid(says, variant?.gene),
  };
}

/**
 * Everything the page says of variants that needs the tables: for each variant entry in `answers` what the tables'
 * `variantClassification` says of it, `pod.agreement()`'s verdicts only when the pod has a report, and the labels of
 * the reports' classifications; and `names`, the held ClinVar names' `about` answer's name of the one variation each
 * entry's classification found, an entry whose classification found none, or whose name's version the app does not hold,
 * having none.
 */
export async function variantsSaid(answers, { tables, pod }) {
  const asked = variantsAsked(answers);
  const reports = answers[REPORTS] ?? [];
  if (asked.size === 0 && reports.length === 0) return undefined;
  const says = new Map(
    await Promise.all(
      [...asked].map(async ([variant, each]) => [
        variant,
        await tables.variantClassification(each),
      ]),
    ),
  );
  const [verdicts, labels] = await Promise.all([
    reports.length === 0 ? [] : pod.agreement(),
    tables.labels([
      ...new Set(reports.flatMap(({ classification }) => classification ?? [])),
    ]),
  ]);
  const found = new Map(
    [...says].flatMap(([variant, each]) =>
      each.found === "rows" && each.rows.length === 1
        ? [[variant, each.rows[0].variation]]
        : [],
    ),
  );
  const about = await tables.about([...new Set(found.values())]);
  const named = [...found].flatMap(([variant, variation]) => {
    const name = about.get(variation)?.name;
    return name === undefined ? [] : [[variant, name]];
  });
  const held = named.length === 0 ? [] : await tables.held();
  const names = new Map(
    named.filter(([, { origin }]) => heldAt(origin, held) !== undefined),
  );
  return { says, verdicts, labels, names };
}

/**
 * Each variant entry the Genetic variants section shows, by its IRI: its `name`, `asked` as `variantsAsked` gives it
 * (none of either for a variant only a report names), its `reports` as `variantSaid` gives them, each naming the lab
 * of its own entry's documents, `clinvar`, what ClinVar says today, and `from`, the `{ series, version }` among `held`
 * that sentence was read from. `said` is `variantsSaid`'s answer, none until the tables can say, and then no report is
 * tagged and there is no sentence from ClinVar.
 */
export function variantReports(answers, said, held = []) {
  const sources = answers[SOURCES] ?? [];
  const reported = new Map();
  for (const report of answers[REPORTS] ?? [])
    reported.set(report.variant, [
      ...(reported.get(report.variant) ?? []),
      report,
    ]);
  const labs = new Map();
  for (const row of sources)
    if (row.hospital !== undefined)
      labs.set(row.entry, [...(labs.get(row.entry) ?? []), placeOf(row)]);
  const places = new Map(
    [...labs].map(([report, each]) => [report, listed([...new Set(each)])]),
  );
  const asked = variantsAsked(answers);
  return new Map(
    [...new Set([...asked.keys(), ...reported.keys()])].map((entry) => {
      const variant = asked.get(entry) ?? { hgvs: [], variations: [] };
      const says = said?.says.get(entry);
      const read = variantSaid({
        variant,
        reports: reported.get(entry) ?? [],
        says,
        verdicts: said?.verdicts,
        labels: said?.labels,
        places,
      });
      const called = said?.names?.get(entry);
      const namedFrom =
        called === undefined ? undefined : heldAt(called.origin, held);
      const named = called?.label ?? variantName(variant);
      const from = says === undefined ? undefined : heldAt(says.version, held);
      return [
        entry,
        {
          name:
            named === UNNAMED
              ? fromLabel(
                  sources.find((row) => row.entry === entry)?.entryLabel,
                ).name
              : named,
          asked: variant,
          reports: read.reports,
          clinvar: read.clinvar,
          ...(from !== undefined && { from }),
          ...(namedFrom !== undefined && { namedFrom }),
        },
      ];
    }),
  );
}

/**
 * The Genetic variants section's rows: `{ entry, variant, reports, tags }` for each variant `variantReports` gives,
 * `tags` only when it has any.
 */
function variantRows(answers, said) {
  const review = reviewed(answers);
  return [...variantReports(answers, said)].map(
    ([entry, { name, reports }]) => {
      const tags = tagsOf({
        differs: reports.some(({ tag }) => tag === DIFFERS),
        review: review.has(entry),
      });
      return {
        entry,
        variant: name,
        reports: reports.length,
        ...(tags.length > 0 && { tags }),
      };
    },
  );
}

/** The section's rows in the order its table opens in, a row with nothing to sort by last either way. */
export function opening(section, rows) {
  const column = section.columns[section.sortBy];
  const key = (row) => String(column.key(row) ?? "");
  const order = section.newestFirst ? -1 : 1;
  return [...rows].sort(
    (a, b) =>
      Number(key(a) === "") - Number(key(b) === "") ||
      order * compare(column.type, key(a), key(b)),
  );
}

/** A dialog's first link, to `href`: it covers the page behind the box, so a click outside the box closes it. */
const backdrop = (href) =>
  html`<a class="backdrop" href=${href} aria-label="Close the box" tabindex="-1"></a>`;

/**
 * A box over the page, shown when the page's address ends `#<id>`, with `body` under `heading`; its close link and
 * backdrop go to `back`, and a `wide` one is for a table.
 */
function box(id, heading, body, { back = "#", wide = false } = {}) {
  return html`<div class="dialog" id=${id} key=${id} role="dialog" aria-labelledby="${id}-title">
${backdrop(back)}
<div class="box${wide ? " wide" : ""}">
<a class="close" href=${back} aria-label="Close">×</a>
<h2 id="${id}-title">${heading}</h2>
${body}
</div>
</div>`;
}

/**
 * A section's filter box and table of `rows`, given in `opening` order, a heading button per column, each cell holding
 * what it sorts by in `data-key`.
 * Its state is the column it is sorted by and which way, and the filter's text: a heading sorts by its column, one way
 * then the other, and the filter hides the rows without its text. Rendered to a string, it is the table as it opens,
 * and the page's script sorts and filters it.
 */
function Table({ section, rows, entryHref }) {
  const [sort, setSort] = useState();
  const [wanted, setWanted] = useState("");
  const { at, up } = sort ?? {
    at: section.sortBy,
    up: !section.newestFirst,
  };
  const shown = (column, row) => column.show(row) ?? "";
  const key = (row) => String(section.columns[at].key(row) ?? "");
  const sorted =
    at === section.sortBy && up === !section.newestFirst
      ? rows
      : [...rows].sort(
          (a, b) =>
            (up ? 1 : -1) * compare(section.columns[at].type, key(a), key(b)),
        );
  const head = section.columns.map((column, index) => {
    const by = index === at ? (up ? "ascending" : "descending") : undefined;
    const click = () => setSort({ at: index, up: by !== "ascending" });
    return html`<th aria-sort=${by}><button type="button" data-type=${column.type} onClick=${click}>${column.head}</button></th>`;
  });
  const cell = (column, row, index) => {
    const text = shown(column, row);
    const cell =
      column.tag && text !== ""
        ? html`<span class="tag${column.warm(row) ? " warm" : ""}">${text}</span>`
        : text;
    return html`<td data-key=${column.key(row) ?? ""}>${
      index === 0 && entryHref !== undefined
        ? html`<a href=${entryHref(row.entry)}>${cell}</a>`
        : cell
    }${index === 0 && (row.tags ?? []).map(tagged)}</td>`;
  };
  const body = sorted.map((row) => {
    const hidden = ![
      ...section.columns.map((column) => shown(column, row)),
      ...(row.tags ?? []),
    ]
      .join("")
      .toLowerCase()
      .includes(wanted);
    return html`<tr hidden=${hidden || undefined}>${section.columns.map((column, index) => cell(column, row, index))}</tr>`;
  });
  const filter = (event) =>
    setWanted(event.currentTarget.value.trim().toLowerCase());
  return html`<input type="search" class="filter" placeholder="Filter" aria-label="Filter ${section.title.toLowerCase()}" onInput=${filter} />
<div class="scroll"><table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>`;
}

/**
 * The section's tile, a link that opens its dialog, and the dialog: its `Table`, whose rows each link to
 * `entryHref(row.entry)` when given.
 */
export function tile(section, rows, entryHref, by) {
  const id = `see-${slug(section.title)}`;
  const opened = opening(section, rows);
  const names = opened.map((row) => row[section.field] ?? "").join(", ");
  const opener = html`<a class="tile" key=${id} href="#${id}"><span class="kind">${section.title}</span><span class="count">${rows.length}</span><span class="peek">${names}</span></a>`;
  return {
    tile:
      by === undefined
        ? opener
        : html`<div class="tile-box" key=${id}>${opener}<a class="by" href=${by.href} title=${by.title}>${by.label}</a></div>`,
    dialog: box(
      id,
      html`${section.title} <span class="muted">${rows.length}</span>`,
      html`<${Table} section=${section} rows=${opened} entryHref=${entryHref} />`,
      { wide: true },
    ),
  };
}

/**
 * A pod's page, as a person reads it: the person's name, how many records from how many places, a note when a record
 * was just brought in, what is worth a look, a tile per kind with rows, each with its dialog, and a way to bring in
 * more. `answers` holds the rows of each of `QUESTIONS`, by question. The rest names what the host gives:
 *
 * - `pod`: the pod's name;
 * - `person`: the demo person the pod is for, as `demoPeople` gives them, or undefined;
 * - `from`: the hospital a record was just brought in from, by its name, or undefined;
 * - `signIn(hospital)`: a button that signs the pod's person in at one of `person`'s hospitals;
 * - `findHospital`: the address of the page that finds a hospital;
 * - `world`: what the hospitals answer as of now and the way to change it, as `worldDateLine` takes it, or undefined;
 * - `connection`: the box of a connection under way, as `connectionDialog` gives it, or undefined;
 * - `unheld`: the table versions the pod names that the app does not hold, as `pod.opened.unheld` gives them;
 * - `entryHref(entry)`: the address of an entry's page, which each row of a tile's table links to; none, no link;
 * - `about`: what the tables say of the codes `codesOf(answers)` gives, as their `about` answers, which `named` names
 *   the rows by;
 * - `said`: what the tables say of the variants, as `variantsSaid` gives it, or undefined until they can say; no report
 *   is tagged `Differs`, on a row or in what is worth a look, until it does;
 * - `changes`: what changed after a medication started or stopped, as `changesIn` gives it over the pod's medication
 *   history and lab results; none, no part, as when the pod holds no row of either;
 * - `trendHref({ test, medication })`: the address of the trend of a test, a medication marked, which a change links to;
 * - `register(view)`: called with `TREND_VIEW` while What changed is on screen, giving back what undoes it;
 * - `ask`: true when a model is set, and each change and each line of Worth a look has an "Ask about this" button.
 */
export function podPage(
  asked,
  {
    pod,
    titles,
    person,
    from,
    signIn,
    findHospital,
    world,
    connection,
    unheld = [],
    entryHref,
    about = new Map(),
    held = [],
    said,
    changes,
    trendHref,
    classesHref,
    register,
    ask,
  },
) {
  const answers = named(asked, about);
  const credits = namingCredits(asked, about, held);
  const sources = answers[SOURCES] ?? [];
  const records = new Set(sources.map((row) => row.record)).size;
  const places = [...new Set(sources.map(placeOf))];
  const worth = worthPart(worthALook(answers, about, said), entryHref, ask);
  const changed =
    changes !== undefined &&
    (answers[HISTORY] ?? []).length > 0 &&
    (answers[LABS] ?? []).length > 0
      ? changedPart({
          changes,
          about,
          how: howOf(
            asked,
            changes.filter(
              ({ direction }) => direction !== "not enough results",
            ),
          ),
          entryHref,
          trendHref,
          register,
          ask,
        })
      : undefined;
  const tiles = SECTIONS.map((section) => [
    section,
    sectionRows(section, answers, said),
  ])
    .filter(([, rows]) => rows.length > 0)
    .map(([section, rows]) =>
      tile(
        section,
        rows,
        entryHref,
        section.question === MEDICATIONS && classesHref !== undefined
          ? {
              href: classesHref,
              label: "By class",
              title: "Which of these medicines are in a class?",
            }
          : undefined,
      ),
    );
  const lead =
    records === 0
      ? "Nothing here yet."
      : `${records} ${records === 1 ? "record" : "records"}, from ${places.length === 1 ? "one place" : `${places.length} places`}`;
  return html`<h1>${personName(pod, titles)}</h1>
<p class="lead">${lead}</p>
${places.length > 0 && html`<ul class="chips">${places.map((place) => html`<li>${place}</li>`)}</ul>`}
${from !== undefined && html`<p class="note">Brought in the record from ${hospitalName(from)}.</p>`}
${unheld.length > 0 && html`<p class="note">This pod was matched with ${unheld.length === 1 ? "a reference table version" : `${unheld.length} reference table versions`} this app does not hold, and is matched without ${unheld.length === 1 ? "it" : "them"}.</p>`}
${worth}
${changed}
${tiles.length > 0 && html`<div class="tiles">${tiles.map(({ tile }) => tile)}</div>`}
${credits.map((credit) => html`<p class="muted">${credit}</p>`)}
${tiles.map(({ dialog }) => dialog)}
${connection}
${bringIn({ empty: records === 0, person, signIn, findHospital, world })}`;
}

/**
 * What a finding says, by its kind and direction: that a test's results were lower or higher after a medication started
 * or stopped, as a comparison of means in an order. It never says why.
 */
export const CHANGED = {
  "after start": {
    down: (test, medication) =>
      `${test} was lower after ${medication} started.`,
    up: (test, medication) => `${test} was higher after ${medication} started.`,
  },
  "after stop": {
    down: (test, medication) =>
      `${test} was lower after ${medication} stopped.`,
    up: (test, medication) => `${test} was higher after ${medication} stopped.`,
  },
};

/** The view a model can open: the trend of one test, a medication marked. A host registers it with what runs it. */
export const TREND_VIEW = {
  name: "show_trend",
  description:
    "Opens the trend of one lab test over time, the days a medication started and stopped marked on it. It shows what changed after what, never why.",
  inputSchema: {
    type: "object",
    properties: {
      test: { type: "string", description: "A LOINC code such as 18262-6." },
      medication: {
        type: "string",
        description:
          "An RxNorm code such as 617310, or the medication's name where it has no code; none marked if left out.",
      },
    },
    required: ["test"],
    additionalProperties: false,
  },
};

/**
 * While the component is on screen, calls `register(definition)`, and what it gives back when it goes; nothing without
 * `register`. Both happen as the page changes, never after it: a passive effect runs after the next paint, so a view
 * could be registered, or still be registered, once the page had gone.
 */
export function useView(register, definition) {
  useLayoutEffect(() => register?.(definition), [register, definition]);
}

const DAY_MS = 86_400_000;
const timeOf = (text) => Date.parse(`${String(text).slice(0, 10)}T00:00:00Z`);
const dayAt = (time) => day(new Date(time).toISOString());
const monthAt = (time) =>
  new Date(time).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const near = (n) => Math.round(n * 10) / 10;
const resultsSaid = (n) => `${n} ${n === 1 ? "result" : "results"}`;

/** The bare code of an IRI: its last `/` or `#` part. */
function notationOf(code) {
  const last = String(code ?? "")
    .split(/[/#]/)
    .pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** What was left out of a finding's means or a test's results, in words. */
function leftSaid({ unparsed = 0, otherUnit = 0, undated = 0 }) {
  const parts = [
    unparsed > 0 &&
      (unparsed === 1
        ? "1 value that is not a number"
        : `${unparsed} values that are not numbers`),
    otherUnit > 0 && `${resultsSaid(otherUnit)} in another unit`,
    undated > 0 && `${resultsSaid(undated)} with no full date`,
  ].filter(Boolean);
  return parts.length === 0 ? undefined : `Left out: ${listed(parts)}.`;
}

/** The tests a pod's lab rows hold, by name: their code, bare code and name. */
export function testsIn(labs) {
  const tests = new Map();
  for (const row of labs) {
    if (!row.code) continue;
    const kept = tests.get(row.code);
    if (kept === undefined)
      tests.set(row.code, {
        code: row.code,
        notation: notationOf(row.code),
        name: row.test || undefined,
      });
    else if (kept.name === undefined && row.test) kept.name = row.test;
  }
  return [...tests.values()].sort((a, b) =>
    (a.name ?? a.notation ?? "").localeCompare(b.name ?? b.notation ?? ""),
  );
}

/** The trend a finding is about, as `trendHref` takes it: bare codes, the medication's name where it has no code. */
function trendOfFinding({ test, medication }) {
  const drug = medication.notation ?? medication.name;
  return {
    test: test.notation ?? test.code,
    ...(drug ? { medication: drug } : {}),
  };
}

/**
 * The test and medication a trend shows, from what an address asked for: both as asked; with no test, the strongest
 * change's, else the pod's first test; none when the pod holds no lab row. `changes` is `changesIn`'s answer and `labs`
 * the rows of `pod/My lab results`.
 */
export function trendInput({ changes = [], labs = [] }, { test, medication }) {
  if (test) return { test, ...(medication ? { medication } : {}) };
  const strongest = changes.find(
    ({ direction }) => direction !== "not enough results",
  );
  if (strongest !== undefined) return trendOfFinding(strongest);
  const [first] = testsIn(labs);
  return first === undefined
    ? undefined
    : { test: first.notation ?? first.code };
}

/** The medications of `timeline` (`timelineIn`'s answer) as the therapies `changesIn` takes them for: a drug once, from its earliest start to its latest end. */
function therapiesOf(timeline, about = new Map()) {
  const drugs = new Map();
  for (const entry of timeline) {
    const key = entry.notation ?? entry.name;
    const kept = drugs.get(key);
    if (kept === undefined) {
      drugs.set(key, {
        key,
        name: labelled(
          about,
          entry.code,
          entry.name || entry.notation || "Unnamed medication",
        ),
        code: entry.code,
        started: entry.started,
        ended: entry.ended,
      });
      continue;
    }
    if (entry.started && (!kept.started || entry.started < kept.started))
      kept.started = entry.started;
    if (entry.ended && (!kept.ended || entry.ended > kept.ended))
      kept.ended = entry.ended;
  }
  return [...drugs.values()];
}

/** Where a time and a value fall in a drawing of `size`, over the days and numbers of `points` and `marks`. */
function plotOf({ points, marks = [], size }) {
  const { width, height, margin } = size;
  const times = [
    ...points.map(({ time }) => time),
    ...marks.map(({ time }) => time),
  ];
  let from = Math.min(...times);
  let to = Math.max(...times);
  if (from === to) {
    from -= DAY_MS;
    to += DAY_MS;
  }
  const values = points.map(({ value }) => value);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = (high - low) * 0.1 || Math.abs(low) * 0.1 || 1;
  low -= pad;
  high += pad;
  const across = width - margin.left - margin.right;
  const down = height - margin.top - margin.bottom;
  return {
    ...size,
    from,
    to,
    low,
    high,
    x: (time) => margin.left + ((time - from) / (to - from)) * across,
    y: (value) => margin.top + (1 - (value - low) / (high - low)) * down,
  };
}

const SMALL = {
  width: 240,
  height: 84,
  margin: { top: 8, right: 8, bottom: 8, left: 8 },
  radius: 3,
};
const LARGE = {
  width: 640,
  height: 280,
  margin: { top: 30, right: 36, bottom: 34, left: 60 },
  radius: 4,
};

/** `count` values from `from` to `to`, evenly. */
const spread = (count, from, to) =>
  Array.from(
    { length: count },
    (_, at) => from + ((to - from) * at) / (count - 1),
  );

/**
 * A line of results over time, drawn as SVG: one marker for each point, the days in `marks` (`{ time, kind, text }`) as
 * dashed lines across it, and with `axes` the days along the bottom and the numbers at the left, in `unit`. The title and
 * the description are what a screen reader says; the colours are the page's.
 */
function Chart({
  id,
  plot,
  points,
  marks = [],
  unit,
  title,
  desc,
  axes = false,
}) {
  const { width, height, margin, radius, from, to, low, high, x, y } = plot;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const days = (to - from) / DAY_MS;
  return html`<svg class="chart ${axes ? "large" : "small"}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${title}</title>
<desc id="${id}-desc">${desc}</desc>
${axes && spread(4, low, high).map((value) => html`<line class="grid" x1=${margin.left} x2=${right} y1=${near(y(value))} y2=${near(y(value))} /><text class="tick" x=${margin.left - 8} y=${near(y(value)) + 4} text-anchor="end">${rounded(value)}</text>`)}
${axes && spread(5, from, to).map((time) => html`<text class="tick" x=${near(x(time))} y=${bottom + 20} text-anchor="middle">${days >= 150 ? monthAt(time) : dayAt(time)}</text>`)}
${axes && html`<text class="tick" transform="translate(14 ${near(margin.top + (bottom - margin.top) / 2)}) rotate(-90)" text-anchor="middle">${unit}</text>`}
${marks.map(({ time, kind, text }) => html`<line class="mark ${kind}" x1=${near(x(time))} x2=${near(x(time))} y1=${margin.top} y2=${bottom} />${axes && html`<text class="tick" x=${near(x(time))} y=${margin.top - 10} text-anchor=${x(time) > width / 2 ? "end" : "start"}>${text}</text>`}`)}
<polyline class="series" fill="none" points=${sorted.map(({ time, value }) => `${near(x(time))},${near(y(value))}`).join(" ")} />
${sorted.map(({ time, value }) => html`<circle class="marker" cx=${near(x(time))} cy=${near(y(value))} r=${radius}><title>${dayAt(time)}: ${rounded(value)} ${unit}</title></circle>`)}
</svg>`;
}

/** The medications of `drugs` as bars from their start to their stop, to the right edge while one has none, along the days of `plot`. */
function Lane({ id, plot, drugs, chosen, title, desc }) {
  const { width, margin, from, to, x } = plot;
  const rowHeight = 32;
  const height = drugs.length * rowHeight + 8;
  return html`<svg class="chart lane" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${title}</title>
<desc id="${id}-desc">${desc}</desc>
${drugs.map((drug, at) => {
  const top = 4 + at * rowHeight;
  const start = drug.started ? timeOf(drug.started) : undefined;
  const end = drug.ended ? timeOf(drug.ended) : to;
  const drawn = start !== undefined && start <= to && end >= from;
  const left = drawn ? x(Math.max(start, from)) : margin.left;
  const across = drawn ? Math.max(2, x(Math.min(end, to)) - left) : 0;
  const on = drug === chosen;
  return html`<text class="lane-label${on ? " chosen" : ""}" x=${margin.left} y=${top + 11}>${drug.name}</text>${drawn && html`<rect class="bar${on ? " chosen" : ""}" x=${near(left)} y=${top + 16} width=${near(across)} height="8" rx="4"><title>${drug.name}: ${drug.started ? `from ${day(drug.started)}` : "start not known"}${drug.ended ? ` to ${day(drug.ended)}` : ", not stopped"}</title></rect>`}`;
})}
</svg>`;
}

/** The unit most of `results` carry, the earliest on a tie. */
function unitOf(results) {
  const counts = new Map();
  for (const { unit } of results) counts.set(unit, (counts.get(unit) ?? 0) + 1);
  let chosen = "";
  let most = 0;
  for (const [unit, count] of counts)
    if (count > most) {
      chosen = unit;
      most = count;
    }
  return chosen;
}

function Trend({
  pod,
  titles,
  back,
  labs,
  series,
  timeline,
  test,
  medication,
  trendHref,
  about = new Map(),
  register,
  ask,
}) {
  useView(register, TREND_VIEW);
  const backLink = html`<p><a href=${back}>Back to ${personName(pod, titles)}</a></p>`;
  if (series === undefined)
    return html`${backLink}
<h1>Not found</h1>
<p>${test === undefined ? "This pod holds no lab results to show a trend of." : `This pod holds no results for the test ${test}.`}</p>`;
  const name = trendTitle(series, about);
  const drugs = therapiesOf(timeline, about);
  const wanted = medication?.toLowerCase();
  const chosen =
    medication === undefined
      ? undefined
      : drugs.find(
          (drug) =>
            drug.key === medication ||
            drug.code === medication ||
            drug.name.toLowerCase() === wanted,
        );
  const unit = unitOf(series.results);
  const drawn = series.results.filter((result) => result.unit === unit);
  const points = drawn.map(({ date, value }) => ({
    time: timeOf(date),
    value,
  }));
  const marks =
    chosen === undefined
      ? []
      : [
          chosen.started && {
            time: timeOf(chosen.started),
            kind: "start",
            text: `${chosen.name} started`,
          },
          chosen.ended && {
            time: timeOf(chosen.ended),
            kind: "stop",
            text: `${chosen.name} stopped`,
          },
        ].filter(Boolean);
  const link = (given) =>
    trendHref({
      test: series.test.notation ?? series.test.code,
      ...(chosen ? { medication: chosen.key } : {}),
      ...given,
    });
  const left = leftSaid(series.left);
  const unplotted = series.results.length - drawn.length;
  let chart;
  if (points.length > 0) {
    const plot = plotOf({ points, marks, size: LARGE });
    const values = points.map(({ value }) => value);
    const described = `${resultsSaid(points.length)} from ${dayAt(Math.min(...points.map(({ time }) => time)))} to ${dayAt(Math.max(...points.map(({ time }) => time)))}, from ${rounded(Math.min(...values))} to ${rounded(Math.max(...values))} ${unit}.${marks.map(({ time, text }) => ` ${text} ${dayAt(time)}.`).join("")}`;
    chart = html`<${Chart} id="trend-chart" plot=${plot} points=${points} marks=${marks} unit=${unit} title=${name} desc=${described} axes />
<${Lane} id="trend-lane" plot=${plot} drugs=${drugs} chosen=${chosen} title="Medications" desc=${drugs.length === 0 ? "No medication." : drugs.map((drug) => `${drug.name}${drug.started ? ` from ${dayAt(timeOf(drug.started))}` : ", start not known"}${drug.ended ? ` to ${dayAt(timeOf(drug.ended))}` : ", not stopped"}.`).join(" ")} />`;
  }
  const picked = (on) => (on ? "true" : undefined);
  return html`${backLink}
<h1>${name}</h1>
<p class="lead">${series.results.length === 0 ? "No result of this test is a number." : `${resultsSaid(series.results.length)}${unit === "" ? "" : `, in ${unit}`}`}${ask && askButton({ kind: "trend", test: series.test.notation ?? series.test.code, ...(chosen ? { medication: chosen.key } : {}) }, chosen ? `${name} and ${chosen.name}` : name)}</p>
${medication !== undefined && chosen === undefined && html`<p class="note">This pod holds no medication ${medication}.</p>`}
${chart && html`<div class="card trend">${chart}${unplotted > 0 && html`<p class="muted">The chart leaves out ${resultsSaid(unplotted)} in another unit; the table lists ${unplotted === 1 ? "it" : "them"}.</p>`}</div>`}
<div class="card"><h2>Results</h2>
${left && html`<p class="muted">${left}</p>`}
<div class="scroll"><table>
<thead><tr><th>Date</th><th>Value</th><th>Unit</th></tr></thead>
<tbody>
${series.results.map((result) => html`<tr><td>${day(result.date)}</td><td>${rounded(result.value)}</td><td>${result.unit}</td></tr>`)}
</tbody>
</table></div></div>
<div class="card picker"><h2>Show</h2>
<h3>Test</h3>
<ul>${testsIn(labs).map((each) => html`<li><a href=${link({ test: each.notation ?? each.code })} aria-current=${picked((each.notation ?? each.code) === (series.test.notation ?? series.test.code))}>${each.name ?? each.notation ?? each.code}</a></li>`)}</ul>
<h3>Medication marked</h3>
<ul><li><a href=${trendHref({ test: series.test.notation ?? series.test.code })} aria-current=${picked(chosen === undefined)}>None</a></li>
${drugs.map((drug) => html`<li><a href=${link({ medication: drug.key })} aria-current=${picked(drug === chosen)}>${drug.name}</a></li>`)}</ul>
</div>`;
}

/**
 * The trend of one test, a medication marked: a chart of the results with the days the medication started and stopped
 * dashed across it, each medication as a bar under it, a table of the results and links to pick another test or
 * medication. It states what changed after what, never why.
 *
 * - `pod`, `back`: the pod's name and the address of its page;
 * - `labs`: the rows of `pod/My lab results`, for the tests to pick from;
 * - `series`: `labSeriesIn`'s answer for the test, or undefined when the pod holds none: the page says so;
 * - `timeline`: `timelineIn`'s answer over the pod's medication history;
 * - `test`, `medication`: as asked; `medication` is a bare RxNorm code, or a name, and none is marked when it names
 *   none the pod holds;
 * - `trendHref({ test, medication })`: the address of a trend, which the links of the picker go to;
 * - `about`: what the tables say of the codes of the pod's lab results and medication history, as the card names them;
 *   the page names the test and the medications by it where it names the code, else by the record's own text;
 * - `register(view)`: as `podPage` takes it;
 * - `ask`: as `podPage` takes it; the page has an "Ask about this" button for the test and the medication marked.
 */
export function trendPage(props) {
  return html`<${Trend} ...${props} />`;
}

/** The name a trend page and its tab give the test: the tables' where they name its code, else the record's own text. */
export function trendTitle(series, about = new Map()) {
  const { code, name, notation } = series.test;
  return labelled(about, code, name ?? notation ?? code);
}

/** One finding as a card: what changed, the means, what was left out, a small chart and the links to its results and trend. */
function Change({ finding, names, trendHref, ask }) {
  const { key, kind, unit, before, after, left, rows } = finding;
  const id = `change-${slug(key)}`;
  const points = [...rows.before, ...rows.after].map((row) => ({
    time: timeOf(row.performed),
    value: Number(row.value),
  }));
  const marks = [
    {
      time: timeOf(finding.medication.date),
      kind: kind === "after start" ? "start" : "stop",
      text: "",
    },
  ];
  const plot = plotOf({ points, marks, size: SMALL });
  const sentence = sentenceOf(finding, names);
  const forgone = leftSaid(left);
  const shown = rows.before.length + rows.after.length + rows.left.length;
  return html`<div class="change">
<p class="said">${sentence}</p>
<p>${rounded(before.mean)} → ${rounded(after.mean)} ${unit}, the mean of ${resultsSaid(before.count)} before and ${after.count} after.</p>
${forgone && html`<p class="muted">${forgone}</p>`}
<${Chart} id=${id} plot=${plot} points=${points} marks=${marks} unit=${unit} title=${names.test} desc="${resultsSaid(points.length)} from ${dayAt(Math.min(...points.map((point) => point.time)))} to ${dayAt(Math.max(...points.map((point) => point.time)))}. ${names.medication} ${kind === "after start" ? "started" : "stopped"} ${day(finding.medication.date)}." />
<p class="row"><a href="#${id}">Show the ${resultsSaid(shown)}</a>${trendHref !== undefined && html` <a href=${trendHref(trendOfFinding(finding))}>Open the trend</a>`}${ask && askButton({ kind: "finding", key }, sentence)}</p>
</div>`;
}

const LAB_SECTION = SECTIONS.find(({ question }) => question === LABS);

/** The tables' name for `code` where it names it, else `own`. */
const labelled = (about, code, own) =>
  (code === undefined ? undefined : about.get(code)?.name?.label) ?? own;

/** A finding's test and medication as the page names them: by the tables' `about` where it names the code, else by the record's own text. */
function changeNames(finding, about) {
  const { test, medication } = finding;
  return {
    test: labelled(about, test.code, test.name ?? test.notation ?? test.code),
    medication: labelled(
      about,
      medication.code,
      medication.name || medication.notation || "an unnamed medication",
    ),
  };
}

/** What a finding says, in the words the page uses for it: its card, its "Ask about this" label and the chat's finding card. */
export function changeSaid(finding, about = new Map()) {
  return sentenceOf(finding, changeNames(finding, about));
}

function sentenceOf({ kind, direction }, { test, medication }) {
  return capitalised(CHANGED[kind][direction](test, medication));
}

/** The most questions an empty chat offers. */
const SUGGESTED = 4;

/**
 * The questions an empty chat offers, as texts: at most `SUGGESTED`, in a fixed order, the same for the same input,
 * and each only when the pod holds what answers it. First "Find anything interesting in this pod", when What changed
 * has a change or Worth a look has a line (`worth_a_look` gives the lines); then, for each change shown, strongest first, "Did <test> change after
 * <medication> started?" (or "stopped"), named as its card names them; last "Which medications have I stopped?", when a
 * medication of the history has an end date. The changes make room for the other two. `answers` holds the rows of each
 * of `QUESTIONS`, by question, and `changes`, `about` and `said` are as `podPage` takes them.
 */
export function suggestedQuestions(
  answers,
  { changes = [], about = new Map(), said },
) {
  const shown = changes.filter(
    ({ direction }) => direction !== "not enough results",
  );
  const first =
    shown.length > 0 || worthALook(answers, about, said).length > 0
      ? ["Find anything interesting in this pod"]
      : [];
  const last = (answers[HISTORY] ?? []).some((row) => row.ended)
    ? ["Which medications have I stopped?"]
    : [];
  const changed = [
    ...new Set(
      shown.map((finding) => {
        const names = changeNames(finding, about);
        return `Did ${names.test} change after ${names.medication} ${finding.kind === "after start" ? "started" : "stopped"}?`;
      }),
    ),
  ].slice(0, SUGGESTED - first.length - last.length);
  return [...first, ...changed, ...last];
}

/** A statement's field in words: `…/clinical/v1#endDate` is `end date`. */
const fieldSaid = (field) =>
  field
    .split(/[#/]/)
    .at(-1)
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase();

/** A statement's value as a person reads it: a day as its date, a thing by its label, an address by its last part. */
function valueSaid({ value, valueLabel }) {
  if (valueLabel !== undefined) return valueLabel;
  if (/^\d{4}-\d\d-\d\d/.test(value)) return day(value);
  return isCode(value) ? value.split(/[#/:]/).at(-1) : value;
}

/** What differs between two versions' statements, status first: `{ field, before, after }`, each side a list of values. */
function differences(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((field) => {
      const [was, now] = [before.get(field) ?? [], after.get(field) ?? []];
      return was.join("\n") === now.join("\n")
        ? []
        : [{ field: fieldSaid(field), before: was, after: now }];
    })
    .sort(
      (a, b) => Number(b.field === "status") - Number(a.field === "status"),
    );
}

/**
 * `answers` with the rows of `MECHANISM` added when `podPage` would draw them: the pod holds two imports or more and
 * `changes` (as `changesIn` gives them) has a shown change of a medication. Otherwise `answers` as it is, and the two
 * questions are never asked; `ask` gives a question's rows.
 */
export async function withMechanism(answers, changes, ask) {
  const imports = new Set((answers[IMPORTS] ?? []).map((row) => row.import));
  const shown = changes.some(
    ({ direction, medication }) =>
      direction !== "not enough results" && medication.entry,
  );
  if (imports.size < 2 || !shown) return answers;
  const rows = await Promise.all(
    MECHANISM.map(async (question) => [question, await ask(question)]),
  );
  return { ...answers, ...Object.fromEntries(rows) };
}

/**
 * How the pod came to hold what What changed reads, from the rows of the imports, the revisions and the versions in
 * `answers`; none until the pod holds two imports.
 *
 * - `pulls`: the imports, in the order they began, each `{ label, started, hospital, retrieved, brought, revised }`;
 *   `hospital` and `retrieved` only when a document says them, `brought` is how many records it brought in and `revised`
 *   how many of those were a new version of a record already held;
 * - `revisions`: for each medication of `findings` whose record has more than one version, `{ finding, steps }`, a step
 *   `{ from, to, pull, arrived, said }` for each arrival after the first: the versions numbered in the order they came,
 *   the number of the pull that brought `to`, and `said`, what differs between the two, as `differences` gives it.
 */
export function howOf(answers, findings) {
  const imports = new Map();
  for (const row of answers[IMPORTS] ?? []) {
    const each = imports.get(row.import) ?? {
      label: row.importLabel,
      started: row.started,
      records: new Set(),
    };
    each.records.add(row.record);
    imports.set(row.import, each);
  }
  if (imports.size < 2) return undefined;
  const arrivals = answers[REVISIONS] ?? [];
  const pulls = [...imports].map(([id, each]) => {
    const own = arrivals.filter((row) => row.import === id);
    const document = own.find(
      (row) => row.hospital !== undefined || row.retrieved !== undefined,
    );
    return {
      label: each.label,
      started: each.started,
      ...(document?.hospital !== undefined && { hospital: document.hospital }),
      ...(document?.retrieved !== undefined && {
        retrieved: document.retrieved,
      }),
      brought: each.records.size,
      revised: new Set(
        own
          .filter((row) => row.previous !== undefined)
          .map((row) => row.record),
      ).size,
    };
  });
  const stated = new Map();
  for (const row of answers[VERSIONS] ?? []) {
    const fields = stated.get(row.version) ?? new Map();
    fields.set(
      row.field,
      [...(fields.get(row.field) ?? []), valueSaid(row)].sort(),
    );
    stated.set(row.version, fields);
  }
  const statements = (version) => stated.get(version) ?? new Map();
  const ids = [...imports.keys()];
  const medications = [
    ...new Map(
      findings
        .filter(({ medication }) => medication.entry)
        .map((finding) => [finding.medication.entry, finding]),
    ).values(),
  ];
  const revisions = medications.flatMap((finding) => {
    const records = new Set(
      (answers[SOURCES] ?? [])
        .filter((row) => row.entry === finding.medication.entry)
        .map((row) => row.record),
    );
    return [...records].flatMap((record) => {
      const seen = new Set();
      const arrived = arrivals.filter(
        (row) =>
          row.record === record &&
          !seen.has(row.revision) &&
          seen.add(row.revision),
      );
      const versions = [...new Set(arrived.map((row) => row.version))];
      const steps = arrived.slice(1).map((row, at) => ({
        from: versions.indexOf(arrived[at].version) + 1,
        to: versions.indexOf(row.version) + 1,
        pull: ids.indexOf(row.import) + 1,
        arrived: row.arrived,
        said: differences(
          statements(arrived[at].version),
          statements(row.version),
        ),
      }));
      return steps.length === 0 ? [] : [{ finding, steps }];
    });
  });
  return { pulls, revisions };
}

/** The values of one side of a difference, or `none`. */
const valuesSaid = (values) =>
  values.length === 0 ? "none" : values.join(", ");

/** One pull as the mechanism lists it: from where, retrieved when (else the day it came in), and what it brought in. */
function pullSaid({ label, started, hospital, retrieved, brought, revised }) {
  const records = `${brought} ${brought === 1 ? "record" : "records"}`;
  const when =
    retrieved === undefined ? day(started) : `retrieved ${day(retrieved)}`;
  const newer =
    revised === 0
      ? ""
      : revised === 1
        ? ", 1 of them a new version of one the pod already held"
        : `, ${revised} of them new versions of records the pod already held`;
  return `From ${placeName(hospital ?? label)}, ${when}: ${records}${newer}.`;
}

/** The mechanism behind What changed, as `howOf` gives it: the pulls in order, and each medication's versions. */
function How({ how, about }) {
  return html`<div class="how">
<h3>Where this comes from</h3>
<p>The pod's records came in ${how.pulls.length} imports, in this order:</p>
<ol>${how.pulls.map((pull) => html`<li>${pullSaid(pull)}</li>`)}</ol>
${how.revisions.flatMap(({ finding, steps }) => steps.map((step) => html`<p>${capitalised(changeNames(finding, about).medication)} came in a new version: version ${step.from} to version ${step.to}, in import ${step.pull}, on ${day(step.arrived)}.${step.said.length > 0 && html` ${capitalised(step.said.map(({ field, before, after }) => `${field} ${valuesSaid(before)} → ${valuesSaid(after)}`).join("; "))}.`}</p>`))}
</div>`;
}

function Changed({ changes, about, how, entryHref, trendHref, register, ask }) {
  useView(register, TREND_VIEW);
  const shown = changes.filter(
    ({ direction }) => direction !== "not enough results",
  );
  const thin = changes.filter(
    ({ direction }) => direction === "not enough results",
  );
  const boxes = shown.map((finding) => {
    const { rows } = finding;
    const all = [...rows.before, ...rows.after, ...rows.left];
    return box(
      `change-${slug(finding.key)}`,
      `${changeNames(finding, about).test} results`,
      html`${rows.left.length > 0 && html`<p class="muted">${rows.left.length} of these ${rows.left.length === 1 ? "was" : "were"} left out of the means.</p>`}
<${Table} section=${LAB_SECTION} rows=${opening(LAB_SECTION, all)} entryHref=${entryHref} />`,
      { wide: true },
    );
  });
  if (thin.length > 0)
    boxes.push(
      box(
        "too-few",
        "Too few results to say anything",
        html`<ul>${thin.map((finding) => {
          const names = changeNames(finding, about);
          return html`<li>${capitalised(names.test)} and ${names.medication}, ${finding.kind === "after start" ? "started" : "stopped"} ${day(finding.medication.date)}: ${resultsSaid(finding.before.count)} before, ${finding.after.count} after.${trendHref !== undefined && html` <a href=${trendHref(trendOfFinding(finding))}>Open the trend</a>`}</li>`;
        })}</ul>`,
      ),
    );
  return html`<div class="card changes"><h2>What changed</h2>
${shown.length === 0 ? html`<p>Nothing stands out yet.</p>` : shown.map((finding) => html`<${Change} key=${finding.key} finding=${finding} names=${changeNames(finding, about)} trendHref=${trendHref} ask=${ask} />`)}
${thin.length > 0 && html`<p>${thin.length} ${thin.length === 1 ? "pair" : "pairs"} of a medication and a test had too few results to say anything. <a href="#too-few">Show ${thin.length === 1 ? "it" : "them"}</a></p>`}
${shown.length > 0 && how !== undefined && html`<${How} how=${how} about=${about} />`}
<p class="muted">These say what changed after what, never why. A clinician can say why.</p>
</div>
${boxes}`;
}

/**
 * The part of a pod's page that says what changed in its lab results after a medication started or stopped, as
 * `changesIn` gives it: a card for each change, strongest first, with its means, a small chart and links to the results
 * behind it and to its trend; one line for the pairs with too few results to say anything. `about`, `entryHref`,
 * `trendHref`, `register` and `ask` are as `podPage` takes them; with `ask`, each card has an "Ask about this" button
 * carrying its finding's key. With `how`, as `howOf` gives it, the card says how the pod came to hold what it reads: the
 * pulls in order and the medication's versions.
 */
export function changedPart(props) {
  return html`<${Changed} ...${props} />`;
}

/**
 * The card that brings in more: a sign-in button per hospital holding the demo person, and "Find a hospital". It
 * says nothing of what a hospital holds: nothing here asks it. With `world`, the date the hospitals answer as of and the
 * way to change it come first, where a sign-in begins.
 */
function bringIn({ empty, person, signIn, findHospital, world }) {
  return html`<div class="card">
<h2>${empty ? "Bring in records" : "Bring in more"}</h2>
<p>Sign in at a hospital, see what it has, and bring it into this pod.</p>
${world !== undefined && worldDateLine(world)}
<div class="row">${(person?.at ?? []).map(signIn)}<a class="button quiet" href=${findHospital}>Find a hospital</a></div>
</div>`;
}

/** An entry's part in an address: the last `:`-separated part of its IRI, which a host never turns back into one. */
export function entryId(entry) {
  return entry.split(":").at(-1);
}

/** The held series that holds the version `origin`, with that version; none when no series does. */
function heldAt(origin, held) {
  const series = held.find(({ versions }) =>
    versions.some(({ iri }) => iri === origin),
  );
  return series === undefined
    ? undefined
    : { series, version: series.versions.find(({ iri }) => iri === origin) };
}

/** What names a code's page: the series of the version its name, else its status, else its ingredients came from. */
function seriesOf(said, held) {
  for (const part of [said?.name, said?.status, said?.ingredients]) {
    const found = part === undefined ? undefined : heldAt(part.origin, held);
    if (found !== undefined) return found.series;
  }
  return undefined;
}

/**
 * The table versions the matcher's counting Sames of each entry's records cite, by the entry's IRI, as the vocabulary's
 * `tables/joined-by.rq` gives them (`pod.joinedBy()`). A version the app does not hold is left out by `entryOf`.
 */
export async function joinedBy(pod) {
  const joined = new Map();
  for (const { entry, used } of await pod.joinedBy())
    joined.set(entry, [...(joined.get(entry) ?? []), used]);
  return joined;
}

/** What Cascade did with an entry seen more than once, as `seenAt` gives it, in a sentence about the entry itself. */
function seenSaid({ places, across }, one) {
  return across > 1
    ? `Cascade recorded it ${where(places)} and keeps it as one ${one}.`
    : `It arrived more than once${places.length === 0 ? "" : ` from ${places[0]}`}. Cascade keeps it as one ${one}.`;
}

/**
 * A line for each document an entry's source rows came from, the oldest arrival first, as `entryOf`'s `where`;
 * `issued` is the date of the report each document held, by document, which the line says when it has one.
 */
function linesOf(rows, issued = new Map()) {
  const lines = new Map();
  for (const row of rows) {
    const document = row.document ?? row.record;
    const at = lines.get(document);
    if (at === undefined)
      lines.set(document, {
        place: placeOf(row),
        ...(issued.has(document) && { issued: issued.get(document) }),
        ...(row.retrieved !== undefined && { retrieved: row.retrieved }),
        arrived: row.arrived,
        ...(row.hospital !== undefined &&
          row.importLabel !== undefined && { importLabel: row.importLabel }),
        records: new Set([row.record]),
      });
    else {
      at.records.add(row.record);
      if (compare("date", row.arrived ?? "", at.arrived ?? "") < 0)
        at.arrived = row.arrived;
    }
  }
  return [...lines.values()]
    .map((line) => ({ ...line, records: line.records.size }))
    .sort((a, b) => compare("date", a.arrived ?? "", b.arrived ?? ""));
}

/** What the tables say of each of `codes`, as `entryOf`'s `known` lines: those of a table among `held` only. */
function claimsOf(codes, about, held) {
  const known = [];
  for (const code of codes) {
    const said = about.get(code);
    if (said === undefined) continue;
    const notation = said.notation ?? codeShown(code);
    const claim = (part, sentence) => {
      const from = heldAt(part.origin, held);
      if (from !== undefined) known.push({ sentence, from });
    };
    if (said.name !== undefined)
      claim(said.name, `${notation} is named "${said.name.label}".`);
    if (said.status?.deprecated === true) {
      const instead = said.status.replacedBy.map(
        (each) => about.get(each)?.notation ?? codeShown(each),
      );
      claim(
        said.status,
        `${notation} is retired${instead.length === 0 ? "" : `, replaced by ${listed(instead)}`}.`,
      );
    }
    if ((said.ingredients?.codes.length ?? 0) > 0) {
      const names = said.ingredients.codes.map(
        (each) => about.get(each)?.name?.label ?? codeShown(each),
      );
      claim(
        said.ingredients,
        `${notation} ${names.length === 1 ? "has the ingredient" : "has the ingredients"} ${listed(names)}.`,
      );
    }
  }
  return known;
}

/**
 * What a variant entry's page says that no other kind's does, from `variantReports`: `what`, its genes and expressions
 * as written; `codes`, its ClinVar IDs, linked to the series `said` read them from when `held` holds it; `issued`, the
 * date of each report by the document it came from, which is a document of the variant too; and `known`, each report
 * oldest first, what ClinVar says today with the table it was read from, then the counsellor sentence.
 */
function variantFacts(answers, entry, said, held) {
  const { name, asked, reports, clinvar, from, namedFrom } = variantReports(
    answers,
    said,
    held,
  ).get(entry);
  const genes = [
    ...new Set(
      (answers[VARIANTS] ?? [])
        .filter((row) => row.variant === entry)
        .flatMap(({ gene }) => gene ?? []),
    ),
  ];
  const facts = [
    [genes.length === 1 ? "Gene" : "Genes", genes],
    [asked.hgvs.length === 1 ? "Expression" : "Expressions", asked.hgvs],
  ];
  const series = held.find(({ iri }) => iri === said?.says.get(entry)?.series);
  const dates = new Map(
    (answers[REPORTS] ?? []).map(({ report, date }) => [report, date]),
  );
  const issued = new Map();
  for (const { report } of reports)
    for (const row of answers[SOURCES] ?? [])
      if (
        row.entry === report &&
        row.document !== undefined &&
        dates.get(report) !== undefined &&
        !issued.has(row.document)
      )
        issued.set(row.document, dates.get(report));
  return {
    what: facts
      .filter(([, texts]) => texts.length > 0)
      .map(([head, texts]) => ({ head, text: texts.join(", ") })),
    codes: asked.variations.map((notation) => ({
      notation,
      ...(series !== undefined && { series }),
    })),
    issued,
    differs: reports.some(({ tag }) => tag === DIFFERS),
    known: [
      ...(namedFrom === undefined
        ? []
        : [
            {
              sentence: `ClinVar names this variation ${name}.`,
              from: namedFrom,
            },
          ]),
      ...reports.map(({ sentence, tag }) => ({
        sentence,
        ...(tag !== undefined && { tag }),
      })),
      ...(clinvar === undefined
        ? []
        : [{ sentence: clinvar, ...(from !== undefined && { from }) }]),
      { sentence: COUNSELLOR },
    ],
  };
}

/**
 * The entry whose address part is `id` (see `entryId`), as its page reads it, or undefined when no row of "Where it
 * came from" has it. `answers` holds the rows of each of `QUESTIONS`, by question; `about` is `codesSaid`'s answer, and
 * `held` the tables' `held()`, both empty until the tables can say; `joined` is `joinedBy`'s answer, which names on the
 * entry's seen-more-than-once line the held table version whose rows joined its records.
 *
 * - `entry`, `name`, `kind` (`allergy`) and `tags`, as a row of its section has them: `Retired code`, `Needs review`
 *   when What needs review names it (an entry no section shows too), and `Differs` when a report of a variant does;
 * - `what`: the section's columns after the name, as `{ head, text }`; `recorded`, the record's own name when the tables
 *   named it otherwise; and `codes`, each `{ notation, series }`, the series that names it when one is held;
 * - `where`: a line for each document the entry's records came from, a record with none its own, the oldest arrival
 *   first, each `{ place, issued, retrieved, arrived, importLabel, records }`; `importLabel` only when a hospital is the place, `issued` only on a variant's line a report also came from;
 * - `known`: what Cascade did, each review line tagged `Needs review`, each pair of medications that share an ingredient
 *   the entry is one of, then what the tables say of each code, as `{ sentence, tag, from }`, a table's claim with
 *   `from`, the `{ series, version }` among `held` it came from; and `credits`, each cited series' once.
 *
 * An entry no section shows is named and kinded from its label, and has no columns or codes.
 *
 * A variant (the Genetic variants section's) has instead, by `variantFacts`: its genes and expressions for `what`, its
 * ClinVar IDs for `codes`, the date of each report on the `where` line of its document as `issued`, and `known` lines
 * for each report, ClinVar today and the counsellor sentence; `said` is `variantsSaid`'s answer, none until the tables
 * can say.
 */
export function entryOf(
  answers,
  id,
  { about = new Map(), said, held = [], joined = new Map() } = {},
) {
  const sources = answers[SOURCES] ?? [];
  const entry = sources.find((row) => entryId(row.entry) === id)?.entry;
  if (entry === undefined) return undefined;
  const ofEntry = (rows) => rows.filter((row) => row.entry === entry);
  const section = SECTIONS.find(
    (each) => ofEntry(sectionRows(each, answers, said)).length > 0,
  );
  const rows =
    section === undefined ? [] : ofEntry(sectionRows(section, answers, said));
  const variant =
    section?.one === "variant"
      ? variantFacts(answers, entry, said, held)
      : undefined;
  const label = [
    ...rows,
    ...ofEntry(sources),
    ...ofEntry(answers[REVIEW] ?? []),
  ]
    .map((row) => row.entryLabel)
    .find((each) => each !== undefined);
  const labelled = fromLabel(label);
  const kind = section?.one ?? labelled.one;
  const namings = rows.map((row) => namingOf(section, row, about));
  const given = namings.find((each) => each.label !== undefined)?.label;
  const own = rows.map((row) => row[section.field]).find(Boolean);
  const title = given ?? (own || labelled.name);

  const codes = [
    ...new Set(
      rows
        .flatMap((row) => section.codes.map((column) => row[column]))
        .filter(isCode),
    ),
  ];

  const known = [];
  const seen = seenAt(answers).get(entry);
  const matched = [
    ...new Map(
      (joined.get(entry) ?? []).flatMap((used) => {
        const at = heldAt(used, held);
        return at === undefined ? [] : [[used, at]];
      }),
    ).values(),
  ];
  const how = (at) => ({ from: at, fromLead: "Matched using" });
  if (seen !== undefined)
    known.push({
      sentence: seenSaid(seen, kind),
      ...(matched.length > 0 && how(matched.shift())),
    });
  else if (matched.length > 0)
    known.push({
      sentence: `Cascade keeps it as one ${kind}.`,
      ...how(matched.shift()),
    });
  for (const at of matched)
    known.push({ from: at, fromLead: "Also matched using" });
  const reviews = new Map();
  for (const row of ofEntry(answers[REVIEW] ?? []))
    reviews.set(
      reviewKey(row),
      capitalised(reviewSaid(row, { name: title, one: kind })),
    );
  for (const sentence of reviews.values())
    known.push({ sentence, tag: NEEDS_REVIEW });
  for (const { sentence, entries } of sharedIngredients(
    named(answers, about),
    about,
  )) {
    const origin = entries.find((each) => each.entry === entry)?.origin;
    const from = origin === undefined ? undefined : heldAt(origin, held);
    if (from !== undefined)
      known.push({ sentence: capitalised(sentence), from });
  }
  known.push(...claimsOf(codes, about, held));
  if (variant !== undefined) known.push(...variant.known);

  return {
    entry,
    name: title === UNNAMED ? `An unnamed ${kind}` : title,
    kind,
    tags: tagsOf({
      differs: variant?.differs === true,
      review: reviews.size > 0,
      retired: namings.some((each) => each.retired),
    }),
    what:
      variant !== undefined
        ? variant.what
        : section === undefined
          ? []
          : section.columns.slice(1).flatMap((column) => {
              const texts = [
                ...new Set(
                  rows.map((row) => column.show(row) ?? "").filter(Boolean),
                ),
              ];
              return texts.length === 0
                ? []
                : [{ head: column.head, text: texts.join(", ") }];
            }),
    ...(given !== undefined &&
      own !== undefined &&
      own !== given && { recorded: own }),
    codes:
      variant !== undefined
        ? variant.codes
        : codes.map((code) => {
            const series = seriesOf(about.get(code), held);
            return {
              notation: about.get(code)?.notation ?? codeShown(code),
              ...(series !== undefined && { series }),
            };
          }),
    ...(section?.one === "lab result" && { testCodes: codes }),
    where: linesOf(ofEntry(sources), variant?.issued),
    known,
    credits: [
      ...new Set(known.flatMap(({ from }) => from?.series.credit ?? [])),
    ],
  };
}

/**
 * The LOINC panels the held panel members tables list the lab result `entry` (`entryOf`'s answer) in, as `entryPage`
 * takes them: for each version among `held` that lists its test code in a panel, its series and version and the panels
 * with their requirement. Nothing for an entry that is no lab result, or when the tables cannot say.
 */
export async function panelsOf(entry, { tables, held }) {
  const found = await Promise.all(
    (entry?.testCodes ?? []).map((code) => tables.inPanels(code)),
  );
  return found.flat().flatMap((each) => {
    const at = heldAt(each.version, held);
    return at === undefined ? [] : [{ ...each, ...at }];
  });
}

/**
 * An entry's page, as a person reads it: its name and tags, what it is, where it came from and what else is known, each
 * part absent when it has nothing to say but where it came from. `entry` is `entryOf`'s answer, none when the entry is
 * not in the pod. `back` is the pod's address; a code with a series is a link to `codeHref(series, notation)`, and
 * the version a table's claim comes from a link to `tableHref(series)`. With `ask`, as `podPage` takes it, the page has
 * an "Ask about this" button for the entry. A lab result's `panels` (`panelsOf`'s answer, none until the tables can
 * say) are the panels LOINC lists its test in, each a link to `panelHref(code)`.
 */
export function entryPage({
  entry,
  pod,
  titles,
  back,
  codeHref,
  tableHref,
  ask,
  panels = [],
  panelHref,
}) {
  const backLink = html`<p><a href=${back}>Back to ${personName(pod, titles)}</a></p>`;
  if (entry === undefined)
    return html`${backLink}
<h1>Not found</h1>
<p>This entry is no longer in this pod.</p>`;
  const { name, kind, tags, what, recorded, codes, known, credits } = entry;
  const facts = [
    ...(recorded === undefined
      ? []
      : [{ head: "Recorded as", text: recorded }]),
    ...what,
  ];
  const shown = (code, at) =>
    html`${at > 0 && ", "}${code.series === undefined ? code.notation : html`<a href=${codeHref(code.series, code.notation)}>${code.notation}</a>`}`;
  return html`${backLink}
<h1>${name}${tags.map(tagged)}</h1>
<p class="lead">${capitalised(kind)}${ask && askButton({ kind: "entry", id: entryId(entry.entry) }, name)}</p>
${
  (facts.length > 0 || codes.length > 0) &&
  html`<div class="card entry"><h2>What it is</h2><dl class="facts">
${facts.map(({ head, text }) => html`<dt>${head}</dt><dd>${text}</dd>`)}
${codes.length > 0 && html`<dt>${codes.length === 1 ? "Code" : "Codes"}</dt><dd>${codes.map(shown)}</dd>`}
</dl></div>`
}
<div class="card entry"><h2>Where it came from</h2><ul>
${entry.where.map(
  ({ place, issued, retrieved, arrived, importLabel, records }) =>
    html`<li><strong>${place}</strong> <span class="muted">${[
      issued !== undefined && `report of ${day(issued)}`,
      retrieved !== undefined && `retrieved ${day(retrieved)}`,
      arrived !== undefined &&
        `arrived ${day(arrived)}${importLabel === undefined ? "" : ` through ${importLabel}`}`,
      records > 1 && `${records} records`,
    ]
      .filter(Boolean)
      .join("; ")}</span></li>`,
)}
</ul></div>
${
  known.length > 0 &&
  html`<div class="card entry"><h2>What else is known</h2><ul>
${known.map(
  ({ sentence, tag, from, fromLead = "From" }) =>
    html`<li>${sentence}${tag !== undefined && tagged(tag)}${from !== undefined && html` <span class="muted from">${fromLead} ${from.series.label}, <a href=${tableHref(from.series)}>${versionName(from.version)}</a>.</span>`}</li>`,
)}
</ul>${credits.map((credit) => html`<p class="muted">${credit}</p>`)}</div>`
}
${panels.map(
  ({ series, version, total, panels: listing }) =>
    html`<div class="card entry"><h2>In LOINC panels</h2>
<p>${series.label} lists this test in ${total === 1 ? "one panel" : `${total.toLocaleString("en")} panels`}. A panel's page shows the results you have in it; it does not say this result was drawn as part of one.</p>
<ul class="members">${listing.map(
      (each) =>
        html`<li><a href=${panelHref(each.code)}>${each.about?.name?.label ?? each.notation}</a>${each.required !== undefined && html` <span class="muted">${REQUIRED[each.required] ?? each.required}</span>`}</li>`,
    )}</ul>
${total > listing.length && html`<p class="muted">and ${(total - listing.length).toLocaleString("en")} more.</p>`}
${series.credit !== undefined && html`<p class="muted">${series.credit}</p>`}
<p class="muted from">From ${series.label}, <a href=${tableHref(series)}>${versionName(version)}</a>.</p></div>`,
)}`;
}

/** What an import is doing, as `pod.import`'s `onProgress` says it: `converting, 3 of 10 documents done`. */
export function importPart({ part, done, of }) {
  const counted =
    of === undefined
      ? ""
      : `, ${done} of ${of} ${part === "converting" ? "documents" : "steps"} done`;
  return `${part}${counted}`;
}

/**
 * Where a connection has got to, as a list of steps: those done ticked, the one under way marked. While its record is
 * brought in, `bringing` is the import's part, as `onProgress` last said it.
 */
export function steps({ step, requests, bringing }) {
  const at = ["signing in", "pulling", "pulled", "bringing in"].indexOf(step);
  const items = [
    at === 0 ? "Signing in at the hospital" : "Signed in at the hospital",
    at === 1
      ? `Fetching the record: ${requests} requests answered so far`
      : "Fetching the record",
    at === 2 ? `Record fetched, in ${requests} requests` : "Record fetched",
    ...(at === 3
      ? [
          `Bringing it in${bringing === undefined ? "" : `: ${importPart(bringing)}`}`,
        ]
      : []),
  ].map((text, index) => {
    const state = index < at || at === 2 ? "done" : index === at ? "now" : "";
    return html`<li class=${state}>${text}</li>`;
  });
  return html`<ul class="steps">${items}</ul>`;
}

/**
 * `steps` of `connection`, which in a browser draws itself again once a frame while the connection signs in, fetches or
 * brings its record in, so the host only counts `connection.requests` or sets `connection.bringing` and the page around
 * it is not drawn again.
 */
function Steps({ connection }) {
  const [, setSeen] = useState();
  useEffect(() => {
    if (!["signing in", "pulling", "bringing in"].includes(connection.step))
      return;
    let frame;
    const again = () => {
      setSeen(JSON.stringify([connection.requests, connection.bringing]));
      frame = globalThis.requestAnimationFrame(again);
    };
    again();
    return () => globalThis.cancelAnimationFrame(frame);
  }, [connection, connection.step]);
  return steps(connection);
}

/**
 * Every person the demo hospitals hold, by name, the same person at two hospitals once, by name and birth date; each
 * with the hospitals that hold them, and their `family` and `given` names as the hospital holds them separately.
 * `demo` is the demo hospitals as `loadHospitals` gives them.
 */
export function demoPeople(demo) {
  const people = new Map();
  for (const { hospital, patients } of demo)
    for (const bundle of Object.values(patients)) {
      const name = patientName(bundle);
      if (name === undefined) continue;
      const key = `${name}|${patientOf(bundle).birthDate}`;
      if (!people.has(key)) {
        const { family = "", given = [] } = patientOf(bundle).name[0];
        people.set(key, { name, family, given: given.join(" "), at: [] });
      }
      people.get(key).at.push(hospital);
    }
  return byFamily([...people.values()]);
}

/** A person as a list of people reads them, family name first: `Marsh, Rowan Ellery`; their name as it is when no family name is held. */
export function familyFirst({ name, family, given }) {
  return family ? [family, given].filter(Boolean).join(", ") : name;
}

/** `people` sorted by family name, then given name; a person with no family name sorts by their name. */
export function byFamily(people) {
  return [...people].sort(
    (a, b) =>
      (a.family || a.name).localeCompare(b.family || b.name) ||
      (a.given ?? "").localeCompare(b.given ?? ""),
  );
}

/** A patient file's Patient: its latest version, by record time, in a file that keeps versions. */
function patientOf(bundle) {
  const recorded = (entry) =>
    Date.parse(entry.response?.lastModified ?? "") || -Infinity;
  return (bundle.entry ?? [])
    .filter(({ resource }) => resource?.resourceType === "Patient")
    .reduce(
      (latest, entry) =>
        latest === undefined || recorded(entry) >= recorded(latest)
          ? entry
          : latest,
      undefined,
    )?.resource;
}

/** The person a FHIR Bundle is about, as the hospital names them: `Rowan Ellery Marsh`; undefined when it names none. */
export function patientName(bundle) {
  const name = patientOf(bundle)?.name?.[0];
  return name === undefined
    ? undefined
    : [...(name.given ?? []), name.family].filter(Boolean).join(" ");
}

/**
 * A button that posts `fields` to `action`, as a form of its own, with `inner` in it; `doing` is what the page says
 * while the form is posted.
 */
export function postButton(action, fields, inner, className, doing) {
  return html`<form class="inline" method="post" action=${action} data-doing=${doing}>
${Object.entries(fields).map(([name, value]) => html`<input type="hidden" name=${name} value=${value} />`)}
<button class=${className}>${inner}</button>
</form>`;
}

/**
 * A one-click choice in a list of the new-pod box: a form that posts `fields` to `action`, saying `doing` while it
 * does, or a link to `href`.
 */
function choice({ label, note, action, fields = {}, href, doing }) {
  const inner = html`${label}<span class="muted">${note ?? ""}</span>`;
  return html`<li>${href === undefined ? postButton(action, fields, inner, undefined, doing) : html`<a class="button" href=${href}>${inner}</a>`}</li>`;
}

/** The id of the new-pod box's checkbox, and the name of the field it adds to whichever form makes the pod. */
export const ENCRYPT_BOX = "encrypt-pod";
export const ENCRYPT_FIELD = "encrypt";

/**
 * On the document `page`, rendered to a string: a form of the new-pod box submitted with its checkbox ticked carries
 * `encrypt=on`, so whichever way the pod is made says it is to be encrypted.
 */
export function encryptedChoice(page) {
  page.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.closest?.("#new-pod")) return;
    form.querySelector('input[name="encrypt"]')?.remove();
    if (!page.getElementById("encrypt-pod")?.checked) return;
    const field = page.createElement("input");
    field.type = "hidden";
    field.name = "encrypt";
    field.value = "on";
    form.append(field);
  });
}

/** What the person is told of each way a pod can fail to open, by `Unopened`'s outcome. */
export const UNOPENED = {
  "incorrect secret":
    "Those words don't open this pod. Check each word and try again.",
  malformed:
    "This pod's encryption header is damaged or was changed, so no words were tried.",
  "unsupported version":
    "A newer version of Cascade encrypted this pod. Update the app to open it.",
  "cannot open": "This pod can only be opened another way, not with six words.",
};

/** What the six-words page says when the check fails, by the way it failed. */
export const NOT_WORDS = "Those aren't words 2 and 5.";
export const WORDS_CHANGED =
  "Don't change the Password field or take a suggested password: it must hold the six words above, so your password manager saves the words that open the pod.";
export const POD_CHANGED =
  "The Pod field must keep the pod's name, so the saved login matches the Open page.";

/**
 * What is wrong with the visible `password` and `username` of a submitted six-words form, or undefined when they are
 * still the `words` shown (spaces compared as single ones) and the pod's name `pod`. Never repeats a submitted value.
 */
export function savedLoginChanged(fields, pod, words) {
  const joined = String(fields.get("password") ?? "")
    .trim()
    .split(/\s+/)
    .join(" ");
  if (joined !== words) return WORDS_CHANGED;
  if (String(fields.get("username") ?? "") !== pod) return POD_CHANGED;
  return undefined;
}

/**
 * On the document `page`, rendered to a string: a button marked `data-copy-words` copies the words in its form's
 * password field to the clipboard and says so in the form's `data-copied` line; where the clipboard is not
 * available it says to write the words down, and fails nowhere.
 */
export function copyWords(page) {
  page.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-copy-words]");
    if (!button) return;
    const form = button.form;
    const words = form?.querySelector('input[name="password"]')?.value;
    const note = form?.querySelector("[data-copied]");
    try {
      await globalThis.navigator.clipboard.writeText(words);
      if (note) note.textContent = "Copied";
    } catch {
      if (note)
        note.textContent = "Copy isn't available here; write the words down.";
    }
  });
}

/**
 * The first step of making an encrypted pod for `pod`: the `words` (six, separated by spaces) large and numbered,
 * what to do with them, and a form posting to `action` that asks for words 2 and 5. The form carries the pod's name
 * and, in two visible fields a password manager reads as a sign-up (`username`, `password`), the name and the words;
 * the receiver refuses a form where either has changed. `problem`, when given, says what the last try got wrong.
 * Nothing is made until the form is answered.
 */
export function sixWordsPage({ pod, titles, words, action, problem }) {
  return html`<h1>Your six words</h1>
<p class="lead">For ${personName(pod, titles)}'s pod.</p>
<ol class="words">${words.split(" ").map((word) => html`<li>${word}</li>`)}</ol>
<p>Write these down, or save them in your password manager. They are the only way into this pod. Nobody can recover them: if you lose them, the pod's records are gone for good.</p>
<p class="muted">Encryption hides what the records say. It does not hide that this pod exists, its name, how many files it has or their sizes.</p>
${problem !== undefined && html`<p class="note" role="alert">${problem}</p>`}
<form method="post" action=${action} class="stack" data-doing="Making the pod…" autocomplete="on">
<input type="hidden" name="pod" value=${pod} />
<label>Pod <input type="text" name="username" autocomplete="username" value=${pod} /></label>
<label>Password <input type="password" name="password" autocomplete="new-password" value=${words} /></label>
<p class="muted">Your password manager can save these as the pod's password. <button type="button" data-copy-words>Copy words</button> <span data-copied role="status"></span></p>
<p><strong>Check that you have them.</strong> Type the second and the fifth word.</p>
<label>Word 2 <input name="word2" autocomplete="off" autocapitalize="none" spellcheck="false" required /></label>
<label>Word 5 <input name="word5" autocomplete="off" autocapitalize="none" spellcheck="false" required /></label>
<p><button>Make the encrypted pod</button></p>
</form>`;
}

/**
 * The page at any address of the encrypted pod `pod` while it is not open. `outcome` is how it last failed to open:
 * "secret needed" before any words were given, else an `Unopened` outcome. Where words could still open it, the page
 * has a form posting to `action` (with `next`, the address to go to once it opens), whose `username` and
 * `current-password` fields a password manager fills; otherwise only the outcome's sentence.
 */
export function openPodPage({ pod, titles, outcome, action, next }) {
  const said = UNOPENED[outcome];
  const wordsHelp =
    outcome === "secret needed" || outcome === "incorrect secret";
  return html`<h1>Open ${personName(pod, titles)}'s pod</h1>
${wordsHelp ? html`<p>This pod is encrypted. Type its six words to open it.</p>` : null}
${said !== undefined && html`<p class="note" role="alert">${said}</p>`}
${
  wordsHelp &&
  html`<form method="post" action=${action} class="stack" data-doing="Opening the pod…" autocomplete="on">
<input type="hidden" name="next" value=${next} />
<label>Pod <input type="text" name="username" autocomplete="username" value=${pod} /></label>
<label>Your six words <input type="password" name="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required /></label>
<p><button>Open this pod</button></p>
</form>`
}`;
}

/**
 * The box that makes a new pod, shown when the page's address ends `#new-pod`: what a pod is, a button for each demo
 * person in `people` with no pod among `pods` yet, `more` when given (`{ said, choices }`, each choice a `label`, a
 * `note`, and an `action` with its `fields` or an `href`), and a field for anyone's name. A person's button and the
 * field post `person` to `action`.
 */
export function newPodDialog({ people, pods, action, more }) {
  const demo = byFamily(people)
    .filter((person) => !pods.includes(slug(person.name)))
    .map((person) =>
      choice({
        label: familyFirst(person),
        note: `Records waiting at ${listed(person.at.map(({ name }) => hospitalName(name)))}`,
        action,
        fields: { person: person.name },
        doing: `Making ${person.name}'s pod…`,
      }),
    );
  const list = (said, items) =>
    items.length > 0 &&
    html`<p><strong>${said}</strong></p>
<ul class="people">${items}</ul>`;
  return box(
    "new-pod",
    "Make a new pod",
    html`<p>A pod keeps one person's health records, wherever they come from: files they download, and hospitals they sign in to. It notices when two sources describe the same thing, and when they disagree.</p>
<p class="encrypt"><label><input type="checkbox" id=${ENCRYPT_BOX} /> Encrypt this pod with six words</label>
<span class="muted">You get six words to keep. Only they open the pod again.</span></p>
${list("Try someone with records waiting at the demo hospitals. They are made up, and signing in needs no password.", demo)}
${more !== undefined && list(more.said, more.choices.map(choice))}
<p><strong>Or make one for anyone.</strong> You can bring in records afterwards.</p>
<form method="post" action=${action} class="row" data-doing="Making the pod…">
<input name="person" placeholder="A person's name" aria-label="A person's name" required />
<button>Make the pod</button>
</form>`,
  );
}

/** A menu of the title bar: `<details>`, so it opens and closes with no script, each item a link to a box. */
function menu(name, items) {
  return html`<details class="menu"><summary>${name}</summary><ul>
${items.map(([href, label]) => html`<li><a href=${href}>${label}</a></li>`)}
</ul></details>`;
}

/**
 * The title bar's menus and their boxes: File's two items each open a box asking to confirm, whose one button posts
 * to `deleteAll` or `resetAll`; Help's About gives the application's `name` and `version`, the `runtime` version it is
 * built on, and a link to its `code`.
 */
function menus({ deleteAll, resetAll, about }) {
  return {
    bar: html`${menu("File", [
      ["#delete-all", "Delete all data"],
      ["#reset-all", "Reset all data"],
    ])}${menu("Help", [["#about", "About"]])}`,
    boxes: [
      box(
        "delete-all",
        "Delete all data?",
        html`<p>Every pod in this app goes.</p>
${postButton(deleteAll, {}, "Delete all data", "warm", "Deleting all data…")}`,
      ),
      box(
        "reset-all",
        "Reset all data?",
        html`<p>Every pod goes, and Alex's, Priya's, Martin's and Tamsin's are loaded again.</p>
${postButton(resetAll, {}, "Reset all data", "warm", "Resetting all data…")}`,
      ),
      box(
        "about",
        `About ${about.name}`,
        html`<p><strong>${about.name}</strong> ${about.version}</p>
<p>Built on cascade-runtime ${about.runtime}.</p>
<p>Every person here is made up.</p>
${about.code !== undefined && html`<p><a href=${about.code}>The code</a></p>`}`,
      ),
    ],
  };
}

/**
 * What the page says after a File menu item, from its address's `query`: `deleted=<n>`, how many pods went; `reset`,
 * that the pods `kits` are back; else undefined.
 */
export function didNote(query, kits) {
  const deleted = query.get("deleted");
  if (deleted !== null && /^\d+$/.test(deleted)) {
    const count = Number(deleted);
    return count === 0
      ? "There was no pod to delete."
      : `Deleted ${count} ${count === 1 ? "pod" : "pods"}.`;
  }
  if (query.has("reset"))
    return `Reset: ${listed(kits.map((kit) => personName(kit)))} ${kits.length === 1 ? "is" : "are"} back.`;
  return undefined;
}

/**
 * What a page shows, without the document around it, which a page in a browser renders into its own root: the title
 * bar with its menus, the pods by their people's names, `note` above `body` when given, and `dialog` (the new-pod
 * box). `pods` are the pods' names, `current` the one shown, `href(pod)` a pod's address and `home` the title bar's;
 * `menu` is what the menus need, as `{ deleteAll, resetAll, about: { name, version, runtime, code } }`: the addresses
 * the two File items post to, and what the About box says. `tables`, when given, puts the reference tables under the
 * pods, as `tablesNav` takes them.
 */
export function layout({
  body,
  pods,
  titles,
  current,
  href,
  home,
  dialog,
  menu,
  note,
  tables,
}) {
  const { bar, boxes } = menus(menu);
  return html`<${Fragment}>
<header class="bar"><a href=${home}>Cascade</a>${bar}<span class="demo">Demo: every person here is made up</span></header>
<div class="layout">
<aside>
<nav><h2>Pods</h2><ul>
${pods.map((pod) => html`<li><a href=${href(pod)} aria-current=${pod === current ? "page" : undefined}>${personName(pod, titles)}</a></li>`)}
</ul></nav>
<a class="button wide" href="#new-pod">+ New pod</a>
${tables !== undefined && tablesNav(tables)}
</aside>
<main>
${note !== undefined && html`<p class="note" role="status">${note}</p>`}
${body}
</main>
</div>
${dialog}
${boxes}
<//>`;
}

/**
 * A whole page: `layout` in a document titled `title`, with the stylesheet and the page's script. `refresh` makes the
 * page reload itself every second. Render it to a string after `<!doctype html>`.
 */
export function frame({ title, refresh, chat, ...shown }) {
  return html`<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${refresh && html`<meta http-equiv="refresh" content="1" />`}
<title>${title} · Cascade</title>
<style dangerouslySetInnerHTML=${{ __html: STYLE + (chat === undefined ? "" : CHAT_STYLE) }}></style>
</head>
<body>
${layout(shown)}
${chat !== undefined && !refresh && html`<${Chat} ...${chat} />`}
${doing()}
<script dangerouslySetInnerHTML=${{ __html: SCRIPT }}></script>
</body>
</html>`;
}

/** What a page says while it is busy: a spinner and `said`, one line; hidden while `said` is undefined. */
export function doing(said) {
  return html`<p class="doing" role="status" hidden=${said === undefined}><span class="spinner" aria-hidden="true"></span><span class="said">${said}</span></p>`;
}

/**
 * The chat strip at the bottom of a page, which `chatStrip` fills in the browser. `model` is `{ provider, name, local }`
 * of the model the app was set up with, or nothing, when the strip only says how to set one; `pod` the name of the pod
 * the page is about, or ""; `suggestions` the questions offered in an empty chat, as texts; `encrypted` that the pod is
 * encrypted, so the strip keeps no chat of it beyond the page.
 */
export function Chat({ model, pod, suggestions = [], encrypted = false }) {
  if (!model)
    return html`<section class="chat" aria-label="Chat"><p class="chat-off">To chat with a model about these pods, run <code>npm run model</code>.</p></section>`;
  return html`<section class="chat" aria-label="Chat" data-pod=${pod} data-encrypted=${encrypted ? "true" : undefined}>
<div class="chat-bar">
<strong>Chat</strong>
<span class="muted">${model.name}${model.local ? ", on this computer" : `, from ${model.provider}`}</span>
<details class="chat-recent"><summary>Recent chats</summary><ul></ul></details>
<button type="button" class="quiet chat-new">New chat</button>
<button type="button" class="quiet chat-fold" aria-expanded="true">Hide chat</button>
</div>
<div class="chat-about muted" hidden></div>
<div class="chat-log" role="log" aria-live="polite" hidden></div>
<div class="chat-chips" hidden>
${suggestions.map((text) => html`<button type="button" class="quiet" data-ask-text=${text}>${text}</button>`)}
</div>
<form class="chat-form">
<input name="text" autocomplete="off" aria-label="Ask a question" placeholder=${pod === "" ? "Ask about your pods" : "Ask about this pod"} />
<button type="submit" class="chat-send">Send</button>
<button type="button" class="quiet chat-stop" hidden>Stop</button>
</form>
</section>`;
}

/** The page when there is no pod yet. */
export function noPods() {
  return html`<h1>No pods yet</h1>
<p class="lead">A pod keeps one person's health records, wherever they come from.</p>
<p><a class="button" href="#new-pod">Make your first pod</a></p>`;
}

/**
 * Finding a hospital for the pod `pod`: a search box that sends `q` to `search`, then a card per directory row in
 * `rows`, with its places, `signIn(row)` (its sign-in button), and the demo people in `people` it holds, each with
 * where else they are. `back` is the pod's address. `world` is the date the hospitals answer as of and the way to change
 * it, as `worldDateLine` takes it, shown above the cards.
 */
export function hospitalsPage({
  world,
  pod,
  titles,
  rows,
  text,
  search,
  signIn,
  people,
  back,
}) {
  const who = personName(pod, titles);
  const cards = rows.map((row) => {
    const here = byFamily(people)
      .filter((person) =>
        person.at.some((each) => each.fhirBase === row.fhirBase),
      )
      .map((person) => {
        const elsewhere = person.at
          .filter((each) => each.fhirBase !== row.fhirBase)
          .map(({ name }) => hospitalName(name));
        return html`<li>${familyFirst(person)}${elsewhere.length > 0 && html` <span class="muted">also at ${listed(elsewhere)}</span>`}</li>`;
      });
    return html`<div class="card">
<div class="row"><h2>${hospitalName(row.name)}</h2>${signIn(row)}</div>
${row.places !== undefined && html`<p class="muted">${row.places.join("; ")}</p>`}
${
  here.length === 0
    ? html`<p class="muted">A test server: you choose a patient on its own sign-in page.</p>`
    : html`<p class="muted">Sample patients here:</p>
<ul>${here}</ul>`
}
</div>`;
  });
  return html`<h1>Find a hospital</h1>
<p class="lead">Sign in on the hospital's own page, see what it has, and bring it into ${who}'s pod.</p>
${world !== undefined && worldDateLine(world)}
<form method="get" action=${search} class="row card" data-doing="Searching…"><input name="q" value=${text} placeholder="Search by name or place" aria-label="Search by name or place" /><button>Search</button></form>
${cards.length === 0 ? html`<p class="muted">No hospital matches.</p>` : cards}
<p><a href=${back}>Back to ${who}</a></p>`;
}

/** A reference table's name in an address: its `urn:uuid:` without the prefix. */
export function tableId(series) {
  return series.replace(/^urn:uuid:/, "");
}

/** The licences tables are published under, by their IRI, as a person names them. */
const LICENCES = {
  "http://creativecommons.org/publicdomain/zero/1.0/": "CC0 1.0",
  "http://creativecommons.org/publicdomain/mark/1.0/": "Public domain",
};

/** How long before `now` the time `at` was: `just now`, `5 minutes ago`, `2 hours ago`, `3 days ago`. */
export function ago(at, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (Number.isNaN(minutes)) return "at an unknown time";
  const said = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return said(minutes, "minute");
  if (minutes < 60 * 24) return said(Math.floor(minutes / 60), "hour");
  return said(Math.floor(minutes / (60 * 24)), "day");
}

/**
 * How fresh a series is, at `now`, in sentences: when the publisher's watcher last checked its source and whether it
 * found a new release, when this app last read the feed, and when the feed last changed.
 */
export function freshness(series, now = Date.now()) {
  const { watched, checked, modified } = series;
  return [
    watched === undefined
      ? "The feed does not say when its watcher last checked the publisher."
      : `The watcher checked the publisher ${ago(watched.at, now)}: ${watched.found === "new" ? "a new release" : "nothing new"}.`,
    checked === undefined
      ? "This app has not read the feed yet."
      : `This app last read the feed ${ago(checked, now)}.`,
    modified !== undefined && `The feed last changed on ${day(modified)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** A version as a person reads it: `version 2, Oct 8, 2026`. */
function versionName({ label, issued }) {
  return [
    label === undefined ? "an unlabelled version" : `version ${label}`,
    issued !== undefined && day(issued),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The sidebar's reference tables, under the pods: `series` the sources the app holds, as `sourcesOf` gives them, each a
 * link to `href(source)`, the one whose IRI is `current` marked; and a Check now button posting to `check`. While
 * `loading`, a page that has not yet read what the app holds says so instead of "None yet", which says there are none,
 * and when `failed`, the read failed, which it says instead of both.
 */
export function tablesNav({
  series,
  current,
  href,
  check,
  loading = false,
  failed = false,
}) {
  return html`<section class="tables" aria-label="Reference tables"><h2>Reference tables</h2>
${
  series.length === 0
    ? html`<p class="muted">${failed ? "The reference tables could not be read." : loading ? "Loading the reference tables…" : "None yet."}</p>`
    : html`<ul>
${series.map((each) => html`<li><a href=${href(each)} aria-current=${each.iri === current ? "page" : undefined}>${each.label}</a></li>`)}
</ul>`
}
${postButton(check, {}, "Check now", "quiet wide", "Checking the feeds…")}
</section>`;
}

/** `text`, a link to `iri` when a feed gave a web address, never another scheme. */
function linked(iri, text) {
  return /^https?:\/\//.test(iri) ? html`<a href=${iri}>${text}</a>` : text;
}

/** A code, as written: the end of its IRI. */
function codeShown(code) {
  return code.replace(/^.*[/#]/, "");
}

/** What a code's `about` says of its status, in words starting `said`: `Retired`, `Retired, replaced by 141`, or nothing. */
function statusOf(about, said = "Retired") {
  const status = about?.status;
  if (status?.deprecated !== true) return "";
  return status.replacedBy.length === 0
    ? said
    : `${said}, replaced by ${listed(status.replacedBy.map(codeShown))}`;
}

/** The page a query's `page` asks for: a whole number from 1, else 1. */
export function pageNumber(asked) {
  const page = Number(asked);
  return Number.isSafeInteger(page) && page > 1 ? page : 1;
}

/** The words every label starts with, or, when they share none or there is one, the first label. */
function shared(labels) {
  const [first = "", ...others] = labels;
  const words = first.split(" ");
  let length = words.length;
  for (const other of others) {
    const theirs = other.split(" ");
    let same = 0;
    while (same < length && words[same] === theirs[same]) same += 1;
    length = same;
  }
  return length === 0 || others.length === 0
    ? first
    : words.slice(0, length).join(" ");
}

/**
 * The sources of the series `held` gives, in its order: each the feed's `source` of its series, or a series with none
 * its own; named by the words its series' labels share.
 */
export function sourcesOf(held) {
  const sources = new Map();
  for (const series of held) {
    const iri = series.source ?? series.iri;
    sources.set(iri, [...(sources.get(iri) ?? []), series]);
  }
  return [...sources].map(([iri, series]) => ({
    iri,
    label: shared(series.map(({ label }) => label)),
    series,
  }));
}

/** Who publishes `series`, the credit it asks for, its licence and how fresh it is at `now`, as a card headed `heading`. */
function published(series, now, heading) {
  return html`<div class="card">${heading && html`<h2>${heading}</h2>`}<dl class="facts">
<dt>Source</dt><dd>${series.publisher !== undefined && linked(series.publisher, series.publisherName ?? series.publisher.replace(/^[a-z]+:\/\/([^/]+).*$/, "$1"))}${series.credit !== undefined && html` <span class="muted">${series.credit}</span>`}</dd>
<dt>Licence</dt><dd>${series.licence === undefined ? "Not stated" : linked(series.licence, LICENCES[series.licence] ?? series.licence)}</dd>
<dt>Fresh</dt><dd>${freshness(series, now)}</dd>
</dl></div>`;
}

/** A search box sending `q` to `search`, with `text` in it. */
function searchBox(search, text) {
  return html`<form method="get" action=${search} class="row card" data-doing="Searching…"><input name="q" value=${text} placeholder="Search by code or name" aria-label="Search by code or name" /><button>Search</button></form>`;
}

/**
 * The codes `searched` found (`search()`'s answer), page `page` of them, as a table headed `heads` with a row of cells
 * `row(found)` each, and links to the pages before and after it at `pageHref(page)`.
 */
function codesFound({ searched, page, pageHref, heads, row }) {
  const { found, total, offset = 0, size } = searched;
  if (total === 0) return html`<p class="muted">No code matches.</p>`;
  const counted = (count) =>
    `${count.toLocaleString("en")} ${count === 1 ? "code" : "codes"}`;
  const shown =
    found.length === 0
      ? `None on page ${page} of ${counted(total)}.`
      : offset === 0 && found.length === total
        ? `${counted(total)}.`
        : `${(offset + 1).toLocaleString("en")}–${(offset + found.length).toLocaleString("en")} of ${counted(total)}.`;
  // A page past the last steps back to the last.
  const previous =
    found.length === 0 ? Math.max(1, Math.ceil(total / size)) : page - 1;
  const pages = [
    offset > 0 && html`<a href=${pageHref(previous)} rel="prev">Previous</a>`,
    offset + found.length < total &&
      html`<a href=${pageHref(page + 1)} rel="next">Next</a>`,
  ].filter(Boolean);
  return html`<p class="muted">${shown}</p>
${
  found.length > 0 &&
  html`<div class="scroll"><table class="codes">
<thead><tr>${heads.map((head) => html`<th>${head}</th>`)}</tr></thead>
<tbody>
${found.map((each) => html`<tr>${row(each)}</tr>`)}
</tbody>
</table></div>`
}
${pages.length > 0 && html`<p class="pages">${pages}</p>`}`;
}

/** A code's name, with its other names after it. */
function namesOf(about) {
  return html`${about?.name?.label}${
    (about?.name?.altLabels.length ?? 0) > 0 &&
    html` <span class="muted">${about.name.altLabels.join("; ")}</span>`
  }`;
}

/**
 * A reference table's page: `series` as `held()` gives it, its source, licence, version and how fresh it is at `now`;
 * a search box sending `q` to `search`, with `text` in it; the codes `searched` found (`search()`'s answer), page
 * `page` of them, each a link to `codeHref(notation)` when given, with links to the pages before and after it at
 * `pageHref(page)`; and each version held with the pods among `pods` that `uses` (`uses()`'s answer) says were opened
 * with it, each a link to `href(pod)`.
 */
export function tablePage({
  series,
  searched,
  text,
  search,
  page = 1,
  pageHref,
  codeHref,
  uses,
  pods,
  titles,
  href,
  now,
}) {
  const maps = searched.found.some((each) => each.mapsTo.length > 0);
  const named = ({ notation, about }) =>
    about?.name === undefined ? notation : `${notation} ${about.name.label}`;
  const using = (version) =>
    (uses[version.iri] ?? []).filter((pod) => pods.includes(pod));
  return html`<h1>${series.label}</h1>
<p class="lead">Using ${versionName(series.current)}</p>
${published(series, now)}
${searchBox(search, text)}
${codesFound({
  searched,
  page,
  pageHref,
  heads: ["Code", "Name", "Status", ...(maps ? ["Maps to"] : [])],
  row: ({ notation, about, mapsTo }) =>
    html`<td>${codeHref === undefined ? notation : html`<a href=${codeHref(notation)}>${notation}</a>`}</td><td>${namesOf(about)}</td><td>${statusOf(about)}</td>${
      maps && html`<td>${mapsTo.map(named).join(", ")}</td>`
    }`,
})}
<div class="card versions"><h2>Which pods use which version</h2><ul>
${series.versions.map((version) => {
  const pods = using(version);
  return html`<li><strong>${versionName(version)}</strong>${version.iri === series.current.iri && html` <span class="tag">current</span>`}: ${
    pods.length === 0
      ? html`<span class="muted">no pod</span>`
      : pods.map(
          (pod, index) =>
            html`${index > 0 && ", "}<a href=${href(pod)}>${personName(pod, titles)}</a>`,
        )
  }</li>`;
})}
</ul></div>`;
}

/**
 * A source's page: `source` as `sourcesOf` gives it, who publishes it, its licence and how fresh it is at `now`, a card
 * for each set of its tables these differ for, headed with their labels when there are several; a search box
 * sending `q` to `search`, with `text` in it, over the codes of all its tables; the codes `searched` found, page `page`
 * of them, each a link to `codeHref(notation)`, with links to the pages around it at `pageHref(page)`; and what the
 * source publishes, each table a link to `tableHref(series)`.
 */
export function sourcePage({
  source,
  searched,
  text,
  search,
  page = 1,
  pageHref,
  codeHref,
  tableHref,
  now,
}) {
  const alike = new Map();
  for (const series of source.series) {
    const said = JSON.stringify([
      series.publisher,
      series.credit,
      series.licence,
      freshness(series, now),
    ]);
    alike.set(said, [...(alike.get(said) ?? []), series]);
  }
  const cards = [...alike.values()];
  return html`<h1>${source.label}</h1>
${cards.map((series) =>
  published(
    series[0],
    now,
    cards.length > 1 && series.map(({ label }) => label).join(", "),
  ),
)}
${searchBox(search, text)}
${codesFound({
  searched,
  page,
  pageHref,
  heads: ["Code", "Name", "Status"],
  row: ({ notation, about }) =>
    html`<td><a href=${codeHref(notation)}>${notation}</a></td><td>${namesOf(about)}</td><td>${statusOf(about)}</td>`,
})}
<div class="card versions"><h2>What this source publishes</h2><ul>
${source.series.map(
  (series) =>
    html`<li><a href=${tableHref(series)}>${series.label}</a>: ${versionName(series.current)}</li>`,
)}
</ul></div>`;
}

/**
 * A code's page: everything `facts` (`facts()`'s answer) says of it, a variation's classification as the ClinVar sentence, each fact naming the table among `held` (as
 * `held()` gives them) and the version it came from, each code a link to `codeHref(notation)`; and a link back to
 * `source` at `back`.
 */
export function codePage({ source, held, facts, codeHref, back }) {
  const tableOf = (series) => held.find(({ iri }) => iri === series);
  const from = ({ series, version }) => {
    const table = tableOf(series);
    const held = table?.versions.find(({ iri }) => iri === version);
    return html`<p class="muted">From ${table?.label ?? series}, ${held === undefined ? version : versionName(held)}.</p>`;
  };
  const code = ({ notation, about }) =>
    html`<a href=${codeHref(notation)}>${notation}</a>${about?.name !== undefined && ` ${about.name.label}`}`;
  const codes = ({ total, codes: shown }) =>
    html`${shown.map((each, index) => html`${index > 0 && ", "}${code(each)}`)}${
      total > shown.length &&
      ` and ${(total - shown.length).toLocaleString("en")} more`
    }`;
  const {
    notation,
    about,
    names,
    status,
    mappings,
    classifications = [],
    panels = [],
    classes = [],
    page,
  } = facts;
  const placed = (each) =>
    html`<li>${code(each)}${each.required !== undefined && html` <span class="muted">${REQUIRED[each.required] ?? each.required}</span>`}</li>`;
  const credit = (series) =>
    tableOf(series)?.credit !== undefined &&
    html`<p class="muted">${tableOf(series).credit}</p>`;
  return html`<p><a href=${back}>${source.label}</a></p>
<h1>${notation}${about?.name !== undefined && ` ${about.name.label}`}</h1>
${page !== undefined && html`<p><a href=${page.href} rel="external">${page.system}'s page for ${notation}</a></p>`}
${names.map(
  (name) => html`<div class="card"><h2>Names</h2>
<p><strong>${name.label}</strong></p>
${name.altLabels.length > 0 && html`<ul>${name.altLabels.map((label) => html`<li>${label}</li>`)}</ul>`}
${from(name)}</div>`,
)}
${status.map(
  (said) => html`<div class="card"><h2>Status</h2>
<p>${said.deprecated ? "Retired" : "In use"}${said.replacedBy.length > 0 && html`, replaced by ${said.replacedBy.map((each, index) => html`${index > 0 && ", "}${code(each)}`)}`}.</p>
${from(said)}</div>`,
)}
${mappings.map((mapping) => {
  const table = tableOf(mapping.series);
  return html`<div class="card"><h2>${table?.label ?? mapping.series}</h2>
${mapping.mapsTo.map(
  (target) =>
    html`<p>Maps to ${code(target)}${target.alongside.total > 0 && html`, as do ${codes(target.alongside)}`}.</p>`,
)}
${mapping.mappedFrom.total > 0 && html`<p>Mapped to it: ${codes(mapping.mappedFrom)}.</p>`}
${from(mapping)}</div>`;
})}
${classifications.map(
  (
    row,
  ) => html`<div class="card"><h2>${tableOf(row.series)?.label ?? row.series}</h2>
<p>${rowSaid(row)}</p>
${credit(row.series)}
${from(row)}</div>`,
)}
${panels.map(
  (
    panel,
  ) => html`<div class="card"><h2>${tableOf(panel.series)?.label ?? panel.series}</h2>
${
  panel.members.length > 0 &&
  html`<p>A panel of ${panel.members.length === 1 ? "one member" : `${panel.members.length} members`}, in order:</p>
<ol class="members">${panel.members.map(placed)}</ol>`
}
${
  panel.heldBy.total > 0 &&
  html`<p>${panel.members.length > 0 ? "Itself a member" : "A member"} of ${panel.heldBy.total === 1 ? "one panel" : `${panel.heldBy.total.toLocaleString("en")} panels`}:</p>
<ul class="members">${panel.heldBy.panels.map(placed)}</ul>
${panel.heldBy.total > panel.heldBy.panels.length && html`<p class="muted">and ${(panel.heldBy.total - panel.heldBy.panels.length).toLocaleString("en")} more.</p>`}`
}
${credit(panel.series)}
${from(panel)}</div>`,
)}
${classes.map(
  (
    classed,
  ) => html`<div class="card"><h2>${tableOf(classed.series)?.label ?? classed.series}</h2>
${
  classed.in.length > 0 &&
  html`<ul class="members">${classed.in.map(
    (each) =>
      html`<li><strong>${relationName(each.relation)}:</strong> ${code(each.class)}${each.through !== undefined && html` <span class="muted">through ${code(each.through)}</span>`}</li>`,
  )}</ul>`
}
${(classed.withheld ?? []).map(
  (each) =>
    html`<p>No ${relationName(each.relation).toLowerCase()} is given: FDA classes a different form of ${code(each.ingredient)}; RxNorm does not tie this drug to it.</p>`,
)}
${credit(classed.series)}
${from(classed)}</div>`,
)}
${names.length + status.length + mappings.length + classifications.length + panels.length + classes.length === 0 && html`<p class="muted">No table this app holds says anything of this code.</p>`}`;
}

/** What a panel's `ObservationRequiredInPanel` says, as LOINC writes it; a value not listed (R-a, Rflx) is shown as written. */
const REQUIRED = {
  R: "required",
  O: "optional",
  C: "conditional",
};

/** The relations of a drug class row, in the order a page lists them, and what a person calls each. */
const RELATIONS = [
  ["establishedPharmacologicClass", "Established pharmacologic class"],
  ["mechanismOfAction", "Mechanism of action"],
  ["physiologicEffect", "Physiologic effect"],
  ["chemicalStructure", "Chemical structure"],
].map(([term, name]) => [`${REC}${term}`, name]);

const relationName = (relation) =>
  RELATIONS.find(([each]) => each === relation)?.[1] ?? notationOf(relation);

/**
 * What the tables say of the classes `rows` (`pod.medicationClasses()`'s answer) hold and of the codes they were
 * reached through, as `about` answers: their names. Names nothing when the tables cannot say.
 */
export async function classesSaid(rows, { tables }) {
  return tables.about([
    ...new Set(rows.flatMap((row) => [row.class, row.through]).filter(Boolean)),
  ]);
}

/**
 * Of the `medications` (rows of `pod/My active medications`) in no class of `rows`, those whose code is in no class
 * though FDA classes a different form of its ingredient, by the code: the names of those ingredients. Says nothing
 * when the tables cannot say.
 */
export async function classedElsewhere(rows, medications, { tables }) {
  const classed = new Set(rows.map(({ entry }) => entry));
  const codes = [
    ...new Set(
      medications
        .filter(({ entry, code }) => !classed.has(entry) && code !== undefined)
        .map(({ code }) => code),
    ),
  ];
  if (codes.length === 0) return new Map();
  const found = await tables.classedElsewhere(codes);
  const about = await tables.about([...new Set([...found.values()].flat())]);
  const nameOf = (code) =>
    about.get(code)?.name?.label ??
    about.get(code)?.notation ??
    notationOf(code);
  return new Map(
    [...found].map(([code, ingredients]) => [code, ingredients.map(nameOf)]),
  );
}

/**
 * The page of a pod's medicines by class: `rows` is `pod.medicationClasses()`'s answer, `medications` the rows of
 * `pod/My active medications`, `about` is `classesSaid`'s answer, none until the tables can say, `elsewhere` is
 * `classedElsewhere`'s, and `held` the tables' `held()`. A class is a button of the picker, a link to `classHref(code)`
 * (or to `allHref` for all of them); `picked` is the class shown, by its code, or none for every class. Each medicine
 * is a link to `entryHref(entry)`, and each class a link to `codeHref(series, notation)` when `held` holds the series
 * that names it. A row `stated` is on a code the entry states, so is not "through" anything. The page says which
 * medicines it does not class, and why.
 */
export function classesPage({
  pod,
  titles,
  back,
  rows,
  medications = [],
  about = new Map(),
  elsewhere = new Map(),
  held = [],
  picked,
  classHref,
  allHref,
  entryHref,
  codeHref,
}) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.relation} ${row.class}`;
    if (!groups.has(key))
      groups.set(key, {
        relation: row.relation,
        class: row.class,
        medicines: new Map(),
        origins: new Set(),
      });
    const group = groups.get(key);
    if (!group.medicines.has(row.entry))
      group.medicines.set(row.entry, {
        entry: row.entry,
        name: row.medication,
        through: new Set(),
      });
    if (row.stated !== "true")
      group.medicines.get(row.entry).through.add(row.through);
    group.origins.add(row.origin);
  }
  const nameOf = (code) =>
    about.get(code)?.name?.label ??
    about.get(code)?.notation ??
    notationOf(code);
  const classed = [...groups.values()].sort(
    (a, b) =>
      RELATIONS.findIndex(([each]) => each === a.relation) -
        RELATIONS.findIndex(([each]) => each === b.relation) ||
      nameOf(a.class).localeCompare(nameOf(b.class)),
  );
  const shown = classed.filter(
    (group) => picked === undefined || group.class === picked,
  );
  const inAClass = new Set(rows.map((row) => row.entry));
  const left = medications.filter(({ entry }) => !inAClass.has(entry));
  const formOf = left.filter(({ code }) => elsewhere.has(code));
  const unclassed = left.filter(({ code }) => !elsewhere.has(code));
  const from = (group) => {
    const versions = [...group.origins].flatMap((origin) => {
      const found = heldAt(origin, held);
      return found === undefined ? [] : [found];
    });
    return versions.length === 0
      ? undefined
      : html`<p class="muted">From ${listed(versions.map(({ series, version }) => `${series.label}, ${versionName(version)}`))}.</p>`;
  };
  const link = (group) => {
    const series = about.get(group.class)?.name?.origin;
    const found = series === undefined ? undefined : heldAt(series, held);
    return found === undefined || codeHref === undefined
      ? nameOf(group.class)
      : html`<a href=${codeHref(found.series, about.get(group.class).notation)}>${nameOf(group.class)}</a>`;
  };
  const credits = [
    ...new Set(
      classed.flatMap((group) =>
        [...group.origins].flatMap(
          (origin) => heldAt(origin, held)?.series.credit ?? [],
        ),
      ),
    ),
  ];
  return html`<p><a href=${back}>Back to ${personName(pod, titles)}</a></p>
<h1>Medicines by class</h1>
<p class="lead">${classed.length === 0 ? "None of this pod's active medicines is in a class the app's tables know." : "Which of the active medicines of this pod are in a class, by the classes MED-RT gives the drug."}</p>
${
  classed.length > 0 &&
  html`<div class="card picker"><h2>Pick a class</h2><ul>
<li><a href=${allHref} aria-current=${picked === undefined ? "true" : undefined}>All classes</a></li>
${classed.map(
  (group) =>
    html`<li><a href=${classHref(group.class)} aria-current=${picked === group.class ? "true" : undefined}>${nameOf(group.class)}</a></li>`,
)}
</ul></div>`
}
${shown.map(
  (group) => html`<div class="card"><h2>${link(group)}</h2>
<p class="muted">${relationName(group.relation)}</p>
<ul>${[...group.medicines.values()].map(
    (medicine) =>
      html`<li>${entryHref === undefined ? medicine.name : html`<a href=${entryHref(medicine.entry)}>${medicine.name}</a>`}${medicine.through.size > 0 && html` <span class="muted">through ${listed([...medicine.through].map(nameOf))}</span>`}</li>`,
  )}</ul>
${from(group)}</div>`,
)}
${picked !== undefined && shown.length === 0 && html`<p>None of this pod's active medicines is in that class.</p>`}
${credits.map((credit) => html`<p class="muted">${credit}</p>`)}
${
  left.length > 0 &&
  html`<div class="card"><h2>Not in a class here</h2>
${formOf.map(
  ({ medication, code }) =>
    html`<p>${medication}: FDA classes a different form of ${listed(elsewhere.get(code))}; RxNorm does not tie this product to it.</p>`,
)}
${
  unclassed.length > 0 &&
  html`<p>${listed(unclassed.map(({ medication }) => medication))}. MED-RT classes single ingredients, not the combination of several, and gives some single ingredients no class; a drug the tables do not map to an ingredient has no class here.</p>`
}</div>`
}`;
}

/**
 * What the tables say of the panel and of the codes `rows` (`pod.panelResults(panel)`'s answer) hold: their names. Names
 * nothing when the tables cannot say.
 */
export async function panelSaid(panel, rows, { tables }) {
  return tables.about([
    ...new Set([panel, ...rows.flatMap((row) => [row.member, row.via])]),
  ]);
}

/**
 * The page of a pod's results in the LOINC `panel` a person picked: `rows` is `pod.panelResults(panel)`'s answer, `labs`
 * the rows of `pod/My lab results`, `about` is `panelSaid`'s answer, none until the tables can say, and `held` the
 * tables' `held()`. Each test the panel lists is in LOINC's order with whether it is required and the pod's results of
 * it, newest first, each a link to `entryHref(entry)`; a test of a panel nested in it is under that panel. The page says
 * which required tests the pod has no result for, and which version of the tables says so. It never says a result was
 * drawn as part of the panel: only that LOINC lists the test in it.
 */
export function panelPage({
  pod,
  titles,
  back,
  panel,
  rows,
  labs = [],
  about = new Map(),
  held = [],
  entryHref,
  codeHref,
}) {
  const nameOf = (code) =>
    about.get(code)?.name?.label ??
    about.get(code)?.notation ??
    notationOf(code);
  const results = new Map(labs.map((row) => [row.entry, row]));
  const lines = new Map();
  for (const row of rows) {
    const key = `${row.via} ${row.member}`;
    if (!lines.has(key))
      lines.set(key, {
        member: row.member,
        via: row.via,
        sequence: Number(row.sequence),
        required: row.required,
        results: [],
      });
    if (row.entry !== undefined)
      lines
        .get(key)
        .results.push(results.get(row.entry) ?? { entry: row.entry });
  }
  const byPlace = (a, b) =>
    a.sequence - b.sequence || nameOf(a.member).localeCompare(nameOf(b.member));
  const own = [...lines.values()].filter((line) => line.via === panel);
  const shownOwn = new Set(own.map((line) => line.member));
  const nested = new Map();
  for (const line of lines.values())
    if (line.via !== panel && !shownOwn.has(line.member))
      nested.set(line.via, [...(nested.get(line.via) ?? []), line]);
  const groups = [
    { via: panel, lines: own.sort(byPlace) },
    ...[...nested]
      .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)))
      .map(([via, each]) => ({ via, lines: each.sort(byPlace) })),
  ].filter((group) => group.lines.length > 0);
  // The query's own answer: its missing rows are exact, and a held result is required in the panel when its row is one
  // the panel lists itself and says R, or when a missing test sits in the same nested panel (the query puts one there
  // only when every nesting row on the way says R). A held member of any other nested panel is not counted: its own
  // row says nothing of its parent's requirement.
  const missing = [
    ...new Map(
      [...lines.values()]
        .filter((line) => line.results.length === 0 && line.required === "R")
        .map((line) => [line.member, line]),
    ).values(),
  ];
  const requiredVias = new Set([panel, ...missing.map((line) => line.via)]);
  const required = [
    ...new Map(
      [...lines.values()]
        .filter(
          (line) =>
            line.required === "R" &&
            (line.results.length === 0 || requiredVias.has(line.via)),
        )
        .map((line) => [line.member, line]),
    ).values(),
  ];
  const title = nameOf(panel);
  const said =
    rows.length === 0
      ? "You have no results in this panel."
      : required.length === 0
        ? "LOINC requires none of this panel's tests."
        : missing.length === 0
          ? `You have ${required.length === 1 ? "the one required test" : `all ${required.length} required tests`}.`
          : `You have ${required.length - missing.length} of ${required.length} required test${required.length === 1 ? "" : "s"}; missing: ${listed(missing.map((line) => nameOf(line.member)))}.`;
  const requirement = (line) =>
    line.required === undefined
      ? undefined
      : (REQUIRED[line.required] ?? line.required);
  const listing = (group) =>
    html`<ol class="members">${group.lines.map(
      (line) =>
        html`<li><strong>${nameOf(line.member)}</strong>${requirement(line) !== undefined && html` <span class="muted">${requirement(line)}</span>`}${
          line.results.length === 0
            ? html` <span class="tag warm">No result</span>`
            : html`<ul>${line.results
                .sort((a, b) =>
                  compare("date", b.performed ?? "", a.performed ?? ""),
                )
                .map((result) => {
                  const value =
                    [result.value, result.unit].filter(Boolean).join(" ") ||
                    "Result";
                  return html`<li>${entryHref === undefined ? value : html`<a href=${entryHref(result.entry)}>${value}</a>`}${result.performed !== undefined && html` <span class="muted">${day(result.performed)}</span>`}</li>`;
                })}</ul>`
        }</li>`,
    )}</ol>`;
  const versions = [
    ...new Set(
      [
        ...rows.map((row) => row.origin),
        ...[...about.values()].map((said) => said?.name?.origin),
      ].filter(Boolean),
    ),
  ].flatMap((origin) => heldAt(origin, held) ?? []);
  const naming = about.get(panel)?.name?.origin;
  const named = naming === undefined ? undefined : heldAt(naming, held);
  return html`<p><a href=${back}>Back to ${personName(pod, titles)}</a></p>
<h1>Your results in ${title}</h1>
<p class="lead">${said}</p>
${
  rows.length > 0 &&
  html`<p class="muted">${
    named !== undefined && codeHref !== undefined
      ? html`LOINC <a href=${codeHref(named.series, about.get(panel).notation)}>${about.get(panel).notation}</a> lists`
      : "LOINC lists"
  } these tests in this panel; that does not say your results were drawn as part of it.</p>`
}
${groups.map(
  (group) =>
    html`<div class="card"><h2>${group.via === panel ? "Tests in the panel's order" : `Within ${nameOf(group.via)}`}</h2>${listing(group)}</div>`,
)}
${versions.length > 0 && html`<p class="muted from">From ${listed(versions.map(({ series, version }) => `${series.label}, ${versionName(version)}`))}.</p>`}
${[...new Set(versions.flatMap(({ series }) => series.credit ?? []))].map((credit) => html`<p class="muted">${credit}</p>`)}`;
}

/** The page of reference tables when the app holds none. */
export function noTables() {
  return html`<h1>No reference tables yet</h1>
<p class="lead">Reference tables name codes and join records that say the same thing differently. This app keeps the ones its feeds publish; Check now reads them.</p>`;
}

/**
 * What a check did, as one note: `checked` its answer, `held` what the app holds after it, as `held()` gives it, to
 * name each version kept.
 */
export function checkedNote(checked, held) {
  const kept = checked.flatMap((each) => each.kept);
  const named = (version) => {
    const series = held.find((each) =>
      each.versions.some((one) => one.iri === version),
    );
    const found = series?.versions.find((one) => one.iri === version);
    return series === undefined
      ? "a version"
      : `${series.label}, ${versionName(found)}`;
  };
  const said = [
    kept.length > 0 && `Kept ${listed(kept.map(named))}.`,
    ...checked.flatMap(({ later }) =>
      later === undefined ? [] : [`Not read now, tried again later: ${later}.`],
    ),
    ...checked.flatMap(({ refused }) =>
      refused.map(({ reason }) => `Refused a version: ${reason}.`),
    ),
  ].filter(Boolean);
  return said.length === 0 ? "Checked the feeds: nothing new." : said.join(" ");
}

const BRINGING = "Bringing the record in…";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** An instant as a program gives it: to the second, with a timezone, every part one the demo hospitals accept. */
const WORLD_INSTANT =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]((0\d|1[0-3]):[0-5]\d))$/;

/** Whether `text`, as `YYYY-MM-DD`, names a day of the calendar. */
function isDay(text) {
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(text);
}

/**
 * The world's date a person or a program gave, as the instant a hospital answers as of: a calendar day `D`
 * (`YYYY-MM-DD`) is the end of that day in UTC, `D` and `T23:59:59Z`; an instant with a timezone is kept as it is.
 * Undefined for anything else, empty text and a year below 1000 included.
 */
export function worldInstant(text) {
  const given = String(text ?? "").trim();
  if (Number(given.slice(0, 4)) < 1000) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(given))
    return isDay(given) ? `${given}T23:59:59Z` : undefined;
  return WORLD_INSTANT.test(given) &&
    isDay(given.slice(0, 10)) &&
    !Number.isNaN(Date.parse(given))
    ? given
    : undefined;
}

/** The UTC day of an instant, in words: `1 February 2024`. */
function dayInWords(asOf) {
  const day = new Date(Date.parse(asOf));
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

/** What the hospitals answer as of, said in words: `Hospitals answer as of 1 February 2024.`, or with no date, with everything. */
export function worldDateSaid(asOf) {
  if (asOf === undefined) return "Hospitals answer with everything they hold.";
  return `Hospitals answer as of ${dayInWords(asOf)}.`;
}

/** What a pull answered as of, in words: `Pulled as of 1 February 2024.`; undefined when no date was set. */
export function pulledAsOfSaid(asOf) {
  return asOf === undefined ? undefined : `Pulled as of ${dayInWords(asOf)}.`;
}

/**
 * The form that sets the world's date: a day to pick and a Set button, and beside it a Today button that sends an
 * empty date. Both post to `action`, the day field `date`.
 */
function worldDateForms({ asOf, action }) {
  return html`<form method="post" action=${action} class="inline" data-doing="Setting the date…">
<label>Date <input type="date" name="date" value=${asOf === undefined ? undefined : new Date(Date.parse(asOf)).toISOString().slice(0, 10)} required /></label>
<button>Set</button>
</form>
${postButton(action, { date: "" }, "Today", "quiet", "Setting the date…")}`;
}

/**
 * The line where a sign-in begins about the world's date: what the hospitals answer as of, `asOf`, and a way to change
 * it, `href` a link to the page that does, else `action` where the line opens the forms in place.
 */
function worldDateLine({ asOf, href, action }) {
  return html`<div class="world-date">
<p class="muted">${worldDateSaid(asOf)}${href !== undefined && html` <a href=${href}>Change the world's date</a>`}</p>
${
  href === undefined &&
  html`<details>
<summary>Change the world's date</summary>
${worldDateForms({ asOf, action })}
</details>`
}
</div>`;
}

/**
 * The page where the world's date is changed, on a host that has pages: the date the hospitals answer as of, `asOf`
 * (an instant, or undefined for everything they hold), the forms that post to `action`, `problem` when the last date
 * given was no date, and a link `back`.
 */
export function worldDatePage({ asOf, action, problem, back }) {
  return html`<h1>The world's date</h1>
<p class="lead">${worldDateSaid(asOf)}</p>
${problem !== undefined && html`<p class="note" role="alert">${problem}</p>`}
<div class="card world-date">
<p>Pick a day: the hospitals then show their records as they stood at the end of it. Today puts the date back to now, with everything they hold.</p>
${worldDateForms({ asOf, action })}
</div>
${back !== undefined && html`<p><a href=${back}>Back</a></p>`}`;
}

/**
 * A connection to the hospital named `hospital`, for the pod `pod`, as a box over the pod's page with the id `id`,
 * which closes to `back`. While `connection.step` is `signing in` or `pulling`, its steps; else `failed` when given, a
 * sentence of why, with a Try again button when `retry`; else its steps, whose record `about` is when not the pod's
 * person, what each of `sources` (from `look`) holds, what `pulled` left out, and a button that posts to `bring`.
 * With `pulledAsOf`, the instant the pull was made under (undefined: no date), the box says what the pull answered as of.
 */
export function connectionDialog({
  id,
  pod,
  titles,
  hospital,
  back,
  connection,
  failed,
  retry,
  sources = [],
  pulled,
  about,
  bring,
  pulledAsOf,
}) {
  const who = personName(pod, titles);
  const name = hospitalName(hospital);
  const said = (body) => box(id, name, body, { back });
  if (connection.step === "bringing in")
    return said(
      html`<div class="card"><${Steps} connection=${connection} /></div>`,
    );
  if (connection.step === "signing in" || connection.step === "pulling")
    return said(
      html`<div class="card"><${Steps} connection=${connection} /><p class="muted">This refreshes itself until the record is here.</p></div>`,
    );
  if (failed !== undefined)
    return said(
      html`<div class="card"><p>${failed}</p>${retry && postButton(bring, {}, "Try again", undefined, BRINGING)}</div>`,
    );
  const has = sources.map(
    (source) =>
      html`<p><strong>What ${name} has:</strong> ${counted(source.records) || "nothing"}.</p>
<p class="muted">${who}'s pod ${source.claimed ? "already has records from here" : "has nothing from here yet"}.</p>`,
  );
  const denied = pulled.denied.map(({ type, category }) =>
    category === undefined ? type : `${type} (${category})`,
  );
  return said(html`<div class="card"><${Steps} connection=${connection} /></div>
${
  about !== undefined &&
  slug(about) !== pod &&
  html`<p class="note">This record is ${about}'s. Bringing it in makes this ${about}'s pod.</p>`
}
<div class="card">
${has}
${pulled.missing.length > 0 && html`<p class="muted">Mentioned, but not sent: ${pulled.missing.join(", ")}</p>`}
${denied.length > 0 && html`<p class="muted">Not allowed to read: ${denied.join(", ")}</p>`}
${pulledAsOfSaid(pulledAsOf) !== undefined && html`<p class="muted">${pulledAsOfSaid(pulledAsOf)}</p>`}
${postButton(bring, {}, `Bring it into ${who}'s pod`, undefined, BRINGING)}
</div>`);
}

export const STYLE = `
:root {
  --page: #f6f7f8; --panel: #ffffff; --text: #1f2933; --muted: #5f6b76;
  --line: #e1e5e8; --soft: #eef1f3; --accent: #2b6a8e; --on-accent: #ffffff;
  --tint: #eaf3f8; --bar: #243b4a; --on-bar: #f3f5f6;
  --warm: #b0432f; --warm-bg: #fbeae6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #1a1d20; --panel: #23272b; --text: #e6e9ec; --muted: #9aa5ae;
    --line: #353b41; --soft: #2c3237; --accent: #8fc1dc; --on-accent: #14202a;
    --tint: #243239; --bar: #101417; --on-bar: #e6e9ec;
    --warm: #f0a08f; --warm-bg: #3c2622;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.55 system-ui, sans-serif; background: var(--page); color: var(--text); }
header.bar { display: flex; align-items: center; gap: 1rem; padding: 0.6rem 1.25rem; background: var(--bar); color: var(--on-bar); }
header.bar > a { color: var(--on-bar); text-decoration: none; font-weight: 600; letter-spacing: 0.02em; }
header.bar .demo { margin-left: auto; font-size: 0.8rem; opacity: 0.75; }
.menu { position: relative; font-size: 0.9rem; }
.menu summary { list-style: none; cursor: pointer; padding: 0.1rem 0.5rem; border-radius: 5px; }
.menu summary::-webkit-details-marker { display: none; }
.menu summary:hover, .menu[open] summary { background: rgb(255 255 255 / 0.14); }
.menu ul { position: absolute; top: calc(100% + 0.35rem); left: 0; z-index: 10; min-width: 11rem; list-style: none; margin: 0; padding: 0.3rem; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.25); }
.menu li a { display: block; padding: 0.4rem 0.7rem; border-radius: 5px; color: var(--text); text-decoration: none; white-space: nowrap; }
.menu li a:hover, .menu li a:focus { background: var(--soft); }
@media (max-width: 46rem) {
  header.bar { gap: 0.5rem; padding: 0.6rem 1rem; }
  header.bar .demo { font-size: 0.72rem; text-align: right; }
}
.layout { display: grid; grid-template-columns: 15rem 1fr; min-height: calc(100vh - 2.7rem); }
aside { background: var(--panel); border-right: 1px solid var(--line); padding: 1.25rem 1rem; }
main { padding: 1.75rem 2.25rem 3rem; max-width: 62rem; min-width: 0; }
@media (max-width: 46rem) {
  .layout { grid-template-columns: 1fr; min-height: 0; }
  aside { border-right: 0; border-bottom: 1px solid var(--line); }
  main { padding: 1.25rem; }
}
aside h2 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 0.5rem 0.6rem; }
nav ul, .tables ul { list-style: none; padding: 0; margin: 0 0 1rem; }
nav a, .tables li a { display: block; padding: 0.4rem 0.6rem; border-radius: 6px; color: var(--text); text-decoration: none; }
nav a:hover, .tables li a:hover { background: var(--soft); }
nav a[aria-current], .tables li a[aria-current] { background: var(--tint); color: var(--accent); font-weight: 600; }
.tables { margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
.tables p { margin: 0 0 0.75rem 0.6rem; }
.tables form { display: block; }
.tables button { width: 100%; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1.25rem; margin: 0; }
.facts dt { color: var(--muted); font-size: 0.9rem; }
.facts dd { margin: 0; }
.versions ul { margin: 0; padding-left: 1.2rem; }
.versions li { margin: 0.3rem 0; }
.pages { display: flex; gap: 1rem; margin: 0.6rem 0 1.25rem; }
h1 { font-size: 1.75rem; margin: 0 0 0.2rem; }
h2 { font-size: 1.05rem; margin: 0 0 0.6rem; }
a { color: var(--accent); }
.muted { color: var(--muted); font-size: 0.9rem; }
.lead { color: var(--muted); margin: 0 0 0.6rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 1.5rem; padding: 0; list-style: none; }
.chips li { font-size: 0.82rem; padding: 0.15rem 0.6rem; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); color: var(--muted); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.1rem 1.25rem; margin: 0 0 1.25rem; }
.worth { background: var(--tint); border-color: transparent; }
.worth ul { margin: 0; padding-left: 1.2rem; }
.worth li { margin: 0.3rem 0; }
.worth a { color: var(--text); }
.worth a:hover { color: var(--accent); }
.changes .change { padding: 0.9rem 0; border-top: 1px solid var(--line); }
.changes h2 + .change { border-top: 0; padding-top: 0; }
.changes p { margin: 0.25rem 0; }
.changes .said { font-weight: 600; }
.changes .how { padding: 0.9rem 0; border-top: 1px solid var(--line); }
.changes .how h3 { font-size: 0.95rem; margin: 0 0 0.3rem; }
.changes .how ol { margin: 0.25rem 0; padding-left: 1.4rem; }
.chart { display: block; max-width: 100%; height: auto; }
.chart.small { width: 15rem; margin: 0.4rem 0; }
.chart.large, .chart.lane { width: 100%; }
.chart .grid { stroke: var(--line); stroke-width: 1; }
.chart .tick, .chart .lane-label { fill: var(--muted); font-size: 11px; font-family: inherit; }
.chart .series { stroke: var(--accent); stroke-width: 2; }
.chart .marker { fill: var(--accent); stroke: var(--panel); stroke-width: 1; }
.chart .mark { stroke: var(--text); stroke-width: 1.5; stroke-dasharray: 5 4; }
.chart .bar { fill: var(--muted); opacity: 0.55; }
.chart .bar.chosen { fill: var(--accent); opacity: 1; }
.chart .lane-label.chosen { fill: var(--text); font-weight: 600; }
.picker h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0.6rem 0 0.3rem; }
.picker ul { list-style: none; margin: 0 0 0.6rem; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
.picker a { display: inline-block; padding: 0.15rem 0.7rem; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; }
.picker a[aria-current] { background: var(--tint); border-color: var(--accent); font-weight: 600; }
.entry ul { margin: 0; padding-left: 1.2rem; }
.entry li { margin: 0.3rem 0; }
.entry .from { display: block; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr)); gap: 1rem; margin: 0 0 1.25rem; }
.tile { display: block; padding: 1rem 1.1rem; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; color: var(--text); text-decoration: none; }
.tile:hover { border-color: var(--accent); background: var(--tint); }
.tile-box { display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.tile-box:hover { border-color: var(--accent); }
.tile-box .tile { flex: 1; border: 0; border-radius: 0; }
.tile-box .by { display: block; padding: 0.55rem 1.1rem; border-top: 1px solid var(--line); font-weight: 600; text-decoration: none; }
.tile-box .by:hover { background: var(--tint); }
.tile .kind { display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.tile .count { display: block; font-size: 2rem; font-weight: 600; line-height: 1.2; color: var(--accent); }
.tile .peek { display: block; font-size: 0.88rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.2rem; }
.filter { width: 100%; margin: 0.25rem 0 0.75rem; }
.scroll { max-height: 60vh; overflow: auto; padding-right: 0.75rem; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { text-align: left; vertical-align: baseline; padding: 0.45rem 0.6rem; border-top: 1px solid var(--line); }
th { border-top: 0; position: sticky; top: 0; background: var(--panel); }
th button { all: unset; cursor: pointer; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); white-space: nowrap; }
th button:hover, th[aria-sort] button { color: var(--accent); }
th[aria-sort="ascending"] button::after { content: " ↑"; }
th[aria-sort="descending"] button::after { content: " ↓"; }
td:first-child { font-weight: 500; }
tr[hidden] { display: none; }
.tag { display: inline-block; font-size: 0.74rem; padding: 0.05rem 0.5rem; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.tag.warm { border-color: transparent; background: var(--warm-bg); color: var(--warm); font-weight: 600; }
.button, button { display: inline-block; font: inherit; padding: 0.45rem 1rem; border-radius: 7px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); cursor: pointer; text-decoration: none; }
.button.quiet, button.quiet { background: transparent; color: var(--accent); }
button.warm { background: var(--warm); border-color: var(--warm); color: var(--panel); }
.button.wide { display: block; text-align: center; }
input { font: inherit; padding: 0.45rem 0.65rem; border: 1px solid var(--line); border-radius: 7px; background: var(--page); color: var(--text); }
form.inline { display: inline; }
.world-date summary { cursor: pointer; color: var(--accent); }
.world-date details { margin: 0 0 0.75rem; }
.world-date form { margin: 0.4rem 0.4rem 0 0; }
.row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.row input { flex: 1; min-width: 10rem; }
.encrypt { margin: 0.75rem 0; }
.encrypt .muted { display: block; margin-left: 1.6rem; }
.words { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; list-style: none; padding: 0; margin: 1rem 0; counter-reset: word; }
.words li { counter-increment: word; background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 0.8rem 1rem; font-size: 1.35rem; font-weight: 600; }
.words li::before { content: counter(word); color: var(--muted); font-size: 0.8rem; font-weight: 400; margin-right: 0.6rem; }
.stack { display: flex; flex-direction: column; gap: 0.6rem; max-width: 24rem; }
.stack label { display: flex; flex-direction: column; gap: 0.25rem; }
.row h2 { flex: 1; margin: 0; }
.steps { list-style: none; padding: 0; margin: 0; }
.steps li { padding: 0.15rem 0; color: var(--muted); }
.steps li::before { content: "○  "; }
.steps li.done { color: var(--text); }
.steps li.done::before { content: "✓  "; color: var(--accent); }
.steps li.now { color: var(--text); font-weight: 600; }
.steps li.now::before { content: "…  "; }
.note { border-left: 3px solid var(--accent); padding: 0.5rem 0.9rem; background: var(--tint); border-radius: 0 7px 7px 0; margin: 0 0 1.25rem; }
.dialog { display: none; position: fixed; inset: 0; z-index: 20; background: rgb(0 0 0 / 0.45); padding: 1rem; overflow: auto; }
.dialog:target { display: grid; place-items: center; }
.dialog .backdrop { position: fixed; inset: 0; }
.dialog .box { position: relative; background: var(--panel); border-radius: 12px; padding: 1.5rem 1.75rem; max-width: 34rem; width: 100%; box-shadow: 0 10px 40px rgb(0 0 0 / 0.3); }
.dialog .box.wide { max-width: 44rem; }
.dialog .close { float: right; text-decoration: none; color: var(--muted); font-size: 1.4rem; line-height: 1; }
.people { list-style: none; padding: 0; margin: 0.5rem 0 1.25rem; }
.people li { margin: 0.35rem 0; }
.people form { display: block; }
.people button, .people .button { display: block; width: 100%; text-align: left; background: var(--soft); color: var(--text); border-color: var(--line); }
.people button:hover, .people .button:hover { border-color: var(--accent); background: var(--tint); }
.people .muted { display: block; font-size: 0.8rem; }
.doing { position: fixed; top: 0.5rem; left: 50%; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 0.6rem; margin: 0; padding: 0.4rem 1rem; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 4px 16px rgb(0 0 0 / 0.2); }
.doing[hidden] { display: none; }
.spinner { width: 1rem; height: 1rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
body[data-state="busy"] { cursor: progress; }
`;

/** The chat strip's styles, from `STYLE`'s colours so dark mode follows; a page that has a strip gets them after `STYLE`. */
export const CHAT_STYLE = `
.chat { position: sticky; bottom: 0; z-index: 8; display: flex; flex-direction: column; max-height: max(33vh, 15rem); background: var(--panel); border-top: 1px solid var(--line); padding: 0.6rem 1.25rem; box-shadow: 0 -4px 16px rgb(0 0 0 / 0.08); }
.chat [hidden] { display: none; }
.chat-off { margin: 0; color: var(--muted); font-size: 0.9rem; }
.chat-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin: 0 0 0.4rem; }
.chat > * { flex: none; }
.chat > .chat-log, .chat > .chat-chips { flex: 0 1 auto; min-height: 0; overflow: auto; }
.chat > .chat-log { min-height: 4rem; }
.chat-about { margin: 0 0 0.4rem; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
@media (max-width: 46rem) {
  .chat-bar { gap: 0.25rem 0.75rem; }
  .chat-about { -webkit-line-clamp: 1; line-clamp: 1; }
}
.chat[data-folded="true"] > :not(.chat-bar) { display: none; }
.chat[data-folded="true"] .chat-bar { margin: 0; }
.chat-bar .chat-new { margin-left: auto; }
.chat-bar .chat-new, .chat-bar .chat-fold { padding: 0.15rem 0.7rem; }
.chat-recent { position: relative; font-size: 0.9rem; }
.chat-recent summary { cursor: pointer; color: var(--accent); }
.chat-recent ul { position: absolute; bottom: calc(100% + 0.35rem); left: 0; z-index: 10; min-width: 16rem; max-height: 14rem; overflow: auto; list-style: none; margin: 0; padding: 0.3rem; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.25); }
.chat-recent li button { display: block; width: 100%; text-align: left; background: transparent; color: var(--text); border-color: transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-recent li button:hover { background: var(--soft); }
.chat-recent li.empty { padding: 0.3rem 0.6rem; color: var(--muted); }
.chat-log { margin: 0 0 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
.chat-log .you { align-self: flex-end; max-width: 80%; background: var(--tint); border-radius: 10px; padding: 0.3rem 0.8rem; white-space: pre-wrap; }
.chat-log .model { white-space: pre-wrap; }
.chat-log .stopped { color: var(--muted); font-size: 0.9rem; }
.chat-log .refused { border-left: 3px solid var(--accent); background: var(--soft); padding: 0.4rem 0.8rem; border-radius: 0 7px 7px 0; }
.chat-log .failed { border-left: 3px solid var(--warm); background: var(--warm-bg); color: var(--warm); padding: 0.4rem 0.8rem; border-radius: 0 7px 7px 0; }
.chat-log .card { margin: 0; padding: 0.7rem 0.9rem; background: var(--page); }
.chat-log .card p { margin: 0.15rem 0; }
.chat-log .card ul { list-style: none; margin: 0.4rem 0; padding: 0; max-height: 9rem; overflow: auto; font-size: 0.9rem; }
.chat-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 0.5rem; }
.chat-chips button { font-size: 0.85rem; padding: 0.15rem 0.7rem; border-radius: 999px; }
button.ask { position: relative; font-size: inherit; line-height: 1; padding: 0.15em 0.3em; border-color: transparent; vertical-align: middle; }
button.ask svg { display: block; width: 1.1em; height: 1.1em; }
button.ask:hover { background: var(--panel); border-color: var(--line); }
@media (pointer: coarse) { button.ask::after { content: ""; position: absolute; inset: -6px -8px; } }
button.ask:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.chat-form { display: flex; gap: 0.5rem; }
.chat-form input { flex: 1; min-width: 0; }
`;

/**
 * On the document `page`: a click anywhere but on an open menu's own name closes that menu; Escape closes an open menu,
 * and follows the open box's own close link. The listeners are added once however often this runs on the page.
 */
export function closing(page) {
  if (page.closesOnEscape) return;
  page.closesOnEscape = true;
  const closeMenus = (except) => {
    for (const menu of page.querySelectorAll("details.menu[open]"))
      if (menu !== except) menu.open = false;
  };
  page.addEventListener("click", (event) =>
    closeMenus(event.target.closest?.("summary")?.parentElement),
  );
  page.addEventListener("keydown", (event) => {
    const { location } = page.defaultView;
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key !== "Escape") return;
    closeMenus();
    const close = page.querySelector(".dialog:target .close");
    if (close) close.click();
    else if (location.hash !== "") location.hash = "";
  });
}

/**
 * In a page rendered to a string, under `root`: a heading sorts its table by its column, one way then the other, and a
 * filter box hides the rows without its text, as `Table` does in a browser.
 */
export function sortAndFilter(root, by = compare) {
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("th button");
    if (!button) return;
    const th = button.parentElement;
    const at = [...th.parentElement.children].indexOf(th);
    const up = th.getAttribute("aria-sort") !== "ascending";
    for (const other of th.parentElement.children)
      other.removeAttribute("aria-sort");
    th.setAttribute("aria-sort", up ? "ascending" : "descending");
    const body = th.closest("table").tBodies[0];
    const key = (row) => row.cells[at].dataset.key;
    [...body.rows]
      .sort((a, b) => (up ? 1 : -1) * by(button.dataset.type, key(a), key(b)))
      .forEach((row) => body.append(row));
  });
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.matches?.(".filter")) return;
    const wanted = input.value.trim().toLowerCase();
    for (const row of input.parentElement.querySelectorAll("tbody tr"))
      row.hidden = !row.textContent.toLowerCase().includes(wanted);
  });
}

/**
 * On the document `page`, rendered to a string: a form's submit turns every button off, says the form's `data-doing`
 * in the page's `doing` line and sets `data-state="busy"` on the body until the page changes; a second submit
 * meanwhile does nothing. A page shown again from the browser's history is on again.
 */
export function busyForms(page) {
  const line = page.querySelector(".doing");
  const busy = (on, said) => {
    if (on) page.body.dataset.state = "busy";
    else delete page.body.dataset.state;
    for (const button of page.querySelectorAll("button")) button.disabled = on;
    line.hidden = !on;
    line.querySelector(".said").textContent = said ?? "";
  };
  page.addEventListener("submit", (event) => {
    if (event.defaultPrevented) return;
    if (page.body.dataset.state === "busy") return event.preventDefault();
    busy(true, event.target.dataset.doing ?? "Working…");
  });
  page.defaultView.addEventListener("pageshow", (event) => {
    if (event.persisted) busy(false);
  });
}

/**
 * On the document `page`, rendered to a string: the chat strip (`Chat`) talks to `POST /chat`. Chats are kept by the
 * browser in `localStorage` as `{ id, pod, title, context?, messages, updated }`, each under the pod it is about; the
 * open chat's ID is in `sessionStorage` under `cascade.chat.open`, so the page an `open` moves the app to reopens it.
 * A message is `{ role: "user" | "assistant", content, findings?, kind? }`; only `user` and `assistant` text without a
 * `kind` (a refusal or an error, which the model did not say) is sent, the newest within `budget` characters. Any
 * element with `data-ask` (a JSON context) starts a new chat with that context, and one with `data-ask-text` sends its
 * text as typed. A `data-ask` click also sends `first(context)`, when it names one, as the person's first question; a
 * turn still running is stopped first. The listeners are added once. A strip with `data-encrypted="true"` keeps its
 * chats only in the page: nothing goes to `localStorage` or `sessionStorage`.
 */
export function chatStrip(page, budget = 24000, first = undefined) {
  const strip = page.querySelector(".chat[data-pod]");
  if (!strip || strip.ready) return;
  strip.ready = true;
  const win = page.defaultView;
  const pod = strip.dataset.pod;
  const log = strip.querySelector(".chat-log");
  const about = strip.querySelector(".chat-about");
  const chips = strip.querySelector(".chat-chips");
  const input = strip.querySelector("input");
  const send = strip.querySelector(".chat-send");
  const stop = strip.querySelector(".chat-stop");
  const recent = strip.querySelector(".chat-recent");
  const SAVED = "cascade.chats";
  const OPEN = "cascade.chat.open";
  const FOLDED = "cascade.chat.folded";
  const ENTRIES = 30;
  const podOf = (address) => {
    const at = /^\/pods\/([^/]+)\//.exec(address);
    return at ? decodeURIComponent(at[1]) : "";
  };
  const storing = (action) => {
    try {
      return action();
    } catch {
      return undefined;
    }
  };
  const sealed = strip.dataset.encrypted === "true";
  let inPage = [];
  const load = () => {
    if (sealed) return inPage;
    const saved = storing(() => JSON.parse(win.localStorage.getItem(SAVED)));
    return Array.isArray(saved) ? saved : [];
  };
  const fresh = (context, label) => ({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    pod,
    title: "",
    ...(context === undefined ? {} : { context, label }),
    messages: [],
    updated: Date.now(),
  });
  let chats = load();
  const opened = storing(() => win.sessionStorage.getItem(OPEN));
  let chat =
    chats.find((each) => each.id === opened && each.pod === pod) ?? fresh();
  let running;
  let turn;
  let taken = false;
  for (const kind of ["wheel", "touchmove", "pointerdown", "keydown"])
    log.addEventListener(kind, () => (taken = true), { passive: true });

  const toggle = strip.querySelector(".chat-fold");
  const fold = (folded) => {
    strip.dataset.folded = folded ? "true" : "false";
    toggle.setAttribute("aria-expanded", String(!folded));
    toggle.textContent = folded ? "Show chat" : "Hide chat";
    storing(() => win.sessionStorage.setItem(FOLDED, String(folded)));
  };
  fold(storing(() => win.sessionStorage.getItem(FOLDED)) === "true");

  const keep = () => {
    chat.updated = Date.now();
    chats = [chat, ...load().filter((each) => each.id !== chat.id)]
      .filter((each) => each.messages.length > 0)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, ENTRIES);
    if (sealed) {
      inPage = chats;
      return;
    }
    storing(() => {
      win.localStorage.setItem(SAVED, JSON.stringify(chats));
      win.sessionStorage.setItem(OPEN, chat.id);
    });
  };
  const make = (tag, className, text) => {
    const made = page.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    return made;
  };
  const round = (number) => Math.round(number * 10) / 10;
  const side = (name, each, unit) =>
    each.count === 0
      ? `${name}: no results`
      : `${name}: mean ${round(each.mean)} ${unit} over ${each.count} ${each.count === 1 ? "result" : "results"} (${round(each.min)} to ${round(each.max)})`;
  const card = (finding) => {
    const made = make("div", "card");
    const test =
      finding.test.name ?? finding.test.notation ?? finding.test.code;
    made.append(
      make(
        "p",
        "said",
        finding.said ??
          `${test}: not enough results around ${finding.medication.name}`,
      ),
      make("p", "muted", side("Before", finding.before, finding.unit)),
      make("p", "muted", side("After", finding.after, finding.unit)),
    );
    const base = finding.view.replace(/trend\?.*$/, "");
    const rows = make("ul");
    for (const row of finding.rows) {
      const item = make("li");
      const link = make(
        "a",
        "",
        `${row.performed.slice(0, 10)}: ${row.value} ${row.unit}`,
      );
      link.href = `${base}entries/${encodeURIComponent(row.entry)}`;
      item.append(link, " ", make("span", "tag", row.side));
      rows.append(item);
    }
    const open = make("button", "quiet", "Open the trend");
    open.type = "button";
    open.dataset.open = finding.view;
    made.append(rows, open);
    return made;
  };
  const view = (message) => {
    if (message.role === "user") return make("div", "you", message.content);
    if (message.kind)
      return make(
        "div",
        message.kind === "refused" ? "refused" : "failed",
        (message.kind === "refused" ? "The model declined: " : "No answer: ") +
          message.content,
      );
    const made = make("div", "model", message.content);
    for (const finding of message.findings ?? []) made.append(card(finding));
    if (message.stopped) made.append(make("div", "stopped", "Stopped."));
    if (message.cut) made.append(make("div", "stopped", "Cut short."));
    return made;
  };
  const draw = () => {
    log.replaceChildren(...chat.messages.map(view));
    log.hidden = chat.messages.length === 0;
    about.hidden = chat.context === undefined;
    about.textContent = about.hidden ? "" : `About: ${chat.label}`;
    about.title = about.textContent;
    chips.hidden =
      chat.messages.length > 0 ||
      chat.context !== undefined ||
      chips.children.length === 0;
    const at = turn ?? chat.messages.findLastIndex((m) => m.role === "user");
    const asked = at < 0 ? undefined : log.children[at];
    if (asked === undefined) log.scrollTop = log.scrollHeight;
    else if (!taken) {
      const answer = log.children[at + 1] ?? asked;
      const room = log.clientHeight;
      const start =
        answer.getBoundingClientRect().top - asked.getBoundingClientRect().top >
        room * 0.75
          ? answer
          : asked;
      log.scrollTop +=
        start.getBoundingClientRect().top - log.getBoundingClientRect().top;
    }
    send.hidden = running !== undefined;
    stop.hidden = running === undefined;
    const list = recent.querySelector("ul");
    const here = chats.filter((each) => each.pod === pod);
    list.replaceChildren(
      ...(here.length === 0
        ? [make("li", "empty", "No chats yet")]
        : here.map((each) => {
            const item = make("li");
            const button = make("button", "", each.title);
            button.type = "button";
            button.dataset.chat = each.id;
            item.append(button);
            return item;
          })),
    );
  };
  const go = (address) => {
    chat.pod = podOf(address);
    keep();
    win.location.assign(address);
  };
  const wire = () => {
    const kept = [];
    let characters = 0;
    for (const message of chat.messages.slice(0, -1).reverse()) {
      if (message.kind || !message.content) continue;
      characters += message.content.length;
      if (characters > budget && kept.length > 0) break;
      kept.unshift({ role: message.role, content: message.content });
    }
    while (kept[0]?.role === "assistant") kept.shift();
    return kept.slice(-100);
  };
  const note = (kind, content) =>
    chat.messages.push({ role: "assistant", kind, content });

  async function ask(text) {
    text = text.trim();
    if (text === "" || running) return;
    fold(false);
    chat.title ||= text.slice(0, 60);
    turn = chat.messages.length;
    taken = false;
    chat.messages.push({ role: "user", content: text });
    const answer = { role: "assistant", content: "" };
    chat.messages.push(answer);
    running = new win.AbortController();
    keep();
    draw();
    let moveTo;
    let afterTool = false;
    const handle = (event) => {
      if (event.type === "delta") {
        if (afterTool && answer.content !== "") answer.content += "\n\n";
        afterTool = false;
        answer.content += event.text;
      } else if (event.type === "done") answer.cut = event.stop === "length";
      else if (event.type === "tool") {
        afterTool = true;
        if (event.findings)
          answer.findings = [...(answer.findings ?? []), ...event.findings];
        if (event.open) moveTo = event.open;
      } else if (event.type === "refused") note("refused", event.text);
      else if (event.type === "error") note("error", event.message);
    };
    try {
      const response = await win.fetch("/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: running.signal,
        body: JSON.stringify({
          pod: chat.pod,
          page: win.location.pathname + win.location.search,
          messages: wire(),
          ...(chat.context === undefined ? {} : { context: chat.context }),
        }),
      });
      if (!response.ok)
        note(
          "error",
          (await response.json().catch(() => ({}))).error ??
            `the app answered ${response.status}`,
        );
      else {
        const reader = response.body.getReader();
        const decoder = new win.TextDecoder();
        let pending = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop();
          for (const line of lines)
            if (line !== "") {
              handle(JSON.parse(line));
              draw();
            }
        }
      }
    } catch (error) {
      if (error.name === "AbortError") answer.stopped = true;
      else note("error", `the app could not be reached: ${error.message}`);
    }
    running = undefined;
    if (answer.content === "" && !answer.findings && !answer.stopped)
      chat.messages.splice(chat.messages.indexOf(answer), 1);
    keep();
    draw();
    turn = undefined;
    if (moveTo && !answer.stopped) go(moveTo);
    else input.focus();
  }

  const begin = (context, label) => {
    chat = fresh(context, label);
    storing(() => win.sessionStorage.removeItem(OPEN));
    fold(false);
    draw();
    input.focus();
  };
  let turnEnded = Promise.resolve();
  let clicks = 0;
  const asking = async (target) => {
    let context;
    try {
      context = JSON.parse(target.dataset.ask);
    } catch {
      return;
    }
    const mine = ++clicks;
    if (running) {
      if (
        chat.messages.length <= 2 &&
        JSON.stringify(chat.context) === JSON.stringify(context)
      )
        return;
      running.abort();
      await turnEnded;
      if (mine !== clicks) return;
    }
    begin(context, target.dataset.askLabel);
    const question = first?.(context);
    if (question) turnEnded = ask(question);
  };
  strip.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = "";
    turnEnded = ask(text);
  });
  page.addEventListener("click", (event) => {
    const target = event.target.closest?.(
      "[data-ask], [data-ask-text], [data-open], [data-chat], .chat-new, .chat-stop, .chat-fold",
    );
    if (!target) return;
    if (target.matches(".chat-fold"))
      return fold(strip.dataset.folded !== "true");
    if (target.matches(".chat-stop")) return running?.abort();
    if (target.dataset.ask !== undefined) return asking(target);
    if (running) return;
    if (target.matches(".chat-new")) return begin();
    if (target.dataset.open) return go(target.dataset.open);
    if (target.dataset.chat) {
      chat = chats.find((each) => each.id === target.dataset.chat) ?? chat;
      recent.open = false;
      taken = false;
      fold(false);
      keep();
      return draw();
    }
    if (target.dataset.askText !== undefined)
      turnEnded = ask(target.dataset.askText);
  });
  draw();
}

/** The question a click on an "Ask about this" button for `context` sends at once; undefined for a kind it does not know. */
export function firstQuestion(context) {
  const questions = {
    finding: "What does this change show?",
    trend: "What does this trend show?",
    entry: "What is this, and where did it come from?",
    worth: "What does this flag mean?",
  };
  return Object.hasOwn(questions, context?.kind)
    ? questions[context.kind]
    : undefined;
}

/** `closing`, `sortAndFilter`, `busyForms` and `chatStrip` as a page's inline script, over the whole document. */
export const SCRIPT = `(${closing})(document);(${sortAndFilter})(document, ${compare});(${encryptedChoice})(document);(${copyWords})(document);(${busyForms})(document);(${chatStrip})(document, 24000, ${firstQuestion});`;
