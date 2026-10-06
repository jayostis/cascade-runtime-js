export const STYLESHEET = `:root {
  --text: #1d2330;
  --quiet: #5b6475;
  --line: #e3e6eb;
  --rule: #d5d9e0;
  --panel: #f3f5f8;
  --link: #1a5bb8;
}
body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 68rem; padding: 0 1rem 3rem;
       color: var(--text); background: #fff; }
nav { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; padding: .75rem 0; border-bottom: 1px solid var(--rule);
      margin-bottom: 1rem; }
a { color: var(--link); }
h1 { font-size: 1.6rem; line-height: 1.25; margin: .25rem 0 .5rem; overflow-wrap: anywhere; }
h2 { font-size: 1.15rem; margin: 0 0 .25rem; }
h2.part { font-size: 1.35rem; margin: 2.5rem 0 .5rem; }
code, pre { font: .875rem/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
p code, dd code, dt code, td code { overflow-wrap: anywhere; }
.kind { color: var(--quiet); margin: 0; text-transform: uppercase; letter-spacing: .04em; font-size: .8rem; }
.iri { color: var(--quiet); margin: 0 0 1rem; }
.layout { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1rem; }
.layout dt { font-weight: 600; }
.layout dd { margin: 0; }
section.query { margin: 1.5rem 0; padding: 1rem 0 0; border-top: 1px solid var(--rule); }
.prose { margin: 0 0 .5rem; max-width: 46rem; }
.about, .count, .lens { color: var(--quiet); font-size: .9rem; margin: .25rem 0; }
.answer { overflow-x: auto; }
.lenses { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 0 2rem; }
.also { font-size: .8rem; }
pre.command { background: var(--panel); padding: .75rem; border-radius: 4px; max-width: 46rem; white-space: pre-wrap;
              overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: .3rem .6rem; border-bottom: 1px solid var(--line);
         overflow-wrap: anywhere; }
th { background: var(--panel); font: 600 .85rem/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: nowrap; }
td code { color: var(--quiet); font-size: .8rem; }
details { margin: .5rem 0 0; }
summary { cursor: pointer; color: var(--link); }
details pre { background: var(--panel); padding: .75rem; overflow-x: auto; border-radius: 4px; }
@media (max-width: 40rem) {
  .layout { grid-template-columns: 1fr; }
  .layout dd { margin-bottom: .5rem; }
  thead { display: none; }
  table, tbody, tr, td { display: block; }
  tr { border-bottom: 1px solid var(--rule); padding: .5rem 0; }
  td { border: 0; padding: .1rem 0; }
  td:empty { display: none; }
  td::before { content: attr(data-label); display: block; color: var(--quiet); font: .75rem ui-monospace, monospace; }
}
`;
