import * as oxigraph from "oxigraph";
import {
  blank,
  iri,
  literal,
  type Term,
  type Triple,
  written,
} from "../src/rdf.js";

function term(value: oxigraph.Term): Term {
  if (value.termType === "NamedNode") return iri(value.value);
  if (value.termType === "BlankNode") return blank(value.value);
  if (value.termType === "Literal")
    return value.language
      ? literal(value.value, { language: value.language })
      : literal(value.value, value.datatype.value);
  throw new Error(`no triple holds a ${value.termType}`);
}

/** The triples of a Turtle file, its relative IRIs resolved against `base`. */
export function triples(turtle: Uint8Array, base?: string): Triple[] {
  const store = new oxigraph.Store();
  store.load(turtle, {
    format: "text/turtle",
    ...(base !== undefined && { base_iri: base }),
  });
  return store
    .match()
    .map(
      (quad): Triple =>
        [term(quad.subject), term(quad.predicate), term(quad.object)] as Triple,
    );
}

const blanks = (graph: readonly Triple[]): Set<string> =>
  new Set(
    graph.flatMap((triple) =>
      triple.filter((t) => t.termType === "BlankNode").map((t) => t.value),
    ),
  );

type Colors = ReadonlyMap<string, number>;

function renamed(graph: readonly Triple[], side: string): Triple[] {
  const named = (t: Term): Term =>
    t.termType === "BlankNode" ? blank(`${side}${t.value}`) : t;
  return graph.map(([s, p, o]) => [named(s), p, named(o)] as unknown as Triple);
}

/**
 * Each blank node of both graphs colored by what it is joined to, refined until no class splits further. Both graphs
 * are refined together, so a color means the same in each.
 */
function refined(graph: readonly Triple[], colors: Colors): Colors {
  let current = colors;
  for (;;) {
    const said = (t: Term): string =>
      t.termType === "BlankNode" ? `#${current.get(t.value)}` : written(t);
    const signatures = new Map<string, string[]>();
    const add = (node: string, line: string): void => {
      const lines = signatures.get(node);
      if (lines === undefined) signatures.set(node, [line]);
      else lines.push(line);
    };
    for (const [s, p, o] of graph) {
      if (s.termType === "BlankNode") add(s.value, `>${p.value} ${said(o)}`);
      if (o.termType === "BlankNode") add(o.value, `<${p.value} ${said(s)}`);
    }
    const interned = new Map<string, number>();
    const next = new Map<string, number>();
    for (const node of [...current.keys()].sort()) {
      const signature = `${current.get(node)}|${(signatures.get(node) ?? []).sort().join(";")}`;
      if (!interned.has(signature)) interned.set(signature, interned.size);
      next.set(node, interned.get(signature) ?? 0);
    }
    if (interned.size === new Set(current.values()).size) return current;
    current = next;
  }
}

function lines(graph: readonly Triple[], colors: Colors): string[] {
  const said = (t: Term): string =>
    t.termType === "BlankNode" ? `#${colors.get(t.value)}` : written(t);
  return graph.map(([s, p, o]) => `${said(s)} ${said(p)} ${said(o)}`).sort();
}

function matched(
  a: readonly Triple[],
  b: readonly Triple[],
  colors: Colors,
): boolean {
  const both = refined([...a, ...b], colors);
  const left = lines(a, both);
  const right = lines(b, both);
  if (left.length !== right.length || left.some((line, i) => line !== right[i]))
    return false;
  const sides = [...both].filter(([node]) => node.startsWith("a"));
  const shared = sides.find(([node, color]) =>
    sides.some(([other, c]) => other !== node && c === color),
  );
  if (shared === undefined) return true;
  const [node, color] = shared;
  const pick = Math.max(...both.values()) + 1;
  for (const [candidate, other] of both) {
    if (!candidate.startsWith("b") || other !== color) continue;
    if (matched(a, b, new Map(both).set(node, pick).set(candidate, pick)))
      return true;
  }
  return false;
}

/** Why two graphs are not isomorphic, or undefined when they are. */
export function notIsomorphic(
  expected: readonly Triple[],
  found: readonly Triple[],
): string | undefined {
  const ground = (graph: readonly Triple[]): Set<string> =>
    new Set(
      graph
        .filter((triple) => triple.every((t) => t.termType !== "BlankNode"))
        .map(([s, p, o]) => `${written(s)} ${written(p)} ${written(o)} .`),
    );
  const a = renamed(expected, "a");
  const b = renamed(found, "b");
  const start = new Map(
    [...blanks(a), ...blanks(b)].map((node): [string, number] => [node, 0]),
  );
  if (matched(a, b, start)) return undefined;
  const wanted = ground(expected);
  const got = ground(found);
  const lines = [
    ...[...wanted].filter((t) => !got.has(t)).map((t) => `missing: ${t}`),
    ...[...got].filter((t) => !wanted.has(t)).map((t) => `unexpected: ${t}`),
  ];
  const statedOfBlanks = (graph: readonly Triple[]): Set<string> =>
    new Set(
      graph
        .filter((triple) => triple.some((t) => t.termType === "BlankNode"))
        .flatMap(([, p, o]) => [
          o.termType === "BlankNode"
            ? `${p.value} _`
            : `${p.value} ${written(o)}`,
        ]),
    );
  const blankWanted = statedOfBlanks(expected);
  const blankGot = statedOfBlanks(found);
  lines.push(
    ...[...blankWanted]
      .filter((t) => !blankGot.has(t))
      .map((t) => `missing of a blank node: ${t}`),
    ...[...blankGot]
      .filter((t) => !blankWanted.has(t))
      .map((t) => `unexpected of a blank node: ${t}`),
  );
  return lines.length === 0
    ? `${expected.length} triples expected, ${found.length} found, joined differently`
    : lines.join("\n");
}
