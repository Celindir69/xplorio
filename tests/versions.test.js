/* album versions (tags/versions.js): grouping from the duplicate check, lookup by folder or name, answer for the album page */
var assert = require('assert');
var ver = require('../tags/versions.js'), dup = require('../tags/duplicates.js'), lc = require('../tags/libcheck.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function S(file, o) { var s = {file: file, artist: '', albumartist: '', album: '', disc: '', format: '', time: '200'}; for (var k in o) s[k] = o[k]; return s; }

var songs = [
  S('INTERNAL/mp3/Gaye/Whats Going On/01.mp3', {artist: 'Marvin Gaye', album: "What's Going On", format: '44100:24:2'}),
  S('USB/S/Gaye/WGO Deluxe/CD1/01.flac', {albumartist: 'Marvin Gaye', artist: 'Marvin Gaye', album: "What's Going On (Deluxe Edition)", disc: '1', format: '96000:24:2'}),
  S('USB/S/Gaye/WGO Deluxe/CD2/01.flac', {albumartist: 'Marvin Gaye', artist: 'Marvin Gaye', album: "What's Going On (Deluxe Edition)", disc: '2', format: '96000:24:2'}),
  S('USB/S/Gaye/WGO m4a/01.m4a', {artist: 'Marvin Gaye', album: "What's Going On", format: '44100:f:2'}),
  S('USB/S/Gaye/Lets Get It On/01.flac', {artist: 'Marvin Gaye', album: "Let's Get It On", format: '44100:16:2'})
];

t('build: one group, best first, album folder of disc folders, details for the quality badge', function(){
  var g = ver.build(songs, lc.artistKey);
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(g[0].v.map(function(v){ return [v.dir, v.al, v.ext, v.bits, v.rate, v.codec, v.tracks]; }), [
    ['USB/S/Gaye/WGO Deluxe', "What's Going On (Deluxe Edition)", 'flac', 24, 96000, '', 2],
    ['INTERNAL/mp3/Gaye/Whats Going On', "What's Going On", 'mp3', 0, 44100, '', 1],
    ['USB/S/Gaye/WGO m4a', "What's Going On", 'm4a', 0, 44100, 'aac', 1]
  ]);
});

t('lookup: album folder, disc folder, Volumio address, name and artist; single album -> null', function(){
  var find = ver.index(ver.build(songs, lc.artistKey), lc.artistKey);
  assert.ok(find('USB/S/Gaye/WGO Deluxe'));
  assert.ok(find('USB/S/Gaye/WGO Deluxe/CD2'));
  assert.ok(find('music-library/INTERNAL/mp3/Gaye/Whats Going On'));
  assert.ok(find('albums://Marvin Gaye/x', "What's Going On (2003 Remaster)", 'Marvin Gaye'));
  assert.strictEqual(find('USB/S/Gaye/Lets Get It On', "Let's Get It On", 'Marvin Gaye'), null);
  assert.strictEqual(find('', "What's Going On", 'Nena'), null);
});

t('answer: best marked, year per folder', function(){
  var g = ver.build(songs, lc.artistKey)[0];
  var r = ver.answer(g, function(d){ return d === 'USB/S/Gaye/WGO Deluxe' ? 2011 : 0; });
  assert.deepStrictEqual(r.versions.map(function(v){ return [v.best, v.y]; }), [[true, 2011], [false, undefined], [false, undefined]]);
  assert.strictEqual(r.artist, 'Marvin Gaye');
});

t('quality: m4a with float samples is AAC, with bit depth ALAC', function(){
  assert.strictEqual(dup.quality([{file: 'a.m4a', format: '44100:f:2'}]).codec, 'aac');
  assert.strictEqual(dup.quality([{file: 'a.m4a', format: '44100:16:2'}]).codec, 'alac');
});

t('collapse: one entry per album, the best one in the list at the place of the first, with the number of versions', function(){
  var find = ver.index(ver.build(songs, lc.artistKey), lc.artistKey);
  var list = [{dir: 'USB/S/Gaye/WGO m4a', al: "What's Going On"}, {dir: 'USB/S/Gaye/Lets Get It On', al: "Let's Get It On"},
              {dir: 'INTERNAL/mp3/Gaye/Whats Going On', al: "What's Going On"}];
  var r = ver.collapse(list, find);
  assert.deepStrictEqual(r.map(function(a){ return [a.dir, a.nv]; }), [['INTERNAL/mp3/Gaye/Whats Going On', 3], ['USB/S/Gaye/Lets Get It On', undefined]]);
  assert.strictEqual(list[2].nv, undefined);                 /* the album list itself stays unchanged */
});

t('mark: best folder, number of versions, place', function(){
  var g = ver.build(songs, lc.artistKey)[0];
  assert.deepStrictEqual(ver.mark(g, 'USB/S/Gaye/WGO Deluxe/CD2'), ['USB/S/Gaye/WGO Deluxe', 3, 0]);
  assert.deepStrictEqual(ver.mark(g, 'USB/S/Gaye/WGO m4a'), ['USB/S/Gaye/WGO Deluxe', 3, 2]);
  assert.strictEqual(ver.mark(null, 'x'), 0);
});

console.log(n + ' tests passed');
