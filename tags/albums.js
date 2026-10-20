/* Random album: album list of the library (from MPD, read once and saved) and the pick,
   preferring albums that have not played for a long time or never. Node 8, ES5 only. */
var path  = require('path');
var plays = require('./plays.js');

var DAY = 86400;
var DISC_RE = /^(cd|dis[ck]|disco|seite|side|vol(ume)?)[\s._-]*\d+\b/i;     /* subfolder of a multi-disc set */
var RECENT_PICKS = 30;                                                     /* don't repeat this many recently shown ones */

/* year from the Date tag ("1997", "1997-05-12", "05/1997"); 0 if missing or implausible */
function yearOf(d) {
  var m = /(1[89]\d\d|20\d\d)/.exec(String(d || ''));
  return m ? +m[1] : 0;
}

/* folder of a track; CD1/CD2 subfolders belong to the album above */
function albumDir(file) {
  var d = path.dirname(String(file || ''));
  return DISC_RE.test(path.basename(d)) ? path.dirname(d) : d;
}

/* songs as from libcheck.mpdWalk -> [{dir, al, ar, ge, y, m}]; ge: most common genre in the folder, y: most common year (Date tag),
   m: latest change of a file (Last-Modified from MPD, Unix seconds), rd: full Date tag (YYYY-MM-DD); missing if no track in the folder has one */
function fromSongs(songs) {
  var dirs = {}, order = [];
  songs.forEach(function(s){
    var d = albumDir(s.file);
    if (!dirs[d]) { dirs[d] = {al: '', aa: '', artists: {}, genres: {}, years: {}, dates: {}, n: 0, m: 0}; order.push(d); }
    var g = dirs[d];
    if (!g.al && s.album) g.al = s.album;
    if (!g.aa && s.albumartist) g.aa = s.albumartist;
    if (s.artist) g.artists[s.artist] = true;
    if (s.genre) g.genres[s.genre] = (g.genres[s.genre] || 0) + 1;
    var y = yearOf(s.date);
    if (y) g.years[y] = (g.years[y] || 0) + 1;
    var fd = /^(\d{4}-\d\d-\d\d)/.exec(String(s.date || ''));
    if (fd) g.dates[fd[1]] = (g.dates[fd[1]] || 0) + 1;
    var m = Date.parse(s['last-modified'] || '');
    if (m > 0 && m / 1000 > g.m) g.m = Math.floor(m / 1000);
    g.n++;
  });
  return order.sort().map(function(d){
    var g = dirs[d], artists = Object.keys(g.artists);
    var o = {dir: d, al: g.al || path.basename(d), ar: g.aa || (artists.length === 1 ? artists[0] : 'Verschiedene')};
    var ge = Object.keys(g.genres).sort(function(a, b){ return g.genres[b] - g.genres[a]; })[0];
    if (ge) o.ge = ge;
    var y = Object.keys(g.years).sort(function(a, b){ return g.years[b] - g.years[a] || a - b; })[0];
    if (y) o.y = +y;
    if (g.m) o.m = g.m;
    var rd = Object.keys(g.dates).sort(function(a, b){ return g.dates[b] - g.dates[a] || (a < b ? -1 : 1); })[0];
    if (rd && +rd.slice(0, 4) === o.y) o.rd = rd;                /* full date only if it matches the album's year */
    return o;
  });
}

/* album list -> genreOf(history entry): genre via the folder, else album+artist, for compilations album name only */
function genreIndex(list) {
  var byDir = {}, byKey = {}, byAlbum = {};
  list.forEach(function(a){
    if (!a.ge) return;
    var k = plays.norm(a.al);
    byDir[a.dir] = a.ge; byKey[k + '|' + plays.norm(a.ar)] = a.ge;
    if (a.ar === 'Verschiedene') byAlbum[k] = a.ge;
  });
  return function(e) {
    if (e.u && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u)) {
      var g = byDir[albumDir(e.u.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''))];
      if (g) return g;
    }
    if (!e.al) return '';
    var k = plays.norm(e.al);
    return byKey[k + '|' + plays.norm(e.ar)] || byAlbum[k] || '';
  };
}

/* year of an album (Date tag) like genreIndex: via the folder, else album+artist -> year or 0 */
function yearIndex(list) {
  var byDir = {}, byKey = {};
  list.forEach(function(a){
    if (!a.y) return;
    byDir[a.dir] = a.y; byKey[plays.norm(a.al) + '|' + plays.norm(a.ar)] = a.y;
  });
  return function(e) {
    if (e.u && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u)) {
      var y = byDir[albumDir(e.u.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''))];
      if (y) return y;
    }
    return e.al ? byKey[plays.norm(e.al) + '|' + plays.norm(e.ar)] || 0 : 0;
  };
}

