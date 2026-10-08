import {
  blank,
  type Dataset,
  iri,
  literal,
  ntriples,
  parseResults,
  RDF,
  type Rows,
  type Term,
  type Triple,
  type VocabularyQuery,
} from "@cascade-runtime/runtime";

const CONFIG = "tag:rdf4j.org,2023:config/";
const GRAPHDB = "http://www.ontotext.com/config/graphdb#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const JSON_TYPE = "application/json";

/** GraphDB answered with an error, or did not answer. */
export class GraphDBRefusal extends Error {}

/** The repository's configuration: a plain store, with no inference and no owl:sameAs. */
export function configuration(id: string, title: string): Uint8Array {
  const repository = blank("repository");
  const implementation = blank("implementation");
  const sail = blank("sail");
  return ntriples([
    [repository, iri(`${RDF}type`), iri(`${CONFIG}Repository`)],
    [repository, iri(`${CONFIG}rep.id`), literal(id)],
    [repository, iri(`${RDFS}label`), literal(title)],
    [repository, iri(`${CONFIG}rep.impl`), implementation],
    [
      implementation,
      iri(`${CONFIG}rep.type`),
      literal("graphdb:SailRepository"),
    ],
    [implementation, iri(`${CONFIG}sail.impl`), sail],
    [sail, iri(`${CONFIG}sail.type`), literal("graphdb:Sail")],
    [sail, iri(`${GRAPHDB}ruleset`), literal("empty")],
    [sail, iri(`${GRAPHDB}disable-sameAs`), literal("true")],
  ]);
}

/** Each named graph of the store, with its triples. */
export async function graphsOf(
  store: Dataset,
): Promise<Map<string, readonly Triple[]>> {
  const { rows } = await store.select(
    "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }",
  );
  const graphs = new Map<string, Triple[]>();
  for (const row of rows) {
    const [g, s, p, o] = ["g", "s", "p", "o"].map((name) => row.get(name)) as (
      Term | undefined
    )[];
    if (
      g === undefined ||
      s === undefined ||
      s.termType === "Literal" ||
      p?.termType !== "NamedNode" ||
      o === undefined
    )
      throw new Error("a quad of the store lacks a term");
    const triples = graphs.get(g.value) ?? [];
    triples.push([s, p, o]);
    graphs.set(g.value, triples);
  }
  return new Map([...graphs].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** What a load put in the repository. */
export interface Loaded {
  readonly graphs: number;
  /** The repository's size, as GraphDB says it. */
  readonly statements: string;
  readonly saved: readonly string[];
}

/** One repository of a GraphDB, by the server's base URL and the repository's ID. */
export class GraphDB {
  readonly base: string;
  readonly repository: string;

  constructor(
    base: string,
    readonly id: string,
  ) {
    this.base = base.replace(/\/+$/, "");
    this.repository = `${this.base}/repositories/${encodeURIComponent(id)}`;
  }

  async #request(
    method: string,
    url: string,
    body?: Uint8Array | string,
    contentType?: string,
    accept?: string,
  ): Promise<string> {
    const headers: Record<string, string> = {};
    if (contentType !== undefined) headers["Content-Type"] = contentType;
    if (accept !== undefined) headers.Accept = accept;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: body as BodyInit }),
      });
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause?.message;
      throw new GraphDBRefusal(
        `${url} gave no answer: ${cause ?? String(error)}`,
      );
    }
    const text = await response.text();
    if (!response.ok)
      throw new GraphDBRefusal(`${url} answered ${response.status}: ${text}`);
    return text;
  }

  async holdsRepository(): Promise<boolean> {
    const listed = JSON.parse(
      await this.#request(
        "GET",
        `${this.base}/rest/repositories`,
        undefined,
        undefined,
        JSON_TYPE,
      ),
    ) as { id: string }[];
    return listed.some(({ id }) => id === this.id);
  }

  async create(title: string): Promise<void> {
    const boundary = globalThis.crypto.randomUUID().replaceAll("-", "");
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="config"; filename="repository.ttl"\r\n` +
        "Content-Type: text/turtle\r\n\r\n",
    );
    const config = configuration(this.id, title);
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + config.length + tail.length);
    body.set(head);
    body.set(config, head.length);
    body.set(tail, head.length + config.length);
    await this.#request(
      "POST",
      `${this.base}/rest/repositories`,
      body,
      `multipart/form-data; boundary=${boundary}`,
    );
  }

  async delete(): Promise<void> {
    await this.#request(
      "DELETE",
      `${this.base}/rest/repositories/${encodeURIComponent(this.id)}`,
    );
  }

  /** Puts each named graph of the store in the repository as a graph of its own, and saves each question by its name. */
  async fill(
    store: Dataset,
    questions: ReadonlyMap<string, VocabularyQuery>,
  ): Promise<Loaded> {
    const graphs = await graphsOf(store);
    for (const [graph, triples] of graphs) {
      await this.#request(
        "POST",
        `${this.repository}/statements?context=${encodeURIComponent(`<${graph}>`)}`,
        ntriples(triples),
        "application/n-triples",
      );
    }
    const saved = await this.#save(questions);
    const statements = (
      await this.#request("GET", `${this.repository}/size`)
    ).trim();
    return { graphs: graphs.size, statements, saved };
  }

  async #save(
    questions: ReadonlyMap<string, VocabularyQuery>,
  ): Promise<string[]> {
    const queries = `${this.base}/rest/sparql/saved-queries`;
    const held = new Set(
      (
        JSON.parse(
          await this.#request("GET", queries, undefined, undefined, JSON_TYPE),
        ) as { name: string }[]
      ).map(({ name }) => name),
    );
    const saved: string[] = [];
    for (const [name, { text }] of questions) {
      const body = JSON.stringify({ name, body: text, shared: true });
      if (held.has(name)) {
        await this.#request(
          "PUT",
          `${queries}?${new URLSearchParams({ oldQueryName: name }).toString()}`,
          body,
          JSON_TYPE,
        );
      } else {
        await this.#request("POST", queries, body, JSON_TYPE);
      }
      saved.push(name);
    }
    return saved;
  }

  /** The rows, or the boolean, the query answers over the repository. */
  async ask(query: string): Promise<Rows | boolean> {
    return parseResults(
      await this.#request(
        "POST",
        this.repository,
        new URLSearchParams({ query }).toString(),
        "application/x-www-form-urlencoded",
        "application/sparql-results+json",
      ),
    );
  }
}

/**
 * Creates the repository, fills it with every named graph of the store and saves every question; a load that fails
 * after creating the repository removes it again, so a rerun can load. A server that already holds the repository is
 * left as it is.
 */
export async function load(
  graphdb: GraphDB,
  title: string,
  store: Dataset,
  questions: ReadonlyMap<string, VocabularyQuery>,
  log: (line: string) => void = () => {},
): Promise<Loaded> {
  if (await graphdb.holdsRepository()) {
    throw new GraphDBRefusal(
      `${graphdb.base} already has a repository ${graphdb.id}; nothing changed`,
    );
  }
  await graphdb.create(title);
  try {
    return await graphdb.fill(store, questions);
  } catch (error) {
    try {
      await graphdb.delete();
      log(`removed the repository ${graphdb.id} it had created`);
    } catch (cleanup) {
      log(
        `could not remove the repository ${graphdb.id} it had created: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
      );
    }
    throw error;
  }
}
