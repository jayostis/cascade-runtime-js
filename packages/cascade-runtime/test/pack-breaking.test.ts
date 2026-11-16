import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  breakingNotes,
  breakingOf,
  breakingSince,
  mergedPullRequests,
} from "../pack/breaking.js";

const BOM = String.fromCharCode(0xfeff);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x85);
const NBSP = String.fromCharCode(0xa0);
const FULL_WIDTH_ONE = String.fromCharCode(0xff11);

const CHECK = fileURLToPath(
  new URL("../../../../scripts/breaking-check.mjs", import.meta.url),
);

const body = (section: string) =>
  `Closes #1\n\n## Breaking\n${section}\n\n## Tests\nran\n`;

/** GitHub as `breakingSince` reads it: an answer for each path, and a refusal for any other. */
const github =
  (answers: Record<string, unknown>) =>
  async (path: string): Promise<unknown> => {
    if (!(path in answers)) throw new Error(`GitHub refused ${path}`);
    return answers[path];
  };

/**
 * The `## Breaking` lines of each pull request, which the build notes of a release open with, and the check that a pull
 * request has them.
 */
describe("Breaking changes in a build's notes · breakingOf(), mergedPullRequests(), breakingNotes(), breakingSince()", () => {
  describe("breakingOf(body)", () => {
    it("returns the lines of the section, each without its bullet", () => {
      assert.deepEqual(
        breakingOf(
          body(
            "- `aboutSubject` -> `claim`\n* `look` -> removed\n\n`claimed` -> `claimedProfiles`",
          ),
        ),
        {
          lines: [
            "`aboutSubject` -> `claim`",
            "`look` -> removed",
            "`claimed` -> `claimedProfiles`",
          ],
        },
      );
    });

    it("returns no lines and no problem for None", () => {
      assert.deepEqual(breakingOf(body("None")), { lines: [] });
      assert.deepEqual(breakingOf(body("<!-- say which -->\nnone.\n")), {
        lines: [],
      });
    });

    it("reads a body written with Windows line ends", () => {
      assert.deepEqual(breakingOf(body("- a -> b").replaceAll("\n", "\r\n")), {
        lines: ["a -> b"],
      });
    });

    it("reads a body written with lone carriage returns, a byte order mark and U+2028 or U+2029 line ends", () => {
      assert.deepEqual(breakingOf(`${BOM}## Breaking\r- a -> b\r- c -> d`), {
        lines: ["a -> b", "c -> d"],
      });
      assert.deepEqual(breakingOf(`## Breaking${LS}- a -> b${PS}- c -> d`), {
        lines: ["a -> b", "c -> d"],
      });
      assert.deepEqual(breakingOf(`## Breaking${LS}None${PS}## Tests`), {
        lines: [],
      });
    });

    it("strips a number from a numbered item as it does a bullet", () => {
      assert.deepEqual(breakingOf(body("1. a -> b\n2. c -> removed")), {
        lines: ["a -> b", "c -> removed"],
      });
    });

    it("stops the section at the next heading", () => {
      assert.deepEqual(
        breakingOf("## Breaking\n- a -> b\n### Why\n- not a -> line\n"),
        { lines: ["a -> b"] },
      );
    });

    it("stops the section at a --- rule or a Depends-On line, so a footer is not read as a line", () => {
      assert.deepEqual(
        breakingOf("## Breaking\n- a -> b\n\n---\nGenerated with a tool\n"),
        { lines: ["a -> b"] },
      );
      assert.deepEqual(
        breakingOf(
          "## Breaking\nNone\nDepends-On: https://github.com/o/r/pull/1\n",
        ),
        { lines: [] },
      );
      assert.deepEqual(
        breakingOf(
          "## Breaking\n- a -> b\ndepends-on: https://github.com/o/r/pull/1",
        ),
        { lines: ["a -> b"] },
      );
    });

    it("reads a next line end, a full-width digit and an arrow beside one as text, as the Python readers do", () => {
      assert.deepEqual(breakingOf(body(`a ->${NEL}\n${NEL}-> b`)), {
        lines: [`a ->${NEL}`, `${NEL}-> b`],
      });
      assert.deepEqual(breakingOf(body(`${FULL_WIDTH_ONE}. a -> b`)), {
        lines: [`${FULL_WIDTH_ONE}. a -> b`],
      });
    });

    it("reports a problem, naming what is wrong, for each body the check must refuse", () => {
      const refused: [string | null, RegExp][] = [
        [null, /no `## Breaking` section/],
        ["", /no `## Breaking` section/],
        ["## Tests\nran\n", /no `## Breaking` section/],
        ["<!-- ## Breaking\nNone -->", /no `## Breaking` section/],
        [body(""), /empty/],
        [body("<!-- old -> new, or None -->"), /empty/],
        [body("- \n  \n"), /empty/],
        [body("it renames a thing"), /"it renames a thing" is not/],
        [body("None\n- a -> b"), /None beside lines/],
        [body("Nothing"), /"Nothing" is not/],
        [body("->"), /"->" is not/],
        [body("- ->"), /"->" is not/],
        [body("a ->"), /"a ->" is not/],
        [body("-> b"), /"-> b" is not/],
        [body(`a ->${NBSP}`), /is not/],
        [body(`None${NEL}`), /is not/],
        [body(`${FULL_WIDTH_ONE}. None`), /is not/],
      ];
      for (const [text, problem] of refused)
        assert.match(breakingOf(text).problem ?? "", problem, String(text));
    });
  });

  describe("mergedPullRequests(subjects)", () => {
    it("returns the numbers of the merge commits and of the squash or rebase merges, oldest first, each once", () => {
      assert.deepEqual(
        mergedPullRequests([
          "Merge pull request #12 from jayostis/feat/a",
          "Merge branch 'main' into feat/a",
          "feat(runtime): a squash that mentions #13 in passing",
          "feat(runtime): a squash merge (#14)",
          "Merge pull request #9 from someone/fix/b",
          "Merge pull request #12 from jayostis/feat/a",
          "fix(runtime): a rebase merge (#14) ",
        ]),
        [12, 14, 9],
      );
    });
  });

  describe("breakingNotes(entries)", () => {
    it("opens with a heading and names the pull request of each line", () => {
      assert.equal(
        breakingNotes([
          { pr: 12, body: body("- a -> b\n- c -> removed") },
          { pr: 14, body: body("None") },
          { pr: 15, body: body("- d -> e") },
        ]),
        "## Breaking changes\n\n- a -> b (#12)\n- c -> removed (#12)\n- d -> e (#15)\n",
      );
    });

    it("names the repository of a pull request that is not the runtime's, and a line said twice once", () => {
      assert.equal(
        breakingNotes([
          { pr: 12, body: body("- a -> b") },
          {
            pr: 409,
            body: body("- a -> b\n- c -> d"),
            repository: "cascade-vocabulary",
          },
        ]),
        "## Breaking changes\n\n- a -> b (#12)\n- c -> d (cascade-vocabulary#409)\n",
      );
    });

    it("keeps a pull request whose section is unreadable as a line saying why, and drops one with no section", () => {
      assert.equal(
        breakingNotes([
          { pr: 12, body: body("- a -> b\nit renames a thing") },
          { pr: 13, body: "## Tests\nran" },
          { pr: 14, body: body(""), repository: "cascade-vocabulary" },
          { pr: 15, body: body("- c -> d") },
        ]),
        '## Breaking changes\n\n- #12: Breaking section unreadable ("it renames a thing" is not `old -> new` or `old -> removed`)\n' +
          "- cascade-vocabulary#14: Breaking section unreadable (the `## Breaking` section is empty: list each `old -> new` or `old -> removed`, or write None)\n" +
          "- c -> d (#15)\n",
      );
    });

    it("says Breaking changes: none when no pull request lists a line", () => {
      assert.equal(breakingNotes([]), "Breaking changes: none\n");
      assert.equal(
        breakingNotes([
          { pr: 1, body: body("None") },
          { pr: 2, body: null },
          { pr: 3, body: "## Tests\nran" },
        ]),
        "Breaking changes: none\n",
      );
    });
  });

  describe("breakingSince(repository, sha, get)", () => {
    const RELEASES = "/repos/o/r/releases?per_page=100&page=1";
    const COMPARE = "/repos/o/r/compare/build-prev...new?per_page=100&page=1";
    const pull = (text: string) => ({ body: text, pull_request: {} });
    /** The releases in the order GitHub lists them, which is not the order they were made in. */
    const answers = {
      [RELEASES]: [
        { tag_name: "build-older", created_at: "2026-11-01T00:00:00Z" },
        { tag_name: "build-new", created_at: "2026-11-04T00:00:00Z" },
        { tag_name: "v1", created_at: "2026-11-03T00:00:00Z" },
        { tag_name: "build-prev", created_at: "2026-11-03T00:00:00Z" },
      ],
      [COMPARE]: {
        commits: [
          { commit: { message: "Merge pull request #5 from o/a\n\nfeat" } },
          { commit: { message: "Merge branch 'main' into a" } },
          { commit: { message: "Merge pull request #6 from o/b" } },
          { commit: { message: "fix: a squash merge (#7)" } },
          { commit: { message: "fix: a commit that names an issue (#8)" } },
        ],
      },
      "/repos/o/r/issues/5": pull(body("- a -> b")),
      "/repos/o/r/issues/6": pull(body("None")),
      "/repos/o/r/issues/7": pull(body("- c -> d")),
      "/repos/o/r/issues/8": { body: body("- not -> a pull request") },
    };

    it("collects the lines of every pull request merged since the newest build before this one, however GitHub orders its releases", async () => {
      assert.equal(
        await breakingSince("o/r", "new", github(answers)),
        "## Breaking changes\n\n- a -> b (#5)\n- c -> d (#7)\n",
      );
    });

    it("compares with the newest build made before this one by its creation time, not the first in the list", async () => {
      const asked: string[] = [];
      await breakingSince("o/r", "new", async (path) => {
        asked.push(path);
        return github(answers)(path);
      });
      assert.ok(asked.includes(COMPARE), asked.join("\n"));
      assert.ok(!asked.some((path) => path.includes("build-older...")));
    });

    it("reads every page of releases", async () => {
      const filler = Array.from({ length: 100 }, (_, index) => ({
        tag_name: `v${index}`,
        created_at: "2026-10-01T00:00:00Z",
      }));
      assert.equal(
        await breakingSince(
          "o/r",
          "new",
          github({
            ...answers,
            [RELEASES]: filler,
            "/repos/o/r/releases?per_page=100&page=2": answers[RELEASES],
          }),
        ),
        "## Breaking changes\n\n- a -> b (#5)\n- c -> d (#7)\n",
      );
    });

    it("collects the lines of the pull requests merged in each component since the commit the build before carried", async () => {
      const carried = (vocabulary: string, adapter: string) =>
        "| cascade-vocabulary | <https://github.com/o/v/tree/" +
        vocabulary +
        "/> | `" +
        vocabulary +
        "` |\n| adapter | <https://github.com/o/a/tree/" +
        adapter +
        "/> | `" +
        adapter +
        "` |\n";
      const releases = [
        {
          tag_name: "build-prev",
          created_at: "2026-11-03T00:00:00Z",
          body: carried("aaa1", "bbb1"),
        },
      ];
      const components = [
        { repository: "https://github.com/o/v", commit: "aaa2" },
        { repository: "https://github.com/o/a", commit: "bbb1" },
        { repository: "https://github.com/o/new", commit: "ccc1" },
      ];
      assert.equal(
        await breakingSince(
          "o/r",
          "new",
          github({
            [RELEASES]: releases,
            [COMPARE]: { commits: [] },
            "/repos/o/v/compare/aaa1...aaa2?per_page=100&page=1": {
              commits: [
                { commit: { message: "Merge pull request #409 from o/x" } },
              ],
            },
            "/repos/o/v/issues/409": pull(body("- a -> b")),
          }),
          components,
        ),
        "## Breaking changes\n\n- a -> b (v#409)\n",
      );
    });

    it("reads every page of a long history", async () => {
      const full = Array.from({ length: 100 }, () => ({
        commit: { message: "a commit" },
      }));
      assert.equal(
        await breakingSince(
          "o/r",
          "new",
          github({
            ...answers,
            [COMPARE]: { commits: full },
            [COMPARE.replace("&page=1", "&page=2")]: answers[COMPARE],
          }),
        ),
        "## Breaking changes\n\n- a -> b (#5)\n- c -> d (#7)\n",
      );
    });

    it("compares with the newest build that is an ancestor of this one, so a re-run of an older main run never says none wrongly", async () => {
      const ahead = (tag: string) =>
        `/repos/o/r/compare/${tag}...old?per_page=100&page=1`;
      const asked: string[] = [];
      const notes = await breakingSince("o/r", "old", async (path) => {
        asked.push(path);
        return github({
          ...answers,
          [RELEASES]: [
            { tag_name: "build-older", created_at: "2026-11-01T00:00:00Z" },
            { tag_name: "build-prev", created_at: "2026-11-03T00:00:00Z" },
            { tag_name: "build-old", created_at: "2026-11-02T00:00:00Z" },
          ],
          [ahead("build-prev")]: { status: "behind", commits: [] },
          [ahead("build-older")]: {
            status: "ahead",
            commits: [
              { commit: { message: "Merge pull request #5 from o/a" } },
            ],
          },
        })(path);
      });
      assert.equal(notes, "## Breaking changes\n\n- a -> b (#5)\n");
      assert.ok(!asked.some((path) => path.includes("issues/6")));
    });

    it("says none when every earlier build is ahead of this one", async () => {
      assert.equal(
        await breakingSince(
          "o/r",
          "old",
          github({
            [RELEASES]: [
              { tag_name: "build-prev", created_at: "2026-11-03T00:00:00Z" },
              { tag_name: "build-old", created_at: "2026-11-02T00:00:00Z" },
            ],
            "/repos/o/r/compare/build-prev...old?per_page=100&page=1": {
              status: "behind",
              commits: [],
            },
          }),
        ),
        "Breaking changes: none\n",
      );
    });

    it("says none when the repository has no build before this one", async () => {
      assert.equal(
        await breakingSince(
          "o/r",
          "new",
          github({
            [RELEASES]: [
              { tag_name: "build-new", created_at: "2026-11-04T00:00:00Z" },
            ],
          }),
        ),
        "Breaking changes: none\n",
      );
    });

    it("throws when GitHub refuses a pull request, so a build never omits a line unseen", async () => {
      const without: Record<string, unknown> = { ...answers };
      delete without["/repos/o/r/issues/6"];
      await assert.rejects(
        breakingSince("o/r", "new", github(without)),
        /GitHub refused \/repos\/o\/r\/issues\/6/,
      );
    });
  });

  describe("when the pull request's body is checked by scripts/breaking-check.mjs", () => {
    const checked = async (pullRequestBody: string | null) => {
      const event = join(await mkdtemp(join(tmpdir(), "cr-")), "event.json");
      await writeFile(
        event,
        JSON.stringify({ pull_request: { body: pullRequestBody } }),
      );
      return spawnSync(process.execPath, [CHECK], {
        env: { ...process.env, GITHUB_EVENT_PATH: event },
        encoding: "utf8",
      });
    };

    it("exits 0 for a body that lists lines or says None", async () => {
      assert.equal((await checked(body("- a -> b"))).status, 0);
      assert.equal((await checked(body("None"))).status, 0);
    });

    it("exits 1, saying what is wrong, for a body with no section or an empty one", async () => {
      const missing = await checked("## Tests\nran");
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /no `## Breaking` section/);
      const empty = await checked(body(""));
      assert.equal(empty.status, 1);
      assert.match(empty.stderr, /empty/);
      assert.equal((await checked(null)).status, 1);
    });
  });
});
