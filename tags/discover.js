/* Discover: shelves for the search without input (random discoveries, not heard for a long time, never heard,
   often heard in the past) per artist, album or track, and the random mix for the dice next to "Play all".
   Node 8, ES5 only. */
var plays  = require('./plays.js');
var albums = require('./albums.js');

var DAY = 86400;
var ROW = 12;                                            /* tiles per shelf */
var LONG = 180 * DAY;                                    /* not heard for long: over half a year ago */
var OLDFAV_GAP = 180 * DAY;                              /* often heard in the past: not for half a year */
var OLDFAV_MIN = {artist: 10, album: 5, track: 4};       /* … and heard at least this often */
var OLDFAV_POOL = 36;                                    /* drawn from this many most played */
var STREAM_RE = /^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i;

function bump(map, k, t) {
  if (!k) return;
  var s = map[k] || (map[k] = {last: 0, n: 0});
  s.n++;
  if (t > s.last) s.last = t;
}

/* history -> counters {last, n} per artist, album and track; NONE if never heard */
var NONE = {last: 0, n: 0};
function statIndex(list) {
  var ar = {}, tr = {}, dir = {}, alk = {};
  list.forEach(function(e){
    bump(ar, plays.norm(e.ar), e.t);
    bump(tr, plays.trackKey(e), e.t);
    if (e.u && !STREAM_RE.test(e.u)) bump(dir, albums.albumDir(String(e.u).replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '')), e.t);
    if (e.al) bump(alk, plays.norm(e.al) + '|' + plays.norm(e.ar), e.t);
  });
  return {
    artist: function(a){ return ar[plays.norm(a.ar)] || NONE; },
    track:  function(t){ return tr[plays.norm(t[0]) + '|' + plays.norm(t[1])] || NONE; },
    album:  function(a){                                 /* folder (reliable) or album+artist (Last.fm entries without path), the larger value */
      var d = dir[a.dir] || NONE, k = alk[plays.norm(a.al) + '|' + plays.norm(a.ar)] || NONE;
      return d.n >= k.n ? {n: d.n, last: Math.max(d.last, k.last)} : {n: k.n, last: Math.max(d.last, k.last)};
    }
  };
}

/* k random entries (without repetition) */
function sample(arr, k, rnd) {
  rnd = rnd || Math.random;
  var a = arr.slice(), n = Math.min(k, a.length);
  for (var i = 0; i < n; i++) {
    var j = i + Math.floor(rnd() * (a.length - i)), x = a[i];
    a[i] = a[j]; a[j] = x;
  }
  return a.slice(0, n);
}

/* k entries, weighted like the random album: never or long unheard more often (albums.weight) */
function weighted(arr, statOf, now, k, rnd) {
  rnd = rnd || Math.random;
  var cand = sample(arr, k * 4, rnd).map(function(x){ return {x: x, w: albums.weight(statOf(x).last || null, now)}; }), out = [];
  while (out.length < k && cand.length) {
    var sum = 0, i;
    for (i = 0; i < cand.length; i++) sum += cand[i].w;
    var r = rnd() * sum;
    for (i = 0; i < cand.length - 1; i++) { r -= cand[i].w; if (r < 0) break; }
    out.push(cand.splice(i, 1)[0].x);
  }
  return out;
}

/* entry for the UI */
function item(kind, x, s) {
  var o = kind === 'artist' ? {ar: x.ar, n: x.n, dir: x.dir}
        : kind === 'track' ? {ar: x[0], ti: x[1], f: x[2], d: x[3] || 0, al: x[4] || ''}
        : {dir: x.dir, al: x.al, ar: x.ar};
  o.plays = s.n;
  if (s.last) o.last = s.last;
  return o;
}

/* shelves for kind (artist|album|track); ents: artists (albums.artists), albums (albums.json) or tracks (library-tracks.json) */
function shelves(kind, ents, stats, now, rnd) {
  var statOf = stats[kind], forgotten = [], never = [], often = [], min = OLDFAV_MIN[kind];
  ents.forEach(function(x){
    var s = statOf(x);
    if (!s.n) never.push(x);
    else if (now - s.last > LONG) forgotten.push(x);
    if (s.n >= min && now - s.last > OLDFAV_GAP) often.push(x);
  });
  often.sort(function(a, b){ return statOf(b).n - statOf(a).n; });
  var oldfav = sample(often.slice(0, OLDFAV_POOL), ROW, rnd).sort(function(a, b){ return statOf(b).n - statOf(a).n; });
  function out(list) { return list.map(function(x){ return item(kind, x, statOf(x)); }); }
  return [
    {id: 'random',    items: out(weighted(ents, statOf, now, ROW, rnd))},
    {id: 'forgotten', items: out(sample(forgotten, ROW, rnd).sort(function(a, b){ return statOf(a).last - statOf(b).last; }))},
    {id: 'never',     items: out(sample(never, ROW, rnd))},
    {id: 'oldfav',    items: out(oldfav)}
  ];
}

