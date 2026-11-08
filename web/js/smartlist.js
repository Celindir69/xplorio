/* Smart playlists: editor for the rules of the Smart Playlists plugin (Volumio), over its REST endpoint
   POST /api/v1/pluginEndpoint {endpoint: 'smart_playlists', data: {action: …}}. The rules stay in the plugin,
   Xplorio only shows and edits them; a run of the plugin creates the playlist.
   Without the plugin nothing of this appears.
   Classic script, shared global scope; load order see xplorio.html. */

var SMART_DOM = typeof document !== 'undefined';
var overlaySmart = SMART_DOM && document.getElementById('overlaySmart');
var smartBody = SMART_DOM && document.getElementById('smartBody');
var smartStatus = SMART_DOM && document.getElementById('smartStatus');
var smartSaveBtn = SMART_DOM && document.getElementById('smartSave');
var smartDeleteBtn = SMART_DOM && document.getElementById('smartDelete');
var smartRules = null;            /* last answer of 'list': {max, rules: [{slot, line, name, playlist}]}; null = no plugin */
var smartEd = null;               /* the open editor: state, fields, slot */
var SMART_SORTS = [['', 'sp.sort.random'], ['mix', 'sp.sort.mix'], ['year+album+track+', 'sp.sort.album'], ['year+', 'sp.sort.year'], ['year-', 'sp.sort.yearDesc'],
                   ['added+', 'sp.sort.added'], ['artist+album+track+', 'sp.sort.artist'], ['title+', 'sp.sort.title']];
var SMART_BAD = /;|\||::/;        /* would break the rule syntax in an artist name */
var SMART_SVG = '<svg viewBox="0 0 24 24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12z"/></svg>';
var SMART_NEW_SVG = '<svg viewBox="0 0 24 24"><path d="M8 9h2.2v4.4h4.4v2.2h-4.4V20H8v-4.4H3.6v-2.2H8z"/><path d="M18 1.5l1.3 3.2 3.2 1.3-3.2 1.3L18 10.5l-1.3-3.2L13.5 6l3.2-1.3z"/><path d="M20.5 12l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>';
var TRASH_SVG = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

function smartCall(data) {
  return withTimeout(fetch('/api/v1/pluginEndpoint', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({endpoint: 'smart_playlists', data: data})
  }), data.action === 'preview' ? 200000 : 8000).then(function(r){ return r.json(); })
    .then(function(j){ return (j && j.data && typeof j.data.ok === 'boolean') ? j.data : {ok: false, error: 'offline'}; })
    .catch(function(){ return {ok: false, error: 'offline'}; });
}

/* ---------- Rule line <-> editor state ---------- */
/* state: {name, all, artists[], yFrom, yTo, orig, genres, notAlbum, recent, various, dedup, sort, limit} */
function smartEmpty() {
  return {name: '', all: false, artists: [], yFrom: '', yTo: '', orig: false, genres: '', notAlbum: '', recent: '',
          various: false, dedup: false, sort: '', limit: ''};
}

function smartLine(s) {
  var parts = [s.all ? '*' : s.artists.join(';')];
  var y = s.orig ? 'originalyear' : 'year';
  if (s.yFrom) parts.push(y + '>=' + s.yFrom);
  if (s.yTo) parts.push(y + '<=' + s.yTo);
  var genres = s.genres.split(';').map(function(g){ return g.trim(); }).filter(Boolean);
  if (genres.length) parts.push(genres.map(function(g){ return 'genre~' + g; }).join(','));
  if (s.notAlbum.trim()) parts.push('album!~' + s.notAlbum.trim());
  if (s.recent) parts.push('added<=' + s.recent);
  if (s.various) parts.push('various=true');
  if (s.dedup) parts.push('duplicate=false');
  if (s.sort) parts.push('sort=' + s.sort);
  if (s.limit) parts.push('limit=' + s.limit);
  return s.name.trim() + '::' + parts.join('|');
}