/* albums of a year, by artist */
function yearAlbums(list, y) {
  y = parseInt(y, 10);
  function key(a) { return a.ar.toLowerCase().replace(/^the\s+/, ''); }
  return list.filter(function(a){ return a.y === y; })
    .map(function(a){ return {dir: a.dir, al: a.al, ar: a.ar, y: a.y}; })
    .sort(function(a, b){ return key(a).localeCompare(key(b)) || a.al.localeCompare(b.al); });
}

/* genres of the album list: [{g, n (albums), dir, al, ar (sample album for the cover)}], largest first; q filters (substring) */
function genreList(list, q) {
  var by = {}, out = [];
  q = String(q || '').toLowerCase().trim();
  list.forEach(function(a){
    if (!a.ge || (q && a.ge.toLowerCase().indexOf(q) < 0)) return;
    var k = a.ge.toLowerCase(), g = by[k];
    if (!g) { g = by[k] = {g: a.ge, n: 0, dir: a.dir, al: a.al, ar: a.ar}; out.push(g); }
    g.n++;
  });
  return out.sort(function(a, b){ return b.n - a.n || a.g.localeCompare(b.g); });
}

/* albums of a genre (case-insensitive), sorted by artist and album; compilations ("Verschiedene") last */
function genreAlbums(list, g) {
  g = String(g || '').toLowerCase();
  function key(a) { return (a.ar === 'Verschiedene' ? '\uffff' : '') + a.ar.toLowerCase().replace(/^the\s+/, ''); }
  return list.filter(function(a){ return a.ge && a.ge.toLowerCase() === g; })
    .map(function(a){ return {dir: a.dir, al: a.al, ar: a.ar}; })
    .sort(function(a, b){ return key(a).localeCompare(key(b)) || a.al.localeCompare(b.al); });
}

/* decades of the album list: [{d (e.g. 1990), n (albums), dir, al, ar (sample album for the cover)}], by decade */
function decadeList(list) {
  var by = {}, out = [];
  list.forEach(function(a){
    if (!a.y) return;
    var d = a.y - a.y % 10, x = by[d];
    if (!x) { x = by[d] = {d: d, n: 0, dir: a.dir, al: a.al, ar: a.ar}; out.push(x); }
    x.n++;
  });
  return out.sort(function(a, b){ return a.d - b.d; });
}

/* albums of a decade, by year, artist and album */
function decadeAlbums(list, d) {
  d = parseInt(d, 10);
  function key(a) { return a.ar.toLowerCase().replace(/^the\s+/, ''); }
  return list.filter(function(a){ return a.y && a.y - a.y % 10 === d; })
    .map(function(a){ return {dir: a.dir, al: a.al, ar: a.ar, y: a.y}; })
    .sort(function(a, b){ return a.y - b.y || key(a).localeCompare(key(b)) || a.al.localeCompare(b.al); });
}

/* history -> when last played: by folder (played locally) and by album+artist (also Last.fm) */
function lastIndex(list) {
  var byDir = {}, byKey = {}, byAlbum = {};
  list.forEach(function(e){
    if (e.u && !/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(e.u)) {
      var d = albumDir(e.u.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''));
      if (!(byDir[d] >= e.t)) byDir[d] = e.t;
    }
    if (e.al) {
      var a = plays.norm(e.al), k = a + '|' + plays.norm(e.ar);
      if (!(byKey[k] >= e.t)) byKey[k] = e.t;
      if (!(byAlbum[a] >= e.t)) byAlbum[a] = e.t;
    }
  });
  return function(al) {
    var a = plays.norm(al.al), t = Math.max(byDir[al.dir] || 0, byKey[a + '|' + plays.norm(al.ar)] || 0,
                                             al.ar === 'Verschiedene' ? byAlbum[a] || 0 : 0);
    return t || null;
  };
}

/* weight: never heard or over a year ago 4, over three months 2, else 1 */
function weight(last, now) {
  if (!last || now - last > 365 * DAY) return 4;
  return now - last > 90 * DAY ? 2 : 1;
}

