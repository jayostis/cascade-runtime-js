import {
  type Bridge,
  BridgeError,
  type BridgeDocument,
  type BridgeErrorKind,
  type Conversion,
  type ConvertOptions,
  type Description,
  type Format,
  isBridgeError,
  type LoadedAdapter,
  type Named,
} from "./bridge.js";

/** What the runtime uses of the cascade-bridge-rs package, once its module is instantiated. */
export interface BridgePackage {
  describe(
    adapterIri: string,
    metadata: Uint8Array,
    format?: Format,
  ): Description;
  readonly Adapter: {
    load(
      adapter: { iri: string; files: Map<string, Uint8Array> },
      vocabulary?: { iri: string; files: Map<string, Uint8Array> },
    ): PackageAdapter;
  };
}

interface PackageAdapter {
  accepts(document: BridgeDocument): boolean;
  convert(document: BridgeDocument, options?: ConvertOptions): Conversion;
  free(): void;
}

/** The package's glue module, before its WebAssembly module is instantiated. */
export interface BridgeGlue extends BridgePackage {
  initSync(module: { module: WebAssembly.Module }): unknown;
}

/** Where a Bridge instance is made from: the URL of the package's glue module and its module, compiled once. */
export interface CompiledBridge {
  readonly glue: string;
  readonly module: WebAssembly.Module;
}

export type Request =
  | {
      readonly op: "describe";
      readonly adapterIri: string;
      readonly metadata: Uint8Array;
      readonly format?: Format;
    }
  | {
      readonly op: "load";
      readonly adapter: Named;
      readonly vocabulary?: Named;
    }
  | { readonly op: "accepts"; readonly document: BridgeDocument }
  | {
      readonly op: "convert";
      readonly document: BridgeDocument;
      readonly options?: ConvertOptions;
    }
  | { readonly op: "free" };

export interface Failure {
  readonly name: string;
  readonly message: string;
  readonly kind?: BridgeErrorKind;
  readonly map?: "adapter" | "vocabulary";
  readonly path?: string;
}

export type Reply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: Failure };

/** A reply and the buffers that cross with it. */
export interface Answer {
  readonly reply: Reply;
  readonly transfer: ArrayBuffer[];
}

function buffers(...arrays: (Uint8Array | undefined)[]): ArrayBuffer[] {
  return arrays.flatMap((array) =>
    array?.buffer instanceof ArrayBuffer ? [array.buffer] : [],
  );
}

