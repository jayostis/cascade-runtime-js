import {
  builtFileBytes,
  type CodeSystem,
  DERIVED,
  documentName,
  featuresOf,
  type Files,
  iri,
  type Layout,
  lenses,
  QUERIES,
  type PodBuild,
  podDataset,
  questions,
  readText,
  readWrittenFeature,
  type StoreFactory,
  tableTerms,
  type Term,
  type Triple,
  Union,
  type VocabularyBuild,
  type VocabularyQuery,
  written,
} from "@cascade-runtime/runtime";
import { Answer } from "./answer.js";
import { explorerFiles } from "./explorer.js";
import { addressesOf } from "./links.js";
import { pages } from "./pages.js";
import { numberOf } from "./spec.js";
import { STYLESHEET } from "./stylesheet.js";
import { CALLED, COPY, STATED, terms } from "./terms.js";

export const STYLESHEET_FILE = "site.css";
const CRATE = "ro-crate-metadata.json";

export interface SiteOptions {
  readonly vocabulary: Files;
  readonly layout: Layout;
  readonly build: VocabularyBuild;
  readonly pod: Files;
  /** The lens the site is built under; every other lens the vocabulary offers is shown beside it. */
  readonly lens: string;
  /** The lens `ask` and the GraphDB loader build the pod under when given none. */
  readonly defaultLens: string;
  readonly newStore: StoreFactory;
  /** The pod's title when its manifest gives none, and the GraphDB repository a reader finds it in. */
  readonly name: string;
  /** The time the pod's manifest is written for when the pod has none. */
  readonly at: string;
  /** The command a reader runs, from the runtime's root, to ask the pod a question, less the question. */
  readonly ask: string;
  /** The vocabulary's files on GitHub at the commit the site is built from, `…/blob/<commit>/`: a query links its file there. */
  readonly blob?: string;
  /** The term reference's address from the site's root, before the `#`; without one, a term links nowhere. */
  readonly terms?: string;
  /** The hub's front page's address from the site's root; without one, the site's pages link nowhere back. */
  readonly front?: string;
  /** The spec's pages' folder from the site's root, with its slash; without one, a view names no rule. */
  readonly spec?: string;
  /** The vocabulary's conformance kit the pod was built from, `conformance/<kit>/<kit>.feature`; a pod built from none, or a person's own, has none. */
  readonly kit?: string;
}

/** A step of the build and what it added. */
export interface PipelineStep {
  readonly answer: Answer;
  readonly added: readonly Triple[];
}

/** A file the build writes, the query that wrote it and how many statements it holds. */
export interface BuiltFile {
  readonly answer: Answer;
  readonly statements: number;
}

/** A rule of the spec, by its feature file and its number. */
export interface SpecRule {
  readonly path: string;
  readonly number: string;
  readonly name: string;
}

/** The folder a kind's pages are in, where it is not the kind with an s. */
const FOLDERS: Readonly<Record<string, string>> = { entry: "entries" };
const VIEWS_FOLDER = "views";
const folderOf = (kind: string): string => FOLDERS[kind] ?? `${kind}s`;

/** Each thing's name, the last label the question that names everything gives it. */
function namesOf(called: Answer | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of called?.rows ?? []) {
    const [thing, label] = [row.get("thing"), row.get("label")];
    if (thing !== undefined && label !== undefined)
      names.set(thing.value, label.value);
  }
  return names;
}

/** Each view's rules: those of the runtime's features whose text names the view's file or the query that writes it. */
export async function viewRules(
  vocabulary: Files,
  views: readonly { readonly iri: string; readonly names: readonly string[] }[],
): Promise<Map<string, SpecRule[]>> {
  const found = new Map<string, SpecRule[]>();
  const paths = (await featuresOf(vocabulary))
    .filter((path) => path.startsWith("runtime/"))
    .sort();
  for (const path of paths) {
    for (const rule of (await readWrittenFeature(vocabulary, path)).rules) {
      const number = numberOf(rule);
      if (number === undefined) continue;
      const text = [
        rule.name,
        rule.description,
        ...rule.examples.map(({ text }) => text),
      ].join("\n");
      for (const { iri, names } of views)
        if (names.some((name) => text.includes(name)))
          found.set(iri, [
            ...(found.get(iri) ?? []),
            { path, number, name: rule.name },
          ]);
    }
  }
  return found;
}

