import { argv, stderr, stdout } from "node:process";
import { openPod } from "cascade-runtime";

const exportFolder = argv[2];
const pod = await openPod("alex-pod");

const seen = await pod.look(exportFolder);
stderr.write(`${JSON.stringify(seen)}\n`);

const imported = await pod.import(exportFolder, { aboutSubject: true });
if (imported.refused)
  throw new Error(`the import was refused: ${imported.refused}`);

for (const row of await pod.ask("pod/My active allergies")) {
  stdout.write(`${JSON.stringify(row)}\n`);
}
await pod.close();
