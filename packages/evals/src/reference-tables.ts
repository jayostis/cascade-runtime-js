// The reference tables an app holds beside its pods, held once for every case's pod: a case's pod folder is given a
// copy, so the cases differ by their downloads and not by the history of the machine that built them.
import { createHash } from "node:crypto";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tablesBeside } from "cascade-runtime";
import { REFERENCE_TABLES } from "./paths.js";

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
 * starter copies, else, once, the feeds `cascade-runtime.json` names; read as they stand afterwards, never checked
 * again, so a case is prepared on the tables it was prepared on until the folder is removed.
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
  const tables = await tablesBeside(REFERENCE_TABLES);
  await tables.start();
  if ((await tables.current()).length === 0) {
    log("reference tables: reading the feeds, once");
    const checked = await tables.check();
    if ((await tables.current()).length === 0)
      throw new Error(
        `no reference tables are held, and the feeds gave none: ${
          checked
            .map(
              (it) =>
                `${it.feed}: ${it.later ?? it.refused.map((r) => `${r.version}: ${r.reason}`).join("; ")}`,
            )
            .join("; ") || "no feed is named"
        }. Prepare again with the network.`,
      );
  }
  const versions = [...(await tables.current())].sort();
  return {
    folder: join(REFERENCE_TABLES, ".tables"),
    id: createHash("sha256").update(JSON.stringify(versions)).digest("hex"),
    versions,
  };
}

/** The tables a pods folder holds, replaced by a copy of the reference tables, before any pod in it opens. */
export async function giveTables(
  pods: string,
  tables: Pick<ReferenceTables, "folder">,
): Promise<void> {
  const own = join(pods, ".tables");
  await rm(own, { recursive: true, force: true, maxRetries: 5 });
  await cp(tables.folder, own, { recursive: true });
}
