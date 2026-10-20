/* Release dates of the albums for the birthdays: full Date tag from the files (albums.json: rd), else looked up once at
   MusicBrainz (release group, first release), at most one request per STEP_MS.
   Stored in releasedates.jsonl ({dir, d: 'YYYY-MM-DD' or '' = not found, at}); items not found are retried after
   RETRY_DAYS. Node 8, ES5 only. */
var fs = require('fs');
var coversearch = require('./coversearch.js');

var STEP_MS = 1500;              /* MusicBrainz allows one request per second */
var RETRY_DAYS = 90;
var MIN_SCORE = 90;
var MB = process.env.MB_URL || 'https://musicbrainz.org';
var DAY = 86400;

function full(d) { return /^\d{4}-\d\d-\d\d$/.test(d || '') ? d : ''; }
/* title comparison: like coversearch.key, but bracketed additions count ("(Live)" is a different album) */
function tkey(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  return s.replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}
function quote(s) { return '"' + String(s || '').replace(/["\\]/g, '\\$&') + '"'; }

/* best hit of a MusicBrainz response: title and artist match, date complete, not later than the own year */
function pickDate(j, al, ar, y) {
  var hit = ((j && j['release-groups']) || []).filter(function(g){
    var credit = (g['artist-credit'] || []).map(function(c){ return c.name || (c.artist && c.artist.name) || ''; }).join(' ');
    var d = full(g['first-release-date']);
    return (g.score || 0) >= MIN_SCORE && d && tkey(g.title) === tkey(al) &&
           coversearch.key(credit).indexOf(coversearch.key(ar)) >= 0 && !(y && +d.slice(0, 4) > y + 1);
  })[0];
  return hit ? hit['first-release-date'] : '';
}

/* opts: file, list() -> album list (albums.json), getJson(url, cb) for testing, stepMs */
function Collector(opts) {
  this.file = opts.file; this.list = opts.list; this.stepMs = opts.stepMs || STEP_MS;
  this.getJson = opts.getJson || function(u, cb){
    coversearch.fetchUrl(u, 256 * 1024, function(e, r){
      if (e) return cb(e);
      try { cb(null, JSON.parse(r.body.toString('utf8'))); } catch (x) { cb(x); }
    });
  };
  this.by = {}; this.timer = null; this.running = false; this.fetched = 0; this.rev = 0;
  var self = this, txt = '';
  try { txt = fs.readFileSync(this.file, 'utf8'); } catch (e) { /* still empty */ }
  txt.split('\n').forEach(function(l){ try { var o = l && JSON.parse(l); if (o && o.dir) self.by[o.dir] = o; } catch (x) { /* skip */ } });
}

/* date of an album: Date tag, else looked up; '' unknown */
Collector.prototype.dateOf = function(a) { return full(a.rd) || (this.by[a.dir] && this.by[a.dir].d) || ''; };

/* next album without date that has not been looked up yet (or unsuccessfully more than RETRY_DAYS ago) */
Collector.prototype.next = function(now) {
  var list = this.list() || [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i], r = this.by[a.dir];
    if (full(a.rd) || !a.al || !a.ar || a.ar === 'Verschiedene') continue;
    if (!r || (!r.d && now - r.at > RETRY_DAYS * DAY)) return a;
  }
  return null;
};

Collector.prototype.status = function() {
  var list = this.list() || [], self = this, n = 0;
  list.forEach(function(a){ if (self.dateOf(a)) n++; });
  return {albums: list.length, dated: n, fetched: this.fetched, running: this.running};
};

Collector.prototype.start = function() { if (!this.running) { this.running = true; this.schedule(this.stepMs); } };
Collector.prototype.stop = function() { this.running = false; clearTimeout(this.timer); };
Collector.prototype.schedule = function(ms) {
  var self = this;
  clearTimeout(this.timer);
  if (this.running) this.timer = setTimeout(function(){ self.step(); }, ms);
};

Collector.prototype.step = function(done) {
  var self = this, now = Math.floor(Date.now() / 1000), a = this.next(now);
  if (!(this.list() || []).length) { this.schedule(60000); return done && done(); }   /* album list not read yet */
  if (!a) { this.schedule(3600000); return done && done(); }           /* all done: check hourly for new albums */
  var q = 'releasegroup:' + quote(a.al) + ' AND artist:' + quote(a.ar);
  this.getJson(MB + '/ws/2/release-group/?fmt=json&limit=5&query=' + encodeURIComponent(q), function(e, j){
    if (e) { self.schedule(60000); return done && done(e); }           /* network or MusicBrainz gone: continue later */
    var rec = {dir: a.dir, d: pickDate(j, a.al, a.ar, a.y), at: now};
    self.by[a.dir] = rec; self.fetched++; self.rev++;
    try { fs.appendFileSync(self.file, JSON.stringify(rec) + '\n'); } catch (x) { /* next time */ }
    self.schedule(self.stepMs);
    if (done) done();
  });
};

/* birthdays for the day day ('YYYY-MM-DD', date at the listener): today, this week (Monday to Sunday, without today),
   this month (without the week). dateOf(a) -> 'YYYY-MM-DD' or ''. Per entry {dir, al, ar, y, date, years, mark}:
   mark 'jubilee' at 25, 50, 75 … years, 'round' at 10, 20, 30 …; marked ones first, else by day. */
function birthdays(list, dateOf, day, limit) {
  var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(day || '');
  if (!m) return {today: [], week: [], month: []};
  var Y = +m[1], M = +m[2], D = +m[3], t0 = Date.UTC(Y, M - 1, D);
  var wd = (new Date(t0).getUTCDay() + 6) % 7, mon = t0 - wd * DAY * 1000, sun = mon + 6 * DAY * 1000;
  var leap = (Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0;
  var out = {today: [], week: [], month: []};
  list.forEach(function(a){
    var d = dateOf(a), x = /^(\d{4})-(\d\d)-(\d\d)$/.exec(d);
    if (!x) return;
    var years = Y - +x[1], mm = +x[2], dd = +x[3];
    if (years <= 0) return;
    if (mm === 2 && dd === 29 && !leap) dd = 28;
    var t = Date.UTC(Y, mm - 1, dd);
    var o = {dir: a.dir, al: a.al, ar: a.ar, date: d, years: years, mark: years % 25 === 0 ? 'jubilee' : years % 10 === 0 ? 'round' : ''};
    if (a.y) o.y = a.y;
    if (t === t0) out.today.push(o);
    else if (t >= mon && t <= sun) out.week.push(o);
    else if (mm === M) out.month.push(o);
  });
  var rank = {jubilee: 0, round: 1, '': 2};
  Object.keys(out).forEach(function(k){
    out[k].sort(function(a, b){ return rank[a.mark] - rank[b.mark] || a.date.slice(5).localeCompare(b.date.slice(5)) || b.years - a.years; });
    out[k] = out[k].slice(0, limit || 24);
  });
  return out;
}

/* library check: albums whose Date tag differs from the MusicBrainz release date (different year, different full
   date or none at all). A year-only tag that matches the MusicBrainz year counts as consistent.
   albumList: albums.fromSongs(songs); songs: as from mpdWalk; mbOf(dir) -> 'YYYY-MM-DD' or ''; albumDir as in albums.albumDir
   -> [{dir, name, artist, count, tag, mb, files: [{uri, title}]}] */
function diffs(albumList, songs, mbOf, albumDir) {
  var byDir = {};
  songs.forEach(function(s){ var d = albumDir(s.file); (byDir[d] || (byDir[d] = [])).push(s); });
  var out = [];
  albumList.forEach(function(a){
    var mb = mbOf(a.dir), tag = full(a.rd) || (a.y ? String(a.y) : '');
    if (!mb || (tag && tag.slice(0, 4) === mb.slice(0, 4) && (tag.length === 4 || tag === mb))) return;
    var list = byDir[a.dir] || [];
    out.push({dir: a.dir, name: a.al, artist: a.ar, count: list.length, tag: tag, mb: mb,
              files: list.map(function(s){ return {uri: s.file, title: s.title || s.file.replace(/^.*\//, '')}; })});
  });
  return out.sort(function(a, b){ return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name); });
}

module.exports = {Collector: Collector, birthdays: birthdays, pickDate: pickDate, diffs: diffs};
