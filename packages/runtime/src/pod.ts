import type { Files } from "./files.js";

export function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * The files one step writes, held until the step finishes, then written in the order they were given: a step that
 * fails writes nothing. No file, once written, changes.
 */
export class StepWrites {
  readonly #files = new Map<string, Uint8Array>();

  add(path: string, bytes: Uint8Array): void {
    const held = this.#files.get(path);
    if (held !== undefined && !same(held, bytes))
      throw new Error(`${path} would be written twice with different bytes`);
    this.#files.set(path, bytes);
  }

  /** Writes each file the pod lacks and returns their paths; a file the pod holds with other bytes is refused. */
  async commit(pod: Files): Promise<string[]> {
    const fresh: [string, Uint8Array][] = [];
    for (const [path, bytes] of this.#files) {
      const held = await pod.read(path);
      if (held === undefined) fresh.push([path, bytes]);
      else if (!same(held, bytes))
        throw new Error(`${path} is in the pod already, holding other bytes`);
    }
    for (const [path, bytes] of fresh) await pod.write(path, bytes);
    return fresh.map(([path]) => path);
  }
}
