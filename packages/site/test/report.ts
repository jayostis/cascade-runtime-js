/** A property element, the way scripts/junit-reporter.mjs writes it. */
export const prop = (name: string, value: string): string =>
  `<property name="${name}" value="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll("\n", "&#10;")}"/>`;

/** The compiled test file `name` of a package, as the CI runner's report names it. */
export const FILE = (pkg: string, name: string): string =>
  `/home/runner/work/cascade-runtime-js/cascade-runtime-js/packages/${pkg}/dist/test/${name}.js`;

/** What a doc comment and the reporter say of a describe or a test; `failure` is the message of a case that failed. */
export interface Marked {
  readonly description?: string;
  readonly rules?: readonly string[];
  readonly line?: number;
  readonly failure?: string;
}

const marks = (m: Marked): string => {
  const list = [
    ...(m.description === undefined
      ? []
      : [prop("description", m.description)]),
    ...(m.rules ?? []).map((rule) => prop("rule", rule)),
    ...(m.line === undefined ? [] : [prop("line", String(m.line))]),
  ];
  return list.length === 0 ? "" : `<properties>${list.join("")}</properties>`;
};

/** A describe holding `inner`, as node:test's JUnit nests it. */
export const described = (name: string, m: Marked, inner: string): string =>
  `<testsuite name="${name}" time="0.001" tests="1" failures="0">${marks(m)}${inner}</testsuite>`;

/** A case of `file` at `line`, passed unless `m.failure` says why it failed. */
export const leafOf = (
  name: string,
  file: string,
  line: number,
  m: Marked = {},
): string =>
  `<testcase name="${name}" time="0.001" classname="test" file="${file}" line="${line}">${marks(m)}${m.failure === undefined ? "" : `<failure message="${m.failure}">${m.failure}</failure>`}</testcase>`;

/** The property the reporter writes for the package in `dir`: its name, its version and its `spec.json`. */
export const packageProperty = (
  dir: string,
  name: string,
  version: string,
  spec: unknown,
): string =>
  `<properties>${prop(`package:${dir}`, JSON.stringify({ name, version, spec }))}</properties>`;

/** A report of `body`, the packages' properties first. */
export const report = (packages: string, body: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>${packages}${body}</testsuites>\n`;
