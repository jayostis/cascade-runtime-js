/**
 * Prototype (proto/incremental-views, runtime#819): a vocabulary query restricted to some values of one of its variables,
 * the key, by a `VALUES` block put at the start of every group that reads the key, so the engine starts each from the
 * keys rather than from the whole pod. A group inside an OPTIONAL is left alone (the key may be bound there first, and a
 * constant-led OPTIONAL is re-run per row: see the vocabulary's guard test), and so is a sub-select that does not project
 * the key as itself (its key is another variable). On the keys of every row the query gives, the restricted query gives
 * the same rows: the block only drops rows whose key is not listed. The key must be bound by a required pattern in each
 * group that reads it, or a row with it unbound would join every listed value.
 */

interface Group {
  /** The index just after the group's `{`. */
  readonly open: number;
  close: number;
  readonly kind: "template" | "values" | "optional" | "select" | "group";
  readonly children: Group[];
}

const IRI = /^<[^\s<>"{}|^`\\]*>/;

/** The query's brace groups, outermost first, each with what opened it. */
function groups(query: string): Group[] {
  const top: Group[] = [];
  const stack: Group[] = [];
  const words: string[] = [];
  let at = 0;
  while (at < query.length) {
    const char = query[at] ?? "";
    if (char === "#") {
      const end = query.indexOf("\n", at);
      at = end === -1 ? query.length : end + 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const long = query.startsWith(char.repeat(3), at);
      const quote = long ? char.repeat(3) : char;
      let end = at + quote.length;
      while (end < query.length && !query.startsWith(quote, end))
        end += query[end] === "\\" ? 2 : 1;
      at = end + quote.length;
      words.push('""');
      continue;
    }
    if (char === "<") {
      const iri = IRI.exec(query.slice(at));
      if (iri !== null) {
        at += iri[0].length;
        words.push("<>");
        continue;
      }
    }
    if (char === "{") {
      const last = words.at(-1)?.toUpperCase();
      const rest = query.slice(at + 1).trimStart();
      const kind: Group["kind"] =
        last === "CONSTRUCT"
          ? "template"
          : valuesOpen(words)
            ? "values"
            : last === "OPTIONAL"
              ? "optional"
              : /^SELECT\b/i.test(rest)
                ? "select"
                : "group";
      const group: Group = { open: at + 1, close: -1, kind, children: [] };
      (stack.at(-1)?.children ?? top).push(group);
      stack.push(group);
      words.push("{");
      at += 1;
      continue;
    }
    if (char === "}") {
      const group = stack.pop();
      if (group !== undefined) group.close = at;
      words.push("}");
      at += 1;
      continue;
    }
    const word = /^[^\s{}()<"'#]+|^[()]/.exec(query.slice(at));
    if (word !== null) {
      words.push(word[0]);
      at += word[0].length;
    } else at += 1;
  }
  return top;
}

/** Whether the words end in `VALUES ?v` or `VALUES ( ?a ?b )`, so the brace about to open holds data. */
function valuesOpen(words: readonly string[]): boolean {
  if (words.at(-2)?.toUpperCase() === "VALUES") return true;
  if (words.at(-1) !== ")") return false;
  for (let back = words.length - 2; back >= 0; back--) {
    const word = words[back] ?? "";
    if (word === "(") return words[back - 1]?.toUpperCase() === "VALUES";
    if (!word.startsWith("?")) return false;
  }
  return false;
}

function mentions(text: string, variable: string): boolean {
  return new RegExp(`[?$]${variable}(?![A-Za-z0-9_])`).test(text);
}

/** Whether a sub-select projects the variable as itself: listed bare, or `*`. */
function projects(select: string, variable: string): boolean {
  const head = select.slice(0, select.search(/\bWHERE\b|\{/i));
  if (/\bSELECT\s+(DISTINCT\s+|REDUCED\s+)?\*/i.test(head)) return true;
  const bare = head.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, " ");
  return mentions(bare, variable);
}

/** The query with `VALUES ?variable { … }` at the start of every group that reads the variable, as the module says. */
export function keyed(
  query: string,
  variable: string,
  iris: readonly string[],
  options: {
    /**
     * Also put the block in an OPTIONAL group that reads the key. Sound where the key is bound before the OPTIONAL, as it
     * is in every keyed derivation; Oxigraph evaluates an OPTIONAL's group on its own and joins it after, so without the
     * block the group reads the whole pod.
     */
    readonly intoOptional?: boolean;
  } = {},
): string {
  const block = ` VALUES ?${variable} { ${iris.map((value) => `<${value}>`).join(" ")} } `;
  const at: number[] = [];
  const visit = (group: Group): void => {
    const text = query.slice(group.open, group.close);
    switch (group.kind) {
      case "template":
      case "values":
        return;
      case "optional":
        if (options.intoOptional !== true || !mentions(text, variable)) return;
        at.push(group.open);
        break;
      case "select":
        if (!projects(text, variable)) return;
        break;
      case "group":
        if (!mentions(text, variable)) return;
        at.push(group.open);
    }
    for (const child of group.children) visit(child);
  };
  for (const group of groups(query)) visit(group);
  let out = "";
  let from = 0;
  for (const index of at.sort((a, b) => a - b)) {
    out += query.slice(from, index) + block;
    from = index;
  }
  return out + query.slice(from);
}
