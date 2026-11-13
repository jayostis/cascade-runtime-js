import { type Html, markup } from "./html.js";
import type { Site } from "./site.js";
import { EXPLORER_FILE } from "./explorer.js";

export const EXPLORER_SCRIPT_FILE = "explorer.js";
export const EXPLORER_STYLE_FILE = "explorer.css";

/**
 * The explorer's page: the pod's index. The app in `explorer.js` is the same on every pod; it reads `explorer.json` and
 * fetches a node's own file (`pod/<path>`, `queries/<path>`) when the node opens. The app is a string, not a module
 * compiled with the package, because the page loads it as it is: it holds no backtick and no `${`.
 */
export function explorerPage(site: Site, nav: Html): Html {
  const front = site.options.front;
  return markup`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Explorer · ${site.pod.title}</title>
<link rel="stylesheet" href="site.css">
<link rel="stylesheet" href="${EXPLORER_STYLE_FILE}">
</head>
<body class="explorer">
${nav}
<main>
<div id="explorer" data-data="${EXPLORER_FILE}"><p class="loading">Loading ${site.pod.title}.</p></div>
<noscript><p>The explorer needs script. The pod's files are listed in <a href="${EXPLORER_FILE}">${EXPLORER_FILE}</a>,
and <a href="layout.html">how the pod is laid out</a> reads without it.</p></noscript>
</main>
<footer>
<a href="layout.html">How the pod is laid out</a>
<a href="pipeline.html">How a view is built</a>
<a href="not-shown.html">Not shown</a>
<a href="${EXPLORER_FILE}">${EXPLORER_FILE}</a>
${front !== undefined && markup`<a href="${front}">Cascade pods</a>`}
</footer>
<script src="${EXPLORER_SCRIPT_FILE}"></script>
</body>
</html>
`;
}