/** What every page of the site reads: the pod built under each lens, its questions' answers, and where each thing is. */
export class Site {
  readonly questions: ReadonlyMap<string, Answer>;
  /** Each thing of each kind a question is about that has a page, by kind. */
  readonly things: ReadonlyMap<string, readonly Term[]>;
  readonly views: readonly Term[];
  readonly built: ReadonlyMap<string, BuiltFile>;
  /** A link, by the IRI it is for. */
  readonly #links: readonly ReadonlyMap<string, string>[];
  readonly #pages: ReadonlyMap<string, string>;
  readonly #turtles: ReadonlyMap<string, string>;
  readonly #names: ReadonlyMap<string, string>;

  private constructor(
    readonly options: SiteOptions,
    readonly pod: PodBuild,
    readonly answers: ReadonlyMap<string, ReadonlyMap<string, Answer>>,
    readonly pipeline: ReadonlyMap<string, readonly PipelineStep[]>,
    /** Each term of the vocabulary's own, labelled. */
    readonly labels: ReadonlyMap<string, string>,
    /** The comment of each term of the vocabulary's own that has one. */
    readonly comments: ReadonlyMap<string, string>,
    /** The code systems the vocabulary registers, which label a code. */
    readonly codeSystems: readonly CodeSystem[],
    things: ReadonlyMap<string, readonly Term[]>,
    pages: ReadonlyMap<string, string>,
    storedBytes: ReadonlyMap<string, string>,
    built: ReadonlyMap<string, BuiltFile>,
    views: readonly Term[],
    /** The rules of the spec that name each view, by its IRI; none without the spec's folder. */
    readonly rules: ReadonlyMap<string, readonly SpecRule[]>,
  ) {
    this.questions = answers.get(options.lens) ?? new Map();
    this.things = things;
    this.#pages = pages;
    this.built = built;
    this.views = views;
    const copies = new Map(
      pod.files.map((path) => [pod.address + path, COPY + path]),
    );
    const steps = new Map<string, string>();
    for (const { answer, added } of pipeline.get(options.lens) ?? []) {
      for (const [term] of terms(added)) {
        if (!steps.has(term.value))
          steps.set(term.value, `pipeline.html#${answer.title}`);
      }
    }
    const turtles = new Map<string, string>();
    for (const row of this.question(STATED).rows) {
      const [thing, file] = [row.get("thing"), row.get("file")];
      const copy = copies.get(file?.value ?? "");
      if (
        thing === undefined ||
        copy === undefined ||
        row.get("named")?.value !== "false" ||
        row.get("rebuilt")?.value !== "false" ||
        turtles.has(thing.value)
      )
        continue;
      turtles.set(thing.value, copy);
    }
    this.#turtles = turtles;
    this.#names = namesOf(this.question(CALLED));
    this.#links = [copies, pages, steps, storedBytes, turtles];
  }

