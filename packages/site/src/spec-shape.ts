import type { TestCase } from "./junit.js";

/**
 * Whether a package's test results read as a specification, judged over the cases of its JUnit report (`readJunit`) and
 * the `test/spec.json` beside its tests. The rules are the grammar on jayostis/cascade-runtime-js#635, the standard and its
 * addendum; what a title means is for a reader to judge, and is not checked here.
 */
export type ShapeRule =
  "capability" | "depth" | "level-2" | "verb" | "shaped" | "glossary";

export interface ShapeProblem {
  readonly rule: ShapeRule;
  /** The case as a reader sees it, its describes and name joined by ` › `; for `shaped` the file; for `glossary` the term. */
  readonly case: string;
  readonly message: string;
  /** The test file (or module) and the line the case is declared on, when the report says. */
  readonly suite?: string;
  readonly line?: number;
}

export interface ShapeReport {
  /** Why nothing was checked, when the spec lists no capabilities. */
  readonly skipped?: string;
  /** How many cases the rules ran over. */
  readonly checked: number;
  readonly problems: readonly ShapeProblem[];
}

/** The most levels a case may sit at, its leaf counted: a capability, a function or situation, the leaf. */
const MOST_LEVELS = 3;

const SEPARATOR = " › ";

/** Singular present-tense verbs the `-s` rule would read wrongly, or not at all. */
const VERBS = new Set(["is", "has", "does", "goes"]);

/** Words ending in `s` that are no verb: what a leaf beginning with one is not saying. */
const FALSE_FRIENDS = new Set([
  "its",
  "this",
  "his",
  "hers",
  "ours",
  "theirs",
  "yours",
  "was",
  "as",
  "us",
  "yes",
  "plus",
  "thus",
  "status",
  "bonus",
  "always",
  "sometimes",
  "perhaps",
  "unless",
  "across",
  "towards",
  "afterwards",
  "besides",
  "series",
  "species",
  "news",
  "analysis",
  "basis",
  "axis",
  "https",
  "ids",
  "alias",
  "canvas",
  "lens",
  "focus",
  "versus",
]);

/** Second words that show the first is a noun the leaf is about, not a verb: "rows are returned", "renewals of one drug". */
const NOUN_PARTNERS = new Set(["are", "were", "have", "do", "of"]);

const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\([^)]*\))?`;
const CODE_ITEM = String.raw`\`?${IDENTIFIER}\`?`;
/** One or more function, method or constant names: `terms`, `pod.import()`, `openPod(), sixWords() and typedWords()`. */
const CODE = new RegExp(
  String.raw`^${CODE_ITEM}(?:(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)${CODE_ITEM})*$`,
);
const SITUATION = /^(?:when|given|with)\b/i;

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((one): one is string => typeof one === "string")
    : [];
}

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

/** The folder of the spec, as the report names files: `packages/<name>/test` for a spec at `…/packages/<name>/test/spec.json`. */
function specFolder(specPath: string): string {
  const path = posix(specPath);
  const at = path.lastIndexOf("packages/");
  const from = at === -1 ? path : path.slice(at);
  return from.split("/").slice(0, -1).join("/");
}

function firstWord(title: string): string {
  return /^[^\s,;:]*/.exec(title)?.[0] ?? "";
}

