/* History: record plays (via Volumio's getState), store and evaluate them.
   A track counts as played if it is longer than 30 s and played for half its length or 4 minutes (as with scrobbling).
   Each play is one line in plays.jsonl: {t: start (Unix seconds), ar, ti, al, u: uri, d: duration s, s: source}.
   Node 8, ES5 only. */
var fs   = require('fs');
var path = require('path');
var jsonl = require('./jsonl.js');

var MIN_TRACK  = 30;          /* s: shorter tracks never count */
var MAX_NEEDED = 240;         /* s: after 4 minutes every track counts */
var MAX_STEP   = 30000;       /* ms: more play time per poll is not counted (service hung, computer slept) */
var DUP_WINDOW = 300;         /* s: same track within 5 min = the same play (Last.fm sync) */

/* comparison key: ignoring accents, case, punctuation */
function norm(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  return s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}
/* compute normalized keys once per entry (non-enumerable: they don't end up in JSON or the file) */
function keys(e) {
  if (!e._n) Object.defineProperty(e, '_n', {value: {ar: norm(e.ar), ti: norm(e.ti), al: e.al ? norm(e.al) : ''}});
  return e._n;
}
function trackKey(e) { var k = keys(e); return k.ar + '|' + k.ti; }

/* ---------- storage ---------- */

function Store(file) { this.file = file; this.list = null; }

Store.prototype.load = function() {
  if (this.list) return this.list;
  var list = [];
  jsonl.eachLine(this.file, function(line){                 /* file missing: still empty */
    var e = jsonl.parse(line); if (e && e.t && e.ti) list.push(e);   /* skip broken lines */
  });
  list.sort(function(a, b){ return a.t - b.t; });
  this.list = list;
  return list;
};

/* append entries (file and memory); returns true if written */
Store.prototype.add = function(entries) {
  if (!entries.length) return true;
  var list = this.load(), ok = true;
  try { fs.mkdirSync(path.dirname(this.file)); } catch (e) { /* already exists */ }
  try { fs.appendFileSync(this.file, entries.map(function(e){ return JSON.stringify(e); }).join('\n') + '\n'); }
  catch (e) { ok = false; }
  var idx = this.idx;
  entries.forEach(function(e){ if (idx) { var k = trackKey(e); (idx[k] || (idx[k] = [])).push(e.t); } });
  var add = entries.slice().sort(function(a, b){ return a.t - b.t; });
  /* merge into the list sorted by t, from the back (Last.fm import brings older pages: no re-sorting of the whole history) */
  var i = list.length - 1, j = add.length - 1, w = list.length + add.length - 1;
  list.length += add.length;
  while (j >= 0) {
    if (i >= 0 && list[i].t > add[j].t) list[w--] = list[i--];
    else list[w--] = add[j--];
  }
  return ok;
};

/* only the entries not yet in the history (same track within 5 min) */
Store.prototype.fresh = function(entries) {
  var idx = this.idx, seen = {};
  if (!idx) {                                            /* track -> times; stays in memory afterwards (add keeps it up to date) */
    idx = this.idx = {};
    this.load().forEach(function(e){ var k = trackKey(e); (idx[k] || (idx[k] = [])).push(e.t); });
  }
  return entries.filter(function(e){
    var k = trackKey(e), ts = (idx[k] || []).concat(seen[k] || []);
    for (var i = 0; i < ts.length; i++) if (Math.abs(ts[i] - e.t) <= DUP_WINDOW) return false;
    (seen[k] || (seen[k] = [])).push(e.t);
    return true;
  });
};

/* ---------- recording ---------- */

/* call update(state, now in ms) with every getState response; onPlay(entry) for each counted play,
   onStart(entry) when a new track starts playing (for "now playing") */
function Tracker(onPlay, onStart) {
  this.cur = null;
  this.onPlay = onPlay;
  this.onStart = onStart || function(){};
}

