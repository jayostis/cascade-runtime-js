// A pod as a person reads it: who it is for, where its records came from, what Cascade noticed, and a tile for each
// kind of record. Preact components written with `htm`: functions from a pod's question rows to the page's elements,
// which `server.mjs` renders to HTML and a page in a browser can render too, keeping a table's sort and filter in its
// state. It imports only `preact`, `preact/hooks` and `htm`, with no build step. Rewrite it freely: it is only this
// app's view.
import { Fragment, h } from "preact";
import { useEffect, useState } from "preact/hooks";
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
];

const SOURCES = "entry/Where it came from";
const REVIEW = "entry/What needs review";

const SEEN = "pod/What was seen more than once";

/** Every question `podPage` reads: ask each, and hand it the rows by question. */
export const QUESTIONS = [
  SOURCES,
  SEEN,
  REVIEW,
  ...SECTIONS.map(({ question }) => question),
];

/** The codes the sections' rows in `answers` hold, each once: what to ask the tables' `about` of. */
export function codesOf(answers) {
  const codes = SECTIONS.flatMap((section) =>
    (answers[section.question] ?? []).flatMap((row) =>
      section.codes.map((column) => row[column]),
    ),
  );
  return [
    ...new Set(codes.filter((code) => /^[a-z][a-z\d+.-]*:/i.test(code ?? ""))),
  ];
}

/**
 * The sections' rows in `answers`, each named by the first of its codes `about` (the tables' `about`) names, else by
 * the record's own text, and `retired` saying so when the code that named it, or with none the first of its codes with
 * a status, is retired.
 */
