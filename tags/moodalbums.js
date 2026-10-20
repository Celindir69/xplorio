/* Albums by mood, energy and style (Search & Discover): the classified tracks summarized per album.
   An album belongs to a mood or style if at least half of its classified tracks carry it
   (for several styles on one button: one of them); its energy is the rounded mean. Node 8, ES5 only. */
var albums = require('./albums.js');

var SHARE = 0.5;                 /* "mostly" */
var MIN_TRACKS = 2;              /* an album needs at least this many classified tracks */

function rel(f) { return String(f || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''); }

/* idx: [{it: {f}, r: {mood, energy, style}}] (moodmix.index) -> {folder: {n, moods: [[…] per track], styles: [[…] per track], eSum, eN}} */
function summarize(idx) {
  var by = {};
  idx.forEach(function(x){
    if (!x.it.f) return;
    var d = albums.albumDir(rel(x.it.f)), s = by[d] || (by[d] = {n: 0, moods: [], styles: [], eSum: 0, eN: 0});
    s.n++;
    s.moods.push(x.r.mood || []);
    s.styles.push(x.r.style || []);
    if (typeof x.r.energy === 'number') { s.eSum += x.r.energy; s.eN++; }
  });
  return by;
}

/* share of tracks with at least one of the moods or styles */
function share(perTrack, keys, n) {
  var hit = 0;
  perTrack.forEach(function(list){ if (list.some(function(k){ return keys.indexOf(k) >= 0; })) hit++; });
  return hit / n;
}

/* tracks that themselves match q ({moods, styles, emin, emax} as in fit), as {file: true} (dice on the mood/style pages) */
function tracksMatching(idx, q) {
  var out = {};
  idx.forEach(function(x){
    if (!x.it.f || !x.r) return;
    var r = x.r, e = r.energy;
    if (q.moods && q.moods.length && !(r.mood || []).some(function(k){ return q.moods.indexOf(k) >= 0; })) return;
    if (q.styles && q.styles.length && !(r.style || []).some(function(k){ return q.styles.indexOf(k) >= 0; })) return;
    if ((q.emin || q.emax) && (typeof e !== 'number' || e < (q.emin || 1) || e > (q.emax || 5))) return;
    out[rel(x.it.f)] = true;
  });
  return out;
}

/* q: {moods: [], styles: [], emin, emax} -> does the album match? Returns the share (0..1), 0 = no match */
function fit(s, q) {
  if (!s || s.n < MIN_TRACKS) return 0;
  var sh = 1;
  if (q.moods && q.moods.length) { sh = share(s.moods, q.moods, s.n); if (sh < SHARE) return 0; }
  if (q.styles && q.styles.length) { var st = share(s.styles, q.styles, s.n); if (st < SHARE) return 0; sh = Math.min(sh, st); }
  if (q.emin || q.emax) {
    if (!s.eN) return 0;
    var e = Math.round(s.eSum / s.eN);
    if (e < (q.emin || 1) || e > (q.emax || 5)) return 0;
  }
  return sh;
}

/* matching albums of the album list, sorted by artist and album (like the genre page) */
function list(sums, albumList, q) {
  function key(a) { return (a.ar === 'Verschiedene' ? '￿' : '') + a.ar.toLowerCase().replace(/^the\s+/, ''); }
  return albumList.filter(function(a){ return fit(sums[a.dir], q) > 0; })
    .map(function(a){ var o = {dir: a.dir, al: a.al, ar: a.ar}; if (a.y) o.y = a.y; return o; })
    .sort(function(a, b){ return key(a).localeCompare(key(b)) || a.al.localeCompare(b.al); });
}

/* "Discover more" on the artist page: moods and styles carried by at least PROFILE_SHARE of the artist's classified tracks
   (most common first, at most PROFILE_MAX each), mean energy and the decades of their albums.
   idx: moodmix.index; albumList: albums.json; key: normalized artist (plays.norm) -> {n, moods, styles, energy, decades} */
