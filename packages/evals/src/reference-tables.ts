// The reference tables an app holds beside its pods, held once for every case's pod: a case's pod folder is given a
// copy, so the cases differ by their downloads and not by the history of the machine that built them.
import { createHash } from "node:crypto";
import { access, cp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tablesBeside } from "cascade-runtime";
import { REFERENCE_TABLES, TABLES_GIVEN } from "./paths.js";

export interface ReferenceTables {
  /** The folder of the tables, the `.tables/` of a pods folder. */
  readonly folder: string;
  /** What the tables are: the digest of the versions they hold, which a pod built from them and an answer carry. */
  readonly id: string;
  /** The version of each series held. */
  readonly versions: readonly string[];
}

let held: Promise<ReferenceTables> | undefined;

/**
 * The tables every case's pod is given, in `work/reference-tables/.tables`. Made as an app makes its own: the package's
 * starter copies, else, once, the feeds `cascade-runtime.json` names, kept only when every series came; read as they
 * stand afterwards, never checked again, so a case is prepared on the tables it was prepared on until the folder is
 * removed. `CASCADE_EVALS_TABLES` names tables held already, which are never fetched.
 */
export function referenceTables(
  log: (line: string) => void = () => undefined,
): Promise<ReferenceTables> {
  const found = (held ??= hold(log));
  found.catch(() => {
    if (held === found) held = undefined;
  });
  return found;
}

async function hold(log: (line: string) => void): Promise<ReferenceTables> {
  if (!TABLES_GIVEN && !(await exists(join(REFERENCE_TABLES, ".tables"))))
    await fetchInto(REFERENCE_TABLES, log);
  const versions = [
    ...(await (await tablesBeside(REFERENCE_TABLES)).current()),
  ].sort();
  return {
    folder: join(REFERENCE_TABLES, ".tables"),
    id: createHash("sha256").update(JSON.stringify(versions)).digest("hex"),
    versions,
  };
}

/**
 * Reads the feeds into `<folder>.partial` and renames it to `folder` only once the check has returned with nothing
 * refused and nothing put off, so a fetch cut short leaves no folder that looks complete.
 */
async function fetchInto(
  folder: string,
  log: (line: string) => void,
): Promise<void> {
  const partial = `${folder}.partial`;
  log("reference tables: reading the feeds, once");
  const tables = await tablesBeside(partial);
  await tables.start();
  const checked = await tables.check();
  refuseIncomplete(checked, (await tables.current()).length);
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  await rename(partial, folder);
}

/** Throws unless every feed checked came whole: nothing refused, nothing put off, and some table held. */
export function refuseIncomplete(
  checked: readonly {
    feed: string;
    later?: string | undefined;
    refused: readonly { version: string; reason: string }[];
  }[],
  held: number,
): void {
  const failed = checked.filter(
    (it) => it.later !== undefined || it.refused.length > 0,
  );
  if (failed.length === 0 && held > 0) return;
  throw new Error(
    `the feeds did not give every reference table: ${
      (failed.length > 0 ? failed : checked)
        .map(
          (it) =>
            `${it.feed}: ${it.later ?? (it.refused.map((r) => `${r.version}: ${r.reason}`).join("; ") || "nothing")}`,
        )
        .join("; ") || "no feed is named"
    }. Prepare again with the network.`,
  );
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** The tables a pods folder holds, replaced by a copy of the reference tables, before any pod in it opens. */
export async function giveTables(
  pods: string,
  tables: Pick<ReferenceTables, "folder">,
): Promise<void> {
  const own = join(pods, ".tables");
  await rm(own, { recursive: true, force: true, maxRetries: 5 });
  await cp(tables.folder, own, { recursive: true });
}
