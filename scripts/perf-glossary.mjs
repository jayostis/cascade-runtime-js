// The glossary of the runtime's performance file (packages/cascade-runtime/test/perf-glossary/), read by the scripts that draw
// its pages. One reader, so that the pages and perf-stored.mjs read the folder the way the runtime's own test code does.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const GLOSSARY = fileURLToPath(
  new URL("../packages/cascade-runtime/test/perf-glossary/", import.meta.url),
);

/**
 * The glossary of a folder of fragments, merged in file-name order as readGlossary in
 * packages/cascade-runtime/test/perf-glossary.ts does it (a test holds the two equal): a list by joining, an object by
 * adding keys, a text by taking it.
 */
export function readGlossary(folder = GLOSSARY) {
  const merged = {};
  for (const file of readdirSync(folder)
    .filter((each) => each.endsWith(".json"))
    .sort()) {
    const fragment = JSON.parse(readFileSync(join(folder, file), "utf8"));
    for (const [section, value] of Object.entries(fragment)) {
      if (Array.isArray(value)) {
        const list = [...(merged[section] ?? [])];
        for (const entry of value) {
          if (
            list.some(
              (other) => JSON.stringify(other) === JSON.stringify(entry),
            )
          )
            throw new Error(
              `${file} lists ${JSON.stringify(entry)} in ${section}, which is listed already`,
            );
          list.push(entry);
        }
        merged[section] = list;
      } else if (typeof value === "object" && value !== null) {
        merged[section] ??= {};
        for (const [key, entry] of Object.entries(value)) {
          if (key in merged[section])
            throw new Error(
              `${file} gives ${section}.${key}, which another file gave`,
            );
          merged[section][key] = entry;
        }
      } else if (merged[section] !== undefined)
        throw new Error(`${file} gives ${section}, which another file gave`);
      else merged[section] = value;
    }
  }
  return merged;
}
