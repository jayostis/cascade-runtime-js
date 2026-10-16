/**
 * RFC 8259 JSON that `JSON.parse` would read too generously for an encryption header: an object naming a member twice
 * (after escapes are decoded) is refused, and each object remembers which of its members held a number written other
 * than as plain digits, which `looseNumbers` gives back.
 */

const loose = new WeakMap<object, Set<string>>();

/** The members of an object `parseStrictJson` made whose number was written other than as `0|[1-9][0-9]*`. */
export function looseNumbers(object: object): ReadonlySet<string> {
  return loose.get(object) ?? new Set();
}

const PLAIN = /^(?:0|[1-9][0-9]*)$/;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const DEPTH = 64;
const ESCAPED: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export function parseStrictJson(text: string): unknown {
  let i = 0;

  const fail = (what: string): never => {
    throw new SyntaxError(`${what} at offset ${i}`);
  };
  const space = () => {
    while (i < text.length && " \t\n\r".includes(text.charAt(i))) i++;
  };

  const string = (): string => {
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail("an unterminated string");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return out;
      }
      if (c < 0x20) fail("a control character in a string");
      if (c !== 0x5c) {
        out += text.charAt(i);
        i++;
        continue;
      }
      const escape = text.charAt(i + 1);
      i += 2;
      if (escape === "u") {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("a bad \\u escape");
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        const decoded = ESCAPED[escape];
        if (decoded === undefined) return fail("a bad escape");
        out += decoded;
      }
    }
  };

  const value = (depth: number): unknown => {
    if (depth > DEPTH) fail("nesting too deep");
    space();
    const c = text.charAt(i);
    if (c === "{") {
      i++;
      const object: Record<string, unknown> = {};
      const seen = new Set<string>();
      const written = new Set<string>();
      space();
      if (text.charAt(i) === "}") {
        i++;
        return object;
      }
      for (;;) {
        space();
        if (text.charAt(i) !== '"') fail("expected a member name");
        const name = string();
        if (seen.has(name)) fail("a member named twice");
        seen.add(name);
        space();
        if (text.charAt(i) !== ":") fail("expected ':'");
        i++;
        space();
        const start = i;
        const member = value(depth + 1);
        if (typeof member === "number" && !PLAIN.test(text.slice(start, i)))
          written.add(name);
        Object.defineProperty(object, name, {
          value: member,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        space();
        if (text.charAt(i) === ",") {
          i++;
          continue;
        }
        if (text.charAt(i) === "}") {
          i++;
          break;
        }
        fail("expected ',' or '}'");
      }
      if (written.size > 0) loose.set(object, written);
      return object;
    }
    if (c === "[") {
      i++;
      const array: unknown[] = [];
      space();
      if (text.charAt(i) === "]") {
        i++;
        return array;
      }
      for (;;) {
        array.push(value(depth + 1));
        space();
        if (text.charAt(i) === ",") {
          i++;
          continue;
        }
        if (text.charAt(i) === "]") {
          i++;
          return array;
        }
        fail("expected ',' or ']'");
      }
    }
    if (c === '"') return string();
    for (const [word, literal] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return literal;
      }
    }
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(text);
    if (match === null) return fail("an unexpected character");
    i += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("a number out of range");
    return number;
  };

  const parsed = value(0);
  space();
  if (i !== text.length) fail("trailing characters");
  return parsed;
}
