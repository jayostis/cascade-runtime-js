export type Happened =
  | { readonly kind: "creation" }
  | {
      readonly kind: "import";
      readonly export: string;
      readonly converted: string;
    }
  | { readonly kind: "entry"; readonly file: string }
  | { readonly kind: "judgment"; readonly file: string }
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "matcher"; readonly takes?: string };

export type StepKind = Happened["kind"];

const KINDS: readonly StepKind[] = [
  "creation",
  "import",
  "entry",
  "judgment",
  "reference",
  "matcher",
];

export interface Step {
  readonly name: string;
  readonly when: string;
  readonly happened: Happened;
}

/** A story as runtime/rules.md states it; every file it names is relative to the story's own folder. */
export interface Story {
  readonly address: string;
  readonly subject: string;
  readonly steps: readonly Step[];
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "")
    throw new Error(`${what} is not a string`);
  return value;
}

function happened(raw: Record<string, unknown>, name: string): Happened {
  const kinds = KINDS.filter((kind) => kind in raw);
  if (kinds.length !== 1)
    throw new Error(`step ${name} is not one of ${KINDS.join(", ")}`);
  const [kind] = kinds as [StepKind];
  const value = raw[kind];
  switch (kind) {
    case "creation":
      return { kind };
    case "import": {
      const { export: folder, converted } = (value ?? {}) as Record<
        string,
        unknown
      >;
      return {
        kind,
        export: text(folder, `step ${name}'s export`),
        converted: text(converted, `step ${name}'s converted`),
      };
    }
    case "entry":
    case "judgment":
      return { kind, file: text(value, `step ${name}'s ${kind}`) };
    case "reference":
      return { kind, name: text(value, `step ${name}'s reference`) };
    case "matcher": {
      const { takes } = (value ?? {}) as Record<string, unknown>;
      return takes === undefined
        ? { kind }
        : { kind, takes: text(takes, `step ${name}'s takes`) };
    }
  }
}

export function parseStory(json: string): Story {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) throw new Error("the story has no steps");
  const steps = (raw.steps as Record<string, unknown>[]).map((step): Step => {
    const name = text(step.name, "a step's name");
    return {
      name,
      when: text(step.when, `step ${name}'s when`),
      happened: happened(step, name),
    };
  });
  const names = steps.map((step) => step.name);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined)
    throw new Error(`the story names two steps ${repeated}`);
  const takes = new Set(names);
  steps.forEach((step, index) => {
    if (step.happened.kind !== "matcher") return;
    if (index === 0)
      throw new Error(
        `step ${step.name} is a matcher step with no step before it to read through`,
      );
    if (step.happened.takes !== undefined && !takes.has(step.happened.takes)) {
      throw new Error(
        `step ${step.name} takes the records of ${step.happened.takes}, which is no step of the story`,
      );
    }
  });
  const address = text(raw.address, "the story's address");
  if (!address.endsWith("/"))
    throw new Error("the story's address does not end in a slash");
  return { address, subject: text(raw.subject, "the story's subject"), steps };
}
