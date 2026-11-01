// The report's one stylesheet and one script, inlined in every page so a page opens from a file.

export const STYLE = `
:root{--bg:#f7f7f5;--fg:#1d2126;--muted:#626b75;--line:#dcdfe3;--card:#fff;--soft:#eef0f2;--soft2:#e4e7ea;
--pod:#1f5fb3;--pod-bg:#e8f0fb;--records:#9a5b12;--records-bg:#fbf1e3;--test:#5a5f93;--test-bg:#ebecf8;
--yes:#1c7c3b;--yes-bg:#def4e4;--part:#9a6a00;--part-bg:#fcf0c8;--no:#bb2b31;--no-bg:#fde3e2;
--beyond:#5a5f93;--beyond-bg:#ebecf8;--link:#1f5fb3;--r:12px}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121518;--fg:#e7eaee;--muted:#9ba4ae;--line:#2c333b;--card:#1a1f25;--soft:#222931;--soft2:#2a323b;
--pod:#7fb0ff;--pod-bg:#15273f;--records:#e3a95c;--records-bg:#352713;--test:#b4b8f0;--test-bg:#262a4a;
--yes:#5fcf7d;--yes-bg:#15351f;--part:#e6bb46;--part-bg:#3a2f0c;--no:#ff8780;--no-bg:#45191b;
--beyond:#b4b8f0;--beyond-bg:#262a4a;--link:#7fb0ff}}
:root[data-theme=dark]{--bg:#121518;--fg:#e7eaee;--muted:#9ba4ae;--line:#2c333b;--card:#1a1f25;--soft:#222931;--soft2:#2a323b;
--pod:#7fb0ff;--pod-bg:#15273f;--records:#e3a95c;--records-bg:#352713;--test:#b4b8f0;--test-bg:#262a4a;
--yes:#5fcf7d;--yes-bg:#15351f;--part:#e6bb46;--part-bg:#3a2f0c;--no:#ff8780;--no-bg:#45191b;
--beyond:#b4b8f0;--beyond-bg:#262a4a;--link:#7fb0ff}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px 18px 72px}
a{color:var(--link)}
h1{font-size:clamp(1.5rem,3.2vw,2.1rem);line-height:1.2;margin:.3em 0 .35em;letter-spacing:-.01em}
h2{font-size:1.18rem;margin:2.2em 0 .6em}h3{font-size:1rem;margin:0 0 .4em}h4{font-size:.9rem;margin:10px 0 6px}
p{margin:.4em 0}.muted{color:var(--muted)}.small{font-size:.86rem}.tiny{font-size:.78rem}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.85em;word-break:break-all}
pre{white-space:pre-wrap;word-break:break-word;background:var(--soft);padding:12px 14px;border-radius:8px;max-height:460px;overflow:auto;font-size:.78rem;line-height:1.45}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:.86rem;color:var(--muted);padding:6px 0 14px}
.top .crumbs a{text-decoration:none}.top .crumbs span{margin:0 6px;opacity:.6}
.top button{font:inherit;font-size:.8rem;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 10px;cursor:pointer}
.lead{font-size:1.05rem;max-width:820px}
.links{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:.9rem;margin:8px 0 0}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.82rem;color:var(--muted);align-items:center;margin:10px 0 0}
.badge{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.76rem;font-weight:600;white-space:nowrap;vertical-align:middle}
.b-pod{background:var(--pod-bg);color:var(--pod)}.b-records{background:var(--records-bg);color:var(--records)}.b-test{background:var(--test-bg);color:var(--test)}
.mark{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:1px 9px 1px 6px;font-size:.8rem;font-weight:600;line-height:1.5}
.mark i{font-style:normal;font-weight:800;width:1em;text-align:center}
.m-yes{background:var(--yes-bg);color:var(--yes)}.m-part{background:var(--part-bg);color:var(--part)}.m-no{background:var(--no-bg);color:var(--no)}
.m-beyond{background:var(--beyond-bg);color:var(--beyond)}.m-none{background:var(--soft);color:var(--muted)}
.ok{color:var(--yes)}.bad{color:var(--no)}
.hl{overflow-x:auto}.hl table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);margin:10px 0;min-width:640px}
.hl th,.hl td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:.92rem}
.hl th{font-size:.76rem;color:var(--muted);font-weight:600;background:var(--soft)}.hl tr:last-child td{border-bottom:0}
.hl td.money{font-variant-numeric:tabular-nums;white-space:nowrap}
.dots{display:inline-flex;flex-wrap:wrap;gap:3px;vertical-align:middle;margin-left:4px}
.dot{display:inline-block;width:14px;height:14px;border-radius:4px;font-size:.66rem;line-height:14px;text-align:center;font-weight:800}
.d-yes{background:var(--yes-bg);box-shadow:inset 0 0 0 1px var(--yes)}.d-part{background:var(--part-bg);box-shadow:inset 0 0 0 1px var(--part)}
.d-no{background:var(--no-bg)}.d-contra{background:var(--no);color:#fff}
.runs{display:grid;gap:8px;margin:12px 0}
.runrow{display:grid;grid-template-columns:170px 1fr 1fr 170px;gap:8px 18px;align-items:start;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 16px;text-decoration:none;color:inherit}
.runrow:hover{border-color:var(--fg)}
.runrow .res{display:grid;gap:3px;font-size:.86rem}.runrow .res .money{color:var(--muted);font-variant-numeric:tabular-nums}.runrow .res .money b{color:var(--fg);font-weight:600}
.runrow .overhead{font-size:.8rem;color:var(--muted)}
.runhead{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:14px 0 6px}
.rh{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:grid;gap:2px}
.rh b{font-size:1.4rem;font-variant-numeric:tabular-nums}.rh.pod{border-top:3px solid var(--pod)}.rh.records{border-top:3px solid var(--records)}
aside.overhead{background:var(--card);border:1px dashed var(--test);border-radius:10px;padding:10px 12px;display:grid;gap:2px}
aside.overhead b{font-size:1.4rem;font-variant-numeric:tabular-nums}
.printlinks{font-size:.9rem}
.question{margin-top:34px;padding-top:10px;border-top:1px solid var(--line)}
.qh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 4px;font-size:.78rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.ask{display:flex;gap:12px;align-items:flex-start;margin:10px 0 6px}
.ask .av{flex:none;width:38px;height:38px;border-radius:50%;background:var(--soft2);display:grid;place-items:center;font-weight:700}
.bubble{background:var(--card);border:1px solid var(--line);border-radius:16px 16px 16px 4px;padding:12px 16px;font-size:1.08rem;max-width:720px}
.bubble .from{display:block;font-size:.78rem;color:var(--muted);margin-bottom:2px}
.arms{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;margin-top:14px}
.arm{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;min-width:0}
.arm .head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:10px 16px;border-bottom:1px solid var(--line)}
.arm.pod .head{border-top:4px solid var(--pod)}.arm.records .head{border-top:4px solid var(--records)}
.arm .head b{font-size:1rem}.arm.pod .head b{color:var(--pod)}.arm.records .head b{color:var(--records)}
.arm .head .how{font-size:.8rem;color:var(--muted);text-align:right}
.tabset>input{position:absolute;opacity:0;pointer-events:none}
.tabset>label{display:inline-block;margin:10px 0 0 12px;padding:5px 12px;border-radius:999px;border:1px solid var(--line);font-size:.86rem;font-weight:600;color:var(--muted);cursor:pointer}
.tabset>input:checked+label{color:var(--fg);border-color:var(--fg)}
.tabset>input:focus-visible+label{outline:2px solid var(--link)}
.tabset>.panel{display:none;padding:12px 16px 6px}
.tabset:has(>input[value=answer]:checked)>.panel[data-tab=answer],.tabset:has(>input[value=reasoning]:checked)>.panel[data-tab=reasoning],.tabset:has(>input[value=doctor]:checked)>.panel[data-tab=doctor]{display:block}
.reply{border-radius:4px 16px 16px 16px;background:var(--soft);padding:12px 14px;font-size:.95rem}
.reply p{margin:.3em 0}.reply ol{margin:.4em 0 .2em;padding-left:1.3em}.reply li{margin:.35em 0}
.reply .why{display:block;color:var(--muted);font-size:.88rem}.reply .conf{font-size:.72rem;color:var(--muted);margin-left:6px}
.cost{display:flex;flex-wrap:wrap;gap:6px 16px;padding:10px 16px 12px;font-size:.84rem;color:var(--muted);font-variant-numeric:tabular-nums;border-top:1px dashed var(--line);margin-top:10px}
.cost b{color:var(--fg);font-weight:600}.cost .shared{flex-basis:100%;font-size:.8rem}
details.item{border:1px solid var(--line);border-radius:10px;margin:8px 0;background:var(--bg)}
details.item>summary{cursor:pointer;padding:9px 12px;font-weight:600;font-size:.92rem}
details.item>.dbody{border-top:1px solid var(--line);padding:6px 12px 12px}
.chain{font-size:.9rem}.chain ul{margin:.2em 0 .6em;padding-left:1.1em}.chain li{margin:.3em 0}
.chain .ck{font-weight:800;margin-left:-1.1em;width:1.1em;display:inline-block}.chain h4.kn{color:var(--beyond)}
.gwrap .svgwrap{overflow-x:auto}
svg.graph{max-width:100%;height:auto;display:block;margin:4px 0}
.graph .edge{fill:none;stroke:var(--muted);stroke-width:1.3;opacity:.55}.graph .edge.dashed{stroke-dasharray:4 4}
.graph .node{cursor:pointer}.graph .node rect{fill:var(--card);stroke:var(--line);stroke-width:1.2}
.graph .node:hover rect,.graph .node:focus rect,.graph .node.sel rect{stroke:var(--fg);stroke-width:1.8}
.graph .node text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;fill:var(--fg)}.graph .node .l{font-size:12.5px;font-weight:600}.graph .node .s{font-size:11px;fill:var(--muted)}
.graph .node.k-item rect{fill:var(--soft2)}.graph .node.k-absence rect{fill:var(--part-bg);stroke-dasharray:4 3}
.graph .node.k-knowledge rect{fill:var(--beyond-bg);stroke:var(--beyond);stroke-dasharray:4 3}
.graph .node.k-entry rect,.graph .node.k-resource rect{fill:var(--soft)}
.graph .node.k-document rect,.graph .node.k-passage rect{fill:var(--yes-bg);stroke:var(--yes)}
.graph .node.k-query rect,.graph .node.k-sources rect,.graph .node.k-link rect{fill:var(--soft);stroke-dasharray:4 3}
.graph .node .ck{font-size:13px;font-weight:800}.graph .node .ck.ok{fill:var(--yes)}.graph .node .ck.bad{fill:var(--no)}
.arm.pod .graph .node.k-fact rect{stroke:var(--pod)}.arm.records .graph .node.k-fact rect{stroke:var(--records)}
.gpanel{margin-top:8px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--soft);font-size:.86rem;min-height:40px}
.kl{display:block;font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.gpanel pre{max-height:320px;background:var(--card)}
table.kv{border-collapse:collapse;font-size:.84rem;margin-top:6px}table.kv th{text-align:left;color:var(--muted);font-weight:500;padding:2px 10px 2px 0;vertical-align:top;white-space:nowrap}table.kv td{padding:2px 0;vertical-align:top}
.tree{display:none;list-style:none;padding-left:0;margin:6px 0;font-size:.88rem}
.tree ul{list-style:none;padding-left:14px;margin:4px 0 4px 6px;border-left:2px solid var(--line)}
.tree li{margin:4px 0}.tree summary{cursor:pointer;padding:6px 8px;border-radius:8px;background:var(--card);border:1px solid var(--line);display:block}
.tree summary b{display:block;font-weight:600}.tree summary .sub{display:block;color:var(--muted);font-size:.8rem}.tree summary .ck{float:right;font-weight:800}
.tree .ck.ok{color:var(--yes)}.tree .ck.bad{color:var(--no)}
.tree li.k-absence>details>summary,.tree li.k-knowledge>details>summary,.tree li.k-query>details>summary,.tree li.k-sources>details>summary,.tree li.k-link>details>summary{border-style:dashed}
.tree li.k-document>details>summary,.tree li.k-passage>details>summary{background:var(--yes-bg);border-color:var(--yes)}
.tree .nd{padding:6px 8px 2px;font-size:.84rem}.tree .nd:empty{display:none}
details.fold{border:1px solid var(--line);border-radius:10px;background:var(--card);margin:10px 0}
details.fold>summary{cursor:pointer;padding:12px 16px;font-weight:600;list-style:none;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
details.fold>summary::before{content:"";width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);flex:none}
details.fold[open]>summary::before{transform:rotate(45deg)}
details.fold>summary .sum{font-weight:400;color:var(--muted);font-size:.86rem}
details.fold>.body{padding:0 16px 16px}
.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--bg);font-size:.9rem}
.card header{display:grid;gap:2px;margin-bottom:6px}.card header q{quotes:"\\201C" "\\201D";font-style:italic}
.card ol{margin:.3em 0;padding-left:1.3em}.card li{margin:.4em 0}.card ul.facts{margin:.2em 0 0;padding-left:1em;font-size:.84rem}
.card .absence{color:var(--muted);font-size:.84rem}
.expect table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}
.expect th,.expect td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:.9rem}
.expect th{font-size:.78rem;color:var(--muted);font-weight:600;background:var(--soft)}.expect tr:last-child td{border-bottom:0}
.expect td.item{width:38%}.expect .why{display:block;font-size:.82rem;color:var(--muted)}.expect .said{display:block;font-size:.84rem;color:var(--muted);margin-top:3px}
.expect tr.group th{background:var(--card);color:var(--fg);font-size:.95rem;padding-top:16px}.expect tr.group th span{font-weight:400;color:var(--muted);font-size:.85rem;margin-left:6px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.two h4.pod{color:var(--pod)}.two h4.records{color:var(--records)}
table.plain{width:100%;border-collapse:collapse;font-size:.86rem}
table.plain th,table.plain td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
table.plain th{font-size:.76rem;color:var(--muted);font-weight:600}table.plain td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.foot{margin-top:40px;font-size:.8rem;color:var(--muted);border-top:1px solid var(--line);padding-top:12px}
.story{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:.92rem;margin:10px 0}.story dt{color:var(--muted)}.story dd{margin:0}
.printpage .card{margin:0 0 14px;break-inside:avoid;background:var(--card)}
@media (max-width:900px){.runrow{grid-template-columns:1fr}}
@media (max-width:780px){
 main{padding:12px 14px 64px}
 .arms,.two{grid-template-columns:1fr}
 .svgwrap{display:none}.tree{display:block}
 .arm .head{flex-direction:column;align-items:flex-start}.arm .head .how{text-align:left}
 .expect table,.expect thead,.expect tbody,.expect tr,.expect td,.expect th{display:block}.expect thead{display:none}
 .expect td{border:0;padding:4px 12px;width:auto !important}
 .expect td[data-arm]::before{content:attr(data-arm);display:block;font-size:.74rem;color:var(--muted);font-weight:600;text-transform:uppercase}
 .story{grid-template-columns:1fr;gap:2px 0}
}
@media print{
 :root,:root[data-theme=dark]{--bg:#fff;--fg:#000;--muted:#444;--line:#999;--card:#fff;--soft:#fff}
 .noprint,.top,.foot{display:none !important}
 body{font-size:12pt}main{max-width:none;padding:0}
 .card{border:1px solid #000;break-inside:avoid;page-break-inside:avoid}
 a{color:inherit;text-decoration:none}
}
`;

