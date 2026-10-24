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
   * The sum modulo 2^256 of the SHA-256 of each file's path, in hex: what the set's paths are checked against when the
   * writer next opens the pod, without reading a file.
   */
  readonly paths: string;
}

const PATH_SUM_MODULUS = 1n << 256n;

let hashing: Promise<IHasher> | undefined;

/** The SHA-256 of each path read as a number, summed modulo 2^256. */
async function pathSum(paths: Iterable<string>): Promise<bigint> {
  hashing ??= createSHA256();
  const hasher = await hashing;
  let sum = 0n;
  for (const path of paths) {
    hasher.init();
    hasher.update(path);
    const digest = hasher.digest("binary");
    const words = new DataView(digest.buffer, digest.byteOffset, 32);
    for (let offset = 0; offset < 32; offset += 8)
      sum += words.getBigUint64(offset) << BigInt(192 - offset * 8);
  }
  return sum % PATH_SUM_MODULUS;
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
  readonly #product: SetHashProduct;
  #pathSum: bigint;

  private constructor(
    paths: Set<string>,
    product: SetHashProduct,
    sum: bigint,
  ) {
    this.#paths = paths;
    this.#product = product;
    this.#pathSum = sum;
  }

  /** The set of the files, each given by its path and the SHA-256 of its bytes, every member multiplied in. */
  static async of(files: ReadonlyMap<string, Uint8Array>): Promise<HashedSet> {
    const product = SetHashProduct.empty();
    await product.add(files);
    return new HashedSet(
      new Set(files.keys()),
      product,
      await pathSum(files.keys()),
    );
  }

  /** The set kept as `kept()` wrote it, when the paths are its files; undefined otherwise. */
  static async kept(
    kept: KeptSet,
    paths: ReadonlySet<string>,
  ): Promise<HashedSet | undefined> {
    if (kept.files !== paths.size) return undefined;
    const bytes = bytesOf(kept.product);
    const product =
      bytes === undefined ? undefined : SetHashProduct.read(bytes);
    if (product === undefined) return undefined;
    const sum = await pathSum(paths);
    if (sum.toString(16).padStart(64, "0") !== kept.paths) return undefined;
    return new HashedSet(new Set(paths), product, sum);
  }

  /**
   * The paths given that it does not hold and `inSet` takes; undefined when a file it holds is not among the paths.
   * Only a path it does not hold is given to `inSet`, and no path is given twice.
   */
  missing(
    paths: Iterable<string>,
    inSet: (path: string) => boolean,
  ): string[] | undefined {
    let held = 0;
    const missing = new Set<string>();
    for (const path of paths)
      if (this.#paths.has(path)) held++;
      else if (inSet(path)) missing.add(path);
    return held === this.#paths.size ? [...missing] : undefined;
  }

  /** Adds each file it does not hold, given by its path and the SHA-256 of its bytes. */
  async add(
    files: Iterable<readonly [path: string, sha256: Uint8Array]>,
  ): Promise<void> {
    const added = [...files].filter(([path]) => !this.#paths.has(path));
    await this.#product.add(added);
    for (const [path] of added) this.#paths.add(path);
    this.#pathSum =
      (this.#pathSum + (await pathSum(added.map(([path]) => path)))) %
      PATH_SUM_MODULUS;
  }

  setHash(): Promise<string> {
    return this.#product.setHash();
  }

  copy(): HashedSet {
    return new HashedSet(
      new Set(this.#paths),
      this.#product.copy(),
      this.#pathSum,
    );
  }

  kept(): KeptSet {
    return {
      product: hexOf(this.#product.bytes()),
      files: this.#paths.size,
      paths: this.#pathSum.toString(16).padStart(64, "0"),
    };
  }
}
