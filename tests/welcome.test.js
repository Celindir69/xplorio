/* Welcome: album of the day, new in the collection (tags/albums.js), recently played albums (tags/plays.js) */
var assert = require('assert');
var path = require('path');
var albums = require('../tags/albums.js'), plays = require('../tags/plays.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var DAY = 86400, now = Date.UTC(2026, 9, 9) / 1000;
function song(file, mod) { return {file: file, artist: 'A', albumartist: '', album: path.basename(path.dirname(file)), title: file, date: '1990', genre: '', 'last-modified': mod || ''}; }

t('modification date per album: newest file, m missing without data', function(){
  var list = albums.fromSongs([song('X/Eins/1.flac', '2026-01-02T10:00:00Z'), song('X/Eins/2.flac', '2026-03-04T10:00:00Z'), song('X/Zwei/1.flac')]);
  assert.strictEqual(list[0].m, Date.UTC(2026, 2, 4, 10) / 1000);
  assert.strictEqual(list[1].m, undefined);
});

var lib = [];
for (var i = 0; i < 50; i++) lib.push({dir: 'X/A' + i, al: 'A' + i, ar: 'K' + (i % 7), y: 1980 + i % 30, m: now - i * 10 * DAY});
lib.push({dir: 'X/Alt', al: 'Alt', ar: 'K', m: 0});

t('album of the day: same on the same day, changing on other days', function(){
  var none = function(){ return null; };
  var a = albums.dayAlbum(lib, '2026-10-09', none, now), b = albums.dayAlbum(lib, '2026-10-09', none, now);
  assert.strictEqual(a.dir, b.dir);
  assert.strictEqual(a.y, lib.filter(function(x){ return x.dir === a.dir; })[0].y);
  var days = {};
  for (var d = 1; d <= 20; d++) days[albums.dayAlbum(lib, '2026-11-' + (d < 10 ? '0' : '') + d, none, now).dir] = true;
  assert.ok(Object.keys(days).length >= 8);
  assert.strictEqual(albums.dayAlbum([], '2026-10-09', none, now), null);
});

t('album of the day: recently played less often', function(){
  var heard = function(a){ return +a.dir.slice(3) < 45 ? now - DAY : null; }, fresh = 0;
  for (var d = 0; d < 60; d++) if (+albums.dayAlbum(lib, 'T' + d, heard, now).dir.slice(3) >= 45) fresh++;
  assert.ok(fresh >= 15, fresh);                         /* 5 of 50 albums, weight 4 instead of 1: a good third */
});

t('new in the collection: newest first, only the last 180 days, at most n', function(){
  var f = albums.freshAlbums(lib, now, 8);
  assert.deepStrictEqual(f.map(function(a){ return a.al; }), ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  assert.strictEqual(albums.freshAlbums(lib, now, 100).length, 19);
  assert.deepStrictEqual(albums.freshAlbums(lib, now + 400 * DAY, 8), []);
});

t('recently played albums: newest first, once per album, a single track does not count', function(){
  var pl = [
    {t: 1, ar: 'A', ti: 'a1', al: 'Eins', u: 'USB/A/Eins/1.flac'}, {t: 2, ar: 'A', ti: 'a2', al: 'Eins', u: 'USB/A/Eins/2.flac'},
    {t: 3, ar: 'B', ti: 'b1', al: 'Zwei', u: 'USB/B/Zwei/1.flac'},
    {t: 4, ar: 'C', ti: 'c1', al: 'Drei'}, {t: 5, ar: 'C', ti: 'c2', al: 'Drei'}, {t: 6, ar: 'C', ti: 'c2', al: 'Drei'},
    {t: 7, ar: 'D', ti: 'd1', al: 'Vier', u: 'USB/V/1.flac'}, {t: 8, ar: 'E', ti: 'e1', al: 'Vier', u: 'USB/V/2.flac'},
    {t: 9, ar: 'F', ti: 'f1', al: 'Vier', u: 'USB/V/3.flac'}
  ];
  assert.deepStrictEqual(plays.recentAlbums(pl, 10), [
    {ti: 'Vier', ar: 'Verschiedene', last: 9, u: 'USB/V'}, {ti: 'Drei', ar: 'C', last: 6}, {ti: 'Eins', ar: 'A', last: 2, u: 'USB/A/Eins'}]);
  assert.strictEqual(plays.recentAlbums(pl, 1).length, 1);
});

console.log(n + ' checks');
