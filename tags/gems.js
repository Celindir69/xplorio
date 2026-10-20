/* Hidden gems (Search & Discover): rarely or never heard items from the library that match one's own taste.
   Taste: artists with a heart, albums with 4–5 stars, Volumio favorites (thumbs up) and, weaker, the history.
   Similarity: genre, mood, style and energy (mood tags) as a feature vector, cosine to the taste profile.
   Plus unheard albums and tracks by artists one likes. Filtered out: "don't like", albums with 1–2 stars,
   already rated items. Each gem carries a reason (why). Node 8, ES5 only. */
var plays  = require('./plays.js');
var albums = require('./albums.js');

var ROW = 12;                    /* tiles per shelf */
var POOL = 48;                   /* drawn from this many best (dice) */
var MIN_SCORE = 0.35;            /* below this it is no gem */
var MAX_PLAYS = {artist: 2, album: 2, track: 1};   /* heard at most this often */
var LIKE = 0.75;                 /* from this similarity to a favorite artist on: "Like X" */
var PLAY_WEIGHT = 0.4;           /* share of the history in the profile when there are ratings */
var STARS_W = {4: 2, 5: 3}, HEART_W = 3, FAV_W = 1;

function rel(f) { return String(f || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''); }
function nk(s) { return plays.norm(s); }

/* features of a track: genre, moods, styles, energy (r: moodtags result or null) */
function trackVec(ge, r) {
  var v = {};
  if (ge) v['g:' + String(ge).toLowerCase()] = 1;
  if (r) {
    var m = r.mood || [], s = r.style || [];
    m.forEach(function(x){ v['m:' + x] = 1 / Math.sqrt(m.length); });
    s.forEach(function(x){ v['s:' + x] = 0.8 / Math.sqrt(s.length); });
    if (typeof r.energy === 'number') v['e:' + r.energy] = 0.5;
  }
  return v;
}
function add(into, v, w) { for (var k in v) into[k] = (into[k] || 0) + v[k] * w; }
function norm2(v) { var s = 0; for (var k in v) s += v[k] * v[k]; return Math.sqrt(s); }
function unit(v) { var l = norm2(v), o = {}; if (!l) return o; for (var k in v) o[k] = v[k] / l; return o; }
function cos(a, b) {                                     /* a, b: unit vectors */
  var s = 0;
  for (var k in a) if (b[k]) s += a[k] * b[k];
  return s;
}
function empty(v) { for (var k in v) return false; return true; }

/* mean of the track vectors per group -> {key: unit vector} */
function groupVecs(tracks, keyOf) {
  var sum = {};
  tracks.forEach(function(t){ var k = keyOf(t); if (k) add(sum[k] || (sum[k] = {}), t.v, 1); });
  var out = {};
  Object.keys(sum).forEach(function(k){ out[k] = unit(sum[k]); });
  return out;
}

/* build taste and features (expensive; once per state of library, ratings, favorites and history).
   inp: {lib: [[ar, ti, f, d, al, ge], …], moodOf: f -> r|null, albums: [{dir, al, ar, ge}], artists: [{ar, n, dir}],
         rated: {artists, albums, tracks} (ratings.json), favs: {file: true}, stats: discover.statIndex(history)} */
function prepare(inp) {
  var rated = inp.rated || {artists: {}, albums: {}, tracks: {}}, favs = inp.favs || {}, stats = inp.stats;
  var albGe = {}, geName = {};
  (inp.albums || []).forEach(function(a){ albGe[a.dir] = a.ge || ''; });
  var tracks = [];
  (inp.lib || []).forEach(function(p){
    if (!p || !p[2]) return;
    var f = rel(p[2]), dir = albums.albumDir(f), r = inp.moodOf ? inp.moodOf(p[2]) : null;
    var ge = p[5] || albGe[dir], v = trackVec(ge, r);
    if (ge && !geName[String(ge).toLowerCase()]) geName[String(ge).toLowerCase()] = ge;   /* for display */
    if (empty(v)) return;
    tracks.push({p: p, f: f, dir: dir, ak: nk(p[0]), v: v, r: r, n: stats.track(p).n, bad: !!(rated.tracks[f] && rated.tracks[f].v === -1)});
  });
  var byDir = groupVecs(tracks, function(t){ return t.dir; });
  var byArtist = groupVecs(tracks, function(t){ return t.ak; });

  /* favorite artists: heart, artist of an album with 4–5 stars, artists of favorites */
  var liked = {}, seeds = {}, pr = {};
  function seed(ak, name, w) { if (!ak) return; liked[ak] = true; var s = seeds[ak] || (seeds[ak] = {ar: name, w: 0}); s.w += w; }
  Object.keys(rated.artists || {}).forEach(function(ak){
    var name = rated.artists[ak].n;
    seed(ak, name, HEART_W);
    if (byArtist[ak]) add(pr, byArtist[ak], HEART_W);
  });
  var albumOf = {};
  (inp.albums || []).forEach(function(a){ albumOf[a.dir] = a; });
  Object.keys(rated.albums || {}).forEach(function(d){
    var w = STARS_W[rated.albums[d].v];
    if (!w || !byDir[d]) return;
    add(pr, byDir[d], w);
    var a = albumOf[d];
    if (a && a.ar !== 'Verschiedene') seed(nk(a.ar), a.ar, w);
  });
  tracks.forEach(function(t){
    if (!favs[t.f]) return;
    add(pr, unit(t.v), FAV_W);
    seed(t.ak, t.p[0], FAV_W);
  });
  /* history: often heard (from twice on), capped */
  var pp = {}, played = {};
  tracks.forEach(function(t){
    if (t.n < 2) return;
    add(pp, unit(t.v), Math.min(t.n, 10));
    played[t.ak] = (played[t.ak] || 0) + t.n;
  });
  var rUnit = unit(pr), pUnit = unit(pp), profile;
  if (empty(rUnit)) {
    profile = pUnit;
    /* without ratings: the most played artists as comparison for "Like X" */
    Object.keys(played).sort(function(a, b){ return played[b] - played[a]; }).slice(0, 10).forEach(function(ak){
      var t = tracks.filter(function(x){ return x.ak === ak; })[0];
      seeds[ak] = {ar: t.p[0], w: played[ak]};
    });
  } else {
    profile = {};
    add(profile, rUnit, 1);
    add(profile, pUnit, PLAY_WEIGHT);
    profile = unit(profile);
  }
  var seedList = Object.keys(seeds).filter(function(ak){ return byArtist[ak]; })
    .map(function(ak){ return {ak: ak, ar: seeds[ak].ar, v: byArtist[ak]}; });
  return {geName: geName, tracks: tracks, byDir: byDir, byArtist: byArtist, profile: profile, liked: liked, seeds: seedList,
          rated: rated, favs: favs, stats: stats, albums: inp.albums || [], artists: inp.artists || []};
}

