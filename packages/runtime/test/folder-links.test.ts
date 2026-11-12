import assert from "node:assert/strict";
import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it, type TestContext } from "node:test";
import { FolderFiles } from "../src/node/folder-files.js";
import { Refusal } from "../src/step.js";

const text = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);
const bytes = (value: string) => new TextEncoder().encode(value);

const made: string[] = [];

/** A folder with a pod in `pod/`, holding `subject/real.txt`, and beside it `outside/`, holding `secret.txt` and `other.txt`. */
async function world() {
  const base = await mkdtemp(join(tmpdir(), "links-"));
  made.push(base);
  const pod = join(base, "pod");
  const outside = join(base, "outside");
  await mkdir(join(pod, "subject"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(pod, "subject", "real.txt"), "real");
  await writeFile(join(outside, "secret.txt"), "outside secret");
  await writeFile(join(outside, "other.txt"), "other");
  return { base, pod, outside };
}

/** Every file under the folder with what it holds, so that a change anywhere in it shows. */
async function held(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of (await readdir(folder, { recursive: true })).sort())
    found.push(
      `${name}=${(await lstat(join(folder, name))).isFile() ? await readFile(join(folder, name), "utf8") : "folder"}`,
    );
  return found;
}

interface Kind {
  readonly name: string;
  /** What is planted in the pod at `subject/<name>`. */
  readonly type: "file" | "dir" | "junction";
  /** The path of an existing file of the pod's through the link, and the path of a new one. */
  readonly through: (name: string) => { existing: string; fresh: string };
}

const KINDS: readonly Kind[] = [
  {
    name: "link.txt",
    type: "file",
    through: (name) => ({
      existing: `subject/${name}`,
      fresh: `subject/${name}`,
    }),
  },
  {
    name: "dirlink",
    type: "dir",
    through: (name) => ({
      existing: `subject/${name}/secret.txt`,
      fresh: `subject/${name}/deeper/new.txt`,
    }),
  },
  {
    name: "junction",
    type: "junction",
    through: (name) => ({
      existing: `subject/${name}/secret.txt`,
      fresh: `subject/${name}/new.txt`,
    }),
  },
];

/** Plants the link of the kind in the pod, aimed outside it; false, with the reason, where the machine does not allow it. */
async function planted(
  kind: Kind,
  where: { pod: string; outside: string },
): Promise<true | string> {
  try {
    await symlink(
      kind.type === "file" ? join(where.outside, "secret.txt") : where.outside,
      join(where.pod, "subject", kind.name),
      kind.type,
    );
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES")
      return `a ${kind.type} symbolic link needs a privilege this machine has not given`;
    throw error;
  }
}

/** Runs the body for each kind of link that can be planted here, and skips, saying why, when none can. */
async function eachKind(
  t: TestContext,
  body: (kind: Kind, where: Awaited<ReturnType<typeof world>>) => Promise<void>,
): Promise<void> {
  const skipped: string[] = [];
  let ran = 0;
  for (const kind of KINDS) {
    const where = await world();
    const reason = await planted(kind, where);
    if (reason !== true) {
      skipped.push(reason);
      continue;
    }
    ran += 1;
    await body(kind, where);
  }
  if (ran === 0) t.skip(skipped.join("; "));
}

const REFUSING = { refuseLinks: true } as const;

/**
 * A folder's files are read and written by a path under it, and none of them reaches outside. A pod's folder refuses a
 * link in any part of a path under it; the folders of the components, tables and caches the runtime reads, which worktrees
 * and workspaces reach through links, follow them.
 */
