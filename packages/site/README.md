# @cascade-runtime/site

The site that documents a pod and its queries.

The website owns the chrome: run `node scripts/sync-chrome.mjs` after it changes (it reads
`${WEBSITE_URL}/css/chrome.css`, or the address after `--from`), and commit `packages/site/src/chrome.css`. `chromeStyles` in `src/stylesheet.ts` is built from that copy.
