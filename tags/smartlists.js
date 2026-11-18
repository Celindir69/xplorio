/* Smart playlists without Volumio (PLAYER 'mpd'): the rules of the Smart Playlists plugin (smart-playlist-plugin,
   smart-playlists-core.sh) evaluated here, the results written as MPD playlists. Same rule lines, same REST answers
   (list, status, save, delete, run, preview), so the editor in the interface (web/js/smartlist.js) works unchanged.
   Rule line: "Name::Artist1;Artist2|field<op>value,field<op>value|…" (artist list OR, "|" groups AND, "," inside a
   group OR). Fields album genre title artist albumartist comment (= != exact, ~ !~ contains), year originalyear track
   duration added (days; = != > >= < <=). Special: duplicate=false, various=true, sort=…, limit=N.
   Node 8, ES5 only. opts: mpd(cmds, cb(err, lists)), dir (rules, manifest), log(text) */
var fs = require('fs');
var path = require('path');

var SLOTS = 90, MAX_LINE = 2000, API = 1, PAGE = 5000, BATCH = 1000;
var TEXT = ['album', 'genre', 'title', 'artist', 'albumartist', 'comment'];
var NUM = ['year', 'originalyear', 'track', 'duration', 'added'];
var SORT_KEYS = ['originalyear', 'album', 'artist', 'title', 'track', 'year', 'added'];

