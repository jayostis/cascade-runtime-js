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

/** Waits for try/ to finish its step; a page that reports an error, or never finishes, fails with what it said. */
export async function settled(page: Page): Promise<void> {
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
  if ((await page.getAttribute("body", "data-state")) !== "ready")
    throw new Error(
      `try/ says: ${(await page.textContent("main")) ?? ""} ${(pageErrors.get(page) ?? []).join("; ")}`,
    );
}

/** Opens the new-pod box and clicks the choice that holds `label`, then waits for the pod's page. */
export async function newPod(page: Page, label: string): Promise<void> {
  await page.click('a[href="#new-pod"]');
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    page.click(`#new-pod button:has-text(${JSON.stringify(label)})`),
  ]);
  await settled(page);
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
