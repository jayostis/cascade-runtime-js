// The harness's JSON schemas, under `schemas/`, and the one validator that holds each file to its schema.
import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { SCHEMAS } from "./paths.js";

export type SchemaName =
  "case" | "key" | "config" | "answer" | "verdict" | "results";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const compiled = new Map<SchemaName, ValidateFunction>();

function validatorOf(name: SchemaName): ValidateFunction {
  let found = compiled.get(name);
  if (found === undefined) {
    found = ajv.compile(
      JSON.parse(readFileSync(`${SCHEMAS}/${name}.schema.json`, "utf8")),
    );
    compiled.set(name, found);
  }
  return found;
}

/**
 * An answer with every item numbered: an item's own `n` is kept, one without is numbered by its place, from 1. The one
 * place an answer's numbering is decided; every reader loads an answer through it.
 */
export function numbered(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const { items } = value as { items?: unknown };
  if (!Array.isArray(items)) return value;
  return {
    ...value,
    items: items.map((item: unknown, at) =>
      typeof item === "object" && item !== null && !("n" in item)
        ? { n: at + 1, ...item }
        : item,
    ),
  };
}

/** The numbers more than one item of a valid answer carries, as error lines. */
function repeatedNumbers(answer: unknown): string[] {
  const seen = new Set<number>();
  const repeated = new Set<number>();
  for (const item of (numbered(answer) as { items: { n: number }[] }).items)
    (seen.has(item.n) ? repeated : seen).add(item.n);
  return [...repeated].map(
    (n) =>
      `/items more than one item has n ${n} (an item without n is numbered by its place)`,
  );
}

/** The schema's errors for `value`, one line each; empty when it is valid. */
export function errorsOf(name: SchemaName, value: unknown): string[] {
  const validate = validatorOf(name);
  if (!validate(value))
    return (validate.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? ""}`,
    );
  return name === "answer" ? repeatedNumbers(value) : [];
}

/** `value` held to the schema; it throws naming `what` and every error otherwise. */
export function valid<T>(name: SchemaName, value: unknown, what: string): T {
  const errors = errorsOf(name, value);
  if (errors.length > 0)
    throw new Error(
      `${what} is not a valid ${name}:\n  ${errors.join("\n  ")}`,
    );
  return value as T;
}

/** The schema itself, as the API runner and a report read it. */
export function schemaText(name: SchemaName): string {
  return readFileSync(`${SCHEMAS}/${name}.schema.json`, "utf8");
}
