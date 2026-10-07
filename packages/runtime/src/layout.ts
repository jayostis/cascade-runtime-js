import { type Files, readText } from "./files.js";
import { fileStem } from "./names.js";
import type { StoreFactory } from "./store.js";

export const LAYOUT_FILE = "runtime/pod-layout.ttl";
export const LAYOUT_GRAPH = "urn:cascade:pod-layout";
const BASE = "https://pod.invalid/";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const DCT = "http://purl.org/dc/terms/";
const PROV = "http://www.w3.org/ns/prov#";
const CASCADE = "https://ns.cascadeprotocol.org/core/v1#";
const FOAF = "http://xmlns.com/foaf/0.1/";
const PIM = "http://www.w3.org/ns/pim/space#";

/** One entry of the layout: a file, a folder, or the property whose value's folder a thing goes in. */
export class Placement {
  constructor(
    readonly kind: string | undefined,
    readonly file: string | undefined,
    readonly folder: string | undefined,
    readonly filedWith: string | undefined,
    readonly forSubjectsOf: string | undefined,
    readonly fanOut: number,
    readonly writtenBy: string | undefined,
    readonly title: string | undefined,
    readonly storesBytes: boolean,
    /** Whether the build writes this view at every build, not only once the pod holds a record of its kind. */
    readonly writtenAlways: boolean = false,
  ) {}

  /** The path of the file holding the thing named `name`: this placement's file, or one in `folder` or its own. */
  path(name: string, folder?: string): string {
    if (this.file !== undefined) return this.file;
    const stem = fileStem(name);
    const fanned = this.fanOut > 0 ? `${stem.slice(0, this.fanOut)}/` : "";
    return `${folder ?? this.folder ?? ""}${fanned}${stem}${this.storesBytes ? "" : ".ttl"}`;
  }
}

/** Where a pod's files go, as the vocabulary's `runtime/pod-layout.ttl` says. */
export class Layout {
  /** The layout's Turtle, whose relative IRIs resolve against a pod's address when read with it as the base. */
  readonly turtle: string;
  readonly placements: readonly Placement[];
  readonly viewsFolder: string;
  /** The placement of the views' folder. */
  readonly viewsPlacement: Placement;

  private constructor(turtle: string, placements: readonly Placement[]) {
    this.turtle = turtle;
    this.placements = placements;
    const views = placements.filter(({ kind }) => kind === `${REC}View`);
    const [placement] = views;
    if (views.length !== 1 || placement?.folder === undefined)
      throw new Error(`${LAYOUT_FILE} gives no one folder for the views`);
    this.viewsPlacement = placement;
    this.viewsFolder = placement.folder;
  }

  static async read(
    vocabulary: Files,
    newStore: StoreFactory,
  ): Promise<Layout> {
    const turtle = await readText(vocabulary, LAYOUT_FILE);
    const store = newStore();
    await store.loadTurtle(turtle, { graph: BASE });
    const { rows } = await store.select(`
      PREFIX rec: <${REC}>
      PREFIX solid: <${SOLID}>
      PREFIX dct: <${DCT}>
      SELECT ?placement ?kind ?file ?folder ?filedWith ?forSubjectsOf ?fanOut ?writtenBy ?title ?storesBytes ?writtenAlways WHERE {
        ?placement a rec:Placement .
        OPTIONAL { ?placement solid:forClass ?kind } OPTIONAL { ?placement solid:instance ?file }
        OPTIONAL { ?placement solid:instanceContainer ?folder } OPTIONAL { ?placement rec:filedWith ?filedWith }
        OPTIONAL { ?placement rec:forSubjectsOf ?forSubjectsOf } OPTIONAL { ?placement rec:fanOut ?fanOut }
        OPTIONAL { ?placement rec:writtenBy ?writtenBy } OPTIONAL { ?placement dct:title ?title }
        OPTIONAL { ?placement rec:storesBytes ?storesBytes } OPTIONAL { ?placement rec:writtenAlways ?writtenAlways }
      }`);
    const seen = new Set<string>();
    const placements = rows.map((row) => {
      const placement = row.get("placement")?.value ?? "";
      if (seen.has(placement))
        throw new Error(
          `${LAYOUT_FILE} gives a placement two values of one term`,
        );
      seen.add(placement);
      const value = (name: string): string | undefined => row.get(name)?.value;
      const path = (name: string): string | undefined => {
        const found = value(name);
        if (found !== undefined && !found.startsWith(BASE))
          throw new Error(
            `${LAYOUT_FILE} places something outside the pod: ${found}`,
          );
        return found?.slice(BASE.length);
      };
      return new Placement(
        value("kind"),
        path("file"),
        path("folder"),
        value("filedWith"),
        value("forSubjectsOf"),
        Number(value("fanOut") ?? 0),
        value("writtenBy"),
        value("title"),
        value("storesBytes") === "true",
        value("writtenAlways") === "true",
      );
    });
    return new Layout(turtle, placements);
  }

