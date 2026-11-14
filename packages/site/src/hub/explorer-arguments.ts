import { FONTS } from "../html.js";
import { STYLESHEET_FILE } from "../site.js";
import { STYLESHEET } from "../stylesheet.js";

/**
 * The arguments cascade-bridge-spec's `adapter_explorer.py` is run with over one adapter. An explorer is published at
 * `adapters/<name>/`, so `../index.html` is the adapters page it was reached from and `../../site.css` the hub's
 * stylesheet, linked with the website's faces ahead of the explorer's own.
 */
export function explorerArguments(of: {
  script: string;
  adapterFolder: string;
  vocabularyFolder: string;
  repository: string;
  report: string;
  out: string;
}): string[] {
  return [
    of.script,
    of.adapterFolder,
    "--vocabulary",
    of.vocabularyFolder,
    "--repository",
    of.repository,
    "--report",
    of.report,
    "--way-back",
    "Adapters",
    "../index.html",
    "--stylesheet",
    FONTS,
    "--stylesheet",
    `../../${STYLESHEET_FILE}`,
    "--out",
    of.out,
  ];
}

const plain = (value: string) => value.replace(/\s+/g, " ").trim();

/** The tokens site.css declares on `:root`, by name. */
const SITE_TOKENS = new Map(
  [
    ...(STYLESHEET.match(/:root \{([^}]*)\}/)?.[1] ?? "").matchAll(
      /(--[\w-]+):\s*([^;]+);/g,
    ),
  ].map(([, name, value]) => [name as string, plain(value as string)]),
);

/** The tokens the explorer sets itself, which site.css does not declare. */
const OWN_TOKENS = new Set(["--bar", "--d"]);

/**
 * What is wrong with the tokens an explorer's stylesheet names, as sentences, none when it is right. Each
 * `var(--token, fallback)` whose token site.css declares with another value is wrong, since the explorer is drawn with
 * its fallbacks wherever it is opened without the hub's stylesheet; so is a token that site.css does not declare and
 * the explorer does not set itself, and a stylesheet naming none of site.css's tokens.
 */
export function fallbacksUnlikeTheSite(style: string): string[] {
  const unlike = new Set<string>();
  let named = 0;
  for (const [, name, fallback] of style.matchAll(
    /var\((--[\w-]+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g,
  )) {
    const site = SITE_TOKENS.get(name as string);
    const value = plain(fallback as string);
    if (site !== undefined) named += 1;
    if (site === undefined && !OWN_TOKENS.has(name as string))
      unlike.add(
        `${name}: the explorer names it and site.css does not define it`,
      );
    else if (site !== undefined && site !== value)
      unlike.add(`${name}: ${value} where site.css has ${site}`);
  }
  return named === 0
    ? ["the page has no <style> naming the site's tokens", ...unlike]
    : [...unlike];
}
