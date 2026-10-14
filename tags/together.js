/* Passt zusammen: Mixe aus 2–3 Künstlern der eigenen Sammlung, die musikalisch gut zusammenpassen.
   Anker ist ein Künstler, den man oft hört oder mit Herz markiert hat; dazu 1–2 Künstler mit ähnlichem Klangprofil
   (Genre, Stimmungen, Stile, Energie aus den Stimmungs-Tags, wie bei den Perlen in gems.js), Last.fm-„ähnliche Künstler“
   zählen extra, seltener Gehörte bekommen einen kleinen Vorsprung. Ein Mix: etwa 25 Titel, rund 40 % Lieblingstitel
   (oft gehört, Favorit, Album mit 4–5 Sternen) und 60 % selten oder nie gehörte; „mag ich nicht“ und Alben mit
   1–2 Sternen bleiben draußen. Die Künstler wechseln sich ab, Energie und Tempo gehen sanft ineinander über.
   Arbeitet auf dem vorbereiteten Stand von gems.prepare. Node 8, nur ES5. */
var plays = require('./plays.js');

var MIXES = 6;                   /* Mixe je Tag */
var MIN_TRACKS = 6;              /* so viele brauchbare Titel braucht ein Künstler */
var MIN_SIM = 0.3;               /* Klangähnlichkeit (Kosinus) für ein Paar mindestens … */
var TOP_SHARE = 0.15;            /* … und unter den ähnlichsten 15 % aller Paare der Sammlung */
var SAMPLE = 4000;               /* so viele Paare reichen, um diese Schwelle zu schätzen */
var LFM_BONUS = 0.15;            /* Last.fm nennt den Künstler als ähnlich */
var RARE_BONUS = 0.1;            /* Partner wird deutlich seltener gehört als der Anker */
var THIRD_CHANCE = 0.6;          /* so oft kommt ein dritter Künstler dazu, wenn einer passt */
var SIZE = 25;                   /* Titel je Mix */
var FAV_SHARE = 0.4;             /* Anteil Lieblingstitel */
var VARIOUS = plays.norm('Verschiedene');

function nk(s) { return plays.norm(s); }
function cos(a, b) { var s = 0; for (var k in a) if (b[k]) s += a[k] * b[k]; return s; }

/* Zufall aus einem Text (gleicher Tag, gleiche Auswahl) */
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

/* Künstler mit genug brauchbaren Titeln: {ak: {ak, ar, v, tracks, plays, liked}} (je Stand von g nur einmal) */
function pool(g) {
  if (g._together) return g._together;
  var by = {}, rated = (g.rated && g.rated.albums) || {};
  g.tracks.forEach(function(t){
    if (t.bad || !t.ak || t.ak === VARIOUS) return;
    var st = rated[t.dir] && rated[t.dir].v;
    if (st && st > 0 && st <= 2) return;                          /* Alben mit 1–2 Sternen */
    var a = by[t.ak] || (by[t.ak] = {ak: t.ak, ar: t.p[0], tracks: [], plays: 0});
    a.tracks.push(t);
    a.plays += t.n;
  });
  var out = {};
  Object.keys(by).forEach(function(ak){
    var a = by[ak];
    if (a.tracks.length < MIN_TRACKS || !g.byArtist[ak]) return;
    a.v = g.byArtist[ak];
    a.liked = !!(g.liked && g.liked[ak]);
    out[ak] = a;
  });
  g._together = out;
  g._togetherMin = threshold(out);
  return out;
}

/* Schwelle für „passt“: Genres sind je Sammlung verschieden fein, darum relativ zur eigenen Sammlung
   (die ähnlichsten TOP_SHARE aller Paare), nie unter MIN_SIM. Bei großen Sammlungen aus einer Stichprobe. */
function threshold(p) {
  var list = Object.keys(p).map(function(ak){ return p[ak]; }), n = list.length, sims = [];
  if (n < 2) return MIN_SIM;
  var pairs = n * (n - 1) / 2, rnd = seeded('schwelle:' + n);
  if (pairs <= SAMPLE) {
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) sims.push(cos(list[i].v, list[j].v));
  } else {
    for (var k = 0; k < SAMPLE; k++) {
      var a = Math.floor(rnd() * n), b = Math.floor(rnd() * (n - 1));
      if (b >= a) b++;
      sims.push(cos(list[a].v, list[b].v));
    }
  }
  sims.sort(function(x, y){ return y - x; });
  return Math.max(MIN_SIM, sims[Math.min(sims.length - 1, Math.floor(sims.length * TOP_SHARE))]);
}

/* Gewicht als Anker: Herz bzw. gute Bewertung und wie oft gehört; 0 = nie gehört und nicht gemocht */
function anchorWeight(a) { return (a.liked ? 3 : 0) + Math.log(1 + a.plays); }

/* mögliche Anker, beste zuerst (für die Last.fm-Abfrage vorab) */
function anchors(g, k) {
  var p = pool(g);
  return Object.keys(p).map(function(ak){ return p[ak]; }).filter(function(a){ return anchorWeight(a) > 0; })
    .sort(function(a, b){ return anchorWeight(b) - anchorWeight(a); }).slice(0, k || 12)
    .map(function(a){ return {ak: a.ak, ar: a.ar}; });
}

/* gewichtete Reihenfolge ohne Zurücklegen */
function weightedOrder(list, w, rnd) {
  return list.map(function(x){ return {x: x, k: Math.pow(rnd() || 1e-9, 1 / Math.max(w(x), 1e-6))}; })
    .sort(function(a, b){ return b.k - a.k; }).map(function(o){ return o.x; });
}

