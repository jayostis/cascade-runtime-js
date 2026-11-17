import { argv, stderr, stdout } from "node:process";
import { openPod } from "cascade-runtime";

const exportFolder = argv[2];
const pod = await openPod("alex-pod");

const seen = await pod.look(exportFolder);
stderr.write(`${JSON.stringify(seen)}\n`);

const imported = await pod.import(exportFolder, { match: false });
if (imported.refused)
  throw new Error(`the import was refused: ${imported.refused}`);
for (const profile of imported.unclaimedProfiles)
  await pod.judge(`@prefix cascade: <https://ns.cascadeprotocol.org/cascade#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<urn:cascade:this-judgment> a cascade:Judgment ;
    cascade:verdict cascade:About ; cascade:subject <${pod.subject}> ; cascade:basis cascade:OwnerStatement ;
    prov:hadMember <${profile}> ; prov:wasAttributedTo <${pod.owner}> ;
    prov:wasGeneratedBy [ prov:qualifiedAssociation [ prov:agent <${pod.owner}> ; prov:hadRole cascade:PatientRole ] ] .
<${pod.owner}> a prov:Person .
`);
if (imported.activity !== undefined) await pod.match(imported.activity);

for (const row of await pod.ask("pod/My active allergies")) {
  stdout.write(`${JSON.stringify(row)}\n`);
}
await pod.close();
