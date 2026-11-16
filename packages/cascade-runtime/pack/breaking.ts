/** What `breakingOf` found in a pull request's body: the lines of its `## Breaking` section, or what is wrong with it. */
export interface BreakingSection {
  readonly lines: readonly string[];
  readonly problem?: string;
}

const HEADING = /^##[ \t]+Breaking[ \t]*$/;
const ANY_HEADING = /^#{1,6}[ \t]/;
const NONE = /^none\.?$/i;
const ARROW = "->";

/**
 * The `## Breaking` section of a pull request's body: one `old -> new` or `old -> removed` line for each rename or removal
 * a caller sees, or `None`. Comments are not read. A body with no section, an empty one, a line that is not an arrow and
 * `None` beside lines each come back with a `problem` saying so; `None` alone is no lines and no problem.
 */
export function breakingOf(body: string | null | undefined): BreakingSection {
  const rows = (body ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const start = rows.findIndex((row) => HEADING.test(row));
  if (start === -1)
    return { lines: [], problem: "the body has no `## Breaking` section" };
  const rest = rows.slice(start + 1);
  const end = rest.findIndex((row) => ANY_HEADING.test(row));
  const lines = (end === -1 ? rest : rest.slice(0, end))
    .map((row) =>
      row
        .trim()
        .replace(/^[-*+][ \t]+/, "")
        .trim(),
    )
    .filter((row) => row !== "" && row !== "-" && row !== "*" && row !== "+");
  if (lines.length === 0)
    return {
      lines: [],
      problem:
        "the `## Breaking` section is empty: list each `old -> new` or `old -> removed`, or write None",
    };
  const none = lines.filter((line) => NONE.test(line)).length;
  if (none > 0 && lines.length === none) return { lines: [] };
  if (none > 0)
    return {
      lines: [],
      problem: "the `## Breaking` section has None beside lines",
    };
  const loose = lines.find((line) => !line.includes(ARROW));
  if (loose !== undefined)
    return {
      lines: [],
      problem: `"${loose}" is not \`old -> new\` or \`old -> removed\``,
    };
  return { lines };
}

/** The pull requests the merge commits among `subjects` (commit titles, oldest first) merged, each once. */
export function mergedPullRequests(subjects: readonly string[]): number[] {
  const found: number[] = [];
  for (const subject of subjects) {
    const number = /^Merge pull request #(\d+) /.exec(subject)?.[1];
    if (number !== undefined && !found.includes(Number(number)))
      found.push(Number(number));
  }
  return found;
}

/**
 * The top of a build's release notes: each line of each pull request's `## Breaking` section, naming its pull request, or
 * "Breaking changes: none". A body with no readable section (one merged before the check) adds nothing.
 */
export function breakingNotes(
  entries: readonly { readonly pr: number; readonly body: string | null }[],
): string {
  const lines = entries.flatMap(({ pr, body }) =>
    breakingOf(body).lines.map((line) => `- ${line} (#${pr})`),
  );
  return lines.length === 0
    ? "Breaking changes: none\n"
    : `## Breaking changes\n\n${lines.join("\n")}\n`;
}

const PAGE = 100;
const RELEASES = 30;

/**
 * The breaking-changes notes of the build of `sha`, from the pull requests merged since the newest build before it.
 * `get` answers a path of GitHub's API; one it refuses throws, so a build never leaves a line out unseen. A repository with
 * no earlier build has nothing to compare with and says none. A build made while another's release is still unmade also
 * lists that build's pull requests: more, never fewer.
 */
export async function breakingSince(
  repository: string,
  sha: string,
  get: (path: string) => Promise<unknown>,
): Promise<string> {
  const releases = (await get(
    `/repos/${repository}/releases?per_page=${RELEASES}`,
  )) as { tag_name: string }[];
  const previous = releases
    .map((release) => release.tag_name)
    .find((tag) => tag.startsWith("build-") && tag !== `build-${sha}`);
  if (previous === undefined) return breakingNotes([]);
  const subjects: string[] = [];
  for (let page = 1; ; page += 1) {
    const { commits } = (await get(
      `/repos/${repository}/compare/${previous}...${sha}?per_page=${PAGE}&page=${page}`,
    )) as { commits: { commit: { message: string } }[] };
    subjects.push(
      ...commits.map(({ commit }) => commit.message.split("\n")[0] ?? ""),
    );
    if (commits.length < PAGE) break;
  }
  const entries = [];
  for (const pr of mergedPullRequests(subjects)) {
    const { body } = (await get(`/repos/${repository}/pulls/${pr}`)) as {
      body: string | null;
    };
    entries.push({ pr, body });
  }
  return breakingNotes(entries);
}
