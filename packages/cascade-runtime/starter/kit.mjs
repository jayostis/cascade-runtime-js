// `npm run kit:export -- <kit> <download>`: a download of a kit the package carries, copied into this app as a person
// puts their phone's download there.
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { argumentsOf, refuse } from "./pods.mjs";

const EXPORT = "apple_health_export";
const COMPONENTS = fileURLToPath(
  new URL("node_modules/cascade-runtime/components/", import.meta.url),
);
const TARGET = fileURLToPath(new URL(EXPORT, import.meta.url));

function folders(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const { positionals } = argumentsOf(
  argv.slice(2),
  "npm run kit:export -- <kit> <download>",
  {},
  2,
);
const [kit, download] = positionals;
if (existsSync(TARGET))
  refuse(`${EXPORT} exists already: move or remove it first`);
const { components } = JSON.parse(
  readFileSync(join(COMPONENTS, "packed.json"), "utf8"),
);
const { commit } = components.find(({ repository }) =>
  /\/cascade-vocabulary(\.git)?$/.test(repository),
);
const conformance = join(
  COMPONENTS,
  "cascade-vocabulary",
  commit,
  "conformance",
);
const kits = folders(conformance);
if (!kits.includes(kit))
  refuse(`there is no kit ${kit}; there are ${kits.join(", ")}`);
const input = join(conformance, kit, "scripted-input");
const downloads = folders(input).flatMap((person) =>
  folders(join(input, person, "downloads")).map((name) => ({ person, name })),
);
const found = downloads.find(({ name }) => name === download);
if (found === undefined)
  refuse(
    `the kit ${kit} has no download ${download}; it has ${downloads.map(({ name }) => name).join(", ")}`,
  );
cpSync(join(input, found.person, "downloads", download, EXPORT), TARGET, {
  recursive: true,
});
stdout.write(`Copied ${kit}'s ${download} into ${EXPORT}/.\n`);
