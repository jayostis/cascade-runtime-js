import { Refusal } from "@cascade-runtime/runtime/refusal";

/** The keywords of JSON Schema that `checkInput` knows, and no others. */
export interface InputSchema {
  readonly type: "object" | "string" | "integer";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, InputSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export type Schema = InputSchema;

export type Input = Record<string, unknown>;

/**
 * Checks an input against a schema of the keywords `InputSchema` names.
 *
 * Served from `cascade-runtime/check` with nothing of the runtime behind it. In Node it is the main entry's function
 * and throws its `Refusal`; the browser build of the subpath carries its own copy of both, so in a page tell a refusal
 * by its `name` (`"Refusal"`), never by `instanceof`.
 *
 * @throws Refusal naming the first thing wrong.
 */
export function checkInput(schema: Schema, input: unknown, at = "input"): void {
  if (schema.type === "object") {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      throw new Refusal(`${at} must be an object`);
    const given = input as Input;
    for (const name of schema.required ?? [])
      if (given[name] === undefined)
        throw new Refusal(`${at}.${name} is required`);
    for (const [name, value] of Object.entries(given)) {
      const property = Object.hasOwn(schema.properties ?? {}, name)
        ? schema.properties![name]
        : undefined;
      if (property === undefined) {
        if (schema.additionalProperties === false)
          throw new Refusal(`${at}.${name} is not a property of ${at}`);
        continue;
      }
      if (value !== undefined) checkInput(property, value, `${at}.${name}`);
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof input !== "string") throw new Refusal(`${at} must be a string`);
  } else if (!Number.isInteger(input))
    throw new Refusal(`${at} must be an integer`);
  if (schema.enum && !schema.enum.includes(input as string | number))
    throw new Refusal(`${at} must be one of ${schema.enum.join(", ")}`);
  if (typeof input === "number") {
    if (schema.minimum !== undefined && input < schema.minimum)
      throw new Refusal(`${at} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && input > schema.maximum)
      throw new Refusal(`${at} must be at most ${schema.maximum}`);
  }
}
