import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ENTRY = fileURLToPath(
  new URL("../../src/browser/index.ts", import.meta.url),
).replaceAll("\\", "/");
const PAGE = ENTRY.replace(/index\.ts$/, "page-types.ts");
const WRONG = ENTRY.replace(/index\.ts$/, "page-wrong.ts");

/** What a page that renders a checked reply writes: the types it names, and a value it types as a checked reply. */
const PAGE_SOURCE = `
import type {
  Absence,
  Backing,
  Call,
  Cite,
  CheckedAbsence,
  CheckedFact,
  CheckedItem,
  CheckedReply,
  CitedRecord,
  Citation,
  DateKind,
  FactField,
  FilledFact,
  Fields,
  PodReplyFact,
  Pointed,
  RecordsReplyFact,
  Reply,
  ReplyFact,
  Verdict,
} from "./index.js";

export type Named = [
  Absence, Backing, Call, Cite, CheckedAbsence, CheckedFact, CheckedItem, CitedRecord, Citation, DateKind, FactField,
  FilledFact, Fields, PodReplyFact, Pointed, RecordsReplyFact, Reply, ReplyFact, Verdict,
];
export const none: CheckedReply = { errors: [], items: [] };
`;

/** A page that types a checked reply wrongly: its `errors` are numbers. */
const WRONG_SOURCE = `
import type { CheckedReply } from "./index.js";
export const wrong: CheckedReply = { errors: [1], items: [] };
`;

describe("Importing the package in a web page · browserBuildVersion(), cascadeRuntime()", () => {
  describe('given a page written in TypeScript with `customConditions: ["browser"]`', () => {
    let right: string[];
    let wrong: string[];

    before(() => {
      const options: ts.CompilerOptions = {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2023,
        customConditions: ["browser"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      };
      const sources = new Map([
        [PAGE, PAGE_SOURCE],
        [WRONG, WRONG_SOURCE],
      ]);
      const host = ts.createCompilerHost(options);
      const read = host.getSourceFile.bind(host);
      host.getSourceFile = (name, ...rest) => {
        const source = sources.get(name);
        return source === undefined
          ? read(name, ...rest)
          : ts.createSourceFile(
              name,
              source,
              options.target ?? ts.ScriptTarget.ES2023,
            );
      };
      const readable = host.fileExists.bind(host);
      host.fileExists = (name) => sources.has(name) || readable(name);
      const program = ts.createProgram([PAGE, WRONG], options, host);
      const problems = (file: string) => {
        const source = program.getSourceFile(file);
        assert.ok(source);
        return program
          .getSemanticDiagnostics(source)
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      };
      right = problems(PAGE);
      wrong = problems(WRONG);
    });

    it("exports every type a page names to show a checked reply: 20 of them, from `Absence` to `Verdict`", () => {
      const named = [...PAGE_SOURCE.matchAll(/^ {2}(\w+),$/gm)].map(
        (m) => m[1],
      );
      assert.equal(named.length, 20);
      assert.deepEqual([named[0], named.at(-1)], ["Absence", "Verdict"]);
      assert.deepEqual(right, []);
    });

    it("fails to type-check a `CheckedReply` whose `errors` are numbers", () => {
      assert.equal(wrong.length, 1);
      assert.match(wrong[0]!, /not assignable to type 'string'/);
    });
  });
});
