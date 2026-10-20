/* random album: album list from MPD, CD subfolders, last heard, prefers long-unheard, route /random */
var assert = require('assert'), net = require('net'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var albums = require('../tags/albums.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function S(file, o) { var s = {file: file, artist: '', albumartist: '', album: '', title: '', track: '', date: ''}; for (var k in o) s[k] = o[k]; return s; }
var D = 86400, NOW = 1800000000;

var songs = [
  S('USB/Spliff/85555/01.flac', {artist: 'Spliff', album: '85555', genre: 'NDW'}),
  S('USB/Spliff/85555/02.flac', {artist: 'Spliff', album: '85555', genre: 'NDW'}),
  S('USB/Spliff/85555/03.flac', {artist: 'Spliff', album: '85555', genre: 'Rock'}),
  S('USB/Bravo/CD1/01.flac', {artist: 'Falco', album: 'Bravo Hits'}),
  S('USB/Bravo/CD 2/01.flac', {artist: 'Nena', album: 'Bravo Hits'}),
  S('USB/Ohne/01.mp3', {artist: 'X'})
];
var list = albums.fromSongs(songs);
t('albums per folder, CD subfolders merged, Verschiedene, folder name without Album tag', function(){
  assert.deepStrictEqual(list, [
    {dir: 'USB/Bravo', al: 'Bravo Hits', ar: 'Verschiedene'},
    {dir: 'USB/Ohne', al: 'Ohne', ar: 'X'},
    {dir: 'USB/Spliff/85555', al: '85555', ar: 'Spliff', ge: 'NDW'}]);
});
t('last heard: by folder, by album+artist (Last.fm), compilations by album name', function(){
  var last = albums.lastIndex([
    {t: 100, ar: 'Spliff', ti: 'a', al: '85555', u: 'music-library/USB/Spliff/85555/01.flac'},
    {t: 300, ar: 'SPLIFF', ti: 'b', al: '85555', s: 'lastfm'},
    {t: 200, ar: 'Falco', ti: 'c', al: 'Bravo Hits', s: 'lastfm'}]);
  assert.strictEqual(last(list[2]), 300);
  assert.strictEqual(last(list[0]), 200);
  assert.strictEqual(last(list[1]), null);
});
t('genre for history entries: via folder or album+artist', function(){
  var g = albums.genreIndex(list);
  assert.strictEqual(g({u: 'music-library/USB/Spliff/85555/02.flac', al: 'x', ar: 'y'}), 'NDW');
  assert.strictEqual(g({al: '85555', ar: 'SPLIFF'}), 'NDW');
  assert.strictEqual(g({al: 'Bravo Hits', ar: 'Falco'}), '');
});
t('top genres in the review: multiple genres counted separately, case merged', function(){
  var pl = require('../tags/plays.js');
  var y = pl.year([{t: NOW, ar: 'a', ti: '1', al: 'x'}, {t: NOW + 1, ar: 'a', ti: '2', al: 'y'}, {t: NOW + 2, ar: 'a', ti: '3', al: 'z'}],
                  2027, {w: 60, s: 120}, NOW + 9, 10, function(e){ return {x: 'Rock; Pop', y: 'rock', z: ''}[e.al]; });
  assert.deepStrictEqual(y.genres_top, [{g: 'Rock', n: 2}, {g: 'Pop', n: 1}]);
});
t('genres: list with album count and search, albums of a genre by artist', function(){
  var list = [{dir: 'U/b', al: 'B', ar: 'The Zed', ge: 'Rock'}, {dir: 'U/a', al: 'A', ar: 'Abba', ge: 'Pop'},
              {dir: 'U/c', al: 'C', ar: 'Yes', ge: 'rock'}, {dir: 'U/s', al: 'S', ar: 'Verschiedene', ge: 'Rock'},
              {dir: 'U/x', al: 'X', ar: 'Nobody'}];
  assert.deepStrictEqual(albums.genreList(list).map(function(g){ return [g.g, g.n]; }), [['Rock', 3], ['Pop', 1]]);
  assert.deepStrictEqual(albums.genreList(list, 'OP').map(function(g){ return g.g; }), ['Pop']);
  assert.strictEqual(albums.genreList(list)[0].dir, 'U/b');
  assert.deepStrictEqual(albums.genreAlbums(list, 'ROCK').map(function(a){ return a.al; }), ['C', 'B', 'S']);
});
t('weight: never or over a year 4, over 3 months 2, else 1', function(){
  assert.strictEqual(albums.weight(null, NOW), 4); assert.strictEqual(albums.weight(NOW - 400 * D, NOW), 4);
  assert.strictEqual(albums.weight(NOW - 100 * D, NOW), 2); assert.strictEqual(albums.weight(NOW - D, NOW), 1);
});
t('pick prefers never heard and does not repeat the recent ones', function(){
  var many = [];
  for (var i = 0; i < 100; i++) many.push({dir: 'd' + i, al: 'A' + i, ar: 'B'});
  var last = function(a){ return a.dir === 'd0' ? null : NOW - D; };   /* only d0 never heard */
  var count = 0, seed = 1;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  for (i = 0; i < 400; i++) if (albums.pick(many, last, NOW, null, rnd).dir === 'd0') count++;
  assert.ok(count > 6, 'd0 more often than 1 % (' + count + ')');
  var picks = [];
  var seen = {};
  for (i = 0; i < 3; i++) { var p = albums.pick(list, function(){ return null; }, NOW, picks); assert.ok(!seen[p.dir]); seen[p.dir] = true; }
});

t('random artist: each album artist once, no compilations, prefers long unheard', function(){
  var al = [{dir: 'a', al: 'X', ar: 'Spliff'}, {dir: 'b', al: 'Y', ar: 'spliff'}, {dir: 'c', al: 'Z', ar: 'Verschiedene'}, {dir: 'd', al: 'W', ar: 'Nena'}];
  var ar = albums.artists(al);
  assert.deepStrictEqual(ar, [{ar: 'Spliff', n: 2, dir: 'a'}, {ar: 'Nena', n: 1, dir: 'd'}]);
  var last = albums.lastArtistIndex([{t: NOW - D, ar: 'SPLIFF', ti: 'x'}]);
  assert.strictEqual(last(ar[0]), NOW - D); assert.strictEqual(last(ar[1]), null);
  var count = 0, seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  for (var i = 0; i < 400; i++) if (albums.pickArtist(ar, last, NOW, null, rnd).ar === 'Nena') count++;
  assert.ok(count > 250, 'never heard comes up more often: ' + count);
  var picks = [], a = albums.pickArtist(ar, last, NOW, picks), b = albums.pickArtist(ar, last, NOW, picks);
  assert.notStrictEqual(a.ar, b.ar, 'not twice in a row');
});
t('random track from the track list, with last heard', function(){
  var tl = [['Nena', '99 Luftballons', 'USB/N/01.flac', 230, 'Nena'], ['Falco', 'Jeanny', 'USB/F/02.flac', 0]];
  var last = albums.lastTrackIndex([{t: NOW - D, ar: 'Nena', ti: '99 luftballons'}]);
  var picks = [], a = albums.pickTrack(tl, last, NOW, picks), b = albums.pickTrack(tl, last, NOW, picks);
  var nena = a.ar === 'Nena' ? a : b, falco = a.ar === 'Nena' ? b : a;
  assert.deepStrictEqual(nena, {ar: 'Nena', ti: '99 Luftballons', f: 'USB/N/01.flac', d: 230, al: 'Nena', last: NOW - D});
  assert.deepStrictEqual(falco, {ar: 'Falco', ti: 'Jeanny', f: 'USB/F/02.flac', d: 0, al: '', last: null});
});

/* fake MPD for the route */
var tree = {'': 'directory: USB\n', 'USB': 'directory: USB/A\n', 'USB/A': 'file: USB/A/1.flac\nArtist: Spliff\nAlbum: 85555\nTitle: Carbonara\nTime: 260\n'};
var walks = 0;
var mpd = net.createServer(function(c){
  c.write('OK MPD 0.19.0\n');
  var b = '';
  c.on('data', function(d){
    b += d;
    var i;
    while ((i = b.indexOf('\n')) >= 0) {
      var l = b.slice(0, i); b = b.slice(i + 1);
      if (l === 'stats') { c.write('songs: 1\ndb_update: 42\nOK\n'); continue; }
      var m = /^lsinfo "(.*)"$/.exec(l);
      if (!m) continue;
      if (m[1] === '') walks++;
      c.write((tree[m[1]] || '') + 'OK\n');
    }
  });
});
mpd.listen(0, function(){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alb-'));
  process.env.TAGS_LOG = path.join(dir, 'changes.jsonl');
  process.env.APP_CONFIG_DIR = dir;
  process.env.MPD_PORT = String(mpd.address().port);
  var svc = require('../tags/tag-service.js').server;
  svc.listen(0, function(){
    function get(cb, q) {
      http.get({port: svc.address().port, path: '/random' + (q || '')}, function(res){
        var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
      });
    }
    get(function(r1){
      t('first time: list is still being built', function(){ assert.strictEqual(r1.ok, false); assert.strictEqual(r1.building, true); });
      setTimeout(function(){
        get(function(r2){
          t('then an album, saved in albums.json', function(){
            assert.strictEqual(r2.ok, true);
            assert.deepStrictEqual(r2.album, {dir: 'USB/A', al: '85555', ar: 'Spliff', last: null});
            assert.ok(fs.existsSync(path.join(dir, 'albums.json')));
            assert.strictEqual(walks, 1);
          });
          get(function(r3){
            t('random artist via ?kind=artist', function(){
              assert.deepStrictEqual(r3, {ok: true, artist: {ar: 'Spliff', n: 1, dir: 'USB/A', last: null}});
            });
            get(function(r4){
              t('random track via ?kind=track', function(){
                assert.deepStrictEqual(r4, {ok: true, track: {ar: 'Spliff', ti: 'Carbonara', f: 'USB/A/1.flac', d: 260, al: '85555', last: null}});
              });
              console.log(n + ' checks');
              svc.close(); mpd.close();
            }, '?kind=track');
          }, '?kind=artist');
        });
      }, 300);
    });
  });
});
