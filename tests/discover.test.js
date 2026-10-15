/* Entdecken-Reihen und Zufallsmix (tags/discover.js) */
var assert = require('assert');
var d = require('../tags/discover.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var DAY = 86400, NOW = 2000000000;
var seed = 1; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

/* Bibliothek: 30 Alben, je Album 4 Titel; Künstler A0..A9 */
var albumList = [], tracks = [];
for (var i = 0; i < 30; i++) {
  var ar = 'A' + (i % 10), dir = 'USB/' + ar + '/Album ' + i;
  albumList.push({dir: dir, al: 'Album ' + i, ar: ar});
  for (var k = 0; k < 4; k++) tracks.push([ar, 'Titel ' + i + '-' + k, dir + '/0' + k + '.flac', 200, 'Album ' + i]);
}
/* Verlauf: Album 0 vor zwei Jahren 8×, Album 1 gestern, Album 2 vor 400 Tagen einmal (nur Last.fm, ohne Pfad) */
var pl = [];
for (k = 0; k < 8; k++) pl.push({t: NOW - 730 * DAY + k, ar: 'A0', ti: 'Titel 0-0', al: 'Album 0', u: 'USB/A0/Album 0/00.flac'});
pl.push({t: NOW - 400 * DAY, ar: 'A2', ti: 'Titel 2-1', al: 'Album 2'});
pl.push({t: NOW - DAY, ar: 'A1', ti: 'Titel 1-0', al: 'Album 1', u: 'mnt/USB/A1/Album 1/00.flac'});
pl.sort(function(a, b){ return a.t - b.t; });
var st = d.statIndex(pl);

t('Zähler je Album: über den Ordner und ohne Pfad über Album+Künstler', function(){
  assert.deepStrictEqual(st.album(albumList[0]), {n: 8, last: NOW - 730 * DAY + 7});
  assert.strictEqual(st.album(albumList[1]).n, 1);
  assert.strictEqual(st.album(albumList[2]).last, NOW - 400 * DAY);
  assert.strictEqual(st.album(albumList[5]).n, 0);
});

t('Album-Reihen: lange nicht, nie, früher oft, Zufall', function(){
  var sh = d.shelves('album', albumList, st, NOW, rnd), by = {};
  sh.forEach(function(s){ by[s.id] = s.items; });
  assert.deepStrictEqual(sh.map(function(s){ return s.id; }), ['random', 'forgotten', 'never', 'oldfav']);
  assert.deepStrictEqual(by.forgotten.map(function(x){ return x.al; }), ['Album 0', 'Album 2']);     /* am längsten her zuerst */
  assert.strictEqual(by.never.length, 12);
  assert.ok(by.never.every(function(x){ return x.plays === 0 && !x.last && ['Album 0', 'Album 1', 'Album 2'].indexOf(x.al) < 0; }));
  assert.deepStrictEqual(by.oldfav.map(function(x){ return [x.al, x.plays]; }), [['Album 0', 8]]);
  assert.strictEqual(by.random.length, 12);
  assert.strictEqual(new Set(by.random.map(function(x){ return x.dir; })).size, 12);
});

t('Titel- und Künstler-Reihen', function(){
  var sh = d.shelves('track', tracks, st, NOW, rnd);
  assert.deepStrictEqual(sh[1].items.map(function(x){ return x.ti; }), ['Titel 0-0', 'Titel 2-1']);
  assert.deepStrictEqual(sh[3].items.map(function(x){ return x.ti; }), ['Titel 0-0']);              /* 8× gehört */
  assert.ok(sh[2].items.every(function(x){ return x.f && x.plays === 0; }));
  var arts = [];
  for (i = 0; i < 10; i++) arts.push({ar: 'A' + i, n: 3, dir: 'USB/A' + i + '/Album ' + i});
  var sa = d.shelves('artist', arts, st, NOW, rnd);
  assert.strictEqual(sa[2].items.length, 7);                                                         /* A0, A1, A2 gehört */
  assert.deepStrictEqual(sa[1].items.map(function(x){ return x.ar; }), ['A0', 'A2']);
});

t('Zufallsmix: 25 Titel, nie derselbe Künstler direkt hintereinander, keine Datei doppelt', function(){
  for (var r = 0; r < 20; r++) {
    var m = d.mix(tracks.concat(tracks.slice(0, 10)), 25, rnd);
    assert.strictEqual(m.length, 25);
    assert.strictEqual(new Set(m.map(function(x){ return x[2]; })).size, 25);
    for (var j = 1; j < m.length; j++) assert.notStrictEqual(m[j][0], m[j - 1][0]);
  }
});

t('Zufallsmix für einen Künstler: alle seine Titel, auch hintereinander', function(){
  var pool = d.mixPool(tracks, albumList, {artist: 'a3'});
  assert.strictEqual(pool.length, 12);
  assert.strictEqual(d.mix(pool, 25, rnd).length, 12);
});

t('Zufallsmix für Albumordner (Genre-Liste)', function(){
  var pool = d.mixPool(tracks, albumList, {dirs: ['USB/A1/Album 1', 'USB/A2/Album 12']});
  assert.deepStrictEqual(pool.map(function(x){ return x[4]; }).sort(), ['Album 1', 'Album 1', 'Album 1', 'Album 1', 'Album 12', 'Album 12', 'Album 12', 'Album 12']);
});
t('Zufallsmix für mehrere Künstler (ähnliche Künstler): jeder etwa gleich oft, nie zweimal hintereinander', function(){
  /* A1 bekommt viele zusätzliche Titel: trotzdem nicht häufiger */
  var big = tracks.concat([]);
  for (var j = 0; j < 40; j++) big.push(['A1', 'Extra ' + j, 'USB/A1/Extra/' + j + '.flac', 200, 'Extra']);
  var pool = d.mixPool(big, albumList, {artists: ['A1', 'a2', 'A3']});
  assert.strictEqual(pool.length, 12 + 40 + 12 + 12);
  var m = d.mixBalanced(pool, 24, albumList, rnd), per = {};
  assert.strictEqual(m.length, 24);
  m.forEach(function(x, j){ per[x[0]] = (per[x[0]] || 0) + 1; if (j) assert.notStrictEqual(x[0], m[j - 1][0]); });
  assert.deepStrictEqual(per, {A1: 8, A2: 8, A3: 8});
  var files = {};
  m.forEach(function(x){ assert.ok(!files[x[2]]); files[x[2]] = true; });
});

t('Zufallsmix für mehrere Künstler: Sampler ("Various Artists") zählen nach dem Künstler des Titels', function(){
  var sam = [], list2 = albumList.concat([{dir: 'USB/Sampler/Relax', al: 'Relax', ar: 'Various Artists'}]);
  for (var j = 0; j < 6; j++) sam.push([j % 2 ? 'A2' : 'A1', 'Hit ' + j, 'USB/Sampler/Relax/' + j + '.flac', 200, 'Relax']);
  var only = sam.concat(tracks.filter(function(x){ return x[0] === 'A1'; }).slice(0, 3));   /* A1 eigenes Album + Sampler */
  var m = d.mixBalanced(only, 6, list2, rnd), per = {};
  m.forEach(function(x, j){ per[x[0]] = (per[x[0]] || 0) + 1; if (j) assert.notStrictEqual(x[0], m[j - 1][0], 'zweimal ' + x[0]); });
  assert.deepStrictEqual(per, {A1: 3, A2: 3});
});

t('Zufallsmix für mehrere Künstler: geht einem die Musik aus, füllen die anderen auf', function(){
  var pool = d.mixPool(tracks, albumList, {artists: ['A1', 'A2']}).slice(0, 14);   /* A1 hat 12, A2 nur 2 */
  var m = d.mixBalanced(pool, 25, albumList, rnd);
  assert.strictEqual(m.length, 14);
});

t('Würfel der Reihen: Titel nach den Regeln der Reihe', function(){
  var norm = require('../tags/plays.js').norm, agoKeys = {};
  agoKeys[norm('A2') + '|' + norm('Titel 2-1')] = true;
  function names(list) { return list.map(function(x){ return x[1]; }); }
  var never = d.shelfPool('never', tracks, st, NOW);
  assert.strictEqual(never.length, tracks.length - 3);
  assert.ok(names(never).indexOf('Titel 0-0') < 0 && names(never).indexOf('Titel 1-0') < 0);
  assert.deepStrictEqual(names(d.shelfPool('forgotten', tracks, st, NOW)).sort(), ['Titel 0-0', 'Titel 2-1']);
  assert.deepStrictEqual(names(d.shelfPool('oldfav', tracks, st, NOW)), ['Titel 0-0']);
  assert.deepStrictEqual(names(d.shelfPool('ago', tracks, st, NOW, {keys: agoKeys})), ['Titel 2-1']);
  assert.deepStrictEqual(names(d.shelfPool('gems', tracks, null, NOW, {files: {'USB/A3/Album 3/01.flac': true}})), ['Titel 3-1']);
  assert.strictEqual(d.shelfPool('random', tracks, st, NOW, {}, rnd).length, 100);
});

t('Würfel der Reihen: höchstens 3 je Künstler, jede Datei einmal, kein Künstler direkt hintereinander', function(){
  var m = d.mixCapped(tracks.concat(tracks), 25, {artist: 3}, rnd), per = {}, files = {};
  assert.strictEqual(m.length, 25);
  m.forEach(function(x, i){
    per[x[0]] = (per[x[0]] || 0) + 1;
    assert.ok(!files[x[2]]); files[x[2]] = true;
    if (i) assert.notStrictEqual(x[0], m[i - 1][0]);
  });
  assert.ok(Object.keys(per).every(function(a){ return per[a] <= 3; }));
  assert.strictEqual(d.mixCapped(tracks.slice(0, 8), 25, {artist: 3}, rnd).length, 8);   /* zu wenig: über die Grenze aufgefüllt */
});

t('Würfel-Regeln: höchstens 2 je Album, kürzlich Gehörtes nur zum Auffüllen, Grenzen vor „kürzlich“ gelockert', function(){
  var m = d.mixCapped(tracks, 25, {artist: 3, album: 2}, rnd), perAl = {};
  m.forEach(function(x){ perAl[x[4]] = (perAl[x[4]] || 0) + 1; });
  assert.strictEqual(m.length, 25);
  assert.ok(Object.keys(perAl).every(function(a){ return perAl[a] <= 2; }), JSON.stringify(perAl));
  var recent = d.recentFn(st, NOW);
  assert.ok(recent(['A1', 'Titel 1-0']) && !recent(['A0', 'Titel 0-0']));
  var small = tracks.slice(4, 8);                                   /* Album 1: Titel 1-0 gestern gehört */
  var r = d.mixCapped(small, 3, {album: 2, recent: recent}, rnd).map(function(x){ return x[1]; });
  assert.strictEqual(r.length, 3);
  assert.ok(r.indexOf('Titel 1-0') < 0, r);                        /* drei frische, auch über die Albumgrenze */
  assert.strictEqual(d.mixCapped(small, 4, {album: 2, recent: recent}, rnd).length, 4);
  var bal = d.mixBalanced(tracks.slice(4, 8).concat(tracks.slice(44, 48)), 2, albumList, rnd, recent).map(function(x){ return x[1]; });
  assert.ok(bal.indexOf('Titel 1-0') < 0, bal);
});

t('Würfel im Reiter Künstler/Alben: Titel der Künstler bzw. Alben der ganzen Reihe', function(){
  var now = 400 * 86400, lib = [['Nie', 'a', 'X/Nie/1/1.flac'], ['Oft', 'b', 'X/Oft/1/1.flac'], ['Oft', 'c', 'X/Oft/2/1.flac'], ['Gast', 'd', 'X/Oft/1/2.flac']];
  var al = [{dir: 'X/Nie/1', al: '1', ar: 'Nie'}, {dir: 'X/Oft/1', al: '1', ar: 'Oft'}, {dir: 'X/Oft/2', al: '2', ar: 'Oft'}];
  var st = d.statIndex([{t: now - 10, ar: 'Oft', ti: 'b', al: '1', u: 'X/Oft/1/1.flac'}]);
  var ka = d.shelfKeys('never', 'artist', [{ar: 'Nie'}, {ar: 'Oft'}], st, now);
  assert.deepStrictEqual(Object.keys(ka), ['nie']);
  assert.deepStrictEqual(d.groupPool(lib, al, 'artist', ka).map(function(x){ return x[1]; }), ['a']);   /* nie gehörte Titel von „Oft“ nicht */
  var kb = d.shelfKeys('never', 'album', al, st, now);
  assert.deepStrictEqual(Object.keys(kb).sort(), ['X/Nie/1', 'X/Oft/2']);
  assert.deepStrictEqual(d.groupPool(lib, al, 'album', kb).map(function(x){ return x[1]; }), ['a', 'c']);
  assert.deepStrictEqual(d.groupPool(lib, al, 'artist', {oft: true}).map(function(x){ return x[1]; }), ['b', 'c', 'd']);   /* Gast auf dem Album zählt mit */
});

console.log(n + ' Prüfungen');
