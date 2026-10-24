import { OWL, rowsAbout, values } from "../rows.js";
import { CASCADE } from "./constants.js";
import { currentOfKind, described } from "./references-index.js";
import type { Described, Fact, TablesContext } from "./types.js";

/** The relations of a drug class row, in the order a code's page lists them. */
const RELATIONS = [
  `${CASCADE}establishedPharmacologicClass`,
  `${CASCADE}mechanismOfActionClass`,
  `${CASCADE}physiologicEffectClass`,
  `${CASCADE}chemicalStructureClass`,
];

/** A class row, before `facts` names its codes. */
export interface ClassOf {
  readonly relation: string;
  readonly class: string;
  readonly through?: string;
}

/** A relation a code has no class for though a different form of its ingredient has one. */
export interface WithheldOf {
  readonly relation: string;
  readonly ingredient: string;
}

export async function classedElsewhere(
  context: TablesContext,
  codes: readonly string[],
): Promise<Map<string, string[]>> {
  const references = await context.references();
  const [held, ingredients] = [
    currentOfKind(
      references,
      context.options.preference,
      `${CASCADE}DrugClasses`,
    ),
    currentOfKind(
      references,
      context.options.preference,
      `${CASCADE}ProductIngredients`,
    ),
  ];
  const found = new Map<string, string[]>();
  for (const code of codes) {
    const elsewhere = new Set(
      (await classes(context, code, held, ingredients)).flatMap(
        ({ withheld }) => withheld.map(({ ingredient }) => ingredient),
      ),
    );
    if (elsewhere.size > 0) found.set(code, [...elsewhere].sort());
  }
  return found;
}

/**
 * In each drug classes version, the classes of the code, by `tables/medication-classes-through-precise-ingredients.rq`'s
 * rule, relation by relation, for each ingredient a product ingredients version maps the code to: a class row on the
 * code itself is its class; else the classes of its own precise ingredients that are forms of that ingredient, when
 * one or more bear a row of the relation; else, in a version that states precise ingredients, the ingredient's own.
 * Nothing else: a relation the code reaches no class for, though a different form of its ingredient bears one, is
 * withheld, naming the ingredient, for RxNorm does not tie the code to that form. Only a version that states precise
 * ingredients says that: one that states none is silent on forms, so it withholds nothing.
 */
