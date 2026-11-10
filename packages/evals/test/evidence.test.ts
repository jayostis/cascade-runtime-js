import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import type { Prepared } from "../src/cases.js";
import { passageOf, podProvenance, unescaped } from "../src/evidence.js";
import { evidenceOf } from "../src/record.js";
import {
  type EntryProvenance,
  type Job,
  PASSAGE_CAP,
  type ToolCallRecord,
} from "../src/results.js";
import { downloads, PULL } from "./recorded-downloads.js";

const folder = await mkdtemp(join(tmpdir(), "cascade-evals-evid-"));
after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));

const input = { pod: "p", question: "pod/My procedures" };
const other = { pod: "p", question: "pod/My lab results" };
const absence = {
  what: "a colonoscopy",
  coverage: "every procedure the pod holds",
  match: { terms: ["colonoscopy"] },
};

const record = (call: number, tool = "ask", at = input): ToolCallRecord => ({
  job: "j",
  call,
  at: "2026-10-31T00:00:00Z",
  tool,
  input: at,
  ok: call !== 1,
  rows: call,
  entries: [],
  milliseconds: 5,
});

/** The evidence of the one absence of a pod-arm answer whose query names `call` of the tool and input `query`. */
async function podEvidence(call: number | undefined, query = input) {
  const [found] = await evidenceOf({
    job: { id: "j", arm: "pod" } as Job,
    question: "q",
    answer: {
      items: [
        {
          n: 1,
          facts: [],
          absences: [
            {
              ...absence,
              query: {
                tool: "ask",
                input: query,
                ...(call === undefined ? {} : { call }),
              },
            },
          ],
        },
      ],
    } as never,
    prepared: {} as unknown as Prepared,
    reading: [],
    provenance: () => undefined,
    toolCalls: [record(1), record(2), record(3, "ask", other)],
  });
  return found!.call;
}

/** The evidence of the one absence of a records-arm answer that names `sources`, or none. */
async function recordsEvidence(sources?: string[]) {
  const [found] = await evidenceOf({
    job: { id: "j", arm: "records" } as Job,
    question: "q",
    answer: {
      items: [{ n: 1, facts: [], absences: [{ ...absence, sources }] }],
    } as never,
    prepared: {
      documents: [
        { file: "a.json", bytes: 10 },
        { file: "b.json", bytes: 20 },
      ],
    } as unknown as Prepared,
    reading: ["a.json", "b.json"],
    read: ["a.json"],
    provenance: () => undefined,
    toolCalls: [],
  });
  return found!;
}

/**
 * For the report, each citation is looked up by program: a file's passage and the download it came from, or a view
 * entry's records, their versions and documents. Nothing here is the model's word. Whether an absence is backed is
 * decided by "Checking what a reply says a pod lacks · checkAbsence()" on cascade-runtime's page; here is only which call the
 * report shows.
 */
