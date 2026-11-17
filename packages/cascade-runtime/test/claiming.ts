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
    const { judgment } = await pod.judge(
      `@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:cascade:this-judgment> a cascade:Judgment ;
    cascade:verdict cascade:About ; cascade:subject <${pod.subject}> ; cascade:basis cascade:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${pod.owner}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] ] .
<${pod.owner}> a prov:Person .
`,
    );
    if (judgment !== undefined) claimedProfiles.push({ profile, judgment });
  }
  const matched = await pod.match(filed.activity);
  return { ...filed, matched, claimedProfiles, unclaimedProfiles: [] };
}
