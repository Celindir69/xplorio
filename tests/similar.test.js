/* more like this track (tags/similar.js): similarity, seed, selection per artist, exclusions */
var assert = require('assert');
var sim = require('../tags/similar.js'), moodtags = require('../tags/moodtags.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function x(ar, ti, mood, energy, bpm, style, ge, src) {
  return {it: {ar: ar, ti: ti, al: ar + ' LP', f: 'mnt/USB/' + ar + '/' + ti + '.flac', k: moodtags.trackKey(ar, ti), ge: ge || 'Jazz', d: 200},
          r: {mood: mood, energy: energy, bpm: bpm, style: style || [], src: src || 'track'}};
}
var idx = [
  x('A', 'Start', ['melancholic', 'relaxed'], 2, 90, ['cool jazz']),
  x('A', 'Zwilling', ['melancholic', 'relaxed'], 2, 92, ['cool jazz']),
  x('B', 'Halbe Zeit', ['melancholic'], 2, 180, ['cool jazz']),
  x('C', 'Laut', ['intense'], 5, 140, ['thrash metal'], 'Metal'),
  x('D', 'Ruhig anders', ['relaxed'], 3, null, ['ambient'], 'Ambient'),
  x('E', 'Nur Künstler', ['melancholic', 'relaxed'], 2, null, ['cool jazz'], 'Jazz', 'artist'),
  x('A', 'Dritter', ['melancholic', 'relaxed'], 2, 88, ['cool jazz']),
  x('A', 'Vierter', ['melancholic', 'relaxed'], 2, 91, ['cool jazz'])
];
var seed = sim.seedOf(idx, {f: 'USB/A/Start.flac', ar: 'A', ti: 'Start'});

t('seed via the file (with or without mnt/) or artist+title; else moodOf; else null', function(){
  assert.strictEqual(seed.it.ti, 'Start');
  assert.strictEqual(sim.seedOf(idx, {f: '', ar: 'a', ti: 'start'}).it.ti, 'Start');
  var s2 = sim.seedOf(idx, {f: 'USB/X/y.flac', ar: 'X', ti: 'Y'}, function(){ return {mood: ['dark'], energy: 1, style: []}; });
  assert.deepStrictEqual(s2.r.mood, ['dark']);
  assert.strictEqual(sim.seedOf(idx, {f: 'USB/X/y.flac', ar: 'X', ti: 'Y'}, function(){ return null; }), null);
});

t('similarity: same mood/energy/tempo first, half tempo counts, no shared mood 0', function(){
  var s = seed.r;
  assert.ok(sim.score(s, idx[1].r, 'Jazz', 'Jazz') > 0.95);
  assert.ok(sim.score(s, idx[2].r, 'Jazz', 'Jazz') > 0.6);
  assert.strictEqual(sim.score(s, idx[3].r, 'Jazz', 'Metal'), 0);
  assert.ok(sim.score(s, idx[5].r, 'Jazz', 'Jazz') < sim.score(s, idx[1].r, 'Jazz', 'Jazz'));
  assert.strictEqual(sim.bpmGap(90, 180), 0);
});

t('selection: without the track itself, at most 2 per artist, without skip, dissimilar dropped', function(){
  var names = sim.pick(idx, seed, {n: 25}).map(function(y){ return y.it.ti; });
  assert.ok(names.indexOf('Start') < 0 && names.indexOf('Laut') < 0, names);
  assert.strictEqual(names.filter(function(ti){ return ['Zwilling', 'Dritter', 'Vierter'].indexOf(ti) >= 0; }).length, 2, names);
  assert.ok(names.indexOf('Halbe Zeit') >= 0 && names.indexOf('Nur Künstler') >= 0, names);
  var skipped = sim.pick(idx, seed, {n: 25, skip: function(it){ return it.ar === 'B'; }}).map(function(y){ return y.it.ti; });
  assert.ok(skipped.indexOf('Halbe Zeit') < 0);
  assert.strictEqual(sim.pick(idx, seed, {n: 1}).length, 1);
});

t('dice (shuffle) stays with similar tracks; reason: shared moods, energy, tempo', function(){
  var r = 0, rnd = function(){ r = (r * 9301 + 49297) % 233280; return r / 233280 || 0.5; };
  var names = sim.pick(idx, seed, {n: 3, shuffle: true, rnd: rnd}).map(function(y){ return y.it.ti; });
  assert.strictEqual(names.length, 3);
  assert.ok(names.indexOf('Laut') < 0 && names.indexOf('Start') < 0);
  assert.deepStrictEqual(sim.why(seed.r, idx[2].r), {mood: ['melancholic'], energy: 2, bpm: 180});
});

console.log(n + ' checks passed');
