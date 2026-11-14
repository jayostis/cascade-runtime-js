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
];

/** What a reader sees of a page's HTML: the tags, styles and scripts' code left off, entities read. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&(?:rsquo|#39|#x27);|’/g, "'");
}

/** Each stretch of `text` that speaks to a patient, with a little of what surrounds it. */
export function speaksToPatient(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  return PATIENT_PHRASES.flatMap((pattern) =>
    [...flat.matchAll(pattern)].map((m) =>
      flat
        .slice(Math.max(m.index - 40, 0), m.index + m[0].length + 50)
        .trim(),
    ),
  );
}
