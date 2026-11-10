/** What an act gave or threw, kept so that a `before` which acts once fails only the leaves that read what it did. */
export type Kept<T> = { readonly value: T } | { readonly failure: unknown };

/** The act's result, or the failure it threw, as a `Kept`. */
export async function kept<T>(act: () => Promise<T>): Promise<Kept<T>> {
  try {
    return { value: await act() };
  } catch (failure) {
    return { failure };
  }
}

/** What the act gave; throws the failure it threw, so the leaf that reads it fails with the act's own message. */
export function got<T>(outcome: Kept<T>): T {
  if ("failure" in outcome) throw outcome.failure;
  return outcome.value;
}
