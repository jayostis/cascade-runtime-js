import {
  LENSES,
  type Term,
  type Triple,
  written,
} from "@cascade-runtime/runtime";
import type { Answer } from "./answer.js";
import { type Content, type Html, markup } from "./html.js";
import type { Site } from "./site.js";
import { CALLED, code, COPY, prefixed, shown, STATED, terms } from "./terms.js";

const FOLDERS = "pod/What each folder holds";
const VIEWS = "pod/Which view lists each kind";
const COUNTED = "pod/How many judgments count";
const HIDDEN = "record/Why it is in no view";
const SHOWS = "entry/What it shows";
const ELSEWHERE = [FOLDERS, VIEWS, CALLED, COUNTED, STATED];
const COMPARED = [COUNTED, "pod/My immunizations"];

function term(site: Site, value: Term, label?: Term, linked = true): Html {
  const data = (inner: Content): Html =>
    markup`<data value="${written(value)}">${inner}</data>`;
  if (value.termType === "Literal") return data(shown(value));
  const coded = code(value.value);
  if (coded !== undefined)
    return data(markup`<a href="${value.value}">${coded[0]} ${coded[1]}</a>`);
  const address = site.pod.address;
  const known = site.labels.get(value.value);
  const plain =
    value.termType === "BlankNode"
      ? written(value)
      : (prefixed(value.value) ?? value.value);
  const said =
    label !== undefined
      ? label.value
      : known !== undefined
        ? markup`${known} <code>${prefixed(value.value) ?? value.value}</code>`
        : value.termType === "NamedNode" && value.value.startsWith(address)
          ? markup`<code>${value.value.slice(address.length)}</code>`
          : markup`<code>${plain}</code>`;
  if (!linked) return data(said);
  const [href, page, turtle] = [
    site.href(value),
    site.page(value),
    site.turtle(value),
  ];
  return data([
    href === undefined ? said : markup`<a href="${href}">${said}</a>`,
    page !== undefined &&
      page !== href &&
      markup` <a class="also" href="${page}">page</a>`,
    turtle !== undefined &&
      turtle !== href &&
      markup` <a class="also" href="${turtle}">Turtle</a>`,
  ]);
}

function block(site: Site, answer: Answer, inner: Content, id?: string): Html {
  const { lens, name } = site.options;
  const question = answer.question;
  const about =
    answer.about !== undefined &&
    markup`<p>It prints the rows for every ${answer.about}; this block keeps those whose <code>?${answer.about}</code> is
<code>${answer.thing?.value}</code>.</p>
`;
  const graphdb =
    answer.lens === lens
      ? markup`<p>Or in GraphDB, open the saved query <code>${question}</code> in the repository <code>${name}</code>.</p>`
      : markup`<p>GraphDB holds the pod under the ${lens} lens only.</p>`;
  const runIt =
    question !== undefined &&
    markup`
<p>Run it yourself, from the runtime's root:</p>
<pre><code>${site.options.ask} "${question}"${answer.lens !== lens && ` --lens ${answer.lens}`}</code></pre>
${about}${graphdb}`;
  return markup`
<section class="query"${id !== undefined && markup` id="${id}"`}>
<h2>${answer.title}</h2>
<p class="prose">${answer.prose}</p>
${inner}
<details>
<summary>The query: <code>${answer.query.path}</code></summary>
<pre><code>${answer.query.text}</code></pre>${runIt}
</details>
</section>`;
}

function rowsTable(site: Site, answer: Answer): Html {
  const linked = answer.lens === site.options.lens;
  const columns = answer.shown;
  const count = answer.rows.length;
  if (count === 0) return markup`<p class="count">No rows.</p>`;
  const cell = (row: Answer["rows"][number], column: string): Html => {
    const value = row.get(column);
    return markup`<td data-label="?${column}">${value !== undefined && term(site, value, row.get(`${column}Label`), linked)}</td>`;
  };
  return markup`<div class="answer">
<table>
<thead><tr>${columns.map((column) => markup`<th>?${column}</th>`)}</tr></thead>
<tbody>
${answer.rows.map((row) => markup`<tr>${columns.map((column) => cell(row, column))}</tr>\n`)}</tbody>
</table>
</div>
<p class="count">${count} ${count === 1 ? "row" : "rows"}</p>`;
}

