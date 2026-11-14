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

/**
 * Each `var(--token, fallback)` of an explorer's stylesheet whose token site.css declares with another value: the
 * explorer is drawn with its fallbacks wherever it is opened without the hub's stylesheet.
 */
export function fallbacksUnlikeTheSite(style: string): string[] {
  const unlike = new Set<string>();
  for (const [, name, fallback] of style.matchAll(
    /var\((--[\w-]+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g,
  )) {
    const site = SITE_TOKENS.get(name as string);
    const value = plain(fallback as string);
    if (site !== undefined && site !== value)
      unlike.add(`${name}: ${value} where site.css has ${site}`);
  }
  return [...unlike];
}
