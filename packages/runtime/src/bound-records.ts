import { Refusal } from "./step.js";

/**
 * What a query's text may hold: long and short strings, comments, IRIs and a prefixed name's escaped character, whose
 * braces and number signs open no group and no comment.
 */
const TOKEN =
  /"""(?:[^"\\]|\\.|"(?!""))*"""|'''(?:[^'\\]|\\.|'(?!''))*'''|#[^\n]*|<[^<>"{}|^`\\\s]*>|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\\.|\{/g;

/** The comment line that marks a group, and what may stand between it and the group's brace (M4). */
const MARK = /^#\s*bound:\s*\?record\s*$/;
const BEFORE_BRACE = /^\s*(?:WHERE\s*)?$/i;

/**
 * The comparison with `VALUES ?record { … }` opening its outermost group and each group a `# bound: ?record` line
 * marks: Oxigraph's JavaScript build takes no initial binding, and a comparison binds ?record in those groups before
 * any other sub-select or MINUS reads it, so this evaluates it once with ?record bound to each record given (M4). A
 * marked group is the record's side of a comparison that works each side out in a sub-select, which would otherwise
 * read every record in the pod.
 */
export function boundToRecords(
  query: string,
  records: readonly string[],
): string {
  const { outermost, marked } = groups(query);
  const block = valuesOf(records);
  return opened(
    query,
    [outermost, ...marked].map((at) => [at, block]),
  );
}

/**
 * The comparison with `VALUES (?record ?other) { … }` opening its outermost group: its rows for those ordered pairs
 * alone, as a join with the whole group gives them wherever the group binds ?other. Each marked group is opened with
 * the pairs' records as well, so the sub-select that reads the record's side reads those records alone.
 */
export function boundToPairs(
  query: string,
  pairs: readonly (readonly [string, string])[],
): string {
  const { outermost, marked } = groups(query);
  const values = pairs
    .map(([record, other]) => `(<${record}> <${other}>)`)
    .join(" ");
  const records = valuesOf([...new Set(pairs.map(([record]) => record))]);
  return opened(query, [
    [outermost, `VALUES (?record ?other) { ${values} }`],
    ...marked.map((at): [number, string] => [at, records]),
  ]);
}

function valuesOf(records: readonly string[]): string {
  return `VALUES ?record { ${records.map((record) => `<${record}>`).join(" ")} }`;
}

/** Just after the outermost group's brace, and just after each marked group's. */
function groups(query: string): { outermost: number; marked: number[] } {
  let outermost: number | undefined;
  const marked: number[] = [];
  let mark: number | undefined;
  for (const match of query.matchAll(TOKEN)) {
    const token = match[0];
    const end = match.index + token.length;
    if (token !== "{") {
      mark = token.startsWith("#") && MARK.test(token) ? end : undefined;
      continue;
    }
    outermost ??= end;
    if (mark !== undefined && BEFORE_BRACE.test(query.slice(mark, match.index)))
      marked.push(end);
    mark = undefined;
  }
  if (outermost === undefined)
    throw new Refusal("a comparison query has no group to bind ?record in");
  return { outermost, marked };
}

function opened(
  query: string,
  blocks: readonly (readonly [number, string])[],
): string {
  let text = query;
  for (const [at, block] of [...blocks].sort(([a], [b]) => b - a))
    text = `${text.slice(0, at)} ${block}${text.slice(at)}`;
  return text;
}
