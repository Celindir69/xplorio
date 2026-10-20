/* More like this track: library tracks with similar mood, energy and tempo (audio analysis),
   plus a little style and genre. Based on moodmix.index (tracks with mood data). Node 8, ES5 only. */
var moodtags = require('./moodtags.js');

var MIN_SCORE = 0.35;            /* below this a track is no longer "similar" */
var BPM_SPAN = 24;               /* this many BPM apart: tempo no longer counts */

function jaccard(a, b) {
  a = a || []; b = b || [];
  if (!a.length || !b.length) return 0;
  var both = a.filter(function(x){ return b.indexOf(x) >= 0; }).length;
  return both / (a.length + b.length - both);
}

/* tempo distance; half and double tempo count as equal (90 and 180 BPM) */
function bpmGap(a, b) { return Math.min(Math.abs(a - b), Math.abs(a - 2 * b), Math.abs(2 * a - b)); }

/* similarity 0..1 between seed s and track r ({mood, style, energy, bpm, src}); ge*: genre of both */
function score(s, r, geS, geR) {
  var m = jaccard(s.mood, r.mood);
  if (s.mood && s.mood.length && !m) return 0;                    /* without a shared mood not similar */
  var parts = s.mood && s.mood.length ? [[0.4, m]] : [];
  if (s.energy !== null && s.energy !== undefined) {
    parts.push([0.3, r.energy === null || r.energy === undefined ? 0.4 : Math.max(0, 1 - Math.abs(s.energy - r.energy) / 2.5)]);   /* 3 levels off: no match */
  }
  if (s.bpm && r.bpm) parts.push([0.2, 1 - Math.min(bpmGap(s.bpm, r.bpm) / BPM_SPAN, 1)]);
  if (s.style && s.style.length) parts.push([0.15, jaccard(s.style, r.style)]);
  if (geS) parts.push([0.05, String(geS).toLowerCase() === String(geR || '').toLowerCase() ? 1 : 0]);
  var w = 0, v = 0;
  parts.forEach(function(p){ w += p[0]; v += p[0] * p[1]; });
  return (w ? v / w : 0) * (r.src === 'artist' ? 0.85 : 1);          /* artist tags only: less certain */
}

/* seed: entry from the index (file or artist+title) or mood data from moodOf */
function seedOf(idx, q, moodOf) {
  var f = q.f, k = moodtags.trackKey(q.ar, q.ti), hit = null;
  for (var i = 0; i < idx.length && !hit; i++) {
    var it = idx[i].it;
    if ((f && it.f && (it.f === f || it.f.replace(/^mnt\//, '') === f.replace(/^mnt\//, ''))) || it.k === k) hit = idx[i];
  }
  if (hit) return {it: hit.it, r: hit.r};
  var r = moodOf ? moodOf(q.ar, q.ti, q.al) : null;
  return r ? {it: {f: f || '', ar: q.ar, ti: q.ti, al: q.al || '', k: k, ge: q.ge || ''}, r: r} : null;
}

/* similar tracks: at most n, at most maxPer per artist, without the track itself and skip(it);
   shuffle (dice): weighted draw from the best 3n instead of the best n, recently heard (o.recent) last. -> {seed, items: [{it, r, s}]} */
function pick(idx, seed, o) {
  o = o || {};
  var n = o.n || 25, maxPer = o.maxPer || 2, rnd = o.rnd || Math.random;
  var s = seed.r, selfK = seed.it.k || moodtags.trackKey(seed.it.ar, seed.it.ti), seen = {};
  seen[selfK] = true;
  var cand = [];
  idx.forEach(function(x){
    if (seen[x.it.k] || (o.skip && o.skip(x.it))) return;
    seen[x.it.k] = true;
    var v = score(s, x.r, seed.it.ge, x.it.ge);
    if (v >= MIN_SCORE) cand.push({it: x.it, r: x.r, s: v});
  });
  cand.sort(function(a, b){ return b.s - a.s; });
  if (o.shuffle) {
    cand = cand.slice(0, n * 3);
    cand.forEach(function(x){                          /* more similar more often, recently heard (o.recent) only as filler */
      x.key = Math.pow(rnd() || 1e-9, 1 / (x.s * x.s)) - (o.recent && o.recent(x.it) ? 1 : 0);
    });
    cand.sort(function(a, b){ return b.key - a.key; });
  }
  var per = {}, out = [];
  for (var i = 0; i < cand.length && out.length < n; i++) {
    var a = moodtags.artistKey(cand[i].it.ar);
    if ((per[a] || 0) >= maxPer) continue;
    per[a] = (per[a] || 0) + 1;
    out.push(cand[i]);
  }
  return out;
}

/* reason for display: shared moods (at most two), energy and tempo of the track */
function why(s, r) {
  return {mood: (r.mood || []).filter(function(m){ return (s.mood || []).indexOf(m) >= 0; }).slice(0, 2),
          energy: r.energy === undefined ? null : r.energy, bpm: r.bpm || null};
}

module.exports = {score: score, seedOf: seedOf, pick: pick, why: why, bpmGap: bpmGap, MIN_SCORE: MIN_SCORE};
