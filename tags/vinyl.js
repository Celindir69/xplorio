/* Own record collection from Discogs ("Meine Platten"): the folders of a Discogs collection that the listener picks, read
   with the Discogs API and kept in vinyl.json in the data folder. Only for information: search, a hint on album and
   artist pages, birthdays; playing goes to the own files or a streaming service.
   Configuration (any Discogs user, any folders, each with an own label such as "LP" or "12″") in vinyl.json as well:
   {cfg: {user, folders: [{id, name, label}]}, at, error, items: [...], tracks: {releaseId: [{p, t, d}]}}.
   After reading the folders the tracklists are fetched one release at a time in the background (Discogs allows 60
   requests a minute with a token, 25 without). Node 8, ES5 only. */
var fs = require('fs');
var writeAtomic = require('./atomic.js').writeAtomic;
var releasedates = require('./releasedates.js');
var duplicates = require('./duplicates.js');           /* additions as with the album versions */

var API = process.env.DISCOGS_URL || 'https://api.discogs.com';
var REFRESH_MS = 24 * 3600 * 1000;           /* folders read again once a day */
var PER_PAGE = 100;
var MAX_ITEMS = 20000;
var USER_RE = /^[A-Za-z0-9_.\-]{1,64}$/;

/* ---------- names and keys ---------- */
/* "Pink Floyd (2)" -> "Pink Floyd", "Prince*" -> "Prince" (Discogs marks name variants like this) */
function cleanName(s) { return String(s || '').replace(/\s*\(\d+\)$/, '').replace(/\*$/, '').trim(); }
function credit(list) {
  return (list || []).map(function(a, i){
    var j = a.join && i < list.length - 1 ? (a.join === ',' ? ', ' : ' ' + a.join + ' ') : (i < list.length - 1 ? ', ' : '');
    return cleanName(a.anv || a.name) + j;
  }).join('').trim();
}
function fold(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  return s.replace(/[̀-ͯ]/g, '').toLowerCase();
}
/* artist key: without accents, "The ", punctuation; Various Artists and "Verschiedene" are the same */
function akey(s) {
  var k = fold(cleanName(s)).replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  return /^(various|variousartists|verschiedene|verschiedeneinterpreten|va)$/.test(k) ? 'va' : k;
}
/* album key: additions aside as with the album versions ("[HD]", "(24-96)", "Remastered", "Deluxe", " - 2011 Remaster"),
   "(Live)" stays a different album; "(Disc 2)" aside */
