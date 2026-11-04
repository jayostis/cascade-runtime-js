/** Where on the front page a section's rows go: the part of the page that is for a newcomer building, or for one looking at a pod. */
export type Kind = "build" | "explore";

/** A section's line on the front page. */
export interface Row {
  /** Relative to the tree's root, or absolute. */
  readonly href: string;
  readonly label: string;
  /** Said after the link. */
  readonly about?: string;
  /** A second, quieter link on the same line. */
  readonly also?: { readonly href: string; readonly label: string };
}

/**
 * One part of the hub: the files it writes into the tree and the lines it adds to the front page. A new part is one
 * module and one line in the list.
 */
export interface Section<Ctx> {
  /** The section's entry page in the tree, which `build` writes. */
  readonly path: string;
  readonly title: string;
  readonly kind: Kind;
  /** What the section is, in a line; `llms.txt` lists the entry page with it when no row of the section names that page. */
  readonly about?: string;
  /** What its files are built from, as `index.json` says; the section's title when none. */
  readonly source?: string;
  /** Left out of a build that skips the kits, because it is made of them. */
  readonly needsKits?: boolean;
  /** Every file of the section, by path from the tree's root. */
  build(ctx: Ctx): Promise<ReadonlyMap<string, Uint8Array>>;
  /** After `build`: the lines this section adds to the front page. */
  rows(ctx: Ctx): Promise<readonly Row[]>;
}

export interface BuiltSection<Ctx> {
  readonly section: Section<Ctx>;
  /** What the section wrote. */
  readonly paths: readonly string[];
  readonly rows: readonly Row[];
}

/** What was written, as the last phase sees it. */
export interface Walk<Ctx> {
  /** Every file, the front page included. */
  readonly tree: ReadonlyMap<string, Uint8Array>;
  readonly sections: readonly BuiltSection<Ctx>[];
}

/** The last phase: reads what was written and returns the files it makes from it, such as an index. */
export type Finisher<Ctx> = (
  walk: Walk<Ctx>,
  ctx: Ctx,
) => Promise<ReadonlyMap<string, Uint8Array>>;

export type Rows = ReadonlyMap<Kind, readonly Row[]>;

export interface BuildOptions<Ctx> {
  readonly sections: readonly Section<Ctx>[];
  readonly ctx: Ctx;
  /** The front page and what it needs, from every section's rows. */
  readonly front: (
    rows: Rows,
    ctx: Ctx,
  ) =>
    ReadonlyMap<string, Uint8Array> | Promise<ReadonlyMap<string, Uint8Array>>;
  readonly finishers?: readonly Finisher<Ctx>[];
  /** Sections for which it is true are neither built nor listed. */
  readonly skip?: (section: Section<Ctx>) => boolean;
}

/** Whether a link stays inside the tree. */
export const isLocal = (link: string): boolean =>
  /^(?![a-z][a-z0-9+.-]*:|\/\/|#)/i.test(link);

/** The file a link in the tree reaches: a folder's is its index. */
export function pageOf(link: string): string {
  const path = link.replace(/[?#].*$/, "");
  return path === "" || path.endsWith("/") ? `${path}index.html` : path;
}

function add(
  tree: Map<string, Uint8Array>,
  files: ReadonlyMap<string, Uint8Array>,
  by: string,
): void {
  for (const [path, bytes] of files) {
    if (
      path.includes("\\") ||
      /^[a-z]:/i.test(path) ||
      path
        .split("/")
        .some((part) => part === ".." || part === "." || part === "")
    )
      throw new Error(`${by} writes ${path}, which is not inside the tree`);
    if (tree.has(path))
      throw new Error(`${by} writes ${path}, which is already in the tree`);
    tree.set(path, bytes);
  }
}

/** Builds every section in order, then the front page from their rows, then the finishers; refuses a row that links what neither a section nor a finisher wrote. */
export async function buildTree<Ctx>({
  sections,
  ctx,
  front,
  finishers = [],
  skip = () => false,
}: BuildOptions<Ctx>): Promise<Walk<Ctx>> {
  const tree = new Map<string, Uint8Array>();
  const built: BuiltSection<Ctx>[] = [];
  for (const section of sections.filter((it) => !skip(it))) {
    const files = await section.build(ctx);
    if (!files.has(section.path))
      throw new Error(
        `the section ${section.title} does not write ${section.path}`,
      );
    add(tree, files, `the section ${section.title}`);
    built.push({
      section,
      paths: [...files.keys()],
      rows: await section.rows(ctx),
    });
  }
  const rows = new Map<Kind, Row[]>();
  for (const { section, rows: listed } of built)
    rows.set(section.kind, [...(rows.get(section.kind) ?? []), ...listed]);
  add(tree, await front(rows, ctx), "the front page");
  const walk: Walk<Ctx> = { tree, sections: built };
  for (const finish of finishers)
    add(tree, await finish(walk, ctx), "a finisher");
  for (const { section, rows: listed } of built)
    for (const { href, also } of listed)
      for (const link of also === undefined ? [href] : [href, also.href])
        if (isLocal(link) && !tree.has(pageOf(link)))
          throw new Error(
            `the section ${section.title} has a row that links ${link}, which nothing writes`,
          );
  return walk;
}
