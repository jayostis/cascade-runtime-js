/**
 * The website's tokens, strip, header and footer (cascadeprotocol.org, css/site.css sections 1 and 2), the tokens
 * declared on `scope`: `:root` for a hub page, a wrapper element where the page has a palette of its own.
 */
export const chromeStyles = (scope: string): string => `${scope} {
  --ink: #14202a;
  --ink-2: #3a4853;
  --muted: #5a6873;
  --pencil: #b4410c;
  --link: #0b6a8a;
  --link-hover: #084f68;
  --rule: #c9d1d6;
  --rule-soft: #e3e8eb;
  --paper: #f6f7f8;
  --amber: #8a5a0d;
  --serif: 'Newsreader', Georgia, 'Times New Roman', serif;
  --sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --wrap: 1200px;
  --gutter: 32px;
}
@media (max-width: 760px) { ${scope} { --gutter: 16px; } }
.b-skip { position: absolute; left: -9999px; }
.b-skip:focus { left: 16px; top: 8px; z-index: 100; background: #ffffff; padding: 8px 12px; }
.sx-strip { background: var(--ink); color: #ffffff; font-family: var(--mono); font-size: 13px; line-height: 1.4;
            letter-spacing: .02em; padding: 10px 16px; text-align: center; }
.sx-strip a { color: #ffb38a; font-weight: 500; text-decoration: none; }
.sx-strip a:hover { text-decoration: underline; }
.sx-header { background: #ffffff; border-bottom: 1px solid var(--rule); position: relative; z-index: 50; }
.sx-header * { box-sizing: border-box; }
.sx-bar { max-width: var(--wrap); margin: 0 auto; padding: 0 var(--gutter); min-height: 64px; display: flex;
          align-items: center; gap: 4px; }
.sx-logo { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-right: auto; color: var(--ink);
           font-family: var(--sans); font-weight: 600; font-size: 17px; text-decoration: none; }
.sx-logo:hover { color: var(--ink); text-decoration: none; }
.sx-logo svg { flex: none; }
.sx-nav { display: flex; align-items: center; gap: 2px; padding: 0; margin: 0; border: 0; }
.sx-nav a, .sx-nav span { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; color: var(--ink);
            font-family: var(--sans); font-size: 15px; text-decoration: none; border-bottom: 2px solid transparent; }
.sx-nav a:hover { border-bottom-color: var(--rule); color: var(--ink); text-decoration: none; }
.sx-nav a[aria-current="page"] { border-bottom-color: var(--pencil); font-weight: 600; }
.sx-menu { display: none; margin: 0; }
.sx-menu summary { list-style: none; display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px;
                   border: 1px solid var(--ink); font-family: var(--sans); font-size: 15px; color: var(--ink);
                   cursor: pointer; }
.sx-menu summary::-webkit-details-marker { display: none; }
.sx-menu[open] summary { background: var(--ink); color: #ffffff; }
.sx-menu nav { position: absolute; left: 0; right: 0; top: 100%; background: #ffffff; border-bottom: 1px solid var(--rule);
               padding: 4px var(--gutter) 16px; display: flex; flex-direction: column; margin: 0; }
.sx-menu nav a, .sx-menu nav span { display: flex; align-items: center; min-height: 52px; font-family: var(--serif); font-size: 24px;
                 color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule-soft); }
@media (max-width: 860px) { .sx-nav { display: none; } .sx-menu { display: block; } }
.sx-find-wrap { max-width: var(--wrap); margin: 0 auto; padding: 0 var(--gutter) 12px; }
.sx-find { position: relative; margin: 0; }
.sx-find[hidden], .sx-find ul[hidden] { display: none; }
.sx-find-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.sx-find input { display: block; width: 100%; min-height: 44px; padding: 0 14px; border: 1px solid var(--rule); border-radius: 4px;
                 background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 16px; }
.sx-find input:focus { outline: 2px solid var(--link); outline-offset: 1px; background: #ffffff; }
.sx-find ul { position: absolute; left: 0; right: 0; top: 100%; z-index: 60; margin: 4px 0 0; padding: 0; list-style: none;
              background: #ffffff; border: 1px solid var(--ink); box-shadow: 0 6px 18px rgba(20, 32, 42, .18); }
.sx-find li { margin: 0; border-bottom: 1px solid var(--rule-soft); }
.sx-find li:last-child { border-bottom: 0; }
.sx-find li a { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0 12px; align-items: baseline; min-height: 44px; padding: 8px 14px;
                color: var(--ink); text-decoration: none; font-family: var(--sans); font-size: 15px; }
.sx-find li[aria-selected="true"] a, .sx-find li a:hover { background: var(--paper); }
.sx-find-kind { grid-row: 1 / 3; font: 500 12px/1.6 var(--mono); color: var(--pencil); text-transform: uppercase; letter-spacing: .04em; }
.sx-find-title { overflow-wrap: anywhere; }
.sx-find-where { grid-column: 2; font: 12px/1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.sx-find-none { padding: 12px 14px; color: var(--ink-2); font-family: var(--sans); font-size: 15px; }
@media (max-width: 760px) { .sx-find li a { grid-template-columns: 4.5rem 1fr; gap: 0 8px; } }
.sx-footer { background: #ffffff; font-family: var(--sans); color: var(--ink); margin: 0; padding: 0; border: 0; }
.sx-footer * { box-sizing: border-box; }
.sx-footer-wrap { max-width: var(--wrap); margin: 0 auto; padding: 40px var(--gutter); }
.sx-footer-inner { border-top: 3px solid var(--ink); padding-top: 32px; }
.sx-footer-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 32px; }
.sx-footer h2 { font-family: var(--mono); font-size: 13px; font-weight: 500; color: var(--pencil); margin: 0 0 6px;
                line-height: 1.4; }
.sx-footer ul { list-style: none; margin: 0; padding: 0; }
.sx-footer li a { display: flex; align-items: center; min-height: 40px; color: var(--ink); font-size: 15px;
                  text-decoration: none; border-bottom: 1px solid var(--rule-soft); }
.sx-footer li a:hover { color: var(--link); }
.sx-footer p { margin: 0 0 12px; font-size: 15px; line-height: 1.5; color: var(--ink-2); }
.sx-footer-legal { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 32px; padding-top: 18px;
                   border-top: 1px solid var(--rule); font-size: 14px; line-height: 1.5; color: var(--muted); }
.sx-footer-inner > .sx-footer-legal:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.sx-footer-legal span { margin-right: auto; }
.sx-footer p.sx-footer-built { margin: 12px 0 0; font-size: 14px; color: var(--muted); }
.sx-footer-legal a { color: var(--muted); display: inline-flex; align-items: center; min-height: 32px; }
`;

