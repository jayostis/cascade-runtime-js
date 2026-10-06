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
  const repeated = examples.find(
    (example, index) =>
      examples.findIndex(({ iri }) => iri === example.iri) !== index,
  );
  if (repeated !== undefined)
    throw new Error(`${path} names two examples ${repeated.name}`);
  const background =
    document.feature?.children.find((child) => child.background)?.background
      ?.steps ?? [];
  return {
    path,
    folder: folderOf(path),
    examples,
    background: background.map((step) =>
      stated(step.text, step.dataTable?.rows, step.docString?.content),
    ),
  };
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