export const SCRIPT = `
(function(){
  var root=document.documentElement;
  var saved=localStorage.getItem('theme'); if(saved) root.setAttribute('data-theme',saved);
  var q=new URLSearchParams(location.search).get('theme'); if(q==='dark'||q==='light') root.setAttribute('data-theme',q);
  var t=document.getElementById('theme');
  function dark(){var c=root.getAttribute('data-theme'); return c? c==='dark' : matchMedia('(prefers-color-scheme: dark)').matches;}
  function label(){ if(t) t.textContent = dark()?'Light':'Dark'; }
  if(t){ label(); t.addEventListener('click',function(){ var next=dark()?'light':'dark'; root.setAttribute('data-theme',next); localStorage.setItem('theme',next); label(); }); }
  function show(node){
    var wrap=node.closest('.gwrap'), id=node.getAttribute('data-id'), panel=wrap.querySelector('.gpanel'), d=null;
    wrap.querySelectorAll('svg.graph .node.sel').forEach(function(x){x.classList.remove('sel')}); node.classList.add('sel');
    wrap.querySelectorAll('.ndetail').forEach(function(x){ if(x.getAttribute('data-id')===id) d=x; });
    panel.innerHTML = d ? d.innerHTML : '';
  }
  document.querySelectorAll('svg.graph .node').forEach(function(n){
    n.addEventListener('click',function(){show(n)});
    n.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); show(n); } });
  });
  var open=new URLSearchParams(location.search).get('open');
  if(open){var el=document.getElementById(open); if(el){ el.open=true; var s=el.closest('.question'); if(s) s.scrollIntoView(); }}
})();
`;
