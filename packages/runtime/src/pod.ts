import { type Files, writeAll, writeEach } from "./files.js";
import { counted, timedAside } from "./probe.js";
import { ntriples, type Triple } from "./rdf.js";

/** Files that hold the pod's listing, so which of the paths they lack is answered from it, with no read of each. */
export interface ListedFiles extends Files {
  /**
   * The paths of those given that the pod's listing lacks and that are not held: a file that reached the pod after
   * the listing is not found, so it is asked only of files whose name fixes their bytes (`FixedByName`).
   */
  lacking(paths: readonly string[]): Promise<ReadonlySet<string>>;
}

function lists(pod: Files): pod is ListedFiles {
  return typeof (pod as Partial<ListedFiles>).lacking === "function";
}

export function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * The families of files a step writes whose name fixes their bytes, so a file of one that reached the pod after the pod's
 * listing was taken holds the bytes the step would write, and a commit that finds the listing without one writes it with
 * no read. Every family not named here is read as before, because another session may have written other bytes to the
 * same name since the listing, which a read refuses and a write over would not:
 * - `version`: a version of a record or of a reference series, named by its content (a content-addressed `ni:` stem).
 * - `revision`: a revision, named by its content.
 * - `finding`, `findingForReview`: a finding, named by its triples (cascade:FindingNamingRule).
 * - `storedDocument`: a document's stored bytes, named by their hash.
 * - `serverRecord`: a server's or an organization's record, named by the one address it describes, with the triples
 *   that address gives it.
 * - `matcherJudgment`, `matcherJudgmentAssertion`: named by the rule, the members and the rule list they come from.
 * - `releaseRetraction`: named by the release it retracts.
 * Not named, so read: the pod's creation files (the subject, the card, the preferences, the type index), an import's
 * description, a record's own file (named by source identifiers, not by its content), a reference series' and a
 * matcher's description, a person's judgment, and every file that arrives from another writer.
 */
export type FixedByName =
  | "version"
  | "revision"
  | "finding"
  | "findingForReview"
  | "storedDocument"
  | "serverRecord"
  | "matcherJudgment"
  | "matcherJudgmentAssertion"
  | "releaseRetraction";

/** An act's description, which its step writes last, with what `finish` adds to it. */
export interface Act {
  /** The act's IRI. */
  readonly name: string;
  /** The path of its file. */
  readonly path: string;
  readonly triples: readonly Triple[];
}

/**
 * Given the act and every other file its step writes new to the pod, each path with its bytes, and those of them that
 * arrived from another writer, what the act's file holds beside the act's description: the runtime that performed it
 * and its snapshot (N7, N14).
 */
export type FinishAct = (
  act: Act,
  fresh: readonly (readonly [string, Uint8Array])[],
  arrived: ReadonlySet<string>,
) => Promise<readonly Triple[]>;

/**
 * The files one step writes, held until the step finishes, then written in the order they were given, and the act's
 * file last (W1): a step that fails writes nothing. No file, once written, changes.
 */
export class StepWrites {
  readonly #files = new Map<string, Uint8Array>();
  readonly #arrived = new Set<string>();
  readonly #waves = new Map<string, number>();
  readonly #fixed = new Set<string>();
  #act: Act | undefined;
  #committed: readonly string[] = [];

  /** Every file `commit` wrote, those that arrived from another writer and the act's among them. */
  get committed(): readonly string[] {
    return this.#committed;
  }

  /**
   * Holds the file. Where the pod writes several files at once, the files given the same `wave` in a row are written
   * together, each such row only once every file added before it is written (W1); a file with no wave is written in
   * its place, in one `writeAll` with the files with none beside it. A path added again keeps the place and the wave it first had.
   * A file of a family whose name fixes its bytes names it, so the commit does not read it when the pod's listing lacks it.
   */
  add(
    path: string,
    bytes: Uint8Array,
    wave?: number,
    fixedByName?: FixedByName,
  ): void {
    if (path === this.#act?.path)
      throw new Error(`${path} is the act's file, written last`);
    const held = this.#files.get(path);
    if (held !== undefined && !same(held, bytes))
      throw new Error(`${path} would be written twice with different bytes`);
    if (held === undefined && wave !== undefined) this.#waves.set(path, wave);
    if (fixedByName !== undefined) this.#fixed.add(path);
    this.#files.set(path, bytes);
  }

  /** A file that arrived from another writer, which the step writes but its act did not write (S3). */
  arrive(path: string, bytes: Uint8Array): void {
    this.add(path, bytes);
    this.#arrived.add(path);
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
   * Writes each file the pod lacks, the act's last, in one `writeAll`, and returns the paths of those that did not
   * arrive from another writer; a file the pod holds with other bytes is refused. A file the pod's listing lacks is
   * read too, unless its name fixes its bytes (`FixedByName`).
   */
  async commit(pod: Files, finish?: FinishAct): Promise<string[]> {
    const fresh: [string, Uint8Array][] = [];
    await timedAside("files.absent.check", async () => {
      const lacking =
        lists(pod) && this.#fixed.size > 0
          ? await pod.lacking([...this.#fixed])
          : undefined;
      counted("files.absent.check", this.#files.size);
      for (const [path, bytes] of this.#files) {
        if (this.#fixed.has(path) && lacking?.has(path) === true) {
          fresh.push([path, bytes]);
          continue;
        }
        counted("files.absent.check.read");
        const held = await pod.read(path);
        if (held === undefined) fresh.push([path, bytes]);
        else if (!same(held, bytes))
          throw new Error(`${path} is in the pod already, holding other bytes`);
      }
    });
    const act = this.#act;
    if (act !== undefined) {
      await timedAside("files.absent.check", async () => {
        counted("files.absent.check");
        counted("files.absent.check.read");
        if ((await pod.read(act.path)) !== undefined)
          throw new Error(`${act.path} is in the pod already`);
      });
      const finished = (await finish?.(act, [...fresh], this.#arrived)) ?? [];
      fresh.push([act.path, ntriples([...act.triples, ...finished])]);
    }
    await this.#write(pod, fresh);
    this.#committed = fresh.map(([path]) => path);
    return fresh.flatMap(([path]) => (this.#arrived.has(path) ? [] : [path]));
  }

  /**
   * One `writeAll` of every file where the pod has no `writeMany`, which a pod that takes a batch whole, or none, is
   * given. Else the files of a wave in a row go to `writeMany`, and the rest, in a row, to `writeAll`, one run
   * after another in the order given.
   */
  async #write(
    pod: Files,
    fresh: readonly (readonly [string, Uint8Array])[],
  ): Promise<void> {
    if (pod.writeMany === undefined) return writeAll(pod, fresh);
    let run: (readonly [string, Uint8Array])[] = [];
    let wave: number | undefined;
    const flush = (): Promise<void> =>
      wave === undefined ? writeAll(pod, run) : writeEach(pod, run);
    for (const file of fresh) {
      const waved = this.#waves.get(file[0]);
      if (run.length > 0 && waved !== wave) {
        await flush();
        run = [];
      }
      wave = waved;
      run.push(file);
    }
    await flush();
  }
}