var PROFILE_SHARE = 0.2, PROFILE_MAX = 5;
function artistProfile(idx, albumList, key, norm) {
  var n = 0, moods = {}, styles = {}, eSum = 0, eN = 0, dec = {};
  idx.forEach(function(x){
    if (norm(x.it.ar) !== key) return;
    n++;
    (x.r.mood || []).forEach(function(m){ moods[m] = (moods[m] || 0) + 1; });
    (x.r.style || []).forEach(function(s){ styles[s] = (styles[s] || 0) + 1; });
    if (typeof x.r.energy === 'number') { eSum += x.r.energy; eN++; }
  });
  (albumList || []).forEach(function(a){ if (a.y && norm(a.ar) === key) dec[Math.floor(a.y / 10) * 10] = true; });
  function top(o) {
    return Object.keys(o).filter(function(k){ return o[k] >= Math.max(1, n * PROFILE_SHARE); })
      .sort(function(a, b){ return o[b] - o[a] || (a < b ? -1 : 1); }).slice(0, PROFILE_MAX);
  }
  return {n: n, moods: top(moods), styles: top(styles), energy: eN ? Math.round(eSum / eN) : 0,
          decades: Object.keys(dec).map(Number).sort(function(a, b){ return a - b; })};
}

/* Discover for a decade (year and decade page): artists with albums in it (those with the most first),
   common moods and styles of its tracks (share at least PROFILE_SHARE), neighboring decades with albums.
   idx: moodmix.index; albumList: albums.json; albumDir: folder of a track -> {n, artists, moods, styles, decades} */
