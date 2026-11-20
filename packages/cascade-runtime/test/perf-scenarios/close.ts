import { type Context } from "../perf-context.js";
import { type Measured, nameOf, samplesOf } from "../perf-job.js";
import {
  clockRow,
  probedRows,
  type Row,
  type Tabulated,
} from "../perf-rows.js";

/**
 * Closing a pod right after its import and first screen. Measured in the fresh scenario's child process, as the last
 * step of it (perf-scenarios/fresh-first-screen.ts), so these rows are read from the fresh runs.
 */
export function closeRows(ctx: Context, fresh: readonly Measured[]): Row[] {
  return [
    clockRow(
      `${nameOf("close", ctx.dataset, ctx.encrypted)}/total`,
      "s",
      samplesOf(fresh, (each) => each.seconds.close),
      `closing a pod right after its import and first screen; ${ctx.how}`,
    ),
  ];
}

/** The rows of the probed close: its total and its stages. */
export function closeProbedRows(
  ctx: Context,
  probed: Measured,
  seen: Tabulated,
  note: string,
): Row[] {
  const name = nameOf("close", ctx.dataset, ctx.encrypted);
  return [
    clockRow(`${name}/probed-total`, "s", [probed.seconds.close ?? 0], note),
    ...probedRows(name, seen),
  ];
}