export function named(answers, about) {
  const renamed = { ...answers };
  for (const section of SECTIONS) {
    if (answers[section.question] === undefined) continue;
    renamed[section.question] = answers[section.question].map((row) => {
      const said = section.codes.map((column) => about.get(row[column]));
      const naming = said.find((each) => each?.name !== undefined);
      const retired = statusOf(
        naming ?? said.find((each) => each?.status !== undefined),
        "Retired code",
      );
      return {
        ...row,
        ...(naming !== undefined && { [section.field]: naming.name.label }),
        ...(retired !== "" && { retired }),
      };
    });
  }
  return renamed;
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

/** A pod's name as a person's: `rowan-ellery-marsh` is `Rowan Ellery Marsh`. */
export function personName(pod) {
  return pod
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

const SAID = {
  "members disagree on criticality": ({ name, one }) =>
    `Sources disagree on how severe ${name === UNNAMED ? `an unnamed ${one}` : `the ${name} ${one}`} is.`,
  "joined through two kinds of machine sameness": ({ name }) =>
    `${name} was matched in two different ways. Worth a look.`,
  "judged different, still joined": ({ name, one }) =>
    `${name} was marked as different, but is still shown as one ${one}.`,
  "same code, dates cannot tell": ({ name, one }) =>
    `${name} was recorded more than once, and its dates cannot tell whether it is one ${one} or several.`,
  "joined before, apart under newer tables or rules": ({ name, one }) =>
    `${name === UNNAMED ? `An unnamed ${one}` : name} was kept as one ${one} with another before; newer reference tables or rules no longer match them, so they are shown apart. Worth a look.`,
  "possibly the same medication": ({ name, one }, { otherRecordLabel }) =>
    `${name === UNNAMED ? `An unnamed ${one}` : name} shares a code with ${otherNamed(otherRecordLabel, one)}, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same. Worth a look.`,
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

/** An entry the sections do not show, named from its label: `Allergy entry · Latex` is a latex allergy. */
function fromLabel(label = "") {
  const [kind = "", name = label] = label.split(" · ");
  return {
    name: name || UNNAMED,
    one: kind.replace(/ entry$/, "").toLowerCase() || "entry",
  };
}

/**
 * What Cascade noticed, as sentences: each thing recorded at more than one place, then each that arrived more than
 * once from one place, three at most and how many more; then each entry that needs review; then each pair of
 * medications in two entries whose codes have an ingredient in common, which the tables' `about` gives. `answers` holds
 * the rows of each of `QUESTIONS`, by question.
 *
 * The pair is a hint the starter gives, not something the pod knows: a pod's questions never read the tables' rows.
 * A combination maps to its own multiple-ingredient concept (MIN), never to each of its ingredients, so lisinopril and
 * lisinopril with hydrochlorothiazide share none; two drugs that map to the same MIN share the combination.
 */
export function noticed(answers, about = new Map()) {
  const entries = new Map();
  for (const section of SECTIONS)
    for (const row of answers[section.question] ?? [])
      entries.set(row.entry, {
        name: row[section.field] || fromLabel(row.entryLabel).name,
        one: section.one,
      });
  const seen = new Map();
  for (const row of answers[SEEN] ?? []) {
    if (!entries.has(row.entry)) continue;
    if (!seen.has(row.entry))
      seen.set(row.entry, { places: new Set(), across: Number(row.places) });
    if (row.place !== undefined)
      seen.get(row.entry).places.add(placeName(row.place));
  }
  const joined = [...seen].map(([entry, { places, across }]) => {
    const { name, one } = entries.get(entry);
    return across > 1
      ? `${name} was recorded ${where([...places])}. Cascade keeps it as one ${one}.`
      : `${name} arrived more than once${places.size === 0 ? "" : ` from ${[...places][0]}`}. Cascade keeps it as one ${one}.`;
  });
  const more = joined.length - 3;
  const review = new Map();
  for (const row of answers[REVIEW] ?? []) {
    const item = entries.get(row.entry) ?? fromLabel(row.entryLabel);
    review.set(
      JSON.stringify([
        row.entry,
        row.needs,
        row.needs === "possibly the same medication" ? row.otherRecord : null,
      ]),
      (SAID[row.needs] ?? (() => `${item.name}: ${row.needs}.`))(item, row),
    );
  }
  return [
    ...joined.slice(0, 3),
    ...(more > 0
      ? [
          `${more} more ${more === 1 ? "thing was" : "things were"} seen more than once and kept as one.`,
        ]
      : []),
    ...review.values(),
    ...sharedIngredients(answers, about),
  ].map((sentence) => sentence[0].toUpperCase() + sentence.slice(1));
}

/**
 * A sentence for each pair of medications in two entries whose codes share an ingredient, in the order of the section,
 * once for the pair of entries whatever codes their rows show, and none for a pair whose rows share a code, which What
 * needs review lists.
 */
function sharedIngredients(answers, about) {
  const medications = SECTIONS.find(({ one }) => one === "medication");
  const rows = (answers[medications.question] ?? []).map((row) => ({
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
      sentences.push(
        `${one.name} and ${other.name} share ${what}, ${name}, and are shown apart. Worth a look.`,
      );
    }
  return sentences;
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
function Table({ section, rows }) {
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
    return html`<td data-key=${column.key(row) ?? ""}>${
      column.tag && text !== ""
        ? html`<span class="tag${column.warm(row) ? " warm" : ""}">${text}</span>`
        : text
    }${index === 0 && row.retired !== undefined && html` <span class="tag">${row.retired}</span>`}</td>`;
  };
  const body = sorted.map((row) => {
    const hidden = ![
      ...section.columns.map((column) => shown(column, row)),
      row.retired ?? "",
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

/** The section's tile, a link that opens its dialog, and the dialog: its `Table`. */
export function tile(section, rows) {
  const id = `see-${slug(section.title)}`;
  const opened = opening(section, rows);
  const names = opened.map((row) => row[section.field] ?? "").join(", ");
  return {
    tile: html`<a class="tile" key=${id} href="#${id}"><span class="kind">${section.title}</span><span class="count">${rows.length}</span><span class="peek">${names}</span></a>`,
    dialog: box(
      id,
      html`${section.title} <span class="muted">${rows.length}</span>`,
      html`<${Table} section=${section} rows=${opened} />`,
      { wide: true },
    ),
  };
}

/**
 * A pod's page, as a person reads it: the person's name, how many records from how many places, a note when a record
 * was just brought in, what Cascade noticed, a tile per kind with rows, each with its dialog, and a way to bring in
 * more. `answers` holds the rows of each of `QUESTIONS`, by question. The rest names what the host gives:
 *
 * - `pod`: the pod's name;
 * - `person`: the demo person the pod is for, as `demoPeople` gives them, or undefined;
 * - `from`: the hospital a record was just brought in from, by its name, or undefined;
 * - `signIn(hospital)`: a button that signs the pod's person in at one of `person`'s hospitals;
 * - `findHospital`: the address of the page that finds a hospital;
 * - `connection`: the box of a connection under way, as `connectionDialog` gives it, or undefined;
 * - `unheld`: the table versions the pod names that the app does not hold, as `pod.opened.unheld` gives them;
 * - `about`: what the tables say of the codes `codesOf(answers)` gives, as their `about` answers, which `named` names
 *   the rows by.
 */
export function podPage(
  asked,
  {
    pod,
    person,
    from,
    signIn,
    findHospital,
    connection,
    unheld = [],
    about = new Map(),
  },
) {
  const answers = named(asked, about);
  const sources = answers[SOURCES] ?? [];
  const records = new Set(sources.map((row) => row.record)).size;
  const places = [...new Set(sources.map(placeOf))];
  const sentences = noticed(answers, about);
  const tiles = SECTIONS.filter(
    (section) => (answers[section.question] ?? []).length > 0,
  ).map((section) => tile(section, answers[section.question]));
  const lead =
    records === 0
      ? "Nothing here yet."
      : `${records} ${records === 1 ? "record" : "records"}, from ${places.length === 1 ? "one place" : `${places.length} places`}`;
  return html`<h1>${personName(pod)}</h1>
<p class="lead">${lead}</p>
${places.length > 0 && html`<ul class="chips">${places.map((place) => html`<li>${place}</li>`)}</ul>`}
${from !== undefined && html`<p class="note">Brought in the record from ${hospitalName(from)}.</p>`}
${unheld.length > 0 && html`<p class="note">This pod was matched with ${unheld.length === 1 ? "a reference table version" : `${unheld.length} reference table versions`} this app does not hold, and is matched without ${unheld.length === 1 ? "it" : "them"}.</p>`}
${sentences.length > 0 && html`<div class="card noticed"><h2>What Cascade noticed</h2><ul>${sentences.map((sentence) => html`<li>${sentence}</li>`)}</ul></div>`}
${tiles.length > 0 && html`<div class="tiles">${tiles.map(({ tile }) => tile)}</div>`}
${tiles.map(({ dialog }) => dialog)}
${connection}
${bringIn({ empty: records === 0, person, signIn, findHospital })}`;
}

/** The card that brings in more: a sign-in button per hospital holding the demo person, and "Find a hospital". */
function bringIn({ empty, person, signIn, findHospital }) {
  const at = (person?.at ?? []).map(({ name }) => hospitalName(name));
  const said =
    person === undefined
      ? "Sign in at a hospital, see what it has, and bring it into this pod."
      : `${person.name} has records waiting at ${listed(at)}.${at.length > 1 ? " Bring in each to see the pod join what they agree on." : ""}`;
  return html`<div class="card">
<h2>${empty ? "Bring in records" : "Bring in more"}</h2>
<p>${said}</p>
<div class="row">${(person?.at ?? []).map(signIn)}<a class="button quiet" href=${findHospital}>Find a hospital</a></div>
</div>`;
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
 * with the hospitals that hold them. `demo` is the demo hospitals as `loadHospitals` gives them.
 */
export function demoPeople(demo) {
  const people = new Map();
  for (const { hospital, patients } of demo)
    for (const bundle of Object.values(patients)) {
      const name = patientName(bundle);
      if (name === undefined) continue;
      const key = `${name}|${patientOf(bundle).birthDate}`;
      if (!people.has(key)) people.set(key, { name, at: [] });
      people.get(key).at.push(hospital);
    }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function patientOf(bundle) {
  return bundle.entry?.find(
    ({ resource }) => resource.resourceType === "Patient",
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

/**
 * The box that makes a new pod, shown when the page's address ends `#new-pod`: what a pod is, a button for each demo
 * person in `people` with no pod among `pods` yet, `more` when given (`{ said, choices }`, each choice a `label`, a
 * `note`, and an `action` with its `fields` or an `href`), and a field for anyone's name. A person's button and the
 * field post `person` to `action`.
 */
export function newPodDialog({ people, pods, action, more }) {
  const demo = people
    .filter((person) => !pods.includes(slug(person.name)))
    .map((person) =>
      choice({
        label: person.name,
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
        html`<p>Every pod goes, and Alex's and Priya's are loaded again.</p>
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
    return `Reset: ${listed(kits.map(personName))} ${kits.length === 1 ? "is" : "are"} back.`;
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
${pods.map((pod) => html`<li><a href=${href(pod)} aria-current=${pod === current ? "page" : undefined}>${personName(pod)}</a></li>`)}
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
export function frame({ title, refresh, ...shown }) {
  return html`<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${refresh && html`<meta http-equiv="refresh" content="1" />`}
<title>${title} · Cascade</title>
<style dangerouslySetInnerHTML=${{ __html: STYLE }}></style>
</head>
<body>
${layout(shown)}
${doing()}
<script dangerouslySetInnerHTML=${{ __html: SCRIPT }}></script>
</body>
</html>`;
}

/** What a page says while it is busy: a spinner and `said`, one line; hidden while `said` is undefined. */
export function doing(said) {
  return html`<p class="doing" role="status" hidden=${said === undefined}><span class="spinner" aria-hidden="true"></span><span class="said">${said}</span></p>`;
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
 * where else they are. `back` is the pod's address.
 */
export function hospitalsPage({
  pod,
  rows,
  text,
  search,
  signIn,
  people,
  back,
}) {
  const who = personName(pod);
  const cards = rows.map((row) => {
    const here = people
      .filter((person) =>
        person.at.some((each) => each.fhirBase === row.fhirBase),
      )
      .map((person) => {
        const elsewhere = person.at
          .filter((each) => each.fhirBase !== row.fhirBase)
          .map(({ name }) => hospitalName(name));
        return html`<li>${person.name}${elsewhere.length > 0 && html` <span class="muted">also at ${listed(elsewhere)}</span>`}</li>`;
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
 * link to `href(source)`, the one whose IRI is `current` marked; and a Check now button posting to `check`.
 */
export function tablesNav({ series, current, href, check }) {
  return html`<section class="tables" aria-label="Reference tables"><h2>Reference tables</h2>
${
  series.length === 0
    ? html`<p class="muted">None yet.</p>`
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
            html`${index > 0 && ", "}<a href=${href(pod)}>${personName(pod)}</a>`,
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
 * A code's page: everything `facts` (`facts()`'s answer) says of it, each fact naming the table among `held` (as
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
  const { notation, about, names, status, mappings } = facts;
  return html`<p><a href=${back}>${source.label}</a></p>
<h1>${notation}${about?.name !== undefined && ` ${about.name.label}`}</h1>
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
${names.length + status.length + mappings.length === 0 && html`<p class="muted">No table this app holds says anything of this code.</p>`}`;
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

/**
 * A connection to the hospital named `hospital`, for the pod `pod`, as a box over the pod's page with the id `id`,
 * which closes to `back`. While `connection.step` is `signing in` or `pulling`, its steps; else `failed` when given, a
 * sentence of why, with a Try again button when `retry`; else its steps, whose record `about` is when not the pod's
 * person, what each of `sources` (from `look`) holds, what `pulled` left out, and a button that posts to `bring`.
 */
export function connectionDialog({
  id,
  pod,
  hospital,
  back,
  connection,
  failed,
  retry,
  sources = [],
  pulled,
  about,
  bring,
}) {
  const who = personName(pod);
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
.noticed { background: var(--tint); border-color: transparent; }
.noticed ul { margin: 0; padding-left: 1.2rem; }
.noticed li { margin: 0.3rem 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr)); gap: 1rem; margin: 0 0 1.25rem; }
.tile { display: block; padding: 1rem 1.1rem; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; color: var(--text); text-decoration: none; }
.tile:hover { border-color: var(--accent); background: var(--tint); }
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
.row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.row input { flex: 1; min-width: 10rem; }
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

/** `closing`, `sortAndFilter` and `busyForms` as a page's inline script, over the whole document. */
export const SCRIPT = `(${closing})(document);(${sortAndFilter})(document, ${compare});(${busyForms})(document);`;