export const EXPLORER_SCRIPT = String.raw`'use strict';
(function () {
var root = document.getElementById('explorer');
var D, F, Q, END, answers, byThing, labels, viewDir, storedIn, builtIn, readSets, bytesOf, shownAct = -1;
var state = { sel: 'p:', step: 0, open: { 'p:': 1, 'q:': 1 }, pane: 'ins', filter: '' };
var KIND = { bytes: 'source bytes', revision: 'revision', version: 'version', record: 'record', judgment: 'judgment', assertion: 'matcher assertion', retraction: 'retraction', import: 'import', session: 'hand-entry session', matcherrun: 'matcher run', act: 'act', document: 'document', series: 'reference series', subject: 'subject', profile: 'profile', preferences: 'preferences', typeindex: 'type index', manifest: 'manifest', view: 'materialized view', built: 'built file', other: 'file' };
var FIXED = {
  pod: 'A pod is a directory of files on a server the person controls. What its sources told it is kept as it arrived, decisions about it are kept apart, and what an app reads is built from both by queries and can be built again.',
  twoRoots: 'Two directories are shown. The first is the pod. The second is not in the pod: it is the vocabulary’s queries, which a runtime runs over the pod’s files.',
  log: 'The pod keeps its own history. Each act that changes it (an import, a hand-entry session, a matcher run) leaves a snapshot in its own file under provenance/, naming the files it wrote and the snapshot before it. The manifest names the latest snapshot, so the log is read by walking back from there. A person’s judgment is named by no snapshot: it carries its own time, and is placed by it.',
  step: 'Pick an act to see the pod after it. Files written later are hidden; files the act wrote are marked.',
  built: 'The build writes this file after every act, from the pod’s other files. It is never a source: deleting it loses nothing.',
  views: 'A view is two things. Its definition is a CONSTRUCT query in the vocabulary. Its file is what that query wrote the last time the build ran. An app reads the file; the runtime runs the definition.',
  shard: 'Files in this folder sit in two-character folders named from the start of the file’s name. They only spread the files out; the tree shows them as a prefix of the name.',
  logTime: 'A person’s judgment is named by no snapshot. It carries its own time, and is placed in the log by it.',
  logNone: 'These files are named by no act and carry no time: they were there when the pod was made.',
  pipeline: 'The build loads the pod’s stored files, then runs the derivations in a fixed order. Each is a CONSTRUCT that adds statements to the derived state, which the next can read; that state is never written to the pod. The view definitions then read it and write the files of the views’ folder. Click a box.',
  readBy: 'Approximate: the queries whose WHERE names a term that the files here use, the most terms in common first. A term many files use is left out; so are the matcher’s and table queries, a file’s own writer, and, for a file the build writes, every query but the questions and the labels query. A trace of the run would be exact.'
};
var TAGS = {
  pod: 'What the pod’s own files say',
  vocabulary: 'The label or comment the vocabulary gives a term',
  query: 'Rows an answer returned, or a query’s own text',
  layout: 'What the vocabulary’s layout file says of where files go',
  kit: 'What the kit’s feature file says',
  fixed: 'The same words on every pod'
};

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function tag(kind, why) { return '<span class="src ' + kind + '" title="' + esc(why || TAGS[kind] || '') + '">' + kind + '</span>'; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
function termLabel(c) { var t = D.terms[c]; return (t && t.label) || String(c).split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }
function term(c) { return '<i class="term" data-term="' + esc(c) + '" title="' + esc(c) + '">' + esc(termLabel(c)) + '</i>'; }
function shortName(n) { return n.replace(/^([0-9a-f]{8})[0-9a-f-]{20,}(\.\w+)?$/, '$1…$2'); }
function shortPath(p) { return p.split('/').map(shortName).join('/'); }
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(iso) {
  if (!iso) return '';
  var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
  return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
function first(text) {
  if (!text) return '';
  var m = text.match(/^(.{20,260}?[.:])(\s|$)/), s = m ? m[1] : text;
  return s.length > 270 ? s.slice(0, 267) + '…' : s;
}
function vocabulary(c) {
  var t = c && D.terms[c];
  return t && t.comment ? '<p class="gen"><b>' + esc(t.label || c) + '</b> ' + esc(t.comment.length > 520 ? t.comment.slice(0, 517) + '…' : t.comment) + tag('vocabulary', 'rdfs:comment in the vocabulary') + '</p>' : '';
}
function fixed(k) { return '<p class="fx">' + esc(FIXED[k]) + tag('fixed', 'The same words on every pod') + '</p>'; }

function svg(d, cls) { return '<svg class="' + cls + '" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + d + '</svg>'; }
var SHEET = '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>';
var ICON = {
  dir: svg('<path d="M1.5 4.2c0-.6.4-1 1-1h3.2l1.4 1.5h6.4c.6 0 1 .4 1 1v6.8c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z" fill="currentColor" fill-opacity=".22"/>', 'folder closed'),
  open: svg('<path d="M1.5 12.5V4.2c0-.6.4-1 1-1h3.2l1.4 1.5h5.4c.6 0 1 .4 1 1V7"/><path d="M1.5 12.5 3.3 7.6c.1-.4.5-.6.9-.6h9.9c.6 0 1 .6.8 1.2l-1.4 3.7c-.1.4-.5.6-.9.6z" fill="currentColor" fill-opacity=".22"/>', 'folder open'),
  file: svg(SHEET + '<path d="M5.5 8h5M5.5 10.5h5" stroke-width="1"/>', 'doc'),
  built: svg('<path d="M3.5 1.5h6l3 3v10h-9z" fill="currentColor" fill-opacity=".14"/><path d="M9.5 1.5v3h3"/><path d="M5.8 10.2a2.3 2.3 0 1 0 .5-2.5M5.5 6.8v1.3h1.3" stroke-width="1.1"/>', 'doc built'),
  bytes: svg(SHEET + '<path d="M5.8 8.5v3M8 8.5v3M10.2 8.5v3" stroke-width="1.1"/>', 'doc bytes'),
  rq: svg(SHEET + '<path d="M6.5 8 5 9.7l1.5 1.7M9.5 8l1.5 1.7-1.5 1.7" stroke-width="1.1"/>', 'doc query')
};
function iconOf(f) { return f.kind === 'bytes' ? ICON.bytes : f.writer === 'build' ? ICON.built : ICON.file; }

function exists(f) { return f.writer === 'build' || f.writer <= state.step; }
function isNew(f) { return f.writer === state.step && state.step > 0; }

/* the two trees: a folder is { id, name, dirs: Map, files: [] } */
function makeTree(items, pathOf, prefix) {
  var top = { id: prefix, name: '', dirs: new Map(), files: [] };
  items.forEach(function (it) {
    var parts = pathOf(it).split('/'), base = parts.pop(), shard = null;
    if (parts.length && /^[0-9a-f]{2}$/.test(parts[parts.length - 1]) && base.indexOf(parts[parts.length - 1]) === 0) shard = parts.pop();
    var d = top, id = prefix;
    parts.forEach(function (s) {
      id += s + '/';
      if (!d.dirs.has(s)) d.dirs.set(s, { id: id, name: s, dirs: new Map(), files: [] });
      d = d.dirs.get(s);
    });
    if (shard) d.shard = true;
    d.files.push({ it: it, shard: shard, base: base });
  });
  return top;
}
var podTree, queryTree, dirs = new Map();
function indexDirs(d) { dirs.set(d.id, d); d.dirs.forEach(indexDirs); }
function allFiles(d) {
  var out = d.files.map(function (x) { return x.it; });
  d.dirs.forEach(function (s) { out = out.concat(allFiles(s)); });
  return out;
}
function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
function ownedBy(path) { return D.queries.findIndex(function (q) { return q.path === path; }); }
function fileId(i) { return 'p:' + D.files[i].path; }
function queryId(i) { return 'q:' + D.queries[i].path; }

function row(id, depth, cls, twisty, icon, name, label, right) {
  return '<div class="row ' + cls + (state.sel === id ? ' sel' : '') + '" data-go="' + esc(id) + '" style="padding-left:' + (6 + depth * 14) + 'px" title="' + esc(id.slice(2)) + '">' +
    '<span class="tw"' + (twisty ? ' data-tw="' + esc(id) + '"' : '') + '>' + twisty + '</span><span class="ic">' + icon + '</span><span class="nm">' + name + '</span><span class="lb">' + esc(label || '') + '</span>' + (right || '') + '</div>';
}
function treeHtml() {
  var out = [], flt = state.filter.trim().toLowerCase();
  function walk(d, depth, isQuery) {
    Array.from(d.dirs.values()).sort(byName).forEach(function (sub) {
      var vis = isQuery ? allFiles(sub) : allFiles(sub).filter(exists);
      if (!vis.length) return;
      var fresh = !isQuery && vis.some(isNew), open = state.open[sub.id];
      out.push(row(sub.id, depth, 'dir', open ? '▾' : '▸', open ? ICON.open : ICON.dir, esc(sub.name) + '/', '', (fresh ? '<span class="dot" title="The selected act wrote here"></span>' : '') + '<span class="ct">' + vis.length + '</span>'));
      if (open) walk(sub, depth + 1, isQuery);
    });
    d.files.slice().sort(function (a, b) { var x = (a.shard || '') + a.base, y = (b.shard || '') + b.base; return x < y ? -1 : x > y ? 1 : 0; }).forEach(function (x) {
      if (isQuery) {
        out.push(row('q:' + x.it.path, depth, 'file', '', ICON.rq, esc(x.base), '', x.it.order != null ? '<span class="ct" title="Place in the build’s order">' + (x.it.order + 1) + '</span>' : ''));
      } else if (exists(x.it)) {
        out.push(row('p:' + x.it.path, depth, 'file' + (x.it.writer === 'build' ? ' built' : ''), '', iconOf(x.it), (x.shard ? '<span class="sh">' + x.shard + '/</span>' : '') + esc(shortName(x.base)), x.it.label, isNew(x.it) ? '<span class="dot" title="Written by the selected act"></span>' : ''));
      }
    });
  }
  var shown = D.files.filter(exists).length;
  out.push('<div class="root-h' + (state.sel === 'p:' ? ' sel' : '') + '" data-go="p:"><span class="tw" data-tw="p:">' + (state.open['p:'] ? '▾' : '▸') + '</span><span class="nm">' + esc(D.pod.address) + '</span><small>the pod · ' + shown + ' files</small></div>');
  if (flt) {
    D.files.forEach(function (f) { if (exists(f) && (f.path.toLowerCase().indexOf(flt) >= 0 || (f.label || '').toLowerCase().indexOf(flt) >= 0)) out.push(row('p:' + f.path, 0, 'file' + (f.writer === 'build' ? ' built' : ''), '', iconOf(f), esc(shortPath(f.path)), f.label, '')); });
  } else if (state.open['p:']) walk(podTree, 0, false);
  out.push('<div class="root-h' + (state.sel === 'q:' ? ' sel' : '') + '" data-go="q:"><span class="tw" data-tw="q:">' + (state.open['q:'] ? '▾' : '▸') + '</span><span class="nm">cascade-vocabulary/queries/</span><small>not in the pod · ' + D.queries.length + ' queries</small></div>');
  if (flt) {
    D.queries.forEach(function (q) { if (q.path.toLowerCase().indexOf(flt) >= 0) out.push(row('q:' + q.path, 0, 'file', '', ICON.rq, esc(q.path.replace(/^queries\//, '')), '', '')); });
  } else if (state.open['q:']) {
    var top = queryTree.dirs.get('queries');
    if (top) walk(top, 0, true);
  }
  return out.join('');
}

/* the log */
function actTitle(r) {
  if (r.how === 'making') return 'The pod’s making';
  if (r.how === 'time') return r.label || 'A person’s judgments';
  if (r.label && r.type) return termLabel(r.type) + ' · ' + r.label;
  return r.label || (r.type ? termLabel(r.type) : 'An act');
}
function logHtml() {
  return D.log.map(function (r, i) {
    var kit = r.kitSteps.map(function (k) { return '<span class="pill kit' + (k.performed ? '' : ' warn') + '" title="' + esc(k.performed ? 'A step of the kit' : 'The kit does this step; the pod holds no act at its time') + '">' + esc(k.name) + (k.performed ? '' : '?') + '</span>'; }).join('');
    var cases = D.kit ? D.kit.cases.filter(function (c) { return c.row === i; }) : [];
    return '<div class="act' + (i === state.step ? ' cur' : '') + (i > state.step ? ' later' : '') + '" data-step="' + i + '">' +
      '<div class="n">' + i + '</div><div><div class="when">' + (r.time ? fmt(r.time) : '—') + (r.how === 'snapshot' ? ' <span class="chainmark" title="Leaves a snapshot">◆</span>' : '') + '</div>' +
      '<div class="what">' + esc(actTitle(r)) + '</div>' +
      '<div class="meta"><span class="pill new">+' + plural(r.wrote.length, 'file') + '</span>' + (r.missing.length ? '<span class="pill warn" title="Files the snapshot names that the pod does not hold">' + r.missing.length + ' missing</span>' : '') + kit + (cases.length ? '<span class="pill" title="Kit cases checked after this row">' + cases.map(function (c) { return esc(c.id || c.rule); }).filter(function (x, j, all) { return all.indexOf(x) === j; }).join(' ') + '</span>' : '') + '</div></div></div>';
  }).join('');
}

/* references */
function ref(id, label) {
  if (id.indexOf('p:') === 0 || id.indexOf('q:') === 0) {
    var f = id.indexOf('p:') === 0 ? F.get(id.slice(2)) : null;
    return '<a class="ref" data-go="' + esc(id) + '">' + esc(shortPath(id.slice(2))) + (label !== false && f && f.label ? ' <span class="lbl">' + esc(f.label) + '</span>' : '') + '</a>';
  }
  return esc(id);
}
function fileRef(i) { var f = D.files[i]; return ref('p:' + f.path, true); }
function list(items, cap) {
  cap = cap || 8;
  return '<ul class="list">' + items.slice(0, cap).map(function (x) { return '<li>' + x + '</li>'; }).join('') + (items.length > cap ? '<li class="more">and ' + (items.length - cap) + ' more</li>' : '') + '</ul>';
}
function actRef(i) {
  var r = D.log[i];
  return '<a data-step="' + i + '">act ' + i + ' · ' + esc(actTitle(r)) + (r.time ? ' · ' + esc(fmt(r.time)) : '') + '</a>';
}
function writtenBy(f) {
  if (f.writer === 'build') {
    var q = f.writtenBy != null ? D.queries[f.writtenBy] : null;
    return '<span class="pill built">rebuilt</span> by the build' + (q ? ', from ' + ref(queryId(f.writtenBy), false) : '') + '<br><span class="lbl">after every act; shown as of the last build</span>';
  }
  if (f.writer === 0) return 'the pod’s making<br><span class="lbl">no act names it and it carries no time</span>';
  return actRef(f.writer);
}
function section(title, body) { return '<h3>' + title + '</h3>' + body; }
function three(titles, a, b, c) {
  return '<div class="cards">' + [a, b, c].map(function (body, i) { return '<div class="card"><h4>' + titles[i] + '</h4>' + body + '</div>'; }).join('') + '</div>';
}
var FILE_CARDS = ['Written by', 'Read by', 'Names and is named by'];
var DIR_CARDS = ['Written by', 'Read by', 'Contains'];
var QUERY_CARDS = ['Output', 'Reads', 'Writes'];
function none(text) { return '<span class="lbl">' + text + '</span>'; }

/* the queries whose WHERE names a term the files use: approximate, as nothing records which query read which file. A built file is read only by the questions and the labels query, a matcher or tables query reads none, a file's own writer does not read it, and a term that many files use says nothing of one. */
function topFolder(f) { var i = f.path.indexOf('/'); return i < 0 ? '' : f.path.slice(0, i); }
function indexTerms() {
  storedIn = new Map(); builtIn = new Map();
  D.files.forEach(function (f) {
    (f.terms || []).forEach(function (i) {
      var t = D.termList[i];
      if (f.writer === 'build') builtIn.set(t, (builtIn.get(t) || 0) + 1);
      else { if (!storedIn.has(t)) storedIn.set(t, new Set()); storedIn.get(t).add(topFolder(f)); }
    });
  });
  readSets = D.queries.map(function (q) { return new Set(q.reads); });
}
function mayRead(q, built) { return q.group !== 'matcher' && q.group !== 'tables' && (!built || q.group.indexOf('questions/') === 0 || q.path === 'queries/labels.rq'); }
function readByHtml(files) {
  var own = new Set(files.map(function (f) { return D.files.indexOf(f); })), shared = new Map(), found = [];
  files.forEach(function (f) {
    var built = f.writer === 'build';
    (f.terms || []).forEach(function (i) {
      var t = D.termList[i];
      if (built ? builtIn.get(t) > 2 : storedIn.get(t).size >= 3) return;
      D.queries.forEach(function (q, qi) {
        if (!mayRead(q, built) || (q.file != null && own.has(q.file)) || !readSets[qi].has(t)) return;
        if (!shared.has(qi)) shared.set(qi, new Set());
        shared.get(qi).add(t);
      });
    });
  });
  shared.forEach(function (ts, qi) { found.push({ qi: qi, shared: Array.from(ts) }); });
  found.sort(function (a, b) { return b.shared.length - a.shared.length || (D.queries[a.qi].path < D.queries[b.qi].path ? -1 : 1); });
  var note = '<p class="lbl">' + esc(FIXED.readBy) + tag('fixed') + '</p>';
  if (!found.length) return none('No query’s WHERE names a term used here.') + note;
  return list(found.map(function (x) {
    return '<a class="ref" data-go="' + esc(queryId(x.qi)) + '" title="' + esc(x.shared.join(', ')) + '">' + esc(D.queries[x.qi].path.replace(/^queries\//, '')) + '</a> <span class="lbl" title="Terms it shares">' + x.shared.length + '</span>';
  }), 8) + note;
}

/* inspector */
function crumbs(id) {
  if (id === '~log') return '<nav class="crumbs"><a data-go="p:">the pod</a> / log / <b>act ' + state.step + '</b></nav>';
  var kind = id.slice(0, 2), path = id.slice(2), parts = path.split('/').filter(Boolean), acc = kind, out = ['<a data-go="' + kind + '">' + (kind === 'p:' ? 'the pod' : 'cascade-vocabulary') + '</a>'];
  parts.forEach(function (p, i) {
    acc += p + (i < parts.length - 1 || path.slice(-1) === '/' ? '/' : '');
    out.push(i === parts.length - 1 ? '<b>' + esc(shortName(p)) + '</b>' : '<a data-go="' + esc(acc) + '">' + esc(p) + '</a>');
  });
  return '<nav class="crumbs">' + out.join(' / ') + '</nav>';
}
/* stored files, the lens, the derivations, the view definitions, the views' folder: each box opens its folder */
function flowHtml() {
  var n = function (p) { return D.files.filter(function (f) { return f.path.indexOf(p) === 0 && exists(f); }).length; };
  var made = D.files.filter(function (f) { return f.kind === 'view'; });
  var viewDir = made.length ? made[0].path.split('/')[0] + '/' : null;
  var der = D.queries.filter(function (q) { return q.group === 'derivations' && q.order != null; });
  var vq = D.queries.filter(function (q) { return q.group === 'views'; });
  var box = function (id, cls, pre, name, text) { return '<div class="box ' + cls + '" data-go="' + esc(id) + '" role="link" tabindex="0"><b>' + (pre ? '<small>' + pre + '</small>' : '') + esc(name) + '</b><span>' + text + '</span></div>'; };
  var col = function (cap, inner) { return inner ? '<div class="col"><div class="cap">' + cap + '</div>' + inner + '</div>' : ''; };
  var stored = [['records/', ': records, revisions and versions'], ['judgments/', ''], ['references/', '']].filter(function (s) { return dirs.has('p:' + s[0]); }).map(function (s) { return box('p:' + s[0], '', '', s[0], plural(n(s[0]), 'file') + s[1]); }).join('');
  var cols = [
    col('stored in the pod', stored),
    col('the lens', dirs.has('q:queries/lenses/') ? box('q:queries/lenses/', 'q', 'queries/', 'lenses/', 'in use: <b>' + esc(D.pod.lens) + '</b>. Decides which judgments count') : ''),
    col('derived state, in no file', dirs.has('q:queries/derivations/') ? box('q:queries/derivations/', 'q', 'queries/', 'derivations/', plural(der.length, 'CONSTRUCT') + ' in a fixed order; ' + der.filter(function (q) { return q.added && q.added.length; }).length + ' of them added statements on this pod') : ''),
    col('view definitions', dirs.has('q:queries/views/') ? box('q:queries/views/', 'q', 'queries/', 'views/', plural(vq.length, 'CONSTRUCT') + '; ' + vq.filter(function (q) { return q.file != null; }).length + ' of them wrote a file on this pod') : ''),
    col('materialized views', viewDir && dirs.has('p:' + viewDir) ? box('p:' + viewDir, 'built', '', viewDir, plural(made.length, 'file') + ', ' + plural(D.views.reduce(function (t, v) { return t + v.entries.length; }, 0), 'entry', 'entries') + ', rebuilt after every act. What an app reads') : '')
  ].filter(Boolean);
  return '<div class="flow">' + cols.join('<div class="arr">→</div>') + '</div>';
}
function rootPanel() {
  var vis = D.files.filter(exists), c = function (k) { return vis.filter(function (f) { return f.kind === k; }).length; };
  var rows = Array.from(podTree.dirs.values()).sort(byName).map(function (d) {
    var all = allFiles(d).filter(exists);
    if (!all.length) return '';
    var cls = D.placements.filter(function (p) { return p.folder && p.folder.indexOf(d.id.slice(2)) === 0 && p['class']; }).map(function (p) { return p['class']; });
    cls = cls.filter(function (x, i) { return cls.indexOf(x) === i; });
    var acts = all.map(function (f) { return f.writer; }).filter(function (w, i, a) { return typeof w === 'number' && a.indexOf(w) === i; });
    return '<tr><td>' + ref(d.id, false) + '</td><td>' + cls.slice(0, 5).map(term).join(', ') + (cls.length > 5 ? ' +' + (cls.length - 5) : '') + '</td><td class="num">' + all.length + '</td><td>' + (all.every(function (f) { return f.writer === 'build'; }) ? '<span class="pill built">rebuilt</span>' : plural(acts.length, 'act')) + '</td></tr>';
  });
  var views = D.views.map(function (v) {
    var q = D.queries[v.query], file = v.fileIndex != null ? D.files[v.fileIndex] : null;
    return '<tr' + (file ? '' : ' class="dim"') + '><td>' + ref('q:' + q.path, false) + '</td><td class="arr">→</td><td>' + (file ? ref('p:' + file.path, false) + ' <span class="lbl">' + plural(v.entries.length, 'entry', 'entries') + '</span>' : 'not written: the pod holds nothing of its kind') + '</td></tr>';
  });
  return '<h1>' + esc(D.pod.title) + '</h1><p class="sub mono">' + esc(D.pod.address) + '</p>' +
    '<p class="gen">' + (state.step === END ? 'As published' : 'After act ' + state.step + ' of ' + END) + ': <b>' + vis.length + '</b> files. <b>' + c('record') + '</b> ' + (c('record') === 1 ? 'record' : 'records') + ', <b>' + c('revision') + '</b> ' + (c('revision') === 1 ? 'revision' : 'revisions') + ', <b>' + c('version') + '</b> ' + (c('version') === 1 ? 'version' : 'versions') + ', <b>' + c('judgment') + '</b> ' + (c('judgment') === 1 ? 'judgment' : 'judgments') + '.' + tag('pod') + '</p>' +
    fixed('pod') +
    section('How it fits together <span>· click a box</span>', flowHtml() + fixed('pipeline')) +
    section('The directory', '<div class="tw-x"><table class="dirs"><thead><tr><th>path</th><th>the layout files here</th><th class="num">files</th><th>written by</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div><p class="gen">What is filed where is stated in <code>runtime/pod-layout.ttl</code>.' + tag('layout') + '</p>' + fixed('twoRoots')) +
    section('Views, both meanings', fixed('views') + '<div class="tw-x"><table class="vmap"><thead><tr><th>definition (vocabulary)</th><th></th><th>file (this pod, last build)</th></tr></thead><tbody>' + views.join('') + '</tbody></table></div>') +
    section('This build', '<dl class="kv"><dt>manifest</dt><dd>' + fileRef(D.pod.manifest) + (D.pod.created ? ' · created ' + esc(fmt(D.pod.created)) : '') + '</dd><dt>lens</dt><dd>' + esc(D.pod.lens) + '</dd>' + (D.pod.runtime ? '<dt>runtime</dt><dd>' + esc(D.pod.runtime) + '</dd>' : '') + (D.pod.head ? '<dt>latest snapshot</dt><dd class="mono">' + esc(D.pod.head) + '</dd>' : '') + (D.pod.brokenAt ? '<dt>broken at</dt><dd class="mono">' + esc(D.pod.brokenAt) + '</dd>' : '') + '</dl>' + pageLinks());
}
function pageLinks() {
  var l = D.pod.links, out = [];
  if (l.terms) out.push('<a href="' + esc(l.terms) + '">the vocabulary’s terms</a>');
  if (l.spec) out.push('<a href="' + esc(l.spec) + '">the runtime’s rules</a>');
  if (l.front) out.push('<a href="' + esc(l.front) + '">Cascade pods</a>');
  out.push('<a href="pipeline.html">how a view is built</a>', '<a href="layout.html">how the pod is laid out</a>');
  return '<p class="gen">' + out.join(' · ') + '</p>';
}
function dirPanel(id) {
  var d = dirs.get(id);
  if (!d) return '<h1 class="path">' + esc(id.slice(2)) + '</h1><p>No such folder.</p>';
  var path = id.slice(2), vis = allFiles(d).filter(exists), fresh = vis.filter(isNew);
  var places = D.placements.filter(function (p) { return p.folder === path; });
  var h = '<h1 class="path">' + esc(path) + '</h1><div class="chips"><span class="pill">folder</span><span class="pill">' + plural(vis.length, 'file') + (state.step === END ? '' : ' after act ' + state.step) + '</span>' + (fresh.length ? '<span class="pill new">' + fresh.length + ' written by the selected act</span>' : '') + (vis.length && vis.every(function (f) { return f.writer === 'build'; }) ? '<span class="pill built">rebuilt</span>' : '') + '</div>';
  places.forEach(function (p) {
    h += (p['class'] ? vocabulary(p['class']) || '<p class="gen">Holds ' + term(p['class']) + '.' + tag('layout') + '</p>' : '') + (p.title ? '<p class="gen">' + esc(p.title) + tag('layout') + '</p>' : '') + (p.storesBytes ? '<p class="gen">Holds bytes, not Turtle.' + tag('layout') + '</p>' : '') + (p.holdsRecords ? '<p class="gen">Holds records: a record’s revisions and versions are filed beside it.' + tag('layout') + '</p>' : '');
  });
  if (d.shard) h += fixed('shard');
  var acts = [], writers = new Map(), queries = [];
  vis.forEach(function (f) {
    if (typeof f.writer === 'number') writers.set(f.writer, (writers.get(f.writer) || 0) + 1);
    if (f.writtenBy != null && queries.indexOf(f.writtenBy) < 0) queries.push(f.writtenBy);
  });
  Array.from(writers.keys()).sort(function (a, b) { return a - b; }).forEach(function (r) { acts.push(actRef(r) + ' <span class="lbl">+' + writers.get(r) + '</span>'); });
  var writtenHtml = (acts.length ? list(acts, 20) : '') + queries.map(function (q) { return '<span class="pill built">rebuilt</span> ' + ref(queryId(q), false); }).join('<br>');
  var inside = Array.from(d.dirs.values()).sort(byName).filter(function (s) { return allFiles(s).some(exists); }).map(function (s) { return ref(s.id, false); });
  var direct = d.files.filter(function (x) { return exists(x.it); }).length;
  h += three(DIR_CARDS, writtenHtml || none('nothing'), readByHtml(vis), (inside.length ? list(inside, 12) : '') + (direct ? '<p class="lbl">' + plural(direct, 'file') + ' directly here</p>' : '') || none('nothing'));
  var files = vis.slice(0, 60).map(function (f) { return ref('p:' + f.path, true); });
  if (files.length) h += section('Files', list(files, 60) + (vis.length > 60 ? '<p class="gen">60 of ' + vis.length + ' shown.</p>' : ''));
  return h;
}
function turtleSection(f) {
  return '<h3>Turtle <span>· grouped by subject, with prefixes</span></h3><pre class="code turtle" id="body" data-path="' + esc(f.path) + '">Loading…</pre><div id="notes"></div>';
}
function filePanel(f) {
  var i = D.files.indexOf(f);
  var h = '<h1 class="path">' + esc(shortPath(f.path)) + '</h1>' + (f.label ? '<p class="sub">' + esc(f.label) + tag('pod', 'The label the pod gives the thing') + '</p>' : '') +
    '<div class="chips"><span class="pill">' + esc(KIND[f.kind] || f.kind) + '</span><span class="pill">' + f.bytes + ' bytes</span>' + (f.writer === 'build' ? '<span class="pill built">rebuilt</span>' : '') + (isNew(f) ? '<span class="pill new">written by the selected act</span>' : '') + (f.page ? '<a class="pill" href="' + esc(f.page) + '">its page</a>' : '') + (f.handle ? '<span class="pill" title="The id the kit gives it">' + esc(f.handle) + '</span>' : '') + '</div>';
  if (f['class']) h += vocabulary(f['class']) || '<p class="gen">Filed under ' + term(f['class']) + '.' + tag('layout') + '</p>';
  if (f.types.length) h += '<p class="gen">Types: ' + f.types.map(term).join(', ') + tag('pod') + '</p>';
  if (f.writer === 'build') h += fixed('built');
  var written = writtenBy(f);
  if (f.view != null && f.writtenBy == null) { var v = D.views[f.view]; written += '<br>Its definition: ' + ref(queryId(v.query), false) + ' <span class="lbl">' + plural(v.entries.length, 'entry', 'entries') + '</span>'; }
  var names = f.names.map(fileRef), namedBy = f.namedBy.map(fileRef);
  h += three(FILE_CARDS, written, readByHtml([f]),
    '<p class="lbl">Names:</p>' + (names.length ? list(names, 10) : none('no pod file')) + '<p class="lbl">Named by:</p>' + (namedBy.length ? list(namedBy, 10) : none('no pod file')));
  if (f.thing) h += '<dl class="kv"><dt>thing</dt><dd class="mono">' + esc(f.thing) + '</dd></dl>';
  h += turtleSection(f);
  return h;
}
function termChips(list) { return list.length ? list.map(term).join(' ') : none('none'); }
function paragraphs(text) {
  return text.split(/\n[ \t]*\n/).map(function (p) { return p.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).join(' '); }).filter(Boolean).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
}
function queryPanel(q) {
  var qi = D.queries.indexOf(q);
  var h = '<h1 class="path">' + esc(q.path.replace(/^queries\//, '')) + '</h1><div class="chips"><span class="pill">' + esc(q.form) + '</span><span class="pill">' + esc(q.group) + '</span>' + (q.order != null ? '<span class="pill kit" title="Place in the build’s order">build step ' + (q.order + 1) + '</span>' : '') + '<span class="pill outside">not in the pod</span></div>';
  h += '<pre class="code" id="head" data-path="' + esc(q.path) + '">Loading…</pre>';
  var written = q.file != null ? ref('p:' + D.files[q.file].path, true) : (q.added ? (q.added.length ? q.added.map(function (a) { return term(a[0]) + ' <b>' + a[1] + '</b>'; }).join('<br>') + '<p class="lbl">statements added to the derived state, which no file holds</p>' : none('adds nothing on this pod')) : none('writes no file'));
  var rules = (q.rules || []).map(function (r) { var m = D.matcherRules[r]; return esc(termLabel(m.rule)) + ' <span class="lbl">' + esc(m.version) + (m.by === 'hash' ? ', found by its hash' : '') + '</span>' + (m.problem ? ' <span class="pill warn">' + esc(m.problem) + '</span>' : ''); });
  h += three(QUERY_CARDS, written, '<p class="lbl">The terms its WHERE names:</p>' + termChips(q.reads), '<p class="lbl">The terms its template writes:</p>' + termChips(q.writes));
  if (rules.length) h += section('Matcher rules that name it', list(rules, 10));
  if (q.question) h += section('Answer', answerHtml(q));
  h += '<p class="gen">The query in the vocabulary: ' + (D.pod.vocabularyBlob ? '<a href="' + esc(D.pod.vocabularyBlob + q.path) + '">' + esc(q.path) + '</a>' : '<code>' + esc(q.path) + '</code>') + tag('vocabulary', 'cascade-vocabulary at the commit the site was built against') + '</p>';
  return h;
}
function answerHtml(q) {
  var lens = answers && answers[D.pod.lens], a = lens && lens[q.question];
  if (!answers) return '<p class="gen">The answer rows are in <code>answers.json</code>, which this site does not publish.</p>';
  if (!a) return '<p class="gen">No answer is kept for this question under the ' + esc(D.pod.lens) + ' lens.</p>';
  if (!a.rows.length) return '<p class="gen">No rows for this pod.</p>';
  var cols = Object.keys(a.rows[0]), shown = a.rows.slice(0, 40);
  return '<div class="tw-x"><table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + shown.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c] && typeof r[c] === 'object' ? r[c].value : r[c]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' + (a.rows.length > shown.length ? '<p class="gen">' + shown.length + ' of ' + a.rows.length + ' rows shown.' + tag('query') + '</p>' : '');
}
function inspectorHtml() {
  var id = state.sel, h = crumbs(id), path = id.slice(2);
  if (id === '~log') return h + actPanel();
  if (id === 'p:') return h + rootPanel();
  if (id === 'q:') return h + '<h1 class="path">queries/</h1><p class="fx">Every query a runtime runs over a pod: the lenses and derivations that work out the derived state, the view definitions that write clinical/, the matcher’s rules, and the questions that read the result.' + tag('fixed') + '</p>' + queryList(D.queries) + '';
  if (id.slice(-1) === '/') {
    if (id.indexOf('q:') === 0) return h + '<h1 class="path">' + esc(path) + '</h1>' + queryList(D.queries.filter(function (q) { return q.path.indexOf(path) === 0; }));
    return h + dirPanel(id);
  }
  if (id.indexOf('q:') === 0) { var q = Q.get(path); return h + (q ? queryPanel(q) : '<p>No such query.</p>'); }
  var f = F.get(path);
  return h + (f ? filePanel(f) : '<p>No such file.</p>');
}
function queryList(qs) {
  var rows = qs.slice().sort(function (a, b) { return a.path < b.path ? -1 : 1; }).slice(0, 200).map(function (q) {
    return '<tr><td class="num">' + (q.order != null ? q.order + 1 : '') + '</td><td>' + ref('q:' + q.path, false) + '</td><td>' + esc(q.group) + '</td></tr>';
  });
  return '<div class="tw-x"><table><thead><tr><th class="num">build step</th><th>query</th><th>kind</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' + (qs.length > 200 ? '<p class="gen">200 of ' + qs.length + ' shown.</p>' : '');
}

/* the act's panel: one row of the log opened */
function placeOf(path) {
  var parts = path.split('/'), base = parts.pop();
  if (parts.length && /^[0-9a-f]{2}$/.test(parts[parts.length - 1]) && base.indexOf(parts[parts.length - 1]) === 0) parts.pop();
  return parts.length ? parts.join('/') + '/' : '';
}
function actPanel() {
  var i = state.step, r = D.log[i], byFolder = new Map();
  r.wrote.forEach(function (fi) { var dir = placeOf(D.files[fi].path); if (!byFolder.has(dir)) byFolder.set(dir, []); byFolder.get(dir).push(fi); });
  var cases = D.kit ? D.kit.cases.filter(function (c) { return c.row === i; }) : [];
  var h = '<h1>Act ' + i + ' of ' + END + ': ' + esc(actTitle(r)) + '</h1><p class="sub">' + (r.time ? esc(fmt(r.time)) : 'no time of its own') + '</p>' +
    '<div class="chips"><span class="pill new">+' + plural(r.wrote.length, 'file') + '</span><span class="pill">' + plural(D.files.filter(exists).length, 'file') + ' in the pod after it</span>' + (r.how === 'snapshot' ? '<span class="pill">leaves a snapshot</span>' : '') +
    (i > 0 ? '<a class="pill" data-step="' + (i - 1) + '">← previous</a>' : '') + (i < END ? '<a class="pill" data-step="' + (i + 1) + '">next →</a><a class="pill warn back" data-step="' + END + '">back to the last act</a>' : '<span class="pill">the last act</span>') + '</div>';
  if (r.type) h += vocabulary(r.type);
  h += fixed(r.how === 'snapshot' ? 'log' : r.how === 'time' ? 'logTime' : 'logNone');
  if (r.missing.length) h += '<div class="missing" role="alert"><b>' + plural(r.missing.length, 'file') + ' the snapshot names ' + (r.missing.length === 1 ? 'is' : 'are') + ' not in the pod</b>' + tag('pod') + '<ul class="list">' + r.missing.map(function (m) { return '<li class="mono">' + esc(m) + '</li>'; }).join('') + '</ul></div>';
  if (r.how === 'snapshot') {
    var firstSnap = D.log.findIndex(function (x) { return x.how === 'snapshot'; });
    var parent = r.parent != null ? '<span class="mono">' + esc(D.log[r.parent].snapshot) + '</span> → ' + actRef(r.parent) : (i === firstSnap && D.pod.brokenAt ? '<span class="mono">' + esc(D.pod.brokenAt) + '</span> <span class="pill warn">not in the pod</span>' : 'none: the first snapshot');
    h += '<dl class="kv"><dt>the act’s file</dt><dd>' + (r.act != null ? fileRef(r.act) : none('none')) + '</dd><dt>snapshot</dt><dd class="mono">' + esc(r.snapshot) + '</dd><dt>parent snapshot</dt><dd>' + parent + '</dd><dt>set hash</dt><dd class="mono">' + esc(r.setHash) + '</dd>' + (r.informedBy != null ? '<dt>informed by</dt><dd>' + fileRef(r.informedBy) + '</dd>' : '') + '</dl>' + tag('pod');
  }
  h += '<h3>Files this act wrote <span>· ' + r.wrote.length + (r.how === 'snapshot' ? ' · named by its snapshot' : '') + '</span></h3>';
  if (!r.wrote.length) h += '<p class="gen">None.</p>';
  h += Array.from(byFolder.keys()).sort().map(function (dir) {
    var fs = byFolder.get(dir);
    return '<details class="ex"' + (byFolder.size <= 4 || fs.length <= 4 ? ' open' : '') + '><summary>' + (dir ? ref('p:' + dir, false) : 'the pod’s root') + ' <span class="pill new">+' + fs.length + '</span></summary>' + list(fs.map(fileRef), 60) + '</details>';
  }).join('');
  if (r.kitSteps.length) h += '<h3>The kit’s steps here' + (D.kit ? ' <span>· ' + esc(D.kit.name) + '</span>' : '') + '</h3><ul class="list">' + r.kitSteps.map(function (k) { return '<li><span class="pill kit' + (k.performed ? '' : ' warn') + '">' + esc(k.name) + '</span> ' + (k.performed ? 'performed: the pod holds an act at its time' : 'the kit does this step; the pod holds no act at its time') + '</li>'; }).join('') + '</ul>' + tag('kit');
  if (D.kit) h += '<h3>Kit cases checked after this row <span>· ' + cases.length + '</span></h3>' + (cases.length ? '<ul class="list">' + cases.map(function (c) { return '<li>' + (c.id ? '<b>' + esc(c.id) + '</b> ' : '') + esc(c.rule) + ' <span class="lbl">' + esc(c.example) + '</span>' + (c.after ? ' <span class="pill kit">after ' + esc(c.after) + '</span>' : '') + (c.lens ? ' <span class="pill">' + esc(c.lens) + ' lens</span>' : '') + '</li>'; }).join('') + '</ul>' + tag('kit') : '<p class="gen">None.</p>');
  return h + '<p class="fx">The views are not shown as they stood at this act: the site publishes one build, made after the last act.' + tag('fixed') + '</p>';
}

/* a file's N-Triples as Turtle: prefixes, one block per subject with the thing's label, and a numbered link wherever an IRI names another file of the pod */
var NT = /^(<[^>]*>|_:\S+)\s+(<[^>]*>)\s+(<[^>]*>|_:\S+|"(?:[^"\\]|\\.)*"(?:\^\^<[^>]*>|@[A-Za-z][A-Za-z0-9-]*)?)\s*\.$/;
var RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
var LOCAL_NAME = /^[A-Za-z](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;
var UUID = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g;
var HEX = /[0-9a-f]{12,}/g;
var MAX_OBJECTS = 10;
function curieOf(iri, used) {
  for (var p in D.prefixes) {
    var ns = D.prefixes[p];
    if (iri.indexOf(ns) === 0 && LOCAL_NAME.test(iri.slice(ns.length))) { used[p] = 1; return p + ':' + iri.slice(ns.length); }
  }
  return null;
}
function fileOfIri(iri) {
  var i = byThing.get(iri);
  if (i == null) i = byThing.get(iri.replace(/#.*$/, ''));
  if (i == null && iri.indexOf(D.pod.address) === 0) i = F.has(iri.slice(D.pod.address.length).replace(/#.*$/, '')) ? D.files.indexOf(F.get(iri.slice(D.pod.address.length).replace(/#.*$/, ''))) : null;
  return i == null ? bytesOfNi(iri) : i;
}
/* a document's subject is the SHA-256 of its bytes, which the pod stores under attachments/ by the hash in hex */
function bytesOfNi(iri) {
  var m = /^ni:\/\/\/sha-256;([A-Za-z0-9_-]{43})$/.exec(iri), bin, hex = '';
  if (!m) return null;
  try { bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/') + '='); } catch (e) { return null; }
  for (var k = 0; k < bin.length; k++) hex += ('0' + bin.charCodeAt(k).toString(16)).slice(-2);
  return bytesOf.has(hex) ? bytesOf.get(hex) : null;
}
/* one block per source line, so that a line the screen wraps hangs under its own start */
function hung(html) {
  return html.split('\n').map(function (l) { return '<span class="ln" style="--h:' + (/^ */.exec(l)[0].length + 4) + 'ch">' + l + '\n</span>'; }).join('');
}
function turtle(text, f) {
  var triples = [], lines = text.split('\n');
  for (var k = 0; k < lines.length; k++) {
    if (lines[k].trim() === '') continue;
    var m = NT.exec(lines[k].trim());
    if (!m) return null;
    triples.push([m[1], m[2], m[3]]);
  }
  if (!triples.length) return null;
  var self = D.files.indexOf(f), base = D.pod.address + f.path, used = {}, notes = new Map();
  function absolute(raw) {
    var v = raw.slice(1, -1);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)) return v;
    if (v.charAt(0) === '#') return base + v;
    try { return new URL(v, base).href; } catch (e) { return v; }
  }
  function brief(a) {
    return (a.indexOf(base + '#') === 0 ? a.slice(base.length) : a).replace(UUID, function (u) { return u.slice(0, 8) + '…'; }).replace(HEX, function (x) { return x.slice(0, 8) + '…'; });
  }
  function note(pred, path, label) {
    if (!notes.has(pred)) notes.set(pred, { n: notes.size + 1, targets: new Map() });
    notes.get(pred).targets.set(path, label);
  }
  function linked(shown, a, pred, title) {
    var idx = fileOfIri(a);
    if (idx == null || idx === self || !pred) return shown;
    var g = D.files[idx];
    note(pred, g.path, g.label || shortPath(g.path));
    return '<a data-go="' + esc('p:' + g.path) + '" title="' + esc(title || a) + '">' + shown + '</a>';
  }
  function iriHtml(raw, pred) {
    var a = absolute(raw), c = curieOf(a, used), shown = c ? esc(c) : '&lt;' + esc(brief(a)) + '&gt;';
    return linked(shown, a, pred, a);
  }
  function objectHtml(raw, pred) {
    if (raw.charAt(0) === '<') return iriHtml(raw, pred);
    if (raw.charAt(0) !== '"') return esc(raw);
    var l = /^"((?:[^"\\]|\\.)*)"(.*)$/.exec(raw), lex = l[1], rest = l[2], suffix = '';
    if (rest.indexOf('^^<') === 0) {
      var dt = rest.slice(3, -1), dc = curieOf(dt, used);
      if (dt !== 'http://www.w3.org/2001/XMLSchema#string') suffix = '^^' + (dc ? esc(dc) : '&lt;' + esc(dt) + '&gt;');
    } else suffix = esc(rest);
    var lit = '<span class="l">"' + esc(lex.length > 160 ? lex.slice(0, 157) + '…' : lex) + '"</span>' + suffix;
    if (pred && F.has(lex) && lex !== f.path) { var g = F.get(lex); note(pred, g.path, g.label || shortPath(g.path)); return '<a data-go="' + esc('p:' + g.path) + '" title="' + esc(g.path) + '">' + lit + '</a>'; }
    return lit;
  }
  var by = new Map(), order = [];
  triples.forEach(function (t) {
    if (!by.has(t[0])) { by.set(t[0], new Map()); order.push(t[0]); }
    var pm = by.get(t[0]);
    if (!pm.has(t[1])) pm.set(t[1], []);
    pm.get(t[1]).push(t[2]);
  });
  var primary = function (s) { return s.charAt(0) === '<' && absolute(s) === f.thing; };
  order = order.filter(primary).concat(order.filter(function (s) { return !primary(s); }));
  /* a subject comes before the subjects whose names extend its own: an entry before its members */
  var key = function (s) { return s.charAt(0) === '<' ? absolute(s) : s; }, placed = [];
  order.forEach(function (s) {
    var at = placed.findIndex(function (r) { return key(r) !== key(s) && key(r).indexOf(key(s)) === 0; });
    if (at < 0) placed.push(s); else placed.splice(at, 0, s);
  });
  order = placed;
  function subjectHtml(s, sa) {
    var h = sa ? iriHtml(s, null) : esc(s), bi = sa ? bytesOfNi(sa) : null;
    if (bi == null || bi === self) return h;
    var g = D.files[bi], why = 'the hash in its name';
    note(why, g.path, g.label || shortPath(g.path));
    return '<a data-go="' + esc('p:' + g.path) + '" title="' + esc('the bytes this name is the hash of') + '">' + h + '</a> <b class="num">' + notes.get(why).n + '</b>';
  }
  var blocks = order.map(function (s) {
    var sa = s.charAt(0) === '<' ? absolute(s) : null, lab = sa && labels.get(sa);
    var out = [subjectHtml(s, sa) + (lab ? '  <span class="c"># ' + esc(lab) + '</span>' : '')];
    var preds = Array.from(by.get(s).keys()).sort(function (a, b) {
      var x = a.slice(1, -1) === RDF_TYPE ? '' : a, y = b.slice(1, -1) === RDF_TYPE ? '' : b;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    preds.forEach(function (p, pi) {
      var os = by.get(s).get(p), pa = absolute(p), before = notes.has(pa), isType = pa === RDF_TYPE;
      var pc = isType ? null : curieOf(pa, used), vt = pc && D.terms[pc];
      var pn = isType ? 'a' : (vt && vt.label ? '<span title="' + esc(vt.label) + '">' : '<span>') + (pc ? esc(pc) : '&lt;' + esc(brief(pa)) + '&gt;') + '</span>';
      var shown = os.length > MAX_OBJECTS ? os.slice(0, MAX_OBJECTS - 1) : os;
      var rendered = shown.map(function (o) { return objectHtml(o, isType ? null : pa); });
      os.slice(shown.length).forEach(function (o) { objectHtml(o, isType ? null : pa); });
      var mark = notes.has(pa) && !before ? ' <b class="num">' + notes.get(pa).n + '</b>' : '';
      var end = pi === preds.length - 1 ? ' .' : ' ;', more = os.length > shown.length ? ' <span class="c"># … and ' + (os.length - shown.length) + ' more</span>' : '';
      if (rendered.length === 1) {
        var ol = shown[0].charAt(0) === '<' && labels.get(absolute(shown[0]));
        out.push('    ' + pn + ' ' + rendered[0] + end + mark + (ol ? '  <span class="c"># ' + esc(ol) + '</span>' : '') + more);
      } else {
        out.push('    ' + pn + mark);
        rendered.forEach(function (r, ri) { out.push('        ' + r + (ri === rendered.length - 1 ? end + more : ' ,')); });
      }
    });
    return out.join('\n');
  });
  var head = Object.keys(D.prefixes).filter(function (p) { return used[p]; }).map(function (p) { return '<span class="c">@prefix ' + esc(p) + ': &lt;' + esc(D.prefixes[p]) + '&gt; .</span>'; }).join('\n');
  var items = Array.from(notes.entries()).map(function (e) {
    var c = curieOf(e[0], {}), v = c && D.terms[c], targets = Array.from(e[1].targets.entries());
    return '<li><b class="num">' + e[1].n + '</b><div>' + (c ? term(c) : esc(e[0])) + ' → ' + targets.slice(0, 4).map(function (t) { return '<a data-go="' + esc('p:' + t[0]) + '">' + esc(t[1]) + '</a>'; }).join('; ') + (targets.length > 4 ? ' and ' + (targets.length - 4) + ' more' : '') + (v && v.comment ? '<span class="vc">' + esc(first(v.comment)) + tag('vocabulary') + '</span>' : '') + '</div></li>';
  });
  return { html: head + (head ? '\n\n' : '') + blocks.join('\n\n'), notes: items.length ? '<p class="gen">Numbered: the properties that point at another file of the pod. Each link opens the file.</p><ol class="notes">' + items.join('') + '</ol>' : '' };
}

/* bodies */
var cache = new Map();
function body(path) {
  if (!cache.has(path)) cache.set(path, fetch(path).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }));
  return cache.get(path);
}
function fillBodies() {
  var b = document.getElementById('body'), h = document.getElementById('head'), now = state.sel;
  if (b) {
    var f = F.get(b.dataset.path);
    if (f && f.kind === 'bytes' && f.bytes > 20000) { b.textContent = 'Source bytes, ' + f.bytes + ' bytes: not shown.'; return; }
    body('pod/' + b.dataset.path).then(function (whole) {
      if (state.sel !== now) return;
      var cut = whole.length > 60000 ? whole.lastIndexOf('\n', 60000) : -1, t = whole.length > 60000 ? whole.slice(0, cut > 0 ? cut : 60000) : whole;
      var rest = whole.length - t.length, tail = rest ? '… ' + rest + ' more characters' : '';
      var ttl = f ? turtle(t, f) : null;
      if (ttl) {
        b.innerHTML = hung(ttl.html + (tail ? '\n\n<span class="c"># ' + esc(tail) + '</span>' : ''));
        document.getElementById('notes').innerHTML = ttl.notes;
      } else b.textContent = t + (tail ? '\n' + tail : '');
    }, function () { if (state.sel === now) b.textContent = 'This file is not published beside the page.'; });
  }
  if (h) body(h.dataset.path).then(function (t) {
    if (state.sel !== now) return;
    var lines = t.split('\n'), head = [];
    for (var i = 0; i < lines.length && (lines[i].trim() === '' || lines[i].charAt(0) === '#'); i++) head.push(lines[i].replace(/^#\s?/, ''));
    var text = head.join('\n').trim();
    h.outerHTML = (text ? '<div class="prose">' + paragraphs(text) + '</div>' : '') + '<details class="ex"><summary>The query’s text</summary><pre class="code">' + esc(t) + '</pre></details>';
  }, function () { if (state.sel === now) h.textContent = 'This query is not published beside the page.'; });
}

/* page */
var STOPS = [['Pod', 'p:'], ['Log', '~log'], ['Records', 'p:records/'], ['Judgments', 'p:judgments/'], ['View definitions', 'q:queries/views/'], ['Materialized views', null], ['Queries', 'q:queries/'], ['How an app finds things', null]];
function stopTarget(s) {
  if (s[1]) return s[1];
  return s[0] === 'How an app finds things' ? 'p:' + D.files[D.pod.card].path : 'p:' + (viewDir || 'clinical/');
}
function known(id) { return id === 'p:' || id === 'q:' || id === '~log' || dirs.has(id) || F.has(id.slice(2)) || Q.has(id.slice(2)); }
function frame() {
  var legend = ['pod', 'vocabulary', 'query', 'layout', 'kit', 'fixed'].map(function (k) { return tag(k); }).join('');
  root.innerHTML = '<header class="top"><span class="brand">Pod explorer</span><span class="who">' + esc(D.pod.title) + '</span><span class="addr">' + esc(D.pod.address) + '</span><span class="legend">every label says where it is from: ' + legend + '</span></header>' +
    '<div class="bar"><div class="stops" aria-label="Stops of the demo">' + STOPS.map(function (s) { var id = stopTarget(s); return '<button class="stop" data-go="' + esc(id) + '"' + (known(id) ? '' : ' disabled title="This pod has none"') + '>' + esc(s[0]) + '</button>'; }).join('') + '</div><div class="stepline" id="stepline"></div></div>' +
    '<div class="app"><div class="tabs"><button data-pane="tree">Files</button><button data-pane="ins">Selected</button><button data-pane="log">Log</button></div>' +
    '<div class="panes"><section class="pane" data-p="tree"><h2>The pod <span>and the queries run over it</span></h2><div class="filter"><input id="flt" type="search" placeholder="Filter files and queries" aria-label="Filter files and queries"></div><div class="scroll tree" id="tree"></div></section>' +
    '<section class="pane" data-p="ins"><h2>Selected</h2><div class="scroll insp" id="ins"></div></section>' +
    '<section class="pane" data-p="log"><h2>Log <span>the pod’s own history</span></h2><div class="logctl"><button data-stepby="-1" aria-label="Previous act">◀</button><input type="range" id="rng" min="0" max="' + END + '" step="1" aria-label="Act"><button data-stepby="1" aria-label="Next act">▶</button></div><div class="scroll" id="log"></div></section></div></div>';
}
/* scrolls the log pane, and no other, so that the selected act's row is inside it */
function keepActInView(pane) {
  var row = pane.querySelector('.act.cur'), p = pane.getBoundingClientRect();
  if (!row || !p.height) return;
  var r = row.getBoundingClientRect();
  if (r.top < p.top) pane.scrollTop -= p.top - r.top;
  else if (r.bottom > p.bottom) pane.scrollTop += r.bottom - p.bottom;
}
function render() {
  document.getElementById('tree').innerHTML = treeHtml();
  var pane = document.getElementById('log'), kept = pane.scrollTop;
  pane.innerHTML = logHtml();
  pane.scrollTop = kept;
  if (shownAct !== state.step) { shownAct = state.step; keepActInView(pane); }
  document.getElementById('ins').innerHTML = inspectorHtml();
  document.getElementById('rng').value = state.step;
  var at = D.log[state.step];
  document.getElementById('stepline').innerHTML = 'Showing the pod after <b>act ' + state.step + ' of ' + END + '</b>' + (at.time ? ' · ' + esc(fmt(at.time)) : '') + ' · ' + esc(actTitle(at)) + ' · ' + D.files.filter(exists).length + ' of ' + D.files.length + ' files' + (state.step === END ? ' <span class="pill">as published</span>' : ' <a class="pill warn back" data-step="' + END + '">back to the last act</a>');
  Array.prototype.forEach.call(root.querySelectorAll('.stop'), function (b) { b.classList.toggle('on', b.dataset.go === state.sel); });
  Array.prototype.forEach.call(root.querySelectorAll('.tabs button'), function (b) { b.classList.toggle('on', b.dataset.pane === state.pane); });
  Array.prototype.forEach.call(root.querySelectorAll('.pane'), function (p) { p.classList.toggle('on', p.dataset.p === state.pane); });
  fillBodies();
}
function reveal(id) {
  if (id === '~log') return;
  var kind = id.slice(0, 2), parts = id.slice(2).split('/');
  parts.pop();
  var acc = kind;
  state.open[kind] = 1;
  parts.forEach(function (p) { acc += p + '/'; state.open[acc] = 1; });
  var f = kind === 'p:' ? F.get(id.slice(2)) : null;
  if (f && f.writer !== 'build' && f.writer > state.step) state.step = f.writer;
}
function keepAddress() {
  history.replaceState(null, '', '#' + encodeURIComponent(state.sel) + (state.step === END ? '' : '&step=' + state.step));
}
function select(id) {
  state.sel = id;
  reveal(id);
  state.pane = 'ins';
  keepAddress();
  render();
  document.getElementById('ins').scrollTop = 0;
}
function showAct(n) {
  state.step = Math.max(0, Math.min(END, n));
  state.sel = '~log';
  state.pane = 'ins';
  keepAddress();
  render();
  document.getElementById('ins').scrollTop = 0;
}
function setStep(n) {
  state.step = Math.max(0, Math.min(END, n));
  var f = state.sel.indexOf('p:') === 0 ? F.get(state.sel.slice(2)) : null;
  if (f && !exists(f)) state.sel = 'p:';
  keepAddress();
  render();
}
root.addEventListener('click', function (e) {
  var t = e.target;
  if (!(t instanceof Element)) return;
  var tw = t.closest('[data-tw]');
  if (tw) { var k = tw.dataset.tw; state.open[k] = state.open[k] ? 0 : 1; render(); return; }
  var step = t.closest('[data-step]');
  if (step) { e.preventDefault(); showAct(Number(step.dataset.step)); return; }
  var by = t.closest('[data-stepby]');
  if (by) { setStep(state.step + Number(by.dataset.stepby)); return; }
  var pane = t.closest('[data-pane]');
  if (pane) { state.pane = pane.dataset.pane; render(); return; }
  var go = t.closest('[data-go]');
  if (go) { e.preventDefault(); select(go.dataset.go); }
});
root.addEventListener('keydown', function (e) {
  var t = e.target;
  if (e.key === 'Enter' && t instanceof Element && t.getAttribute('role') === 'link') { e.preventDefault(); t.click(); }
});
root.addEventListener('input', function (e) {
  var t = e.target;
  if (t.id === 'rng') setStep(Number(t.value));
  if (t.id === 'flt') { state.filter = t.value; document.getElementById('tree').innerHTML = treeHtml(); }
});

function start(data, kept) {
  D = data; answers = kept;
  F = new Map(D.files.map(function (f) { return [f.path, f]; }));
  Q = new Map(D.queries.map(function (q) { return [q.path, q]; }));
  END = D.log.length - 1; state.step = END;
  byThing = new Map(D.files.map(function (f, i) { return [f.thing, i]; }));
  bytesOf = new Map();
  D.files.forEach(function (f, i) { var stem = f.path.split('/').pop(); if (f.kind === 'bytes' && /^[0-9a-f]{64}$/.test(stem)) bytesOf.set(stem, i); });
  indexTerms();
  labels = new Map();
  D.files.forEach(function (f) { if (f.label) { labels.set(f.thing, f.label); labels.set(D.pod.address + f.path, f.label); } });
  D.views.forEach(function (v) { v.entries.forEach(function (en) { labels.set(D.pod.address + en.id, en.label); }); });
  var made = D.files.filter(function (f) { return f.kind === 'view'; });
  viewDir = made.length ? made[0].path.split('/')[0] + '/' : null;
  podTree = makeTree(D.files, function (f) { return f.path; }, 'p:');
  queryTree = makeTree(D.queries, function (q) { return q.path; }, 'q:');
  indexDirs(podTree); indexDirs(queryTree);
  frame();
  var m = decodeURIComponent(location.hash.slice(1)).split('&step=');
  if (m[1] != null && Number(m[1]) >= 0 && Number(m[1]) <= END) state.step = Number(m[1]);
  if (m[0] && known(m[0]) && m[0].length > 2) { state.sel = m[0]; reveal(m[0]); }
  render();
}
fetch(root.dataset.data).then(function (r) { return r.json(); }).then(function (data) {
  return fetch('answers.json').then(function (r) { return r.ok ? r.json() : undefined; }, function () { return undefined; }).then(function (kept) { start(data, kept); });
}).catch(function (e) { root.innerHTML = '<p class="loading">The explorer could not load its data: ' + esc(e.message) + '</p>'; });
})();
`;