describe("Resolving a citation to what it cites · passageOf(), podProvenance(), evidenceOf()", () => {
  describe("passageOf(downloads, cite)", () => {
    const file = "north-2026-10/bundle.json";
    let at: string;
    let lines: string[];
    let resource: Awaited<ReturnType<typeof passageOf>>;
    let line: Awaited<ReturnType<typeof passageOf>>;
    let none: Awaited<ReturnType<typeof passageOf>>;
    let cut: Awaited<ReturnType<typeof passageOf>>;
    let within: Awaited<ReturnType<typeof passageOf>>;
    let past: Awaited<ReturnType<typeof passageOf>>;

    before(async () => {
      at = await downloads(join(folder, "passages"));
      lines = (await readFile(join(at, file), "utf8")).split("\n");
      resource = await passageOf(at, {
        file,
        resource: "MedicationRequest/m-1",
      });
      line = await passageOf(at, { file, line: 3 });
      none = await passageOf(at, { file, resource: "Condition/none" });
      const long = join(folder, "downloads");
      await mkdir(join(long, "d"), { recursive: true });
      await writeFile(
        join(long, "d", "long.json"),
        "x".repeat(PASSAGE_CAP + 5),
      );
      await writeFile(join(long, "d", "two.txt"), "one\ntwo\n");
      cut = await passageOf(long, { file: "d/long.json", line: 1 });
      within = await passageOf(long, { file: "d/two.txt", line: 2 });
      past = await passageOf(long, { file: "d/two.txt", line: 3 });
    });

    it("returns the resource a citation names, as the file writes it, with its JSON pointer", async () => {
      assert.ok(resource !== undefined);
      assert.equal(resource.pointer, "/entry/7/resource");
      assert.match(resource.text, /Jardiance 10 mg tablet/);
      const bundle = JSON.parse(lines.join("\n")) as {
        entry: { resource: unknown }[];
      };
      assert.deepEqual(JSON.parse(resource.text), bundle.entry[7]!.resource);
      assert.ok(
        lines
          .slice(resource.from - 1, resource.to)
          .join("\n")
          .includes(resource.text),
      );
    });

    it("returns the line a citation names, with the line's number as `from` and `to`", () => {
      assert.deepEqual([line?.from, line?.to, line?.text], [3, 3, lines[2]]);
    });

    it("returns with the passage the source and retrieval time of the download the file is in", () => {
      assert.deepEqual(resource?.download, PULL);
    });

    it("cuts a passage at `PASSAGE_CAP` characters and marks it `truncated`", () => {
      assert.equal(cut?.text.length, PASSAGE_CAP);
      assert.equal(cut?.truncated, true);
    });

    it("leaves a passage within the cap whole and not marked `truncated`", () => {
      assert.equal(within?.text, "two");
      assert.equal(within?.truncated, undefined);
    });

    it("returns undefined for a line past the file's last", () => {
      assert.equal(past, undefined);
    });

    it("returns undefined for a resource the file does not hold", () => {
      assert.equal(none, undefined);
    });
  });

  describe("given a FHIR bundle written on one line", () => {
    it("finds each resource whole, though a string before it holds braces, brackets, quotes and backslashes", async () => {
      const at = join(folder, "minified");
      await mkdir(join(at, "d"), { recursive: true });
      const tricky = 'a } ] " { \\ , [ b \\" \\\\';
      const resources = [
        { resourceType: "Observation", id: "o-1", note: tricky },
        {
          resourceType: "Condition",
          id: "c-1",
          note: [tricky, { x: tricky }],
        },
        { resourceType: "Observation", id: "o-2", note: "after" },
      ];
      const text = JSON.stringify({
        resourceType: "Bundle",
        entry: resources.map((resource) => ({ resource })),
      });
      assert.ok(!text.includes("\n"));
      await writeFile(join(at, "d", "bundle.json"), text);
      for (const [index, resource] of resources.entries()) {
        const passage = await passageOf(at, {
          file: "d/bundle.json",
          resource: `${resource.resourceType}/${resource.id}`,
        });
        assert.deepEqual(JSON.parse(passage!.text), resource);
        assert.equal(passage!.pointer, `/entry/${index}/resource`);
        assert.deepEqual([passage!.from, passage!.to], [1, 1]);
      }
    });
  });

  describe("podProvenance(pod)", () => {
    const entryIri =
      "pod://b77cda3b-c4b6-44c1-98ff-e433d2aed4b8/clinical/medications.ttl#4c38f471e928531aabdcd1375340f94c1357810bc3cd98d2912d20e99a8615e3";
    let resolve: (entry: string) => EntryProvenance | undefined;
    let entry: EntryProvenance | undefined;

    before(async () => {
      resolve = await podProvenance(
        fileURLToPath(
          new URL("../../test/fixtures/pod-provenance", import.meta.url),
        ),
      );
      entry = resolve(entryIri);
    });

    it("returns the view entry's type", () => {
      assert.equal(entry?.type, "PrescribedOrReportedMedication");
    });

    it("returns each record of the view entry with its id at its source and its address there", () => {
      const [member] = entry!.members;
      assert.equal(member?.sourceId, "story-stopped-medrx-2");
      assert.equal(
        member?.sourceUrl,
        "https://cascade-north.demo.invalid/fhir/MedicationRequest/story-stopped-medrx-2",
      );
    });

    it("returns each version of a record with the time it was observed and where in its document it stood", () => {
      const [revision] = entry!.members[0]!.revisions;
      assert.equal(revision?.observedAsOf, "2026-10-15T00:00:00Z");
      assert.equal(revision?.selector, "/entry/5");
    });

    it("returns the documents the versions were read from, with their server", () => {
      const [revision] = entry!.members[0]!.revisions;
      assert.deepEqual(
        [
          revision?.document?.retrievedOn,
          revision?.document?.author,
          revision?.document?.server,
        ],
        [
          "2026-10-15T00:00:00Z",
          "Cascade North Demo Hospital",
          "https://cascade-north.demo.invalid/fhir",
        ],
      );
    });

    it("returns undefined for a view entry the pod does not hold", () => {
      assert.equal(
        resolve(
          "pod://b77cda3b-c4b6-44c1-98ff-e433d2aed4b8/clinical/medications.ttl#none",
        ),
        undefined,
      );
    });
  });

  describe("unescaped(text)", () => {
    it("undoes the escapes of a Turtle string: quote, backslash, newline, tab and carriage return", () => {
      assert.equal(
        unescaped('a \\"b\\" \\\\ c\\nd\\te\\rf'),
        'a "b" \\ c\nd\te\rf',
      );
    });

    it("leaves an escape Turtle does not have, and undefined, as they are", () => {
      assert.equal(unescaped("\\q"), "\\q");
      assert.equal(unescaped(undefined), undefined);
    });
  });

  describe("given an absence of the pod arm (`evidenceOf()`)", () => {
    it("returns the tool call the absence names by number", async () => {
      assert.equal((await podEvidence(2))?.call, 2);
    });

    it("returns the call though it did not succeed", async () => {
      const failed = await podEvidence(1);
      assert.equal(failed?.call, 1);
      assert.equal(failed?.ok, false);
    });

    it("returns null when the number is no call's, or is a call of another input", async () => {
      assert.equal(await podEvidence(99), null);
      assert.equal(await podEvidence(3), null);
    });

    it("returns the first call of the absence's tool and input that answered when it names no number", async () => {
      assert.equal((await podEvidence(undefined))?.call, 2);
    });
  });

  describe("given an absence of the records arm (`evidenceOf()`)", () => {
    it("returns `stated: true` and the files the absence names, each with whether the job read it and its size", async () => {
      const named = await recordsEvidence(["b.json"]);
      assert.equal(named.stated, true);
      assert.deepEqual(named.files, [
        { file: "b.json", read: false, bytes: 20 },
      ]);
    });

    it("returns `stated: false` and every file the arm was given, when the absence names none", async () => {
      const defaulted = await recordsEvidence();
      assert.equal(defaulted.stated, false);
      assert.deepEqual(defaulted.files, [
        { file: "a.json", read: true, bytes: 10 },
        { file: "b.json", read: false, bytes: 20 },
      ]);
    });
  });
});
