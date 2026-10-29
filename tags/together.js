/* Goes together: mixes of 2–3 artists from one's own collection that fit well together musically.
   The anchor is an artist one listens to often or has marked with a heart; plus 1–2 artists with a similar sound profile
   (genre, moods, styles, energy from the mood tags, as for the gems in gems.js); Last.fm "similar artists"
   count extra, less often heard ones get a small head start. The same top genre alone is not enough: the artists must
   share a style (subgenre, e.g. "trip hop" rather than "electronic"), or Last.fm must list them as similar.
   Similarity is scored per part, so that the genre (the same on every track) cannot outweigh the rest:
   styles 45 %, moods 25 %, tempo and energy 20 %, genre 10 %. Average tempo (half or double counts as the same)
   and average energy must be close. One mix: about 25 tracks, around 40 % favorite tracks
   (often heard, favorite, album with 4–5 stars) and 60 % rarely or never heard; "don't like" and albums with
   1–2 stars stay out. The artists alternate, energy and tempo blend smoothly.
   Works on the prepared state from gems.prepare. Node 8, ES5 only. */
var plays = require('./plays.js');

var MIXES = 6;                   /* mixes per day */
var MIN_TRACKS = 6;              /* an artist needs this many usable tracks */
var W = {s: 0.45, m: 0.25, t: 0.2, g: 0.1};   /* weights of the parts: styles, moods, tempo/energy, genre */
var MAX_BPM = 0.15;              /* average tempo at most 15 % apart (half/double tempo counts as the same) */
var MAX_ENERGY = 1;              /* average energy (1–5) at most one step apart */
var MIN_SIM = 0.3;               /* minimum sound similarity (cosine) for a pair … */
var TOP_SHARE = 0.15;            /* … and among the most similar 15 % of all pairs in the collection */
var SAMPLE = 4000;               /* this many pairs are enough to estimate that threshold */
var LFM_BONUS = 0.15;            /* Last.fm lists the artist as similar */
var STYLE_MIN = 0.08;            /* shared style: weight in the (unit) profile of both artists at least this */
var RARE_BONUS = 0.1;            /* partner is heard much less often than the anchor */
var THIRD_CHANCE = 0.6;          /* how often a third artist is added if one fits */
var SIZE = 25;                   /* tracks per mix */
var FAV_SHARE = 0.4;             /* share of favorite tracks */
var VARIOUS = plays.norm('Verschiedene');

function nk(s) { return plays.norm(s); }
function cos(a, b) { var s = 0; for (var k in a) if (b[k]) s += a[k] * b[k]; return s; }

/* part of a profile ('s', 'm' or 'g') as its own unit vector */
function part(v, t) {
  var o = {}, l = 0, k;
  for (k in v) if (k.charAt(0) === t) { o[k] = v[k]; l += v[k] * v[k]; }
  l = Math.sqrt(l);
  if (l) for (k in o) o[k] /= l;
  return o;
}
function median(list) {
  if (!list.length) return null;
  list.sort(function(x, y){ return x - y; });
  return list[Math.floor(list.length / 2)];
}
/* tempo distance as a share, half or double tempo counts as the same; null = unknown */
function bpmDist(x, y) {
  if (!x || !y) return null;
  return Math.min(Math.abs(x - y), Math.abs(x - 2 * y), Math.abs(2 * x - y)) / Math.max(x, y);
}
/* tempo and energy close enough (unknown counts as close) */
function paceOk(a, b) {
  var d = bpmDist(a.bpm, b.bpm);
  if (d !== null && d > MAX_BPM) return false;
  return a.en === null || b.en === null || Math.abs(a.en - b.en) <= MAX_ENERGY;
}
/* 0..1: 1 = same tempo and energy, 0.5 if nothing is known */
function paceSim(a, b) {
  var d = bpmDist(a.bpm, b.bpm), e = a.en !== null && b.en !== null ? Math.abs(a.en - b.en) : null, out = [];
  if (d !== null) out.push(1 - Math.min(1, d / (2 * MAX_BPM)));
  if (e !== null) out.push(1 - Math.min(1, e / (2 * MAX_ENERGY)));
  return out.length ? out.reduce(function(x, y){ return x + y; }, 0) / out.length : 0.5;
}
/* sound similarity of two artists, per part (see above) */
function sim(a, b) {
  return W.s * cos(a.parts.s, b.parts.s) + W.m * cos(a.parts.m, b.parts.m) + W.t * paceSim(a, b) + W.g * cos(a.parts.g, b.parts.g);
}