function tkey(s) {
  s = String(s || '').replace(/\s*[\(\[]\s*(cd|disc|disk|lp|side)\s*\d+\s*[\)\]]\s*$/i, '');
  s = releasedates.stripEdition(duplicates.bareName(s));
  return fold(s).replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

/* folder, page of a collection -> items: {id (release), f (folder id), ar, al, y, fmt, th, img, m (master), add, lab} */
function fromRelease(r, folder) {
  var b = (r && r.basic_information) || {};
  var formats = (b.formats || []).map(function(f){
    return [f.qty && +f.qty > 1 ? f.qty + '×' + (f.name || '') : f.name || ''].concat(f.descriptions || []).filter(Boolean).join(', ');
  }).join(' + ');
  var lab = (b.labels || [])[0];
  var it = {id: +(b.id || r.id) || 0, f: +folder || +r.folder_id || 0, ar: credit(b.artists), al: String(b.title || '').trim(),
            y: +b.year || 0, fmt: formats};
  if (b.thumb) it.th = String(b.thumb);
  if (b.cover_image) it.img = String(b.cover_image);
  if (b.master_id) it.m = +b.master_id;
  if (r.date_added) it.add = String(r.date_added).slice(0, 10);
  if (lab && lab.name) it.lab = cleanName(lab.name) + (lab.catno && lab.catno !== 'none' ? ' · ' + lab.catno : '');
  return it;
}
/* tracklist of a release (GET /releases/id): [{p: 'A1', t, d: '4:23', ar?}] without headings */
function fromTracklist(d) {
  return ((d && d.tracklist) || []).filter(function(t){ return (t.type_ || 'track') === 'track' && t.title; }).map(function(t){
    var o = {p: String(t.position || ''), t: String(t.title)};
    if (t.duration) o.d = String(t.duration);
    if (t.artists && t.artists.length) o.ar = credit(t.artists);
    return o;
  });
}

/* ---------- configuration ---------- */
/* {user, folders: [{id, label, name?}]} from the request -> cleaned or {error} */
function checkConfig(c) {
  c = c || {};
  var user = String(c.user || '').trim();
  if (user && !USER_RE.test(user)) return {error: 'user'};
  var seen = {}, folders = [];
  (Array.isArray(c.folders) ? c.folders : []).forEach(function(f){
    var id = parseInt(f && f.id, 10);
    if (!(id >= 0) || seen[id]) return;
    seen[id] = 1;
    var label = String(f.label || f.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
    folders.push({id: id, name: String(f.name || '').slice(0, 80), label: label || String(id)});
  });
  if (folders.length > 20) return {error: 'folders'};
  return {user: user, folders: folders};
}

/* ---------- the collection ---------- */
/* opts: file, token() -> Discogs token or '', getJson(url, headers, cb), stepMs (default: 1.1 s with token, 2.6 s without),
   now() for tests */
function Collection(opts) {
  this.file = opts.file;
  this.token = opts.token || function(){ return ''; };
  this.getJson = opts.getJson;
  this.stepMs = opts.stepMs;
  this.now = opts.now || Date.now;
  this.timer = null; this.running = false; this.busy = false; this.rev = 0; this.last = 0;
  var d = {};
  try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { d = {}; }
  this.data = {cfg: d.cfg || {user: '', folders: []}, at: d.at || 0, error: d.error || '', items: d.items || [], tracks: d.tracks || {},
               who: d.who || ''};
}
Collection.prototype.save = function() {
  try { writeAtomic(this.file, JSON.stringify(this.data)); } catch (e) { /* next time */ }
};
Collection.prototype.configured = function() { return !!(this.data.cfg.folders || []).length; };
Collection.prototype.step = function() { return this.stepMs || (this.token() ? 1100 : 2600); };
Collection.prototype.headers = function() {
  var t = this.token();
  return t ? {Authorization: 'Discogs token=' + t} : {};
};
/* one request at a time, at most one per step; 429 (too many requests): wait a minute */
Collection.prototype.get = function(path, cb) {
  var self = this, wait = Math.max(0, this.last + this.step() - this.now());
  this.last = this.now() + wait;
  setTimeout(function(){
    self.getJson(API + path, self.headers(), function(e, j){
      self.last = self.now();
      if (e && /429/.test(e.message || '')) self.last += 60000;
      cb(e, j);
    });
  }, wait);
};

/* the Discogs user: the one entered, else the owner of the token (GET /oauth/identity) */
Collection.prototype.user = function(cb) {
  var self = this, u = this.data.cfg.user;
  if (u) return cb(null, u);
  if (this.data.who) return cb(null, this.data.who);
  if (!this.token()) return cb(new Error('no user'));
  this.get('/oauth/identity', function(e, j){
    if (e || !j || !USER_RE.test(j.username || '')) return cb(e || new Error('no user'));
    self.data.who = j.username; self.save();
    cb(null, j.username);
  });
};

/* folders of a Discogs user (for the choice in the settings) -> cb(err, {user, folders: [{id, name, count}]});
   "All" (id 0) last, it holds every record */
Collection.prototype.folders = function(user, cb) {
  var self = this;
  user = String(user || '').trim();
  if (user && !USER_RE.test(user)) return cb(new Error('user'));
  function go(u) {
    self.get('/users/' + encodeURIComponent(u) + '/collection/folders', function(e, j){
      if (e) return cb(e);
      var list = ((j && j.folders) || []).map(function(f){ return {id: +f.id, name: String(f.name || ''), count: +f.count || 0}; });
      list.sort(function(a, b){ return (a.id === 0) - (b.id === 0); });
      cb(null, {user: u, folders: list});
    });
  }
  if (user) return go(user);
  if (!this.token()) return cb(new Error('no user'));
  this.get('/oauth/identity', function(e, j){
    if (e || !j || !USER_RE.test(j.username || '')) return cb(e || new Error('no user'));
    self.data.who = j.username; self.save();
    go(j.username);
  });
};

/* new configuration: read the folders again at once */
Collection.prototype.setConfig = function(c, cb) {
  var cfg = checkConfig(c);
  if (cfg.error) return cb(new Error(cfg.error));
  var before = JSON.stringify(this.data.cfg);
  this.data.cfg = cfg;
  if (!cfg.folders.length) { this.data.items = []; this.data.tracks = {}; this.data.at = 0; this.data.error = ''; }
  this.save(); this.rev++;
  if (cfg.folders.length && JSON.stringify(cfg) !== before) this.refresh();
  cb(null, cfg);
};

/* read all chosen folders page by page; the old list stays until the new one is complete */
Collection.prototype.refresh = function(cb) {
  var self = this;
  cb = cb || function(){};
  if (this.busy) return cb(new Error('busy'));
  if (!this.configured()) return cb(new Error('not configured'));
  this.busy = true;
  var folders = this.data.cfg.folders.slice(), items = [], seen = {};
  this.user(function(e, user){
    if (e) return finish(e);
    var fi = 0, page = 1;
    function next() {
      if (fi >= folders.length) return finish(null);
      var f = folders[fi];
      self.get('/users/' + encodeURIComponent(user) + '/collection/folders/' + f.id + '/releases?per_page=' + PER_PAGE + '&page=' + page +
               '&sort=artist&sort_order=asc', function(e2, j){
        if (e2) return finish(e2);
        ((j && j.releases) || []).forEach(function(r){
          var it = fromRelease(r, f.id), k = it.id + ':' + f.id;
          if (!it.id || seen[k] || items.length >= MAX_ITEMS) return;
          seen[k] = 1; items.push(it);
        });
        var pages = (j && j.pagination && +j.pagination.pages) || 1;
        if (page < pages && items.length < MAX_ITEMS) page++; else { fi++; page = 1; }
        next();
      });
    }
    next();
  });
  function finish(e) {
    self.busy = false;
    self.data.error = e ? String(e.message || e) : '';
    if (!e) {
      self.data.items = items; self.data.at = self.now();
      var keep = {};                                      /* tracklists of records still there */
      items.forEach(function(it){ if (self.data.tracks[it.id]) keep[it.id] = self.data.tracks[it.id]; });
      self.data.tracks = keep;
    } else self.data.at = self.data.at || 0;
    self.data.tried = self.now();
    self.save(); self.rev++;
    cb(e || null);
  }
};

/* next release without tracklist */
Collection.prototype.nextDetail = function() {
  var items = this.data.items, tr = this.data.tracks;
  for (var i = 0; i < items.length; i++) if (!tr[items[i].id]) return items[i];
  return null;
};
Collection.prototype.detail = function(it, cb) {
  var self = this;
  this.get('/releases/' + it.id, function(e, d){
    if (e && !/404/.test(e.message || '')) return cb(e);
    self.data.tracks[it.id] = e ? [] : fromTracklist(d);
    self.rev++;
    cb(null);
  });
};

/* background: folders once a day (or after an error after an hour), tracklists one after the other */
Collection.prototype.start = function() { if (!this.running) { this.running = true; this.schedule(5000); } };
Collection.prototype.stop = function() { this.running = false; clearTimeout(this.timer); };
Collection.prototype.schedule = function(ms) {
  var self = this;
  clearTimeout(this.timer);
  if (this.running) this.timer = setTimeout(function(){ self.tick(); }, ms);
};
Collection.prototype.tick = function(done) {
  var self = this, now = this.now();
  done = done || function(){};
  if (!this.configured() || this.busy) { this.schedule(60000); return done(); }
  var due = now - (this.data.at || 0) > REFRESH_MS && now - (this.data.tried || 0) > (this.data.error ? 3600000 : 0);
  if (due) return this.refresh(function(){ self.schedule(self.step()); done(); });
  var it = this.nextDetail();
  if (!it) { this.schedule(600000); return done(); }
  this.detail(it, function(e){
    if (e) { self.schedule(60000); return done(); }
    self.unsaved = (self.unsaved || 0) + 1;
    if (self.unsaved >= 10 || !self.nextDetail()) { self.unsaved = 0; self.save(); }   /* not after every record */
    self.schedule(self.step());
    done();
  });
};

Collection.prototype.status = function() {
  var d = this.data, withTracks = 0, self = this;
  d.items.forEach(function(it){ if (self.data.tracks[it.id]) withTracks++; });
  return {configured: this.configured(), user: d.cfg.user || d.who || '', folders: d.cfg.folders, count: d.items.length,
          tracks: withTracks, at: d.at ? Math.floor(d.at / 1000) : 0, error: d.error || '', busy: this.busy, token: !!this.token()};
};

/* label of a folder ("LP", "12″") */
Collection.prototype.label = function(f) {
  var hit = (this.data.cfg.folders || []).filter(function(x){ return x.id === f; })[0];
  return hit ? hit.label : '';
};

/* ---------- matching with the own library ---------- */
/* albums [{dir, al, ar}] -> index; match(it) -> dir of the own album or '' */
function Matcher(albums) {
  var by = {}, byTitle = {};
  (albums || []).forEach(function(a){
    var t = tkey(a.al), k = akey(a.ar) + '|' + t;
    if (!t) return;
    (by[k] || (by[k] = [])).push(a.dir);
    (byTitle[t] || (byTitle[t] = [])).push(a);
  });
  this.by = by; this.byTitle = byTitle;
}
Matcher.prototype.match = function(ar, al) { return this.matchAll(ar, al)[0] || ''; };
/* every own album that fits (several versions: "[HD]", CD rip …), in the order of the album list */
Matcher.prototype.matchAll = function(ar, al) {
  var t = tkey(al), a = akey(ar);
  if (!t) return [];
  if (this.by[a + '|' + t]) return this.by[a + '|' + t].slice();
  /* same title, artist written a little differently ("Simon & Garfunkel" / "Simon And Garfunkel", "A feat. B") */
  var cands = (this.byTitle[t] || []).filter(function(x){
    var b = akey(x.ar);
    return a && b && a.length >= 3 && b.length >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0);
  });
  return cands.map(function(x){ return x.dir; });
};
function sameAlbum(ar1, al1, ar2, al2) {
  var a = akey(ar1), b = akey(ar2);
  return tkey(al1) === tkey(al2) && !!tkey(al1) && (a === b || (a.length >= 3 && b.length >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)));
}

