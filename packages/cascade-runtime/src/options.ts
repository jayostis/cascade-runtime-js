const CLAIM_PROFILES = {
  to: "claimProfiles",
  build: "build-6979c2fc",
} as const;
const LOOKUPS = { to: "lookups", build: "build-6979c2fc" } as const;

/** What an option a call took was renamed to, and the first build that carried the new name, by call and old name. */
const RENAMED: Readonly<
  Record<string, Readonly<Record<string, { to: string; build: string }>>>
> = {
  "pod.import": { aboutSubject: CLAIM_PROFILES, claim: CLAIM_PROFILES },
  samplesToPublish: { look: LOOKUPS },
  answersToPublish: { look: LOOKUPS },
};

/**
 * Throws a `TypeError` when `options` is not an object or holds a key `accepted` does not list, so a key a caller
 * still passes under a name the call once had is refused, naming the new one, and is never ignored. `accepted` is
 * written as every key of the options type, which the compiler holds to the type.
 */
export function acceptOptions<T extends object>(
  call: string,
  options: T | undefined,
  accepted: { readonly [K in keyof T]-?: true },
): void {
  if (options === undefined) return;
  if (typeof options !== "object" || options === null || Array.isArray(options))
    throw new TypeError(
      `${call} takes an options object, not ${options === null ? "null" : Array.isArray(options) ? "an array" : `a ${typeof options}`}`,
    );
  const known = Object.keys(accepted);
  const problems = Object.keys(options)
    .filter((key) => !known.includes(key))
    .map((key) => {
      const renamed = RENAMED[call]?.[key];
      return renamed === undefined
        ? `${call} does not take ${key}: it takes ${known.length === 0 ? "no options" : known.join(", ")}.`
        : `${call} does not take ${key}: it was renamed ${renamed.to} in ${renamed.build}.`;
    });
  if (problems.length > 0) throw new TypeError(problems.join(" "));
}