/* a rule line back into the fields; null if it uses something the fields cannot show (then only the line) */
function smartParse(line) {
  var s = smartEmpty(), i = line.indexOf('::');
  if (i < 0) return null;
  s.name = line.slice(0, i).trim();
  var segs = line.slice(i + 2).split('|').map(function(x){ return x.trim(); });
  var head = segs.shift();
  if (head === '*') s.all = true;
  else s.artists = head.split(';').map(function(a){ return a.trim(); }).filter(Boolean);
  if (!s.all && !s.artists.length) return null;
  var yKind = '', m;
  for (var k = 0; k < segs.length; k++) {
    var g = segs[k].replace(/\s*(>=|<=|!=|!~|=|~|<|>)\s*/, '$1');
    if ((m = /^(year|originalyear)(>=|<=)(\d{1,4})$/.exec(g))) {
      if (yKind && yKind !== m[1]) return null;
      yKind = m[1];
      if (m[2] === '>=') { if (s.yFrom) return null; s.yFrom = m[3]; } else { if (s.yTo) return null; s.yTo = m[3]; }
    } else if (/^genre~/.test(g) && !s.genres) {
      var list = g.split(',').map(function(x){ return x.trim(); });
      if (!list.every(function(x){ return /^genre\s*~\s*\S/.test(x); })) return null;
      s.genres = list.map(function(x){ return x.replace(/^genre\s*~\s*/, ''); }).join('; ');
    } else if ((m = /^album!~(.+)$/.exec(g)) && !s.notAlbum && m[1].indexOf(',') < 0) s.notAlbum = m[1];
    else if ((m = /^added<=(\d+)$/.exec(g)) && !s.recent) s.recent = m[1];
    else if (g === 'various=true') s.various = true;
    else if (g === 'duplicate=false') s.dedup = true;
    else if (g === 'various=false' || g === 'duplicate=true' || g === 'sort=random') { /* the defaults */ }
    else if ((m = /^sort=(.+)$/.exec(g)) && SMART_SORTS.some(function(o){ return o[0] === m[1]; })) s.sort = m[1];
    else if ((m = /^limit=(\d+)$/.exec(g))) s.limit = m[1];
    else return null;
  }
  s.orig = yKind === 'originalyear';
  return s;
}

/* name proposal from the chosen artists (or genre/years with "All artists") */
function smartNameFor(s) {
  if (s.all) {
    var g = s.genres.split(';').map(function(x){ return x.trim(); }).filter(Boolean).join(', ');
    var y = s.yFrom && s.yTo ? s.yFrom + '–' + s.yTo : s.yFrom ? s.yFrom + '+' : s.yTo ? '–' + s.yTo : '';
    return [g, y].filter(Boolean).join(' ');
  }
  var a = s.artists;
  if (a.length <= 3) return a.length > 1 ? a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1] : (a[0] || '');
  return T('sp.nameMore', {names: a.slice(0, 2).join(', '), n: a.length - 2});
}

/* ---------- Playlist overlay: badge, pen, "New smart playlist" ---------- */
function smartDecorate(items, container) {
  return smartCall({action: 'list'}).then(function(r){
    smartRules = r.ok ? r : null;
    if (!smartRules || !document.body.contains(container)) return;
    var byName = {};
    smartRules.rules.forEach(function(x){ byName[x.playlist] = x; });
    var rows = container.querySelectorAll('.plRow');
    items.forEach(function(it, i){
      var rule = byName[it.title || it.name || ''], row = rows[i];
      if (!rule || !row) return;
      row.classList.add('plSmart');
      var badge = document.createElement('span');
      badge.className = 'plSmartBadge';
      badge.title = T('sp.badge');
      badge.innerHTML = SMART_SVG;
      var nm = row.querySelector('.plName');                    /* not in the icon: the artist tile redraws it */
      nm.insertBefore(badge, nm.firstChild);
      row.appendChild(tagPenButton('tagEditMini', T('sp.edit'), function(){ openSmartEditor(rule); }));
    });
    /* the note becomes "classic playlists …", next to it + with stars for a new smart playlist */
    var bar = document.createElement('div'), hint = container.querySelector('.listLink');
    bar.className = 'plSmartBar';
    if (hint) { hint.textContent = T('sp.manageHint'); bar.appendChild(hint); }
    var add = document.createElement('div');
    add.className = 'plSmartNew';
    add.setAttribute('role', 'button');
    add.title = T('sp.new');
    add.setAttribute('aria-label', T('sp.new'));
    add.innerHTML = SMART_NEW_SVG;
    add.addEventListener('click', function(){ openSmartEditor(null); });
    bar.appendChild(add);
    container.insertBefore(bar, container.firstChild);
  });
}

