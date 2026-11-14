/**
 * The hub's search box: `search.js`, which each hub page loads. It reads `search.json` the first time the box is used and
 * ranks its rows as the reader types. The script is a string, not a module compiled with the package, because the page
 * loads it as it is: it holds no backtick and no `${`. Outside a page, `module.exports.rank` is its ranking alone.
 */
export const SEARCH_SCRIPT = String.raw`'use strict';
(function () {
var SHOWN = 8;
var KIND = { term: 'Term', rule: 'Rule', decision: 'Decision', page: 'Page', eval: 'Eval' };
var ORDER = { term: 0, rule: 1, decision: 2, page: 3, eval: 4 };
var PREFIXED = /^([a-z][a-z0-9-]*):(\S+)$/;

function plain(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function pathOf(row) {
  if (row.path.indexOf('#') >= 0) return '';
  return plain(row.path.replace(/\/?index\.html$/, '').replace(/\.html$/, ''));
}

function scoreOf(row, whole, words, typed) {
  var title = plain(row.title);
  var name = title;
  if (row.kind === 'term') {
    var asked = PREFIXED.exec(whole);
    var colon = title.indexOf(':');
    name = colon < 0 ? title : title.slice(colon + 1);
    if (asked !== null) {
      if (colon < 0 || title.slice(0, colon) !== asked[1]) return 0;
      whole = asked[2];
      words = [whole];
      typed = typed.slice(asked[1].length + 1);
    }
  }
  var label = row.label === undefined ? '' : plain(row.label);
  if (name === whole) return row.title.slice(row.title.length - name.length) === typed ? 101 : 100;
  if (label === whole) return 90;
  var path = pathOf(row);
  if (path.slice(path.lastIndexOf('/') + 1) === whole) return 85;
  if (name.indexOf(whole) === 0) return 80;
  if (name.indexOf(whole) > 0) return 60;
  if (label.indexOf(whole) === 0) return 55;
  if (label.indexOf(whole) > 0) return 50;
  var all = name + ' ' + label;
  var inName = 0;
  var inPath = 0;
  for (var i = 0; i < words.length; i++) {
    if (all.indexOf(words[i]) < 0) {
      if (path.indexOf(words[i]) < 0) return 0;
      inPath++;
    } else if (name.indexOf(words[i]) >= 0) inName++;
  }
  return inPath > 0 ? 10 : 30 + inName;
}

function rank(rows, query) {
  var whole = plain(query);
  if (whole === '') return [];
  var typed = String(query).trim();
  var words = whole.split(' ');
  var scored = [];
  for (var i = 0; i < rows.length; i++) {
    var score = scoreOf(rows[i], whole, words, typed);
    if (score > 0) scored.push({ row: rows[i], score: score });
  }
  scored.sort(function (a, b) {
    return b.score - a.score || ORDER[a.row.kind] - ORDER[b.row.kind] || a.row.title.length - b.row.title.length || (a.row.path < b.row.path ? -1 : 1);
  });
  return scored.map(function (one) { return one.row; });
}

if (typeof module === 'object' && module !== null) module.exports = { rank: rank };

var form = document.querySelector('form.sx-find');
if (!form) return;
var input = form.querySelector('input');
var list = form.querySelector('ul');
var rowsAddress = form.getAttribute('data-rows');
var root = rowsAddress.slice(0, rowsAddress.length - 'search.json'.length);
var rows = null;
var loading = null;
var shown = [];
var active = -1;

function load() {
  if (loading === null)
    loading = fetch(rowsAddress)
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(
        function (found) { rows = found; },
        function (error) {
          loading = null;
          throw error;
        }
      );
  return loading;
}

function say(text) {
  list.textContent = '';
  var item = document.createElement('li');
  item.className = 'sx-find-none';
  item.textContent = text;
  list.appendChild(item);
  list.hidden = false;
  shown = [];
  active = -1;
}

function mark(at) {
  active = at;
  for (var i = 0; i < list.children.length; i++) {
    var on = i === at;
    list.children[i].setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) input.setAttribute('aria-activedescendant', list.children[i].id);
  }
  if (at < 0) input.removeAttribute('aria-activedescendant');
}

function close() {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  mark(-1);
}

function show() {
  var query = input.value;
  if (plain(query) === '') return close();
  input.setAttribute('aria-expanded', 'true');
  if (rows === null) {
    load().then(show, function () { say('The search could not be loaded.'); });
    return;
  }
  shown = rank(rows, query).slice(0, SHOWN);
  if (shown.length === 0) return say('Nothing matches “' + query.trim() + '”.');
  list.textContent = '';
  shown.forEach(function (row, at) {
    var item = document.createElement('li');
    item.id = 'sx-find-' + at;
    item.setAttribute('role', 'option');
    var link = document.createElement('a');
    link.href = root + row.path;
    link.tabIndex = -1;
    var kind = document.createElement('span');
    kind.className = 'sx-find-kind';
    kind.textContent = KIND[row.kind];
    var title = document.createElement('span');
    title.className = 'sx-find-title';
    title.textContent = row.title;
    var where = document.createElement('span');
    where.className = 'sx-find-where';
    where.textContent = row.path.replace(/#.*$/, '');
    link.appendChild(kind);
    link.appendChild(title);
    link.appendChild(where);
    item.appendChild(link);
    list.appendChild(item);
  });
  list.hidden = false;
  mark(-1);
}

function go(row) {
  if (!row) return;
  close();
  window.location.href = root + row.path;
}

form.addEventListener('submit', function (event) {
  event.preventDefault();
  if (rows !== null) return go(shown[active < 0 ? 0 : active]);
  if (plain(input.value) === '') return;
  load().then(function () { go(rank(rows, input.value)[0]); }, function () { say('The search could not be loaded.'); });
});

list.addEventListener('mousedown', function (event) { event.preventDefault(); });
list.addEventListener('click', function (event) {
  if (event.target.closest('a')) close();
});
form.addEventListener('focusout', function (event) {
  if (!form.contains(event.relatedTarget)) close();
});
window.addEventListener('hashchange', close);
input.addEventListener('input', show);
input.addEventListener('focus', function () { load().catch(function () {}); });
input.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    input.value = '';
    close();
  } else if (event.key === 'ArrowDown' && shown.length > 0) {
    event.preventDefault();
    mark((active + 1) % shown.length);
  } else if (event.key === 'ArrowUp' && shown.length > 0) {
    event.preventDefault();
    mark(active <= 0 ? shown.length - 1 : active - 1);
  }
});
document.addEventListener('click', function (event) {
  if (!form.contains(event.target)) close();
});
form.hidden = false;
})();
`;
