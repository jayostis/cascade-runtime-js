import { readFileSync } from "node:fs";
import process from "node:process";
import { readJunit } from "../packages/site/src/junit.ts";
import { checkShape } from "../packages/site/src/spec-shape.ts";

/**
 * Whether a package's test results read as a specification: `node scripts/spec-shape.mjs <junit.xml> <spec.json>`, the
 * rules in `packages/site/src/spec-shape.ts`. Exits 1 and names each case that breaks one; 0 when none does, or when the
 * spec lists no `capabilities` and the package is skipped; 2 when it cannot read its arguments. Another repository runs it
 * from a sparse checkout of this one's `scripts` and `packages/site/src`; Node runs the TypeScript there by stripping its
 * types (Node 22.18 or later).
 */
function run([junit, specFile, ...rest]) {
  if (junit === undefined || specFile === undefined || rest.length > 0) {
    process.stderr.write(
      "usage: node scripts/spec-shape.mjs <junit.xml> <spec.json>\n",
    );
    return 2;
  }
  let report;
  try {
    report = checkShape(
      readJunit(readFileSync(junit, "utf8")).cases,
      JSON.parse(readFileSync(specFile, "utf8")),
      specFile,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    return 2;
  }
  if (report.skipped !== undefined) {
    process.stdout.write(`${specFile}: skipped, ${report.skipped}\n`);
    return 0;
  }
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const { rule, case: title, message, suite, line } of report.problems) {
    process.stdout.write(`${rule}: ${title}: ${message}\n`);
    if (annotate && suite !== undefined)
      process.stdout.write(
        `::error file=${suite}${line === undefined ? "" : `,line=${line}`}::${rule}: ${title}: ${message}\n`,
      );
  }
  process.stdout.write(
    `${specFile}: ${report.checked} cases checked, ${report.problems.length} problems\n`,
  );
  return report.problems.length === 0 ? 0 : 1;
}

process.exitCode = run(process.argv.slice(2));