describe("Reading and writing files by path · Files, MemoryFiles, FolderFiles, ExportedFiles", () => {
  after(async () => {
    await Promise.all(
      made.map((folder) => rm(folder, { recursive: true, force: true })),
    );
  });

  describe("given a folder that refuses links, with a link in the pod to a file or a folder outside it", () => {
    it("throws Refusal for a read, a range and a listing through the link, and reads the files beside it", async (t) => {
      await eachKind(t, async (kind, { pod }) => {
        const files = new FolderFiles(pod, undefined, REFUSING);
        const { existing } = kind.through(kind.name);
        await assert.rejects(files.read(existing), Refusal, kind.name);
        await assert.rejects(
          files.readRange(existing, 0, 4),
          Refusal,
          kind.name,
        );
        if (kind.type !== "file")
          await assert.rejects(files.list(`subject/${kind.name}`), Refusal);
        assert.equal(text(await files.read("subject/real.txt")), "real");
        assert.deepEqual(
          await files.list("subject"),
          ["subject/real.txt"],
          `${kind.name} is listed`,
        );
      });
    });

    it("throws Refusal for a write through the link, and leaves everything outside the pod as it was", async (t) => {
      await eachKind(t, async (kind, { pod, outside }) => {
        const files = new FolderFiles(pod, undefined, REFUSING);
        const before = await held(outside);
        const { existing, fresh } = kind.through(kind.name);
        for (const path of new Set([existing, fresh])) {
          await assert.rejects(
            files.write(path, bytes("HIJACKED")),
            Refusal,
            path,
          );
          await assert.rejects(
            files.writeNew(path, bytes("HIJACKED")),
            Refusal,
            path,
          );
        }
        assert.deepEqual(await held(outside), before, kind.name);
        assert.deepEqual(
          (await readdir(join(pod, "subject"))).sort(),
          ["real.txt", kind.name].sort(),
          "a file was left behind in the pod",
        );
      });
    });

    it("refuses a link to a file inside the pod too", async (t) => {
      const { pod } = await world();
      try {
        await symlink(
          join(pod, "subject", "real.txt"),
          join(pod, "subject", "inside.txt"),
          "file",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM")
          return t.skip("a file symbolic link needs a privilege");
        throw error;
      }
      await assert.rejects(
        new FolderFiles(pod, undefined, REFUSING).read("subject/inside.txt"),
        Refusal,
      );
    });
  });

  describe("given a folder that refuses links, with the pod behind a link and hard links in it", () => {
    it("reads, writes and lists as it does without the link, and reads a hard link", async (t) => {
      const { base, pod } = await world();
      const behind = join(base, "behind");
      try {
        await symlink(pod, behind, "junction");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM")
          return t.skip("a junction needs a privilege");
        throw error;
      }
      await link(
        join(pod, "subject", "real.txt"),
        join(pod, "subject", "hard.txt"),
      );
      const files = new FolderFiles(behind, undefined, REFUSING);
      assert.equal(text(await files.read("subject/hard.txt")), "real");
      await files.write("subject/deeper/new.txt", bytes("new"));
      assert.equal(await files.writeNew("subject/hard.txt", bytes("x")), false);
      assert.equal(
        await files.writeNew("subject/claimed.txt", bytes("c")),
        true,
      );
      assert.deepEqual(await files.list(""), [
        "subject/claimed.txt",
        "subject/deeper/new.txt",
        "subject/hard.txt",
        "subject/real.txt",
      ]);
      assert.equal(
        await readFile(join(pod, "subject", "deeper", "new.txt"), "utf8"),
        "new",
      );
    });

    it("returns undefined for a file that is not there, and for a path below a file", async () => {
      const { pod } = await world();
      const files = new FolderFiles(join(pod, "none"), undefined, REFUSING);
      assert.equal(await files.read("subject/real.txt"), undefined);
      const here = new FolderFiles(pod, undefined, REFUSING);
      assert.equal(await here.read("subject/none.txt"), undefined);
      assert.equal(await here.read("subject/real.txt/below"), undefined);
      assert.equal(await here.read("none/deeper/file.txt"), undefined);
      assert.deepEqual(await files.list(""), []);
    });
  });

  describe("given a folder that refuses no link", () => {
    it("reads through a link to a file or to a folder, as it did", async (t) => {
      await eachKind(t, async (kind, { pod }) => {
        const files = new FolderFiles(pod);
        assert.equal(
          text(await files.read(kind.through(kind.name).existing)),
          "outside secret",
          kind.name,
        );
      });
    });
  });

  describe("given a folder that refuses links, and the calls it makes to look at a path", () => {
    async function pod() {
      const { pod: folder } = await world();
      const plain = new FolderFiles(folder);
      for (const path of ["a/b/one.txt", "a/b/two.txt", "a/c/three.txt"])
        await plain.write(path, bytes(path));
      return folder;
    }

    function counting() {
      const calls = { lstat: [] as string[], realpath: 0 };
      const fs = {
        lstat: (path: string) => {
          calls.lstat.push(path);
          return lstat(path);
        },
        realpath: (path: string) => {
          calls.realpath += 1;
          return import("node:fs/promises").then((fs) => fs.realpath(path));
        },
      };
      return { calls, fs };
    }

    it("calls lstat once for each folder of a pod however often its files are read, and for no file where the platform opens none through a link", async () => {
      const folder = await pod();
      const { calls, fs } = counting();
      const files = new FolderFiles(folder, undefined, { ...REFUSING, fs });
      const paths = ["a/b/one.txt", "a/b/two.txt", "a/c/three.txt"];
      for (const path of paths) await files.read(path);
      await Promise.all(paths.map((path) => files.read(path)));
      for (const path of paths) await files.readRange(path, 0, 1);
      const folders = calls.lstat.filter((path) => !path.endsWith(".txt"));
      assert.equal(new Set(folders).size, 3, folders.join(", "));
      assert.equal(
        folders.length,
        3,
        `a folder was looked at twice: ${folders}`,
      );
      if (constants.O_NOFOLLOW !== undefined)
        assert.equal(calls.lstat.length, 3, "a file was looked at by lstat");
      assert.equal(calls.realpath, 1);
    });

    it("calls lstat for no folder that a listing found, and reads each of the listed files", async () => {
      const folder = await pod();
      const { calls, fs } = counting();
      const files = new FolderFiles(folder, undefined, { ...REFUSING, fs });
      for (const path of await files.list("")) await files.read(path);
      assert.deepEqual(
        calls.lstat.filter((path) => !path.endsWith(".txt")),
        [],
      );
    });
  });

  describe("given a folder that refuses links, on a platform that cannot open a file without following a link", () => {
    it("throws Refusal for a read of a link to a file, by what lstat says of the file", async (t) => {
      const where = await world();
      const reason = await planted(KINDS[0] as Kind, where);
      if (reason !== true) return t.skip(reason);
      const files = new FolderFiles(where.pod, undefined, {
        ...REFUSING,
        fs: { noFollow: undefined },
      });
      await assert.rejects(files.read("subject/link.txt"), Refusal);
      await assert.rejects(
        files.write("subject/link.txt", bytes("x")),
        Refusal,
      );
      assert.equal(text(await files.read("subject/real.txt")), "real");
    });

    it("throws Refusal for a file that lstat says is a link, which a machine that makes no file link cannot show", async () => {
      const { pod } = await world();
      const files = new FolderFiles(pod, undefined, {
        ...REFUSING,
        fs: {
          noFollow: undefined,
          lstat: async (path) => {
            const stat = await lstat(path);
            return path.endsWith("real.txt")
              ? ({ ...stat, isSymbolicLink: () => true } as Stats)
              : stat;
          },
        },
      });
      await assert.rejects(files.read("subject/real.txt"), Refusal);
      assert.equal(await files.read("subject/none.txt"), undefined);
    });
  });
});
