import { type Files, prose, readText } from "@cascade-runtime/runtime";
import {
  type Chrome,
  type Content,
  escape,
  Html,
  markup,
  shell,
} from "./html.js";
import { withoutComment } from "./answer.js";
import {
  addressesOf,
  frontPageLink,
  type Named,
  noteHref,
  ruleHref,
  slugOf,
  termHref,
} from "./links.js";
import { STYLESHEET_FILE } from "./site.js";
import {
  namedInQuery,
  type QueryNaming,
  queryFacts,
  TERMS_FOLDER,
} from "./term-reference.js";
import { prefixed } from "./terms.js";

export const QUERIES_FOLDER = "queries/";
export const QUERIES_PAGE = `${QUERIES_FOLDER}index.html`;

/** The example pod whose rows the pages show. */
export const ROWS_OF = { folder: "alex-rivera", name: "Alex Rivera" } as const;
/** How many rows of a question or entries of a view a page shows, enough to see the shape of an answer; the rest are in the pod's explorer and `answers.json`. */
export const ROWS_SHOWN = 10;
/** How many of an entry's fields a view's row says. */
const FIELDS_SHOWN = 6;

const encoder = new TextEncoder();

interface Group {
  readonly id: string;
  readonly title: string;
  /** What one query of the group is, for the page's kind line and title. */
  readonly one: string;
  readonly about: string;
}

/** The kinds of query, in the order the index lists them; a folder this list lacks follows, by its name. */
const GROUPS: readonly Group[] = [
  {
    id: "questions",
    title: "Named questions",
    one: "Named question",
    about:
      "What a person asks of a pod, by the kind of thing the question is about. Each is answered from the views alone.",
  },
  {
    id: "views",
    title: "Views",
    one: "View",
    about:
      "The queries that make each view file of a pod, which an app reads without the records behind it.",
  },
  {
    id: "labels",
    title: "Labels",
    one: "Labels query",
    about: "The query that gives every record, entry and judgment a name.",
  },
  {
    id: "matcher",
    title: "Matcher rules",
    one: "Matcher rule",
    about:
      "The query each rule of the matcher runs to say when two records match.",
  },
  {
    id: "derivations",
    title: "Derivations",
    one: "Derivation",
    about:
      "The queries that derive statements from a pod's records, for the questions and views to read.",
  },
  {
    id: "lenses",
    title: "Lenses",
    one: "Lens",
    about: "The queries that decide which judgments count.",
  },
  {
    id: "tables",
    title: "Tables",
    one: "Table query",
    about:
      "The queries that read the reference tables an app holds against a pod's entries.",
  },
];

/** One query of the vocabulary, as its path places it. */
interface Query {
  /** Its path in the vocabulary. */
  readonly path: string;
  readonly text: string;
  readonly group: string;
  /** The kind of thing a named question is about. */
  readonly subject?: string;
  /** Its name: its file's, less `.rq`. */
  readonly name: string;
  /** Its page, from the tree's root. */
  page: string;
}

function placed(path: string, text: string): Query {
  const parts = path.slice(QUERIES_FOLDER.length).split("/");
  const name = (parts.at(-1) ?? path).replace(/\.rq$/, "");
  const group = parts.length === 1 ? name : (parts[0] ?? name);
  return {
    path,
    text,
    group,
    ...(group === "questions" && parts.length > 2 && parts[1] !== undefined
      ? { subject: parts[1] }
      : {}),
    name,
    page: "",
  };
}

/** A query's leading comment, which says what it is for; nothing when it has none. */
const purposeOf = (text: string): string => prose(text).trim();

/** The longest a line of the index is. */
const LINE = 200;

/**
 * The comment's first sentence: up to the first stop followed by a capital letter or a bracket. One longer than a line of
 * the index is cut with an ellipsis at its first clause, after the first comma, semicolon or colon that leaves at least
 * a few words, or at a word when it has none.
 */
