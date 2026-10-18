import type { About, Tables, VariantAsked, WhatClinVarSays } from "./tables.js";

export const LOOKUPS = "lookups.json";

/**
 * What the tables said of a published pod's codes and variants, as `lookups.json` keeps them beside its answers: what
 * a browser's copy reads before it holds the tables, while the tables it holds are still the ones `tables` names.
 */
export interface Lookups {
  /** The runtime's own version, as the answers beside them name it. */
  readonly runtime: string;
  /** The current version of each series the tables held, as `Tables.current()` gave them. */
  readonly tables: readonly string[];
  readonly about: readonly (readonly [string, About])[];
  readonly variants: readonly (readonly [string, WhatClinVarSays])[];
}

/** The key a variant is looked up by: its fields, in the order `variantsAsked` gives them. */
function variantKey(variant: VariantAsked): string {
  return JSON.stringify(variant);
}

/** The tables, recording what `about` and `variantClassification` say through them, and the lookups recorded. */
export function recording(tables: Tables): {
  readonly tables: Tables;
  lookups(runtime: string): Promise<Lookups>;
} {
  const about = new Map<string, About>();
  const variants = new Map<string, WhatClinVarSays>();
  return {
    tables: overriding(tables, {
      about: async (codes) => {
        const said = await tables.about(codes);
        for (const [code, each] of said) about.set(code, each);
        return said;
      },
      variantClassification: async (variant) => {
        const said = await tables.variantClassification(variant);
        variants.set(variantKey(variant), said);
        return said;
      },
    }),
    lookups: async (runtime) => ({
      runtime,
      tables: await tables.current(),
      about: [...about],
      variants: [...variants],
    }),
  };
}

/**
 * The tables, answering `about` and `variantClassification` from `lookups` while their current versions and the
 * runtime are the ones the lookups were recorded with and every code or variant asked was recorded; anything else is
 * asked of the tables.
 */
export function withLookups(
  tables: Tables,
  lookups: Lookups,
  runtime: string,
): Tables {
  const about = new Map(lookups.about);
  const variants = new Map(lookups.variants);
  const current = (async () => {
    if (lookups.runtime !== runtime) return false;
    const now = await tables.current();
    return (
      now.length === lookups.tables.length &&
      now.every((version, at) => version === lookups.tables[at])
    );
  })();
  return overriding(tables, {
    about: async (codes) =>
      (await current) && codes.every((code) => about.has(code))
        ? new Map(codes.map((code) => [code, about.get(code) as About]))
        : tables.about(codes),
    variantClassification: async (variant) =>
      ((await current) && variants.get(variantKey(variant))) ||
      tables.variantClassification(variant),
  });
}

/** Lookups as `lookups.json` holds them, or none when they are not lookups. */
export function lookupsOf(bytes: Uint8Array | undefined): Lookups | undefined {
  if (bytes === undefined) return undefined;
  try {
    const read = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<Lookups>;
    return typeof read.runtime === "string" &&
      Array.isArray(read.tables) &&
      Array.isArray(read.about) &&
      Array.isArray(read.variants)
      ? (read as Lookups)
      : undefined;
  } catch {
    return undefined;
  }
}

type Overrides = Pick<Tables, "about" | "variantClassification">;

/** The tables with `overrides` in place of their own methods, every other one theirs. */
function overriding(tables: Tables, overrides: Overrides): Tables {
  return new Proxy(tables, {
    get(target, property) {
      if (property in overrides) return overrides[property as keyof Overrides];
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
