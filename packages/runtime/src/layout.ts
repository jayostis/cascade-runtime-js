import { fileStem } from "./names.js";

/** The folder each kind of thing the runtime has filed so far is in. */
export const FOLDERS = {
  subject: "subject",
  records: "records",
  activities: "provenance/activities",
  documents: "provenance/documents",
  imports: "provenance/imports",
  attachments: "attachments",
  judgments: "judgments",
  references: "references",
} as const;

const HEALTH = "https://ns.cascadeprotocol.org/health/v1#";
const CLINICAL = "https://ns.cascadeprotocol.org/clinical/v1#";
const CORE = "https://ns.cascadeprotocol.org/core/v1#";

/** The folder a record of each class the pod files is in, with its versions and revisions. */
export const RECORD_FOLDERS: ReadonlyMap<string, string> = new Map(
  (
    [
      [`${HEALTH}AllergyRecord`, "allergies"],
      [`${HEALTH}ConditionRecord`, "conditions"],
      [`${HEALTH}ImmunizationRecord`, "immunizations"],
      [`${CLINICAL}Procedure`, "procedures"],
      [`${CORE}PatientProfile`, "patient-profile"],
    ] as const
  ).map(([kind, folder]) => [kind, `${FOLDERS.records}/${folder}`]),
);

/** The path of the RDF file holding the named thing, fanned out under its folder by the first two characters. */
export function fanned(folder: string, name: string): string {
  const stem = fileStem(name);
  return `${folder}/${stem.slice(0, 2)}/${stem}.ttl`;
}

/** The path a document's bytes are kept at. */
export function attachment(document: string): string {
  return `${FOLDERS.attachments}/sha-256/${fileStem(document)}`;
}

/** Whether the file at the path is RDF, which every file is but a stored document. */
export function isRdf(path: string): boolean {
  return !path.startsWith(`${FOLDERS.attachments}/`);
}

/** A file the build writes by running one of the vocabulary's queries, named by its path under `queries/v1-draft/`. */
export interface QueryFile {
  readonly file: string;
  readonly query: string;
}

/** The files the build writes, rebuilt from the pod at every step. */
export interface BuiltFiles {
  /** Each view, with the class of the things it lists; the views are built before the other files a query writes. */
  readonly views: readonly (QueryFile & { readonly kind: string })[];
  readonly others: readonly QueryFile[];
  readonly viewsFolder: string;
  readonly typeIndex: string;
  readonly index: string;
  readonly manifest: string;
  /** The path of every file the build writes. */
  readonly derived: readonly string[];
}

const VIEWS_FOLDER = "clinical/";
const VIEWS = (
  [
    ["allergies", `${HEALTH}AllergyRecord`],
    ["conditions", `${HEALTH}ConditionRecord`],
    ["immunizations", `${HEALTH}ImmunizationRecord`],
    ["procedures", `${CLINICAL}Procedure`],
    ["patient-profile", `${CORE}PatientProfile`],
  ] as const
).map(([view, kind]) => ({
  file: `${VIEWS_FOLDER}${view}.ttl`,
  query: `views/${view}.rq`,
  kind,
}));
const OTHERS = [{ file: `${VIEWS_FOLDER}labels.ttl`, query: "labels.rq" }];

export const BUILT: BuiltFiles = {
  views: VIEWS,
  others: OTHERS,
  viewsFolder: VIEWS_FOLDER,
  typeIndex: "settings/privateTypeIndex.ttl",
  index: "index.ttl",
  manifest: "manifest.ttl",
  derived: [
    ...[...VIEWS, ...OTHERS].map(({ file }) => file),
    "index.ttl",
    "manifest.ttl",
  ].sort(),
};
