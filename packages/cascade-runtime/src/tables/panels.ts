import type { Triple } from "@cascade-runtime/runtime";
import { notation, OWL, rowsAbout, values } from "../rows.js";
import { PAGE_SIZE, REC } from "./constants.js";
import { described } from "./references-index.js";
import type { Described, Fact, Placed, TablesContext } from "./types.js";

const NOTATIONS = new Intl.Collator("en", { numeric: true });

/** A panel row's other code, with its place, before `facts` names it. */
export interface PlaceOf {
  readonly code: string;
  readonly sequence?: number;
  readonly required?: string;
}

/**
 * In each panel members version, the rows that have the code as their panel, by their sequence, and as their member,
 * by their panel's notation. Rows are read by predicate, which a listing drops.
 */
export async function panels(
  context: TablesContext,
  code: string,
  held: readonly Fact[],
): Promise<
  (Fact & {
    members: PlaceOf[];
    heldBy: { total: number; panels: PlaceOf[] };
  })[]
> {
  const { uriSpaces } = await context.terms();
  return (
    await Promise.all(
      held.map(async (fact) => {
        const [index, text] = await Promise.all([
          context.indexes.codesIn(fact.version),
          context.indexes.text(fact.version),
        ]);
        const members: PlaceOf[] = [];
        const holding: PlaceOf[] = [];
        for (const subject of index.get(code) ?? []) {
          const rows = rowsAbout(text, subject);
          const [panel] = values(rows, `${OWL}annotatedSource`);
          const [member] = values(rows, `${OWL}annotatedTarget`);
          const [sequence] = values(rows, `${REC}panelSequence`);
          const [required] = values(rows, `${REC}observationRequiredInPanel`);
          const place = {
            ...(sequence !== undefined && { sequence: Number(sequence) }),
            ...(required !== undefined && { required }),
          };
          if (panel === code && member !== undefined)
            members.push({ code: member, ...place });
          if (member === code && panel !== undefined)
            holding.push({ code: panel, ...place });
        }
        const byNotation = (a: PlaceOf, b: PlaceOf): number =>
          NOTATIONS.compare(
            notation(uriSpaces, a.code),
            notation(uriSpaces, b.code),
          ) || (a.sequence ?? 0) - (b.sequence ?? 0);
        members.sort(
          (a, b) =>
            (a.sequence ?? Infinity) - (b.sequence ?? Infinity) ||
            byNotation(a, b),
        );
        holding.sort(byNotation);
        return members.length === 0 && holding.length === 0
          ? []
          : [
              {
                ...fact,
                members,
                heldBy: {
                  total: holding.length,
                  panels: holding.slice(0, PAGE_SIZE),
                },
              },
            ];
      }),
    )
  ).flat();
}

export async function inPanels(
  context: TablesContext,
  code: string,
): Promise<(Fact & { total: number; panels: readonly Placed[] })[]> {
  const references = await context.references();
  const held = context.currentOf(references, `${REC}PanelMembers`);
  const found = (await panels(context, code, held)).filter(
    ({ heldBy }) => heldBy.total > 0,
  );
  const about = await context.about(
    found.flatMap(({ heldBy }) => heldBy.panels.map((each) => each.code)),
  );
  return found.map(({ series, version, heldBy }) => ({
    series,
    version,
    total: heldBy.total,
    panels: heldBy.panels.map(({ code: panel, ...place }) => ({
      code: panel,
      notation: about.get(panel)!.notation,
      about: about.get(panel),
      ...place,
    })),
  }));
}

export async function panelRows(
  context: TablesContext,
  panel: string,
): Promise<Described[]> {
  const references = await context.references();
  const terms = await context.terms();
  const versions = context
    .currentOf(references, `${REC}PanelMembers`)
    .map(({ version }) => version);
  return Promise.all(
    versions.map(async (version) => {
      await context.indexes.codesIn(version);
      const nested = new Set([panel]);
      const seen = new Set<string>();
      const rows: Triple[] = [];
      for (let level = [panel]; level.length > 0;) {
        const bySubject = new Map<string, Triple[]>();
        for (const triple of await references.rows(version, {
          codes: new Set(level),
          terms,
        }))
          bySubject.set(triple[0].value, [
            ...(bySubject.get(triple[0].value) ?? []),
            triple,
          ]);
        level = [];
        for (const [subject, triples] of bySubject) {
          const objectOf = (property: string): string | undefined =>
            triples.find(([, each]) => each.value === property)?.[2].value;
          const source = objectOf(`${OWL}annotatedSource`);
          const member = objectOf(`${OWL}annotatedTarget`);
          if (source === undefined || !nested.has(source) || seen.has(subject))
            continue;
          seen.add(subject);
          rows.push(...triples);
          if (member !== undefined && !nested.has(member)) {
            nested.add(member);
            level.push(member);
          }
        }
      }
      return described(references, version, rows);
    }),
  );
}
