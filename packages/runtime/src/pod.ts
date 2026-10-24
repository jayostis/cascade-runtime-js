import { type Files, writeAll } from "./files.js";
import { ntriples, type Triple } from "./rdf.js";

export function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** An act's description, which its step writes last, with what `finish` adds to it. */
export interface Act {
  /** The act's IRI. */
  readonly name: string;
  /** The path of its file. */
  readonly path: string;
  readonly triples: readonly Triple[];
}

/**
 * Given the act and every other file its step writes new to the pod, each path with its bytes, what the act's file
 * holds beside the act's description: the runtime that performed it and its snapshot (N7, N14).
 */
export type FinishAct = (
  act: Act,
  fresh: readonly (readonly [string, Uint8Array])[],
) => Promise<readonly Triple[]>;

/**
 * The files one step writes, held until the step finishes, then written in the order they were given, and the act's
 * file last (W1): a step that fails writes nothing. No file, once written, changes.
 */
export class StepWrites {
  readonly #files = new Map<string, Uint8Array>();
  #act: Act | undefined;

  add(path: string, bytes: Uint8Array): void {
    if (path === this.#act?.path)
      throw new Error(`${path} is the act's file, written last`);
    const held = this.#files.get(path);
    if (held !== undefined && !same(held, bytes))
      throw new Error(`${path} would be written twice with different bytes`);
    this.#files.set(path, bytes);
  }

  /** The step's act, described by the triples, which its file holds with what `commit`'s `finish` adds. */
  act(act: Act): void {
    if (this.#act !== undefined)
      throw new Error(
        `a step performs one act, not ${this.#act.name} and ${act.name}`,
      );
    if (this.#files.has(act.path))
      throw new Error(`${act.path} is the act's file, written last`);
    this.#act = act;
  }

  /** How many files the step writes besides its act's. */
  get size(): number {
    return this.#files.size;
  }

  /**
   * Writes each file the pod lacks, the act's last, in one `writeAll`, and returns their paths; a file the pod holds
   * with other bytes is refused.
   */
  async commit(pod: Files, finish?: FinishAct): Promise<string[]> {
    const fresh: [string, Uint8Array][] = [];
    for (const [path, bytes] of this.#files) {
      const held = await pod.read(path);
      if (held === undefined) fresh.push([path, bytes]);
      else if (!same(held, bytes))
        throw new Error(`${path} is in the pod already, holding other bytes`);
    }
    const act = this.#act;
    if (act !== undefined) {
      if ((await pod.read(act.path)) !== undefined)
        throw new Error(`${act.path} is in the pod already`);
      const finished = (await finish?.(act, [...fresh])) ?? [];
      fresh.push([act.path, ntriples([...act.triples, ...finished])]);
    }
    await writeAll(pod, fresh);
    return fresh.map(([path]) => path);
  }
}
