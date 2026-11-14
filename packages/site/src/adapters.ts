import {
  type Files,
  Graph,
  type Literal,
  OxigraphStore,
  RDF,
  readText,
  repositoryName,
  type Term,
} from "@cascade-runtime/runtime";
import {
  type Chrome,
  type Content,
  Html,
  markup,
  shell as pageShell,
} from "./html.js";
import { noteLinkOf, termHref } from "./links.js";
import { renderWithHeadings } from "./markdown.js";
import { STYLESHEET_FILE } from "./site.js";
import { prefixed } from "./terms.js";

const BRIDGE = "https://ns.cascadeprotocol.org/bridge/v1-draft#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const TYPE = `${RDF}type`;
export const CRATE_FILE = "ro-crate-metadata.json";
export const FORMAT_FILE = "docs/format.md";
export const README_FILE = "README.md";

/** The hub's folder of the adapters' pages, and the term reference as it is reached from an adapter's page. */
export const ADAPTERS_FOLDER = "adapters/";
const TERMS = "../../terms/";

/** What an adapter does with a source path, in the order the page lists them, with how each is put to a reader. */
const VERDICTS: readonly { id: string; title: string; why?: string }[] = [
  { id: "carried", title: "Carried" },
  { id: "carriedInPart", title: "Carried in part", why: "gap" },
  { id: "noHome", title: "No Cascade predicate carries it", why: "gap" },
  { id: "redundantWith", title: "Another path carries the same fact" },
  { id: "consumed", title: "Read while the pod is built, and not carried" },
  { id: "ignored", title: "Deliberately not carried", why: "because" },
];
const NOT_CARRIED = [
  "noHome",
  "carriedInPart",
  "ignored",
  "consumed",
  "redundantWith",
];

/**
 * A FHIR path is written four ways in the accounting: as the resource alone, as the resource of a Bundle entry, as a
 * resource contained in another, and as one contained in a Bundle entry's.
 */
const FORMS = ["", "/resource", "/contained", "/resource/contained"] as const;

/**
 * The titles of the C-CDA templates the C-CDA adapter reads, by the root of their templateId: the names C-CDA 5.0.0 gives
 * them, as the adapter's docs/format.md calls them. A template not listed is shown by its root alone.
 */
const TEMPLATES: Readonly<Record<string, string>> = {
  "2.16.840.1.113883.10.20.22.1.1": "US Realm Header",
  "2.16.840.1.113883.10.20.22.1.10": "Unstructured Document",
  "2.16.840.1.113883.10.20.22.4.1": "Result Organizer",
  "2.16.840.1.113883.10.20.22.4.2": "Result Observation",
  "2.16.840.1.113883.10.20.22.4.4": "Problem Observation",
  "2.16.840.1.113883.10.20.22.4.7": "Allergy - Intolerance Observation",
  "2.16.840.1.113883.10.20.22.4.14": "Procedure Activity Procedure",
  "2.16.840.1.113883.10.20.22.4.16": "Medication Activity",
  "2.16.840.1.113883.10.20.22.4.52": "Immunization Activity",
  "2.16.840.1.113883.10.20.22.4.202": "Note Activity",
};