/* ---------- search ---------- */
function words(q) { return fold(q).split(/[^a-z0-9]+/).filter(Boolean); }
function hasAll(hay, ws) { for (var i = 0; i < ws.length; i++) if (hay.indexOf(ws[i]) < 0) return false; return true; }
/* items, tracks, q, limit -> {artists: [{name, n}], albums: [item], songs: [{t, p, d, item}]} */
function search(items, tracks, q, limit) {
  var ws = words(q), out = {artists: [], albums: [], songs: []};
  if (!ws.length) return out;
  limit = limit || 50;
  var arts = {}, seenAlbum = {};
  items.forEach(function(it){
    var ar = fold(it.ar), al = fold(it.al);
    (it.ar ? it.ar.split(/\s*(?:,|&|\band\b|\bfeat\.?|\bwith\b|\bund\b)\s*/i).concat([it.ar]) : []).forEach(function(n){
      n = n.trim();
      if (!n || !hasAll(fold(n), ws)) return;
      var k = akey(n);
      if (!arts[k]) arts[k] = {name: n, n: 0, seen: {}};
      if (!arts[k].seen[it.id]) { arts[k].seen[it.id] = 1; arts[k].n++; }
    });
    var key = it.id;
    if (!seenAlbum[key] && (hasAll(al, ws) || hasAll(ar + ' ' + al, ws))) { seenAlbum[key] = 1; out.albums.push(it); }
    (tracks[it.id] || []).forEach(function(t){
      if (out.songs.length < limit * 4 && hasAll(fold(t.t), ws)) out.songs.push({t: t.t, p: t.p, d: t.d || '', ar: t.ar || it.ar, item: it});
    });
  });
  out.artists = Object.keys(arts).map(function(k){ return {name: arts[k].name, n: arts[k].n}; })
    .sort(function(a, b){ return b.n - a.n || a.name.localeCompare(b.name); }).slice(0, limit);
  out.albums = out.albums.slice(0, limit);
  var seenSong = {};
  out.songs = out.songs.filter(function(s){ var k = s.item.id + '|' + s.t; if (seenSong[k]) return false; seenSong[k] = 1; return true; }).slice(0, limit);
  return out;
}

module.exports = {Collection: Collection, Matcher: Matcher, search: search, checkConfig: checkConfig, fromRelease: fromRelease,
                  fromTracklist: fromTracklist, akey: akey, tkey: tkey, sameAlbum: sameAlbum, cleanName: cleanName, credit: credit};
