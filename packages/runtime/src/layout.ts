import { fileStem } from "./names.js";

/** The folder each kind of thing the runtime has filed so far is in. */
export const FOLDERS = {
  subject: "subject",
  records: "records",
  activities: "provenance/activities",
  documents: "provenance/documents",
  imports: "provenance/imports",
  attachments: "attachments",
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