export function firstSentence(comment: string): string {
  const sentence =
    /^[\s\S]*?[.?!](?=\s+[A-Z(]|$)/.exec(comment)?.[0] ?? comment;
  if (sentence.length <= LINE) return sentence;
  const clause = /^[\s\S]{30,}?(?=[,;:]\s)/.exec(sentence)?.[0];
  if (clause !== undefined && clause.length <= LINE) return `${clause}…`;
  const cut = sentence.slice(0, LINE);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/** The line a query has on the index: its comment's first sentence, or its name as a phrase when it has no comment. */
const summaryOf = ({ text, name }: Query): string => {
  const purpose = purposeOf(text);
  return purpose === "" ? name.replace(/[-_]+/g, " ") : firstSentence(purpose);
};

const SPARQL_TOKEN =
  /<[^<>"{}|^`\\\s]*>|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|#[^\n]*|[?$][A-Za-z_]\w*|(?<![\w:?$.-])(?:SELECT|CONSTRUCT|ASK|DESCRIBE|WHERE|PREFIX|BASE|FROM|NAMED|GRAPH|FILTER|OPTIONAL|UNION|MINUS|BIND|VALUES|SERVICE|AS|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|DISTINCT|REDUCED|NOT|IN|EXISTS|ASC|DESC|COUNT|SUM|MIN|MAX|AVG|SAMPLE|GROUP_CONCAT|COALESCE|IF|STR|LANG|DATATYPE|BOUND|REGEX|CONCAT|REPLACE|SUBSTR|STRLEN|STRSTARTS|STRENDS|CONTAINS|ISIRI|ISBLANK|ISLITERAL|SAMETERM|STRDT|STRLANG|IRI|URI|BNODE|LCASE|UCASE|ABS|CEIL|FLOOR|ROUND|YEAR|MONTH|DAY|NOW)(?![\w:-])/gi;

const CLASS_OF = (token: string): string =>
  token.startsWith("#")
    ? "c"
    : token.startsWith("<")
      ? "i"
      : token.startsWith('"') || token.startsWith("'")
        ? "s"
        : /^[?$]/.test(token)
          ? "v"
          : "k";

/** A query's text as markup, its comments, IRIs, strings, variables and keywords each in a span of their own. */
export function highlighted(text: string): Html {
  const parts: Content[] = [];
  let at = 0;
  for (const found of text.matchAll(SPARQL_TOKEN)) {
    const token = found[0];
    const start = found.index ?? 0;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(markup`<span class="tk-${CLASS_OF(token)}">${token}</span>`);
    at = start + token.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return markup`${parts}`;
}

/** Alex Rivera's built site as far as the pages read it: each question's rows, and each view's entries. */
interface Says {
  readonly label: string;
  readonly page?: string;
  readonly says: string;
}

interface Rows {
  readonly answers: Readonly<
    Record<string, { readonly rows: readonly Record<string, string>[] }>
  >;
  readonly views: ReadonlyMap<string, readonly Says[]>;
  readonly folder: string;
}

interface ExplorerShape {
  readonly pod?: { readonly lens?: string };
  readonly queries?: readonly { readonly path: string }[];
  readonly views?: readonly {
    readonly query: number;
    readonly entries?: readonly {
      readonly label: string;
      readonly page?: string;
      readonly fields?: readonly {
        readonly term: string;
        readonly entry: string;
      }[];
    }[];
  }[];
}

type Answers = Record<
  string,
  Record<string, { rows: readonly Record<string, string>[] }>
>;

/** What a built example's site says of its questions and views, or nothing when it is not Alex Rivera's or lacks them. */
export function rowsOf(
  example:
    | {
        readonly folder: string;
        readonly site: ReadonlyMap<string, Uint8Array>;
      }
    | undefined,
): Rows | undefined {
  if (example === undefined || example.folder !== ROWS_OF.folder)
    return undefined;
  const json = <T>(name: string): T | undefined => {
    const bytes = example.site.get(name);
    return bytes === undefined
      ? undefined
      : (JSON.parse(new TextDecoder().decode(bytes)) as T);
  };
  const explorer = json<ExplorerShape>("explorer.json");
  const answers = json<Answers>("answers.json");
  if (explorer === undefined || answers === undefined) return undefined;
  const lens = explorer.pod?.lens ?? Object.keys(answers)[0] ?? "";
  const views = new Map<string, readonly Says[]>();
  for (const { query, entries = [] } of explorer.views ?? []) {
    const path = explorer.queries?.[query]?.path;
    if (path === undefined) continue;
    views.set(path, [
      ...(views.get(path) ?? []),
      ...entries.map(({ label, page, fields = [] }) => ({
        label,
        ...(page === undefined ? {} : { page }),
        says: fields
          .slice(0, FIELDS_SHOWN)
          .map(({ term, entry }) => `${term} ${entry}`)
          .join("; "),
      })),
    ]);
  }
  return { answers: answers[lens] ?? {}, views, folder: example.folder };
}

const phrase = (iri: string): string => prefixed(iri) ?? iri;

/**
 * The columns a reader sees: every column any shown row has, in the order each first appears, each label folded into the
 * column it labels. A row omits a variable it leaves unbound, so the first row alone misses some.
 */
function shownColumns(
  rows: readonly Readonly<Record<string, string>>[],
): string[] {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return columns.filter(
    (column) =>
      !(
        column.endsWith("Label") &&
        columns.includes(column.slice(0, -"Label".length))
      ),
  );
}

const cellOf = (
  row: Readonly<Record<string, string>>,
  column: string,
): Html => {
  const said = row[`${column}Label`] ?? phrase(row[column] ?? "");
  return new Html(
    said
      .split(/(?<=[/#])/)
      .map(escape)
      .join("<wbr>"),
  );
};

function table(
  head: readonly string[],
  rows: readonly (readonly Content[])[],
): Html {
  return markup`<div class="answer"><table class="results rows">
<thead><tr>${head.map((name) => markup`<th scope="col">${name}</th>`)}</tr></thead>
<tbody>
${rows.map((cells) => markup`<tr>${cells.map((cell, at) => markup`<td data-label="${head[at]}">${cell}</td>`)}</tr>\n`)}</tbody>
</table></div>
`;
}

const noun = (query: Query): string =>
  query.group === "questions"
    ? "question"
    : query.group === "views"
      ? "view"
      : "query";

/** What a page says of the query's rows on the example pod; none for a query that is neither a question nor a view. */
function rowsSection(
  query: Query,
  rows: Rows | undefined,
  up: string,
): Html | undefined {
  const isQuestion = query.group === "questions";
  if (!isQuestion && query.group !== "views" && query.group !== "labels")
    return undefined;
  const who = ROWS_OF.name;
  const heading = markup`<h2>Its rows on ${who}'s pod</h2>\n`;
  if (rows === undefined)
    return markup`${heading}<p class="prose">${who}'s pod is not built here, so its rows are not shown.</p>\n`;
  const pod = `${up}${rows.folder}/`;
  const explorer = markup`<a href="${pod}index.html">${who}'s explorer</a>`;
  const key = query.path.slice("queries/questions/".length, -".rq".length);
  const asked = isQuestion ? (rows.answers[key]?.rows ?? []) : undefined;
  const entries = isQuestion ? undefined : (rows.views.get(query.path) ?? []);
  const count = asked?.length ?? entries?.length ?? 0;
  if (count === 0)
    return markup`${heading}<p class="prose">${who}'s pod gives this ${noun(query)} no rows. Open it in ${explorer}.</p>\n`;
  const shown = Math.min(count, ROWS_SHOWN);
  const body =
    asked !== undefined && asked.length > 0
      ? (() => {
          const showing = asked.slice(0, shown);
          const columns = shownColumns(showing);
          return table(
            columns,
            showing.map((row) => columns.map((column) => cellOf(row, column))),
          );
        })()
      : table(
          ["Entry", "What it says"],
          (entries ?? [])
            .slice(0, shown)
            .map(({ label, page, says }) => [
              page === undefined
                ? label
                : markup`<a href="${pod}${page}">${label}</a>`,
              says,
            ]),
        );
  return markup`${heading}<p class="about">${count > shown ? markup`The first ${shown} of ${count} rows` : markup`${count} ${count === 1 ? "row" : "rows"}`}, as ${explorer} shows them.${
    isQuestion && count > shown
      ? markup` Every row of every question is in <a href="${pod}answers.json">answers.json</a>.`
      : ""
  }</p>
${body}`;
}

const list = (items: readonly Html[]): Html =>
  markup`<ul>\n${items.map((item) => markup`<li>${item}</li>\n`)}</ul>\n`;

/** The page of one query: what it is for, its text, what it reads, what names it, its rows, and its source last. */
function queryPage(
  query: Query,
  group: Group,
  facts: {
    readonly terms: ReadonlySet<string>;
    readonly properties: ReadonlySet<string>;
    readonly naming: QueryNaming | undefined;
  },
  rows: Rows | undefined,
  blob: string,
  chrome: Chrome,
): string {
  const depth = query.page.split("/").length - 1;
  const up = "../".repeat(depth);
  const purpose = purposeOf(query.text);
  const read = [...namedInQuery(query.text)]
    .filter((iri) => facts.terms.has(iri))
    .map((iri) => [phrase(iri), iri] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const rules = facts.naming?.rules ?? [];
  const notes = facts.naming?.notes ?? [];
  const kind =
    query.subject === undefined
      ? group.one
      : `${group.one} about ${query.subject}`;
  return shell({
    chrome,
    title: `${query.name} · ${kind} · Cascade query`,
    stylesheet: `${up}${STYLESHEET_FILE}`,
    hubRoot: up,
    nav: markup`${frontPageLink(depth)}
<a href="${up}${QUERIES_PAGE}">Queries</a>
`,
    main: markup`<p class="kind">${kind}</p>
<h1>${query.name}</h1>
${purpose === "" ? markup`<p class="about">The file states no purpose.</p>\n` : markup`<p class="prose">${purpose}</p>\n`}<h2>The query</h2>
<pre class="code"><code>${highlighted(withoutComment(query.text))}</code></pre>
<h2>Terms it reads</h2>
${read.length === 0 ? markup`<p class="about">It names no term of the vocabulary.</p>\n` : markup`<p class="terms">${read.map(([name, iri], at) => markup`${at === 0 ? "" : " · "}<a href="${termHref(iri, `${up}${TERMS_FOLDER}`, facts.properties.has(iri))}"><code>${name}</code></a>`)}</p>\n`}<h2>Rules and decision notes that name it</h2>
${
  rules.length + notes.length === 0
    ? markup`<p class="about">No rule or decision note writes its path.</p>\n`
    : list([
        ...rules.map(
          ({ path, number, name }) =>
            markup`<a href="${ruleHref(path, number, `${up}spec/`)}">${name}</a> <span class="about">${path}</span>`,
        ),
        ...notes.map(
          ({ path, title }) =>
            markup`<a href="${noteHref(path, up)}">${title}</a> <span class="about">${path}</span>`,
        ),
      ])
}${rowsSection(query, rows, up) ?? ""}<p class="also"><a href="${blob}${encodeURI(query.path)}">${query.path} on GitHub ↗</a></p>
`,
  }).text;
}

const fold = (text: string): string => text.toLowerCase();

/**
 * Queries, sorted by name, in families: each query under the shortest name that is its own or that begins its name
 * and a hyphen, so a rule and its variants are together, the families in the order of their roots.
 */
function familiesOf(sorted: readonly Query[]): Query[][] {
  const roots = new Map<string, Query[]>();
  for (const query of sorted) {
    const root =
      sorted.find(
        ({ name }) => name === query.name || query.name.startsWith(`${name}-`),
      )?.name ?? query.name;
    roots.set(root, [...(roots.get(root) ?? []), query]);
  }
  return [...roots.values()];
}

function indexPage(
  queries: readonly Query[],
  groups: readonly Group[],
  tree: string,
  chrome: Chrome,
): string {
  const by = (group: string): Query[] =>
    queries
      .filter((query) => query.group === group)
      .sort((a, b) =>
        fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : 0,
      );
  const line = (query: Query): Html =>
    markup`<li><a href="${query.page.slice(QUERIES_FOLDER.length)}">${query.name}</a> <span class="about">${summaryOf(query)}</span></li>\n`;
  const family = (rules: readonly Query[]): Html => {
    const [root] = rules;
    return rules.length === 1 && root !== undefined
      ? line(root)
      : markup`<li><details class="family"><summary>${root?.name} · ${rules.length} rules</summary>
<ul class="queries">
${rules.map(line)}</ul>
</details></li>
`;
  };
  return shell({
    chrome,
    title: "Cascade queries",
    stylesheet: `../${STYLESHEET_FILE}`,
    hubRoot: "../",
    nav: markup`${frontPageLink(1)}\n`,
    main: markup`<h1>Cascade queries</h1>
<p class="prose">Every query cascade-vocabulary publishes, by kind: what it is for, as its file says, its text, the terms
it reads, and, for a named question or a view, its rows on ${ROWS_OF.name}'s example pod. The queries are read from
<a href="${tree}${QUERIES_FOLDER}">${QUERIES_FOLDER}</a>.</p>
<p class="terms">${groups.map(({ id, title }, at) => markup`${at === 0 ? "" : " · "}<a href="#${id}">${title}</a>`)}</p>
${groups.map(({ id, title, about }) => {
  if (id !== "questions")
    return markup`<h2 class="part" id="${id}">${title}</h2>
<p class="prose">${about}</p>
<ul class="queries">
${id === "matcher" ? familiesOf(by(id)).map(family) : by(id).map(line)}</ul>
`;
  const subjects = [
    ...new Set(by(id).map(({ subject }) => subject ?? "")),
  ].sort();
  return markup`<h2 class="part" id="${id}">${title}</h2>
<p class="prose">${about}</p>
${subjects.map(
  (
    subject,
  ) => markup`<h3 id="${id}-${slugOf(subject)}">About ${subject === "" ? "no kind of thing" : `the ${subject}`}</h3>
<ul class="queries">
${by(id)
  .filter((query) => (query.subject ?? "") === subject)
  .map(line)}</ul>
`,
)}`;
})}<p class="about">Read from cascade-vocabulary at <a href="${tree}">${tree}</a>; the example pod may have been built from another commit.</p>
`,
  }).text;
}

/** What the pages are made of. */
export interface QueryPages {
  readonly vocabulary: Files;
  /** The example whose rows the pages show; none when the build has not made it. */
  readonly example?: {
    readonly folder: string;
    readonly site: ReadonlyMap<string, Uint8Array>;
  };
  readonly chrome: Chrome;
}

/**
 * `queries/index.html`, which lists every `.rq` under the vocabulary's `queries/` by kind, and a page for each below it:
 * `queries/<kind>/<slug>.html`, a named question's under its subject (`queries/questions/pod/`). Its rows are those of
 * the example pod.
 */
export async function queryPages({
  vocabulary,
  example,
  chrome,
}: QueryPages): Promise<ReadonlyMap<string, Uint8Array>> {
  const paths = (await vocabulary.list("queries"))
    .filter((path) => path.endsWith(".rq"))
    .sort();
  const queries = await Promise.all(
    paths.map(async (path) => placed(path, await readText(vocabulary, path))),
  );
  const known = new Set(GROUPS.map(({ id }) => id));
  const groups = [
    ...GROUPS.filter(({ id }) => queries.some(({ group }) => group === id)),
    ...[...new Set(queries.map(({ group }) => group))]
      .filter((id) => !known.has(id))
      .sort()
      .map((id) => ({
        id,
        title: id,
        one: "Query",
        about: `The queries under ${QUERIES_FOLDER}${id}/.`,
      })),
  ];
  const named: Named[] = queries.map((query) => ({
    iri: query.path,
    folder:
      `${QUERIES_FOLDER}${query.group}${query.subject === undefined ? "" : `/${query.subject}`}`.replace(
        /\/$/,
        "",
      ),
    name: query.name,
    fallback: query.path,
  }));
  const addresses = await addressesOf(named);
  for (const query of queries) query.page = addresses.get(query.path) ?? "";
  const { terms, properties, naming } = await queryFacts(vocabulary);
  const rows = rowsOf(example);
  const tree = vocabulary.iri;
  const blob = tree.includes("/tree/")
    ? tree.replace("/tree/", "/blob/")
    : tree;
  const files = new Map<string, Uint8Array>([
    [QUERIES_PAGE, encoder.encode(indexPage(queries, groups, tree, chrome))],
  ]);
  for (const query of queries)
    files.set(
      query.page,
      encoder.encode(
        queryPage(
          query,
          groups.find(({ id }) => id === query.group) as Group,
          { terms, properties, naming: naming.get(query.path) },
          rows,
          blob,
          chrome,
        ),
      ),
    );
  return files;
}