function quote(s) { return '"' + String(s).replace(/[\\"]/g, '\\$&') + '"'; }
function trim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }
function isRuleLine(l) { var t = trim(l || ''); return t !== '' && t.charAt(0) !== '#'; }
function sanitizeName(name) {
  var out = String(name).replace(/[\/:"\\?*]/g, '_').replace(/[\x00-\x1f]/g, '').replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
  if (out === '' || out === '.' || out === '..') return 'unnamed';
  if (out.charAt(0) === '.') return '_' + out;
  return out;
}
function playlistOf(line) {
  line = String(line).replace(/\r$/, '');
  var i = line.indexOf('::');
  return i >= 0 ? sanitizeName(trim(line.slice(0, i))) : sanitizeName(line.replace(/;/g, ', '));
}
function ruleName(line) { var i = String(line).indexOf('::'); return i >= 0 ? trim(String(line).slice(0, i)) : ''; }
function checkLine(line) {
  if (typeof line !== 'string') return 'bad_line';
  if (/[\r\n]/.test(line) || line.length > MAX_LINE || !isRuleLine(line)) return 'bad_line';
  if (!ruleName(line)) return 'no_name';
  var rest = trim(line.slice(line.indexOf('::') + 2));
  if (!rest || rest.charAt(0) === '|') return 'bad_line';
  return '';
}
/* as the core script: lower case, without spaces, tabs, - _ . */
function norm(s) { return String(s).replace(/\r/g, '').toLowerCase().replace(/[ \t\-_.]/g, ''); }

/* ---------- tracks from MPD ---------- */
function year(d) { var m = /\d{4}/.exec(d || ''); return m ? +m[0] : null; }
/* MPD's song lines -> [{file, aa, ar, ti, al, ge, yr, oyr, cm, trk, dur, mt}] ('-' for a missing text, null for a number) */
function songs(lines) {
  var out = [], cur = null;
  function done() {
    if (!cur) return;
    var t = function(k){ var v = cur[k]; return v ? String(v).replace(/[\t\n\r]/g, ' ') : '-'; };
    var trk = /^\d+/.exec(cur.track || ''), dur = parseFloat(cur.duration || cur.time);
    out.push({file: cur.file, aa: t('albumartist'), ar: t('artist'), ti: t('title'), al: t('album'), ge: t('genre'),
              yr: year(cur.date), oyr: year(cur.originaldate), cm: t('comment'), trk: trk ? +trk[0] : null,
              dur: isNaN(dur) ? null : Math.round(dur), mt: cur['last-modified'] ? Math.floor(Date.parse(cur['last-modified']) / 1000) || null : null});
  }
  (lines || []).forEach(function(l){
    var i = l.indexOf(': ');
    if (i < 0) return;
    var k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
    if (k === 'file') { done(); cur = {file: v}; return; }
    if (k === 'directory' || k === 'playlist') { done(); cur = null; return; }
    if (cur && cur[k] === undefined) cur[k] = v;             /* several values (two genres): the first, like mpc's %genre% */
  });
  done();
  return out;
}

/* ---------- a rule line ---------- */
/* line -> {name, all, wanted: {norm: 1}, groups: [[{f, op, v}]], dedupe, various, sort: [{k, desc}] | 'mix' | null, limit} */
function parse(line, log) {
  var r = {name: playlistOf(line), all: false, wanted: {}, groups: [], dedupe: false, various: false, sort: null, limit: 0};
  var rest = line.indexOf('::') >= 0 ? trim(line.slice(line.indexOf('::') + 2)) : line;
  var parts = rest.split('|'), artists = trim(parts[0]);
  if (!artists || artists === '*') r.all = true;
  else artists.split(';').forEach(function(a){ var n = norm(trim(a).replace(/\s+/g, ' ')); if (n) r.wanted[n] = 1; });
  parts.slice(1).forEach(function(p){
    p = trim(p);
    if (!p) return;
    var m;
    if ((m = /^duplicate\s*=\s*(.*)$/i.exec(p))) {
      var d = trim(m[1]).toLowerCase();
      if (/^(false|0|no)$/.test(d)) r.dedupe = true; else if (/^(true|1|yes)$/.test(d)) r.dedupe = false; else log('Invalid value for duplicate ignored: ' + d);
      return;
    }
    if ((m = /^various\s*=\s*(.*)$/i.exec(p))) {
      var w = trim(m[1]).toLowerCase();
      if (/^(true|1|yes)$/.test(w)) r.various = true; else if (/^(false|0|no)$/.test(w)) r.various = false; else log('Invalid value for various ignored: ' + w);
      return;
    }
    if ((m = /^sort\s*=\s*(.*)$/i.exec(p))) { r.sort = sortSpec(m[1].toLowerCase().replace(/\s+/g, ''), log); return; }
    if ((m = /^limit\s*=\s*(.*)$/i.exec(p))) {
      var n = m[1].replace(/\s+/g, '');
      if (/^\d+$/.test(n) && +n > 0) r.limit = +n; else log('Invalid value for limit ignored: ' + n);
      return;
    }
    var group = [];
    p.split(',').forEach(function(sub){
      sub = trim(sub);
      if (!sub) return;
      var c = /^([A-Za-z]+)\s*(>=|<=|!=|!~|>|<|=|~)\s*(.*)$/.exec(sub);
      if (!c) return log('Invalid filter ignored: ' + sub);
      var f = c[1].toLowerCase();
      if (TEXT.indexOf(f) < 0 && NUM.indexOf(f) < 0) return log('Unknown filter field ignored: ' + f);
      group.push({f: f, op: c[2], v: c[3].replace(/\s+$/, '')});
    });
    if (group.length) r.groups.push(group);
  });
  return r;
}
function sortSpec(spec, log) {
  if (!spec || spec === 'random') return null;
  if (spec === 'mix') return 'mix';
  var keys = [], rest = spec;
  while (rest) {
    var k = SORT_KEYS.filter(function(x){ return rest.indexOf(x) === 0; })[0];
    if (!k) { log('Invalid sort spec ' + spec + ' - random order'); return null; }
    rest = rest.slice(k.length);
    var desc = rest.charAt(0) === '-';
    if (rest.charAt(0) === '-' || rest.charAt(0) === '+') rest = rest.slice(1);
    keys.push({k: k, desc: desc});
  }
  return keys;
}

function textMatch(val, op, want) {
  if (op === '~') return val.toLowerCase().indexOf(want.toLowerCase()) >= 0;
  if (op === '!~') return val.toLowerCase().indexOf(want.toLowerCase()) < 0;
  if (op === '=') return norm(val) === norm(want);
  if (op === '!=') return norm(val) !== norm(want);
  return true;
}
function numMatch(val, op, want) {
  if (val === null || val === undefined) return false;
  var w = parseFloat(want) || 0;
  switch (op) {
    case '=': return val === w;
    case '!=': return val !== w;
    case '>': return val > w;
    case '>=': return val >= w;
    case '<': return val < w;
    case '<=': return val <= w;
  }
  return true;
}
function cond(c, s, now) {
  switch (c.f) {
    case 'year': return numMatch(s.yr, c.op, c.v);
    case 'originalyear': return numMatch(s.oyr === null ? s.yr : s.oyr, c.op, c.v);
    case 'track': return numMatch(s.trk, c.op, c.v);
    case 'duration': return numMatch(s.dur, c.op, c.v);
    case 'added': return s.mt === null ? false : numMatch((now - s.mt) / 86400, c.op, c.v);
    case 'album': return textMatch(s.al, c.op, c.v);
    case 'genre': return textMatch(s.ge, c.op, c.v);
    case 'title': return textMatch(s.ti, c.op, c.v);
    case 'artist': return textMatch(s.ar, c.op, c.v);
    case 'albumartist': return textMatch(s.aa, c.op, c.v);
    case 'comment': return textMatch(s.cm, c.op, c.v);
  }
  return true;
}

function shuffle(a, rnd) {
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; }
  return a;
}
function stableSort(a, cmp) {
  return a.map(function(x, i){ return [x, i]; }).sort(function(p, q){ return cmp(p[0], q[0]) || p[1] - q[1]; }).map(function(p){ return p[0]; });
}
/* sort=mix: artists about equally often, never the same one twice in a row while another is left, albums take turns */
function mix(rows, rnd) {
  var inAlbum = {}, byArtist = {};
  var a = shuffle(rows.slice(), rnd).map(function(r){
    var art = r.artist.toLowerCase(), k = art + '\u0001' + r.al.toLowerCase();
    inAlbum[k] = (inAlbum[k] || 0) + 1;
    return {r: r, art: art, n: inAlbum[k] - 1};
  });
  a = stableSort(a, function(x, y){ return x.art < y.art ? -1 : x.art > y.art ? 1 : x.n - y.n; });
  a.forEach(function(x){ var i = byArtist[x.art] = (byArtist[x.art] === undefined ? 0 : byArtist[x.art] + 1); x.key = i + rnd(); });
  a = stableSort(a, function(x, y){ return x.key - y.key; });
  var left = {}, used = [], out = [], prev = null, first = 0;
  a.forEach(function(x){ left[x.art] = (left[x.art] || 0) + 1; });
  for (var k = 0; k < a.length; k++) {
    while (first < a.length && used[first]) first++;
    var pick = first;
    if (a[first].art === prev && a.length - k > left[prev]) {
      for (var j = first + 1; j < a.length; j++) if (!used[j] && a[j].art !== prev) { pick = j; break; }
    }
    used[pick] = true; prev = a[pick].art; left[prev]--; out.push(a[pick].r);
  }
  return out;
}

/* tracks, a parsed rule -> ordered rows [{file, title, artist, al}] (limit applied) and the number of matches */
function evaluate(tracks, r, now, rnd) {
  var seen = {}, rows = [];
  if (!r.all && !Object.keys(r.wanted).length) return {rows: [], matched: 0};
  tracks.forEach(function(s){
    var disp = r.various ? s.ar : (s.aa !== '-' && s.aa !== '' ? s.aa : s.ar);
    if (!r.all && !r.wanted[norm(disp)]) return;
    for (var g = 0; g < r.groups.length; g++) {
      if (!r.groups[g].some(function(c){ return cond(c, s, now); })) return;
    }
    if (r.dedupe) { var nt = norm(s.ti); if (seen[nt]) return; seen[nt] = 1; }
    rows.push({file: s.file, title: s.ti, al: s.al, artist: disp, trk: s.trk, yr: s.yr, added: s.mt === null ? null : Math.floor((now - s.mt) / 86400),
               oyr: s.oyr === null ? s.yr : s.oyr});
  });
  var matched = rows.length;
  if (r.sort === 'mix') rows = mix(rows, rnd);
  else if (r.sort) {
    var col = {title: 'title', album: 'al', artist: 'artist', track: 'trk', year: 'yr', added: 'added', originalyear: 'oyr'};
    rows = stableSort(rows, function(x, y){
      for (var i = 0; i < r.sort.length; i++) {
        var k = col[r.sort[i].k], c;
        if (['trk', 'yr', 'added', 'oyr'].indexOf(k) >= 0) c = (x[k] || 0) - (y[k] || 0);
        else { var p = String(x[k]).toUpperCase(), q = String(y[k]).toUpperCase(); c = p < q ? -1 : p > q ? 1 : 0; }
        if (c) return r.sort[i].desc ? -c : c;
      }
      return 0;
    });
  } else rows = shuffle(rows, rnd);
  if (r.limit) rows = rows.slice(0, r.limit);
  return {rows: rows, matched: matched};
}

/* ---------- the store: rules, runs, REST ---------- */
function Smart(opts) {
  this.o = opts;
  this.running = false; this.rerun = false; this.lastRun = null; this.previewing = false;
  this.tracks = null; this.tracksStamp = null;
  this.log = opts.log || function(){};
}
Smart.prototype.file = function(n) { return path.join(this.o.dir, n); };
Smart.prototype.rules = function() {
  var l = [];
  try { l = fs.readFileSync(this.file('smart_playlists.txt'), 'utf8').split('\n'); } catch (e) { /* none yet */ }
  var out = [];
  for (var i = 0; i < SLOTS; i++) out.push((l[i] || '').replace(/\r$/, ''));
  return out;
};
Smart.prototype.writeRules = function(lines) {
  var f = this.file('smart_playlists.txt'), text = lines.join('\n') + '\n', old = '';
  try { fs.mkdirSync(this.o.dir, {recursive: true}); } catch (e) { /* exists */ }
  try { old = fs.readFileSync(f, 'utf8'); } catch (e) { /* none */ }
  if (old !== text && old.split('\n').some(isRuleLine)) fs.writeFileSync(f + '.bak', old);
  fs.writeFileSync(f + '.neu', text);
  fs.renameSync(f + '.neu', f);
};
Smart.prototype.manifest = function() {
  try { return fs.readFileSync(this.file('smart_playlists.manifest'), 'utf8').split('\n').filter(Boolean); } catch (e) { return []; }
};
Smart.prototype.writeManifest = function(names) {
  try { fs.mkdirSync(this.o.dir, {recursive: true}); } catch (e) { /* exists */ }
  fs.writeFileSync(this.file('smart_playlists.manifest'), names.length ? names.join('\n') + '\n' : '');
};

/* all tracks (MPD's database, page by page; MPD's output buffer is limited); kept until the database changes */
Smart.prototype.loadTracks = function(cb) {
  var self = this;
  this.o.mpd(['stats'], function(err, lists){
    if (err) return cb(err);
    var stamp = ((lists[0] || []).filter(function(l){ return l.indexOf('db_update: ') === 0; })[0] || '').slice(11);
    if (self.tracks && stamp && stamp === self.tracksStamp) return cb(null, self.tracks, stamp);
    var all = [], from = 0;
    (function page(){
      self.o.mpd(['search any "" window ' + from + ':' + (from + PAGE)], function(e, l2){
        if (e) return cb(e);
        var got = songs(l2[0]);
        all = all.concat(got);
        if (got.length >= PAGE) { from += PAGE; return setImmediate(page); }
        self.tracks = all; self.tracksStamp = stamp;
        cb(null, all, stamp);
      });
    })();
  });
};

/* write a playlist: removed, then filled anew in pieces */
Smart.prototype.writePlaylist = function(name, files, cb) {
  var self = this;
  this.o.mpd(['rm ' + quote(name)], function(){                  /* not there yet: fine */
    var i = 0;
    (function next(){
      if (i >= files.length) return cb(null);
      var part = files.slice(i, i + BATCH).map(function(f){ return 'playlistadd ' + quote(name) + ' ' + quote(f); });
      i += BATCH;
      self.o.mpd(part, function(e){ if (e) return cb(e); setImmediate(next); });
    })();
  });
};

/* a run over all rules -> cb(err) */
Smart.prototype.run = function(cb) {
  var self = this;
  cb = cb || function(){};
  if (this.running) { this.rerun = true; return cb(null); }
  this.running = true;
  function finish(err) {
    self.running = false;
    self.lastRun = {at: Date.now(), ok: !err};
    if (err) self.log('smart playlists: ' + err.message);
    if (self.rerun) { self.rerun = false; return self.run(cb); }
    cb(err);
  }
  this.loadTracks(function(err, tracks, stamp){
    if (err) return finish(err);
    self.lastStamp = stamp; self.ranRules = self.rulesStamp();
    var lines = self.rules().filter(isRuleLine).map(trim), names = [], now = Date.now() / 1000, i = 0;
    (function next(){
      if (i >= lines.length) return cleanup();
      var r = parse(lines[i++], self.log), res = evaluate(tracks, r, now, Math.random);
      names.push(r.name);
      if (!res.rows.length) return setImmediate(next);          /* no match: the playlist stays as it was (like the plugin) */
      self.writePlaylist(r.name, res.rows.map(function(x){ return x.file; }), function(e){ if (e) self.log('smart playlists: ' + r.name + ': ' + e.message); setImmediate(next); });
    })();
    function cleanup() {
      var old = self.manifest();
      if (!lines.length && old.length) return finish(null);     /* no rules: the playlists of the last run stay */
      var gone = old.filter(function(n){ return names.indexOf(n) < 0; });
      (function rm(){
        if (!gone.length) { try { self.writeManifest(names.filter(function(n, k){ return names.indexOf(n) === k; })); } catch (e) { return finish(e); } return finish(null); }
        self.o.mpd(['rm ' + quote(gone.shift())], function(){ rm(); });
      })();
    }
  });
};

/* rules file changed outside (copied over from Volumio): a run at the next check */
Smart.prototype.rulesStamp = function() {
  try { var st = fs.statSync(this.file('smart_playlists.txt')); return st.mtime.getTime() + ':' + st.size; } catch (e) { return ''; }
};
Smart.prototype.status = function() { return {ok: true, api: API, running: this.running, lastRun: this.lastRun}; };

/* data {action, …} -> cb(answer); the answers of the plugin's REST endpoint */
Smart.prototype.api = function(data, cb) {
  var self = this, a = (data && data.action) || 'list';
  data = data || {};
  try {
    if (a === 'status') return cb(this.status());
    if (a === 'list') {
      var made = this.manifest(), st = this.status();
      st.max = SLOTS;
      st.rules = [];
      this.rules().forEach(function(line, i){
        if (!isRuleLine(line)) return;
        var pl = playlistOf(trim(line));
        st.rules.push({slot: i + 1, line: trim(line), name: ruleName(line), playlist: pl, created: made.indexOf(pl) >= 0});
      });
      return cb(st);
    }
    if (a === 'run') { this.run(); return cb({ok: true, running: true}); }
    if (a === 'save') {
      var line = typeof data.line === 'string' ? trim(data.line) : data.line, bad = checkLine(line);
      if (bad) return cb({ok: false, error: bad});
      var slot = parseInt(data.slot, 10) || 0;
      if (slot < 0 || slot > SLOTS) return cb({ok: false, error: 'bad_slot'});
      var rules = this.rules(), pl = playlistOf(line), free = 0;
      for (var i = 1; i <= SLOTS; i++) {
        var other = rules[i - 1];
        if (!isRuleLine(other)) { if (!free && !trim(other)) free = i; continue; }
        if (i !== slot && playlistOf(trim(other)) === pl) return cb({ok: false, error: 'name_taken'});
      }
      if (!slot) slot = free;
      if (!slot) return cb({ok: false, error: 'full'});
      rules[slot - 1] = line;
      this.writeRules(rules);
      if (data.run !== false) this.run();
      return cb({ok: true, slot: slot, playlist: pl});
    }
    if (a === 'delete') {
      var s = parseInt(data.slot, 10) || 0, all = this.rules();
      if (s < 1 || s > SLOTS || !isRuleLine(all[s - 1])) return cb({ok: false, error: 'bad_slot'});
      var name = playlistOf(trim(all[s - 1]));
      all[s - 1] = '';
      this.writeRules(all);
      var still = all.some(function(l){ return isRuleLine(l) && playlistOf(trim(l)) === name; }), made2 = this.manifest();
      if (!still && made2.indexOf(name) >= 0) {
        this.writeManifest(made2.filter(function(n){ return n !== name; }));
        return this.o.mpd(['rm ' + quote(name)], function(){ if (all.some(isRuleLine)) self.run(); cb({ok: true}); });
      }
      if (all.some(isRuleLine)) this.run();
      return cb({ok: true});
    }
    if (a === 'preview') {
      var pline = typeof data.line === 'string' ? trim(data.line) : data.line, pbad = checkLine(pline);
      if (pbad === 'no_name') { pline = 'Preview::' + pline; pbad = checkLine(pline); }
      if (pbad) return cb({ok: false, error: pbad});
      if (this.previewing) return cb({ok: false, error: 'busy'});
      this.previewing = true;
      return this.loadTracks(function(err, tracks){
        self.previewing = false;
        if (err) return cb({ok: false, error: 'failed'});
        var res = evaluate(tracks, parse(pline, function(){}), Date.now() / 1000, Math.random);
        cb({ok: true, count: res.rows.length, tracks: res.rows.slice(0, 10).map(function(x){
          return {title: x.title === '-' ? path.basename(x.file) : x.title, artist: x.artist === '-' ? '' : x.artist, album: x.al === '-' ? '' : x.al};
        })});
      });
    }
  } catch (e) {
    this.log('smart playlists ' + a + ': ' + e.message);
    return cb({ok: false, error: 'failed'});
  }
  cb({ok: false, error: 'bad_action'});
};

/* runs by themselves: when MPD's database changed (new music) and once a day ("added" counts days) */
Smart.prototype.tick = function() {
  var self = this;
  if (this.running || !this.rules().some(isRuleLine)) return;
  this.o.mpd(['stats'], function(err, lists){
    if (err) return;
    var stamp = ((lists[0] || []).filter(function(l){ return l.indexOf('db_update: ') === 0; })[0] || '').slice(11);
    var old = !self.lastRun || Date.now() - self.lastRun.at > 24 * 3600 * 1000;
    if (old || stamp !== self.lastStamp || self.rulesStamp() !== self.ranRules) self.run();
  });
};

module.exports = {Smart: Smart, parse: parse, evaluate: evaluate, songs: songs, mix: mix, playlistOf: playlistOf, checkLine: checkLine, norm: norm};
