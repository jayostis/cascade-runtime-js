import { CHECK_ON_OPEN_MS, type Checked } from "./tables.js";

/** The tables held, as far as an outcome names them. */
type Held = readonly {
  label: string;
  versions: readonly { iri: string }[];
}[];

/** What copying the package's tables in did, as a person reads it: `bytes` written, or 0 when they were there already. */
export function startedOutcome(bytes: number, held: Held): string {
  return bytes === 0
    ? "already there"
    : `${held.length} tables, ${Math.round(bytes / 1e6)} MB`;
}

/**
 * What a check of the feeds did, as a person reads it. `aborted` is whether the check's time ran out; a feed that
 * answered, whose newer version could not be downloaded, is told apart from a feed that did not.
 */
export function checkedOutcome(
  checked: readonly Checked[],
  held: Held,
  aborted: boolean,
): string {
  const kept = new Set(checked.flatMap((one) => one.kept));
  const refused = checked.reduce((sum, one) => sum + one.refused.length, 0);
  const feedLost = checked.some((one) => one.later?.startsWith(one.feed));
  const downloadLost = checked.some(
    (one) => one.later !== undefined && !one.later.startsWith(one.feed),
  );
  const said = [];
  if (kept.size > 0) {
    const names = held
      .filter(({ versions }) => versions.some(({ iri }) => kept.has(iri)))
      .map(({ label }) => label);
    said.push(
      `kept ${kept.size} newer ${kept.size === 1 ? "version" : "versions"} (${names.join(", ")})`,
    );
  }
  const used = kept.size === 0 ? "; the package's tables are used" : "";
  if (aborted) said.push(`not reached in ${CHECK_ON_OPEN_MS / 1000} s${used}`);
  else if (feedLost) said.push(`not reached${used}`);
  else if (downloadLost)
    said.push("a newer version could not be read now; tried again next start");
  else if (kept.size === 0) said.push("none newer");
  if (refused > 0) said.push(`${refused} refused`);
  return said.join(", ");
}
