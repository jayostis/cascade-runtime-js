/** Mints the ID of what is new, an import or an entry session, and gives the time. */
export interface IdsAndTime {
  /** A new `urn:uuid:`, version 4, random on every call. */
  newId(): string;
  /** The time now, as an `xsd:dateTime`. */
  now(): string;
}

export function randomId(): string {
  return `urn:uuid:${globalThis.crypto.randomUUID()}`;
}

export const clock: IdsAndTime = {
  newId: randomId,
  now: () => new Date().toISOString(),
};

/** IDs as random as ever, and the time a story's step says it is. */
export class StoryTime implements IdsAndTime {
  #when: string | undefined;

  newId(): string {
    return randomId();
  }

  now(): string {
    if (this.#when === undefined)
      throw new Error("no step of the story has begun");
    return this.#when;
  }

  /** The step that begins now happened at `when`. */
  begin(when: string): void {
    this.#when = when;
  }
}