/* random mix: up to k tracks from pool ([[artist, title, file, …], …]), purely random, the same artist never
   directly in a row (unless only one is left, e.g. on the artist page); each file at most once */
function mix(pool, k, rnd) {
  var seen = {}, a = sample(pool.filter(function(t){ return seen[t[2]] ? false : (seen[t[2]] = true); }), pool.length, rnd);
  var out = [], prev = null;
  while (out.length < k && a.length) {
    var idx = 0;
    for (var i = 0; i < a.length; i++) if (plays.norm(a[i][0]) !== prev) { idx = i; break; }
    var t = a.splice(idx, 1)[0];
    out.push(t);
    prev = plays.norm(t[0]);
  }
  return out;
}

/* tracks for the mix: {artist} -> tracks of the artist and their albums; {artists: [...]} -> same for several;
   {dirs: [...]} -> tracks of these album folders */
function mixPool(tracks, albumList, q) {
  var dirs = {}, want = {}, any = false;
  (q.dirs || []).forEach(function(d){ dirs[String(d)] = true; });
  (q.artist ? [q.artist] : []).concat(q.artists || []).forEach(function(a){ var k = plays.norm(a); if (k) { want[k] = true; any = true; } });
  if (any) (albumList || []).forEach(function(a){ if (want[plays.norm(a.ar)]) dirs[a.dir] = true; });
  return tracks.filter(function(t){ return (any && want[plays.norm(t[0])]) || dirs[albums.albumDir(t[2])]; });
}

/* mix across several artists (similar artists): each artist about equally often, however much of them there is;
   the track's artist counts, on their own album the album's artist ("Spliff feat. Nina" on a
   Spliff album counts as Spliff). Compilations with album artist "Various Artists" or similar thus don't count as one artist. Per artist, not recently heard first (recent(t)),
   spread across the albums. Never the same artist directly in a row as long as
   another is left; each file at most once. */
function mixBalanced(pool, k, albumList, rnd, recent) {
  rnd = rnd || Math.random;
  var dirArtist = {}, by = {}, seen = {};
  (albumList || []).forEach(function(a){ if (a.ar !== 'Verschiedene') dirArtist[a.dir] = plays.norm(a.ar); });
  pool.forEach(function(t){
    if (seen[t[2]]) return;
    seen[t[2]] = true;
    var aa = dirArtist[albums.albumDir(t[2])], ta = plays.norm(t[0]);
    var a = aa && ta.indexOf(aa) === 0 ? aa : (ta || aa || '');
    (by[a] || (by[a] = [])).push(t);
  });
  Object.keys(by).forEach(function(a){                  /* per artist: not recently heard first, across the albums */
    var nth = {}, list = sample(by[a], by[a].length, rnd).map(function(t, i){
      var al = albums.albumDir(t[2]);
      nth[al] = (nth[al] || 0) + 1;
      return {t: t, r: recent && recent(t) ? 1 : 0, n: nth[al], i: i};
    });
    list.sort(function(x, y){ return x.r - y.r || x.n - y.n || x.i - y.i; });
    by[a] = list.map(function(x){ return x.t; });
  });
  var out = [], used = {}, prev = null;
  while (out.length < k) {
    var left = Object.keys(by).filter(function(a){ return by[a].length; });
    if (!left.length) break;
    /* least played first, random among those; the previous one only if it is the only one left */
    var cand = left.filter(function(a){ return a !== prev; });
    if (!cand.length) cand = left;
    var min = Math.min.apply(null, cand.map(function(a){ return used[a] || 0; }));
    cand = cand.filter(function(a){ return (used[a] || 0) === min; });
    var pick = cand[Math.floor(rnd() * cand.length)];
    out.push(by[pick].shift());
    used[pick] = (used[pick] || 0) + 1;
    prev = pick;
  }
  return out;
}

/* tracks of a discover shelf for its dice (always tracks, whatever the tab): random weighted like the shelf,
   forgotten/never/oldfav by the same rules as the shelf, ago: extra.keys (artist|title), gems: extra.files */
