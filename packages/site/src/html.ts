const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&#34;",
  "'": "&#39;",
};

/** HTML: only the literal parts of a `markup` template become tags; anything put in it is text. */
export class Html {
  constructor(readonly text: string) {}
}

export type Content =
  Html | string | number | null | undefined | false | readonly Content[];

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function render(content: Content): string {
  if (content instanceof Html) return content.text;
  if (Array.isArray(content)) return content.map(render).join("");
  if (content === null || content === undefined || content === false) return "";
  return escape(String(content));
}

export function markup(
  strings: TemplateStringsArray,
  ...values: readonly Content[]
): Html {
  return new Html(
    strings.reduce(
      (text, literal, index) =>
        text + render(values[index - 1] as Content) + literal,
    ),
  );
}