/** Whether a leaf's first word is a singular present-tense verb: a listed one, or a lower-case word ending in `s`. */
function isVerb(
  word: string,
  next: string,
  allowed: ReadonlySet<string>,
): boolean {
  if (allowed.has(word)) return true;
  if (!/^[a-z][a-z'-]*$/.test(word)) return false;
  if (VERBS.has(word)) return true;
  if (FALSE_FRIENDS.has(word) || NOUN_PARTNERS.has(next)) return false;
  return (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("'s") &&
    !word.endsWith("ous")
  );
}

function namesCodeOrSituation(title: string): boolean {
  return SITUATION.test(title) || CODE.test(title.trim());
}

/**
 * The rules over a package's cases. `specPath` says which package that is, and so which cases are its own. A spec that lists
 * no `capabilities` is skipped. Otherwise a case is checked when its file is listed in `shaped` or `build`, or when the spec
 * lists no `shaped` at all, which is every case of the package.
 *
 * A checked case sits under a listed capability, at most three levels deep with its leaf, with a second level that names
 * code or begins "when", "given" or "with", and a leaf beginning with a singular present-tense verb. A case of a file listed
 * under `build`, or under a capability `build` names, is held to the leaf's grammar only. `allow` lists first words a leaf may begin with that the rule rejects.
 * A `shaped` file with no case in the report, and a glossary term defined twice, are problems too.
 */
export function checkShape(
  cases: readonly TestCase[],
  spec: unknown,
  specPath: string,
): ShapeReport {
  const object =
    typeof spec === "object" && spec !== null && !Array.isArray(spec)
      ? (spec as Record<string, unknown>)
      : {};
  const capabilities = new Set(stringsOf(object["capabilities"]));
  if (capabilities.size === 0)
    return {
      skipped: "the spec lists no capabilities",
      checked: 0,
      problems: [],
    };

  const tests = specFolder(specPath);
  const root = tests.split("/").slice(0, -1).join("/");
  const under = (file: string): string =>
    tests === "" ? file : `${tests}/${file}`;
  const own = (suite: string): boolean =>
    root === "" || suite.startsWith(`${root}/`);
  const shaped = Array.isArray(object["shaped"])
    ? stringsOf(object["shaped"]).map(under)
    : undefined;
  const built = stringsOf(object["build"]);
  const buildFiles = new Set(built.map(under));
  const allowed = new Set(stringsOf(object["allow"]));
  const problems: ShapeProblem[] = [];
  const seen = new Set<string>();
  let checked = 0;

  for (const one of cases) {
    const suite = posix(one.suite);
    if (!own(suite)) continue;
    const inBuildFile = buildFiles.has(suite);
    if (shaped !== undefined && !inBuildFile && !shaped.includes(suite))
      continue;
    const isBuild = inBuildFile || built.includes(one.describes[0] ?? "");
    seen.add(suite);
    checked += 1;
    const title = [...one.describes, one.name].join(SEPARATOR);
    const found = (rule: ShapeRule, message: string): void => {
      problems.push({
        rule,
        case: title,
        message,
        suite,
        ...(one.line === undefined ? {} : { line: one.line }),
      });
    };

    const [capability, second] = one.describes;
    if (!isBuild && (capability === undefined || !capabilities.has(capability)))
      found(
        "capability",
        capability === undefined
          ? "the case is under no describe, so under no capability"
          : `"${capability}" is not a capability the spec lists`,
      );
    const levels = one.describes.length + 1;
    if (levels > MOST_LEVELS)
      found(
        "depth",
        `the case sits ${levels} levels deep; at most ${MOST_LEVELS}, the leaf counted`,
      );
    if (!isBuild && second !== undefined && !namesCodeOrSituation(second))
      found(
        "level-2",
        `"${second}" names neither code nor a situation beginning "when", "given" or "with"`,
      );
    const word = firstWord(one.name);
    const next = one.name.trim().split(/\s+/)[1] ?? "";
    if (!isVerb(word, next, allowed))
      found(
        "verb",
        `the leaf begins "${word}", not a singular present-tense verb such as "returns"`,
      );
  }

  for (const file of shaped ?? [])
    if (!seen.has(file))
      problems.push({
        rule: "shaped",
        case: tests === "" ? file : file.slice(tests.length + 1),
        message:
          "the spec lists it as shaped and the report holds no case of it",
      });

  const terms = new Set<string>();
  const glossary = Array.isArray(object["glossary"]) ? object["glossary"] : [];
  for (const entry of glossary) {
    const term = (entry as { term?: unknown } | null)?.term;
    if (typeof term !== "string") continue;
    const key = term.toLowerCase();
    if (terms.has(key))
      problems.push({
        rule: "glossary",
        case: term,
        message: "the glossary defines this term twice",
      });
    terms.add(key);
  }
  return { checked, problems };
}
