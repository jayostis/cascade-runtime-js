import { fileStem } from "./names.js";

/** The folder each kind of thing the runtime has filed so far is in. */
export const FOLDERS = {
  subject: "subject",
  attachments: "attachments",
} as const;

/** The path of the RDF file holding the named thing, fanned out under its folder by the first two characters. */
export function fanned(folder: string, name: string): string {
  const stem = fileStem(name);
  return `${folder}/${stem.slice(0, 2)}/${stem}.ttl`;
}

/** Whether the file at the path is RDF, which every file is but a stored document. */
export function isRdf(path: string): boolean {
  return !path.startsWith(`${FOLDERS.attachments}/`);
}
