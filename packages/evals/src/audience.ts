/**
 * The hub speaks to builders and adopters of a protocol about a person, never to a patient. This is the website's rule
 * (cascadeprotocol.org, scripts/check-audience.py) on a page's text; the word "patient" is not the rule.
 */
const SUBJECTS =
  String.raw`(?:own\s+)?(?:health(?!\s+(?:app|apps|software|product|products|system|systems|data\s+model)\b)` +
  String.raw`|medical|medications?|medicines?|records?|doctors?|clinicians?|care\s+team|labs?|lab\s+results|` +
  String.raw`heart|blood|symptoms?|conditions?|diagnos[ei]s|prescriptions?|history|story|body|` +
  String.raw`apple\s+watch|healthcare\s+provider)\b`;

const PATIENT_PHRASES: readonly RegExp[] = [
  new RegExp(String.raw`\byour\s+${SUBJECTS}`, "gi"),
  new RegExp(
    String.raw`\byou\s+(?:take\s+(?:a\s+|any\s+|your\s+)?(?:medic\w*|meds|pills?|drugs?|prescriptions?|supplements?)|` +
      String.raw`have\s+(?:a\s+)?(?:condition|diagnosis|symptoms?)|may\s+have\s+(?:a\s+)?(?:condition|disease|syndrome)|` +
      String.raw`suffer|live\s+with)\b`,
    "gi",
  ),
  /\b(?:medic\w*|meds|pills|drugs|prescriptions|supplements)\s+(?:that\s+)?you\s+take\b/gi,
  /\b(?:own|owning|control|manage)\s+your\s+(?:own\s+)?(?:data|health|care|records?)\b/gi,
  /\b(?:we're|we\s+are)\s+here\s+for\s+you\b/gi,
  /\byou\s+asked\b/gi,
  /\bmy\s+doctor\b/gi,
];

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "–",
  mdash: "—",
  hellip: "…",
  middot: "·",
  bull: "•",
  times: "×",
  rarr: "→",
  larr: "←",
  copy: "©",
};

/** Named and numeric character references read as the characters they stand for; the curly apostrophe is read as a straight one. */
function decoded(text: string): string {
  return text
    .replace(
      /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
      (whole, dec, hex, name) => {
        if (name !== undefined) return NAMED[name] ?? whole;
        const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      },
    )
    .replaceAll("’", "'");
}

/** `html` without each element marked `data-recorded`, which holds what a run recorded (an agent's answer, a person's question), through its closing tag; same-name tags inside are counted. */
function withoutRecordedElements(html: string): string {
  const open =
    /<(\w+)\b(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=]+))?)*?\s+data-recorded(?=[\s=>/])[^>]*>/;
  for (let start = open.exec(html); start !== null; start = open.exec(html)) {
    const tag = new RegExp(`<(/?)${start[1]}\\b[^>]*>`, "g");
    tag.lastIndex = start.index + start[0].length;
    let depth = 1;
    let end = html.length;
    for (let m = tag.exec(html); m !== null; m = tag.exec(html)) {
      depth += m[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    html = html.slice(0, start.index) + " " + html.slice(end);
  }
  return html;
}

/**
 * What a reader sees of a page's HTML: the tags, styles and scripts' code left off, entities read, and what a run recorded
 * (an element marked `data-recorded`) left out, being data and not the hub's wording.
 */
export function visibleText(html: string): string {
  return decoded(
    withoutRecordedElements(html)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** Each stretch of `text` that speaks to a patient, with a little of what surrounds it. */
export function speaksToPatient(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  return PATIENT_PHRASES.flatMap((pattern) =>
    [...flat.matchAll(pattern)].map((m) =>
      flat.slice(Math.max(m.index - 40, 0), m.index + m[0].length + 50).trim(),
    ),
  );
}
