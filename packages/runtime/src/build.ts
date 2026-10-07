import { Derivations, QUERIES } from "./derive.js";
import { type Files, readText } from "./files.js";
import type { Layout } from "./layout.js";
import { blank, iri, literal, RDF, type Triple, XSD } from "./rdf.js";
import type { Store } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const DCT = "http://purl.org/dc/terms/";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const CASCADE = "https://ns.cascadeprotocol.org/core/v1#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const TYPE = `${RDF}type`;
const MERGED_FROM = `${CASCADE}mergedFrom`;
const CURRENT_REFERENCE_VERSIONS = `${QUERIES}questions/pod/Which reference versions are current.rq`;

/** The pod a build is made for, as it stood after a step. */
export interface PodState {
  readonly address: string;
  /** The time of the step, an `xsd:dateTime`. */
  readonly at: string;
  readonly title: string;
  /** The files the pod holds: each view among them is written again though it holds no entry now. */
  readonly files: readonly string[];
}

/** Adds the lens's derived state, and the files built from it, to a store holding a pod; returns those files. */
export type Derive = (
  store: Store,
  lens: string,
  pod: PodState,
) => Promise<ReadonlyMap<string, readonly Triple[]>>;

/** The software a pod's manifest says built it. */
export const RUNTIME = "cascade-runtime-js";

/** A query's triples, with its file marked as a view built with these reference versions. */
function marked(
  file: string,
  triples: readonly Triple[],
  used: readonly string[],
): Triple[] {
  return [
    ...triples,
    [iri(file), iri(TYPE), iri(`${REC}View`)],
    ...used.map((version): Triple => [
      iri(file),
      iri(`${PROV}used`),
      iri(version),
    ]),
  ];
}

/**
 * The type index of a pod at `address`: a registration for each view written, by default each the layout lists, and
 * one for the views' folder, each named for the file or folder it registers, with its class, its file or folder, and
 * its title.
 */