function shelfPool(shelf, tracks, stats, now, extra, rnd) {
  extra = extra || {};
  if (shelf === 'gems') return tracks.filter(function(t){ return extra.files && extra.files[t[2]]; });
  if (shelf === 'ago') return tracks.filter(function(t){ return extra.keys && extra.keys[plays.norm(t[0]) + '|' + plays.norm(t[1])]; });
  var statOf = stats.track;
  if (shelf === 'random') return weighted(tracks, statOf, now, 100, rnd);
  if (shelf === 'never') return tracks.filter(function(t){ return !statOf(t).n; });
  if (shelf === 'forgotten') return tracks.filter(function(t){ var s = statOf(t); return s.n && now - s.last > LONG; });
  if (shelf === 'oldfav') {
    return tracks.filter(function(t){ var s = statOf(t); return s.n >= OLDFAV_MIN.track && now - s.last > OLDFAV_GAP; })
      .sort(function(a, b){ return statOf(b).n - statOf(a).n; }).slice(0, 100);
  }
  return [];
}

/* dice of a shelf in the artists or albums tab: which artists (normalized name) or albums (folder) belong to the whole
   shelf (not just the tiles shown); same rules as shelves(). ents: artists or albums */
function shelfKeys(shelf, kind, ents, stats, now) {
  var statOf = stats[kind], keys = {}, often = [];
  function key(x) { return kind === 'artist' ? plays.norm(x.ar) : x.dir; }
  ents.forEach(function(x){
    var s = statOf(x);
    if ((shelf === 'never' && !s.n) || (shelf === 'forgotten' && s.n && now - s.last > LONG)) keys[key(x)] = true;
    if (shelf === 'oldfav' && s.n >= OLDFAV_MIN[kind] && now - s.last > OLDFAV_GAP) often.push(x);
  });
  often.sort(function(a, b){ return statOf(b).n - statOf(a).n; }).slice(0, OLDFAV_POOL).forEach(function(x){ keys[key(x)] = true; });
  return keys;
}
/* tracks of these artists (track or album artist) or albums */
function groupPool(tracks, albumList, kind, keys) {
  if (kind === 'album') return tracks.filter(function(t){ return keys[albums.albumDir(t[2])]; });
  var dirArtist = {};
  (albumList || []).forEach(function(a){ dirArtist[a.dir] = plays.norm(a.ar); });
  return tracks.filter(function(t){ return keys[plays.norm(t[0])] || keys[dirArtist[albums.albumDir(t[2])]]; });
}

/* random mix with rules (dice): o.artist tracks per artist (track artist), o.album per album (folder),
   o.recent(t): recently heard. First not recently heard within the limits, then beyond them, only
   last recently heard; each file once, order as in mix() (never the same artist directly in a row). */
function mixCapped(pool, k, o, rnd) {
  o = o || {};
  var maxAr = o.artist || Infinity, maxAl = o.album || Infinity, recent = o.recent || function(){ return false; };
  var seen = {}, list = sample(pool.filter(function(t){ return seen[t[2]] ? false : (seen[t[2]] = true); }), pool.length, rnd);
  var per = {}, perAl = {}, out = [], taken = {};
  function pass(old, capped) {                        /* old: recently heard ones' turn */
    list.forEach(function(t){
      if (out.length >= k || taken[t[2]] || !!recent(t) !== old) return;
      var a = plays.norm(t[0]), al = albums.albumDir(t[2]);
      if (capped && ((per[a] || 0) >= maxAr || (perAl[al] || 0) >= maxAl)) return;
      per[a] = (per[a] || 0) + 1; perAl[al] = (perAl[al] || 0) + 1;
      taken[t[2]] = true;
      out.push(t);
    });
  }
  pass(false, true); pass(false, false); pass(true, true); pass(true, false);
  return mix(out, k, rnd);
}

/* recently heard (dice puts it at the end): track played within days days */
var RECENT_DAYS = 14;
function recentFn(stats, now, days) {
  var since = now - (days || RECENT_DAYS) * DAY;
  return function(t){ return stats.track(t).last > since; };
}

module.exports = {statIndex: statIndex, shelves: shelves, mix: mix, mixPool: mixPool, mixBalanced: mixBalanced, shelfPool: shelfPool, shelfKeys: shelfKeys, groupPool: groupPool, mixCapped: mixCapped, recentFn: recentFn, sample: sample, ROW: ROW};
