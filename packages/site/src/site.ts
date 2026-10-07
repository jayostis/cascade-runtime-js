import {
  DERIVED,
  documentName,
  type Files,
  iri,
  type Layout,
  lenses,
  ntriples,
  QUERIES,
  type PodBuild,
  podDataset,
  questions,
  readText,
  type StoreFactory,
  type Term,
  type Triple,
  type VocabularyBuild,
  type VocabularyQuery,
  written,
} from "@cascade-runtime/runtime";
import { Answer } from "./answer.js";
import { pages } from "./pages.js";
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

async function pageOf(thing: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(thing),
  );
  return `${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.html`;
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
    things: ReadonlyMap<string, readonly Term[]>,
    pages: ReadonlyMap<string, string>,
    storedBytes: ReadonlyMap<string, string>,
    built: ReadonlyMap<string, BuiltFile>,
    views: readonly Term[],
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
    const names = new Map<string, string>();
    for (const row of this.question(CALLED).rows) {
      const [thing, label] = [row.get("thing"), row.get("label")];
      if (thing !== undefined && label !== undefined)
        names.set(thing.value, label.value);
    }
    this.#names = names;
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
    const views = options.layout.views
      .filter(({ file }) => pod.built.has(file ?? ""))
      .map(({ file }) => iri(pod.address + (file ?? "")));
    const pages = new Map<string, string>();
    for (const thing of [...[...things.values()].flat(), ...views]) {
      pages.set(thing.value, await pageOf(thing.value));
    }
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
    return new Site(
      options,
      pod,
      answers,
      pipeline,
      await vocabularyLabels(vocabulary, options.newStore, asked.get(CALLED)),
      things,
      pages,
      storedBytes,
      built,
      views,
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
    for (const path of this.pod.files) {
      const rebuilt = this.pod.built.get(path);
      const bytes =
        rebuilt === undefined
          ? await this.options.pod.read(path)
          : ntriples(rebuilt);
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

/** The labels the vocabulary's own ontologies give their terms, read with the question that names everything. */
async function vocabularyLabels(
  vocabulary: Files,
  newStore: StoreFactory,
  called: VocabularyQuery | undefined,
): Promise<Map<string, string>> {
  if (called === undefined)
    throw new Error(`the vocabulary has no question ${CALLED}`);
  const { "@graph": graph } = JSON.parse(await readText(vocabulary, CRATE)) as {
    "@graph": readonly CrateEntity[];
  };
  const store = newStore();
  for (const { "@id": path, about } of graph) {
    if (
      path === undefined ||
      !path.startsWith("ontologies/") ||
      path.endsWith(".shapes.ttl") ||
      about?.["@id"] === undefined
    )
      continue;
    await store.loadTurtle(await readText(vocabulary, path), {
      graph: about["@id"],
    });
  }
  const { rows } = await store.select(called.text);
  const labels = new Map<string, string>();
  for (const row of rows) {
    const [thing, label] = [row.get("thing"), row.get("label")];
    if (thing !== undefined && label !== undefined && !labels.has(thing.value))
      labels.set(thing.value, label.value);
  }
  return labels;
}