export const STYLESHEET = `${chromeStyles(":root")}body { font: 17px/1.6 var(--sans); margin: 0; color: var(--ink); background: #fff;
       -webkit-font-smoothing: antialiased; }
main, nav.hub-nav { max-width: 68rem; margin: 0 auto; padding: 0 1rem; }
main { padding-bottom: 3rem; overflow-wrap: break-word; }
.sx-header + main { padding-top: 72px; }
@media (max-width: 760px) { .sx-header + main { padding-top: 48px; } }
nav.hub-nav { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; padding-top: .75rem; padding-bottom: .75rem;
              border-bottom: 1px solid var(--rule); margin-bottom: 1rem; }
a { color: var(--link); text-underline-offset: 3px; }
a:hover { color: var(--link-hover); }
main a, main :not(pre) > code { overflow-wrap: anywhere; }
main pre { overflow-x: auto; max-width: 100%; }
h1 { font: 500 clamp(30px, 4vw, 44px)/1.1 var(--serif); letter-spacing: -.01em; margin: .25rem 0 .5rem;
     overflow-wrap: anywhere; }
h2 { font: 500 1.4rem/1.2 var(--serif); margin: 0 0 .25rem; }
h2.part { font-size: 1.75rem; margin: 2.5rem 0 .5rem; }
h3 { font: 600 1.05rem/1.3 var(--sans); margin: 1.5rem 0 .25rem; }
code, pre { font: .86em/1.45 var(--mono); }
p code, dd code, dt code, td code { overflow-wrap: anywhere; }
.kind { color: var(--muted); margin: 0; text-transform: uppercase; letter-spacing: .04em; font-size: .8rem; }
.iri { color: var(--muted); margin: 0 0 1rem; }
.layout { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .35rem 1rem; }
.layout dt { font-weight: 600; }
.layout dd { margin: 0; overflow-wrap: anywhere; }
section.query, section.term { margin: 1.5rem 0; padding: 1rem 0 0; border-top: 1px solid var(--rule); }
.prose { margin: 0 0 .5rem; max-width: 46rem; }
.about, .count, .lens { color: var(--muted); font-size: .9rem; margin: .25rem 0; }
.answer { overflow-x: auto; }
.lenses { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 0 2rem; }
.also { font-size: .8rem; }
pre.command { background: var(--paper); padding: .75rem; border-radius: 4px; max-width: 46rem; white-space: pre-wrap;
              overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: .3rem .6rem; border-bottom: 1px solid var(--rule-soft);
         overflow-wrap: anywhere; }
th { background: var(--paper); font: 600 .85rem/1.4 var(--mono); white-space: nowrap; }
table.results th { white-space: normal; }
#find-your-way ul { margin: 0; padding-left: 1.1rem; }
#find-your-way th[scope="row"], #repository-list th[scope="row"] { white-space: normal; font: 600 .95rem/1.4 var(--sans); width: 14rem; }
td code { color: var(--muted); font-size: .8rem; }
details { margin: .5rem 0 0; }
summary { cursor: pointer; color: var(--link); }
.document { max-width: 52rem; }
.document h1 { margin-top: 1rem; }
.document h2 { margin: 2.25rem 0 .5rem; padding-top: .5rem; border-top: 1px solid var(--rule-soft); }
.document h3 { margin: 1.5rem 0 .25rem; }
.document pre { background: var(--paper); padding: .75rem; overflow-x: auto; border-radius: 4px; }
.document :not(pre) > code { background: var(--paper); padding: 0 .2rem; border-radius: 3px; }
.document li { margin: .15rem 0; }
details pre { background: var(--paper); padding: .75rem; overflow-x: auto; border-radius: 4px; }
@media (max-width: 40rem) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .layout dd { margin-bottom: .5rem; }
  thead { display: none; }
  table, tbody, tr, td { display: block; }
  tr { border-bottom: 1px solid var(--rule); padding: .5rem 0; }
  td { border: 0; padding: .1rem 0; }
  #find-your-way th[scope="row"], #repository-list th[scope="row"] { display: block; width: auto; background: none; padding-left: 0; border: 0; }
  td:empty { display: none; }
  td::before { content: attr(data-label); display: block; color: var(--muted); font: .75rem var(--mono); }
}
`;
