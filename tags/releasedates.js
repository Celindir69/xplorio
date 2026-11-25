/* Release dates of the albums for the birthdays and the library check: full Date tag from the files (albums.json: rd), else looked up once at
   MusicBrainz (release group, first release), at most one request per STEP_MS.
   Stored in releasedates.jsonl ({dir, d: 'YYYY-MM-DD' or '' = not found, at}); items not found are retried after
   RETRY_DAYS. Node 8, ES5 only. */
var fs = require('fs');
var coversearch = require('./coversearch.js');
var libcheck = require('./libcheck.js');
var mbgate = require('./mbgate.js');            /* all MusicBrainz requests in one queue (one per second, pause on 503) */

var STEP_MS = 1500;              /* MusicBrainz allows one request per second */
var RETRY_DAYS = 90;
var MIN_SCORE = 90;
var MB = process.env.MB_URL || 'https://musicbrainz.org';
var DAY = 86400;

function full(d) { return /^\d{4}-\d\d-\d\d$/.test(d || '') ? d : ''; }
/* a date MusicBrainz may give: year, year-month or full ('1975', '1975-03', '1975-03-14') */
function month(d) { return /^\d{4}-\d\d$/.test(d || '') ? d : ''; }
function dateLike(d) { return /^\d{4}(-\d\d){0,2}$/.test(d || '') ? d : ''; }
/* records from before VERSION (only full dates, edition additions counted) are looked up once more */
var VERSION = 2;
/* edition additions that name the same album: "(Remastered 2011)", "[Deluxe Edition]", "(40th Anniversary)" … ; not
   "(Live)", "(Demo)" and the like, which are different albums */
