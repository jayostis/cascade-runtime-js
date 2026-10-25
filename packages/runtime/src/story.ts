export type Happened =
  | { readonly kind: "creation" }
  | {
      readonly kind: "import";
      readonly export: string;
      readonly converted: string;
    }
  | { readonly kind: "connect"; readonly folder: string }
  | { readonly kind: "entry"; readonly file: string }
  | {
      readonly kind: "judgment";
      readonly file: string;
      /** The name each earlier step is performed under, by the name the story gives it, where the two differ. */
      readonly steps?: Readonly<Record<string, string>>;
    }
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "matcher"; readonly takes?: string }
  | { readonly kind: "open"; readonly tables: string }
  | { readonly kind: "writer" }
  | { readonly kind: "sync"; readonly from: number };

export type StepKind = Happened["kind"];

export interface Step {
  readonly name: string;
  readonly when: string;
  readonly happened: Happened;
  /** The writer that takes the step, numbered from 0, the pod's first; absent for the first. */
  readonly writer?: number;
}

/** A pod's address and subject, and what happened to it, in order; every file a step names is under the story's folder. */
export interface Story {
  readonly address: string;
  readonly subject: string;
  readonly steps: readonly Step[];
}
