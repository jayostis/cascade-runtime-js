import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ENTRY = fileURLToPath(
  new URL("../../src/browser/index.ts", import.meta.url),
).replaceAll("\\", "/");
const PAGE = ENTRY.replace(/index\.ts$/, "page-types.ts");

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
  Claim,
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
  Absence, Backing, Call, Cite, CheckedAbsence, CheckedFact, CheckedItem, CitedRecord, Claim, DateKind, FactField,
  FilledFact, Fields, PodReplyFact, Pointed, RecordsReplyFact, Reply, ReplyFact, Verdict,
];
export const none: CheckedReply = { errors: [], items: [] };
// @ts-expect-error a checked reply's errors are strings
export const wrong: CheckedReply = { errors: [1], items: [] };
`;

describe("a page that renders a checked reply", () => {
  it("types it from the browser entry", () => {
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
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (name, ...rest) =>
      name === PAGE
        ? ts.createSourceFile(
            name,
            PAGE_SOURCE,
            options.target ?? ts.ScriptTarget.ES2023,
          )
        : read(name, ...rest);
    const readable = host.fileExists.bind(host);
    host.fileExists = (name) => name === PAGE || readable(name);
    const program = ts.createProgram([PAGE], options, host);
    const page = program.getSourceFile(PAGE);
    assert.ok(page);
    const problems = program
      .getSemanticDiagnostics(page)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    assert.deepEqual(problems, []);
  });
});