var EDITION_RE = /\b(remaster(ed)?|deluxe|expanded|anniversary|edition|bonus|re-?issue|special|collector'?s?|legacy|jubil[aä]ums)/i;
var OTHER_RE = /\b(live|demo|acoustic|unplugged|remix(es)?|instrumental|sessions?)\b/i;
function stripEdition(s) {
  return String(s || '').replace(/\s*[\(\[]([^\)\]]*)[\)\]]/g, function(m, inner){ return EDITION_RE.test(inner) && !OTHER_RE.test(inner) ? '' : m; }).trim();
}
/* title comparison: like coversearch.key, but bracketed additions count ("(Live)" is a different album) */
function tkey(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  return s.replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}
function quote(s) { return '"' + String(s || '').replace(/["\\]/g, '\\$&') + '"'; }

/* best hit of a MusicBrainz response: title (edition additions aside) and artist match, a date (full ones first; the
   library check needs only the year), not later than the own year -> {d: 'YYYY[-MM[-DD]]', t: title at MusicBrainz} or null */
function pickHit(j, al, ar, y) {
  var hits = ((j && j['release-groups']) || []).filter(function(g){
    var credit = (g['artist-credit'] || []).map(function(c){ return c.name || (c.artist && c.artist.name) || ''; }).join(' ');
    var d = dateLike(g['first-release-date']);
    return (g.score || 0) >= MIN_SCORE && d && tkey(stripEdition(g.title)) === tkey(stripEdition(al)) &&
           coversearch.key(credit).indexOf(coversearch.key(ar)) >= 0 && !(y && +d.slice(0, 4) > y + 1);
  });
  var hit = hits.filter(function(g){ return full(g['first-release-date']); })[0] || hits[0];
  return hit ? {d: hit['first-release-date'], t: hit.title || ''} : null;
}
function pickDate(j, al, ar, y) { var h = pickHit(j, al, ar, y); return h ? h.d : ''; }

/* opts: file, list() -> album list (albums.json), extra() -> further albums [{dir, al, ar, y}] to look up even with a full
   Date tag (library check: year or album name not the same in all tracks; title t then gives the MusicBrainz spelling),
   more() -> albums outside the library looked up after it (records from the Discogs collection, vinyl.js),
   getJson(url, cb) for testing, stepMs */
function Collector(opts) {
  this.file = opts.file; this.list = opts.list; this.extra = opts.extra || function(){ return []; }; this.stepMs = opts.stepMs || STEP_MS;
  this.more = opts.more || function(){ return []; };
  this.getJson = opts.getJson || mbgate.getJson;
  this.by = {}; this.timer = null; this.running = false; this.fetched = 0; this.rev = 0; this.errors = 0;
  var self = this, txt = '';
  try { txt = fs.readFileSync(this.file, 'utf8'); } catch (e) { /* still empty */ }
  txt.split('\n').forEach(function(l){ try { var o = l && JSON.parse(l); if (o && o.dir) self.by[o.dir] = o; } catch (x) { /* skip */ } });
}

/* date of an album: Date tag, else looked up; '' unknown */
Collector.prototype.dateOf = function(a) {   /* full date, else year-month (counts for the month only); '' unknown */
  var mb = this.by[a.dir] && this.by[a.dir].d;
  return full(a.rd) || full(mb) || month(a.rd) || month(mb) || '';
};

/* next album without date that has not been looked up yet (or unsuccessfully more than RETRY_DAYS ago) */
Collector.prototype.next = function(now) {
  var ex = this.extra() || [];
  for (var k = 0; k < ex.length; k++) {
    var e = ex[k], q = this.by[e.dir];
    if (!e.al || !e.ar || e.ar === 'Verschiedene') continue;
    if (!q || q.t === undefined || (!q.d && (q.v !== VERSION || now - q.at > RETRY_DAYS * DAY))) return e;   /* older records: once more */
  }
  var list = this.list() || [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i], r = this.by[a.dir];
    if (full(a.rd) || !a.al || !a.ar || a.ar === 'Verschiedene') continue;   /* year-month only: MusicBrainz may know the day */
    if (!r || (!r.d && (r.v !== VERSION || now - r.at > RETRY_DAYS * DAY))) return a;
  }
  var more = this.more() || [];
  for (var m = 0; m < more.length; m++) {
    var o = more[m], s = this.by[o.dir];
    if (!o.al || !o.ar || o.ar === 'Verschiedene') continue;
    if (!s || (!s.d && (s.v !== VERSION || now - s.at > RETRY_DAYS * DAY))) return o;
  }
  return null;
};

Collector.prototype.status = function() {
  var list = this.list() || [], self = this, n = 0;
  list.forEach(function(a){ if (self.dateOf(a)) n++; });
  return {albums: list.length, dated: n, fetched: this.fetched, running: this.running};
};
/* lookup progress for the library check: the albums of the check (extra, looked up first) and the rest of the library,
   each {todo, done, found}: to look up, looked up with the current rules, found; errors: failed requests since the start */
Collector.prototype.progress = function() {
  var self = this, seen = {}, now = Math.floor(Date.now() / 1000);
  var check = {todo: 0, done: 0, found: 0}, rest = {todo: 0, done: 0, found: 0};
  function count(a, need, into) {
    if (!a || !a.dir || seen[a.dir] || !need) return;
    seen[a.dir] = 1; into.todo++;
    var r = self.by[a.dir];
    if (r && (r.d || (r.v === VERSION && now - r.at <= RETRY_DAYS * DAY))) { into.done++; if (r.d) into.found++; }
  }
  (this.extra() || []).forEach(function(e){ count(e, e.al && e.ar && e.ar !== 'Verschiedene', check); });
  (this.list() || []).forEach(function(a){ count(a, !full(a.rd) && a.al && a.ar && a.ar !== 'Verschiedene', rest); });
  return {check: check, rest: rest, errors: this.errors, running: this.running};
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
  var al = stripEdition(libcheck.bareAlbum(a.al) || a.al) || a.al;   /* "Album (Disc 2)", "Album (Remastered)": search for "Album" */
  var q = 'releasegroup:' + quote(al) + ' AND artist:' + quote(a.ar);
  this.getJson(MB + '/ws/2/release-group/?fmt=json&limit=5&query=' + encodeURIComponent(q), function(e, j){
    if (e) { self.errors++; self.schedule(60000); return done && done(e); }   /* network or MusicBrainz gone (503 already retried): later */
    var h = pickHit(j, al, a.ar, a.y), rec = {dir: a.dir, d: h ? h.d : '', t: h ? h.t : '', at: now, v: VERSION};
    self.by[a.dir] = rec; self.fetched++; self.rev++;
    try { fs.appendFileSync(self.file, JSON.stringify(rec) + '\n'); } catch (x) { /* next time */ }
    self.schedule(mbgate.shared.congested() ? 4 * self.stepMs : self.stepMs);   /* MusicBrainz busy: slower for a while */
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
    var d = dateOf(a), x = /^(\d{4})-(\d\d)(?:-(\d\d))?$/.exec(d);
    if (!x) return;
    var years = Y - +x[1], mm = +x[2], dd = +x[3];
    if (years <= 0) return;
    if (!x[3]) {                                         /* only year and month known: this month, not today or this week */
      if (mm !== M) return;
      var om = {dir: a.dir, al: a.al, ar: a.ar, date: d, years: years, mark: years % 25 === 0 ? 'jubilee' : years % 10 === 0 ? 'round' : ''};
      if (a.y) om.y = a.y;
      out.month.push(om);
      return;
    }
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
    var mb = mbOf(a.dir), tag = dateLike(a.rd) || (a.y ? String(a.y) : '');
    if (!mb || (tag && tag.slice(0, 4) === mb.slice(0, 4) && (tag.length === 4 || mb.length < 10 || tag === mb))) return;   /* MusicBrainz knows only year (and month): the year counts */
    var list = byDir[a.dir] || [];
    out.push({dir: a.dir, name: a.al, artist: a.ar, count: list.length, tag: tag, mb: mb,
              files: list.map(function(s){ return {uri: s.file, title: s.title || s.file.replace(/^.*\//, '')}; })});
  });
  return out.sort(function(a, b){ return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name); });
}

module.exports = {Collector: Collector, birthdays: birthdays, pickDate: pickDate, pickHit: pickHit, diffs: diffs, stripEdition: stripEdition};
