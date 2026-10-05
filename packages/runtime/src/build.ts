import { Derivations, QUERIES } from "./derive.js";
import { type Files, readText } from "./files.js";
import { BUILT, type BuiltFiles } from "./layout.js";
import { blank, iri, literal, RDF, type Triple, XSD } from "./rdf.js";
import type { Store } from "./store.js";

const PROV = "http://www.w3.org/ns/prov#";
const DCT = "http://purl.org/dc/terms/";
const LDP = "http://www.w3.org/ns/ldp#";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const CASCADE = "https://ns.cascadeprotocol.org/core/v1#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const TYPE = `${RDF}type`;
const CURRENT_REFERENCE_VERSIONS = `${QUERIES}questions/pod/Which reference versions are current.rq`;

/** The pod a build is made for, as it stood after a step. */
export interface PodState {
  readonly address: string;
  /** The path of every file the steps through this one wrote. */
  readonly files: readonly string[];
  /** The time of the step, an `xsd:dateTime`. */
  readonly at: string;
  readonly title: string;
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

/** The type index of a pod at `address`: a registration for each view, and one for the folder the views are in. */
export function typeIndex(
  address: string,
  built: BuiltFiles = BUILT,
): Triple[] {
  const index = address + built.typeIndex;
  const registration = (name: string): Triple[0] => iri(`${index}#${name}`);
  const views = registration("views");
  return [
    [iri(index), iri(TYPE), iri(`${SOLID}TypeIndex`)],
    [iri(index), iri(TYPE), iri(`${SOLID}UnlistedDocument`)],
    [views, iri(TYPE), iri(`${SOLID}TypeRegistration`)],
    [views, iri(`${SOLID}forClass`), iri(`${REC}View`)],
    [views, iri(`${SOLID}instanceContainer`), iri(address + built.viewsFolder)],
    ...built.views.flatMap(({ file, kind }): Triple[] => {
      const named = registration(
        file.replace(/^.*\//, "").replace(/\.ttl$/, ""),
      );
      return [
        [named, iri(TYPE), iri(`${SOLID}TypeRegistration`)],
        [named, iri(`${SOLID}forClass`), iri(kind)],
        [named, iri(`${SOLID}instance`), iri(address + file)],
      ];
    }),
  ];
}

function index(address: string, files: readonly string[]): Triple[] {
  const root = iri(address);
  const folders = [
    ...new Set(
      files
        .filter((path) => path.includes("/") && !path.startsWith("."))
        .map((path) => path.slice(0, path.indexOf("/"))),
    ),
  ].sort();
  return [
    [root, iri(TYPE), iri(`${LDP}Container`)],
    [root, iri(TYPE), iri(`${LDP}BasicContainer`)],
    [root, iri(`${DCT}title`), literal("Pod Root Container")],
    ...folders.map((folder): Triple => [
      root,
      iri(`${LDP}contains`),
      iri(`${address}${folder}/`),
    ]),
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

/** The vocabulary's derivations, views and labels, read once, run as they are. */
export async function vocabularyDerive(
  vocabulary: Files,
  built: BuiltFiles = BUILT,
): Promise<Derive> {
  const derivations = await Derivations.of(vocabulary);
  const queries = new Map<string, string>();
  for (const path of [
    CURRENT_REFERENCE_VERSIONS,
    ...[...built.views, ...built.others].map(({ query }) => QUERIES + query),
  ])
    queries.set(path, await readText(vocabulary, path));
  const query = (path: string): string => queries.get(path) ?? "";

  return async (store, lens, pod) => {
    await derivations.derive(store, lens);
    const { rows } = await store.select(query(CURRENT_REFERENCE_VERSIONS));
    const used = rows.flatMap((row) => row.get("version")?.value ?? []);
    const files = new Map<string, readonly Triple[]>();
    const add = async (path: string, triples: readonly Triple[]) => {
      files.set(path, triples);
      await store.add(triples, { graph: pod.address + path });
    };
    for (const group of [built.views, built.others]) {
      const made = await Promise.all(
        group.map(async ({ file, query: path }) => ({
          file,
          triples: marked(
            pod.address + file,
            await store.construct(query(QUERIES + path)),
            used,
          ),
        })),
      );
      for (const { file, triples } of made) await add(file, triples);
    }
    await add(
      built.index,
      index(pod.address, [...pod.files, ...built.derived]),
    );
    await add(
      built.manifest,
      manifest(pod.address + built.manifest, pod.title, pod.at),
    );
    return files;
  };
}
