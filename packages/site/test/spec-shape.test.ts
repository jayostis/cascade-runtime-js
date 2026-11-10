import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { after, describe, it } from "node:test";
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
const SPEC = {
  capabilities: [CAPABILITY, "Asking a pod questions · pod.ask()"],
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

describe("checkShape(cases, spec, specPath)", () => {
  describe("with cases that read as a specification", () => {
    it("reports nothing and counts the cases it checked", () => {
      const report = check([
        ["sample.test.ts", CAPABILITY, "openPod()", "returns an address"],
        ["sample.test.ts", CAPABILITY, "when the folder is empty", "holds nothing"],
        ["sample.test.ts", CAPABILITY, "openPod(), sixWords()", "is idempotent"],
        ["sample.test.ts", CAPABILITY, "terms", "has no duplicates"],
        ["sample.test.ts", CAPABILITY, "given a secret", "throws Refusal for none"],
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
  });

  describe("with a leaf that does not begin with a singular present-tense verb", () => {
    const leaf = (title: string) =>
      reported(
        check([["sample.test.ts", CAPABILITY, "openPod()", title]]).problems,
        "verb",
      );

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

    it("reports a leaf that begins with a capital, a digit or a quote", () => {
      for (const title of ["Returns rows", "2 rows come back", '"a" is kept'])
        assert.equal(leaf(title).length, 1, title);
    });

    it("accepts the irregular singular verbs and any other word ending in s", () => {
      for (const title of [
        "is empty",
        "has no rows",
        "does not return rows",
        "goes nowhere",
        "throws Refusal for none",
        "returns rows",
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
      ["launch.test.ts", "Anything at all", "x".repeat(3), "returns rows"],
    ]);

    it("does not require a capability", () => {
      assert.deepEqual(reported(report.problems, "capability"), []);
    });

    it("still reads the leaf's grammar", () => {
      assert.deepEqual(reported(report.problems, "verb"), [
        "Anything at all › should be left alone",
      ]);
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

  describe("with a spec that lists no capabilities", () => {
    it("is skipped, and says so", () => {
      for (const spec of [{}, { capabilities: [] }, { capabilities: "x" }]) {
        const report = check([["flat.test.ts", "should"]], spec);
        assert.deepEqual(report.problems, []);
        assert.match(report.skipped ?? "", /no capabilities/);
        assert.equal(report.checked, 0);
      }
    });

    it("is skipped when the spec is not an object", () => {
      for (const spec of [null, 3, "x", []])
        assert.match(check([], spec).skipped ?? "", /no capabilities/);
    });
  });
});

describe("node scripts/spec-shape.mjs <junit> <spec.json>", () => {
  const folder = mkdtempSync(join(tmpdir(), "spec-shape-"));
  after(() => rmSync(folder, { recursive: true, force: true }));

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

  it("exits 1 and names each case that breaks a rule", () => {
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

  it("exits 0 for a spec that lists no capabilities, and says it skipped", () => {
    const done = run([["flat.test.ts", "should"]], { about: "x" });
    assert.equal(done.status, 0);
    assert.match(done.stdout, /skipped/);
  });
});
