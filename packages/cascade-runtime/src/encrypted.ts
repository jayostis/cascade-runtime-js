import {
  type DeriveKey,
  type Files,
  HEADER,
  newHeader,
  openHeader,
  type PodKey,
  readHeader,
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

/**
 * The key the pod opens with: none for a pod opened without a secret and with no header. A pod with a header is read
 * first, so a malformed one is refused before any secret is asked for; then opened with the secret as given, and, when
 * that is an incorrect secret, with the secret cleaned as typed words are. A new pod given a secret is made encrypted,
 * its header written before anything else. Throws `Unopened` when the pod does not open with what was given.
 */
export async function podKey(
  found: HeldPod,
  secret: string | undefined,
  derive: DeriveKey,
): Promise<PodKey | undefined> {
  const { header } = found;
  if (header !== undefined) return openedWith(header, secret, derive);
  if (secret === undefined) return undefined;
  if (await found.held())
    throw new Unopened(
      "not encrypted",
      "The pod is not encrypted: it opens without a secret.",
    );
  const made = await newHeader(secret, derive);
  const won = found.files.writeNew
    ? await found.files.writeNew(HEADER, made.bytes)
    : (await found.files.write(HEADER, made.bytes), true);
  if (won) return made.key;
  const winner = await found.reread();
  if (winner === undefined)
    throw new Unopened("cannot open", "The pod's header could not be read.");
  return openedWith(winner, secret, derive);
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