function stateKey(st) { return [st.uri || '', st.artist || '', st.title || ''].join('\n'); }
function countable(st) {
  return !!(st && st.title && st.artist && st.service !== 'webradio' && st.trackType !== 'webradio');
}

Tracker.prototype.finish = function() {
  var c = this.cur;
  this.cur = null;
  if (!c) return;
  var played = c.played / 1000, d = c.entry.d;
  var needed = d > 0 ? Math.min(d / 2, MAX_NEEDED) : MAX_NEEDED;
  if ((d > 0 && d <= MIN_TRACK) || played < needed || played < MIN_TRACK) return;
  this.onPlay(c.entry);
};

Tracker.prototype.update = function(st, now) {
  st = st || {};
  var c = this.cur, seek = Math.max(0, Number(st.seek) || 0);
  var playing = st.status === 'play';
  var same = !!c && stateKey(st) === c.key;
  if (same && playing && seek + 5000 < c.seek && seek < 15000) same = false;     /* from the start (repeat) */

  if (c && c.playing) {
    var step = Math.min(now - c.last, MAX_STEP);
    if (!same && playing) step -= seek;                  /* the new track has been playing since "seek" */
    c.played += Math.max(0, step);
  }
  if (c && (!same || st.status === 'stop')) this.finish();
  c = this.cur;
  if (!c && playing && countable(st)) {
    c = this.cur = {
      key: stateKey(st), played: Math.min(seek, MAX_STEP), seek: seek,
      entry: {t: Math.round((now - seek) / 1000), ar: st.artist, ti: st.title, al: st.album || '',
              u: st.uri || '', d: Math.round(Number(st.duration) || 0), s: st.service || ''}
    };
    if (!c.entry.al) delete c.entry.al;
    if (!c.entry.u) delete c.entry.u;
    if (!c.entry.d) delete c.entry.d;
    if (seek < 15000) this.onStart(c.entry);
  }
  if (c) { c.playing = playing; c.last = now; c.seek = seek; }
};

/* ---------- evaluate ---------- */

var DAY = 86400;

/* local time: offset in minutes for winter (tzw) and summer (tzs); switch by the EU rule */
function lastSunday(y, m) { var d = new Date(Date.UTC(y, m + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime() / 1000; }
function local(t, tz) {
  var off = tz.w;
  if (tz.s !== tz.w) {
    var y = new Date(t * 1000).getUTCFullYear();
    if (t >= lastSunday(y, 2) && t < lastSunday(y, 9)) off = tz.s;
  }
  return new Date((t + off * 60) * 1000);              /* use only getUTC… */
}
function two(n) { return (n < 10 ? '0' : '') + n; }
function dayKey(d) { return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()); }
function monthKey(d) { return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1); }

function rangeStart(range, now) {
  if (range === 'd30') return now - 30 * DAY;
  if (range === 'm12') return now - 365 * DAY;
  return 0;
}
function firstAt(list, t) {
  var lo = 0, hi = list.length;                           /* list is sorted by t */
  while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}
function since(list, t) { return list.slice(firstAt(list, t)); }
/* entries with from <= t < to (to missing: until now) */
function between(list, from, to) { return list.slice(firstAt(list, from), to ? firstAt(list, to) : list.length); }

/* newest first, before "before" */
function recent(list, before, limit) {
  var out = [];
  for (var i = list.length - 1; i >= 0 && out.length < limit; i--) if (!before || list[i].t < before) out.push(list[i]);
  return out;
}

