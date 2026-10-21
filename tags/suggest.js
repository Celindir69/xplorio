/* "Did you mean …?": when the local search finds nothing, compare the search term with the artist and album names of
   the album list. Ignores accents, case, a leading "The", "&"/"and" and punctuation (plays.norm) and allows small typos.
   index(list) once per album list, suggest(idx, q) per search. */
var plays = require('./plays.js');

var MAX = 3;

/* typos allowed for a normalized search term of this length */
function limit(len) { return len < 4 ? 0 : len < 6 ? 1 : len < 10 ? 2 : 3; }

/* edit distance with swapped neighbours (Damerau, restricted); stops early above max */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  var prev2 = null, prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    var best = i;
    for (j = 1; j <= b.length; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

/* album list [{al, ar, …}] -> [{kind: 'artist'|'album', name, ar, n, words, count}] */
function index(list) {
  var byKey = {}, out = [];
  function add(kind, name, ar) {
    var n = plays.norm(name);
    if (!n) return;
    var k = kind + '|' + n + (kind === 'album' ? '|' + plays.norm(ar) : '');
    if (byKey[k]) { byKey[k].count++; return; }
    var words = String(name).split(/[\s\/\-–:,(]+/).map(plays.norm).filter(function(w){ return w.length >= 4 && w !== n; });
    out.push(byKey[k] = {kind: kind, name: name, ar: ar || '', n: n, words: words, count: 1});
  }
  (list || []).forEach(function(a){
    if (a.ar && a.ar !== 'Verschiedene') add('artist', a.ar);
    if (a.al) add('album', a.al, a.ar === 'Verschiedene' ? '' : a.ar);
  });
  return out;
}

/* search term -> up to MAX entries [{kind, name, ar}], best first; [] if nothing is close enough */
function suggest(idx, q, max) {
  var qn = plays.norm(q), lim = limit(qn.length), hits = [];
  if (qn.length < 3) return [];
  (idx || []).forEach(function(e){
    var s;
    if (e.n === qn) s = 0;                                            /* same apart from accents, "The", punctuation */
    else if (qn.length >= 4 && e.n.indexOf(qn) >= 0) s = 1;           /* part of the name */
    else {
      var d = distance(qn, e.n, lim);
      e.words.forEach(function(w){ if (d > lim) d = distance(qn, w, lim) + 0.5; });   /* one word of the name */
      if (d > lim) return;
      s = 1 + d;
    }
    hits.push({e: e, s: s});
  });
  hits.sort(function(x, y){
    return x.s - y.s || (x.e.kind === 'artist' ? 0 : 1) - (y.e.kind === 'artist' ? 0 : 1) || y.e.count - x.e.count ||
           Math.abs(x.e.n.length - qn.length) - Math.abs(y.e.n.length - qn.length);
  });
  var seen = {};
  return hits.filter(function(h){
    var k = h.e.kind + '|' + h.e.name.toLowerCase();
    return !seen[k] && (seen[k] = true);
  }).slice(0, max || MAX).map(function(h){ return {kind: h.e.kind, name: h.e.name, ar: h.e.ar}; });
}

module.exports = {index: index, suggest: suggest, distance: distance};
