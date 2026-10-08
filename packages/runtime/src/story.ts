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
  | { readonly kind: "matcher"; readonly takes?: string }
  | { readonly kind: "open"; readonly tables: string };

export type StepKind = Happened["kind"];

export interface Step {
  readonly name: string;
  readonly when: string;
  readonly happened: Happened;
}

/** A pod's address and subject, and what happened to it, in order; every file a step names is under the story's folder. */
export interface Story {
  readonly address: string;
  readonly subject: string;
  readonly steps: readonly Step[];
}
