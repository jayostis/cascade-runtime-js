import type { execFile } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

/**
 * With `CASCADE_TEST_OFFLINE=1`, a git call that names a URL fails at once, saying so (see offline.ts). It is a module of
 * its own, imported first, so that it is in place before the runtime's `git()` takes hold of `execFile`.
 */
const url = /^(?:[a-z][a-z0-9+.-]*:\/\/|[\w.-]+@[\w.-]+:)/i;
const isGit = (file: unknown): boolean =>
  typeof file === "string" && /(?:^|[\\/])git(?:\.exe)?$/i.test(file);
if (process.env.CASCADE_TEST_OFFLINE === "1") {
  const childProcess = createRequire(import.meta.url)("node:child_process") as {
    execFile: typeof execFile;
  };
  const real = childProcess.execFile;
  const refuse = (file: unknown, args: unknown): void => {
    if (!isGit(file) || !Array.isArray(args)) return;
    const named = args.find(
      (arg): arg is string =>
        typeof arg === "string" && url.test(arg) && !arg.startsWith("file:"),
    );
    if (named !== undefined)
      throw new Error(
        `a test ran git on ${named}: tests run offline (packages/cascade-runtime/test/offline.ts). Use a path or a file:// URL, or leave CASCADE_TEST_OFFLINE unset`,
      );
  };
  const guarded = Object.assign(
    function (this: unknown, file: unknown, args: unknown, ...rest: unknown[]) {
      refuse(file, args);
      return (real as (...all: unknown[]) => unknown).call(
        this,
        file,
        args,
        ...rest,
      );
    },
    {
      [promisify.custom]: async (
        file: unknown,
        args: unknown,
        ...rest: unknown[]
      ) => {
        refuse(file, args);
        return (promisify(real) as (...all: unknown[]) => unknown)(
          file,
          args,
          ...rest,
        );
      },
    },
  );
  childProcess.execFile = guarded as unknown as typeof execFile;
  syncBuiltinESMExports();
}
