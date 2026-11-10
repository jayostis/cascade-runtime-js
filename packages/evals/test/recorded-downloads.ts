import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The download a recorded citation names: its source and the day it was pulled. */
export const PULL = {
  source: "Cascade North Demo Hospital",
  retrievedAt: "2026-10-15T00:00:00Z",
};

/** Three pulls of one hospital under `at`, each a copy of cascade-runtime's citations bundle with its `pull.json`. */
export async function downloads(at: string): Promise<string> {
  for (const name of ["north-2024-02", "north-2025-02", "north-2026-10"]) {
    await mkdir(join(at, name), { recursive: true });
    await copyFile(
      fileURLToPath(
        new URL(
          "../../../cascade-runtime/test/fixtures/citations/bundle.json",
          import.meta.url,
        ),
      ),
      join(at, name, "bundle.json"),
    );
    await writeFile(join(at, name, "pull.json"), JSON.stringify(PULL));
  }
  return at;
}
