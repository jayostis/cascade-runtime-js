import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { podDataset } from "../src/dataset.js";
import { MemoryFiles } from "../src/files.js";
import { OxigraphStore } from "../src/oxigraph-store.js";
import { questions } from "../src/questions.js";
import { packed, vocabularyOf } from "../src/node/components.js";
import { localVocabulary } from "../src/node/runtime.js";
import { featurePod } from "../src/node/story-pod.js";
import { ROOT } from "./vocabulary.js";

const ALEX = "conformance/alex-rivera/alex-rivera.feature";
const FIRST_EXPORT =
  "conformance/alex-rivera/scripted-input/alex/downloads/x-e2/apple_health_export";
const PRIYA_DOWNLOADS =
  "conformance/priya-natarajan/scripted-input/priya/downloads";
const QUESTION = "pod/My active allergies";
/** A folder cascade-runtime's tarball is installed in, beside a copy of the script, to run the installed package. */
const APP =
  process.env.CASCADE_RUNTIME_APP === undefined
    ? undefined
    : resolve(process.env.CASCADE_RUNTIME_APP);

/** The folder the developer story's scripts and downloads are in: the repository's, or the app's copy of it. */
const STORY = APP ?? join(ROOT, "developer-story");

/** A tables store holding one version of a drug products series, so a fresh folder reads it without the feed. */
const DRUG_PRODUCTS = join(
  ROOT,
  "packages",
  "runtime",
  "test",
  "drug-products",
);

/**
 * Each row the script printed, run from a fresh folder, or the app's, on the arguments; its pod is removed after. A
 * fresh folder starts with `tables` as its `.tables/`; the app brings its own.
 */
async function story(
  script: string,
  pod: string,
  downloads: readonly string[],
  tables?: string,
): Promise<Record<string, string>[]> {
  const folder = APP ?? (await mkdtemp(join(tmpdir(), "developer-story-")));
  if (APP === undefined && tables !== undefined)
    await cp(tables, join(folder, ".tables"), { recursive: true });
  const permissions =
    APP === undefined
      ? []
      : [
          "--permission",
          `--allow-fs-read=${APP}`,
          `--allow-fs-write=${APP}`,
          "--allow-worker",
        ];
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [...permissions, join(STORY, script), ...downloads],
      { cwd: folder, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    ).catch((error: { stderr?: string; code?: unknown; signal?: unknown }) => {
      throw new Error(
        `the script stopped (code ${String(error.code)}, signal ${String(error.signal)}): ${error.stderr || String(error)}`,
      );
    });
    const printed = stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    return printed.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([column, value]) => {
          assert.equal(typeof value, "string", `?${column} is no string`);
          return [column, value as string];
        }),
      ),
    );
  } finally {
    await rm(APP === undefined ? folder : join(APP, pod), {
      recursive: true,
      force: true,
    });
  }
}

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

/** The vocabulary the kits are in: the checkout's, or the installed package's. */
async function kits() {
  return APP === undefined
    ? localVocabulary(ROOT)
    : vocabularyOf(
        await packed(
          join(APP, "node_modules", "cascade-runtime", "components"),
        ),
      );
}

test("the developer story prints Alex's active allergies as the replay through J1 answers them", async (t) => {
  const vocabulary = await kits();
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
    Object.fromEntries([...row].map(([column, term]) => [column, term.value])),
  );

  const printed = await story("allergies.mjs", "alex-pod", [
    join(vocabulary.files.folder, FIRST_EXPORT),
  ]);
  for (const row of printed) t.diagnostic(JSON.stringify(row));
  assert.deepEqual(multiset(printed), multiset(expected));
});

test("the second developer story prints Priya's active medications, the lisinopril both formats carry as one entry", async (t) => {
  const { files } = await kits();
  const printed = await story(
    "medications.mjs",
    "priya-pod",
    [
      join(files.folder, PRIYA_DOWNLOADS, "x-e2", "apple_health_export"),
      join(files.folder, PRIYA_DOWNLOADS, "kestrel-harbor-health-summary.xml"),
    ],
    DRUG_PRODUCTS,
  );
  for (const row of printed) t.diagnostic(JSON.stringify(row));
  assert.ok(
    printed.every((row) => row.entry !== undefined),
    "a row names no ?entry",
  );
  assert.equal(
    new Set(printed.map((row) => row.entry)).size,
    printed.length,
    "two rows name one entry",
  );
  assert.deepEqual(
    multiset(
      printed.map(({ medication, code, records }) => ({
        medication,
        code,
        records,
      })),
    ),
    multiset([
      {
        medication: "lisinopril 10 MG Oral Tablet",
        code: "http://www.nlm.nih.gov/research/umls/rxnorm/314076",
        records: "2",
      },
      {
        medication: "amlodipine 5 MG Oral Tablet",
        code: "http://www.nlm.nih.gov/research/umls/rxnorm/197361",
        records: "1",
      },
    ]),
  );
});
