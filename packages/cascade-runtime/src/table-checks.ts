// What a pod's rows and the reference tables say together that no question of the pod returns: each variant report
// that differs from ClinVar today, and each pair of active medications whose codes share an ingredient. Rows, each
// naming its entries and the table row it cites; the starter's page says them in its own sentences.
import type { Row } from "./pod.js";
import type { About, Concept, VariantAsked } from "./tables/types.js";
import { terms } from "./terms.js";

export const VARIANTS_QUESTION = "pod/My genetic variants";
export const REPORTS_QUESTION = "pod/What each report says of a variant";
export const HISTORY_QUESTION = "pod/My medication history";

/**
 * What the tables' `variantClassification` answers of one variant, as these checks read it (`WhatClinVarSays`, and
 * the starter's own type of it, satisfy it).
 */
export type ClinVarSays =
  | {
      readonly found: "rows";
      readonly version: string;
      readonly series?: string;
      readonly rows: readonly {
        readonly variation: string;
        readonly classification: readonly Concept[];
      }[];
    }
  | {
      readonly found: "not found" | "not covered" | "no series";
      readonly genes?: readonly string[];
    };

/** A row of `Pod.agreement()`: how a report stands to the ClinVar row its variant finds, in a version. */
export interface AgreementVerdict {
  readonly report?: string;
  readonly row?: string;
  readonly origin?: string;
  readonly verdict?: string;
}

/** A variant entry the ClinVar check could not check: ClinVar has no row for it, does not cover its gene, or the pod gives nothing to ask by. */
export interface VariantNotChecked {
  readonly entry: string;
  readonly reason: "not found" | "not covered" | "no series" | "not asked";
  /** The genes the series covers, when it does not cover this variant's. */
  readonly genes?: readonly string[];
}

/** An active medication entry the ingredients check could not check: its rows give no code, or no ingredients row maps its codes. */
export interface MedicationNotChecked {
  readonly entry: string;
  readonly code?: string;
  readonly reason: "no code" | "no ingredients row";
}

/** A report that differs from the row of ClinVar the app holds today. */
export interface ReportDifferingFromClinVar {
  /** The variant's entry. */
  readonly entry: string;
  /** The report's entry. */
  readonly report: string;
  readonly date?: string;
  /** The report's own ACMG classification. */
  readonly classification?: string;
  readonly clinvar: {
    readonly series?: string;
    readonly version: string;
    readonly variation: string;
    readonly classification: readonly Concept[];
  };
}

/** A medication of a pair, the code its row shows and the version of the ingredients table that mapped it. */
export interface MedicationSharing {
  readonly entry: string;
  readonly code: string;
  readonly origin?: string;
}

/** Two active medications in two entries whose codes share an ingredient, or the combination they both map to. */
export interface MedicationsSharingAnIngredient {
  readonly entries: readonly [MedicationSharing, MedicationSharing];
  readonly ingredient: {
    readonly code: string;
    readonly label?: string;
    readonly origin?: string;
  };
}

/**
 * Each variant entry of `variants` (rows of "My genetic variants"), by its IRI, as the tables' `variantClassification`
 * is asked of it: its distinct HGVS expressions and ClinVar IDs, and its gene when its rows give one symbol.
 */
export function variantsAsked(
  variants: readonly Row[],
): Map<string, VariantAsked> {
  const asked = new Map<
    string,
    { hgvs: string[]; variations: string[]; gene?: string }
  >();
  const genes = new Map<string, Set<string>>();
  for (const row of variants) {
    const variant = asked.get(row.variant!) ?? { hgvs: [], variations: [] };
    asked.set(row.variant!, variant);
    if (row.hgvs !== undefined && !variant.hgvs.includes(row.hgvs))
      variant.hgvs.push(row.hgvs);
    if (
      row.variation !== undefined &&
      !variant.variations.includes(row.variation)
    )
      variant.variations.push(row.variation);
    if (row.gene !== undefined)
      genes.set(
        row.variant!,
        new Set([...(genes.get(row.variant!) ?? []), row.gene]),
      );
  }
  for (const [variant, symbols] of genes)
    if (symbols.size === 1) asked.get(variant)!.gene = [...symbols][0];
  return asked;
}

/**
 * Each report of `reports` (rows of "What each report says of a variant") that `verdicts` (`Pod.agreement()`'s rows)
 * say differs from the one row `says` (the tables' `variantClassification` answer, by variant entry) found for its
 * variant, in the version it was read from: variants in the order `variants` and then `reports` name them, each
 * variant's reports oldest first and undated last.
 */
export function reportsDifferingFromClinVar(
  { variants, reports }: { variants: readonly Row[]; reports: readonly Row[] },
  {
    says,
    verdicts,
  }: {
    says: ReadonlyMap<string, ClinVarSays>;
    verdicts: readonly AgreementVerdict[];
  },
): ReportDifferingFromClinVar[] {
  const reported = reportsByVariant(reports);
  return variantEntries(variants, reported).flatMap((entry) => {
    const said = says.get(entry);
    if (said?.found !== "rows") return [];
    const [row] = said.rows;
    if (row === undefined) return [];
    return [...(reported.get(entry) ?? [])]
      .sort((a, b) =>
        a.date === undefined || b.date === undefined
          ? Number(a.date === undefined) - Number(b.date === undefined)
          : a.date.localeCompare(b.date),
      )
      .filter(({ report }) => reportDiffers(report!, said, verdicts))
      .map(({ report, date, classification }) => ({
        entry,
        report: report!,
        ...(date !== undefined && { date }),
        ...(classification !== undefined && { classification }),
        clinvar: {
          ...(said.series !== undefined && { series: said.series }),
          version: said.version,
          variation: row.variation,
          classification: row.classification,
        },
      }));
  });
}