export async function classes(
  context: TablesContext,
  code: string,
  held: readonly Fact[],
  ingredients: readonly Fact[],
): Promise<(Fact & { in: ClassOf[]; withheld: WithheldOf[] })[]> {
  if (held.length === 0) return [];
  const maps = await Promise.all(
    ingredients.map(async ({ version }) => {
      const [{ mapsTo, precise }, from] = await Promise.all([
        context.indexes.listed(version),
        context.indexes.mappedFrom(version),
      ]);
      return {
        mapsTo,
        precise,
        from,
        stating: Object.keys(precise).length > 0,
      };
    }),
  );
  return (
    await Promise.all(
      held.map(async (fact) => {
        const [index, text] = await Promise.all([
          context.indexes.codesIn(fact.version),
          context.indexes.text(fact.version),
        ]);
        const classesOf = (on: string): Map<string, Set<string>> => {
          const byRelation = new Map<string, Set<string>>();
          for (const subject of index.get(on) ?? []) {
            const rows = rowsAbout(text, subject);
            const [relation] = values(rows, `${OWL}annotatedProperty`);
            const [target] = values(rows, `${OWL}annotatedTarget`);
            if (relation !== undefined && target !== undefined)
              byRelation.set(
                relation,
                (byRelation.get(relation) ?? new Set()).add(target),
              );
          }
          return byRelation;
        };
        // The step a class was reached at (0 the code, 1 its own precise ingredient, 2 the ingredient) and the code it is on.
        const found = new Map<string, { step: number; of: ClassOf }>();
        const keep = (
          relation: string,
          target: string,
          step: number,
          on: string,
        ): void => {
          const key = `${relation} ${target}`;
          const before = found.get(key);
          if (
            before === undefined ||
            step < before.step ||
            (step === before.step && on < (before.of.through ?? code))
          )
            found.set(key, {
              step,
              of: {
                relation,
                class: target,
                ...(step > 0 && { through: on }),
              },
            });
        };
        const mine = classesOf(code);
        for (const [relation, targets] of mine)
          for (const target of targets) keep(relation, target, 0, code);
        // A different form of an ingredient that bears a relation's rows, by the relation.
        const elsewhere = new Map<string, Set<string>>();
        for (const { mapsTo, precise, from, stating } of maps)
          for (const ingredient of Object.hasOwn(mapsTo, code)
            ? mapsTo[code]!
            : []) {
            const forms = (
              Object.hasOwn(precise, code) ? precise[code]! : []
            ).filter((form) => mapsTo[form]?.includes(ingredient));
            const own = classesOf(ingredient);
            const bearing = forms.map(
              (form) => [form, classesOf(form)] as const,
            );
            const othersBear = new Set(
              (from.get(ingredient) ?? [])
                .filter((other) => other !== code && other !== ingredient)
                .flatMap((other) => [...classesOf(other).keys()]),
            );
            for (const relation of RELATIONS) {
              if (mine.has(relation)) continue;
              const by = bearing.filter(([, classes]) => classes.has(relation));
              if (by.length > 0)
                for (const [form, classes] of by)
                  for (const target of classes.get(relation)!)
                    keep(relation, target, 1, form);
              else if (stating && own.has(relation))
                for (const target of own.get(relation)!)
                  keep(relation, target, 2, ingredient);
              else if (stating && othersBear.has(relation))
                elsewhere.set(
                  relation,
                  (elsewhere.get(relation) ?? new Set()).add(ingredient),
                );
            }
          }
        const reached = new Set(
          [...found.values()].map(({ of }) => of.relation),
        );
        const withheld = new Map<string, WithheldOf>();
        for (const [relation, ingredients] of elsewhere)
          if (!reached.has(relation))
            for (const ingredient of ingredients)
              withheld.set(`${relation} ${ingredient}`, {
                relation,
                ingredient,
              });
        const each = [...found.values()]
          .map(({ of }) => of)
          .sort(
            (a, b) =>
              RELATIONS.indexOf(a.relation) - RELATIONS.indexOf(b.relation) ||
              a.class.localeCompare(b.class),
          );
        const left = [...withheld.values()].sort(
          (a, b) =>
            RELATIONS.indexOf(a.relation) - RELATIONS.indexOf(b.relation),
        );
        return each.length === 0 && left.length === 0
          ? []
          : [{ ...fact, in: each, withheld: left }];
      }),
    )
  ).flat();
}

/**
 * The codes, then their ingredients and their own precise ingredients in each of the product ingredients versions:
 * the codes a class of the codes may be on.
 */
async function classedOn(
  context: TablesContext,
  codes: readonly string[],
  versions: readonly string[],
): Promise<Set<string>> {
  const on = new Set(codes);
  for (const version of versions) {
    const { mapsTo, precise } = await context.indexes.listed(version);
    for (const code of codes)
      for (const each of [
        ...(Object.hasOwn(mapsTo, code) ? mapsTo[code]! : []),
        ...(Object.hasOwn(precise, code) ? precise[code]! : []),
      ])
        on.add(each);
  }
  return on;
}

export async function reached(
  context: TablesContext,
  codes: readonly string[],
): Promise<Described[]> {
  const references = await context.references();
  const terms = await context.terms();
  const current = (kind: string): string[] =>
    currentOfKind(references, context.options.preference, kind).map(
      ({ version }) => version,
    );
  const ingredients = current(`${CASCADE}ProductIngredients`);
  const on = await classedOn(context, codes, ingredients);
  const read = async (version: string, among: ReadonlySet<string>) => {
    // The rows are found by an index beside them, which is made now if the version came without one.
    await context.indexes.codesIn(version);
    return described(
      references,
      version,
      await references.rows(version, { codes: among, terms }),
    );
  };
  return Promise.all([
    ...ingredients.map(async (version) => {
      const [stating] = Object.keys(
        (await context.indexes.listed(version)).precise,
      );
      return read(
        version,
        stating === undefined ? on : new Set(on).add(stating),
      );
    }),
    ...current(`${CASCADE}DrugClasses`).map((version) => read(version, on)),
  ]);
}