/* Grund: was die Künstler gemeinsam haben (Stimmung, Stil, Genre; jeweils das schwächste Gewicht zählt) */
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

/* Mixe des Tages. opts: {rnd, similar: {ak: {ak: true}} (Last.fm), avoid: {Schlüssel: true} (kürzlich gezeigt), n} */
function build(g, opts) {
  opts = opts || {};
  var rnd = opts.rnd || Math.random, sim = opts.similar || {}, avoid = opts.avoid || {}, n = opts.n || MIXES;
  var p = pool(g), keys = Object.keys(p), min = g._togetherMin;
  var cand = keys.map(function(ak){ return p[ak]; });
  var anc = cand.filter(function(a){ return anchorWeight(a) > 0; });
  if (!anc.length) anc = cand;                                    /* noch kein Verlauf: jeder kann Anker sein */
  anc = weightedOrder(anc, function(a){ return anchorWeight(a) || 1; }, rnd);
  var used = {}, out = [];
  function lf(a, b) { return !!((sim[a.ak] && sim[a.ak][b.ak]) || (sim[b.ak] && sim[b.ak][a.ak])); }
  function score(a, b) {
    var s = cos(a.v, b.v), l = lf(a, b);
    if (s < min && !(l && s >= Math.max(min - LFM_BONUS, MIN_SIM))) return 0;
    return s + (l ? LFM_BONUS : 0) + (b.plays * 3 < a.plays ? RARE_BONUS : 0);
  }
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
          .filter(function(x){ return x.s > 0; }).sort(function(x, y){ return y.s - x.s; })[0];
        if (third) members.push(third.c);
      }
      var key = members.map(function(m){ return m.ak; }).sort().join('+');
      if (avoid[key]) continue;
      members.forEach(function(m){ used[m.ak] = true; });
      out.push({key: key, artists: members.map(function(m){ return {ar: m.ar, n: m.tracks.length}; }),
                why: why(g, members, members.slice(1).some(function(m){ return lf(a, m); }))});
      break;
    }
  }
  return out;
}

/* Lieblingstitel: oft gehört, Volumio-Favorit oder Album mit 4–5 Sternen */
function favScore(g, t) {
  var st = g.rated && g.rated.albums && g.rated.albums[t.dir] && g.rated.albums[t.dir].v;
  return t.n + (g.favs && g.favs[t.f] ? 3 : 0) + (st >= 4 ? st - 2 : 0);
}

/* Reihenfolge: Künstler wechseln sich ab, Energie und Tempo ändern sich sanft; ruhiger Anfang */
function order(list, rnd) {
  function e(t) { return t.r && typeof t.r.energy === 'number' ? t.r.energy : 3; }
  function bpm(t) { return t.r && t.r.bpm ? t.r.bpm : null; }
  function dist(a, b) {
    var d = Math.abs(e(a) - e(b)), x = bpm(a), y = bpm(b);
    if (x && y) d += Math.min(Math.abs(x - y), Math.abs(x - 2 * y), Math.abs(2 * x - y)) / 15;   /* halbes/doppeltes Tempo passt auch */
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

/* Titel eines Mixes. names: Künstlernamen; opts: {rnd, size, bad: {Datei: true} („mag ich nicht“, zusätzlich)} */
function mix(g, names, opts) {
  opts = opts || {};
  var rnd = opts.rnd || Math.random, size = opts.size || SIZE, bad = opts.bad || {}, p = pool(g);
  var members = [];
  names.forEach(function(n){ var a = p[nk(n)]; if (a && members.indexOf(a) < 0) members.push(a); });
  if (members.length < 2) return [];
  var picked = [], seen = {};
  function take(t) {
    var k = t.ak + '|' + nk(t.p[1]);
    if (seen[k] || bad[t.f]) return false;                      /* jeder Titel nur einmal (auch in anderer Fassung) */
    seen[k] = true; picked.push(t); return true;
  }
  members.forEach(function(a, i){
    var quota = Math.floor(size / members.length) + (i < size % members.length ? 1 : 0);
    var favQ = Math.round(quota * FAV_SHARE);
    var favs = a.tracks.filter(function(t){ return favScore(g, t) >= 2; })
      .sort(function(x, y){ return favScore(g, y) - favScore(g, x); });
    var rare = a.tracks.filter(function(t){ return favScore(g, t) < 2; });
    var favPool = weightedOrder(favs.slice(0, Math.max(favQ * 2, 4)), function(t){ return favScore(g, t); }, rnd);
    rare = weightedOrder(rare, function(t){ return t.n ? 0.6 : 1; }, rnd);             /* nie Gehörtes etwas eher */
    var got = 0, fav = 0;
    favPool.forEach(function(t){ if (fav < favQ && take(t)) { fav++; got++; t._fav = true; } });
    rare.forEach(function(t){ if (got < quota && take(t)) { got++; t._fav = false; } });
    favs.forEach(function(t){ if (got < quota && take(t)) { got++; t._fav = true; } });   /* zu wenig Seltenes: mehr Lieblinge */
  });
  /* hat ein Künstler zu wenige Titel, füllen die anderen auf */
  members.forEach(function(a){
    a.tracks.forEach(function(t){ if (picked.length < size && take(t)) t._fav = favScore(g, t) >= 2; });
  });
  return order(picked, rnd).map(function(t){
    var o = {f: t.f, ar: t.p[0], ti: t.p[1], al: t.p[4] || '', d: t.p[3] || 0, plays: t.n, fav: !!t._fav};
    delete t._fav;
    return o;
  });
}

module.exports = {build: build, mix: mix, anchors: anchors, pool: pool, seeded: seeded, MIXES: MIXES, SIZE: SIZE};
