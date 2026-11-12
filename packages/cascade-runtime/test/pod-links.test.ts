import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Refusal } from "@cascade-runtime/runtime";
import { answersBeside, resolved } from "../src/node/resolved.js";

let base: string;
let pod: string;
let outside: string;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "pod-links-"));
  pod = join(base, "pod");
  outside = join(base, "outside");
  await mkdir(join(pod, "subject"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "outside secret");
});

after(() => rm(base, { recursive: true, force: true }));

const bytes = (value: string) => new TextEncoder().encode(value);

describe("Opening a pod · openPod()", () => {
  describe("given a link in a pod's folder, or in the folder of its answers, to a folder outside it", () => {
    it("throws Refusal for a read and a write through the link, and writes nothing outside", async () => {
      await symlink(outside, join(pod, "subject", "linked"), "junction");
      const answers = join(base, ".answers", "pod");
      await mkdir(answers, { recursive: true });
      await symlink(outside, join(answers, "linked"), "junction");
      const kept = answersBeside(pod);
      const opened = (await resolved()).folder(pod).files;
      for (const [what, files, path] of [
        ["the pod", opened, "subject/linked"],
        ["its answers", kept, "linked"],
      ] as const) {
        await assert.rejects(files.read(`${path}/secret.txt`), Refusal, what);
        await assert.rejects(
          files.write(`${path}/new.txt`, bytes("HIJACKED")),
          Refusal,
          what,
        );
      }
      assert.deepEqual((await readdir(outside)).sort(), ["secret.txt"]);
    });
  });
});