/* ---------- Editor ---------- */
function smartEl(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function smartField(label, input, hint) {
  var f = smartEl('label', 'tagField');
  f.appendChild(smartEl('span', '', label));
  f.appendChild(input);
  if (hint) f.appendChild(smartEl('div', 'tagHint', hint));
  return f;
}
function smartInput(value, ph, cls) {
  var i = smartEl('input', 'tagIn' + (cls ? ' ' + cls : ''));
  i.value = value || '';
  if (ph) i.placeholder = ph;
  i.setAttribute('autocomplete', 'off'); i.setAttribute('autocorrect', 'off'); i.spellcheck = false;
  return i;
}
function smartCheck(label, on) {
  var l = smartEl('label', 'spCheck'), c = smartEl('input');
  c.type = 'checkbox'; c.checked = !!on;
  l.appendChild(c); l.appendChild(document.createTextNode(' ' + label));
  l.box = c;
  return l;
}

function openSmartEditor(rule) {
  var s = rule ? smartParse(rule.line) : smartEmpty();
  smartEd = {slot: rule ? rule.slot : 0, old: rule, s: s || smartEmpty(), expertOnly: !s, line: rule ? rule.line : '',
             nameTouched: !!rule, seq: 0};
  document.getElementById('smartTitle').textContent = T(rule ? 'sp.title.edit' : 'sp.title.new');
  smartDeleteBtn.style.display = rule ? '' : 'none';
  smartStatus.textContent = '';
  smartRender();
  overlaySmart.classList.add('on');
}

function smartRender() {
  var ed = smartEd, s = ed.s;
  while (smartBody.firstChild) smartBody.removeChild(smartBody.firstChild);
  var f = ed.f = {};

  f.name = smartInput(s.name, T('sp.namePh'));
  f.name.addEventListener('input', function(){ ed.nameTouched = f.name.value.trim() !== ''; smartFromFields(); });
  smartBody.appendChild(smartField(T('sp.name'), f.name));

  ed.expertNote = smartEl('div', 'tagHint spWarn', T('sp.expertOnly'));    /* at the top, above the greyed-out fields */
  smartBody.appendChild(ed.expertNote);
  var fields = ed.fieldsBox = smartEl('div', 'spFields');
  smartBody.appendChild(fields);

  /* artists: chosen list, "All artists", search in the library */
  var head = smartEl('div', 'tagSectionAa spHead');
  head.appendChild(smartEl('span', '', T('sp.artists')));
  f.all = smartCheck(T('sp.allArtists'), s.all);
  f.all.box.addEventListener('change', function(){ smartFromFields(); smartArtistsPaint(); });
  head.appendChild(f.all);
  fields.appendChild(head);
  ed.list = smartEl('div', 'spArtists');
  fields.appendChild(ed.list);
  ed.searchBox = smartEl('div', 'spSearch');
  f.search = smartInput('', T('sp.search'));
  f.search.type = 'search';
  var searchTimer = null;
  f.search.addEventListener('input', function(){
    clearTimeout(searchTimer);
    searchTimer = setTimeout(smartSearch, 350);
  });
  f.search.addEventListener('keydown', function(e){ if (e.key === 'Enter') { clearTimeout(searchTimer); smartSearch(); } });
  var sf = smartEl('div', 'spSearchField');                  /* x clears the input, as in the main search */
  var clr = smartEl('div', 'spClear');
  clr.title = T('html.searchClear'); clr.setAttribute('role', 'button'); clr.setAttribute('aria-label', T('html.searchClear'));
  clr.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>';
  function paintClear() { clr.style.display = f.search.value ? 'block' : 'none'; }
  f.search.addEventListener('input', paintClear);
  clr.addEventListener('click', function(){
    clearTimeout(searchTimer);
    f.search.value = ''; paintClear();
    smartSearch();                                           /* empties the hits, discards a running search */
    f.search.focus();
  });
  sf.appendChild(f.search); sf.appendChild(clr);
  ed.searchBox.appendChild(sf);
  paintClear();
  ed.hits = smartEl('div', 'spHits');
  ed.searchBox.appendChild(ed.hits);
  fields.appendChild(ed.searchBox);

  /* filters */
  fields.appendChild(smartEl('div', 'tagSectionAa spHead', T('sp.filters')));
  var years = smartEl('div', 'tagRow');
  f.yFrom = smartInput(s.yFrom, T('sp.from'), 'spNum');
  f.yTo = smartInput(s.yTo, T('sp.to'), 'spNum');
  [f.yFrom, f.yTo].forEach(function(i){ i.inputMode = 'numeric'; i.maxLength = 4; });
  years.appendChild(f.yFrom); years.appendChild(smartEl('span', 'spDash', '–')); years.appendChild(f.yTo);
  fields.appendChild(smartField(T('sp.years'), years));
  f.orig = smartCheck(T('sp.origYear'), s.orig);
  fields.appendChild(f.orig);
  f.genres = smartInput(s.genres, T('sp.genrePh'));
  f.genres.setAttribute('list', 'spGenreList');
  fields.appendChild(smartField(T('sp.genre'), f.genres, T('sp.genreHint')));
  smartGenreList();
  f.notAlbum = smartInput(s.notAlbum, T('sp.notAlbumPh'));
  fields.appendChild(smartField(T('sp.notAlbum'), f.notAlbum));
  f.recent = smartInput(s.recent, '', 'spNum');
  f.recent.inputMode = 'numeric';
  fields.appendChild(smartField(T('sp.recent'), f.recent));
  f.various = smartCheck(T('sp.various'), s.various);
  f.dedup = smartCheck(T('sp.dedup'), s.dedup);
  fields.appendChild(f.various); fields.appendChild(f.dedup);
  f.sort = smartEl('select', 'tagSel');
  SMART_SORTS.forEach(function(o){
    var op = smartEl('option', '', T(o[1]));
    op.value = o[0];
    f.sort.appendChild(op);
  });
  f.sort.value = s.sort;
  fields.appendChild(smartField(T('sp.sort'), f.sort));
  f.limit = smartInput(s.limit, T('sp.limitPh'), 'spNum');
  f.limit.inputMode = 'numeric';
  fields.appendChild(smartField(T('sp.limit'), f.limit));
  ['yFrom', 'yTo', 'genres', 'notAlbum', 'recent', 'limit'].forEach(function(k){ f[k].addEventListener('input', smartFromFields); });
  [f.orig, f.various, f.dedup].forEach(function(c){ c.box.addEventListener('change', smartFromFields); });
  f.sort.addEventListener('change', smartFromFields);

  /* expert line with the syntax from the plugin */
  f.line = smartEl('textarea', 'tagIn tagMulti spLine');
  f.line.rows = 3; f.line.spellcheck = false;
  f.line.setAttribute('autocapitalize', 'off'); f.line.setAttribute('autocorrect', 'off');
  f.line.addEventListener('input', smartFromLine);
  smartBody.appendChild(smartField(T('sp.expert'), f.line));
  var help = smartEl('details', 'spHelp');
  help.appendChild(smartEl('summary', '', T('sp.help')));
  help.appendChild(smartEl('div', 'spHelpText', T('sp.helpText')));
  smartBody.appendChild(help);

  /* preview */
  var pv = smartEl('button', 'tagBtn', T('sp.preview'));
  pv.type = 'button';
  pv.addEventListener('click', smartPreview);
  smartBody.appendChild(pv);
  ed.previewOut = smartEl('div', 'spPreview');
  smartBody.appendChild(ed.previewOut);

  if (ed.expertOnly) f.line.value = ed.line; else smartFromFields();
  smartArtistsPaint();
  smartModePaint();
}

/* fields changed: new line; the name follows the artists until it was typed by hand */
function smartFromFields() {
  var ed = smartEd, f = ed.f, s = ed.s;
  if (ed.expertOnly) return;
  s.all = f.all.box.checked;
  ['yFrom', 'yTo', 'recent', 'limit'].forEach(function(k){ s[k] = f[k].value.replace(/\D/g, ''); });
  s.genres = f.genres.value; s.notAlbum = f.notAlbum.value;
  s.orig = f.orig.box.checked; s.various = f.various.box.checked; s.dedup = f.dedup.box.checked;
  s.sort = f.sort.value;
  if (!ed.nameTouched) { s.name = smartNameFor(s); f.name.value = s.name; } else s.name = f.name.value;
  f.line.value = smartLine(s);
  smartPreviewClear();
}

/* line typed by hand: back into the fields if they can show it */
function smartFromLine() {
  var ed = smartEd, p = smartParse(ed.f.line.value.trim());
  ed.expertOnly = !p;
  if (p) {
    ed.s = p;
    var f = ed.f;
    f.name.value = p.name; ed.nameTouched = p.name !== '';
    f.all.box.checked = p.all;
    ['yFrom', 'yTo', 'genres', 'notAlbum', 'recent', 'limit'].forEach(function(k){ f[k].value = p[k]; });
    f.orig.box.checked = p.orig; f.various.box.checked = p.various; f.dedup.box.checked = p.dedup;
    f.sort.value = p.sort;
    smartArtistsPaint();
  } else {
    var i = ed.f.line.value.indexOf('::');
    if (i >= 0) ed.f.name.value = ed.f.line.value.slice(0, i).trim();
  }
  smartModePaint();
  smartPreviewClear();
}

function smartModePaint() {
  smartEd.fieldsBox.classList.toggle('off', smartEd.expertOnly);
  smartEd.expertNote.style.display = smartEd.expertOnly ? '' : 'none';
  smartEd.f.name.disabled = smartEd.expertOnly;
}

function smartArtistsPaint() {
  var ed = smartEd, list = ed.list, all = ed.f.all.box.checked;
  while (list.firstChild) list.removeChild(list.firstChild);
  list.classList.toggle('off', all);
  ed.searchBox.style.display = all ? 'none' : '';
  if (all) return;
  if (!ed.s.artists.length) list.appendChild(smartEl('div', 'tagHint', T('sp.noArtists')));
  ed.s.artists.forEach(function(a, i){
    var row = smartEl('div', 'spArtist');
    row.appendChild(smartEl('div', 'spArtistName', a));
    var del = smartEl('div', 'tagEditMini spDel');
    del.title = T('sp.remove');
    del.innerHTML = TRASH_SVG;
    del.addEventListener('click', function(){
      ed.s.artists.splice(i, 1);
      smartFromFields(); smartArtistsPaint(); smartHitsPaint();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
}

/* artist search in the local library (Volumio search, artists only) */
function smartSearch() {
  var ed = smartEd, q = ed.f.search.value.trim(), seq = ++ed.seq;
  ed.found = [];
  if (q.length < 2) return smartHitsPaint();
  while (ed.hits.firstChild) ed.hits.removeChild(ed.hits.firstChild);
  ed.hits.appendChild(smartEl('div', 'tagHint', T('search.searching')));
  withTimeout(fetch('/api/v1/search?query=' + volumioArg(q)).then(function(r){ return r.json(); }), 15000).then(function(j){
    if (seq !== ed.seq || smartEd !== ed) return;
    var seen = {};
    ((j && j.navigation && j.navigation.lists) || []).forEach(function(l){
      (l.items || []).forEach(function(it){
        var name = it.title || it.name || '';
        if (!/^artists:\/\//.test(it.uri || '') || (it.service || 'mpd') !== 'mpd' || !name || seen[name.toLowerCase()]) return;
        seen[name.toLowerCase()] = true;
        ed.found.push({name: name, art: it.albumart || ''});
      });
    });
    smartHitsPaint();
  }).catch(function(){
    if (seq !== ed.seq) return;
    ed.found = [];
    smartHitsPaint(T('search.noAnswer'));
  });
}

function smartHitsPaint(msg) {
  var ed = smartEd, hits = ed.hits;
  while (hits.firstChild) hits.removeChild(hits.firstChild);
  if (msg) return hits.appendChild(smartEl('div', 'tagHint', msg));
  if (!ed.found || !ed.f.search.value.trim()) return;
  if (!ed.found.length) return hits.appendChild(smartEl('div', 'tagHint', T('sp.noHits')));
  ed.found.forEach(function(h){
    var have = ed.s.artists.some(function(a){ return a.toLowerCase() === h.name.toLowerCase(); });
    var row = smartEl('div', 'sRow' + (have ? ' spHave' : ''));
    var img = smartEl('img', 'sCover');
    if (h.art) img.src = artUrl(h.art);
    var meta = smartEl('div', 'sMeta');
    meta.appendChild(smartEl('div', 'sTitle', h.name));
    if (have) meta.appendChild(smartEl('div', 'sSub', T('sp.inList')));
    else if (SMART_BAD.test(h.name)) meta.appendChild(smartEl('div', 'sSub', T('sp.err.badChar')));
    row.appendChild(img); row.appendChild(meta);
    row.addEventListener('click', function(){
      if (have || SMART_BAD.test(h.name)) return;
      ed.s.artists.push(h.name);
      smartFromFields(); smartArtistsPaint(); smartHitsPaint();
    });
    hits.appendChild(row);
  });
  hits.appendChild(smartEl('div', 'tagHint', T('sp.tapAdd')));
}

/* genres of the library as suggestions (tag service), once */
function smartGenreList() {
  if (document.getElementById('spGenreList') || typeof tagGetJson !== 'function') return;
  var dl = document.createElement('datalist');
  dl.id = 'spGenreList';
  document.body.appendChild(dl);
  tagGetJson('/genrelist').then(function(r){
    ((r && r.genres) || []).forEach(function(g){ var o = document.createElement('option'); o.value = g.g; dl.appendChild(o); });
  }).catch(function(){ /* without tag service: free text */ });
}

/* checks before preview and save; returns an error text or '' */
function smartProblem(forSave) {
  var ed = smartEd, line = ed.f.line.value.trim();
  if (!ed.expertOnly) {
    if (!ed.s.all && !ed.s.artists.length) return T('sp.err.noArtist');
    if (/[|,]/.test(ed.s.genres) || /[|,]/.test(ed.s.notAlbum)) return T('sp.err.badValue');
  }
  if (/[\r\n]/.test(line)) return T('sp.err.bad_line');
  if (forSave) {
    var i = line.indexOf('::');
    if (i < 1 || !line.slice(0, i).trim()) return T('sp.err.no_name');
  }
  return '';
}

function smartError(r) {
  var code = (r && r.error) || 'failed';
  return T('sp.err.' + code, {n: smartRules ? smartRules.max : 90});
}

function smartPreviewClear() { if (smartEd.previewOut) { smartEd.pseq = (smartEd.pseq || 0) + 1; smartEd.previewOut.textContent = ''; } }

function smartPreview() {
  var ed = smartEd, out = ed.previewOut, bad = smartProblem(false);
  if (bad) { out.textContent = bad; return; }
  var line = ed.f.line.value.trim(), seq = (ed.pseq = (ed.pseq || 0) + 1);
  if (line.indexOf('::') === 0) line = line.slice(2);                         /* name still empty: the plugin adds one */
  out.textContent = T('sp.previewBusy');
  smartCall({action: 'preview', line: line}).then(function(r){
    if (seq !== ed.pseq) return;
    while (out.firstChild) out.removeChild(out.firstChild);
    if (!r.ok) { out.textContent = smartError(r); return; }
    out.appendChild(smartEl('div', 'spCount', r.count ? T('sp.previewCount', {n: r.count}) : T('sp.previewNone')));
    r.tracks.forEach(function(t){
      out.appendChild(smartEl('div', 'spTrack', t.title + (t.artist ? ' · ' + t.artist : '')));
    });
    if (r.count > r.tracks.length) out.appendChild(smartEl('div', 'tagHint', '…'));
  });
}

function smartClose() { overlaySmart.classList.remove('on'); smartEd = null; }

/* the plugin's run creates the playlist: ask until it is done, then show the list again */
function smartWaitBuilt(name, tries) {
  tries = tries || 0;
  setTimeout(function(){
    smartCall({action: 'status'}).then(function(r){
      if (r.ok && r.running && tries < 120) return smartWaitBuilt(name, tries + 1);
      showToast(r.ok && r.lastRun && !r.lastRun.ok ? T('sp.err.failed') : T('sp.built', {name: name}));
      smartListRefresh();
    });
  }, tries ? 2000 : 1500);
}

function smartListRefresh() {
  if (overlayPlaylists.classList.contains('on') && typeof plTabActive !== 'undefined' && plTabActive === 1) loadPlaylists();
}

if (typeof module !== 'undefined') module.exports = {smartEmpty: smartEmpty, smartLine: smartLine, smartParse: smartParse, smartNameFor: smartNameFor};
else {
  smartSaveBtn.addEventListener('click', function(){
    var ed = smartEd, bad = smartProblem(true);
    if (bad) { smartStatus.textContent = bad; return; }
    var line = ed.f.line.value.trim();
    smartSaveBtn.disabled = true;
    smartStatus.textContent = T('sp.saving');
    smartCall({action: 'save', slot: ed.slot, line: line}).then(function(r){
      smartSaveBtn.disabled = false;
      if (!r.ok) { smartStatus.textContent = smartError(r); return; }
      smartClose();
      showToast(T('sp.building'), true);                    /* with spinner until the plugin is done */
      smartWaitBuilt(r.playlist);
    });
  });

  smartDeleteBtn.addEventListener('click', function(){
    var ed = smartEd;
    if (!ed || !ed.old || !confirm(T('sp.confirmDelete', {name: ed.old.playlist}))) return;
    smartCall({action: 'delete', slot: ed.slot}).then(function(r){
      if (!r.ok) { smartStatus.textContent = smartError(r); return; }
      smartClose();
      showToast(T('sp.deleted'));
      smartListRefresh();
    });
  });

  document.getElementById('closeSmart').addEventListener('click', smartClose);
}
