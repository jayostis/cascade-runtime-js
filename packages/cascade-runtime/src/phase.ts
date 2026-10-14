/**
 * One step of an app's setup, timed on its own: the line is written, the work awaited, then the outcome, if the work
 * has one to say, and the seconds it took. The work's failure is passed on, after the line is ended.
 */
export type Phase = <T>(
  line: string,
  work: () => Promise<T>,
  outcome?: (result: T) => string | Promise<string>,
) => Promise<T>;

/** The seconds between two `performance.now()` readings, as a person reads them. */
export function seconds(started: number): string {
  return `${((performance.now() - started) / 1000).toFixed(1)} s`;
}

/** A `Phase` that writes to `out`, a blank line before each, so the setup reads as steps beside the pods' own. */
export function phaseOn(out: (text: string) => void): Phase {
  return async (line, work, outcome) => {
    out(`\n${line}`);
    const started = performance.now();
    let result;
    try {
      result = await work();
    } catch (error) {
      out("\n");
      throw error;
    }
    const said = outcome === undefined ? undefined : await outcome(result);
    out(
      ` ${said === undefined || said === "" ? "" : `${said}, `}${seconds(started)}\n`,
    );
    return result;
  };
}
