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

/** The schema's errors for `value`, one line each; empty when it is valid. */
export function errorsOf(name: SchemaName, value: unknown): string[] {
  const validate = validatorOf(name);
  return validate(value)
    ? []
    : (validate.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? ""}`,
      );
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
