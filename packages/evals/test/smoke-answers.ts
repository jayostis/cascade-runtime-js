import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Reply } from "cascade-runtime";

/** A reply a model once wrote in a smoke run, recorded in `test/fixtures/smoke-answers/<name>.json`. */
export const smoke = (name: string): Reply =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../test/fixtures/smoke-answers/${name}.json`,
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as Reply;
