import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findBridgePackage } from "../src/node/wasm.js";

async function sibling(siblings: string, sources: string): Promise<string> {
  const checkout = join(siblings, "cascade-bridge-rs");
  const dist = join(checkout, "package", "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(checkout, "package", "sources.mjs"),
    `process.stdout.write(${JSON.stringify(sources)});\n`,
  );
  await writeFile(join(dist, "cascade_bridge_bg.wasm"), new Uint8Array());
  await writeFile(
    join(dist, "package.json"),
    JSON.stringify({
      cascadeBridge: {
        commit: "c".repeat(40),
        dirty: true,
        sources: "sha256-built",
      },
    }),
  );
  return dist;
}

test("a sibling's build is used only when made from the checkout as it is; otherwise the pin, and the run says why", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-package-"));
  const found = async (siblings: string) => {
    const lines: string[] = [];
    const used = await findBridgePackage([siblings], (line) =>
      lines.push(line),
    );
    return { ...used, said: lines.join("\n") };
  };

  const none = await found(join(root, "none"));
  assert.equal(none.source, "pin");
  assert.match(none.said, /^cascade-bridge-rs: the pin, [0-9a-f]{12}$/);

  const built = await sibling(join(root, "fresh"), "sha256-built");
  const used = await found(join(root, "fresh"));
  assert.deepEqual(
    [used.source, used.folder, used.commit],
    ["sibling", built, "c".repeat(40)],
  );
  assert.match(
    used.said,
    /the sibling checkout's build .* with uncommitted changes$/,
  );

  await sibling(join(root, "stale"), "sha256-edited");
  const stale = await found(join(root, "stale"));
  assert.equal(stale.source, "pin");
  assert.match(stale.said, /is stale/);
});