/** Each report of `reports`, by its variant's entry, in their order. */
function reportsByVariant(reports: readonly Row[]): Map<string, Row[]> {
  const reported = new Map<string, Row[]>();
  for (const report of reports)
    reported.set(report.variant!, [
      ...(reported.get(report.variant!) ?? []),
      report,
    ]);
  return reported;
}

/** The variant entries in the order `variants` and then `reported` name them. */
function variantEntries(
  variants: readonly Row[],
  reported: ReadonlyMap<string, readonly Row[]>,
): string[] {
  return [
    ...new Set([
      ...variants.map(({ variant }) => variant!),
      ...reported.keys(),
    ]),
  ];
}

/**
 * Whether `verdicts` (`Pod.agreement()`'s rows) say the report `report` differs from the one row `says` (the
 * tables' `variantClassification` answer for its variant) found, in the version it was read from.
 */
export function reportDiffers(
  report: string,
  says: ClinVarSays | undefined,
  verdicts: readonly AgreementVerdict[],
): boolean {
  if (says?.found !== "rows") return false;
  const [row] = says.rows;
  return (
    row !== undefined &&
    verdicts.some(
      (each) =>
        each.report === report &&
        each.row === row.variation &&
        each.origin === says.version &&
        each.verdict === "differs",
    )
  );
}

/**
 * Each variant entry of `variants` and `reports`, in the order `reportsDifferingFromClinVar` gives them, that `says`
 * found no row for: what ClinVar answered (`not found`, `not covered` with the genes it covers, `no series`), or
 * `not asked` for a variant the pod gives no expression or ClinVar ID of.
 */
export function variantsNotChecked(
  { variants, reports }: { variants: readonly Row[]; reports: readonly Row[] },
  says: ReadonlyMap<string, ClinVarSays>,
): VariantNotChecked[] {
  return variantEntries(variants, reportsByVariant(reports)).flatMap(
    (entry): VariantNotChecked[] => {
      const said = says.get(entry);
      if (said === undefined) return [{ entry, reason: "not asked" }];
      if (said.found === "rows") return [];
      return [
        {
          entry,
          reason: said.found,
          ...(said.found === "not covered" &&
            said.genes !== undefined && { genes: said.genes }),
        },
      ];
    },
  );
}

/**
 * Each active medication entry of `history`, in the order of its rows, that `medicationsSharingAnIngredient` could
 * not check: none of its rows gives a code (`no code`), or `about` maps none of its codes to an ingredient (`no
 * ingredients row`, with its first code).
 */
export function medicationsNotChecked(
  history: readonly Row[],
  about: ReadonlyMap<string, Partial<About>>,
): MedicationNotChecked[] {
  const codes = new Map<string, string[]>();
  for (const row of history)
    if (row.lifecycle === terms.MedicationActive)
      codes.set(row.entry!, [
        ...(codes.get(row.entry!) ?? []),
        ...(row.code === undefined ? [] : [row.code]),
      ]);
  return [...codes].flatMap(([entry, held]): MedicationNotChecked[] => {
    if (held.length === 0) return [{ entry, reason: "no code" }];
    return held.some(
      (code) => (about.get(code)?.ingredients?.codes.length ?? 0) > 0,
    )
      ? []
      : [{ entry, code: held[0]!, reason: "no ingredients row" }];
  });
}

/**
 * Each pair of active medications (rule L1's class) of `history` (rows of "My medication history") in two entries
 * whose codes `about` (the tables' answer, by code) maps to a shared ingredient: in the order of the rows, once for the
 * pair of entries whatever codes their rows show, the first ingredient of the first's code they share, and none for a
 * pair whose rows share a code, which What needs review lists. The ingredient's label is `about`'s when it holds the
 * ingredient's code. A combination maps to its multiple-ingredient concept, never to each of its ingredients.
 */
export function medicationsSharingAnIngredient(
  history: readonly Row[],
  about: ReadonlyMap<string, Partial<About>>,
): MedicationsSharingAnIngredient[] {
  const rows = history
    .filter((row) => row.lifecycle === terms.MedicationActive)
    .map((row) => ({
      entry: row.entry!,
      code: row.code,
      ingredients:
        (row.code === undefined
          ? undefined
          : about.get(row.code)?.ingredients?.codes) ?? [],
    }));
  const said = new Set(
    rows.flatMap((one, at) =>
      rows
        .slice(at + 1)
        .filter((other) => other.code !== undefined && other.code === one.code)
        .map((other) => JSON.stringify([one.entry, other.entry].sort())),
    ),
  );
  const pairs: MedicationsSharingAnIngredient[] = [];
  for (const [at, one] of rows.entries())
    for (const other of rows.slice(at + 1)) {
      const pair = JSON.stringify([one.entry, other.entry].sort());
      const shared = one.ingredients.find((each) =>
        other.ingredients.includes(each),
      );
      if (one.entry === other.entry || shared === undefined || said.has(pair))
        continue;
      said.add(pair);
      const name = about.get(shared)?.name;
      const sharing = ({ entry, code }: (typeof rows)[number]) => {
        const origin = about.get(code!)?.ingredients?.origin;
        return {
          entry,
          code: code!,
          ...(origin !== undefined && { origin }),
        };
      };
      pairs.push({
        entries: [sharing(one), sharing(other)],
        ingredient: {
          code: shared,
          ...(name !== undefined && { label: name.label }),
          ...(name?.origin !== undefined && { origin: name.origin }),
        },
      });
    }
  return pairs;
}