export const EXPLORER_STYLE = String.raw`body.explorer { max-width: none; padding: 0 0 0; }
body.explorer > nav { margin: 0 1rem; }
body.explorer main { margin: 0; }
body.explorer footer { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; padding: .75rem 1rem 1.25rem; border-top: 1px solid var(--rule); font-size: .9rem; }
:root { --pencil: #b4410c; --new: #1f7a4d; --new-bg: #e6f3ec; --built: #6b4fa0; --built-bg: #f0ecf7; --sel: #dcebf1; --warn-bg: #fbf3e2; --amber: #8a5a0d; --mono: ui-monospace, SFMono-Regular, Consolas, monospace; }
#explorer { font-size: 14px; line-height: 1.45; }
#explorer .app { display: grid; grid-template-rows: auto minmax(0, 1fr); height: calc(100vh - 14rem); height: calc(100dvh - 14rem); min-height: 28rem; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
#explorer .top { display: flex; align-items: center; gap: 6px 14px; padding: 8px 14px; background: var(--text); color: #fff; min-width: 0; }
#explorer .top .brand { font: 12px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: #ffb38a; white-space: nowrap; }
#explorer .top .who { font-size: 1.15rem; white-space: nowrap; }
#explorer .top .addr { font: 12.5px var(--mono); color: #c9d1d6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
#explorer .top .legend { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11.5px; color: #c9d1d6; }
#explorer .top .src { margin-left: 0; background: #fff; }
#explorer .bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; padding: 6px 14px; border-bottom: 1px solid var(--rule); background: var(--panel); }
#explorer .stops { display: flex; flex-wrap: wrap; gap: 4px; }
#explorer .stop { border: 1px solid var(--rule); background: #fff; border-radius: 3px; padding: 3px 9px; font: 12.5px system-ui, sans-serif; cursor: pointer; }
#explorer .stop:hover:not(:disabled), #explorer .stop.on { border-color: var(--pencil); }
#explorer .stop.on { background: var(--sel); }
#explorer .stop:disabled { color: var(--quiet); cursor: default; border-style: dashed; }
#explorer .bar .stepline { margin-left: auto; border: 0; padding: 0; font-size: 12.5px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
#explorer .tabs { display: none; }
#explorer .panes { display: grid; grid-template-columns: 330px minmax(0, 1fr) 330px; min-height: 0; }
#explorer .pane { min-height: 0; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--rule); }
#explorer .pane:last-child { border-right: 0; }
#explorer .pane > h2 { margin: 0; padding: 6px 12px; font: 600 11px/1.6 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--quiet); border-bottom: 1px solid var(--line); }
#explorer .pane > h2 span { font-weight: 400; text-transform: none; letter-spacing: 0; font-family: system-ui, sans-serif; font-size: 12px; }
#explorer .scroll { overflow: auto; min-height: 0; flex: 1; }
#explorer .filter { padding: 6px 8px; border-bottom: 1px solid var(--line); }
#explorer .filter input { width: 100%; box-sizing: border-box; font: 12.5px var(--mono); padding: 4px 8px; border: 1px solid var(--rule); border-radius: 3px; }
#explorer .tree { padding: 0 0 24px; font-size: 13px; }
#explorer .root-h { display: flex; align-items: center; gap: 6px; padding: 5px 8px 4px; font: 600 11px/1.5 var(--mono); color: var(--text); background: var(--panel); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); cursor: pointer; }
#explorer .root-h small { font-weight: 400; color: var(--quiet); font-family: system-ui, sans-serif; margin-left: auto; white-space: nowrap; }
#explorer .root-h .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
#explorer .root-h.sel, #explorer .row.sel { background: var(--sel); }
#explorer .ic { display: inline-flex; align-items: center; }
#explorer .ic svg { display: block; }
#explorer .row.dir .ic { color: #8a6a1c; }
#explorer .row { display: flex; align-items: center; gap: 5px; height: 24px; padding-right: 8px; cursor: pointer; white-space: nowrap; min-width: 0; }
#explorer .row:hover { background: var(--panel); }
#explorer .tw { width: 12px; flex: none; color: var(--quiet); text-align: center; }
#explorer .ic { flex: none; color: var(--quiet); }
#explorer .row.built .ic, #explorer .row.built .nm { color: var(--built); }
#explorer .nm { font: 12.5px var(--mono); overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 2ch; }
#explorer .sh { color: var(--quiet); }
#explorer .lb { color: var(--quiet); font-size: 12px; overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; min-width: 0; }
#explorer .ct { margin-left: auto; color: var(--quiet); font: 11px var(--mono); }
#explorer .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--new); flex: none; margin-left: auto; }
#explorer .dot + .ct { margin-left: 4px; }
#explorer .insp { padding: 8px 16px 32px; }
#explorer .insp h1 { font-size: 1.25rem; margin: .5rem 0 .25rem; }
#explorer .insp h1.path { font: 600 15px/1.4 var(--mono); }
#explorer .insp h3 { font-size: .95rem; margin: 1.25rem 0 .25rem; }
#explorer .crumbs { font: 12px var(--mono); color: var(--quiet); overflow-wrap: anywhere; }
#explorer .sub { color: var(--quiet); margin: 0 0 .5rem; }
#explorer .mono { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
#explorer .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: .25rem 0 .5rem; }
#explorer .pill { display: inline-block; font: 11px/17px var(--mono); padding: 0 6px; border-radius: 9px; border: 1px solid var(--rule); background: #fff; color: var(--text); }
#explorer .pill.new { background: var(--new-bg); border-color: #b9dcc8; color: var(--new); }
#explorer .pill.built { background: var(--built-bg); border-color: #d6cbea; color: var(--built); }
#explorer .pill.warn { background: var(--warn-bg); border-color: #e6d3a3; color: var(--amber); }
#explorer .pill.kit { border-color: var(--pencil); color: var(--pencil); }
#explorer .pill.outside { border-style: dashed; color: var(--quiet); }
#explorer .src { display: inline-block; margin-left: .4rem; font: 10px/14px var(--mono); padding: 0 4px; border: 1px solid var(--line); border-radius: 3px; color: var(--quiet); vertical-align: 1px; }
#explorer .src.pod { color: var(--link); border-color: var(--link); }
#explorer .src.vocabulary { color: var(--built); border-color: var(--built); }
#explorer .src.query { color: var(--new); border-color: var(--new); }
#explorer .src.layout { color: var(--amber); border-color: var(--amber); }
#explorer .src.kit { color: var(--pencil); border-color: var(--pencil); }
#explorer .src.fixed { color: var(--quiet); border-color: var(--quiet); }
#explorer .fx, #explorer .gen { margin: .4rem 0; max-width: 46rem; }
#explorer .fx { color: var(--quiet); }
#explorer .lbl { color: var(--quiet); font-size: 12px; }
#explorer .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 8px; margin: .75rem 0; }
#explorer .card { border: 1px solid var(--line); border-radius: 4px; padding: 6px 10px; min-width: 0; overflow-wrap: anywhere; }
#explorer .card h4 { margin: 0 0 4px; font: 600 11px var(--mono); text-transform: uppercase; color: var(--quiet); letter-spacing: .06em; }
#explorer .list { margin: 0; padding-left: 1.1rem; }
#explorer .list li.more { color: var(--quiet); list-style: none; margin-left: -1.1rem; }
#explorer .kv { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .9rem; margin: .5rem 0; }
#explorer .kv dt { font-weight: 600; } #explorer .kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
#explorer pre.code { background: var(--panel); padding: .6rem; border-radius: 4px; overflow: auto; max-height: 28rem; margin: .4rem 0; white-space: pre; }
#explorer pre.turtle { white-space: pre-wrap; overflow-wrap: anywhere; font: 12.5px/1.5 var(--mono); }
#explorer pre.turtle .ln { display: block; padding-left: var(--h, 0); text-indent: calc(-1 * var(--h, 0)); }
#explorer pre .c { color: var(--quiet); }
#explorer pre .l { color: #1f5f7a; }
#explorer pre a { color: var(--pencil); text-decoration: underline dotted; cursor: pointer; }
#explorer b.num { display: inline-block; min-width: 1.25em; text-align: center; font: 600 11px/1.4 var(--mono); color: #fff; background: var(--pencil); border-radius: 8px; padding: 0 3px; vertical-align: 1px; }
#explorer ol.notes { list-style: none; padding: 0; margin: 6px 0; }
#explorer ol.notes li { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 6px; padding: 3px 0; overflow-wrap: anywhere; }
#explorer ol.notes .num { align-self: start; justify-self: start; }
#explorer ol.notes .vc { display: block; color: var(--quiet); font-size: 12px; }
#explorer .missing { margin: .6rem 0; padding: .5rem .75rem; border: 2px solid #b3261e; border-radius: 4px; background: #fdecea; color: #6b1410; }
#explorer .missing ul { margin: .25rem 0 0; }
#explorer details.ex { margin: .3rem 0; }
#explorer details.ex > summary { cursor: pointer; }
#explorer .flow { display: grid; grid-template-columns: minmax(0, 1.15fr) auto minmax(0, 1fr) auto minmax(0, 1.2fr) auto minmax(0, 1fr) auto minmax(0, 1.1fr); margin: 10px 0; align-items: stretch; }
#explorer .flow .col { display: grid; gap: 4px; min-width: 0; align-content: start; }
#explorer .flow .box { border: 1px solid var(--quiet); border-radius: 3px; padding: 5px 8px; background: #fff; min-width: 0; cursor: pointer; overflow-wrap: anywhere; }
#explorer .flow .box:hover, #explorer .flow .box:focus-visible { border-color: var(--pencil); }
#explorer .flow .box.q { border-style: dashed; background: var(--panel); }
#explorer .flow .box.built { border-color: var(--built); background: var(--built-bg); }
#explorer .flow .box b { display: block; font: 500 12.5px var(--mono); }
#explorer .flow .box b small { display: block; font-size: 11px; color: var(--quiet); font-weight: 400; }
#explorer .flow .box span { display: block; font-size: 12px; color: var(--quiet); line-height: 1.35; }
#explorer .flow .box span b { display: inline; font: 600 12px system-ui, sans-serif; color: var(--text); }
#explorer .flow .cap { font: 600 10px/1.4 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--quiet); }
#explorer .flow .arr { display: flex; align-items: center; padding: 0 5px; color: var(--pencil); font: 600 15px var(--mono); }
#explorer .prose { margin: .4rem 0; max-width: 46rem; }
#explorer .prose p { margin: 0 0 .6rem; overflow-wrap: anywhere; }
#explorer i.term { font-style: normal; font-family: var(--mono); font-size: 12px; border-bottom: 1px dotted var(--quiet); }
#explorer .card i.term { display: inline-block; margin: 0 .5rem .15rem 0; }
#explorer .tw-x { overflow-x: auto; }
#explorer table .num, #explorer th.num { text-align: right; }
#explorer table.dirs td:first-child { white-space: nowrap; }
#explorer tr.dim td { color: var(--quiet); }
#explorer a[data-go], #explorer a[data-step] { cursor: pointer; }
#explorer .logctl { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--line); }
#explorer .logctl input { flex: 1; min-width: 0; accent-color: var(--pencil); }
#explorer .logctl button { border: 1px solid var(--rule); background: #fff; border-radius: 3px; padding: 2px 8px; cursor: pointer; }
#explorer .stepline { padding: 4px 10px; font-size: 12px; color: var(--quiet); border-bottom: 1px solid var(--line); }
#explorer .act { display: flex; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); cursor: pointer; }
#explorer .act:hover { background: var(--panel); }
#explorer .act.cur { background: var(--sel); }
#explorer .act.later { opacity: .5; }
#explorer .act > div:last-child { min-width: 0; }
#explorer .act .n { font: 600 12px var(--mono); color: var(--quiet); width: 1.6rem; flex: none; }
#explorer .act .when { font: 11px var(--mono); color: var(--quiet); }
#explorer .act .what { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
#explorer .act .meta { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
#explorer .loading { padding: 1rem; }
@media (max-width: 1180px) { #explorer .panes { grid-template-columns: 270px minmax(0, 1fr) 280px; } }
@media (max-width: 900px) {
  #explorer .top { flex-wrap: wrap; }
  #explorer .top .addr { flex-basis: 100%; }
  #explorer .bar .stepline { margin-left: 0; flex-basis: 100%; }
  #explorer .flow { grid-template-columns: minmax(0, 1fr); }
  #explorer .flow .arr { justify-content: center; transform: rotate(90deg); padding: 0; height: 18px; }
  #explorer .app { height: auto; min-height: 0; border: 0; }
  #explorer .tabs { display: flex; border-bottom: 1px solid var(--rule); position: sticky; top: 0; background: #fff; z-index: 2; }
  #explorer .tabs button { flex: 1; padding: 8px 0; border: 0; border-bottom: 3px solid transparent; background: none; font: 600 13px system-ui, sans-serif; }
  #explorer .tabs button.on { border-bottom-color: var(--pencil); }
  #explorer .panes { grid-template-columns: minmax(0, 1fr); }
  #explorer .pane { display: none; border-right: 0; }
  #explorer .pane.on { display: flex; }
  #explorer .scroll { overflow: visible; }
  #explorer .insp { padding: 8px 12px 24px; }
  #explorer .kv { grid-template-columns: minmax(0, 1fr); }
  body.explorer { padding: 0; }
}
`;
