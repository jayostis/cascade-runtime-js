import { written } from "./rdf.js";
import type { Row, Rows } from "./store.js";

function key(row: Row): string {
  return [...row]
    .map(([name, term]) => `?${name}=${written(term)}`)
    .sort()
    .join(" ");
}

function counted(rows: readonly Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

/**
 * Why the rows found differ from the rows expected, compared as a multiset with every term exact, or undefined when
 * they do not.
 */
export function differences(expected: Rows, found: Rows): string | undefined {
  for (const row of expected.rows) {
    for (const term of row.values()) {
      if (term.termType === "BlankNode")
        throw new Error(
          "an expected row holds a blank node, which nothing can match",
        );
    }
  }
  const wanted = [...new Set(expected.variables)].sort();
  const got = [...new Set(found.variables)].sort();
  if (wanted.join(" ") !== got.join(" ")) {
    return `expected the variables ${wanted.join(", ")}, found ${got.join(", ")}`;
  }
  const expectedCounts = counted(expected.rows);
  const foundCounts = counted(found.rows);
  const lines: string[] = [];
  for (const row of new Set([
    ...expectedCounts.keys(),
    ...foundCounts.keys(),
  ])) {
    const difference =
      (expectedCounts.get(row) ?? 0) - (foundCounts.get(row) ?? 0);
    for (let i = 0; i < Math.abs(difference); i++)
      lines.push(`${difference > 0 ? "missing" : "unexpected"}: ${row}`);
  }
  return lines.length === 0 ? undefined : lines.sort().join("\n");
}
