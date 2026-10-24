import { Refusal } from "./step.js";

/**
 * What a query's text may hold before its outermost group: long and short strings, comments, IRIs and a prefixed name's
 * escaped character, whose braces and number signs open no group and no comment.
 */
const TOKEN =
  /"""(?:[^"\\]|\\.|"(?!""))*"""|'''(?:[^'\\]|\\.|'(?!''))*'''|#[^\n]*|<[^<>"{}|^`\\\s]*>|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\\.|\{/g;

/**
 * The comparison with `VALUES ?record { … }` opening its outermost group: Oxigraph's JavaScript build takes no initial
 * binding, and a comparison binds ?record in that group before any sub-select or MINUS reads it, so this evaluates it
 * once with ?record bound to each record given (M4).
 */
export function boundToRecords(
  query: string,
  records: readonly string[],
): string {
  const values = records.map((record) => `<${record}>`).join(" ");
  return opening(query, `VALUES ?record { ${values} }`);
}

/**
 * The comparison with `VALUES (?record ?other) { … }` opening its outermost group: its rows for those ordered pairs
 * alone, as a join with the whole group gives them wherever the group binds ?other.
 */
export function boundToPairs(
  query: string,
  pairs: readonly (readonly [string, string])[],
): string {
  const values = pairs
    .map(([record, other]) => `(<${record}> <${other}>)`)
    .join(" ");
  return opening(query, `VALUES (?record ?other) { ${values} }`);
}

function opening(query: string, block: string): string {
  for (const match of query.matchAll(TOKEN)) {
    if (match[0] !== "{") continue;
    const at = match.index + 1;
    return `${query.slice(0, at)} ${block}${query.slice(at)}`;
  }
  throw new Refusal("a comparison query has no group to bind ?record in");
}
