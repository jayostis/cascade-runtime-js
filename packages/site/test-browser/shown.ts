import type { Page } from "playwright";

/** What try/ shows once it has finished a step. */
export interface Shown {
  /** Each active allergy, as its allergen and its criticality. */
  readonly active: string[][];
  readonly added: string[];
}

const pageErrors = new WeakMap<Page, string[]>();

/** The page, with what went wrong in it collected for a failure's message. */
export function watched(page: Page): Page {
  const said: string[] = [];
  page.on("pageerror", (error) => said.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") said.push(message.text());
  });
  page.on("requestfailed", (request) =>
    said.push(`${request.url()}: ${request.failure()?.errorText ?? ""}`),
  );
  pageErrors.set(page, said);
  return page;
}

/** What try/ shows when its step is done; a page that reports an error, or never finishes, fails with what it said. */
export async function shown(page: Page): Promise<Shown> {
  try {
    await page.waitForSelector(
      'body[data-state="ready"], body[data-state="error"]',
      { timeout: 120_000 },
    );
  } catch (error) {
    throw new Error(
      `try/ never finished: ${(pageErrors.get(page) ?? []).join("; ") || String(error)}`,
      { cause: error },
    );
  }
  const status = await page.textContent("#status");
  if ((await page.getAttribute("body", "data-state")) !== "ready")
    throw new Error(
      `try/ says: ${status ?? ""} ${(pageErrors.get(page) ?? []).join("; ")}`,
    );
  return {
    active: await page.$$eval("#active tbody tr", (rows) =>
      rows.map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? ""),
      ),
    ),
    added: await page.$$eval("#added li", (items) =>
      items.map((item) => item.textContent ?? ""),
    ),
  };
}
