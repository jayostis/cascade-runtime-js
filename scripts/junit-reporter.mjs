import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { dirname, resolve } from "node:path";
import { junit } from "node:test/reporters";
import { fileURLToPath } from "node:url";

/**
 * node:test's JUnit report, each `testcase` also given the `line` of the TypeScript source it is declared on, and that
 * source as its `file`, so the published page can link a case to its line. node's reporter writes no line, and the
 * runner sees only the transpiled file; its source map says where the case was written.
 */
const MARK = "test@L";
const maps = new Map();

function mapOf(file) {
  if (!maps.has(file)) {
    let map;
    try {
      map = new SourceMap(JSON.parse(readFileSync(`${file}.map`, "utf8")));
    } catch {
      map = undefined;
    }
    maps.set(file, map);
  }
  return maps.get(file);
}

function located({ file, line, column }) {
  if (file === undefined || line === undefined) return undefined;
  const path = file.startsWith("file:") ? fileURLToPath(file) : file;
  const origin = mapOf(path)?.findOrigin(line, column ?? 1);
  if (origin === undefined || !("lineNumber" in origin)) return undefined;
  const source = origin.fileName.startsWith("file:")
    ? fileURLToPath(origin.fileName)
    : resolve(dirname(path), origin.fileName);
  return { file: source, line: origin.lineNumber };
}

async function* withLines(source) {
  for await (const event of source) {
    if (
      (event.type === "test:pass" || event.type === "test:fail") &&
      event.data.classname === undefined
    ) {
      const at = located(event.data);
      if (at !== undefined) {
        yield {
          ...event,
          data: {
            ...event.data,
            file: at.file,
            classname: `${MARK}${at.line}`,
          },
        };
        continue;
      }
    }
    yield event;
  }
}

export default async function* junitWithLines(source) {
  for await (const chunk of junit(withLines(source)))
    yield chunk.replace(
      /classname="test@L(\d+)"/g,
      (_, line) => `classname="test" line="${line}"`,
    );
}
