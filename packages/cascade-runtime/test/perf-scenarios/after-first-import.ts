/** How many source entries the changed document differs from the first one in. */
export const CHANGED_ENTRIES = 10;

/** A document edited from the one the first import took in, and what was edited. */
export interface Edited {
  readonly bundle: object;
  /** The source entries whose content was changed. */
  readonly changed: number;
  /** The source entries added. */
  readonly added: number;
  /** What was done to the document, in a sentence. */
  readonly says: string;
}

/** The Bundle with `count` of its Observations changed (stub). */
export function changedBundle(
  bundle: object,
  _count = CHANGED_ENTRIES,
): Edited {
  return { bundle, changed: 0, added: 0, says: "" };
}

/** The Bundle with one more Observation (stub). */
export function oneMoreBundle(bundle: object): Edited {
  return { bundle, changed: 0, added: 0, says: "" };
}
