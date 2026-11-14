import {
  AstBuilder,
  compile,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";
import { type GherkinDocument, IdGenerator } from "@cucumber/messages";
import { type Files, folderOf, readText } from "./files.js";

/** One step as an example states it: its text, and the table or the text beneath it. */
export interface StatedStep {
  readonly text: string;
  readonly table?: readonly (readonly string[])[];
  readonly docString?: string;
}

/** One example of a feature file, its background's steps first, as Gherkin's pickles give it. */
export interface Example {
  /** The feature file's path in the vocabulary. */
  readonly feature: string;
  /** The rule the example is under, by its title. */
  readonly rule?: string;
  readonly name: string;
  /** The example's test: the feature file's IRI, `#`, and its name in lower case, joined by hyphens. */
  readonly iri: string;
  readonly steps: readonly StatedStep[];
}

/** A feature file read: its examples, and its own background's steps. */
export interface Feature {
  readonly path: string;
  readonly folder: string;
  readonly examples: readonly Example[];
  readonly background: readonly StatedStep[];
  /** The first paragraph of the Feature's description as one line, when a paragraph follows it, else empty. */
  readonly introduction: string;
}

/** The first paragraph of a feature's description as one line, or empty when the description is only that paragraph. */
export function introductionOf(description: string | undefined): string {
  const paragraphs = (description ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim().replace(/\s*\r?\n\s*/g, " "))
    .filter((paragraph) => paragraph !== "");
  return paragraphs.length > 1 ? (paragraphs[0] ?? "") : "";
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stated(
  text: string,
  rows?: readonly { readonly cells: readonly { readonly value: string }[] }[],
  docString?: string,
): StatedStep {
  const table = rows?.map((row) => row.cells.map((cell) => cell.value));
  return {
    text,
    ...(table === undefined ? {} : { table }),
    ...(docString === undefined ? {} : { docString }),
  };
}

function rulesOf(document: GherkinDocument): Map<string, string> {
  const rules = new Map<string, string>();
  for (const child of document.feature?.children ?? []) {
    if (child.rule === undefined) continue;
    for (const inner of child.rule.children)
      if (inner.scenario !== undefined)
        rules.set(inner.scenario.id, child.rule.name);
  }
  return rules;
}

/** The feature file at the path, parsed by Gherkin's own parser and compiled to its pickles. */
export async function readFeature(
  files: Files,
  path: string,
): Promise<Feature> {
  const newId = IdGenerator.incrementing();
  const document = new Parser(
    new AstBuilder(newId),
    new GherkinClassicTokenMatcher(),
  ).parse(await readText(files, path));
  const uri = files.iri + path;
  const pickles = compile({ ...document, uri }, uri, newId);
  const rules = rulesOf(document);
  const examples = pickles.map((pickle): Example => {
    const rule = rules.get(pickle.astNodeIds[0] ?? "");
    return {
      feature: path,
      ...(rule === undefined ? {} : { rule }),
      name: pickle.name,
      iri: `${uri}#${slug(pickle.name)}`,
      steps: pickle.steps.map((step) =>
        stated(
          step.text,
          step.argument?.dataTable?.rows,
          step.argument?.docString?.content,
        ),
      ),
    };
  });
  const background =
    document.feature?.children.find((child) => child.background)?.background
      ?.steps ?? [];
  return {
    path,
    folder: folderOf(path),
    introduction: introductionOf(document.feature?.description),
    examples,
    background: background.map((step) =>
      stated(step.text, step.dataTable?.rows, step.docString?.content),
    ),
  };
}

/** An example as the feature file writes it: its name, its test, and its lines, dedented. */
export interface WrittenExample {
  readonly name: string;
  readonly iri: string;
  readonly text: string;
}

/** A rule as the feature file writes it; the examples outside any rule are under one with no name. */
export interface WrittenRule {
  readonly name: string;
  readonly description: string;
  readonly examples: readonly WrittenExample[];
}

/** A feature file as written, for a reader rather than a run. */
export interface WrittenFeature {
  readonly path: string;
  readonly name: string;
  readonly description: string;
  /** The lines of its own background, dedented, or empty. */
  readonly background: string;
  readonly rules: readonly WrittenRule[];
}

function dedented(lines: readonly string[]): string {
  const kept = [...lines];
  while (kept.length > 0 && (kept.at(-1) ?? "").trim() === "") kept.pop();
  const indent = Math.min(
    ...kept
      .filter((line) => line.trim() !== "")
      .map((line) => line.length - line.trimStart().length),
  );
  return kept.map((line) => line.slice(indent)).join("\n");
}

const unindented = (description: string | undefined): string =>
  (description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

/** The feature file at the path, as written: each rule's description and each example's own lines. */
export async function readWrittenFeature(
  files: Files,
  path: string,
): Promise<WrittenFeature> {
  const text = await readText(files, path);
  const lines = text.split(/\r?\n/);
  const document = new Parser(
    new AstBuilder(IdGenerator.incrementing()),
    new GherkinClassicTokenMatcher(),
  ).parse(text);
  const feature = document.feature;
  const children = feature?.children ?? [];
  const starts: number[] = [];
  for (const child of children) {
    const node = child.rule ?? child.scenario ?? child.background;
    if (node !== undefined) starts.push(node.location.line);
    for (const inner of child.rule?.children ?? []) {
      const nested = inner.scenario ?? inner.background;
      if (nested !== undefined) starts.push(nested.location.line);
    }
  }
  starts.sort((a, b) => a - b);
  const linesFrom = (line: number): string => {
    const end = starts.find((start) => start > line) ?? lines.length + 1;
    return dedented(lines.slice(line - 1, end - 1));
  };
  const example = (scenario: {
    readonly name: string;
    readonly location: { readonly line: number };
  }): WrittenExample => ({
    name: scenario.name,
    iri: `${files.iri}${path}#${slug(scenario.name)}`,
    text: linesFrom(scenario.location.line),
  });
  const rules: WrittenRule[] = [];
  const loose: WrittenExample[] = [];
  for (const child of children) {
    if (child.scenario !== undefined) loose.push(example(child.scenario));
    if (child.rule !== undefined)
      rules.push({
        name: child.rule.name,
        description: unindented(child.rule.description),
        examples: child.rule.children.flatMap(({ scenario }) =>
          scenario === undefined ? [] : [example(scenario)],
        ),
      });
  }
  if (loose.length > 0)
    rules.unshift({ name: "", description: "", examples: loose });
  const background = children.find((child) => child.background)?.background;
  return {
    path,
    name: feature?.name ?? path,
    description: unindented(feature?.description),
    background:
      background === undefined ? "" : linesFrom(background.location.line),
    rules,
  };
}

/** What a kit says of a step that ran and left no act: it wrote nothing, or it was refused. */
export type StepWrote = "nothing" | "refused";

/**
 * The steps a kit's examples say wrote no file, or wrote none because they were refused, read from the examples as
 * written: `"E7" wrote no file` (one name or a list of them), an empty list of `wrote these reference descriptions`, and
 * `that step is refused` after reading the pod as it stood after a step. A refusal outranks a plain nothing.
 */
export function stepsThatWroteNoFile(
  feature: WrittenFeature,
): ReadonlyMap<string, StepWrote> {
  const said = new Map<string, StepWrote>();
  const say = (name: string, how: StepWrote) => {
    if (said.get(name) !== "refused") said.set(name, how);
  };
  for (const { text } of feature.rules.flatMap(({ examples }) => examples)) {
    const lines = text.split("\n").map((line) => line.trim());
    lines.forEach((line, at) => {
      const none = /^(?:Then|And) (.+) wrote no file$/.exec(line);
      if (none !== null)
        for (const [, name] of none[1]!.matchAll(/"([^"]+)"/g))
          say(name!, "nothing");
      const described =
        /^(?:Then|And) "([^"]+)" wrote these reference descriptions:$/.exec(
          line,
        );
      if (described !== null && !(lines[at + 2] ?? "").startsWith("|"))
        say(described[1]!, "nothing");
    });
    const after = /When the pod is read as it stood after "([^"]+)"/.exec(text);
    if (after !== null && /^\s*Then that step is refused\s*$/m.test(text))
      say(after[1]!, "refused");
  }
  return said;
}

/** Every feature file of the rules, under `runtime/`, and of each kit, a folder under `conformance/`. */
export async function featuresOf(vocabulary: Files): Promise<string[]> {
  return [
    ...(await vocabulary.list("runtime")),
    ...(await vocabulary.list("conformance")),
  ].filter((path) =>
    /^(runtime|conformance\/[^/]+)\/[^/]+\.feature$/.test(path),
  );
}
