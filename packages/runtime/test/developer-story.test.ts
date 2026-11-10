import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, describe, it } from "node:test";
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
  if (APP === undefined)
    await writeFile(
      join(folder, "cascade-runtime.json"),
      JSON.stringify({ tables: { checkOnOpen: false } }),
    );
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

/** The row with its entry as the path inside its pod: the replay's pod and the script's have different addresses. */
function inPod(row: Record<string, string>): Record<string, string> {
  return row.entry === undefined
    ? row
    : {
        ...row,
        entry: row.entry.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*\//i, ""),
      };
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

const LISINOPRIL = {
  medication: "lisinopril 10 MG Oral Tablet",
  code: "https://ns.cascadeprotocol.org/codes/rxnorm/314076",
  records: "2",
};
const AMLODIPINE = {
  medication: "amlodipine 5 MG Oral Tablet",
  code: "https://ns.cascadeprotocol.org/codes/rxnorm/197361",
  records: "1",
};

/**
 * The two scripts the README walks a developer through, run as that developer runs them: from a folder outside the
 * repository, on a kit's downloads, with the real Bridge.
 */
describe("The developer story's scripts, run from a fresh folder · developer-story/allergies.mjs, developer-story/medications.mjs", () => {
  describe("when `allergies.mjs` is run on Alex's first export", () => {
    let printed: Record<string, string>[];
    let expected: Record<string, string>[];

    before(async () => {
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
      expected = (await store.select(query.text)).rows.map((row) =>
        inPod(
          Object.fromEntries(
            [...row].map(([column, term]) => [column, term.value]),
          ),
        ),
      );
      printed = await story("allergies.mjs", "alex-pod", [
        join(vocabulary.files.folder, FIRST_EXPORT),
      ]);
    });

    it('prints the rows that "My active allergies" answers on the kit\'s replay through step J1', (t) => {
      for (const row of printed) t.diagnostic(JSON.stringify(row));
      assert.deepEqual(multiset(printed.map(inPod)), multiset(expected));
    });
  });

  /**
   * The lisinopril of Priya's FHIR export and of her C-CDA summary is one entry: a README script reaches rule P2.
   * @rule conformance/priya-natarajan/priya-natarajan.feature P2
   */
  describe("when `medications.mjs` is run on Priya's export and her health summary", () => {
    let printed: Record<string, string>[];
    const medication = ({
      medication,
      code,
      records,
    }: Record<string, string>) => ({ medication, code, records });

    before(async () => {
      const { files } = await kits();
      printed = await story(
        "medications.mjs",
        "priya-pod",
        [
          join(files.folder, PRIYA_DOWNLOADS, "x-e2", "apple_health_export"),
          join(
            files.folder,
            PRIYA_DOWNLOADS,
            "kestrel-harbor-health-summary.xml",
          ),
        ],
        DRUG_PRODUCTS,
      );
    });

    it("prints an entry for every row, and no entry twice", (t) => {
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
    });

    it("prints lisinopril once, with two records", () => {
      assert.deepEqual(
        printed
          .filter((row) => row.medication === LISINOPRIL.medication)
          .map(medication),
        [LISINOPRIL],
      );
    });

    it("prints amlodipine once, with one record, and no other medication", () => {
      assert.deepEqual(
        multiset(printed.map(medication)),
        multiset([LISINOPRIL, AMLODIPINE]),
      );
    });
  });
});
