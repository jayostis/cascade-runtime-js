// `npm run kit:export -- <kit> <download>`: a download of a kit the package carries, copied into this app as a person
// puts it there: a phone's export as `apple_health_export`, a portal's C-CDA file under its own name.
import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { kitDownload } from "cascade-runtime/fixtures";
import { argumentsOf, refuse } from "./pods.mjs";

const EXPORT = "apple_health_export";

const { positionals } = argumentsOf(
  argv.slice(2),
  "npm run kit:export -- <kit> <download>",
  {},
  2,
);
const [kit, download] = positionals;
let found;
try {
  found = await kitDownload(kit, download);
} catch (error) {
  refuse(error.message);
}
const file = statSync(found).isFile();
const source = file ? found : join(found, EXPORT);
const name = file ? basename(found) : EXPORT;
const target = fileURLToPath(new URL(name, import.meta.url));
if (!existsSync(source))
  refuse(`the kit ${kit}'s download ${download} holds no ${EXPORT}`);
if (existsSync(target))
  refuse(`${name} exists already: move or remove it first`);
try {
  cpSync(source, target, { recursive: true });
} catch (error) {
  rmSync(target, { recursive: true, force: true });
  refuse(`${name} could not be copied: ${error.message}`);
}
stdout.write(`Copied ${kit}'s ${download} into ${name}${file ? "" : "/"}.\n`);