/* most played: kind track|album|artist */
function top(list, kind, from, limit, to) {
  var part = between(list, from, to), groups = {}, order = [];
  var albumDir = {};                                     /* album+artist -> folder: compilation tracks by different artists together */
  if (kind === 'album') part.forEach(function(e){
    if (e.al && e.u && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u)) albumDir[keys(e).al + '|' + keys(e).ar] = path.dirname(e.u);
  });
  for (var i = part.length - 1; i >= 0; i--) {           /* newest first: display and uri from the last time */
    var e = part[i], k;
    if (kind === 'artist') k = keys(e).ar;
    else if (kind === 'album') { if (!e.al) continue; k = keys(e).al + '|' + keys(e).ar; k = albumDir[k] || k; }
    else k = trackKey(e);
    if (!k) continue;
    var g = groups[k];
    if (!g) {
      g = groups[k] = {n: 0, last: e.t, ar: e.ar, artists: {}};
      if (kind !== 'artist') { g.ti = kind === 'album' ? e.al : e.ti; g.al = e.al || ''; }
      order.push(k);
    }
    g.n++;
    g.artists[keys(e).ar] = true;
    if (!g.u && e.u) g.u = kind === 'album' && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u) ? path.dirname(e.u) : (kind === 'track' ? e.u : undefined);
  }
  return order.map(function(k){
    var g = groups[k], o = {n: g.n, last: g.last, ar: g.ar};
    if (kind === 'album' && Object.keys(g.artists).length > 2) o.ar = 'Verschiedene';
    if (g.ti) o.ti = g.ti;
    if (kind === 'track' && g.al) o.al = g.al;
    if (g.u) o.u = g.u;
    return o;
  }).sort(function(a, b){ return b.n - a.n || b.last - a.last; }).slice(0, limit);
}

/* totals: plays, listening time (estimated with the median without known length), distinct tracks, artists, albums */
function totals(part) {
  var known = part.filter(function(e){ return e.d > 0; }).map(function(e){ return e.d; }).sort(function(a, b){ return a - b; });
  var est = known.length ? known[known.length >> 1] : MAX_NEEDED;
  var res = {plays: part.length, seconds: 0, estimated: 0, tracks: 0, artists: 0, albums: 0}, tr = {}, ar = {}, al = {};
  part.forEach(function(e){
    if (e.d > 0) res.seconds += e.d; else { res.seconds += est; res.estimated++; }
    tr[trackKey(e)] = 1; ar[keys(e).ar] = 1;
    if (e.al) al[keys(e).al + '|' + keys(e).ar] = 1;
  });
  res.tracks = Object.keys(tr).length; res.artists = Object.keys(ar).length; res.albums = Object.keys(al).length;
  return res;
}

/* statistics: totals, timeline (days/months/years), time of day, weekday; with genreOf (albums.genreIndex) the top 8 genres */
function stats(list, range, now, tz, genreOf) {
  var from = rangeStart(range, now), part = since(list, from);
  var res = totals(part);
  res.unit = range === 'd30' ? 'day' : range === 'm12' ? 'month' : 'year';
  res.buckets = []; res.hours = []; res.weekdays = [0, 0, 0, 0, 0, 0, 0]; res.first = list.length ? list[0].t : null;
  for (var h = 0; h < 24; h++) res.hours.push(0);
  var bkeys = [], idx = {};
  function bucket(k) { if (!(k in idx)) { idx[k] = bkeys.length; bkeys.push(k); } }
  var nowL = local(now, tz);
  if (res.unit === 'day') for (var i = 29; i >= 0; i--) bucket(dayKey(local(now - i * DAY, tz)));
  else if (res.unit === 'month') {
    for (i = 11; i >= 0; i--) bucket(monthKey(new Date(Date.UTC(nowL.getUTCFullYear(), nowL.getUTCMonth() - i, 1))));
  } else if (part.length) {
    for (var y = local(part[0].t, tz).getUTCFullYear(); y <= nowL.getUTCFullYear(); y++) bucket(String(y));
  }
  var counts = bkeys.map(function(){ return 0; });
  part.forEach(function(e){
    var d = local(e.t, tz);
    var k = res.unit === 'day' ? dayKey(d) : res.unit === 'month' ? monthKey(d) : String(d.getUTCFullYear());
    if (k in idx) counts[idx[k]]++;
    res.hours[d.getUTCHours()]++;
    res.weekdays[(d.getUTCDay() + 6) % 7]++;            /* Monday first */
  });
  res.buckets = bkeys.map(function(k, i){ return {k: k, n: counts[i]}; });
  res.genres = genreOf ? topGenres(part, genreOf, 8) : [];
  return res;
}

