import assert from "node:assert/strict";
import type { Page } from "playwright";

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

/**
 * Waits for try/ to finish its step, `timeout` ms at most; a page that reports an error, or never finishes, fails with
 * what it said.
 */
export async function settled(page: Page, timeout = 120_000): Promise<void> {
  try {
    await page.waitForSelector(
      'body[data-state="ready"], body[data-state="error"]',
      { timeout },
    );
  } catch (error) {
    throw new Error(
      `try/ never finished: ${(pageErrors.get(page) ?? []).join("; ") || String(error)}`,
      { cause: error },
    );
  }
  if ((await page.getAttribute("body", "data-state")) !== "ready")
    throw new Error(
      `try/ says: ${(await page.textContent("main")) ?? ""} ${(pageErrors.get(page) ?? []).join("; ")}`,
    );
}

/** Does `act`, then waits for try/ to finish its step, which must have drawn the page in place, never loading one. */
export async function inPlace(
  page: Page,
  act: () => Promise<unknown>,
): Promise<void> {
  const mark = (): Promise<unknown> =>
    page.evaluate(() => (globalThis as { stayed?: boolean }).stayed);
  await page.evaluate(() => {
    (globalThis as { stayed?: boolean }).stayed = true;
  });
  await act();
  await settled(page);
  assert.equal(await mark(), true, "try/ loaded a page");
}

/** Opens the new-pod box and clicks the choice that holds `label`, then waits for the pod's page, drawn in place. */
export async function newPod(page: Page, label: string): Promise<void> {
  await page.click('a[href="#new-pod"]');
  await inPlace(page, () =>
    page.click(`#new-pod button:has-text(${JSON.stringify(label)})`),
  );
}

/** Each tile the pod's page shows, by its kind, with the count it shows. */
export async function tiles(page: Page): Promise<Map<string, number>> {
  return new Map(
    await page.$$eval(".tiles .tile", (shown) =>
      shown.map(
        (tile) =>
          [
            tile.querySelector(".kind")?.textContent ?? "",
            Number(tile.querySelector(".count")?.textContent),
          ] as [string, number],
      ),
    ),
  );
}
