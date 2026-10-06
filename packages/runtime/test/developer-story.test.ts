import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { podDataset } from "../src/dataset.js";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { questions } from "../src/questions.js";
import { localVocabulary } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { ROOT } from "./vocabulary.js";

const ALEX = "conformance/alex-rivera/alex-rivera.feature";
const FIRST_EXPORT =
  "conformance/alex-rivera/scripted-input/alex/downloads/x-e2/apple_health_export";
const QUESTION = "pod/My active allergies";

/** Each row as one string, its columns in name order, so two answers compare as multisets. */
function multiset(rows: readonly Record<string, unknown>[]): string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    )
    .sort();
}

test(
  "the developer story prints Alex's active allergies as the replay through J1 answers them",
  { todo: "waits for #20's step 2b, the app-facing interface (#28)" },
  async () => {
    const vocabulary = await localVocabulary(ROOT);
    const replayed = await featurePod(
      vocabulary,
      ALEX,
      new MemoryFiles("https://pod.example/"),
      { through: "J1" },
    );
    const matched = replayed.steps.find(({ step }) => step.name === "M5");
    assert.ok(matched, "the replay through J1 has no matcher run M5");
    assert.equal(matched.refused, undefined, "M5 was refused");
    assert.deepEqual(
      matched.wrote,
      [],
      "M5 wrote files, so the replay, which claims after the matcher run, may no longer answer as the script, which claims at the import",
    );
    const last = replayed.steps.at(-1);
    assert.ok(last, `the replay of ${ALEX} through J1 performed no step`);
    const { store } = await podDataset(
      replayed.pod,
      vocabulary.layout,
      vocabulary.build,
      vocabulary.config.lens,
      new OxigraphStore(),
      { title: replayed.title, at: last.step.when },
    );
    const query = (await questions(vocabulary.files)).get(QUESTION);
    assert.ok(query, `the vocabulary has no question ${QUESTION}`);
    const expected = (await store.select(query.text)).rows.map((row) =>
      Object.fromEntries(
        [...row].map(([column, term]) => [column, term.value]),
      ),
    );

    const folder = await mkdtemp(join(tmpdir(), "developer-story-"));
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          join(ROOT, "developer-story", "allergies.mjs"),
          join(vocabulary.files.folder, FIRST_EXPORT),
        ],
        { cwd: folder, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      ).catch(
        (error: { stderr?: string; code?: unknown; signal?: unknown }) => {
          throw new Error(
            `the script stopped (code ${String(error.code)}, signal ${String(error.signal)}): ${error.stderr || String(error)}`,
          );
        },
      );
      const printed = stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      for (const row of printed) {
        for (const [column, value] of Object.entries(row))
          assert.equal(typeof value, "string", `?${column} is no string`);
      }
      assert.deepEqual(multiset(printed), multiset(expected));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
