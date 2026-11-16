/**
 * A page's script for folded groups: an address that names a section inside a folded group opens every fold round it and
 * scrolls to it, on load and whenever the address changes. It scrolls whether it opened a fold or not, for the browser may
 * have opened the fold first and scrolled before the page was laid out. `before` is declarations placed ahead of the
 * function, and `missing` runs when the address names nothing on the page; `missing` sees the wanted id as `id`.
 */
export function foldScript(before = "", missing = ""): string {
  return [
    "(function () {",
    ...(before === "" ? [] : [before]),
    "function show() {",
    "  var id;",
    "  try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }",
    "  if (id === '') return;",
    "  var target = document.getElementById(id);",
    "  if (target === null) {",
    ...(missing === "" ? [] : [`    ${missing}`]),
    "    return;",
    "  }",
    "  for (var up = target.parentElement; up !== null; up = up.parentElement)",
    "    if (up.tagName === 'DETAILS') up.open = true;",
    "  target.scrollIntoView();",
    "}",
    "show();",
    "window.addEventListener('hashchange', show);",
    "})();",
  ].join("\n");
}
