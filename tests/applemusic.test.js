/* Tests the matching of tags/applemusic.js. Run: node tests/applemusic.test.js */
var assert = require('assert'), am = require('../tags/applemusic.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var res = [
  {kind: 'song', trackId: 1, artistName: 'Miles Davis', trackName: 'So What (Live)', collectionName: 'Live 1960'},
  {kind: 'song', trackId: 2, artistName: 'Miles Davis', trackName: 'So What', collectionName: 'Kind of Blue (Legacy Edition)'},
  {kind: 'song', trackId: 3, artistName: 'Miles Davis', trackName: 'So What', collectionName: 'Kind of Blue'},
  {kind: 'song', trackId: 4, artistName: 'Someone Else', trackName: 'So What', collectionName: 'Covers'},
  {kind: 'music-video', trackId: 5, artistName: 'Miles Davis', trackName: 'So What', collectionName: 'Kind of Blue'}
];

t('same album wins, edition additions do not matter', function(){
  assert.strictEqual(am.match({artist: 'Miles Davis', title: 'So What', album: 'Kind of Blue'}, res).id, 2);
});
t('other album: exact title before "(Live)"', function(){
  assert.strictEqual(am.match({artist: 'Miles Davis', title: 'So What', album: 'Unknown'}, res).id, 2);
});
t('other artist, no result, missing fields: null', function(){
  assert.strictEqual(am.match({artist: 'Coltrane', title: 'So What', album: ''}, res), null);
  assert.strictEqual(am.match({artist: 'Miles Davis', title: 'So What'}, []), null);
  assert.strictEqual(am.match({artist: '', title: 'So What'}, res), null);
});
t('Apple spelling is returned', function(){
  var m = am.match({artist: 'miles davis', title: 'so what', album: ''}, res);
  assert.strictEqual(m.artist, 'Miles Davis'); assert.strictEqual(m.title, 'So What');
});
t('track number in the title is ignored, "99 Luftballons" stays', function(){
  assert.strictEqual(am.match({artist: 'Miles Davis', title: '01 - So What', album: 'Kind of Blue'}, res).id, 2);
  ['01 - So What', '01. So What', '1 - So What', '07_So What', '3) So What'].forEach(function(x){ assert.strictEqual(am.noNum(x), 'So What', x); });
  assert.strictEqual(am.noNum('99 Luftballons'), '99 Luftballons');
  assert.strictEqual(am.noNum('1979'), '1979');
});
t('cache: hits and recent misses need no request', function(){
  var store = {}, cache = {get: function(k){ return store[k] || null; }, set: function(k, v){ store[k] = v; }};
  store[am.cacheKey({artist: 'A', title: 'B'})] = {id: 7, artist: 'A', title: 'B', album: 'C'};
  store[am.cacheKey({artist: 'X', title: 'Y'})] = {miss: true, at: 1000};
  var got = null;
  am.resolve([{artist: 'a', title: 'b'}, {artist: 'X', title: 'Y'}], function(l){ got = l; }, cache, 2000);
  assert.deepStrictEqual(got, [{id: 7, artist: 'A', title: 'B', album: 'C'}]);   /* synchronous: no lookup happened */
});
t('expand: songs as they are, albums and folders through MPD (album without album artist: by artist), radio dropped', function(){
  var asked = [], got = null;
  function mpd(cmds, cb) {
    asked.push(cmds[0]);
    if (/^find albumartist/.test(cmds[0])) return cb(null, []);
    if (/^find artist/.test(cmds[0])) return cb(null, ['file: a/2.flac', 'Artist: M', 'Title: Two', 'Album: K', 'Track: 2', 'file: a/1.flac', 'Artist: M', 'Title: One', 'Album: K', 'Track: 1']);
    cb(null, ['directory: d', 'file: d/x.flac', 'Artist: F', 'Title: X', 'Album: D']);
  }
  am.expand([{uri: 'x', type: 'song', artist: 'S', title: 'T'}, {uri: 'albums://M/K', type: 'folder'}, {uri: 'music-library/USB/d', type: 'folder'},
    {uri: 'http://radio', service: 'webradio', type: 'webradio'}], mpd, function(l){ got = l; });
  assert.deepStrictEqual(got.map(function(x){ return x.title; }), ['T', 'One', 'Two', 'X']);
  assert.deepStrictEqual(asked, ['find albumartist "M" album "K"', 'find artist "M" album "K"', 'listallinfo "USB/d"']);
});
console.log(n + ' checks passed');

/* no answer from Apple (here: nothing listens on the port): the track is not remembered as missing */
(function(){
  var cp = require('child_process');
  var code = "var am=require(" + JSON.stringify(require('path').join(__dirname, '..', 'tags', 'applemusic.js')) + ");" +
    "var store={};am.resolve([{artist:'A',title:'B'}],function(l){console.log(JSON.stringify({l:l,store:store}))}," +
    "{get:function(k){return store[k]||null},set:function(k,v){store[k]=v}});";
  var r = cp.spawnSync(process.execPath, ['-e', code], {env: Object.assign({}, process.env, {ITUNES_URL: 'http://127.0.0.1:9', ITUNES_RETRY_MS: '10', ITUNES_PAUSE_MS: '1'}), encoding: 'utf8', timeout: 20000});
  var o = JSON.parse(r.stdout);
  assert.deepStrictEqual(o, {l: [], store: {}});
  console.log('ok   no answer from Apple: not remembered as missing');
})();