  #inViews(placement: Placement): boolean {
    return (placement.file ?? placement.folder ?? "").startsWith(
      this.viewsFolder,
    );
  }

  /**
   * Where a thing of the class is filed outside the views: by the placement for a property it states, else by the one
   * for its class alone; undefined when the layout files it nowhere.
   */
  find(kind: string, stating: readonly string[] = []): Placement | undefined {
    const matching = this.placements.filter(
      (placement) => placement.kind === kind && !this.#inViews(placement),
    );
    const narrowed = matching.filter(
      ({ forSubjectsOf }) =>
        forSubjectsOf !== undefined && stating.includes(forSubjectsOf),
    );
    const found =
      narrowed.length > 0
        ? narrowed
        : matching.filter(({ forSubjectsOf }) => forSubjectsOf === undefined);
    if (found.length > 1)
      throw new Error(
        `${LAYOUT_FILE} files a ${kind} in ${found.length} places`,
      );
    return found[0];
  }

  place(kind: string, stating: readonly string[] = []): Placement {
    const found = this.find(kind, stating);
    if (found === undefined)
      throw new Error(`${LAYOUT_FILE} files a ${kind} nowhere`);
    return found;
  }

  #filedWith(predicate: string): Placement {
    const [found, ...others] = this.placements.filter(
      ({ filedWith }) => filedWith === predicate,
    );
    if (found === undefined || others.length > 0)
      throw new Error(
        `${LAYOUT_FILE} gives no one placement filed with ${predicate}`,
      );
    return found;
  }

  /** The path of a version of a thing that `of` files. */
  version(of: Placement, name: string): string {
    return this.#filedWith(`${PROV}specializationOf`).path(name, of.folder);
  }

  /** The path of a revision of a record that `of` files. */
  revision(of: Placement, name: string): string {
    return this.#filedWith(`${REC}revisionOf`).path(name, of.folder);
  }

  /** Each view a query writes, listing the things of its class. */
  get views(): readonly Placement[] {
    return this.placements.filter(
      ({ writtenBy, kind }) => writtenBy !== undefined && kind !== undefined,
    );
  }

  /** Each file a build writes again, from the pod's other files. */
  get rebuilt(): readonly string[] {
    return [
      ...this.built.flatMap(({ file }) => file ?? []),
      this.typeIndex,
      this.manifest,
    ];
  }

  /** Each file a query writes. */
  get built(): readonly Placement[] {
    return this.placements.filter(({ writtenBy }) => writtenBy !== undefined);
  }

  /** Where a record of the class is filed, with its versions and revisions; only a class a view lists is filed. */
  records(kind: string): Placement | undefined {
    return this.views.some((view) => view.kind === kind)
      ? this.find(kind)
      : undefined;
  }

  get recordPlacements(): readonly Placement[] {
    return this.views.flatMap(({ kind }) =>
      kind === undefined ? [] : (this.find(kind) ?? []),
    );
  }

  get storedBytes(): Placement {
    const [found, ...others] = this.placements.filter(
      ({ storesBytes }) => storesBytes,
    );
    if (found?.folder === undefined || others.length > 0)
      throw new Error(
        `${LAYOUT_FILE} gives no one folder for documents' bytes`,
      );
    return found;
  }

  #file(kind: string): string {
    const { file } = this.place(kind);
    if (file === undefined)
      throw new Error(`${LAYOUT_FILE} gives a ${kind} a folder, not a file`);
    return file;
  }

  get typeIndex(): string {
    return this.#file(`${SOLID}TypeIndex`);
  }

  get manifest(): string {
    return this.#file(`${CASCADE}ExportManifest`);
  }

  get card(): string {
    return this.#file(`${FOAF}PersonalProfileDocument`);
  }

  get preferences(): string {
    return this.#file(`${PIM}ConfigurationFile`);
  }

  /** Whether the file at the path is RDF, which every file is but a stored document. */
  isRdf(path: string): boolean {
    return !path.startsWith(this.storedBytes.folder ?? "");
  }
}
