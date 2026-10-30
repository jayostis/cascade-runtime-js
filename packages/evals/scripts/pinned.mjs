// node pinned.mjs <cascade-runtime's dist/src/index.js> build <pod folder> <title> <download>...
// node pinned.mjs <cascade-runtime's dist/src/index.js> ask <pod folder> <question>...
// The harness's pod work done by another build of the runtime (a run pinned to earlier commits): build a pod from a
// case's downloads, or ask it questions. Prints JSON: each download's import, or each question's rows.
import { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";

const [, , index, command, pod, ...rest] = argv;
const { configureTables, openPod } = await import(pathToFileURL(index).href);
configureTables({ checkOnOpen: false });

if (command === "build") {
  const [title, ...downloads] = rest;
  const opened = await openPod(pod, { title });
  const imports = [];
  try {
    for (const path of downloads) {
      let sources;
      try {
        sources = await opened.look(path);
      } catch (error) {
        imports.push({ path, records: 0, refused: error.message });
        continue;
      }
      const done = await opened.import(path, { aboutSubject: true });
      imports.push({
        path,
        records: sources.reduce(
          (sum, it) =>
            sum + Object.values(it.records ?? {}).reduce((a, b) => a + b, 0),
          0,
        ),
        ...(done.refused ? { refused: String(done.refused) } : {}),
      });
    }
  } finally {
    await opened.close();
  }
  stdout.write(JSON.stringify(imports));
} else if (command === "ask") {
  const opened = await openPod(pod);
  const rows = {};
  try {
    for (const question of rest) rows[question] = await opened.ask(question);
  } finally {
    await opened.close();
  }
  stdout.write(JSON.stringify(rows));
} else throw new Error(`no command ${command}`);