var DECADE_ARTISTS = 24;
function decadeProfile(idx, albumList, d, albumDir) {
  var inDec = {}, artists = {}, names = {}, has = {};
  (albumList || []).forEach(function(a){
    if (!a.y) return;
    var dd = a.y - a.y % 10;
    has[dd] = true;
    if (dd !== d) return;
    inDec[a.dir] = true;
    if (a.ar === 'Verschiedene' || !a.ar) return;
    var k = a.ar.toLowerCase();
    artists[k] = (artists[k] || 0) + 1;
    names[k] = names[k] || a.ar;
  });
  var n = 0, moods = {}, styles = {};
  idx.forEach(function(x){
    if (!inDec[albumDir(String(x.it.f || '').replace(/^mnt\//, ''))]) return;
    n++;
    (x.r.mood || []).forEach(function(m){ moods[m] = (moods[m] || 0) + 1; });
    (x.r.style || []).forEach(function(s){ styles[s] = (styles[s] || 0) + 1; });
  });
  function top(o, k, share) {
    return Object.keys(o).filter(function(x){ return o[x] >= Math.max(1, n * share); })
      .sort(function(a, b){ return o[b] - o[a] || (a < b ? -1 : 1); }).slice(0, k);
  }
  return {n: n, artists: top(artists, DECADE_ARTISTS, 0).map(function(k){ return names[k]; }),
          moods: top(moods, 6, PROFILE_SHARE / 2), styles: top(styles, 6, PROFILE_SHARE / 2),
          decades: [d - 10, d, d + 10].filter(function(x){ return has[x]; })};
}

/* Discover on the album page. The album is looked up by its folder, else by artist and title (bracketed additions
   don't count; so a streaming album that also exists locally matches too). Without a local album the artist's profile
   applies. Similar albums: weighted overlap of the mood and style shares and closeness of energy, at most one per
   artist, none by the same artist.
   idx: moodmix.index; albumList: albums.json; q: {dir, artist, album}; norm: plays.norm
   -> {source: 'album'|'artist'|null, n, moods, styles, energy, year, genre, similar: [{dir, al, ar, y}], others: [...]} */
var SIMILAR_MAX = 12, SIMILAR_MIN = 0.35;
function bareTitle(s) { return String(s || '').toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim(); }
function vectorOf(tracks) {
  var n = tracks.length, moods = {}, styles = {}, eSum = 0, eN = 0;
  tracks.forEach(function(r){
    (r.mood || []).forEach(function(m){ moods[m] = (moods[m] || 0) + 1 / n; });
    (r.style || []).forEach(function(x){ styles[x] = (styles[x] || 0) + 1 / n; });
    if (typeof r.energy === 'number') { eSum += r.energy; eN++; }
  });
  return {n: n, moods: moods, styles: styles, energy: eN ? eSum / eN : 0};
}
function overlap(a, b) {                       /* sum of minima / sum of maxima, 0..1 */
  var lo = 0, hi = 0, k;
  for (k in a) { lo += Math.min(a[k], b[k] || 0); hi += Math.max(a[k], b[k] || 0); }
  for (k in b) if (!(k in a)) hi += b[k];
  return hi ? lo / hi : 0;
}
function closeness(a, b) {
  var e = a.energy && b.energy ? 1 - Math.abs(a.energy - b.energy) / 4 : 0.5;
  return 0.5 * overlap(a.moods, b.moods) + 0.3 * overlap(a.styles, b.styles) + 0.2 * e;
}
function topShare(o) {
  return Object.keys(o).filter(function(k){ return o[k] >= PROFILE_SHARE; })
    .sort(function(a, b){ return o[b] - o[a] || (a < b ? -1 : 1); }).slice(0, PROFILE_MAX);
}
function albumProfile(idx, albumList, q, norm) {
  albumList = albumList || [];
  var who = norm(q.artist || ''), want = bareTitle(q.album), target = null;
  if (q.dir) target = albumList.filter(function(a){ return a.dir === q.dir; })[0] || null;
  if (!target && want) target = albumList.filter(function(a){ return bareTitle(a.al) === want && (!who || norm(a.ar) === who); })[0] || null;
  var key = target ? norm(target.ar) : who;
  var byDir = {};
  idx.forEach(function(x){
    if (!x.it.f) return;
    var d = albums.albumDir(rel(x.it.f));
    (byDir[d] || (byDir[d] = [])).push(x.r);
  });
  var own = target && byDir[target.dir] && byDir[target.dir].length >= MIN_TRACKS ? byDir[target.dir] : null, source = own ? 'album' : null;
  if (!own && key) {
    own = [];
    idx.forEach(function(x){ if (norm(x.it.ar) === key) own.push(x.r); });
    if (own.length >= MIN_TRACKS) source = 'artist'; else own = null;
  }
  var out = {source: source, found: !!target, n: own ? own.length : 0, moods: [], styles: [], energy: 0, year: target && target.y || 0,
             genre: target && target.ge || '', similar: [], others: []};
  if (target) out.dir = target.dir;                     /* album folder: if the page comes from the search (albums://…), it doesn't know it */
  if (own) {
    var v = vectorOf(own);
    out.moods = topShare(v.moods); out.styles = topShare(v.styles); out.energy = Math.round(v.energy);
    var seen = {};
    albumList.map(function(a){
      var t = byDir[a.dir];
      if (!t || t.length < MIN_TRACKS || (target && a.dir === target.dir) || norm(a.ar) === key || a.ar === 'Verschiedene') return null;
      return {a: a, s: closeness(v, vectorOf(t))};
    }).filter(function(x){ return x && x.s >= SIMILAR_MIN; })
      .sort(function(x, y){ return y.s - x.s || (x.a.dir < y.a.dir ? -1 : 1); })
      .forEach(function(x){
        var k = norm(x.a.ar);
        if (seen[k] || out.similar.length >= SIMILAR_MAX) return;
        seen[k] = true;
        var o = {dir: x.a.dir, al: x.a.al, ar: x.a.ar}; if (x.a.y) o.y = x.a.y;
        out.similar.push(o);
      });
  }
  if (key) out.others = albumList.filter(function(a){ return norm(a.ar) === key && (!target || a.dir !== target.dir) && bareTitle(a.al) !== want; })
    .sort(function(a, b){ return (a.y || 9999) - (b.y || 9999) || a.al.localeCompare(b.al); })
    .map(function(a){ var o = {dir: a.dir, al: a.al, ar: a.ar}; if (a.y) o.y = a.y; return o; });
  return out;
}

module.exports = {summarize: summarize, tracksMatching: tracksMatching, fit: fit, list: list, artistProfile: artistProfile, decadeProfile: decadeProfile, albumProfile: albumProfile, SHARE: SHARE};