export function typeIndex(
  address: string,
  layout: Layout,
  written: ReadonlySet<string> = new Set(
    layout.views.flatMap(({ file }) => file ?? []),
  ),
): Triple[] {
  const index = address + layout.typeIndex;
  const folder = layout.viewsPlacement;
  const registered = [
    ...layout.views
      .filter(({ file }) => written.has(file ?? ""))
      .map((view) => ({
        placement: view,
        listing: `${SOLID}instance`,
        path: view.file ?? "",
      })),
    {
      placement: folder,
      listing: `${SOLID}instanceContainer`,
      path: folder.folder ?? "",
    },
  ];
  return [
    [iri(index), iri(TYPE), iri(`${SOLID}TypeIndex`)],
    [iri(index), iri(TYPE), iri(`${SOLID}UnlistedDocument`)],
    ...registered.flatMap(({ placement, listing, path }): Triple[] => {
      const name = path
        .replace(/\/$/, "")
        .replace(/^.*\//, "")
        .replace(/\.ttl$/, "");
      const registration = iri(`${index}#${name}`);
      return [
        [registration, iri(TYPE), iri(`${SOLID}TypeRegistration`)],
        [registration, iri(`${SOLID}forClass`), iri(placement.kind ?? "")],
        [registration, iri(listing), iri(address + path)],
        [registration, iri(`${DCT}title`), literal(placement.title ?? "")],
      ];
    }),
  ];
}

function manifest(file: string, title: string, at: string): Triple[] {
  const manifest = iri(`${file}#manifest`);
  const activity = blank("activity");
  const agent = blank("agent");
  const created = literal(at, `${XSD}dateTime`);
  return [
    [manifest, iri(TYPE), iri(`${CASCADE}ExportManifest`)],
    [manifest, iri(`${DCT}title`), literal(title)],
    [manifest, iri(`${DCT}created`), created],
    [manifest, iri(`${CASCADE}schemaVersion`), literal("1.8")],
    [manifest, iri(`${PROV}wasGeneratedBy`), activity],
    [activity, iri(TYPE), iri(`${PROV}Activity`)],
    [activity, iri(`${PROV}startedAtTime`), created],
    [activity, iri(`${PROV}wasAssociatedWith`), agent],
    [agent, iri(TYPE), iri(`${PROV}SoftwareAgent`)],
    [agent, iri(`${RDFS}label`), literal(RUNTIME)],
  ];
}

/** The vocabulary's derivations, and the queries that write the layout's files, read once, run as they are. */
export interface VocabularyBuild {
  readonly derivations: Derivations;
  /** Adds the files the build writes to a store holding a pod and its derived state; returns them. */
  files(
    store: Store,
    pod: PodState,
  ): Promise<ReadonlyMap<string, readonly Triple[]>>;
}

export async function vocabularyBuild(
  vocabulary: Files,
  layout: Layout,
): Promise<VocabularyBuild> {
  const derivations = await Derivations.of(vocabulary);
  const queries = new Map<string, string>();
  const read = async (path: string): Promise<void> => {
    queries.set(path, await readText(vocabulary, path));
  };
  await read(CURRENT_REFERENCE_VERSIONS);
  for (const { writtenBy } of layout.built) await read(QUERIES + writtenBy);
  const query = (path: string): string => queries.get(path) ?? "";
  const views = layout.views.map(({ file }) => file);
  const groups = [
    layout.built.filter(({ file }) => views.includes(file)),
    layout.built.filter(({ file }) => !views.includes(file)),
  ].map((group) =>
    group
      .map(({ file, writtenBy }) => ({
        file: file ?? "",
        query: QUERIES + (writtenBy ?? ""),
      }))
      .sort((a, b) => (a.file < b.file ? -1 : 1)),
  );

  const written = async (
    store: Store,
    pod: PodState,
  ): Promise<ReadonlyMap<string, readonly Triple[]>> => {
    const { rows } = await store.select(query(CURRENT_REFERENCE_VERSIONS));
    const used = rows.flatMap((row) => row.get("version")?.value ?? []);
    const held = new Set(pod.files.filter((path) => views.includes(path)));
    const unheld = layout.views.filter(({ file }) => !held.has(file ?? ""));
    if (unheld.length > 0) {
      const { rows: kinds } = await store.select(
        `SELECT DISTINCT ?kind WHERE { VALUES ?kind { ${unheld.map(({ kind }) => `<${kind}>`).join(" ")} } ?record a ?kind }`,
      );
      const found = new Set(kinds.map((row) => row.get("kind")?.value));
      for (const { file, kind } of unheld)
        if (found.has(kind)) held.add(file ?? "");
    }
    const files = new Map<string, readonly Triple[]>();
    const add = async (path: string, triples: readonly Triple[]) => {
      files.set(path, triples);
      await store.add(triples, { graph: pod.address + path });
    };
    for (const group of groups) {
      const made = await Promise.all(
        group.map(async ({ file, query: path }) => ({
          file,
          triples: await store.construct(query(path)),
        })),
      );
      for (const { file, triples } of made) {
        const view = views.includes(file);
        if (view && triples.some(([, p]) => p.value === MERGED_FROM))
          held.add(file);
        if (!view || held.has(file))
          await add(file, marked(pod.address + file, triples, used));
      }
    }
    await add(layout.typeIndex, typeIndex(pod.address, layout, held));
    await add(
      layout.manifest,
      manifest(pod.address + layout.manifest, pod.title, pod.at),
    );
    return files;
  };
  return { derivations, files: written };
}

/** The vocabulary's derivations and the queries that write the layout's files, read once, run as they are. */
export async function vocabularyDerive(
  vocabulary: Files,
  layout: Layout,
): Promise<Derive> {
  const { derivations, files } = await vocabularyBuild(vocabulary, layout);
  return async (store, lens, pod) => {
    await derivations.derive(store, lens);
    return files(store, pod);
  };
}
