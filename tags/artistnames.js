/* Usual spelling of artist names: each artist and album artist of the library is looked up once at MusicBrainz (artist
   search with aliases), and if nothing fits there at Last.fm (artist.getCorrection, key on the player). A name is only
   suggested if it differs merely in spelling (case, accents, umlauts, "The", punctuation, & / and) or is a known
   alias of that artist: a different name is never suggested. Names of several artists ("A feat. B", "A vs. B", "A & B")
   are first looked up as they are; without a hit each name on its own, and the suggestion puts them back together.
   Stored in artistnames.jsonl ({n: name, s: suggestion or '', src: 'mb'|'lf'|'', split: true, at}); names without a
   hit are tried again after RETRY_DAYS. At most one request per stepMs (slower while the release dates also use
   MusicBrainz). Node 8, ES5 only. */
var fs = require('fs');
var coversearch = require('./coversearch.js');

var STEP_MS = 1500, BUSY_MS = 3500;          /* MusicBrainz allows one request per second, shared with releasedates.js */
var RETRY_DAYS = 90;
var MIN_SCORE = 90;
var MB = process.env.MB_URL || 'https://musicbrainz.org';
var LASTFM = process.env.LASTFM_URL || 'https://ws.audioscrobbler.com/2.0/';
var DAY = 86400;
var SEP_RE = /(\s+(?:feat\.?|ft\.?|featuring|vs\.?|versus|with|meets|x|&|and|und|\+)\s+|\s*[,;\/]\s+)/i;   /* between two names */
var SKIP_RE = /^(various( artists)?|verschiedene( interpreten)?|va|unknown( artist)?|unbekannt)$/i;

