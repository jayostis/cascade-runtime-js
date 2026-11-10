// A node:test reporter that writes one `::error::` line per failing test, beside the spec reporter, so a red run's
// annotation names the test and why, not only "Process completed with exit code 1".
interface TestEvent {
  type: string;
  data: {
    name?: string;
    details?: { error?: { message?: string; failureType?: string } };
  };
}

/** GitHub's workflow-command escapes for a message. */
function escape(text: string): string {
  return text
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/** The first line of an error's message, and the next non-empty one when the first ends in a colon: an assertion's says what it compared there. */
function firstLine(message: string): string {
  const lines = message.split(/\r\n|\r|\n/);
  const first = lines.find((line) => line.trim() !== "") ?? "";
  if (!first.endsWith(":")) return first;
  const next = lines
    .slice(lines.indexOf(first) + 1)
    .find((line) => line.trim() !== "");
  return next === undefined ? first : `${first} ${next}`;
}

export default async function* failureAnnotations(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  for await (const { type, data } of source) {
    if (type !== "test:fail") continue;
    const error = data.details?.error;
    if (error?.failureType === "subtestsFailed") continue;
    yield `::error::${escape(`${data.name ?? "a test"}: ${firstLine(error?.message ?? "") || "failed"}`)}\n`;
  }
}
