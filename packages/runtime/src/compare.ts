import { written } from "./rdf.js";
import type { Row, Rows } from "./store.js";

function key(row: Row): string {
  return [...row]
    .map(([name, term]) => `?${name}=${written(term)}`)
    .sort()
    .join(" ");
}

/** How two multisets of rows differ, each row as a string, or undefined when they do not. */
export function compared(
  expected: readonly string[],
  found: readonly string[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const row of expected) counts.set(row, (counts.get(row) ?? 0) + 1);
  for (const row of found) counts.set(row, (counts.get(row) ?? 0) - 1);
  const lines: string[] = [];
  for (const [row, count] of counts)
    for (let i = 0; i < Math.abs(count); i++)
      lines.push(`${count > 0 ? "missing" : "unexpected"}: ${row}`);
  return lines.length === 0 ? undefined : lines.sort().join("\n");
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
  return compared(expected.rows.map(key), found.rows.map(key));
}