/* start of a local date (year, month 0-11, day) as Unix seconds */
function localStart(y, m, d, tz) {
  var t = Date.UTC(y, m, d) / 1000 - tz.w * 60;
  return t - (local(t, tz).getUTCHours() ? (tz.s - tz.w) * 60 : 0);     /* daylight saving time */
}

/* year in review for the local year y: totals, months, top albums, artists, tracks, newly discovered artists.
   Comparison with the previous year; in the current year only with the same period (up to today) */
function year(list, y, tz, now, limit, genreOf, month) {
  limit = limit || 10;
  var from = localStart(y, 0, 1, tz), to = localStart(y + 1, 0, 1, tz), pfrom = localStart(y - 1, 0, 1, tz);
  var part = between(list, from, to), res = totals(part);
  res.year = y;
  res.partial = now < to;
  res.prev = totals(between(list, pfrom, res.partial ? pfrom + Math.max(0, now - from) : from));
  res.months = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  part.forEach(function(e){ res.months[local(e.t, tz).getUTCMonth()]++; });
  /* rankings for the whole year or one month (month 0-11) */
  if (month >= 0 && month < 12) { res.month = month; from = localStart(y, month, 1, tz); to = localStart(y, month + 1, 1, tz); part = between(list, from, to); }
  res.albums_top  = top(list, 'album', from, limit, to);
  res.artists_top = top(list, 'artist', from, limit, to);
  res.tracks_top  = top(list, 'track', from, 5, to);
  res.genres_top  = genreOf ? topGenres(part, genreOf, limit) : [];
  /* newly discovered: artists that never played before; only if the history starts earlier */
  res.newArtists = [];
  res.hasBefore = !!list.length && list[0].t < from;
  if (res.hasBefore) {
    var before = {};
    for (var i = 0; i < list.length && list[i].t < from; i++) before[keys(list[i]).ar] = true;
    res.newArtists = top(list, 'artist', from, 1000, to).filter(function(a){ return !before[norm(a.ar)]; }).slice(0, limit);
  }
  return res;
}

/* top genres: plays per genre; multiple genres ("Rock; Pop", "Rock/Pop") count separately.
   withAlbum: plus the genre's most played album (ar, al, u = folder) for the image */
function topGenres(part, genreOf, limit, withAlbum) {
  var groups = {};
  part.forEach(function(e){
    var seen = {};
    String(genreOf(e) || '').split(/\s*[;\/,|]\s*/).forEach(function(g){
      g = g.trim();
      var k = g.toLowerCase();
      if (!g || seen[k]) return;
      seen[k] = true;
      var grp = groups[k] || (groups[k] = {g: g, n: 0, albums: {}});
      grp.n++;
      if (withAlbum && e.al) {
        var a = grp.albums[keys(e).al + '|' + keys(e).ar] || (grp.albums[keys(e).al + '|' + keys(e).ar] = {n: 0, ar: e.ar, al: e.al});
        a.n++;
        if (!a.u && e.u && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u)) a.u = path.dirname(e.u);
      }
    });
  });
  return Object.keys(groups).map(function(k){
    var grp = groups[k], o = {g: grp.g, n: grp.n};
    if (withAlbum) {
      var best = null;
      Object.keys(grp.albums).forEach(function(x){ if (!best || grp.albums[x].n > best.n) best = grp.albums[x]; });
      if (best) { o.ar = best.ar; o.al = best.al; if (best.u) o.u = best.u; }
    }
    return o;
  }).sort(function(a, b){ return b.n - a.n || a.g.localeCompare(b.g); }).slice(0, limit);
}

/* most played by genre (genreOf as in stats) */
function topGenre(list, genreOf, from, limit, to) {
  return topGenres(between(list, from, to), genreOf, limit, true);
}