/* spelling key: case, accents, "The", punctuation and & / and do not count; umlauts also as "ae" etc. */
function keys(name) {
  var s = String(name || '').toLowerCase().trim();
  function k(x) {
    if (x.normalize) x = x.normalize('NFKD');
    x = x.replace(/[\u0300-\u036f]/g, '').replace(/^the\s+/, '').replace(/\s*&\s*/g, ' and ').replace(/\s*\+\s*/g, ' and ');
    return x.replace(/[^a-z0-9]+/g, '');
  }
  var a = k(s), b = k(s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss'));
  return a === b ? [a] : [a, b];
}
function same(x, y) {
  var a = keys(x), b = keys(y);
  return !!a[0] && a.some(function(k){ return b.indexOf(k) >= 0; });
}
function quote(s) { return '"' + String(s || '').replace(/["\\]/g, '\\$&') + '"'; }
function parts(name) { return String(name || '').split(SEP_RE); }          /* [name, separator, name, …] */

/* best MusicBrainz hit: score high enough, and the name or one of its aliases is the same name in another spelling */
function pickMb(j, name) {
  var hit = ((j && j.artists) || []).filter(function(a){
    if ((a.score || 0) < MIN_SCORE || !a.name) return false;
    return [a.name].concat((a.aliases || []).map(function(x){ return x.name; })).some(function(n){ return same(n, name); });
  })[0];
  return hit ? hit.name : '';
}
function pickLastfm(j, name) {
  var c = j && j.corrections && j.corrections.correction, n = c && c.artist && c.artist.name;
  return n && same(n, name) ? n : '';
}

/* opts: file, names() -> [artist names of the library], lastfmKey() -> key or '', busy() -> true while MusicBrainz
   is also used elsewhere, getJson(url, cb) for testing, stepMs */
function Collector(opts) {
  this.file = opts.file; this.names = opts.names; this.lastfmKey = opts.lastfmKey || function(){ return ''; };
  this.busy = opts.busy || function(){ return false; };
  this.stepMs = opts.stepMs || STEP_MS; this.busyMs = opts.busyMs || BUSY_MS;
  this.getJson = opts.getJson || function(u, cb){
    coversearch.fetchUrl(u, 256 * 1024, function(e, r){
      if (e) return cb(e);
      try { cb(null, JSON.parse(r.body.toString('utf8'))); } catch (x) { cb(x); }
    });
  };
  this.by = {}; this.timer = null; this.running = false; this.fetched = 0;
  var self = this, txt = '';
  try { txt = fs.readFileSync(this.file, 'utf8'); } catch (e) { /* still empty */ }
  txt.split('\n').forEach(function(l){ try { var o = l && JSON.parse(l); if (o && o.n) self.by[o.n] = o; } catch (x) { /* skip */ } });
}

/* all names to look up: the library's, plus the single names of combinations without a hit */
Collector.prototype.all = function() {
  var out = [], seen = {}, self = this;
  function add(n) {
    n = String(n || '').trim();
    if (!n || seen[n] || SKIP_RE.test(n)) return;
    seen[n] = 1; out.push(n);
    var r = self.by[n];
    if (r && !r.s && r.split) parts(n).forEach(function(p, i){ if (i % 2 === 0) add(p); });
  }
  (this.names() || []).forEach(add);
  return out;
};

Collector.prototype.next = function(now) {
  var list = this.all();
  for (var i = 0; i < list.length; i++) {
    var r = this.by[list[i]];
    if (!r || (!r.s && now - r.at > RETRY_DAYS * DAY)) return list[i];
  }
  return null;
};

/* usual spelling of a name: {to, src} or null (no hit, or already spelled that way) */
Collector.prototype.suggest = function(name) {
  var r = this.by[name];
  if (r && r.s) return r.s === name ? null : {to: r.s, src: r.src};
  if (!r || !r.split) return null;
  var p = parts(name), src = {}, changed = false;
  for (var i = 0; i < p.length; i += 2) {
    var q = this.by[p[i].trim()];
    if (q && q.s && q.s !== p[i].trim()) { p[i] = p[i].replace(p[i].trim(), q.s); src[q.src] = 1; changed = true; }
  }
  return changed ? {to: p.join(''), src: Object.keys(src).sort().join('+')} : null;
};

Collector.prototype.status = function() {
  var list = this.all(), self = this, n = 0;
  list.forEach(function(x){ if (self.by[x]) n++; });
  return {names: list.length, done: n, fetched: this.fetched, running: this.running};
};

Collector.prototype.start = function() { if (!this.running) { this.running = true; this.schedule(this.stepMs); } };
Collector.prototype.stop = function() { this.running = false; clearTimeout(this.timer); };
Collector.prototype.schedule = function(ms) {
  var self = this;
  clearTimeout(this.timer);
  if (this.running) this.timer = setTimeout(function(){ self.step(); }, ms);
};
Collector.prototype.pause = function() { return this.busy() ? this.busyMs : this.stepMs; };

Collector.prototype.step = function(done) {
  var self = this, now = Math.floor(Date.now() / 1000);
  if (!(this.names() || []).length) { this.schedule(60000); return done && done(); }   /* track list not read yet */
  var name = this.next(now);
  if (!name) { this.schedule(3600000); return done && done(); }        /* all done: check hourly for new names */
  this.getJson(MB + '/ws/2/artist/?fmt=json&limit=5&query=' + encodeURIComponent(quote(name)), function(e, j){
    if (e) { self.schedule(60000); return done && done(e); }           /* network or MusicBrainz gone: continue later */
    var s = pickMb(j, name);
    function save(sug, src) {
      var rec = {n: name, s: sug, src: sug ? src : '', at: now};
      if (!sug && parts(name).length > 1) rec.split = true;           /* look up the single names next */
      self.by[name] = rec; self.fetched++;
      try { fs.appendFileSync(self.file, JSON.stringify(rec) + '\n'); } catch (x) { /* next time */ }
      self.schedule(self.pause());
      if (done) done();
    }
    if (s) return save(s, 'mb');
    var key = self.lastfmKey();
    if (!key) return save('', '');
    self.getJson(LASTFM + '?method=artist.getcorrection&format=json&api_key=' + encodeURIComponent(key) + '&artist=' + encodeURIComponent(name), function(e2, j2){
      save(e2 ? '' : pickLastfm(j2, name), 'lf');
    });
  });
};

/* library check: names with another usual spelling, grouped by it: [{to, src, variants: [{name, count}]}], most tracks
   first. counts: {name: tracks with it as artist or album artist} (saved by the check); kept(name, to) -> true to leave out */
function fixes(counts, suggest, kept) {
  var by = {};
  Object.keys(counts || {}).forEach(function(n){
    var s = suggest(n);
    if (!s || s.to === n || (kept && kept(n, s.to))) return;
    var g = by[s.to] || (by[s.to] = {to: s.to, src: s.src, variants: [], n: 0});
    g.variants.push({name: n, count: counts[n]}); g.n += counts[n];
    if (g.src.indexOf(s.src) < 0) g.src = [g.src, s.src].filter(Boolean).sort().join('+');
  });
  return Object.keys(by).map(function(k){ return by[k]; }).sort(function(a, b){ return b.n - a.n || a.to.localeCompare(b.to); })
    .map(function(g){ g.variants.sort(function(a, b){ return b.count - a.count; }); delete g.n; return g; });
}

module.exports = {Collector: Collector, fixes: fixes, same: same, parts: parts, pickMb: pickMb, pickLastfm: pickLastfm};
