import { Refusal } from "./step.js";

/** What a query's text may hold before its outermost group: comments, IRIs and strings, whose braces open no group. */
const TOKEN =
  /#[^\n]*|<[^<>"{}|^`\\\s]*>|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\{/g;

/**
 * The comparison with `VALUES ?record { … }` opening its outermost group: Oxigraph's JavaScript build takes no initial
 * binding, and a comparison binds ?record in that group before any sub-select or MINUS reads it, so this evaluates it
 * once with ?record bound to each record given (M4).
 */
export function boundToRecords(
  query: string,
  records: readonly string[],
): string {
  for (const match of query.matchAll(TOKEN)) {
    if (match[0] !== "{") continue;
    const at = match.index + 1;
    const values = records.map((record) => `<${record}>`).join(" ");
    return `${query.slice(0, at)} VALUES ?record { ${values} }${query.slice(at)}`;
  }
  throw new Refusal("a comparison query has no group to bind ?record in");
}
