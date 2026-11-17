import { argv, stderr, stdout } from "node:process";
import { openPod, ownerAbout } from "cascade-runtime";

const pod = await openPod("priya-pod");

for (const download of argv.slice(2)) {
  const seen = await pod.look(download);
  stderr.write(`${JSON.stringify(seen)}\n`);

  const imported = await pod.import(download, { match: false });
  if (imported.refused)
    throw new Error(`${download} was refused: ${imported.refused}`);
  for (const profile of imported.unclaimedProfiles)
    await pod.judge(ownerAbout(pod, profile));
  if (imported.activity !== undefined) await pod.match(imported.activity);
}

for (const row of await pod.ask("pod/My active medications")) {
  stdout.write(`${JSON.stringify(row)}\n`);
}
await pod.close();