  static async build(options: SiteOptions): Promise<Site> {
    const { vocabulary, lens } = options;
    const asked = await questions(vocabulary);
    const offered = await lenses(vocabulary);
    if (!offered.includes(lens))
      throw new Error(`the vocabulary has no lens ${lens}`);
    const order = [lens, ...offered.filter((other) => other !== lens)];
    const builds = new Map<string, PodBuild>();
    for (const each of order) {
      builds.set(
        each,
        await podDataset(
          options.pod,
          options.layout,
          options.build,
          each,
          options.newStore(),
          { title: options.name, at: options.at },
        ),
      );
    }
    const answers = new Map<string, Map<string, Answer>>();
    for (const [each, built] of builds) {
      const answered = new Map<string, Answer>();
      for (const [name, query] of asked) {
        const { variables, rows } = await built.store.select(query.text);
        answered.set(name, new Answer(query, each, variables, rows));
      }
      answers.set(each, answered);
    }
    const pod = builds.get(lens) as PodBuild;
    const read = async (path: string): Promise<VocabularyQuery> => ({
      path,
      text: await readText(vocabulary, path),
    });
    const pipeline = new Map<string, PipelineStep[]>();
    for (const [each, built] of builds) {
      pipeline.set(
        each,
        await Promise.all(
          built.derived.map(async ({ path, added }) => ({
            answer: new Answer(await read(path), each),
            added,
          })),
        ),
      );
    }
    const defaults = answers.get(lens) as Map<string, Answer>;
    const things = thingsWithPages(defaults);
    const placed = options.layout.views.filter(({ file }) =>
      pod.built.has(file ?? ""),
    );
    const views = placed.map(({ file }) => iri(pod.address + (file ?? "")));
    const names = namesOf(defaults.get(CALLED));
    const pages = await addressesOf([
      ...placed.map(({ file = "" }) => ({
        iri: pod.address + file,
        folder: VIEWS_FOLDER,
        name: file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]*$/, ""),
        fallback: "view",
      })),
      ...[...things].flatMap(([kind, of]) =>
        of.map(({ value }) => ({
          iri: value,
          folder: folderOf(kind),
          name: names.get(value) ?? "",
          fallback: kind,
        })),
      ),
    ]);
    const rules =
      options.spec === undefined
        ? new Map<string, SpecRule[]>()
        : await viewRules(
            vocabulary,
            placed.map(({ file = "", writtenBy = "" }) => ({
              iri: pod.address + file,
              names: [file, writtenBy].filter((name) => name !== ""),
            })),
          );
    const storedFolder = options.layout.storedBytes.folder ?? "";
    const storedBytes = new Map<string, string>();
    for (const path of pod.files.filter((path) =>
      path.startsWith(storedFolder),
    )) {
      const bytes = await options.pod.read(path);
      if (bytes !== undefined)
        storedBytes.set(await documentName(bytes), COPY + path);
    }
    const built = new Map<string, BuiltFile>();
    for (const { file, writtenBy } of [...options.layout.built].sort((a, b) =>
      (a.file ?? "") < (b.file ?? "") ? -1 : 1,
    )) {
      if (file === undefined || writtenBy === undefined || !pod.built.has(file))
        continue;
      built.set(pod.address + file, {
        answer: new Answer(await read(QUERIES + writtenBy), lens),
        statements: new Set(
          (pod.built.get(file) ?? []).map((triple) =>
            triple.map(written).join(" "),
          ),
        ).size,
      });
    }
    const { labels, comments } = await vocabularyLabels(
      vocabulary,
      options.newStore,
      asked.get(CALLED),
    );
    return new Site(
      options,
      pod,
      answers,
      pipeline,
      labels,
      comments,
      (await tableTerms(vocabulary, options.newStore)).codeSystems,
      things,
      pages,
      storedBytes,
      built,
      views,
      rules,
    );
  }

  question(name: string): Answer {
    const found = this.questions.get(name);
    if (found === undefined)
      throw new Error(
        `the vocabulary has no question ${name}, which the site shows`,
      );
    return found;
  }

  /** Where a link to the thing goes: its copy in the site, its page, the step that writes it, or the file it arrived in. */
  href(thing: Term): string | undefined {
    for (const links of this.#links) {
      const found = links.get(thing.value);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  page(thing: Term): string | undefined {
    return this.#pages.get(thing.value);
  }

  turtle(thing: Term): string | undefined {
    return this.#turtles.get(thing.value);
  }

  /** The name the labels give the thing, or its IRI. */
  name(thing: Term): string {
    return this.#names.get(thing.value) ?? thing.value;
  }

  /** What a page that lists the thing calls it: its name, or for a view its file. */
  label(thing: Term): string {
    return (
      this.#names.get(thing.value) ??
      (thing.value.startsWith(this.pod.address)
        ? thing.value.slice(this.pod.address.length)
        : thing.value)
    );
  }

  /** Which files state the thing, then each question of its kind, with only the rows about it. */
  about(thing: Term, kind?: string): Answer[] {
    return [
      this.question(STATED).of("thing", thing),
      ...(kind === undefined
        ? []
        : [...this.questions]
            .filter(([name]) => name.startsWith(`${kind}/`))
            .map(([, answer]) => answer.of(kind, thing))),
    ];
  }

  get derivedGraph(): string {
    return DERIVED + this.options.lens;
  }

  /** Every file of the site, by its path: the pages, the stylesheet and a copy of each file of the pod. */
  async files(): Promise<Map<string, Uint8Array>> {
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>();
    for (const [path, page] of pages(this))
      files.set(path, encoder.encode(page.text));
    files.set(STYLESHEET_FILE, encoder.encode(STYLESHEET));
    for (const [path, bytes] of await explorerFiles(this))
      files.set(path, bytes);
    for (const path of this.pod.files) {
      const rebuilt = this.pod.built.get(path);
      const bytes =
        rebuilt === undefined
          ? await this.options.pod.read(path)
          : builtFileBytes(
              this.options.layout,
              this.pod.address,
              path,
              rebuilt,
            );
      if (bytes !== undefined) files.set(COPY + path, bytes);
    }
    return files;
  }
}

function thingsWithPages(
  answers: ReadonlyMap<string, Answer>,
): Map<string, Term[]> {
  const kinds = [
    ...new Set([...answers.keys()].map((name) => name.split("/")[0] ?? "")),
  ]
    .filter((kind) => kind !== "pod")
    .sort();
  return new Map(
    kinds.map((kind) => {
      const found = new Map<string, Term>();
      for (const [name, answer] of answers) {
        if (!name.startsWith(`${kind}/`)) continue;
        for (const row of answer.rows) {
          const thing = row.get(kind);
          if (thing?.termType === "NamedNode" && !found.has(thing.value))
            found.set(thing.value, thing);
        }
      }
      return [kind, [...found.values()]];
    }),
  );
}

interface CrateEntity {
  readonly "@id"?: string;
  readonly about?: { readonly "@id"?: string };
}

/** The labels the vocabulary's own ontologies give their terms, read with the question that names everything, and their comments. */
async function vocabularyLabels(
  vocabulary: Files,
  newStore: StoreFactory,
  called: VocabularyQuery | undefined,
): Promise<{
  labels: Map<string, string>;
  comments: Map<string, string>;
}> {
  if (called === undefined)
    throw new Error(`the vocabulary has no question ${CALLED}`);
  const { "@graph": graph } = JSON.parse(await readText(vocabulary, CRATE)) as {
    "@graph": readonly CrateEntity[];
  };
  const ontologies = new Union(newStore());
  for (const { "@id": path, about } of graph) {
    if (
      path === undefined ||
      !path.startsWith("ontologies/") ||
      path.endsWith(".shapes.ttl") ||
      about?.["@id"] === undefined
    )
      continue;
    await ontologies.loadTurtle(await readText(vocabulary, path), about["@id"]);
  }
  const { rows } = await ontologies.select(called.text);
  const { rows: described } = await ontologies.select(
    `SELECT ?thing WHERE { ?thing a <http://www.w3.org/2002/07/owl#Ontology> }`,
  );
  const ontologyIris = new Set(described.map((row) => row.get("thing")?.value));
  const labels = new Map<string, string>();
  for (const row of rows) {
    const [thing, label] = [row.get("thing"), row.get("label")];
    if (
      thing !== undefined &&
      label !== undefined &&
      !ontologyIris.has(thing.value) &&
      !labels.has(thing.value)
    )
      labels.set(thing.value, label.value);
  }
  const comments = new Map<string, string>();
  const { rows: commented } = await ontologies.select(
    `SELECT ?thing ?comment WHERE { ?thing <http://www.w3.org/2000/01/rdf-schema#comment> ?comment }`,
  );
  for (const row of commented) {
    const [thing, comment] = [row.get("thing"), row.get("comment")];
    if (
      thing !== undefined &&
      comment !== undefined &&
      !ontologyIris.has(thing.value) &&
      !comments.has(thing.value)
    )
      comments.set(thing.value, comment.value);
  }
  return { labels, comments };
}
