/* Mood Mix: criteria, hit count, relaxing, history weight and order */
var assert = require('assert');
var mm = require('../tags/moodmix.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

/* library: artists A–F, 6 tracks each; mood, energy and style fixed */
var DATA = {
  A: {mood: ['relaxed'], energy: 2, style: ['ambient']},
  B: {mood: ['relaxed', 'dreamy'], energy: 2, style: ['trip-hop', 'electronic']},
  C: {mood: ['dreamy'], energy: 3, style: ['electronic']},
  D: {mood: ['happy'], energy: 4, style: ['pop']},
  E: {mood: ['relaxed'], energy: null, style: ['jazz']},
  F: {mood: ['dark'], energy: 5, style: ['metal'], src: 'artist'}
};
var lib = [];
Object.keys(DATA).forEach(function(a){ for (var i = 1; i <= 6; i++) lib.push({ar: a, ti: a + ' Titel ' + i, k: a.toLowerCase() + '|' + a.toLowerCase() + 'titel' + i, f: 'USB/' + a + '/' + i + '.flac', d: 200, al: 'Album ' + a, ge: a === 'A' || a === 'B' ? 'Electronic' : a === 'E' ? 'Jazz' : ''}); });
var coll = {libAt: 1, fetched: 1, loadLib: function(){ return lib; }, moodOf: function(ar){
  var d = DATA[ar]; return {mood: d.mood, energy: d.energy, style: d.style, src: d.src || 'track'};
}};
var seed = 3;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

t('parse criteria: limits and defaults', function(){
  var c = mm.parse({moods: 'Relaxed, dreamy', emin: '4', emax: '2', n: '999', disc: '7', match: 'x'});
  assert.deepStrictEqual(c, {maxd: 0, moods: ['relaxed', 'dreamy'], styles: [], genres: [], match: 'any', emin: 2, emax: 4, bmin: 0, bmax: 0, ymin: 0, ymax: 0, n: 200, disc: 0.5});
  assert.deepStrictEqual(mm.parse({}), {maxd: 0, moods: [], styles: [], genres: [], match: 'any', emin: 1, emax: 5, bmin: 0, bmax: 0, ymin: 0, ymax: 0, n: 50, disc: 0.5});
});

t('hit count and styles among the hits', function(){
  var r = mm.count(coll, mm.parse({moods: 'relaxed', emin: 2, emax: 3}));
  assert.strictEqual(r.count, 12);                        /* A and B; E without energy does not count when energy is restricted */
  assert.strictEqual(r.rated, 36);
  assert.deepStrictEqual(r.styles.map(function(s){ return s[0]; }), ['ambient', 'electronic', 'trip-hop']);
  assert.strictEqual(mm.count(coll, mm.parse({moods: 'relaxed', emin: 2, emax: 3, styles: 'electronic'})).count, 6);
  assert.strictEqual(mm.count(coll, mm.parse({moods: 'relaxed', emin: 2, emax: 3, styles: 'electronic,ambient', match: 'all'})).count, 0);
  assert.strictEqual(mm.count(coll, mm.parse({moods: 'relaxed'})).count, 18);   /* full energy range: E counts */
});

t('genre: chips among the hits, filter strict (also when relaxing)', function(){
  var r = mm.count(coll, mm.parse({moods: 'relaxed'}));
  assert.deepStrictEqual(r.genres, [['Electronic', 12], ['Jazz', 6]]);
  var g = mm.count(coll, mm.parse({moods: 'relaxed', genres: 'jazz'}));
  assert.strictEqual(g.count, 6);
  assert.deepStrictEqual(g.styles, [['jazz', 6]]);                       /* style chips only in the chosen genre */
  assert.deepStrictEqual(g.genres, r.genres);                            /* genre chips without genre filter */
  var m = mm.build(coll, {}, mm.parse({moods: 'relaxed', genres: 'Jazz', n: 30}), rnd);
  assert.ok(m.tracks.length === 6 && m.tracks.every(function(x){ return x.ge === 'Jazz'; }));
  assert.strictEqual(mm.build(coll, {}, mm.parse({moods: 'happy', genres: 'jazz'}), rnd).tracks.length, 0);
});

t('maximum length: long tracks (DJ mixes) are dropped, tracks without length stay', function(){
  lib.forEach(function(it){ if (it.ar === 'E') it.d = it.ti.slice(-1) === '1' ? 0 : 2400; });   /* E: 5 × 40 min, 1 × unknown */
  assert.strictEqual(mm.parse({maxd: '20'}).maxd, 20);
  assert.strictEqual(mm.parse({maxd: '-3'}).maxd, 0);
  var r = mm.count(coll, mm.parse({moods: 'relaxed', maxd: 20}));
  assert.strictEqual(r.count, 13);
  assert.deepStrictEqual(r.genres, [['Electronic', 12], ['Jazz', 1]]);
  assert.strictEqual(mm.count(coll, mm.parse({moods: 'relaxed'})).count, 18);
  var m = mm.build(coll, {}, mm.parse({moods: 'relaxed', genres: 'jazz', maxd: 20, n: 30}), rnd);
  assert.strictEqual(m.tracks.length, 1);
  lib.forEach(function(it){ it.d = 200; });
});

t('mix: only matching tracks, requested length, never the same artist twice in a row', function(){
  var m = mm.build(coll, {}, mm.parse({moods: 'relaxed,dreamy', emin: 2, emax: 3, n: 10}), rnd);
  assert.strictEqual(m.level, 0);
  assert.strictEqual(m.tracks.length, 10);
  m.tracks.forEach(function(x, i){
    assert.ok(['A', 'B', 'C'].indexOf(x.ar) >= 0);
    if (i) assert.notStrictEqual(x.ar, m.tracks[i - 1].ar);
  });
  assert.ok(m.tracks[0].f && m.tracks[0].d === 200 && m.tracks[0].al);
});

t('at most a few tracks per artist', function(){
  var m = mm.build(coll, {}, mm.parse({n: 12}), rnd);
  var per = {};
  m.tracks.forEach(function(x){ per[x.ar] = (per[x.ar] || 0) + 1; });
  Object.keys(per).forEach(function(a){ assert.ok(per[a] <= 2, a + ' ' + per[a]); });
});

t('too few hits: criteria are relaxed', function(){
  var m = mm.build(coll, {}, mm.parse({moods: 'relaxed', emin: 2, emax: 2, styles: 'ambient', n: 8}), rnd);
  assert.strictEqual(m.level, 2);                         /* level 1 (E without energy) is not enough yet, level 2 drops the styles */
  assert.ok(m.tracks.some(function(x){ return x.ar === 'E'; }));
  var none = mm.build(coll, {}, mm.parse({moods: 'romantic', n: 5}), rnd);
  assert.strictEqual(none.tracks.length, 0);
});

t('enough exact hits (20 or more): shorter mix instead of relaxing', function(){
  var m = mm.build(coll, {}, mm.parse({moods: 'relaxed,dreamy,happy', emin: 2, emax: 4, n: 50}), rnd);
  assert.strictEqual(m.level, 0);
  assert.strictEqual(m.tracks.length, 24);
});

t('discovery level: favorites prefer played, hidden gems unplayed', function(){
  var pc = {};
  lib.forEach(function(it){ if (it.ar === 'A') pc[it.k] = 40; });
  function share(disc) {
    var a = 0;
    for (var i = 0; i < 40; i++) {
      mm.build(coll, pc, mm.parse({moods: 'relaxed,dreamy', emin: 2, emax: 3, n: 4, disc: disc}), rnd).tracks
        .forEach(function(x){ if (x.ar === 'A') a++; });
    }
    return a / 160;
  }
  var fav = share(0), gem = share(1);
  assert.ok(fav > 0.4, 'favorites ' + fav);
  assert.ok(gem < 0.1, 'gems ' + gem);
});

t('tracks with only artist tags count less', function(){
  var c = mm.parse({});
  assert.ok(mm.fit({mood: ['dark'], energy: 5, style: [], src: 'artist'}, c, 0) < mm.fit({mood: ['dark'], energy: 5, style: [], src: 'track'}, c, 0));
});

t('"don\'t like" (skip) never gets into the mix', function(){
  var c = mm.parse({moods: 'relaxed', n: 50});
  c.skip = function(it){ return it.ar === 'A'; };
  var m = mm.build(coll, {}, c, rnd);
  assert.ok(m.tracks.length > 0);
  assert.ok(m.tracks.every(function(x){ return x.ar !== 'A'; }));
});

t('year range: album year, tracks without year are then dropped, never relaxed', function(){
  var YEARS = {A: 1979, B: 1985, C: 1992, D: 2004};                      /* E and F without year */
  function crit(q) { var c = mm.parse(q); c.yearOf = function(it){ return YEARS[it.ar] || 0; }; return c; }
  assert.deepStrictEqual([mm.parse({ymin: '1990', ymax: '1980'}).ymin, mm.parse({ymin: '1990', ymax: '1980'}).ymax], [1980, 1990]);
  assert.strictEqual(mm.parse({ymin: '42'}).ymin, 0);
  assert.strictEqual(mm.count(coll, crit({moods: 'relaxed,dreamy'})).count, 24);                   /* no limit: also without year */
  assert.strictEqual(mm.count(coll, crit({moods: 'relaxed,dreamy', ymin: 1980, ymax: 1989})).count, 6);   /* only B */
  assert.strictEqual(mm.count(coll, crit({moods: 'relaxed,dreamy', ymax: 1989})).count, 12);       /* A and B */
  assert.strictEqual(mm.count(coll, crit({moods: 'relaxed,dreamy', ymin: 1990})).count, 6);        /* C */
  var m = mm.build(coll, {}, crit({moods: 'relaxed,dreamy,happy', ymin: 2000, n: 30}), rnd);
  assert.ok(m.tracks.length === 6 && m.tracks.every(function(x){ return x.ar === 'D'; }));        /* too few, but not relaxed */
});

console.log(n + ' checks passed');
