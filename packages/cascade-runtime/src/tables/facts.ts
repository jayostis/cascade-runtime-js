import { notation, OWL, rowsAbout } from "../rows.js";
import { about, nameOf, statusOf } from "./about.js";
import { CLASSIFICATIONS, PAGE_SIZE, CASCADE } from "./constants.js";
import { classes } from "./drug-classes.js";
import { panels } from "./panels.js";
import { currentOfKind, seriesOfAKind } from "./references-index.js";
import type { Coded, Fact, Facts, TablesContext } from "./types.js";
import { classificationRow } from "./variants.js";

/** The kinds a code's page gives a section of their own, so its generic mappings do not list them. */
const OWN_SECTIONS = [`${CASCADE}PanelMembers`, `${CASCADE}DrugClasses`];

export async function facts(
  context: TablesContext,
  code: string,
  among?: readonly string[],
): Promise<Facts> {
  const [references, { uriSpaces, foundBy, codeSystems }] = await Promise.all([
    context.references(),
    context.terms(),
  ]);
  const held = (kind: string): Fact[] =>
    currentOfKind(references, context.options.preference, kind, among);
  const rowsOf = (kind: string) =>
    Promise.all(
      held(kind).map(async (fact) => ({
        fact,
        rows: rowsAbout(await context.indexes.text(fact.version), code),
      })),
    );
  const page = (codes: readonly string[]) => ({
    total: codes.length,
    codes: codes.slice(0, PAGE_SIZE),
  });
  const mapped = async ({ series, version }: Fact) => {
    const [{ mapsTo }, from] = await Promise.all([
      context.indexes.listed(version),
      context.indexes.mappedFrom(version),
    ]);
    const others = (target: string): string[] =>
      (from.get(target) ?? []).filter((each) => each !== code);
    const targets = Object.hasOwn(mapsTo, code) ? mapsTo[code]! : [];
    // A code that maps to itself lists the codes mapped to it beside itself, once.
    const sources = targets.includes(code) ? [] : others(code);
    return targets.length === 0 && sources.length === 0
      ? []
      : [
          {
            series,
            version,
            mapsTo: targets.map((target) => ({
              code: target,
              alongside: page(others(target).filter((each) => each !== target)),
            })),
            mappedFrom: page(sources),
          },
        ];
  };
  const [named, statuses, mappings] = await Promise.all([
    rowsOf(`${CASCADE}CodeNames`),
    rowsOf(`${CASCADE}RetiredCodes`),
    Promise.all(
      seriesOfAKind(references.index)
        .map(({ value }) => value)
        .filter(
          (series) =>
            (among === undefined || among.includes(series)) &&
            !OWN_SECTIONS.includes(references.kindOf(series) ?? "") &&
            foundBy
              .get(references.kindOf(series) ?? "")
              ?.includes(`${OWL}annotatedSource`),
        )
        .map((series) =>
          mapped({ series, version: references.fallback(series) }),
        ),
    ).then((each) => each.flat()),
  ]);
  // Only a variation is a row's subject; a version's rows are not read for any other code.
  const clinvar = codeSystems.find(({ iri }) => iri === `${CASCADE}ClinVar`);
  const classifications = (
    await Promise.all(
      (clinvar !== undefined && code.startsWith(clinvar.uriSpace)
        ? held(CLASSIFICATIONS)
        : []
      ).map(async (fact) => {
        const rows = rowsAbout(await context.indexes.text(fact.version), code);
        return rows.length === 0
          ? []
          : [{ ...fact, ...(await classificationRow(context, code, rows)) }];
      }),
    )
  ).flat();
  const names = named.flatMap(({ fact, rows }) => {
    const name = nameOf(rows);
    return name === undefined ? [] : [{ ...fact, ...name }];
  });
  const status = statuses.flatMap(({ fact, rows }) => {
    const each = statusOf(rows);
    return each === undefined ? [] : [{ ...fact, ...each }];
  });
  // A panel and a class are the code's whatever source's page asks: a medication's classes are MED-RT's, not RxNorm's.
  const anywhere = (kind: string): Fact[] =>
    currentOfKind(references, context.options.preference, kind);
  const [inPanels, inClasses] = await Promise.all([
    panels(context, code, anywhere(`${CASCADE}PanelMembers`)),
    classes(
      context,
      code,
      anywhere(`${CASCADE}DrugClasses`),
      anywhere(`${CASCADE}ProductIngredients`),
    ),
  ]);
  const found = await about(context, [
    code,
    ...status.flatMap(({ replacedBy }) => replacedBy),
    ...mappings.flatMap(({ mapsTo, mappedFrom }) => [
      ...mapsTo.flatMap((target) => [target.code, ...target.alongside.codes]),
      ...mappedFrom.codes,
    ]),
    ...inPanels.flatMap(({ members, heldBy }) => [
      ...members.map(({ code }) => code),
      ...heldBy.panels.map(({ code }) => code),
    ]),
    ...inClasses.flatMap(({ in: each, withheld }) => [
      ...each.flatMap(({ class: of, through }) =>
        through === undefined ? [of] : [of, through],
      ),
      ...withheld.map(({ ingredient }) => ingredient),
    ]),
  ]);
  const coded = (each: string): Coded => ({
    code: each,
    notation: notation(uriSpaces, each),
    about: found.get(each),
  });
  const codes = ({ total, codes }: { total: number; codes: string[] }) => ({
    total,
    codes: codes.map(coded),
  });
  const system = codeSystems.find(({ uriSpace }) => code.startsWith(uriSpace));
  return {
    ...coded(code),
    ...(system?.pageTemplate !== undefined && {
      page: {
        href: system.pageTemplate.replace("{code}", () =>
          code.slice(system.uriSpace.length),
        ),
        system: system.label,
      },
    }),
    names,
    status: status.map((fact) => ({
      ...fact,
      replacedBy: fact.replacedBy.map(coded),
    })),
    mappings: mappings.map((fact) => ({
      ...fact,
      mapsTo: fact.mapsTo.map((target) => ({
        ...coded(target.code),
        alongside: codes(target.alongside),
      })),
      mappedFrom: codes(fact.mappedFrom),
    })),
    classifications,
    panels: inPanels.map((fact) => ({
      ...fact,
      members: fact.members.map(({ code, ...place }) => ({
        ...coded(code),
        ...place,
      })),
      heldBy: {
        total: fact.heldBy.total,
        panels: fact.heldBy.panels.map(({ code, ...place }) => ({
          ...coded(code),
          ...place,
        })),
      },
    })),
    classes: inClasses.map((fact) => ({
      ...fact,
      in: fact.in.map(({ relation, class: of, through }) => ({
        relation,
        class: coded(of),
        ...(through !== undefined && { through: coded(through) }),
      })),
      withheld: fact.withheld.map(({ relation, ingredient }) => ({
        relation,
        ingredient: coded(ingredient),
      })),
    })),
  };
}