/* years with plays (local time), newest first */
function years(list, tz) {
  if (!list.length) return [];
  var out = [], a = local(list[0].t, tz).getUTCFullYear(), b = local(list[list.length - 1].t, tz).getUTCFullYear();
  for (var y = b; y >= a; y--) if (firstAt(list, localStart(y + 1, 0, 1, tz)) > firstAt(list, localStart(y, 0, 1, tz))) out.push(y);
  return out;
}

/* "Heard a year ago": albums (kind 'artist'/'track': artists/tracks) that played around this date (±3 days) a year ago;
   else 2, 3 … years ago */
var AGO_DAYS = 3;
function ago(list, now, tz, limit, kind) {
  if (!list.length) return {years: 0, items: []};
  var d = local(now, tz);
  for (var k = 1; ; k++) {
    var c = localStart(d.getUTCFullYear() - k, d.getUTCMonth(), d.getUTCDate(), tz) + 12 * 3600;
    if (c + AGO_DAYS * DAY < list[0].t) return {years: 0, items: []};
    var items = top(list, kind || 'album', c - AGO_DAYS * DAY, limit || 12, c + AGO_DAYS * DAY);
    if (items.length) return {years: k, at: c, items: items};
  }
}

/* recently heard albums, newest first: albums of which at least minTracks distinct tracks played recently
   (a single track from a mix doesn't count); searches at most the last scan entries.
   -> [{ti (album), ar, u (folder, local only), last}] */
function recentAlbums(list, limit, minTracks, scan) {
  var groups = {}, order = [], stop = Math.max(0, list.length - (scan || 3000));
  minTracks = minTracks || 2;
  for (var i = list.length - 1; i >= stop; i--) {
    var e = list[i];
    if (!e.al) continue;
    var local_ = e.u && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u);
    var k = local_ ? path.dirname(e.u) : keys(e).al + '|' + keys(e).ar, g = groups[k];
    if (!g) { g = groups[k] = {ti: e.al, ar: e.ar, last: e.t, tracks: {}, artists: {}, n: 0}; if (local_) g.u = path.dirname(e.u); order.push(k); }
    var tk = trackKey(e);
    if (!g.tracks[tk]) { g.tracks[tk] = true; g.n++; }
    g.artists[keys(e).ar] = true;
  }
  var out = [];
  for (var j = 0; j < order.length && out.length < limit; j++) {
    var x = groups[order[j]];
    if (x.n < minTracks) continue;
    var o = {ti: x.ti, ar: Object.keys(x.artists).length > 2 ? 'Verschiedene' : x.ar, last: x.last};
    if (x.u) o.u = x.u;
    out.push(o);
  }
  return out;
}

/* An album on its page: how often heard and when last. One "listen" is tracks of the album without a break longer than
   ALBUM_GAP; a single track counts too. dir: folder (local, as returned by rel()), else album and artist.
   -> {n, tracks (track plays), first, last} or null */
var ALBUM_GAP = 3 * 3600;
function albumStats(list, rel, dir, al, ar) {
  var kal = norm(al), kar = norm(ar), out = null, prev = 0;
  for (var i = 0; i < list.length; i++) {
    var e = list[i], hit;
    if (dir) { var d = e.u ? path.dirname(rel(e.u)) : ''; hit = d === dir || d.indexOf(dir + '/') === 0; }   /* also CD1/CD2 below it */
    else hit = !!e.al && keys(e).al === kal && (!kar || keys(e).ar === kar);
    if (!hit) continue;
    if (!out) out = {n: 0, tracks: 0, first: e.t, last: e.t};
    if (!prev || e.t - prev > ALBUM_GAP) out.n++;
    out.tracks++; out.last = e.t; prev = e.t;
  }
  return out;
}

module.exports = {albumStats: albumStats, recentAlbums: recentAlbums, Store: Store, Tracker: Tracker, recent: recent, top: top, topGenre: topGenre, stats: stats, rangeStart: rangeStart,
                  year: year, years: years, ago: ago, localStart: localStart, norm: norm, trackKey: trackKey, local: local};
