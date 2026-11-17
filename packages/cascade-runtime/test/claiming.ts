import { ownerAbout } from "cascade-runtime";
import type { Exported, Imported, Pod } from "cascade-runtime";

/**
 * An import after which the person said yes to every patient it names: it files the records, the owner files an About
 * for each patient left unclaimed, and the matcher runs on the import. An import claims nothing by itself.
 */
export async function importClaimingEveryProfile(
  pod: Pod,
  files: string | Exported,
): Promise<Imported> {
  const filed = await pod.import(files, { match: false });
  if (filed.activity === undefined) return filed;
  const claimedProfiles = [];
  for (const profile of filed.unclaimedProfiles) {
    const { judgment } = await pod.judge(ownerAbout(pod, profile));
    if (judgment !== undefined) claimedProfiles.push({ profile, judgment });
  }
  const matched = await pod.match(filed.activity);
  return { ...filed, matched, claimedProfiles, unclaimedProfiles: [] };
}
