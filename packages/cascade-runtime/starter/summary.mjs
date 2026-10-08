// A pod as a person reads it: who it is for, where its records came from, what Cascade noticed, and a tile for each
// kind of record. Pure functions from a pod's question rows to HTML, with no import, so a page in a browser can run
// them too. Rewrite it freely: it is only this app's view.

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
 * One tile for each of these questions, in this order: its title, what one of its rows is called, the row's name, the
 * table's columns, the column the table opens sorted by, and whether it opens with the newest first.
 */
export const SECTIONS = [
  {
    title: "Allergies",
    one: "allergy",
    question: "pod/My active allergies",
    name: (row) => row.allergen,
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
    name: (row) => row.medication,
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
    name: (row) => row.condition,
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
    name: (row) => row.test,
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
    name: (row) => row.vaccine,
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
    name: (row) => row.procedure,
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

export function escaped(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
};

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
 * once from one place, three at most and how many more; then each entry that needs review. `answers` holds the rows of
 * each of `QUESTIONS`, by question.
 */
export function noticed(answers) {
  const named = new Map();
  for (const section of SECTIONS)
    for (const row of answers[section.question] ?? [])
      named.set(row.entry, {
        name: section.name(row) || fromLabel(row.entryLabel).name,
        one: section.one,
      });
  const seen = new Map();
  for (const row of answers[SEEN] ?? []) {
    if (!named.has(row.entry)) continue;
    if (!seen.has(row.entry))
      seen.set(row.entry, { places: new Set(), across: Number(row.places) });
    if (row.place !== undefined)
      seen.get(row.entry).places.add(placeName(row.place));
  }
  const joined = [...seen].map(([entry, { places, across }]) => {
    const { name, one } = named.get(entry);
    return across > 1
      ? `${name} was recorded ${where([...places])}. Cascade keeps it as one ${one}.`
      : `${name} arrived more than once${places.size === 0 ? "" : ` from ${[...places][0]}`}. Cascade keeps it as one ${one}.`;
  });
  const more = joined.length - 3;
  const review = new Map();
  for (const row of answers[REVIEW] ?? []) {
    const item = named.get(row.entry) ?? fromLabel(row.entryLabel);
    review.set(
      JSON.stringify([row.entry, row.needs]),
      (SAID[row.needs] ?? (() => `${item.name}: ${row.needs}.`))(item),
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
  ].map((sentence) => sentence[0].toUpperCase() + sentence.slice(1));
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
const backdrop = (href = "#") =>
  `<a class="backdrop" href="${escaped(href)}" aria-label="Close the box" tabindex="-1"></a>`;

/**
 * The section's tile, a link that opens its dialog, and the dialog: a filter box and a table, a heading button per
 * column, each cell holding what it sorts by in `data-key`.
 */
export function tile(section, rows) {
  const sorted = opening(section, rows);
  const id = `see-${slug(section.title)}`;
  const head = section.columns
    .map((column, at) => {
      const sort =
        at !== section.sortBy
          ? ""
          : ` aria-sort="${section.newestFirst ? "descending" : "ascending"}"`;
      return `<th${sort}><button type="button" data-type="${column.type}">${escaped(column.head)}</button></th>`;
    })
    .join("");
  const body = sorted
    .map(
      (row) =>
        `<tr>${section.columns
          .map((column) => {
            const shown = escaped(column.show(row) ?? "");
            const cell =
              column.tag && shown !== ""
                ? `<span class="tag${column.warm(row) ? " warm" : ""}">${shown}</span>`
                : shown;
            return `<td data-key="${escaped(column.key(row) ?? "")}">${cell}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("\n");
  const names = sorted.map((row) => section.name(row) ?? "").join(", ");
  return {
    tile: `<a class="tile" href="#${id}"><span class="kind">${escaped(section.title)}</span><span class="count">${rows.length}</span><span class="peek">${escaped(names)}</span></a>`,
    dialog: `<div class="dialog" id="${id}" role="dialog" aria-labelledby="${id}-title">
${backdrop()}
<div class="box wide">
<a class="close" href="#" aria-label="Close">×</a>
<h2 id="${id}-title">${escaped(section.title)} <span class="muted">${rows.length}</span></h2>
<input type="search" class="filter" placeholder="Filter" aria-label="Filter ${escaped(section.title.toLowerCase())}">
<div class="scroll"><table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table></div>
</div>
</div>`,
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
 * - `signIn(hospital)`: the HTML of a button that signs the pod's person in at one of `person`'s hospitals;
 * - `findHospital`: the address of the page that finds a hospital;
 * - `connection`: the box of a connection under way, as `connectionDialog` gives it, or undefined.
 */
export function podPage(
  answers,
  { pod, person, from, signIn, findHospital, connection = "" },
) {
  const who = personName(pod);
  const sources = answers[SOURCES] ?? [];
  const records = new Set(sources.map((row) => row.record)).size;
  const places = [...new Set(sources.map(placeOf))];
  const sentences = noticed(answers);
  const tiles = SECTIONS.filter(
    (section) => (answers[section.question] ?? []).length > 0,
  ).map((section) => tile(section, answers[section.question]));
  const lead =
    records === 0
      ? "Nothing here yet."
      : `${records} ${records === 1 ? "record" : "records"}, from ${places.length === 1 ? "one place" : `${places.length} places`}`;
  return [
    `<h1>${escaped(who)}</h1>`,
    `<p class="lead">${lead}</p>`,
    places.length === 0
      ? ""
      : `<ul class="chips">${places.map((place) => `<li>${escaped(place)}</li>`).join("")}</ul>`,
    from === undefined
      ? ""
      : `<p class="note">Brought in the record from ${escaped(hospitalName(from))}.</p>`,
    sentences.length === 0
      ? ""
      : `<div class="card noticed"><h2>What Cascade noticed</h2><ul>${sentences.map((sentence) => `<li>${escaped(sentence)}</li>`).join("")}</ul></div>`,
    tiles.length === 0
      ? ""
      : `<div class="tiles">${tiles.map(({ tile }) => tile).join("\n")}</div>`,
    ...tiles.map(({ dialog }) => dialog),
    connection,
    bringIn({ empty: records === 0, person, signIn, findHospital }),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/** The card that brings in more: a sign-in button per hospital holding the demo person, and "Find a hospital". */
function bringIn({ empty, person, signIn, findHospital }) {
  const at = (person?.at ?? []).map(({ name }) => hospitalName(name));
  const said =
    person === undefined
      ? "Sign in at a hospital, see what it has, and bring it into this pod."
      : `${escaped(person.name)} has records waiting at ${escaped(listed(at))}.${at.length > 1 ? " Bring in each to see the pod join what they agree on." : ""}`;
  return `<div class="card">
<h2>${empty ? "Bring in records" : "Bring in more"}</h2>
<p>${said}</p>
<div class="row">${(person?.at ?? []).map(signIn).join("\n")}<a class="button quiet" href="${escaped(findHospital)}">Find a hospital</a></div>
</div>`;
}

/** Where a connection has got to, as a list of steps: those done ticked, the one under way marked. */
export function steps({ step, requests }) {
  const at = ["signing in", "pulling", "pulled"].indexOf(step);
  const items = [
    at === 0 ? "Signing in at the hospital" : "Signed in at the hospital",
    at === 1
      ? `Fetching the record: ${requests} requests answered so far`
      : "Fetching the record",
    at === 2 ? `Record fetched, in ${requests} requests` : "Record fetched",
  ].map((text, index) => {
    const state = index < at || at === 2 ? "done" : index === at ? "now" : "";
    return `<li class="${state}">${escaped(text)}</li>`;
  });
  return `<ul class="steps">\n${items.join("\n")}\n</ul>`;
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

/** A button that posts `fields` to `action`, as a form of its own; `inner` is its HTML. */
export function postButton(action, fields, inner, className) {
  const hidden = Object.entries(fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escaped(name)}" value="${escaped(value)}">`,
    )
    .join("\n");
  return `<form class="inline" method="post" action="${escaped(action)}">
${hidden}
<button${className === undefined ? "" : ` class="${className}"`}>${inner}</button>
</form>`;
}

/** A one-click choice in a list of the new-pod box: a form that posts `fields` to `action`, or a link to `href`. */
function choice({ label, note, action, fields = {}, href }) {
  const inner = `${escaped(label)}<span class="muted">${escaped(note ?? "")}</span>`;
  return `<li>${href === undefined ? postButton(action, fields, inner) : `<a class="button" href="${escaped(href)}">${inner}</a>`}</li>`;
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
      }),
    );
  const list = (said, items) =>
    items.length === 0
      ? ""
      : `<p><strong>${escaped(said)}</strong></p>\n<ul class="people">\n${items.join("\n")}\n</ul>`;
  return `<div class="dialog" id="new-pod" role="dialog" aria-labelledby="new-pod-title">
${backdrop()}
<div class="box">
<a class="close" href="#" aria-label="Close">×</a>
<h2 id="new-pod-title">Make a new pod</h2>
<p>A pod keeps one person's health records, wherever they come from: files they download, and hospitals they sign in to. It notices when two sources describe the same thing, and when they disagree.</p>
${list("Try someone with records waiting at the demo hospitals. They are made up, and signing in needs no password.", demo)}
${more === undefined ? "" : list(more.said, more.choices.map(choice))}
<p><strong>Or make one for anyone.</strong> You can bring in records afterwards.</p>
<form method="post" action="${escaped(action)}" class="row">
<input name="person" placeholder="A person's name" aria-label="A person's name" required>
<button>Make the pod</button>
</form>
</div>
</div>`;
}

/** A box over the page, shown when the page's address ends `#<id>`, with `body` under its heading `title`. */
function box(id, title, body) {
  return `<div class="dialog" id="${id}" role="dialog" aria-labelledby="${id}-title">
${backdrop()}
<div class="box">
<a class="close" href="#" aria-label="Close">×</a>
<h2 id="${id}-title">${escaped(title)}</h2>
${body}
</div>
</div>`;
}

/** A menu of the title bar: `<details>`, so it opens and closes with no script, each item a link to a box. */
function menu(name, items) {
  return `<details class="menu"><summary>${escaped(name)}</summary><ul>
${items.map(([href, label]) => `<li><a href="${escaped(href)}">${escaped(label)}</a></li>`).join("\n")}
</ul></details>`;
}

/**
 * The title bar's menus and their boxes: File's two items each open a box asking to confirm, whose one button posts
 * to `deleteAll` or `resetAll`; Help's About gives the application's `name` and `version`, the `runtime` version it is
 * built on, and a link to its `code`.
 */
function menus({ deleteAll, resetAll, about }) {
  return {
    bar: `${menu("File", [
      ["#delete-all", "Delete all data"],
      ["#reset-all", "Reset all data"],
    ])}${menu("Help", [["#about", "About"]])}`,
    boxes: [
      box(
        "delete-all",
        "Delete all data?",
        `<p>Every pod in this app goes.</p>\n${postButton(deleteAll, {}, "Delete all data", "warm")}`,
      ),
      box(
        "reset-all",
        "Reset all data?",
        `<p>Every pod goes, and Alex's and Priya's are loaded again.</p>\n${postButton(resetAll, {}, "Reset all data", "warm")}`,
      ),
      box(
        "about",
        `About ${about.name}`,
        `<p><strong>${escaped(about.name)}</strong> ${escaped(about.version)}</p>
<p>Built on cascade-runtime ${escaped(about.runtime)}.</p>
<p>Every person here is made up.</p>
<p><a href="${escaped(about.code)}">The code</a></p>`,
      ),
    ].join("\n"),
  };
}

/** What the page says after a File menu item: how many pods were `deleted`, or which pods `reset` brought back. */
export function didNote({ deleted, reset }) {
  if (reset !== undefined)
    return `Reset: ${listed(reset.map(personName))} ${reset.length === 1 ? "is" : "are"} back.`;
  return deleted === 0
    ? "There was no pod to delete."
    : `Deleted ${deleted} ${deleted === 1 ? "pod" : "pods"}.`;
}

/**
 * A whole page: the title bar with its menus, the pods by their people's names, `note` above `body` when given, and
 * `dialog` (the new-pod box). `pods` are the pods' names, `current` the one shown, `href(pod)` a pod's address and
 * `home` the title bar's; `menu` is what the menus need, as `{ deleteAll, resetAll, about: { name, version, runtime,
 * code } }`: the addresses the two File items post to, and what the About box says. `refresh` makes the page reload itself every second.
 */
export function frame({
  title,
  body,
  pods,
  current,
  href,
  home,
  dialog,
  menu,
  note,
  refresh,
}) {
  const items = pods
    .map(
      (pod) =>
        `<li><a href="${escaped(href(pod))}"${pod === current ? ' aria-current="page"' : ""}>${escaped(personName(pod))}</a></li>`,
    )
    .join("\n");
  const { bar, boxes } = menus(menu);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="1">\n' : ""}<title>${escaped(title)} · Cascade</title>
<style>${STYLE}</style>
</head>
<body>
<header class="bar"><a href="${escaped(home)}">Cascade</a>${bar}<span class="demo">Demo: every person here is made up</span></header>
<div class="layout">
<aside>
<nav><h2>Pods</h2><ul>
${items}
</ul></nav>
<a class="button wide" href="#new-pod">+ New pod</a>
</aside>
<main>
${note === undefined ? "" : `<p class="note" role="status">${escaped(note)}</p>\n`}${body}
</main>
</div>
${dialog}
${boxes}
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** The page when there is no pod yet. */
export function noPods() {
  return `<h1>No pods yet</h1>
<p class="lead">A pod keeps one person's health records, wherever they come from.</p>
<p><a class="button" href="#new-pod">Make your first pod</a></p>`;
}

/**
 * Finding a hospital for the pod `pod`: a search box that sends `q` to `search`, then a card per directory row in
 * `rows`, with its places, `signIn(row)` (the HTML of its sign-in button), and the demo people in `people` it holds,
 * each with where else they are. `back` is the pod's address.
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
        return `<li>${escaped(person.name)}${elsewhere.length === 0 ? "" : ` <span class="muted">also at ${escaped(listed(elsewhere))}</span>`}</li>`;
      });
    return `<div class="card">
<div class="row"><h2>${escaped(hospitalName(row.name))}</h2>${signIn(row)}</div>
${row.places === undefined ? "" : `<p class="muted">${escaped(row.places.join("; "))}</p>`}
${
  here.length === 0
    ? `<p class="muted">A test server: you choose a patient on its own sign-in page.</p>`
    : `<p class="muted">Sample patients here:</p>\n<ul>\n${here.join("\n")}\n</ul>`
}
</div>`;
  });
  return `<h1>Find a hospital</h1>
<p class="lead">Sign in on the hospital's own page, see what it has, and bring it into ${escaped(who)}'s pod.</p>
<form method="get" action="${escaped(search)}" class="row card"><input name="q" value="${escaped(text)}" placeholder="Search by name or place" aria-label="Search by name or place"><button>Search</button></form>
${cards.length === 0 ? `<p class="muted">No hospital matches.</p>` : cards.join("\n")}
<p><a href="${escaped(back)}">Back to ${escaped(who)}</a></p>`;
}

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
  const said = (
    body,
  ) => `<div class="dialog" id="${escaped(id)}" role="dialog" aria-labelledby="${escaped(id)}-title">
${backdrop(back)}
<div class="box">
<a class="close" href="${escaped(back)}" aria-label="Close">×</a>
<h2 id="${escaped(id)}-title">${escaped(name)}</h2>
${body}
</div>
</div>`;
  if (connection.step === "signing in" || connection.step === "pulling")
    return said(
      `<div class="card">${steps(connection)}\n<p class="muted">This refreshes itself until the record is here.</p></div>`,
    );
  if (failed !== undefined)
    return said(
      `<div class="card"><p>${escaped(failed)}</p>${retry ? postButton(bring, {}, "Try again") : ""}</div>`,
    );
  const has = sources
    .map(
      (source) =>
        `<p><strong>What ${escaped(name)} has:</strong> ${escaped(counted(source.records) || "nothing")}.</p>
<p class="muted">${escaped(who)}'s pod ${source.claimed ? "already has records from here" : "has nothing from here yet"}.</p>`,
    )
    .join("\n");
  const notes = [
    pulled.missing.length === 0
      ? ""
      : `<p class="muted">Mentioned, but not sent: ${escaped(pulled.missing.join(", "))}</p>`,
    pulled.denied.length === 0
      ? ""
      : `<p class="muted">Not allowed to read: ${escaped(pulled.denied.map(({ type, category }) => (category === undefined ? type : `${type} (${category})`)).join(", "))}</p>`,
  ].join("");
  const whose =
    about === undefined || slug(about) === pod
      ? ""
      : `<p class="note">This record is ${escaped(about)}'s. Bringing it in makes this ${escaped(about)}'s pod.</p>`;
  return said(`<div class="card">${steps(connection)}</div>
${whose}
<div class="card">
${has}
${notes}
${postButton(bring, {}, `Bring it into ${escaped(who)}'s pod`)}
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
nav ul { list-style: none; padding: 0; margin: 0 0 1rem; }
nav a { display: block; padding: 0.4rem 0.6rem; border-radius: 6px; color: var(--text); text-decoration: none; }
nav a:hover { background: var(--soft); }
nav a[aria-current] { background: var(--tint); color: var(--accent); font-weight: 600; }
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
`;

/**
 * In a page, under `root`: a heading sorts its table by its column, one way then the other, and a filter box hides the
 * rows without its text. It listens on `root`, so tables written into it later sort and filter too. A click anywhere
 * but on an open menu's own name closes that menu; Escape closes an open menu, and follows the open box's own close
 * link. Those listeners are the document's, added once however often this runs on it.
 */
export function sortAndFilter(root, by = compare) {
  const page = root.ownerDocument ?? root;
  if (!page.closesOnEscape) {
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

/** `sortAndFilter` as a page's inline script, over the whole document. */
export const SCRIPT = `(${sortAndFilter})(document, ${compare});`;
