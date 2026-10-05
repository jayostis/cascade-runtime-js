import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const REPOSITORY_ID = /<tag:rdf4j\.org,2023:config\/rep\.id> "([^"]*)"/;

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Answers the loader as a GraphDB does: a repository by its ID, statements into it by graph, workbench-wide saved
 * queries whose names POST refuses twice and PUT replaces by the oldQueryName it is given, and a query of a repository
 * answered with the rows it is told to give.
 */
export class FakeGraphDB {
  readonly repositories = new Set<string>();
  saved = new Map<string, string>();
  /** Each graph posted, by its IRI, as the N-Triples posted. */
  readonly graphs = new Map<string, string>();
  readonly asked: string[] = [];
  refuseStatementsAfter: number | undefined;
  answer = {
    head: { vars: [] as string[] },
    results: { bindings: [] as object[] },
  };
  #statements = 0;
  readonly #server: Server;

  private constructor(server: Server) {
    this.#server = server;
  }

  static async start(): Promise<FakeGraphDB> {
    const server = createServer();
    const fake = new FakeGraphDB(server);
    server.on("request", (request, response) => {
      void fake.#handle(request).then(([status, body, type]) => {
        response.writeHead(status, { "Content-Type": type });
        response.end(body);
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return fake;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    return new Promise((done) => this.#server.close(() => done()));
  }

  async #handle(request: IncomingMessage): Promise<[number, string, string]> {
    const url = new URL(request.url ?? "/", this.url);
    const body = await bodyOf(request);
    const [, first, id, rest] = url.pathname.split("/");
    const json = (value: unknown): [number, string, string] => [
      200,
      JSON.stringify(value),
      "application/json",
    ];
    const held =
      id !== undefined && this.repositories.has(decodeURIComponent(id));
    switch (`${request.method} ${url.pathname}`) {
      case "GET /rest/repositories":
        return json([...this.repositories].map((id) => ({ id })));
      case "POST /rest/repositories": {
        const found = REPOSITORY_ID.exec(body)?.[1];
        if (found === undefined) return [400, "no rep.id", "text/plain"];
        this.repositories.add(found);
        return [201, "", "text/plain"];
      }
      case "GET /rest/sparql/saved-queries":
        return json([...this.saved].map(([name, body]) => ({ name, body })));
      case "POST /rest/sparql/saved-queries": {
        const { name, body: query } = JSON.parse(body) as Record<
          string,
          string
        >;
        if (this.saved.has(name ?? ""))
          return [400, `Query '${name}' already exists`, "text/plain"];
        this.saved.set(name ?? "", query ?? "");
        return [201, "", "text/plain"];
      }
      case "PUT /rest/sparql/saved-queries": {
        const old = url.searchParams.get("oldQueryName");
        if (old === null || !this.saved.has(old))
          return [404, "", "text/plain"];
        const { name, body: query } = JSON.parse(body) as Record<
          string,
          string
        >;
        this.saved.delete(old);
        this.saved.set(name ?? "", query ?? "");
        return [200, "", "text/plain"];
      }
    }
    if (request.method === "DELETE" && first === "rest" && rest !== undefined) {
      const repository = decodeURIComponent(
        url.pathname.split("/").at(-1) ?? "",
      );
      if (!this.repositories.delete(repository)) return [404, "", "text/plain"];
      this.#statements = 0;
      return [200, "", "text/plain"];
    }
    if (first !== "repositories" || !held) return [404, "", "text/plain"];
    if (request.method === "POST" && rest === "statements") {
      if (
        this.refuseStatementsAfter !== undefined &&
        this.#statements >= this.refuseStatementsAfter
      )
        return [500, "refused", "text/plain"];
      this.#statements += 1;
      this.graphs.set(
        (url.searchParams.get("context") ?? "").replace(/^<|>$/g, ""),
        body,
      );
      return [204, "", "text/plain"];
    }
    if (request.method === "GET" && rest === "size")
      return [200, String(this.#statements), "text/plain"];
    if (request.method === "POST" && rest === undefined) {
      this.asked.push(new URLSearchParams(body).get("query") ?? "");
      return [
        200,
        JSON.stringify(this.answer),
        "application/sparql-results+json",
      ];
    }
    return [404, "", "text/plain"];
  }
}