function question(site: Site, answer: Answer, lensed = false): Html {
  return block(site, answer, [
    lensed && markup`<p class="lens">Under the ${answer.lens} lens.</p>\n`,
    answer.about !== undefined &&
      markup`<p class="about">Only the rows whose <code>?${answer.about}</code> is this one.</p>\n`,
    rowsTable(site, answer),
  ]);
}

function layout(site: Site, title: string, main: Content): Html {
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${site.pod.title}</title>
<link rel="stylesheet" href="site.css">
</head>
<body>
<nav>
<a href="index.html">How the pod is laid out</a>
<a href="pipeline.html">How a view is built</a>
<a href="not-shown.html">Not shown</a>
</nav>
<main>
${main}
</main>
</body>
</html>
`;
}

function home(site: Site): Html {
  const whole = [...site.questions]
    .filter(([name]) => name.startsWith("pod/") && !ELSEWHERE.includes(name))
    .map(([, answer]) => question(site, answer));
  return layout(
    site,
    "How the pod is laid out",
    markup`<p class="kind">${site.pod.title}</p>
<h1>How this pod is laid out</h1>
<p>A pod is a person's own store of data on a Solid server, at an address of its own: this one is at
<code>${site.pod.address}</code>. It is a tree of files, and every file but the stored documents is Turtle, statements of
the form <em>subject property value</em>. Everything on this site was asked of those files with SPARQL, and every section
shows the question it asked: open <em>The query</em> under any answer to read it, and run it yourself.</p>
<dl class="layout">
<dt><code>records/</code></dt>
<dd>What each source told the pod, one folder per type. A record's own file says only what it is; each time its source sends
it, a revision arrives in a file of its own, carrying a version, the content, in another.</dd>
<dt><code>provenance/</code></dt>
<dd>Where records came from: each source document, each import that brought documents in, and each time the person entered
something themselves.</dd>
<dt><code>attachments/</code></dt>
<dd>The source documents' own bytes, such as a hospital's FHIR file, each named by the hash of its bytes.</dd>
<dt><code>judgments/</code></dt>
<dd>Decisions about records: that two are the same thing, that they differ, that one is wrong, or whose a patient profile
is.</dd>
<dt><code>references/</code></dt>
<dd>The code tables the matcher compares codes with, one file per table and per version.</dd>
<dt><code>subject/</code></dt>
<dd>The person the pod is about.</dd>
<dt><code>clinical/</code></dt>
<dd>The views: one file per type, listing entries an app can show. The build writes them and can always write them again.</dd>
<dt><code>profile/</code>, <code>settings/</code>, <code>manifest.ttl</code></dt>
<dd>Solid's own files: the owner's profile, which names the pod's root and the preferences file; the preferences file,
which names the type index; and the type index, which says which view lists each type. The build writes the type index
from the pod's layout, beside the manifest, which says what built the pod.</dd>
</dl>
<p>Some folders have two-character folders inside them. Those only spread the files out, so no folder holds too many.</p>
${question(site, site.question(FOLDERS))}

<h2 class="part">The views</h2>
<p>An app does not read records. It reads a view: one file per type, whose entries each join the records judged to be the
same thing. <a href="pipeline.html">How a view is built</a> shows each step from records to views, and
<a href="not-shown.html">Not shown</a> lists the records no view shows, and why.</p>
${question(site, site.question(VIEWS))}

<h2 class="part">Questions about the whole pod</h2>
<p>Each record, entry, judgment and patient profile has a page of its own with the questions about it. These are the
questions about the pod as a whole.</p>
${whole}`,
  );
}

function addedTable(site: Site, added: readonly Triple[]): Html {
  if (added.length === 0)
    return markup`<p class="count">It added nothing to this pod.</p>`;
  return markup`<div class="answer">
<table>
<thead><tr><th>Term</th><th>Statements added</th></tr></thead>
<tbody>
${terms(added).map(([value, count]) => markup`<tr><td data-label="Term">${term(site, value)}</td><td data-label="Statements added">${count}</td></tr>\n`)}</tbody>
</table>
</div>`;
}

function pipeline(site: Site): Html {
  const { lens } = site.options;
  const isLens = (answer: Answer): boolean =>
    answer.query.path.startsWith(LENSES);
  const otherLenses = [...site.pipeline]
    .filter(([other]) => other !== lens)
    .flatMap(([, steps]) => steps.filter(({ answer }) => isLens(answer)))
    .map(({ answer, added }) =>
      block(
        site,
        answer,
        [
          markup`<p class="lens">The other lens. Had the pod been built with it, it would have added this instead.</p>\n`,
          addedTable(site, added),
        ],
        answer.title,
      ),
    );
  const steps = (site.pipeline.get(lens) ?? []).map(({ answer, added }) => [
    block(
      site,
      answer,
      [
        isLens(answer) && markup`<p class="lens">This step is the lens.</p>\n`,
        addedTable(site, added),
      ],
      answer.title,
    ),
    isLens(answer) && otherLenses,
  ]);
  const compared = COMPARED.map(
    (name) => markup`
<div class="lenses">
${[...site.answers.values()].map((answers) => {
  const answer = answers.get(name);
  return (
    answer !== undefined && markup`<div>${question(site, answer, true)}</div>\n`
  );
})}</div>`,
  );
  const built = [...site.built].map(([file, { answer, statements }]) => {
    const path = file.slice(site.pod.address.length);
    const view = site.views.find(({ value }) => value === file);
    const page = view === undefined ? undefined : site.page(view);
    return block(
      site,
      answer,
      markup`<p class="answer">It wrote <a href="${COPY}${path}"><code>${path}</code></a>, ${statements} statements.
${page !== undefined && markup`<a href="${page}">The view's page</a> shows its entries.`}</p>`,
      answer.title,
    );
  });
  return layout(
    site,
    "How a view is built",
    markup`<h1>How a view is built</h1>
<p>The pod's own files hold only what arrived and what was decided: records, their revisions and versions, the documents
they came from, and judgments. Everything an app shows is worked out from those by queries that run in a fixed order. Each
is a CONSTRUCT: it reads the store and adds statements to it, and the next one can read them.</p>
<p>Together the statements they add are the derived state. It is never written into the pod. A store that loads the pod
runs the queries again and keeps their statements as a graph of its own, <code>${site.derivedGraph}</code>; the GraphDB
loader loads it the same way, so every question can read it.</p>
<p>One step, the lens, decides which judgments count. It is the only step that can be swapped; this site is built with the
${lens} lens, and the other lens is shown beside it. Under each step is what it added to this pod: each term, and how
many statements.</p>
${steps}

<h2 class="part" id="what-the-lens-changes">What the lens changes</h2>
<p>The same questions, asked of the pod built under each lens, side by side. A judgment that counts under one lens and not
the other can join records into one entry or leave them apart, so a view can change with the lens. Compare the two
counts of judgments row by row: a row one lens has and the other lacks is a kind of judgment only one counts, and the view
below them shows what that does to the entries.</p>
${compared}

<h2 class="part">The files it writes</h2>
<p>Last, a query for each view reads the pod and the derived state and writes one file, and one more writes a name for
everything. These are the pod's only files the build writes, and each says it is a view.</p>
${built}
<p>Every page of this site names a thing by the label the labels file gives it, read with this question.</p>
${question(site, site.question(CALLED))}`,
  );
}

function notShown(site: Site): Html {
  return layout(
    site,
    "Not shown",
    markup`<h1>Not shown</h1>
<p>Not every record a source sends ends up in a view. Nothing is deleted to hide it: the record stays in the pod, exactly as
it arrived, and the derivations leave it out of every entry. When the reason no longer holds, the next build shows it again.</p>
${question(site, site.question(HIDDEN))}`,
  );
}

function viewPage(site: Site, view: Term): Html {
  const path = view.value.slice(site.pod.address.length);
  const built = site.built.get(view.value);
  const wrote =
    built !== undefined &&
    block(
      site,
      built.answer,
      markup`<p class="answer">It wrote <a href="${COPY}${path}"><code>${path}</code></a>, ${built.statements} statements, after the
derivations of the <a href="pipeline.html#${site.options.lens}">${site.options.lens} lens</a> had run.</p>`,
    );
  return layout(
    site,
    path,
    markup`<p class="kind">View</p>
<h1>${path}</h1>
<p class="iri"><code>${view.value}</code></p>
<p>A view is a file the build writes. An app reads it to show a list, and never needs to know about records, revisions or
judgments. Nobody edits a view: delete it and the build writes the same file again from the pod's records and judgments.
Below are the files that state it, the query that wrote it, and every entry it lists.</p>
${site.about(view).map((answer) => question(site, answer))}
${wrote}
${question(site, site.question(VIEWS).of("view", view))}
${question(site, site.question(SHOWS).of("view", view))}`,
  );
}

const KIND_PROSE: Readonly<Record<string, string>> = {
  entry:
    "An entry is what an app shows: one allergy, one condition, one vaccination. The build makes it in a view by joining the records judged to be the same thing, and takes each of its values from one of them. Follow a member to see where it came from.",
  record:
    "A record is one thing a source told the pod about, such as one hospital's note of a penicillin allergy. Its file says only what type it is. Each time the source sends it, a revision arrives: it carries a version, which is the content, and names the document it was derived from. A document whose bytes the pod keeps links to them.",
  judgment:
    "A judgment is a decision about records or patient profiles: that two are the same, that they differ, that one is wrong, or whose a profile is. A machine or a person makes it. It is never edited; a later judgment supersedes or retracts it.",
  profile:
    "A patient profile is how one hospital names the person. Each record names a profile as its patient, and an About judgment says whose the profile is. Until one counts, the records naming it stay out of every view.",
};

function thingPage(site: Site, kind: string, thing: Term): Html {
  const name = site.name(thing);
  const prose = KIND_PROSE[kind];
  return layout(
    site,
    name,
    markup`<p class="kind">${kind.charAt(0).toUpperCase()}${kind.slice(1)}</p>
<h1>${name}</h1>
<p class="iri"><code>${thing.value}</code></p>
${prose !== undefined && markup`<p>${prose}</p>\n`}<p>Every section below is one question with only the rows about this ${kind}. The first lists the files of the pod
that say something about it or name it. A <em>Turtle</em> link beside a thing opens the file it arrived in; a thing only ever named, or written by the build, has none.</p>
${site.about(thing, kind).map((answer) => question(site, answer))}`,
  );
}

/** Every page of the site, by its path. */
export function pages(site: Site): Map<string, Html> {
  const found = new Map<string, Html>([
    ["index.html", home(site)],
    ["pipeline.html", pipeline(site)],
    ["not-shown.html", notShown(site)],
  ]);
  for (const view of site.views) {
    const page = site.page(view);
    if (page !== undefined) found.set(page, viewPage(site, view));
  }
  for (const [kind, things] of site.things) {
    for (const thing of things) {
      const page = site.page(thing);
      if (page !== undefined) found.set(page, thingPage(site, kind, thing));
    }
  }
  return found;
}
