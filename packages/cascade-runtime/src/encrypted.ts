import {
  type DeriveKey,
  type Files,
  madeNewPod,
  newHeader,
  openHeader,
  type PodKey,
  readHeader,
  heldWhileMaking,
  Unopened,
} from "@cascade-runtime/runtime";
import { typedWords } from "./six-words.js";

/** An encrypted pod's header bytes and its files beneath the sealing, as a pod's opening finds them. */
export interface HeldPod {
  /** The files the pod is held in, nothing sealed or opened. */
  readonly files: Files;
  /** The header's bytes; none when nothing is at its path. */
  readonly header: Uint8Array | undefined;
  /** The header's bytes read again, as `header` was; for a pod that lost a race to make its header. */
  reread(): Promise<Uint8Array | undefined>;
  /** Whether the pod holds anything already. */
  held(): Promise<boolean>;
}

/** How an opening waits for the header of another that is making the pod: how many times it looks, and how long between, in milliseconds; 100 and 50 unless given. */
export interface HeaderWait {
  readonly looks?: number;
  readonly every?: number;
}

/**
 * The key the pod opens with: none for a pod opened without a secret and with no header. A pod with a header is read
 * first, so a malformed one is refused before any secret is asked for; then opened with the secret as given, and, when
 * that is an incorrect secret, with the secret cleaned as typed words are. A new pod given a secret is made encrypted,
 * its empty sealed index and then its header written before anything else (`madeNewPod`); an opening that loses that
 * race to another waits for the other's header. A folder with no header that holds only sealed indexes and the probe of a
 * layout proved (`heldWhileMaking`) is a pod being made, or one whose maker stopped between its writes, and holds no record: it waits as the loser does, and, no
 * header coming, makes the pod again. Throws `Unopened` when the pod does not open with what was given.
 */
export async function podKey(
  found: HeldPod,
  secret: string | undefined,
  derive: DeriveKey,
  wait: HeaderWait = {},
): Promise<PodKey | undefined> {
  const { header } = found;
  if (header !== undefined) return openedWith(header, secret, derive);
  if (secret === undefined) return undefined;
  const listing = (await found.held()) ? await found.files.list("") : [];
  if (listing.some((path) => !heldWhileMaking(path)))
    throw new Unopened(
      "not encrypted",
      "The pod is not encrypted: it opens without a secret.",
    );
  if (listing.length > 0) {
    const winner = await headerAfter(found, wait);
    if (winner !== undefined) return openedWith(winner, secret, derive);
  }
  const made = await newHeader(secret, derive);
  if (await madeNewPod(found.files, made)) return made.key;
  const winner = await headerAfter(found, wait);
  if (winner !== undefined) return openedWith(winner, secret, derive);
  throw new Unopened("cannot open", "The pod's header could not be read.");
}

/** The header another opening writes, looked for until the looks are used; none when it does not come. */
async function headerAfter(
  found: HeldPod,
  { looks = 100, every = 50 }: HeaderWait,
): Promise<Uint8Array | undefined> {
  for (let look = 0; look < looks; look++) {
    const header = await found.reread();
    if (header !== undefined) return header;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  return undefined;
}

async function openedWith(
  header: Uint8Array,
  secret: string | undefined,
  derive: DeriveKey,
): Promise<PodKey> {
  readHeader(header);
  if (secret === undefined)
    throw new Unopened(
      "secret needed",
      "The pod is encrypted: it opens only with its secret.",
    );
  try {
    return await openHeader(header, secret, derive);
  } catch (error) {
    const cleaned = typedWords(secret);
    if (
      !(error instanceof Unopened) ||
      error.outcome !== "incorrect secret" ||
      cleaned === secret
    )
      throw error;
    return openHeader(header, cleaned, derive);
  }
}

/**
 * Whether the secret opens the pod's header, as typed or as `typedWords` cleans it; false for an incorrect one. Reads
 * nothing but the header it is given. Throws `Unopened` for a header that is none (`not encrypted`), malformed or of an
 * unsupported version.
 */
export async function secretChecked(
  header: Uint8Array | undefined,
  secret: string,
  derive: DeriveKey,
): Promise<boolean> {
  if (header === undefined)
    throw new Unopened(
      "not encrypted",
      "The pod is not encrypted: it has no secret to check.",
    );
  try {
    await openedWith(header, secret, derive);
    return true;
  } catch (error) {
    if (error instanceof Unopened && error.outcome === "incorrect secret")
      return false;
    throw error;
  }
}
