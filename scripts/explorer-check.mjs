// Checks the explorer's data object of every example pod in a built tree.
//
//   node scripts/explorer-check.mjs --tree <folder>
//
// Reads <folder>/<pod>/explorer.json of each folder that holds one and exits 1, naming the pod and the fault, when:
//   - a file under <pod>/pod/ is no node of the object, or a node is no file there;
//   - a node has no writer, its writer's row does not list it, or the build is its writer and it is no view, built file,
//     manifest or type index;
//   - an act's file is not among the files, or its snapshot names a file the pod does not hold;
//   - a view file does not name its definition, or the definition's query is not written under queries/;
//   - a label is empty or reads "undefined";
//   - a kit's step or case sits on a row the log does not have;
//   - the object is over its budget of 400 KB.
// It prints each pod's size, raw and gzipped.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const BUDGET = 400 * 1024;
const say = (line, error = false) =>
  (error ? process.stderr : process.stdout).write(`${line}
`);

const tree = process.argv[process.argv.indexOf("--tree") + 1];
if (process.argv.indexOf("--tree") < 0 || tree === undefined) {
  say("usage: node scripts/explorer-check.mjs --tree <folder>", true);
  process.exit(2);
}

const badLabel = (label) =>
  typeof label !== "string" ||
  label.trim() === "" ||
  /\bundefined\b|\[object /.test(label);

/** The kinds of file the build writes at every build. */
const REWRITTEN = new Set(["view", "built", "manifest", "typeindex"]);

/** The paths of the pod's files under `folder`, not its `files.json`, which lists them. */
function podFiles(folder, base = "") {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? podFiles(join(folder, entry.name), `${base}${entry.name}/`)
      : base === "" && entry.name === "files.json"
        ? []
        : [`${base}${entry.name}`],
  );
}

/** The faults of one data object, `folder` being where its page is. */
function faultsOf(data, folder) {
  const faults = [];
  const { files, log, views, queries } = data;
  const held = new Set(podFiles(join(folder, "pod")));
  const listed = new Set(files.map(({ path }) => path));
  for (const path of held)
    if (!listed.has(path))
      faults.push(`${path} is in the pod and is no file of the object`);
  for (const path of listed)
    if (!held.has(path))
      faults.push(`${path} is a file of the object and is not in the pod`);
  files.forEach((file, index) => {
    if (file.writer === "build") {
      if (!REWRITTEN.has(file.kind))
        faults.push(
          `${file.path} is a ${file.kind} and has the build as its writer, which only a view, a built file, the manifest and the type index have`,
        );
      return;
    }
    if (!Number.isInteger(file.writer) || log[file.writer] === undefined)
      faults.push(`${file.path} has no writer`);
    else if (!log[file.writer].wrote.includes(index))
      faults.push(
        `${file.path} names row ${file.writer}, which does not list it`,
      );
  });
  log.forEach((row, at) => {
    for (const index of row.wrote)
      if (files[index] === undefined)
        faults.push(`row ${at} wrote a file that is not listed`);
    for (const path of row.missing)
      faults.push(`row ${at} names ${path}, which the pod does not hold`);
  });
  views.forEach((view, index) => {
    const written = view.fileIndex !== undefined;
    if (
      written &&
      files[view.fileIndex]?.kind === "view" &&
      files[view.fileIndex].view !== index
    )
      faults.push(`${view.file} does not name its definition`);
    const query = queries[view.query];
    if (query === undefined) faults.push(`${view.file} has no definition`);
    else if (!existsSync(join(folder, query.path)))
      faults.push(
        `${view.file}'s definition ${query.path} is not written beside the page`,
      );
  });
  for (const file of files)
    if (file.label !== undefined && badLabel(file.label))
      faults.push(`${file.path} has the label ${JSON.stringify(file.label)}`);
  for (const view of views)
    for (const entry of view.entries)
      if (badLabel(entry.label))
        faults.push(`${entry.id} has the label ${JSON.stringify(entry.label)}`);
  for (const [term, { label }] of Object.entries(data.terms))
    if (label !== undefined && badLabel(label))
      faults.push(`${term} has the label ${JSON.stringify(label)}`);
  for (const step of data.kit?.steps ?? [])
    if (log[step.row] === undefined)
      faults.push(`kit step ${step.name} is on no row`);
  for (const each of data.kit?.cases ?? [])
    if (log[each.row] === undefined)
      faults.push(`kit case ${each.id ?? each.example} is after no row`);
  return faults;
}

let failed = false;
let checked = 0;
for (const pod of readdirSync(tree).sort()) {
  const folder = join(tree, pod);
  const path = join(folder, "explorer.json");
  if (!statSync(folder).isDirectory() || !existsSync(path)) continue;
  checked++;
  const bytes = readFileSync(path);
  const faults = faultsOf(JSON.parse(bytes.toString("utf8")), folder);
  if (bytes.length > BUDGET)
    faults.push(`it is ${bytes.length} bytes, over its budget of ${BUDGET}`);
  say(
    `${pod}: explorer.json ${bytes.length} bytes raw, ${gzipSync(bytes).length} gzipped`,
  );
  for (const fault of faults) {
    failed = true;
    say(`${pod}: ${fault}`, true);
  }
}
if (checked === 0) {
  say(`no folder of ${tree} holds an explorer.json`, true);
  failed = true;
}
process.exit(failed ? 1 : 0);
