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
console.log(n + ' checks passed');
