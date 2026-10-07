import { argv, stderr, stdout } from "node:process";
import { openPod } from "cascade-runtime";

const pod = await openPod("priya-pod");

for (const download of argv.slice(2)) {
  const seen = await pod.look(download);
  stderr.write(`${JSON.stringify(seen)}\n`);

  const imported = await pod.import(download, { aboutSubject: true });
  if (imported.refused)
    throw new Error(`${download} was refused: ${imported.refused}`);
}

for (const row of await pod.ask("pod/My active medications")) {
  stdout.write(`${JSON.stringify(row)}\n`);
}
await pod.close();
