// Compares two EARL reports the conformance command wrote, as N-Triples: each names the same tests, and gives each
// the same outcome. Usage: node scripts/same-outcomes.mjs <report> <report>. Names each difference and exits 1 on any.
import { readFileSync } from "node:fs";
import process from "node:process";

const EARL = "http://www.w3.org/ns/earl#";
const LINE = /^(\S+) <([^>]+)> (<[^>]+>|_:\S+) \.$/;

function outcomes(path) {
  const tests = new Map();
  const results = new Map();
  const outcome = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const found = LINE.exec(line.trim());
    if (found === null) continue;
    const [, subject, predicate, object] = found;
    if (predicate === `${EARL}test`) tests.set(subject, object);
    else if (predicate === `${EARL}result`) results.set(subject, object);
    else if (predicate === `${EARL}outcome`) outcome.set(subject, object);
  }
  const byTest = new Map();
  for (const [assertion, test] of tests)
    byTest.set(test, outcome.get(results.get(assertion)) ?? "no outcome");
  return byTest;
}

const [first, second] = process.argv.slice(2);
if (first === undefined || second === undefined) {
  process.stderr.write(
    "usage: node scripts/same-outcomes.mjs <report> <report>\n",
  );
  process.exit(2);
}
const one = outcomes(first);
const other = outcomes(second);
const differences = [];
for (const test of new Set([...one.keys(), ...other.keys()]))
  if (one.get(test) !== other.get(test))
    differences.push(
      `${test}: ${one.get(test) ?? "not run"} in ${first}, ${other.get(test) ?? "not run"} in ${second}`,
    );
if (one.size === 0) differences.push(`${first} names no test`);
for (const difference of differences)
  process.stdout.write(`::error::${difference}\n`);
process.stdout.write(
  `${one.size} tests in ${first}, ${other.size} in ${second}; ${differences.length} differ\n`,
);
process.exitCode = differences.length === 0 ? 0 : 1;