/** The XML namespaces an adapter's paths name, as the prefix they are shown with; the C-CDA's own is shown with none. */
const NAMESPACES: Readonly<Record<string, string>> = {
  "urn:hl7-org:v3": "",
  "urn:hl7-org:sdtc": "sdtc:",
  "http://www.w3.org/2001/XMLSchema-instance": "xsi:",
};
const ELEMENT =
  /\*\[local-name\(\)='([^']+)' and namespace-uri\(\)='([^']+)'\]/g;

/** One Cascade property a source path becomes, on one class of record. */
export interface Becomes {
  readonly property: string;
  readonly recordClass: string;
  /** The source's name for the kind of record: a FHIR resource type, or a C-CDA template's root. */
  readonly sourceType?: string;
}

/** One source path, with the forms it was written in, and what the adapter does with it. */
export interface Path {
  /** The path as the accounting writes it, the form's prefix taken off. */
  readonly path: string;
  readonly forms: readonly string[];
  /** The path is a member of a Bundle entry, not an element of a resource in any form. */
  readonly entryMember?: true;
  readonly verdict: string;
  /** The label of the gap the entry names. */
  readonly gap?: string;
  readonly because?: string;
  /** The path that carries the same fact, in the same form. */
  readonly sameFactAs?: string;
  readonly becomes: readonly Becomes[];
}

export interface Accounting {
  readonly paths: readonly Path[];
  /** The entries the accounting holds, a path in each of its forms being one. */
  readonly entries: number;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const parsed = async (
  files: Files,
  path: string,
): Promise<{ graph: Graph; where: string }> => {
  const where = `${files.iri}${path}`;
  const text = await readText(files, path);
  try {
    return {
      graph: new Graph(await new OxigraphStore().parse(text, where)),
      where,
    };
  } catch (error) {
    throw new Error(
      `${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

const isLiteral = (term: Term): term is Literal => term.termType === "Literal";

/** A gap's label: its English `skos:prefLabel` or else the first, else the end of its address. */
function labels(graph: Graph): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const english = new Set<string>();
  for (const [subject, predicate, object] of graph.triples) {
    if (
      subject.termType !== "NamedNode" ||
      predicate.value !== `${SKOS}prefLabel` ||
      !isLiteral(object)
    )
      continue;
    const isEnglish = object.language === "en";
    if (
      !found.has(subject.value) ||
      (isEnglish && !english.has(subject.value))
    ) {
      found.set(subject.value, object.value);
      if (isEnglish) english.add(subject.value);
    }
  }
  return found;
}

const last = (iri: string): string => iri.slice(iri.search(/[^#/]*$/));

/** The paths the accounting writes, with no prefix, for the members of a Bundle entry itself. */
const ENTRY_MEMBERS: ReadonlySet<string> = new Set([
  "/fullUrl",
  "/resource",
  "/request",
  "/request/method",
  "/request/url",
  "/search",
  "/search/mode",
]);

/** The form a FHIR path is written in, and the path without it. */
function formOf(path: string): [form: string, rest: string] {
  for (const form of [...FORMS].reverse())
    if (form !== "" && path.startsWith(`${form}/`))
      return [form, path.slice(form.length)];
  return ["", path];
}

/**
 * An adapter's accounting, read: a row for each source path with the forms it was written in folded into one, where
 * every form says the same.
 */
export async function readAccounting(
  files: Files,
  accountingPath: string,
  gapsPath: string | undefined,
): Promise<Accounting> {
  const { graph } = await parsed(files, accountingPath);
  const gaps =
    gapsPath === undefined
      ? new Map<string, string>()
      : labels((await parsed(files, gapsPath)).graph);
  const one = (subject: Term, predicate: string): Term | undefined =>
    graph.objects(subject, `${BRIDGE}${predicate}`)[0];
  const merged = new Map<string, { path: Path; forms: Set<string> }>();
  let entries = 0;
  for (const [entry, predicate, object] of graph.triples) {
    if (predicate.value !== TYPE || object.value !== `${BRIDGE}PathEntry`)
      continue;
    const source = one(entry, "sourcePath");
    const verdict = one(entry, "verdict");
    if (source === undefined || verdict === undefined) continue;
    entries += 1;
    const [form, rest] = formOf(source.value);
    const gap = one(entry, "namesGap");
    const because = one(entry, "because");
    const same = one(entry, "sameFactAs");
    const becomes = graph
      .objects(entry, `${BRIDGE}carriedAs`)
      .flatMap((node): Becomes[] => {
        const property = one(node, "asProperty");
        const recordClass = one(node, "inRecordClass");
        const sourceType = one(node, "inSourceRecordType");
        return property === undefined || recordClass === undefined
          ? []
          : [
              {
                property: property.value,
                recordClass: recordClass.value,
                ...(sourceType === undefined
                  ? {}
                  : { sourceType: sourceType.value }),
              },
            ];
      })
      .sort(
        (a, b) =>
          compare(a.sourceType ?? "", b.sourceType ?? "") ||
          compare(a.property, b.property) ||
          compare(a.recordClass, b.recordClass),
      );
    const path: Path = {
      path: rest,
      forms: [],
      ...(form === "" && ENTRY_MEMBERS.has(rest) ? { entryMember: true } : {}),
      verdict: last(verdict.value),
      ...(gap === undefined
        ? {}
        : { gap: gaps.get(gap.value) ?? last(gap.value) }),
      ...(because === undefined ? {} : { because: because.value }),
      ...(same === undefined
        ? {}
        : {
            sameFactAs:
              form !== "" && same.value.startsWith(`${form}/`)
                ? same.value.slice(form.length)
                : same.value,
          }),
      becomes,
    };
    const key = JSON.stringify({ ...path, forms: undefined });
    const held = merged.get(key);
    if (held === undefined) merged.set(key, { path, forms: new Set([form]) });
    else held.forms.add(form);
  }
  return {
    entries,
    paths: [...merged.values()]
      .map(({ path, forms }) => ({
        ...path,
        forms: FORMS.filter((form) => forms.has(form)),
      }))
      .sort((a, b) => compare(a.path, b.path)),
  };
}

/** Everything a page of one adapter needs. */
export interface AdapterView {
  /** The adapter's folder under `adapters/`: its crate's identifier. */
  readonly slug: string;
  readonly title: string;
  readonly repository: string;
  readonly commit: string;
  /** The adapter's folders and files on GitHub at the commit, each ending in a slash. */
  readonly tree: string;
  readonly blob: string;
  readonly accountingPath: string;
  readonly gapsPath?: string;
  readonly format?: { readonly path: string; readonly text: string };
  readonly accounting: Accounting;
  /** The terms the term reference has an entry for, which a link may reach. */
  readonly declared: ReadonlySet<string>;
}

const repositoryOf = (repository: string): string =>
  repositoryName({ repository });

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

interface Crate {
  readonly identifier: string;
  readonly name: string;
  readonly accounting: string;
  readonly gaps?: string;
}

/** The adapter's crate: the identifier its pages take their folder from, its name, and the files of its accounting and gaps. */
export function crateOf(text: string): Crate {
  const root = (
    (JSON.parse(text) as { "@graph"?: Record<string, unknown>[] })["@graph"] ??
    []
  ).find((node) => node["@id"] === "./");
  const reference = (key: string): string | undefined => {
    const value = root?.[key] as { "@id"?: unknown } | undefined;
    return typeof value?.["@id"] === "string" ? value["@id"] : undefined;
  };
  const identifier = root?.["identifier"];
  const name = root?.["name"];
  const accounting = reference("bridge:sourceAccounting");
  if (typeof identifier !== "string" || !SLUG.test(identifier))
    throw new Error(
      `${CRATE_FILE} names no identifier a folder can take its name from`,
    );
  if (accounting === undefined)
    throw new Error(`${CRATE_FILE} names no bridge:sourceAccounting`);
  const gaps = reference("bridge:gapScheme");
  return {
    identifier,
    name: typeof name === "string" ? name : identifier,
    accounting,
    ...(gaps === undefined ? {} : { gaps }),
  };
}

const STYLES = `
.forms { display: block; color: var(--muted); font-size: .8rem; }
.contents { color: var(--muted); }
td.path { max-width: 38rem; }
`;

/** A path as it is shown: the namespaces of its elements, but the C-CDA's own, as prefixes. */
export function shownPath(path: string): string {
  return path.replace(ELEMENT, (whole, name: string, namespace: string) => {
    const prefix = NAMESPACES[namespace];
    return prefix === undefined ? whole : `${prefix}${name}`;
  });
}

const encoder = new TextEncoder();

const shell = (
  chrome: Chrome,
  title: string,
  up: string,
  nav: Content,
  main: Content,
): Uint8Array =>
  encoder.encode(
    pageShell({
      chrome,
      title: markup`${title} · Cascade adapters`,
      stylesheet: `${up}${STYLESHEET_FILE}`,
      head: markup`<style>${new Html(STYLES)}</style>
`,
      nav,
      main,
    }).text,
  );

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

function counts(accounting: Accounting): {
  carried: number;
  part: number;
  not: number;
} {
  const carried = new Set<string>();
  const part = new Set<string>();
  const not = new Set<string>();
  for (const { verdict, path } of accounting.paths) {
    if (verdict === "carried") carried.add(path);
    else if (verdict === "carriedInPart") part.add(path);
    else not.add(`${verdict} ${path}`);
  }
  return { carried: carried.size, part: part.size, not: not.size };
}

const short = (commit: string): string => commit.slice(0, 7);

/** One adapter, or why there is none, as the adapters page lists it. */
export type Listed =
  | { readonly view: AdapterView }
  | { readonly repository: string; readonly unavailable: string };

/** The page that lists the adapters, with the commit each was built from and how many paths it carries. */
export function adaptersIndex(
  listed: readonly Listed[],
  chrome: Chrome,
): Uint8Array {
  return shell(
    chrome,
    "Adapters",
    "../",
    markup`<a href="../index.html">Cascade Protocol reference</a>`,
    markup`<h1>Adapters</h1>
<p class="prose">An adapter turns one source format into Cascade records. Its accounting says, for every path of the source
format it knows, what the path becomes or why it does not: the property and the record class it is written as, linked to
the term reference, or the verdict and the gap that explains it. Each page below is read from the adapter's default branch
as it stood when these pages were built.</p>
<h2 class="part" id="adapters">The adapters</h2>
<table>
<thead><tr><th>adapter</th><th>built from</th><th>paths carried</th><th>carried in part</th><th>not carried</th></tr></thead>
<tbody>
${listed.map((one) => {
  if ("unavailable" in one)
    return markup`<tr><td data-label="adapter"><code>${repositoryOf(one.repository)}</code></td><td data-label="built from"><a href="${one.repository}">${one.repository}</a></td><td data-label="paths carried" colspan="3">Not available: ${one.unavailable}</td></tr>\n`;
  const { view } = one;
  const { carried, part, not } = counts(view.accounting);
  return markup`<tr><td data-label="adapter"><a href="${view.slug}/index.html">${view.title}</a></td><td data-label="built from"><a href="${view.repository}">${repositoryOf(view.repository)}</a> at <a href="${view.tree}"><code>${short(view.commit)}</code></a></td><td data-label="paths carried">${carried}</td><td data-label="carried in part">${part}</td><td data-label="not carried">${not}</td></tr>\n`;
})}</tbody>
</table>
<p class="about">A path is counted once for each verdict the accounting gives it, whatever forms it is written in and however many reasons it gives.</p>
`,
  );
}

function termLink(iri: string, declared: ReadonlySet<string>): Html {
  const name = prefixed(iri) ?? iri;
  return declared.has(iri)
    ? markup`<a href="${termHref(iri, TERMS)}"><code>${name}</code></a>`
    : markup`<code>${name}</code>`;
}

function groupTitle(sourceType: string | undefined): Html {
  if (sourceType === undefined) return markup`Not tied to one kind of record`;
  const title = TEMPLATES[sourceType];
  return title === undefined
    ? markup`<code>${sourceType}</code>`
    : markup`${title} <code>${sourceType}</code>`;
}

function formsNote({ forms, entryMember }: Path, all: boolean): Content {
  if (entryMember)
    return markup`<span class="forms">a Bundle entry's own member</span>`;
  if (!all || forms.length === FORMS.length) return "";
  return markup`<span class="forms">only as ${forms.map((form, at) => markup`${at === 0 ? "" : ", "}<code>${form}/x</code>`)}</span>`;
}

function crosswalk(view: AdapterView, withForms: boolean): Html {
  const groups = new Map<string, { path: Path; becomes: Becomes }[]>();
  for (const path of view.accounting.paths)
    if (path.verdict === "carried" || path.verdict === "carriedInPart")
      for (const becomes of path.becomes) {
        const key = becomes.sourceType ?? "";
        const held = groups.get(key);
        if (held === undefined) groups.set(key, [{ path, becomes }]);
        else held.push({ path, becomes });
      }
  const unnamed = view.accounting.paths.filter(
    ({ verdict, becomes }) =>
      (verdict === "carried" || verdict === "carriedInPart") &&
      becomes.length === 0,
  );
  const keys = [...groups.keys()].sort((a, b) =>
    a === ""
      ? 1
      : b === ""
        ? -1
        : compare(TEMPLATES[a] ?? a, TEMPLATES[b] ?? b),
  );
  return markup`<p class="contents">${keys.map((key, at) => markup`${at === 0 ? "" : " · "}<a href="#type-${key === "" ? "none" : key}">${groupTitle(key === "" ? undefined : key)}</a>`)}${unnamed.length === 0 ? "" : markup` · <a href="#unnamed">Carried, no term named</a>`}</p>
${keys.map((key) => {
  const rows = (groups.get(key) ?? []).sort(
    (a, b) =>
      compare(a.path.path, b.path.path) ||
      compare(
        prefixed(a.becomes.property) ?? a.becomes.property,
        prefixed(b.becomes.property) ?? b.becomes.property,
      ) ||
      compare(a.becomes.recordClass, b.becomes.recordClass),
  );
  return markup`<h3 id="type-${key === "" ? "none" : key}">${groupTitle(key === "" ? undefined : key)}</h3>
<table>
<thead><tr><th>source path</th><th>becomes</th><th>on</th><th>carried</th></tr></thead>
<tbody>
${rows.map(({ path, becomes }) => markup`<tr><td class="path" data-label="source path"><code>${shownPath(path.path)}</code>${formsNote(path, withForms)}</td><td data-label="becomes">${termLink(becomes.property, view.declared)}</td><td data-label="on">${termLink(becomes.recordClass, view.declared)}</td><td data-label="carried">${path.verdict === "carried" ? "whole" : markup`<a href="#carriedInPart">in part</a>`}</td></tr>\n`)}</tbody>
</table>
`;
})}${
    unnamed.length === 0
      ? ""
      : markup`<h3 id="unnamed">Carried, no term named</h3>
<p class="prose">The accounting says these paths reach the pod and names no Cascade property for them.</p>
<table>
<thead><tr><th>source path</th><th>carried</th></tr></thead>
<tbody>
${unnamed.map((path) => markup`<tr><td class="path" data-label="source path"><code>${shownPath(path.path)}</code>${formsNote(path, withForms)}</td><td data-label="carried">${path.verdict === "carried" ? "whole" : markup`<a href="#carriedInPart">in part</a>`}</td></tr>\n`)}</tbody>
</table>
`
  }`;
}

function notCarried(view: AdapterView, withForms: boolean): Html {
  const others = [
    ...new Set(view.accounting.paths.map(({ verdict }) => verdict)),
  ]
    .filter((id) => id !== "carried" && !NOT_CARRIED.includes(id))
    .sort();
  return markup`${[...NOT_CARRIED, ...others].map((id) => {
    const verdict = VERDICTS.find((one) => one.id === id);
    const paths = view.accounting.paths.filter((path) => path.verdict === id);
    if (paths.length === 0) return "";
    const why =
      verdict?.why === "gap"
        ? "gap"
        : verdict?.why === "because"
          ? "why"
          : id === "redundantWith"
            ? "same fact as"
            : undefined;
    return markup`<h3 id="${id}">${verdict?.title ?? id} <span class="about">${plural(new Set(paths.map(({ path }) => path)).size, "path")}</span></h3>
<table>
<thead><tr><th>source path</th>${why === undefined ? "" : markup`<th>${why}</th>`}${id === "carriedInPart" ? markup`<th>carried as</th>` : ""}</tr></thead>
<tbody>
${paths.map(
  (path) =>
    markup`<tr><td class="path" data-label="source path"><code>${shownPath(path.path)}</code>${formsNote(path, withForms)}</td>${
      why === undefined
        ? ""
        : markup`<td data-label="${why}">${id === "redundantWith" ? (path.sameFactAs === undefined ? "" : markup`<code>${shownPath(path.sameFactAs)}</code>`) : (path.gap ?? path.because ?? "")}</td>`
    }${
      id === "carriedInPart"
        ? markup`<td data-label="carried as">${[...new Set(path.becomes.map(({ property }) => property))].map((property, at) => markup`${at === 0 ? "" : ", "}${termLink(property, view.declared)}`)}</td>`
        : ""
    }</tr>\n`,
)}</tbody>
</table>
`;
  })}`;
}

function formatNotes(view: AdapterView): Html {
  const { format } = view;
  if (format === undefined)
    return markup`<p class="prose">This adapter has no <code>${FORMAT_FILE}</code> or <code>${README_FILE}</code> at this commit.</p>`;
  const { html } = renderWithHeadings(
    format.text.replace(/^#[ \t][^\n]*\n/, ""),
    {
      link: (href) =>
        noteLinkOf(href, format.path, { blob: view.blob, tree: view.tree }),
      reserved: RESERVED,
    },
  );
  return markup`<div class="document">${html}</div>`;
}

const RESERVED = [
  "crosswalk",
  "forms",
  "not-carried",
  "format",
  "files",
  ...NOT_CARRIED,
];

/** One adapter's page: the crosswalk, what is not carried, and the adapter's format notes. */
export function adapterPage(view: AdapterView, chrome: Chrome): Uint8Array {
  const { accounting } = view;
  const { carried, part, not } = counts(accounting);
  const withForms = accounting.paths.some(
    ({ forms }) => forms.length > 1 || forms.some((form) => form !== ""),
  );
  const shortened = accounting.paths.some(
    ({ path }) => shownPath(path) !== path,
  );
  const files: [string, string][] = [
    [view.accountingPath, "the accounting, which this page is read from"],
    ...(view.gapsPath === undefined
      ? []
      : [[view.gapsPath, "the gaps its verdicts name"] as [string, string]]),
    ...(view.format === undefined
      ? []
      : [[view.format.path, "the format notes below"] as [string, string]]),
    [CRATE_FILE, "the adapter's manifest"],
  ];
  return shell(
    chrome,
    view.title,
    "../../",
    markup`<a href="../../index.html">Cascade Protocol reference</a> <a href="../index.html">Adapters</a>`,
    markup`<p class="kind">Adapter</p>
<h1>${view.title}</h1>
<p class="about">Read from <a href="${view.repository}">${repositoryOf(view.repository)}</a> at <a href="${view.tree}"><code>${short(view.commit)}</code></a>,
the head of its default branch when these pages were built. The accounting is
<a href="${view.blob}${view.accountingPath}"><code>${view.accountingPath}</code></a>.</p>
<p class="prose">${plural(carried, "source path")} carried whole, ${part} in part and ${not} not carried, ${plural(accounting.entries, "entry", "entries")} in the accounting.</p>
<p class="contents"><a href="#crosswalk">What a path becomes</a> · <a href="#not-carried">What is not carried</a> · <a href="#format">Format notes</a> · <a href="#files">Files</a></p>
<h2 class="part" id="crosswalk">What a source path becomes</h2>
<p class="prose">Each row is one source path read in one kind of record, the Cascade property its value is written as and the class
of record it is written on, linked to the term reference where it describes the term. A leaf property such as <code>decimalValue</code> or <code>ucumUnit</code> is
named on the record's class, not on the link term a query writes (<code>resultQuantity</code>, <code>referenceRangeLow</code>): the path tells a value from a range's bound.</p>
${
  withForms
    ? markup`<p class="prose" id="forms">A FHIR path is listed once for the forms the accounting writes it in: <code>/x</code> for a resource alone,
<code>/resource/x</code> for the resource of a Bundle entry, <code>/contained/x</code> for a resource contained in another and
<code>/resource/contained/x</code> for one contained in an entry's. A row says so where the path is in some of the forms only. The members of a Bundle entry itself (<code>/fullUrl</code>,
<code>/resource</code>, <code>/request</code> and <code>/search</code> with theirs) are none of the four forms: they belong to the entry, not to a resource.</p>
`
    : ""
}${
      shortened
        ? markup`<p class="prose">Elements in the HL7 v3 namespace are shown without it; <code>sdtc:</code> and <code>xsi:</code> mark the SDTC extension and the XML Schema instance namespaces.</p>
`
        : ""
    }${crosswalk(view, withForms)}<h2 class="part" id="not-carried">What is not carried</h2>
<p class="prose">Every other path of the accounting, by what the adapter does with it, and a path carried in part with the part it does not carry.</p>
${notCarried(view, withForms)}<h2 class="part" id="format">Format notes</h2>
<p class="about">The adapter's <code>${view.format?.path ?? FORMAT_FILE}</code>; its links go to the adapter's files on GitHub at this commit.</p>
${formatNotes(view)}<h2 class="part" id="files">Files</h2>
<ul>
${files.map(([path, about]) => markup`<li><a href="${view.blob}${path}"><code>${path}</code></a>: ${about}</li>\n`)}</ul>
`,
  );
}
