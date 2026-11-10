import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readJunit } from "../src/junit.js";
import { checkShape, type ShapeProblem } from "../src/spec-shape.js";

const FOLDER = "packages/cascade-runtime";
const SPEC_PATH = `${FOLDER}/test/spec.json`;
const CLI = fileURLToPath(
  new URL("../../../../scripts/spec-shape.mjs", import.meta.url),
);

/** A case as node:test's JUnit report writes it: nested `testsuite`s are its describes, `file` its compiled test file. */
function xml(
  cases: readonly (readonly [file: string, ...titles: string[]])[],
): string {
  const body = cases
    .map(([file, ...titles]) => {
      const name = titles.at(-1) ?? "";
      const compiled = `/home/runner/work/x/x/${FOLDER}/dist/test/${file.replace(/\.ts$/, ".js")}`;
      const open = titles
        .slice(0, -1)
        .map((title) => `<testsuite name="${title}">`)
        .join("");
      const close = "</testsuite>".repeat(titles.length - 1);
      return `${open}<testcase name="${name}" time="0.001" classname="test" file="${compiled}"/>${close}`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?><testsuites>${body}</testsuites>`;
}

const CAPABILITY = "Opening a pod · openPod()";
const NAMES = "Names for terms · terms, codeStems";
const SPEC = {
  capabilities: [CAPABILITY, "Asking a pod questions · pod.ask()", NAMES],
  shaped: ["sample.test.ts"],
  build: ["launch.test.ts"],
  glossary: [{ term: "pod", definition: "one person's records." }],
};

function check(
  cases: readonly (readonly [file: string, ...titles: string[]])[],
  spec: unknown = SPEC,
) {
  return checkShape(readJunit(xml(cases)).cases, spec, SPEC_PATH);
}

function reported(
  problems: readonly ShapeProblem[],
  rule: ShapeProblem["rule"],
): string[] {
  return problems.filter((one) => one.rule === rule).map((one) => one.case);
}

/** The problems of the verb rule for a leaf of that name, under the first listed capability. */
const leaf = (title: string) =>
  reported(
    check([["sample.test.ts", CAPABILITY, "openPod()", title]]).problems,
    "verb",
  );

/**
 * `checkShape()` reads a package's cases from a JUnit report and the `spec.json` beside its tests, and reports each case
 * whose titles break the grammar of a tests page. It is the gate that keeps a page a specification as tests are added.
 */
describe("Checking that tests read as a specification · checkShape()", () => {
  describe("with cases that read as a specification", () => {
    it("reports nothing and counts the cases it checked", () => {
      const report = check([
        ["sample.test.ts", CAPABILITY, "openPod()", "returns an address"],
        [
          "sample.test.ts",
          CAPABILITY,
          "when the folder is empty",
          "holds nothing",
        ],
        [
          "sample.test.ts",
          CAPABILITY,
          "openPod(), sixWords()",
          "is idempotent",
        ],
        ["sample.test.ts", NAMES, "terms", "has no duplicates"],
        [
          "sample.test.ts",
          CAPABILITY,
          "given a secret",
          "throws Refusal for none",
        ],
        ["sample.test.ts", CAPABILITY, "pod.ask()", "ends the run"],
        ["sample.test.ts", CAPABILITY, "returns an address"],
      ]);
      assert.deepEqual(report.problems, []);
      assert.equal(report.checked, 7);
      assert.equal(report.skipped, undefined);
    });
  });

  describe("with a case outside every listed capability", () => {
    it("names the case and the capability it sits under", () => {
      const report = check([
        ["sample.test.ts", "Something else", "pod.look()", "returns rows"],
      ]);
      assert.deepEqual(reported(report.problems, "capability"), [
        "Something else › pod.look() › returns rows",
      ]);
    });

    it("reports a case with no describe at all", () => {
      const report = check([["sample.test.ts", "returns rows"]]);
      assert.deepEqual(reported(report.problems, "capability"), [
        "returns rows",
      ]);
    });
  });

  describe("with a case nested four levels deep", () => {
    it("names the case", () => {
      const report = check([
        [
          "sample.test.ts",
          CAPABILITY,
          "openPod()",
          "when the folder is empty",
          "returns an address",
        ],
      ]);
      assert.deepEqual(reported(report.problems, "depth"), [
        `${CAPABILITY} › openPod() › when the folder is empty › returns an address`,
      ]);
    });
  });

  describe("with a second level that is neither code nor a situation", () => {
    it("names the case", () => {
      const report = check([
        ["sample.test.ts", CAPABILITY, "the answers published", "returns rows"],
        ["sample.test.ts", CAPABILITY, "whenever it runs", "returns rows"],
      ]);
      assert.deepEqual(reported(report.problems, "level-2"), [
        `${CAPABILITY} › the answers published › returns rows`,
        `${CAPABILITY} › whenever it runs › returns rows`,
      ]);
    });

    it("reports a bare word the capability does not name as its API", () => {
      for (const word of ["answers", "files", "Pods", "the", "refusals"])
        assert.deepEqual(
          reported(
            check([["sample.test.ts", NAMES, word, "returns rows"]]).problems,
            "level-2",
          ),
          [`${NAMES} › ${word} › returns rows`],
          word,
        );
    });

    it("accepts a bare word the capability names after its dot, and code written as code", () => {
      for (const second of [
        "replayKit(kit, folder, { through })",
        "terms",
        "codeStems",
        "terms, codeStems",
        "`x`",
        "a.b",
      ])
        assert.deepEqual(
          reported(
            check([["sample.test.ts", NAMES, second, "returns rows"]]).problems,
            "level-2",
          ),
          [],
          second,
        );
    });
  });

  describe("with a leaf that does not begin with a singular present-tense verb", () => {
    it("reports one that begins with should", () => {
      assert.deepEqual(leaf("should return an address"), [
        `${CAPABILITY} › openPod() › should return an address`,
      ]);
    });

    it("reports a plural verb", () => {
      assert.equal(leaf("return an address").length, 1);
      assert.equal(leaf("give no rows").length, 1);
    });

    it("reports a past tense and a gerund", () => {
      assert.equal(leaf("returned an address").length, 1);
      assert.equal(leaf("returning an address").length, 1);
    });

    it("reports the false friends of the -s rule", () => {
      for (const title of [
        "its rows are listed",
        "this holds",
        "status is shown",
        "was opened",
        "plus one",
      ])
        assert.equal(leaf(title).length, 1, title);
    });

    it("reports a plural noun that leads a passive or a possessive leaf", () => {
      for (const title of [
        "rows are found",
        "tables were taken",
        "files have changed",
        "rows do not match",
        "renewals of one drug are merged",
      ])
        assert.equal(leaf(title).length, 1, title);
    });

    it("reports a word ending in -ous, and the false friends alias, canvas, lens, focus and versus", () => {
      for (const title of [
        "previous rows are kept",
        "various rows come back",
        "obvious rows come back",
        "alias is kept",
        "canvas is drawn",
        "lens is used",
        "focus is kept",
        "versus is not a verb",
      ])
        assert.equal(leaf(title).length, 1, title);
    });

    it("reports a leaf that begins with a capital, a digit or a quote", () => {
      for (const title of ["Returns rows", "2 rows come back", "'a' is kept"])
        assert.equal(leaf(title).length, 1, title);
    });

    it("still reports a noun, a gerund or a past tense after an adverb", () => {
      for (const title of [
        "never rows are kept",
        "only returned rows",
        "always",
      ])
        assert.equal(leaf(title).length, 1, title);
    });
  });

  describe("with a leaf the -s rule would misread", () => {
    it("accepts the irregular singular verbs and any other word ending in s", () => {
      for (const title of [
        "is empty",
        "has no rows",
        "does not return rows",
        "goes nowhere",
        "throws Refusal for none",
        "throws, naming the reader, when it fails",
        "returns rows",
      ])
        assert.deepEqual(leaf(title), [], title);
    });

    it("accepts an adverb before the verb, a contraction, and punctuation after the verb", () => {
      for (const title of [
        "never writes",
        "only returns rows",
        "still opens the pod",
        "always returns an address",
        "also keeps rows",
        "then reads the folder",
        "doesn't write",
        "can't open",
        "isn't kept",
        "returns…",
        "writes.",
      ])
        assert.deepEqual(leaf(title), [], title);
    });

    it("accepts a first word the spec's allow list names", () => {
      const spec = { ...SPEC, allow: ["status"] };
      const report = check(
        [["sample.test.ts", CAPABILITY, "openPod()", "status is shown"]],
        spec,
      );
      assert.deepEqual(report.problems, []);
    });
  });

  describe("with a file listed under build", () => {
    const report = check([
      ["launch.test.ts", "Anything at all", "should be left alone"],
      ["launch.test.ts", "Anything at all", "when it builds", "returns rows"],
      ["launch.test.ts", "Anything at all", "bundle()", "returns rows"],
      ["launch.test.ts", "Anything at all", "the bundle", "returns rows"],
      ["launch.test.ts", "Anything at all", "terms", "returns rows"],
    ]);

    it("does not require a capability", () => {
      assert.deepEqual(reported(report.problems, "capability"), []);
    });

    it("still reads the second level's grammar, with no capability to name a bare word", () => {
      assert.deepEqual(reported(report.problems, "level-2"), [
        "Anything at all › the bundle › returns rows",
        "Anything at all › terms › returns rows",
      ]);
    });

    it("still reads the leaf's grammar", () => {
      assert.deepEqual(reported(report.problems, "verb"), [
        "Anything at all › should be left alone",
      ]);
    });
  });

  describe("with a capability listed under build", () => {
    it("does not require it to be a listed capability", () => {
      const spec = { ...SPEC, build: ["Packaging"] };
      const report = check(
        [["sample.test.ts", "Packaging", "returns rows"]],
        spec,
      );
      assert.deepEqual(report.problems, []);
    });
  });

  describe("with a file the spec does not list as shaped", () => {
    it("leaves its cases alone", () => {
      const report = check([
        ["flat.test.ts", "should be left alone"],
        ["sample.test.ts", CAPABILITY, "openPod()", "returns an address"],
      ]);
      assert.deepEqual(report.problems, []);
      assert.equal(report.checked, 1);
    });

    it("leaves the cases of another package alone", () => {
      const other = `<testsuites><testcase name="should" classname="test" file="/x/packages/site/dist/test/sample.test.js"/></testsuites>`;
      const report = checkShape(readJunit(other).cases, SPEC, SPEC_PATH);
      assert.equal(report.checked, 0);
    });
  });

  describe("with a shaped file that has no case in the report", () => {
    it("names the file", () => {
      const report = check([["flat.test.ts", "returns rows"]]);
      assert.deepEqual(reported(report.problems, "shaped"), ["sample.test.ts"]);
    });
  });

  describe("with no shaped list", () => {
    const spec = { capabilities: SPEC.capabilities };

    it("checks every case of the package", () => {
      const report = check([["flat.test.ts", "returns rows"]], spec);
      assert.deepEqual(reported(report.problems, "capability"), [
        "returns rows",
      ]);
    });
  });

  describe("with a glossary term defined twice", () => {
    it("names the term, whatever its case", () => {
      const spec = {
        ...SPEC,
        glossary: [
          { term: "pod", definition: "one person's records." },
          { term: "Pod", definition: "a folder." },
          { term: "record", definition: "one thing said." },
        ],
      };
      const report = check([], spec);
      assert.deepEqual(reported(report.problems, "glossary"), ["Pod"]);
    });
  });

  describe("with a spec whose package has no case in the report", () => {
    it("reports it, naming the spec path it resolved, rather than passing silently", () => {
      const report = checkShape(
        readJunit(
          xml([["sample.test.ts", CAPABILITY, "openPod()", "returns rows"]]),
        ).cases,
        SPEC,
        "C:/work/py/tests/spec.json",
      );
      assert.equal(report.checked, 0);
      assert.deepEqual(reported(report.problems, "owns"), [
        "C:/work/py/tests/spec.json",
      ]);
    });
  });

  describe("with a spec that lists no capabilities", () => {
    it("checks nothing and says why", () => {
      for (const spec of [{}, { capabilities: [] }, { capabilities: "x" }]) {
        const report = check([["flat.test.ts", "should"]], spec);
        assert.deepEqual(report.problems, []);
        assert.match(report.skipped ?? "", /no capabilities/);
        assert.equal(report.checked, 0);
      }
    });

    it("checks nothing when the spec is not an object", () => {
      for (const spec of [null, 3, "x", []])
        assert.match(check([], spec).skipped ?? "", /no capabilities/);
    });
  });
});

/**
 * `node scripts/spec-shape.mjs <junit> <spec.json>` runs the check in CI on each package's `spec.json`. Its exit status says
 * which of three things happened: the tests read as a specification, a title breaks a rule, or it could not check.
 */
describe("Checking a package's tests from the command line · scripts/spec-shape.mjs", () => {
  let folder: string;

  before(() => {
    folder = mkdtempSync(join(tmpdir(), "spec-shape-"));
  });

  after(() => {
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  });

  /** The command over a report of `cases` and a `spec.json` of `spec` in the package's own folder. */
  const run = (cases: Parameters<typeof xml>[0], spec: unknown) => {
    const junit = join(folder, "junit.xml");
    const specFile = join(folder, FOLDER, "test", "spec.json");
    mkdirSync(dirname(specFile), { recursive: true });
    writeFileSync(junit, xml(cases));
    writeFileSync(specFile, JSON.stringify(spec));
    return spawnSync(process.execPath, [CLI, junit, specFile], {
      encoding: "utf8",
    });
  };

  describe("with a case that breaks a rule", () => {
    it("exits 1, naming each case", () => {
      const done = run(
        [
          ["sample.test.ts", "Something else", "returns rows"],
          ["sample.test.ts", CAPABILITY, "openPod()", "should return rows"],
        ],
        SPEC,
      );
      assert.equal(done.status, 1);
      assert.match(done.stdout, /Something else › returns rows/);
      assert.match(done.stdout, /should return rows/);
    });
  });

  describe("with a spec outside every folder the report names", () => {
    it("exits 1, since no case of the report is of the spec's package", () => {
      const junit = join(folder, "own.xml");
      const specFile = join(folder, "py", "tests", "spec.json");
      mkdirSync(dirname(specFile), { recursive: true });
      writeFileSync(
        junit,
        xml([["sample.test.ts", CAPABILITY, "openPod()", "returns rows"]]),
      );
      writeFileSync(
        specFile,
        JSON.stringify({ capabilities: SPEC.capabilities }),
      );
      const done = spawnSync(process.execPath, [CLI, junit, specFile], {
        encoding: "utf8",
      });
      assert.equal(done.status, 1);
      assert.match(done.stdout, /owns: /);
    });
  });

  describe("with a spec that lists no capabilities", () => {
    it("exits 0, saying it checked nothing", () => {
      const done = run([["flat.test.ts", "should"]], { about: "x" });
      assert.equal(done.status, 0);
      assert.match(done.stdout, /skipped, the spec lists no capabilities/);
    });
  });

  describe("with a report that is not JUnit", () => {
    it("exits 2", () => {
      const junit = join(folder, "not-junit.xml");
      writeFileSync(junit, "<html></html>");
      const spec = join(folder, "spec.json");
      writeFileSync(spec, JSON.stringify(SPEC));
      const done = spawnSync(process.execPath, [CLI, junit, spec], {
        encoding: "utf8",
      });
      assert.equal(done.status, 2);
    });
  });

  describe("with a missing argument", () => {
    it("exits 2", () => {
      const junit = join(folder, "report.xml");
      writeFileSync(junit, xml([]));
      for (const args of [[junit], []]) {
        const done = spawnSync(process.execPath, [CLI, ...args], {
          encoding: "utf8",
        });
        assert.equal(done.status, 2, args.join(" "));
      }
    });
  });
});
