import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalisedBaseUrl } from "../src/names.js";
import { Refusal } from "../src/refusal.js";

function unescaped(text: string): string {
  return text.replace(/\\(\\|x[0-9A-Fa-f]{2})/g, (_, escape: string) =>
    escape === "\\" ? "\\" : String.fromCharCode(parseInt(escape.slice(1), 16)),
  );
}

const cases = readFileSync(
  new URL("../../test/base-url-edge-cases.txt", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => {
    const [url = "", expected = ""] = line.split("\t");
    return { url: unescaped(url), expected };
  });

test("every line of the base URL edge cases is normalised or refused as written", () => {
  assert.ok(cases.length > 50, "the file lists its cases");
  for (const { url, expected } of cases) {
    if (expected === "REFUSED")
      assert.throws(() => normalisedBaseUrl(url), Refusal, JSON.stringify(url));
    else assert.equal(normalisedBaseUrl(url), expected, JSON.stringify(url));
  }
});

test("a refusal gives its reason and never echoes the URL", () => {
  for (const { url, expected } of cases) {
    if (expected !== "REFUSED") continue;
    try {
      normalisedBaseUrl(url);
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(message.length > 10, "the refusal says why");
      assert.ok(!message.includes(url), `${JSON.stringify(url)} is echoed`);
    }
  }
});