/* draw one entry from pool, weighted by weight(lastOf(x)); keyOf(x): key for picks (recently shown, gets appended) */
function draw(pool, keyOf, lastOf, now, picks, rnd) {
  if (!pool.length) return null;
  rnd = rnd || Math.random;
  var skip = {};
  (picks || []).forEach(function(d){ skip[d] = true; });
  if (pool.length > (picks || []).length) pool = pool.filter(function(a){ return !skip[keyOf(a)]; });
  /* sample instead of weighting all: fast even with many thousands of entries */
  var cand = [], sum = 0;
  for (var i = 0; i < Math.min(40, pool.length); i++) {
    var a = pool[Math.floor(rnd() * pool.length)], l = lastOf(a), w = weight(l, now);
    cand.push({a: a, last: l, w: w}); sum += w;
  }
  var r = rnd() * sum, c = cand[cand.length - 1];
  for (i = 0; i < cand.length; i++) { r -= cand[i].w; if (r < 0) { c = cand[i]; break; } }
  if (picks) { picks.push(keyOf(c.a)); if (picks.length > RECENT_PICKS) picks.shift(); }
  return c;
}

/* pick an album; last: lastIndex(history); picks: recently shown folders (gets appended); rnd: random number 0..1 (tests) */
function pick(albums, last, now, picks, rnd) {
  var c = draw(albums, function(a){ return a.dir; }, last, now, picks, rnd);
  return c && {dir: c.a.dir, al: c.a.al, ar: c.a.ar, last: c.last};
}

/* artists of the library (album artists, without compilations) -> [{ar, n: albums, dir: one album folder}] */
function artists(albums) {
  var by = {}, out = [];
  albums.forEach(function(a){
    if (!a.ar || a.ar === 'Verschiedene') return;
    var k = plays.norm(a.ar);
    if (!k) return;
    if (by[k]) by[k].n++; else { by[k] = {ar: a.ar, n: 1, dir: a.dir}; out.push(by[k]); }
  });
  return out;
}

/* history -> when an artist or a track last played */
function lastArtistIndex(list) {
  var by = {};
  list.forEach(function(e){ var k = plays.norm(e.ar); if (!(by[k] >= e.t)) by[k] = e.t; });
  return function(a){ return by[plays.norm(a.ar)] || null; };
}
function lastTrackIndex(list) {
  var by = {};
  list.forEach(function(e){ var k = plays.trackKey(e); if (!(by[k] >= e.t)) by[k] = e.t; });
  return function(t){ return by[plays.norm(t[0]) + '|' + plays.norm(t[1])] || null; };
}

/* random artist from artists(); last: lastArtistIndex */
function pickArtist(list, last, now, picks, rnd) {
  var c = draw(list, function(a){ return plays.norm(a.ar); }, last, now, picks, rnd);
  return c && {ar: c.a.ar, n: c.a.n, dir: c.a.dir, last: c.last};
}

/* random track from library-tracks.json ([[artist, title, file, seconds, album], …]); last: lastTrackIndex */
function pickTrack(tracks, last, now, picks, rnd) {
  var c = draw(tracks, function(t){ return t[2]; }, last, now, picks, rnd);
  return c && {ar: c.a[0], ti: c.a[1], f: c.a[2], d: c.a[3] || 0, al: c.a[4] || '', last: c.last};
}

/* album of the day: always the same one for the same day (day, e.g. "2026-10-09"), preferring ones not heard for long or never;
   last: lastIndex(history) */
function seeded(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function() {                                    /* mulberry32 */
    h = (h + 0x6D2B79F5) | 0;
    var t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dayAlbum(list, day, last, now) {
  var c = draw(list, function(a){ return a.dir; }, last, now, null, seeded(String(day)));
  return c && {dir: c.a.dir, al: c.a.al, ar: c.a.ar, y: c.a.y, last: c.last};
}

/* new in the collection: albums whose files were added or changed in the last days days, newest first */
var FRESH_DAYS = 180;
function freshAlbums(list, now, n, days) {
  var from = now - (days || FRESH_DAYS) * DAY;
  return list.filter(function(a){ return a.m && a.m >= from; })
    .sort(function(a, b){ return b.m - a.m || a.dir.localeCompare(b.dir); })
    .slice(0, n || 8)
    .map(function(a){ return {dir: a.dir, al: a.al, ar: a.ar, y: a.y, m: a.m}; });
}

module.exports = {dayAlbum: dayAlbum, freshAlbums: freshAlbums, seeded: seeded, albumDir: albumDir, fromSongs: fromSongs, genreIndex: genreIndex, genreList: genreList, genreAlbums: genreAlbums, decadeList: decadeList, decadeAlbums: decadeAlbums, yearIndex: yearIndex, yearAlbums: yearAlbums, yearOf: yearOf, lastIndex: lastIndex, pick: pick, weight: weight,
                  artists: artists, lastArtistIndex: lastArtistIndex, lastTrackIndex: lastTrackIndex, pickArtist: pickArtist, pickTrack: pickTrack};
