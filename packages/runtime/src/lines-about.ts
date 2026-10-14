/**
 * The lines of a subject in a version's N-Triples, found by halving: the lines are sorted, so a subject's are together.
 */
export function linesAbout(text: string, subject: string): string[] {
  const prefix = `<${subject}> `;
  let [low, high] = [0, text.length];
  while (low < high) {
    const start = text.lastIndexOf("\n", ((low + high) >> 1) - 1) + 1;
    if (text.slice(start, start + prefix.length) < prefix) {
      const end = text.indexOf("\n", start);
      low = end < 0 ? text.length : end + 1;
    } else high = start;
  }
  const lines: string[] = [];
  for (let at = low; text.startsWith(prefix, at);) {
    const end = text.indexOf("\n", at);
    lines.push(text.slice(at, end < 0 ? text.length : end));
    at = end < 0 ? text.length : end + 1;
  }
  return lines;
}