/* randomness from a string (same day, same selection) */
function seeded(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return function(){
    h = (h + 0x6D2B79F5) >>> 0;
    var t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* artists with enough usable tracks: {ak: {ak, ar, v, tracks, plays, liked}} (only once per state of g) */
function pool(g) {
  if (g._together) return g._together;
  var by = {}, rated = (g.rated && g.rated.albums) || {};
  g.tracks.forEach(function(t){
    if (t.bad || !t.ak || t.ak === VARIOUS) return;
    var st = rated[t.dir] && rated[t.dir].v;
    if (st && st > 0 && st <= 2) return;                          /* albums with 1–2 stars */
    var a = by[t.ak] || (by[t.ak] = {ak: t.ak, ar: t.p[0], tracks: [], plays: 0});
    a.tracks.push(t);
    a.plays += t.n;
  });
  var out = {};
  Object.keys(by).forEach(function(ak){
    var a = by[ak];
    if (a.tracks.length < MIN_TRACKS || !g.byArtist[ak]) return;
    a.v = g.byArtist[ak];
    a.parts = {s: part(a.v, 's'), m: part(a.v, 'm'), g: part(a.v, 'g')};
    var bpms = [], ens = [];
    a.tracks.forEach(function(t){
      if (t.r && t.r.bpm) bpms.push(t.r.bpm);
      if (t.r && typeof t.r.energy === 'number') ens.push(t.r.energy);
    });
    a.bpm = median(bpms);
    a.en = ens.length ? ens.reduce(function(x, y){ return x + y; }, 0) / ens.length : null;
    a.liked = !!(g.liked && g.liked[ak]);
    out[ak] = a;
  });
  g._together = out;
  g._togetherMin = threshold(out);
  return out;
}

/* threshold for "fits": genres differ in granularity per collection, so relative to the own collection
   (the most similar TOP_SHARE of all pairs), never below MIN_SIM. For large collections from a sample. */
function threshold(p) {
  var list = Object.keys(p).map(function(ak){ return p[ak]; }), n = list.length, sims = [];
  if (n < 2) return MIN_SIM;
  var pairs = n * (n - 1) / 2, rnd = seeded('schwelle:' + n);
  if (pairs <= SAMPLE) {
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) sims.push(sim(list[i], list[j]));
  } else {
    for (var k = 0; k < SAMPLE; k++) {
      var a = Math.floor(rnd() * n), b = Math.floor(rnd() * (n - 1));
      if (b >= a) b++;
      sims.push(sim(list[a], list[b]));
    }
  }
  sims.sort(function(x, y){ return y - x; });
  return Math.max(MIN_SIM, sims[Math.min(sims.length - 1, Math.floor(sims.length * TOP_SHARE))]);
}

/* strongest style all members share: weight of the weakest member, 0 = none in common */
function sharedStyle(members) {
  var best = 0;
  Object.keys(members[0].v).forEach(function(k){
    if (k.charAt(0) !== 's') return;
    var w = Math.min.apply(null, members.map(function(a){ return a.v[k] || 0; }));
    if (w > best) best = w;
  });
  return best;
}

/* weight as anchor: heart or good rating and how often heard; 0 = never heard and not liked */
function anchorWeight(a) { return (a.liked ? 3 : 0) + Math.log(1 + a.plays); }

/* possible anchors, best first (for the Last.fm query beforehand) */
function anchors(g, k) {
  var p = pool(g);
  return Object.keys(p).map(function(ak){ return p[ak]; }).filter(function(a){ return anchorWeight(a) > 0; })
    .sort(function(a, b){ return anchorWeight(b) - anchorWeight(a); }).slice(0, k || 12)
    .map(function(a){ return {ak: a.ak, ar: a.ar}; });
}

/* weighted order without replacement */
function weightedOrder(list, w, rnd) {
  return list.map(function(x){ return {x: x, k: Math.pow(rnd() || 1e-9, 1 / Math.max(w(x), 1e-6))}; })
    .sort(function(a, b){ return b.k - a.k; }).map(function(o){ return o.x; });
}

/* reason: what the artists have in common (mood, style, genre; the weakest weight counts) */
function why(g, members, lfm) {
  var best = {m: ['', 0], s: ['', 0], g: ['', 0]};
  Object.keys(members[0].v).forEach(function(k){
    var w = Math.min.apply(null, members.map(function(a){ return a.v[k] || 0; }));
    var t = k.charAt(0);
    if (best[t] && w > best[t][1]) best[t] = [k.slice(2), w];
  });
  var ge = best.g[0];
  return {mood: best.m[0], style: best.s[0], ge: (g.geName && g.geName[ge]) || ge, lfm: !!lfm};
}

/* mixes of the day. opts: {rnd, similar: {ak: {ak: true}} (Last.fm), avoid: {key: true} (recently shown), n} */
function build(g, opts) {
  opts = opts || {};
  var rnd = opts.rnd || Math.random, lfm = opts.similar || {}, avoid = opts.avoid || {}, n = opts.n || MIXES;
  var p = pool(g), keys = Object.keys(p), min = g._togetherMin;
  var cand = keys.map(function(ak){ return p[ak]; });
  var anc = cand.filter(function(a){ return anchorWeight(a) > 0; });
  if (!anc.length) anc = cand;                                    /* no history yet: anyone can be the anchor */
  anc = weightedOrder(anc, function(a){ return anchorWeight(a) || 1; }, rnd);
  var used = {}, out = [];
  function lf(a, b) { return !!((lfm[a.ak] && lfm[a.ak][b.ak]) || (lfm[b.ak] && lfm[b.ak][a.ak])); }
  function score(a, b) {
    var s = sim(a, b), l = lf(a, b);
    if (!paceOk(a, b)) return 0;
    if (s < min && !(l && s >= Math.max(min - LFM_BONUS, MIN_SIM))) return 0;
    if (!l && sharedStyle([a, b]) < STYLE_MIN) return 0;          /* the same top genre alone is not enough */
    return s + (l ? LFM_BONUS : 0) + (b.plays * 3 < a.plays ? RARE_BONUS : 0);
  }
  /* first pairings not shown in the last days; if that gives fewer than n, fill up with ones shown before */
  pass(avoid);
  if (out.length < n) pass({});
  return out;

  function pass(skip) {
  for (var i = 0; i < anc.length && out.length < n; i++) {
    var a = anc[i];
    if (used[a.ak]) continue;
    var partners = cand.filter(function(b){ return b !== a && !used[b.ak]; })
      .map(function(b){ return {b: b, s: score(a, b)}; }).filter(function(x){ return x.s > 0; })
      .sort(function(x, y){ return y.s - x.s; }).slice(0, 5);
    partners = weightedOrder(partners, function(x){ return x.s * x.s; }, rnd);
    for (var j = 0; j < partners.length; j++) {
      var b = partners[j].b, members = [a, b];
      if (rnd() < THIRD_CHANCE) {
        var third = cand.filter(function(c){ return c !== a && c !== b && !used[c.ak]; })
          .map(function(c){ return {c: c, s: Math.min(score(a, c), score(b, c))}; })
          .filter(function(x){ return x.s > 0 && (lf(a, x.c) || sharedStyle([a, b, x.c]) >= STYLE_MIN); }).sort(function(x, y){ return y.s - x.s; })[0];
        if (third) members.push(third.c);
      }
      var key = members.map(function(m){ return m.ak; }).sort().join('+');
      if (skip[key]) continue;
      members.forEach(function(m){ used[m.ak] = true; });
      out.push({key: key, artists: members.map(function(m){ return {ar: m.ar, n: m.tracks.length}; }),
                why: why(g, members, members.slice(1).some(function(m){ return lf(a, m); }))});
      break;
    }
  }
  }
}

/* favorite track: often heard, Volumio favorite or album with 4–5 stars */
function favScore(g, t) {
  var st = g.rated && g.rated.albums && g.rated.albums[t.dir] && g.rated.albums[t.dir].v;
  return t.n + (g.favs && g.favs[t.f] ? 3 : 0) + (st >= 4 ? st - 2 : 0);
}

/* order: artists alternate, energy and tempo change smoothly; calm start */
function order(list, rnd) {
  function e(t) { return t.r && typeof t.r.energy === 'number' ? t.r.energy : 3; }
  function bpm(t) { return t.r && t.r.bpm ? t.r.bpm : null; }
  function dist(a, b) {
    var d = Math.abs(e(a) - e(b)), x = bpm(a), y = bpm(b);
    if (x && y) d += Math.min(Math.abs(x - y), Math.abs(x - 2 * y), Math.abs(2 * x - y)) / 15;   /* half/double tempo fits too */
    return d;
  }
  var rest = list.slice(), out = [];
  rest.sort(function(a, b){ return Math.abs(e(a) - 2.5) - Math.abs(e(b) - 2.5) || rnd() - 0.5; });
  out.push(rest.shift());
  while (rest.length) {
    var prev = out[out.length - 1], bi = -1, bd = Infinity;
    for (var i = 0; i < rest.length; i++) {
      var d = dist(prev, rest[i]) + rnd() * 0.6 + (rest[i].ak === prev.ak ? 10 : 0);
      if (d < bd) { bd = d; bi = i; }
    }
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

/* tracks of a mix. names: artist names; opts: {rnd, size, bad: {file: true} ("don't like", additionally)} */
function mix(g, names, opts) {
  opts = opts || {};
  var rnd = opts.rnd || Math.random, size = opts.size || SIZE, bad = opts.bad || {}, p = pool(g);
  var members = [];
  names.forEach(function(n){ var a = p[nk(n)]; if (a && members.indexOf(a) < 0) members.push(a); });
  if (members.length < 2) return [];
  var picked = [], seen = {};
  function take(t) {
    var k = t.ak + '|' + nk(t.p[1]);
    if (seen[k] || bad[t.f]) return false;                      /* each track only once (also in another version) */
    seen[k] = true; picked.push(t); return true;
  }
  members.forEach(function(a, i){
    var quota = Math.floor(size / members.length) + (i < size % members.length ? 1 : 0);
    var favQ = Math.round(quota * FAV_SHARE);
    var favs = a.tracks.filter(function(t){ return favScore(g, t) >= 2; })
      .sort(function(x, y){ return favScore(g, y) - favScore(g, x); });
    var rare = a.tracks.filter(function(t){ return favScore(g, t) < 2; });
    var favPool = weightedOrder(favs.slice(0, Math.max(favQ * 2, 4)), function(t){ return favScore(g, t); }, rnd);
    rare = weightedOrder(rare, function(t){ return t.n ? 0.6 : 1; }, rnd);             /* never heard slightly preferred */
    var got = 0, fav = 0;
    favPool.forEach(function(t){ if (fav < favQ && take(t)) { fav++; got++; t._fav = true; } });
    rare.forEach(function(t){ if (got < quota && take(t)) { got++; t._fav = false; } });
    favs.forEach(function(t){ if (got < quota && take(t)) { got++; t._fav = true; } });   /* too few rare ones: more favorites */
  });
  /* if an artist has too few tracks, the others fill up */
  members.forEach(function(a){
    a.tracks.forEach(function(t){ if (picked.length < size && take(t)) t._fav = favScore(g, t) >= 2; });
  });
  return order(picked, rnd).map(function(t){
    var o = {f: t.f, ar: t.p[0], ti: t.p[1], al: t.p[4] || '', d: t.p[3] || 0, plays: t.n, fav: !!t._fav};
    delete t._fav;
    return o;
  });
}

module.exports = {build: build, mix: mix, anchors: anchors, pool: pool, seeded: seeded, sharedStyle: sharedStyle, sim: sim, paceOk: paceOk, bpmDist: bpmDist, MIXES: MIXES, SIZE: SIZE};
