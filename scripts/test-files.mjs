import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The test files a package's spec lists as `randomOrder`, as written there: a path under its `test/`. */
function listedBy(name) {
  try {
    const { randomOrder } = JSON.parse(
      readFileSync(join("packages", name, "test", "spec.json"), "utf8"),
    );
    return new Set(Array.isArray(randomOrder) ? randomOrder : []);
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
}

/**
 * The compiled test files of every package, from the repository's root, by their path. `listed` keeps only the files each
 * package's `test/spec.json` lists as `randomOrder`, `unlisted` only the files it does not, and `all` every one; the first
 * two are the third in two parts. A name in a list that is no test file is no file here.
 */
export function compiledTests(group = "all") {
  const compiled = [];
  const packages = readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of packages) {
    let entries;
    try {
      entries = readdirSync(join("packages", name, "test"), {
        recursive: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const listed = listedBy(name);
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".test.ts")) continue;
      const kept = listed.has(entry.split("\\").join("/"));
      if (group === "listed" ? !kept : group === "unlisted" && kept) continue;
      compiled.push(
        join("packages", name, "dist", "test", entry.slice(0, -3) + ".js"),
      );
    }
  }
  return compiled;
}