function failure(error: unknown): Failure {
  if (isBridgeError(error)) {
    const { map, path } = error as { map?: Failure["map"]; path?: string };
    return {
      name: error.name,
      message: error.message,
      kind: error.kind,
      map,
      path,
    };
  }
  if (error instanceof WebAssembly.RuntimeError)
    return { name: "BridgeError", message: error.message, kind: "bridge" };
  if (error instanceof Error)
    return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

/** Whether the instance that failed so is spoiled, and must be thrown away. */
function isFault(failure: Failure): boolean {
  return failure.kind === "bridge";
}

/**
 * The body of a Bridge instance, in a worker or in the main thread: it answers each request on one package instance,
 * holding at most one loaded adapter.
 */
export function serving(bridge: BridgePackage): (request: Request) => Answer {
  let adapter: PackageAdapter | undefined;
  const loaded = (): PackageAdapter => {
    if (adapter === undefined)
      throw new BridgeError("bridge", "no adapter is loaded");
    return adapter;
  };
  const perform = (request: Request): Answer => {
    switch (request.op) {
      case "describe": {
        const value = bridge.describe(
          request.adapterIri,
          request.metadata,
          request.format,
        );
        return { reply: { ok: true, value }, transfer: buffers(value.graph) };
      }
      case "load":
        adapter?.free();
        adapter = undefined;
        adapter = bridge.Adapter.load(
          { iri: request.adapter.iri, files: new Map(request.adapter.files) },
          request.vocabulary && {
            iri: request.vocabulary.iri,
            files: new Map(request.vocabulary.files),
          },
        );
        return { reply: { ok: true, value: undefined }, transfer: [] };
      case "accepts":
        return {
          reply: { ok: true, value: loaded().accepts(request.document) },
          transfer: [],
        };
      case "convert": {
        const value = loaded().convert(request.document, request.options);
        return {
          reply: { ok: true, value },
          transfer: buffers(value.graph, value.findings),
        };
      }
      case "free":
        adapter?.free();
        adapter = undefined;
        return { reply: { ok: true, value: undefined }, transfer: [] };
    }
  };
  return (request) => {
    try {
      return perform(request);
    } catch (error) {
      return { reply: { ok: false, failure: failure(error) }, transfer: [] };
    }
  };
}

/** One Bridge instance, in a worker or in the main thread. */
export interface Channel {
  /** The reply; it rejects only when the instance itself is lost, as when its worker dies. */
  call(request: Request, transfer: ArrayBuffer[]): Promise<Reply>;
  /** Ends the instance; no call is made on it after. */
  end(): void;
}

/** Starts a new Bridge instance. */
export type Spawn = () => Promise<Channel>;

/** A fresh instance in the main thread: the glue module is imported anew, so a spoiled one is never reused. */
export function inThread(compiled: CompiledBridge): Spawn {
  let instances = 0;
  return async () => {
    const glue = new URL(compiled.glue);
    glue.searchParams.set("instance", String(++instances));
    const bridge = (await import(glue.href)) as BridgeGlue;
    bridge.initSync({ module: compiled.module });
    const serve = serving(bridge);
    return {
      call: (request) => Promise.resolve(serve(request).reply),
      end: () => void serve({ op: "free" }),
    };
  };
}

function thrown(failure: Failure): Error {
  if (failure.kind !== undefined)
    return new BridgeError(
      failure.kind,
      failure.message,
      failure.map,
      failure.path,
    );
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}

function copied(bytes: Uint8Array, transfer: ArrayBuffer[]): Uint8Array {
  const copy = bytes.slice();
  transfer.push(copy.buffer);
  return copy;
}

function copiedNamed(named: Named, transfer: ArrayBuffer[]): Named {
  return {
    iri: named.iri,
    files: new Map(
      [...named.files].map(([path, bytes]) => [path, copied(bytes, transfer)]),
    ),
  };
}

function copiedDocument(
  document: BridgeDocument,
  transfer: ArrayBuffer[],
): BridgeDocument {
  return {
    ...document,
    bytes: copied(document.bytes, transfer),
    ...(document.facts && {
      facts: {
        iri: document.facts.iri,
        bytes: copied(document.facts.bytes, transfer),
      },
    }),
  };
}

/**
 * One instance at a time, started when first needed. A fault ends it, and the next call starts another, loading the
 * adapter in it again first.
 */
class Instance {
  #channel: Promise<Channel> | undefined;

  constructor(
    readonly spawn: Spawn,
    readonly load?: { adapter: Named; vocabulary?: Named },
  ) {}

  async call(make: (transfer: ArrayBuffer[]) => Request): Promise<unknown> {
    const started = this.#started();
    const channel = await started;
    const transfer: ArrayBuffer[] = [];
    let reply: Reply;
    try {
      reply = await channel.call(make(transfer), transfer);
    } catch (error) {
      this.#ended(started, channel);
      throw new BridgeError(
        "bridge",
        `the Bridge's instance was lost: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (reply.ok) return reply.value;
    if (isFault(reply.failure)) this.#ended(started, channel);
    throw thrown(reply.failure);
  }

  /** Starts the instance, loading the adapter in it, unless it is running. */
  async started(): Promise<void> {
    await this.#started();
  }

  end(): void {
    const channel = this.#channel;
    this.#channel = undefined;
    void channel?.then((started) => started.end()).catch(() => undefined);
  }

  #ended(started: Promise<Channel>, channel: Channel): void {
    channel.end();
    if (this.#channel === started) this.#channel = undefined;
  }

  #started(): Promise<Channel> {
    if (this.#channel === undefined) {
      const channel = this.#start();
      channel.catch(() => {
        if (this.#channel === channel) this.#channel = undefined;
      });
      this.#channel = channel;
    }
    return this.#channel;
  }

  async #start(): Promise<Channel> {
    const channel = await this.spawn();
    if (this.load === undefined) return channel;
    const { adapter, vocabulary } = this.load;
    const transfer: ArrayBuffer[] = [];
    let reply: Reply;
    try {
      reply = await channel.call(
        {
          op: "load",
          adapter: copiedNamed(adapter, transfer),
          ...(vocabulary && { vocabulary: copiedNamed(vocabulary, transfer) }),
        },
        transfer,
      );
    } catch (error) {
      channel.end();
      throw new BridgeError(
        "bridge",
        `the Bridge's instance was lost: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (reply.ok) return channel;
    channel.end();
    throw thrown(reply.failure);
  }
}

/**
 * The Bridge on cascade-bridge-rs's WebAssembly package, each loaded adapter in an instance of its own: a worker, or
 * the main thread when `spawn` is `inThread`. Bytes cross to a worker by transfer, the caller's own left as they were.
 */
export class WasmBridge implements Bridge {
  readonly #describer: Instance;

  constructor(readonly spawn: Spawn) {
    this.#describer = new Instance(spawn);
  }

  async describe(
    adapterIri: string,
    metadata: Uint8Array,
    format?: Format,
  ): Promise<Description> {
    return (await this.#describer.call((transfer) => ({
      op: "describe",
      adapterIri,
      metadata: copied(metadata, transfer),
      ...(format && { format }),
    }))) as Description;
  }

  async load(adapter: Named, vocabulary?: Named): Promise<LoadedAdapter> {
    const instance = new Instance(this.spawn, { adapter, vocabulary });
    await instance.started();
    return {
      accepts: async (document) =>
        (await instance.call((transfer) => ({
          op: "accepts",
          document: copiedDocument(document, transfer),
        }))) as boolean,
      convert: async (document, options) =>
        (await instance.call((transfer) => ({
          op: "convert",
          document: copiedDocument(document, transfer),
          ...(options && { options }),
        }))) as Conversion,
      free: () => {
        instance.end();
        return Promise.resolve();
      },
    };
  }

  /** Ends the instance that describes adapters; a later describe starts another. */
  close(): void {
    this.#describer.end();
  }
}

/** The calls a worker has not yet answered, each by its number. */
export class Waiting {
  #next = 0;
  readonly #calls = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: unknown) => void }
  >();

  get size(): number {
    return this.#calls.size;
  }

  /** Numbers the request, has `post` send it, and waits for its reply. */
  send(
    post: (message: { id: number; request: Request }) => void,
    request: Request,
  ): Promise<Reply> {
    const id = this.#next++;
    return new Promise<Reply>((resolve, reject) => {
      this.#calls.set(id, { resolve, reject });
      try {
        post({ id, request });
      } catch (error) {
        this.#calls.delete(id);
        reject(error);
      }
    });
  }

  answered({ id, reply }: { id: number; reply: Reply }): void {
    const call = this.#calls.get(id);
    this.#calls.delete(id);
    call?.resolve(reply);
  }

  /** Every call still waiting fails: the worker is gone. */
  lost(error: unknown): void {
    for (const call of this.#calls.values()) call.reject(error);
    this.#calls.clear();
  }
}
