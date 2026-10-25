/* ratings (tags/ratings.js) */
var assert = require('assert');
var fs = require('fs'), os = require('os'), path = require('path');
var r = require('../tags/ratings.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratings-')), file = path.join(dir, 'ratings.json');

t('keys: file, album folder (also with CD1), streaming service, normalized artist', function(){
  assert.strictEqual(r.trackKey('music-library/USB/A/B/01.flac'), 'USB/A/B/01.flac');
  assert.strictEqual(r.trackKey('mnt/USB/A/B/01.flac'), 'USB/A/B/01.flac');
  assert.strictEqual(r.albumKey('/mnt/NAS/A/B/CD2/03.flac'), 'NAS/A/B');
  assert.strictEqual(r.albumKey('tidal://album/123'), 'uri:tidal://album/123');
  assert.strictEqual(r.artistKey('The Beatles'), r.artistKey('beatles'));
});

t('set, read, delete; file persists', function(){
  var s = new r.Store(file);
  assert.deepStrictEqual(s.get({artist: 'X', album: 'USB/X/Y/01.flac', tracks: ['USB/X/Y/01.flac']}), {artist: 0, album: 0, tracks: [0]});
  assert.strictEqual(s.set({kind: 'artist', name: 'Lumen Drift', v: 1}), 1);
  assert.strictEqual(s.set({kind: 'album', uri: 'music-library/USB/L/H/02.flac', al: 'H', ar: 'L', v: 4}), 4);
  assert.strictEqual(s.set({kind: 'track', uri: 'mnt/USB/L/H/02.flac', v: -1}), -1);
  var s2 = new r.Store(file);
  assert.deepStrictEqual(s2.get({artist: 'lumen drift', album: 'USB/L/H/07.flac', tracks: ['USB/L/H/02.flac', 'USB/L/H/03.flac']}),
                         {artist: 1, album: 4, tracks: [-1, 0]});
  s2.set({kind: 'album', uri: 'USB/L/H/01.flac', v: 0});
  assert.strictEqual(new r.Store(file).get({album: 'USB/L/H/01.flac'}).album, 0);
});

t('invalid values are rejected (thumbs up are Volumio favorites)', function(){
  var s = new r.Store(file);
  assert.strictEqual(s.set({kind: 'track', uri: 'USB/a/b.flac', v: 1}), null);
  assert.strictEqual(s.set({kind: 'album', uri: 'USB/a/b.flac', v: 6}), null);
  assert.strictEqual(s.set({kind: 'artist', name: '', v: 1}), null);
  assert.strictEqual(s.set({kind: 'x', v: 1}), null);
});

t('full: no new ratings beyond the limit, changing and deleting still work; long names are cut', function(){
  var f = file + '.voll', albums = {};
  for (var i = 0; i < r.MAX_PER_KIND; i++) albums['USB/A/' + i] = {al: 'x', ar: 'y', v: 3, t: 1};
  fs.writeFileSync(f, JSON.stringify({artists: {}, albums: albums, tracks: {}}));
  var s = new r.Store(f);
  assert.strictEqual(s.set({kind: 'album', uri: 'USB/B/C/01.flac', v: 4}), null);
  assert.strictEqual(s.set({kind: 'album', uri: 'USB/A/7/01.flac', v: 5}), 5);
  assert.strictEqual(s.set({kind: 'album', uri: 'USB/A/8/01.flac', v: 0}), 0);
  assert.strictEqual(s.set({kind: 'artist', name: 'Long ' + new Array(600).join('n'), v: 1}), 1);
  var a = s.load().artists; assert.strictEqual(a[Object.keys(a)[0]].n.length, 300);
});

console.log(n + ' checks');
