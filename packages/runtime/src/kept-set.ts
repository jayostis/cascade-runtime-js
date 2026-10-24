import { createSHA256, type IHasher } from "hash-wasm";
import { SetHashProduct } from "./names.js";

/**
 * What a writer keeps outside the pod of the set its last act hashed, beside its last snapshot (N14), so that its next
 * act multiplies in only the files it adds.
 */
export interface KeptSet {
  /** The set's MuHash3072 product, as `SetHashProduct.bytes()` writes it, in hex. */
  readonly product: string;
  /** How many files the set holds. */
  readonly files: number;
  /**
   * The set's paths as `PathBuckets.digest` hashes them, in hex: what the pod's listing is checked against when the
   * writer next opens it, without reading a file.
   */
  readonly paths: string;
}

const BUCKETS = 256;

let hashing: Promise<IHasher> | undefined;

/** The bucket of the path: the low byte of its 32-bit FNV-1a over its UTF-16 code units. */
function bucketOf(path: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & (BUCKETS - 1);
}

/**
 * The paths of a set in 256 buckets, so that its digest after a few paths are added hashes again only their buckets.
 * The digest is the SHA-256 of each bucket's SHA-256 in hex, in bucket order, a bucket's being over its paths in
 * UTF-16 code unit order, each followed by a 0x00 byte: two sets of paths have one digest only when they are one set.
 */
class PathBuckets {
  readonly #paths: string[][];
  readonly #digests: (string | undefined)[];

  constructor(paths: Iterable<string> = [], from?: PathBuckets) {
    this.#paths =
      from === undefined ? [] : from.#paths.map((bucket) => [...bucket]);
    this.#digests = from === undefined ? [] : [...from.#digests];
    for (let bucket = this.#paths.length; bucket < BUCKETS; bucket++)
      this.#paths.push([]);
    for (const path of paths) this.add(path);
  }

  add(path: string): void {
    const bucket = bucketOf(path);
    this.#paths[bucket]?.push(path);
    this.#digests[bucket] = undefined;
  }

  copy(): PathBuckets {
    return new PathBuckets([], this);
  }

  async digest(): Promise<string> {
    hashing ??= createSHA256();
    const hasher = await hashing;
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      if (this.#digests[bucket] !== undefined) continue;
      const paths = (this.#paths[bucket] ?? []).sort();
      hasher.init();
      if (paths.length > 0) hasher.update(`${paths.join("\0")}\0`);
      this.#digests[bucket] = hasher.digest("hex");
    }
    hasher.init();
    hasher.update(this.#digests.join(""));
    return hasher.digest("hex");
  }
}

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesOf(text: string): Uint8Array | undefined {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) return undefined;
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** The files of the set a writer has hashed, by path, and their product. */
export class HashedSet {
  readonly #paths: Set<string>;
  readonly #buckets: PathBuckets;
  readonly #product: SetHashProduct;

  private constructor(
    paths: Set<string>,
    buckets: PathBuckets,
    product: SetHashProduct,
  ) {
    this.#paths = paths;
    this.#buckets = buckets;
    this.#product = product;
  }

  /** The set of the files, each given by its path and the SHA-256 of its bytes, every member multiplied in. */
  static async of(files: ReadonlyMap<string, Uint8Array>): Promise<HashedSet> {
    const product = SetHashProduct.empty();
    await product.add(files);
    return new HashedSet(
      new Set(files.keys()),
      new PathBuckets(files.keys()),
      product,
    );
  }

  /** The set kept as `kept()` wrote it, when the paths are exactly its files; undefined otherwise. */
  static async kept(
    kept: KeptSet,
    paths: ReadonlySet<string>,
  ): Promise<HashedSet | undefined> {
    if (kept.files !== paths.size) return undefined;
    const bytes = bytesOf(kept.product);
    const product =
      bytes === undefined ? undefined : SetHashProduct.read(bytes);
    if (product === undefined) return undefined;
    const buckets = new PathBuckets(paths);
    if ((await buckets.digest()) !== kept.paths) return undefined;
    return new HashedSet(new Set(paths), buckets, product);
  }

  /**
   * The paths given that it does not hold and `inSet` takes, each once; undefined when a file it holds is not among
   * the paths. Only a path it does not hold is given to `inSet`.
   */
  missing(
    paths: Iterable<string>,
    inSet: (path: string) => boolean,
  ): string[] | undefined {
    let held = 0;
    const missing: string[] = [];
    for (const path of new Set(paths))
      if (this.#paths.has(path)) held++;
      else if (inSet(path)) missing.push(path);
    return held === this.#paths.size ? missing : undefined;
  }

  /** Adds each file it does not hold, given by its path and the SHA-256 of its bytes; a path given twice is added once. */
  async add(
    files: Iterable<readonly [path: string, sha256: Uint8Array]>,
  ): Promise<void> {
    const added = new Map<string, Uint8Array>();
    for (const [path, digest] of files)
      if (!this.#paths.has(path) && !added.has(path)) added.set(path, digest);
    await this.#product.add(added);
    for (const path of added.keys()) {
      this.#paths.add(path);
      this.#buckets.add(path);
    }
  }

  setHash(): Promise<string> {
    return this.#product.setHash();
  }

  copy(): HashedSet {
    return new HashedSet(
      new Set(this.#paths),
      this.#buckets.copy(),
      this.#product.copy(),
    );
  }

  async kept(): Promise<KeptSet> {
    return {
      product: hexOf(this.#product.bytes()),
      files: this.#paths.size,
      paths: await this.#buckets.digest(),
    };
  }
}
