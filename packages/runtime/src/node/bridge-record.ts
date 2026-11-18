import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BridgePackageFound } from "./wasm.js";

/** The Bridge build `npm run bridge` found, as it is kept in `expected.json` for the offline tests to pin. */
export interface BridgeRecord {
  readonly repository: string;
  readonly source: BridgePackageFound["source"];
  readonly commit: string;
  /** Where a build that is not a downloaded release sits: a checkout's own build. */
  readonly folder?: string;
}

export function bridgeRecord(
  found: BridgePackageFound,
  repository: string,
): BridgeRecord {
  return found.source === "release"
    ? { repository, source: "release", commit: found.commit }
    : {
        repository,
        source: found.source,
        commit: found.commit,
        folder: found.folder,
      };
}

/**
 * What the offline tests do with a record: a release is pinned to its commit, and must be in `cache`; any other build is
 * a checkout's own, which the resolver finds again without a pin, so it need only still be there.
 */
export function pinOfRecord(
  record: Partial<BridgeRecord> | undefined,
  cache: string,
  exists: (path: string) => boolean = existsSync,
): { readonly pin?: string; readonly build: string; readonly line: string } {
  const none = `tests run offline and read the Bridge build \`npm run bridge\` recorded in ${join(cache, "expected.json")}, and none is recorded: run \`npm run bridge\``;
  if (record?.commit === undefined) throw new Error(none);
  if (record.source === undefined || record.source === "release") {
    const built = join(cache, `build-${record.commit}`, "package.json");
    if (!exists(built))
      throw new Error(
        `tests run offline and expect the Bridge build ${record.commit}, which is not in ${cache}: run \`npm run bridge\``,
      );
    return {
      pin: `${record.repository ?? ""}@${record.commit}`,
      build: built,
      line: `pinned Bridge ${record.commit}`,
    };
  }
  const build = join(record.folder ?? "", "package.json");
  if (record.folder === undefined || !exists(build))
    throw new Error(
      `tests run offline and expect the ${record.source} Bridge build ${record.folder ?? ""} \`npm run bridge\` recorded, which is gone: run \`npm run bridge\``,
    );
  return {
    build,
    line: `Bridge ${record.commit} from the ${record.source} build in ${record.folder}`,
  };
}
