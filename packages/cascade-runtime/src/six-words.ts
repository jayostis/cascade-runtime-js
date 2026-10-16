import { EFF_LARGE_WORDLIST_LINES } from "./eff-wordlist.js";

const COUNT = 7776;
const HYPHENATED = new Set(["drop-down", "felt-tip", "t-shirt", "yo-yo"]);

/** The dice label of the entry at the index: five digits 1 to 6, the first entry's 11111. */
function diceLabel(index: number): string {
  let label = "";
  let place = COUNT / 6;
  let rest = index;
  for (let k = 0; k < 5; k++) {
    label += String(1 + Math.floor(rest / place));
    rest %= place;
    place /= 6;
  }
  return label;
}

let checked: readonly string[] | undefined;

/** The list's words, checked once: 7,776 distinct entries matching `^[a-z-]+$`, under the dice labels 11111 to 66666. */
function words(): readonly string[] {
  if (checked !== undefined) return checked;
  if (EFF_LARGE_WORDLIST_LINES.length !== COUNT)
    throw new Error(
      `the word list has ${EFF_LARGE_WORDLIST_LINES.length} entries, not ${COUNT}`,
    );
  const read = EFF_LARGE_WORDLIST_LINES.map((line, index) => {
    const [label, word = ""] = line.split("\t");
    if (label !== diceLabel(index) || !/^[a-z-]+$/.test(word))
      throw new Error(`the word list's line ${index + 1} is not as published`);
    return word;
  });
  if (new Set(read).size !== COUNT)
    throw new Error("the word list holds a word twice");
  checked = read;
  return read;
}

/** An index under the bound, uniform: 32-bit draws above the largest multiple of the bound are drawn again. */
function uniform(bound: number): number {
  const zone = 0x100000000 - (0x100000000 % bound);
  for (;;) {
    const [draw = 0] = globalThis.crypto.getRandomValues(new Uint32Array(1));
    if (draw < zone) return draw % bound;
  }
}

/** Six words from the EFF long word list, each drawn uniformly, joined by single spaces: about 77.5 bits. */
export function sixWords(): string {
  const list = words();
  return Array.from({ length: 6 }, () => list[uniform(COUNT)]).join(" ");
}

/**
 * Typed words as the list writes them: lower-cased, split on white space, commas and hyphens, the list's four
 * hyphenated words joined again, and joined by single spaces.
 */
export function typedWords(text: string): string {
  const parts = text
    .toLowerCase()
    .split(/[\s,-]+/)
    .filter((part) => part !== "");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const hyphenated = `${parts[i]}-${parts[i + 1]}`;
    if (HYPHENATED.has(hyphenated)) {
      out.push(hyphenated);
      i++;
    } else out.push(parts[i] ?? "");
  }
  return out.join(" ");
}