/* reason: unheard by a favorite artist, similar to a favorite artist, or the best matching features */
function reason(g, v, ak, name) {
  if (ak && g.liked[ak]) return {why: 'artist', ar: name};
  var best = null, bs = LIKE;
  g.seeds.forEach(function(s){
    if (s.ak === ak) return;
    var c = cos(s.v, v);
    if (c >= bs) { bs = c; best = s; }
  });
  if (best) return {why: 'like', ar: best.ar};
  var mood = '', mw = 0, ge = '', gw = 0;
  Object.keys(v).forEach(function(k){
    var w = v[k] * (g.profile[k] || 0);
    if (k.charAt(0) === 'm' && w > mw) { mw = w; mood = k.slice(2); }
    if (k.charAt(0) === 'g' && v[k] > gw) { gw = v[k]; ge = k.slice(2); }
  });
  return {why: 'tags', mood: mood, ge: g.geName[ge] || ge};
}

/* unheard counts fully, heard once or twice a bit less */
function novelty(n) { return n === 0 ? 1 : n === 1 ? 0.85 : 0.7; }

/* candidates with score for kind (artist|album|track) */
function candidates(g, kind) {
  var out = [], max = MAX_PLAYS[kind];
  if (empty(g.profile)) return out;
  function score(v, n, ak) {
    var s = cos(g.profile, v) * novelty(n);
    if (ak && g.liked[ak]) s = Math.max(s, 0.5) + 0.3;   /* unheard items by favorite artists always included */
    return s;
  }
  if (kind === 'track') {
    g.tracks.forEach(function(t){
      if (t.bad || t.n > max || g.favs[t.f] || !t.r) return;           /* only tracks with mood tags */
      var v = unit(t.v), s = score(v, t.n, t.ak);
      if (s >= MIN_SCORE) out.push({s: s, x: t, v: v, ak: t.ak, name: t.p[0]});
    });
  } else if (kind === 'album') {
    var bad = {};
    g.tracks.forEach(function(t){ var b = bad[t.dir] || (bad[t.dir] = {n: 0, bad: 0}); b.n++; if (t.bad) b.bad++; });
    g.albums.forEach(function(a){
      var v = g.byDir[a.dir], st = g.stats.album(a);
      if (!v || st.n > max || g.rated.albums[a.dir] || (bad[a.dir] && bad[a.dir].bad * 2 >= bad[a.dir].n)) return;
      var ak = a.ar === 'Verschiedene' ? '' : nk(a.ar), s = score(v, st.n, ak);
      if (s >= MIN_SCORE) out.push({s: s, x: a, v: v, ak: ak, name: a.ar, n: st.n, last: st.last});
    });
  } else {
    g.artists.forEach(function(a){
      var ak = nk(a.ar), v = g.byArtist[ak], st = g.stats.artist(a);
      if (!v || st.n > max || g.liked[ak] || a.ar === 'Verschiedene') return;
      var s = cos(g.profile, v) * novelty(st.n);
      if (s >= MIN_SCORE) out.push({s: s, x: a, v: v, ak: ak, name: a.ar, n: st.n, last: st.last});
    });
  }
  out.sort(function(a, b){ return b.s - a.s; });
  return out;
}

/* k out of the POOL best, weighted by score (rerolled on every call) -> entries for the UI */
function pick(g, kind, k, rnd) {
  rnd = rnd || Math.random;
  var pool = candidates(g, kind).slice(0, POOL);
  pool.forEach(function(c){ c.key = Math.pow(rnd() || 1e-9, 1 / (c.s * c.s)); });
  pool.sort(function(a, b){ return b.key - a.key; });
  return pool.slice(0, k || ROW).sort(function(a, b){ return b.s - a.s; }).map(function(c){
    var o;
    if (kind === 'track') { var p = c.x.p; o = {ar: p[0], ti: p[1], f: c.x.f, d: p[3] || 0, al: p[4] || '', plays: c.x.n}; }
    else if (kind === 'album') o = {dir: c.x.dir, al: c.x.al, ar: c.x.ar, plays: c.n};
    else o = {ar: c.x.ar, n: c.x.n, dir: c.x.dir, plays: c.n};
    if (c.last) o.last = c.last;
    o.why = reason(g, c.v, kind === 'artist' ? '' : c.ak, c.name);
    return o;
  });
}

module.exports = {prepare: prepare, candidates: candidates, pick: pick, trackVec: trackVec, ROW: ROW};
