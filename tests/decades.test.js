/* year and decades of the album list (tags/albums.js), "don't like" (tags/ratings.js) */
var assert = require('assert');
var fs = require('fs'), os = require('os'), path = require('path');
var albums = require('../tags/albums.js'), ratings = require('../tags/ratings.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

function song(file, date, ar) { return {file: file, artist: ar || 'A', albumartist: '', album: path.basename(path.dirname(file)), title: file, date: date, genre: ''}; }
var list = albums.fromSongs([
  song('USB/A/Eins/1.flac', '1994'), song('USB/A/Eins/2.flac', '1994-05-01'), song('USB/A/Eins/3.flac', '2011'),   /* remaster outlier */
  song('USB/B/Zwei/CD1/1.flac', '1989'), song('USB/B/Zwei/CD2/1.flac', '1989'),
  song('USB/C/Drei/1.flac', '05/1999', 'C'),
  song('USB/D/Vier/1.flac', ''), song('USB/E/Fuenf/1.flac', 'unbekannt')
]);

t('year per album: most common Date tag, multi-disc counted together, without year y is missing', function(){
  var by = {};
  list.forEach(function(a){ by[a.dir] = a.y; });
  assert.deepStrictEqual(by, {'USB/A/Eins': 1994, 'USB/B/Zwei': 1989, 'USB/C/Drei': 1999, 'USB/D/Vier': undefined, 'USB/E/Fuenf': undefined});
});

t('decades with album count, ascending', function(){
  assert.deepStrictEqual(albums.decadeList(list).map(function(d){ return [d.d, d.n]; }), [[1980, 1], [1990, 2]]);
});

t('albums of a decade by year', function(){
  assert.deepStrictEqual(albums.decadeAlbums(list, '1990').map(function(a){ return [a.al, a.y]; }), [['Eins', 1994], ['Drei', 1999]]);
  assert.deepStrictEqual(albums.decadeAlbums(list, 1970), []);
});

t('look up year per album (folder, else album+artist) and albums of a year', function(){
  var fn = albums.yearIndex(list);
  assert.strictEqual(fn({u: 'music-library/USB/B/Zwei/CD2/1.flac'}), 1989);
  assert.strictEqual(fn({u: 'mnt/USB/A/Eins/2.flac'}), 1994);
  assert.strictEqual(fn({al: 'drei', ar: 'C'}), 1999);
  assert.strictEqual(fn({u: 'USB/D/Vier/1.flac', al: 'Vier', ar: 'A'}), 0);
  assert.strictEqual(fn({u: 'tidal://album/1', al: 'Nix', ar: 'X'}), 0);
  assert.deepStrictEqual(albums.yearAlbums(list, '1994').map(function(a){ return a.al; }), ['Eins']);
  assert.deepStrictEqual(albums.yearAlbums(list, 2000), []);
});

t('"don\'t like" list of the ratings', function(){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dec-')), s = new ratings.Store(path.join(dir, 'r.json'));
  s.set({kind: 'track', uri: 'music-library/USB/A/Eins/2.flac', v: -1});
  s.set({kind: 'track', uri: 'USB/A/Eins/3.flac', v: -1});
  s.set({kind: 'track', uri: 'USB/A/Eins/3.flac', v: 0});
  assert.deepStrictEqual(s.disliked(), {'USB/A/Eins/2.flac': true});
});

console.log(n + ' checks');
