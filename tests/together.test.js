/* Passt zusammen: Auswahl passender Künstler (Klangprofil, Last.fm, Ausschlüsse) und die Titel eines Mixes */
var assert = require('assert');
var gems = require('../tags/gems.js'), discover = require('../tags/discover.js'), together = require('../tags/together.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

/* Bibliothek: Jazz (ruhig) von A, B, C, D; Metal (laut) von M, N; je 8 Titel; P hat nur 3 Titel, „Verschiedene“ 8 */
var R = {
  jazz:  {mood: ['melancholic', 'relaxed'], style: ['cool jazz'], energy: 2, bpm: 90, src: 'track'},
  metal: {mood: ['intense', 'dark'], style: ['thrash metal'], energy: 5, bpm: 180, src: 'track'}
};
var lib = [], moods = {}, albumList = [];
[['A', 'Jazz', 'jazz', 8], ['B', 'Jazz', 'jazz', 8], ['C', 'Jazz', 'jazz', 8], ['D', 'Jazz', 'jazz', 8],
 ['M', 'Metal', 'metal', 8], ['N', 'Metal', 'metal', 8], ['P', 'Jazz', 'jazz', 3], ['Verschiedene', 'Jazz', 'jazz', 8]].forEach(function(x){
  var al = x[0] + '1', dir = 'USB/' + x[0] + '/' + al;
  albumList.push({dir: dir, al: al, ar: x[0], ge: x[1]});
  for (var i = 1; i <= x[3]; i++) {
    var f = dir + '/' + i + '.flac';
    lib.push([x[0], al + ' ' + i, f, 200, al, x[1]]);
    moods[f] = R[x[2]];
  }
});
var artists = ['A', 'B', 'C', 'D', 'M', 'N', 'P'].map(function(a){ return {ar: a, n: 1, dir: 'USB/' + a}; });
function prep(o) {
  return gems.prepare({lib: lib, moodOf: function(f){ return moods[f] || null; }, albums: albumList, artists: artists,
    rated: o.rated || {artists: {}, albums: {}, tracks: {}}, favs: o.favs || {}, stats: discover.statIndex(o.plays || [])});
}
function played(ar, nums, k) {
  var out = [];
  for (var j = 0; j < k; j++) nums.forEach(function(i){ out.push({t: 1000 + j, ar: ar, ti: ar + '1 ' + i, al: ar + '1', u: 'USB/' + ar + '/' + ar + '1/' + i + '.flac'}); });
  return out;
}
var hist = played('A', [1, 2, 3, 4], 5).concat(played('M', [1, 2], 3));
function names(m) { return m.artists.map(function(a){ return a.ar; }).sort().join('+'); }

t('nur Künstler mit genug Titeln; „Verschiedene“ nicht', function(){
  var p = together.pool(prep({plays: hist}));
  assert.deepStrictEqual(Object.keys(p).sort(), ['a', 'b', 'c', 'd', 'm', 'n']);
});

t('Mixe: Jazz zu Jazz, Metal zu Metal, jeder Künstler nur einmal', function(){
  var out = together.build(prep({plays: hist}), {rnd: together.seeded('2026-10-14')});
  assert.ok(out.length >= 2);
  var seen = {};
  out.forEach(function(m){
    assert.ok(m.artists.length >= 2 && m.artists.length <= 3);
    var kinds = m.artists.map(function(a){ return /[MN]/.test(a.ar) ? 'metal' : 'jazz'; });
    assert.ok(kinds.every(function(k){ return k === kinds[0]; }), names(m));
    m.artists.forEach(function(a){ assert.ok(!seen[a.ar], a.ar + ' doppelt'); seen[a.ar] = true; });
  });
  var jazz = out.filter(function(m){ return /A|B|C|D/.test(names(m)); })[0];
  assert.strictEqual(jazz.why.mood, 'melancholic');
  assert.strictEqual(jazz.why.style, 'cool jazz');
  assert.strictEqual(jazz.why.ge, 'Jazz');
});

t('gleicher Tag, gleiche Auswahl', function(){
  var a = together.build(prep({plays: hist}), {rnd: together.seeded('2026-10-14')});
  var b = together.build(prep({plays: hist}), {rnd: together.seeded('2026-10-14')});
  assert.deepStrictEqual(a, b);
});

t('kürzlich Gezeigtes wird übersprungen', function(){
  var g = prep({plays: hist}), avoid = {};
  together.build(g, {rnd: together.seeded('x')}).forEach(function(m){ avoid[m.key] = true; });
  together.build(g, {rnd: together.seeded('x'), avoid: avoid}).forEach(function(m){ assert.ok(!avoid[m.key], m.key); });
});

t('Last.fm nennt den Partner: als Grund vermerkt', function(){
  var sim = {a: {b: true, c: true, d: true}};
  var out = together.build(prep({plays: hist}), {rnd: together.seeded('y'), similar: sim});
  var withA = out.filter(function(m){ return m.key.split('+').indexOf('a') >= 0; })[0];
  assert.ok(withA && withA.why.lfm);
});

t('Mix: Anteil Lieblingstitel, „mag ich nicht“ und schlechte Alben draußen, Künstler wechseln sich ab', function(){
  var rated = {artists: {}, albums: {'USB/C/C1': {v: 2}}, tracks: {'USB/A/A1/5.flac': {v: -1}}};
  var g = prep({plays: hist, rated: rated});
  var m = together.mix(g, ['A', 'B'], {rnd: together.seeded('z'), size: 10});
  assert.strictEqual(m.length, 10);
  assert.strictEqual(m.filter(function(x){ return x.ar === 'A'; }).length, 5);
  assert.strictEqual(m.filter(function(x){ return x.fav; }).length, 2);          /* 40 % von 5 bei A; B ohne Lieblinge */
  assert.ok(m.every(function(x){ return x.f !== 'USB/A/A1/5.flac'; }));
  for (var i = 1; i < m.length; i++) assert.notStrictEqual(m[i].ar, m[i - 1].ar);
  assert.strictEqual(together.mix(g, ['A', 'B'], {size: 15}).length, 15);   /* A hat nur 7 brauchbare Titel: B füllt auf */
  assert.deepStrictEqual(together.mix(g, ['A', 'C'], {}), []);                  /* C nur mit 2-Sterne-Album: kein Partner */
  assert.ok(together.mix(g, ['A', 'B'], {bad: {'USB/B/B1/1.flac': true}, size: 16}).every(function(x){ return x.f !== 'USB/B/B1/1.flac'; }));
});

t('Mix: Fehler im Aufruf geben leere Liste', function(){
  var g = prep({plays: hist});
  assert.deepStrictEqual(together.mix(g, ['A'], {}), []);
  assert.deepStrictEqual(together.mix(g, ['A', 'Unbekannt'], {}), []);
});

console.log(n + ' Prüfungen bestanden');
