// What model calls cost, from the dated price table `prices.json`.
import { readFileSync } from "node:fs";
import { PRICES } from "./paths.js";

interface Rates {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

interface PriceTable {
  readonly date: string;
  readonly models: Readonly<
    Record<string, Rates & { above?: Rates & { promptTokens: number } }>
  >;
}

export const PRICE_TABLE = JSON.parse(
  readFileSync(PRICES, "utf8"),
) as PriceTable;

export interface Tokens {
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
}

/** The model's id without a date or a context suffix, as the price table names it. */
export const priced = (model: string) =>
  model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");

/** One call's cost in dollars, or undefined for a model the table does not price. */
export function callCost(model: string, tokens: Tokens): number | undefined {
  const rates = PRICE_TABLE.models[priced(model)];
  if (rates === undefined) return undefined;
  const prompt = tokens.input + tokens.cacheCreation + tokens.cacheRead;
  const r =
    rates.above !== undefined && prompt > rates.above.promptTokens
      ? rates.above
      : rates;
  return (
    (tokens.input * r.input +
      tokens.cacheCreation * r.cacheWrite +
      tokens.cacheRead * r.cacheRead +
      tokens.output * r.output) /
    1_000_000
  );
}

export const totalOf = (tokens: Tokens) =>
  tokens.input + tokens.cacheCreation + tokens.cacheRead + tokens.output;
