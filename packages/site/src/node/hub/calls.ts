import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const PACKAGE = ["packages", "cascade-runtime"];

/**
 * The calls of `cascade-runtime`, read from the package and never listed by hand: the functions its index exports, as the
 * built index has them, and the methods of the `Pod` interface an app opens, as `src/pod.ts` declares them. A class is
 * not a call. The package must be built, as `tsc -b` leaves it.
 */
export async function callNames(root: string): Promise<ReadonlySet<string>> {
  const index = (await import(
    pathToFileURL(join(root, ...PACKAGE, "dist", "src", "index.js")).href
  )) as Record<string, unknown>;
  const exported = Object.entries(index)
    .filter(
      ([, value]) =>
        typeof value === "function" &&
        !/^class\b/.test(Function.prototype.toString.call(value)),
    )
    .map(([name]) => name);
  const source = ts.createSourceFile(
    "pod.ts",
    await readFile(join(root, ...PACKAGE, "src", "pod.ts"), "utf8"),
    ts.ScriptTarget.Latest,
  );
  const methods = source.statements
    .filter(ts.isInterfaceDeclaration)
    .filter(({ name }) => name.text === "Pod")
    .flatMap(({ members }) => members.filter(ts.isMethodSignature))
    .map(({ name }) => name.getText(source));
  return new Set([...exported, ...methods]);
}
