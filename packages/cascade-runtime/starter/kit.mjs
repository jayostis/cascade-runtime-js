// `npm run kit:export -- <kit> <download>`: a download of a kit the package carries, copied into this app as a person
// puts their phone's download there.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { kitDownload } from "cascade-runtime/fixtures";
import { argumentsOf, refuse } from "./pods.mjs";

const EXPORT = "apple_health_export";
const TARGET = fileURLToPath(new URL(EXPORT, import.meta.url));

const { positionals } = argumentsOf(
  argv.slice(2),
  "npm run kit:export -- <kit> <download>",
  {},
  2,
);
const [kit, download] = positionals;
let source;
try {
  source = join(await kitDownload(kit, download), EXPORT);
} catch (error) {
  refuse(error.message);
}
if (!existsSync(source))
  refuse(`the kit ${kit}'s download ${download} holds no ${EXPORT}`);
if (existsSync(TARGET))
  refuse(`${EXPORT} exists already: move or remove it first`);
try {
  cpSync(source, TARGET, { recursive: true });
} catch (error) {
  rmSync(TARGET, { recursive: true, force: true });
  refuse(`${EXPORT} could not be copied: ${error.message}`);
}
stdout.write(`Copied ${kit}'s ${download} into ${EXPORT}/.\n`);
