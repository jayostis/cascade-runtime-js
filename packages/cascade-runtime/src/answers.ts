import { documentName, type Files } from "@cascade-runtime/runtime";
import type { Row } from "./pod.js";

/** What a pod is, as `pod.json` holds it beside the pod's answers. */
export interface Described {
  readonly address: string;
  readonly subject: string;
  readonly title: string;
  /** The versions of the tables the pod was published with, sorted. */
  readonly tables?: readonly string[];
}

/** Where a pod's answers are kept, beside the pod and never in it. */
export interface AnswerStore {
  /** The runtime's own version, which computed every answer kept. */
  readonly runtime: string;
  /** The answers of the pod in the folder. */
  at(folder: string): Files;
}

/** Every answer kept: one per lens and question, with the key it was computed under. */
type Kept = Record<string, Record<string, { key: string; rows: Row[] }>>;

export const ANSWERS = "answers.json";
export const DESCRIBED = "pod.json";

/** What an answer was computed from: if any of it changes, so does the key. */
export interface Computed {
  readonly runtime: string;
  readonly question: string;
  readonly lens: string;
  /** `CorePod.revision()`: any step changes it. */
  readonly revision: string;
  /** The current version of each series the app holds, which a question may read. */
  readonly tables: readonly string[];
  /** The question's text, the lens's derivations in order, the layout and the build's queries. */
  readonly texts: readonly string[];
}

/** The key an answer is kept under. */
export function answerKey(computed: Computed): Promise<string> {
  return documentName(new TextEncoder().encode(JSON.stringify(computed)));
}

/** The version of a browser entry of these bytes carrying these components, which every answer it keeps is kept under. */
export async function entryVersion(
  entry: Uint8Array,
  components: readonly {
    readonly repository: string;
    readonly commit: string;
  }[],
): Promise<string> {
  return documentName(
    new TextEncoder().encode(
      JSON.stringify([await documentName(entry), components]),
    ),
  );
}

async function json(files: Files, path: string): Promise<unknown> {
  const bytes = await files.read(path);
  if (bytes === undefined) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Answers are kept only to be found again: one that cannot be written, as beside a pod on a read-only disk, is not kept. */
function written(files: Files, path: string, value: unknown): Promise<void> {
  return files
    .write(path, new TextEncoder().encode(JSON.stringify(value)))
    .catch(() => undefined);
}

function copied(rows: readonly Row[]): Row[] {
  return rows.map((row) => ({ ...row }));
}

/** A pod's kept answers and `pod.json`, in files of their own. */
export class Answers {
  readonly #files: Files;
  #kept: Promise<Kept> | undefined;
  #described: Promise<Described | undefined> | undefined;

  constructor(
    files: Files,
    readonly runtime: string,
  ) {
    this.#files = files;
  }

  /** What `pod.json` says the pod is, if it says. */
  described(): Promise<Described | undefined> {
    this.#described ??= json(this.#files, DESCRIBED).then((read) => {
      const found = read as Partial<Described> | undefined;
      return typeof found?.address === "string" &&
        typeof found.subject === "string" &&
        typeof found.title === "string"
        ? {
            address: found.address,
            subject: found.subject,
            title: found.title,
            ...(Array.isArray(found.tables) &&
            found.tables.every((version) => typeof version === "string")
              ? { tables: found.tables as readonly string[] }
              : {}),
          }
        : undefined;
    });
    return this.#described;
  }

  /** Writes `pod.json`, unless it says this already. */
  async describe(described: Described): Promise<void> {
    const found = await this.described();
    if (
      found?.address !== described.address ||
      found.subject !== described.subject ||
      found.title !== described.title
    ) {
      this.#described = Promise.resolve(described);
      await written(this.#files, DESCRIBED, described);
    }
  }

  /** The rows kept for the question under the lens, if they were kept under the key. */
  async rows(
    lens: string,
    question: string,
    key: string,
  ): Promise<Row[] | undefined> {
    const kept = (await this.#read())[lens]?.[question];
    return kept?.key === key && Array.isArray(kept.rows)
      ? copied(kept.rows)
      : undefined;
  }

  /** Keeps the rows for the question under the lens, in place of what was kept. */
  async keep(
    lens: string,
    question: string,
    key: string,
    rows: Row[],
  ): Promise<void> {
    const kept = await this.#read();
    kept[lens] = { ...kept[lens], [question]: { key, rows: copied(rows) } };
    await written(this.#files, ANSWERS, kept);
  }

  #read(): Promise<Kept> {
    this.#kept ??= json(this.#files, ANSWERS).then((found) =>
      typeof found === "object" && found !== null ? (found as Kept) : {},
    );
    return this.#kept;
  }
}
