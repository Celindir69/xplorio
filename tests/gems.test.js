/* hidden gems: taste from ratings, favorites and history; selection, exclusions and reasons */
var assert = require('assert');
var gems = require('../tags/gems.js'), discover = require('../tags/discover.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

/* library: jazz albums (melancholic) by A, B, C, D; metal (intense) by M, N; jazz without mood tags by E; 4 tracks each */
var R = {
  jazz:  {mood: ['melancholic', 'relaxed'], style: ['cool jazz'], energy: 2, src: 'track'},
  metal: {mood: ['intense', 'dark'], style: ['thrash metal'], energy: 5, src: 'track'}
};
var lib = [], moods = {}, albumList = [];
[['A', 'Jazz', 'jazz'], ['B', 'Jazz', 'jazz'], ['C', 'Jazz', 'jazz'], ['D', 'Jazz', 'jazz'], ['A', 'Jazz', 'jazz', 'A2'],
 ['M', 'Metal', 'metal'], ['N', 'Metal', 'metal'], ['E', 'Jazz', '']].forEach(function(x){
  var al = x[3] || x[0] + '1', dir = 'USB/' + x[0] + '/' + al;
  albumList.push({dir: dir, al: al, ar: x[0], ge: x[1]});
  for (var i = 1; i <= 4; i++) {
    var f = dir + '/' + i + '.flac';
    lib.push([x[0], al + ' ' + i, f, 200, al, x[1]]);
    if (x[2]) moods[f] = R[x[2]];
  }
});
var artists = ['A', 'B', 'C', 'D', 'M', 'N', 'E'].map(function(a){ return {ar: a, n: 1, dir: 'USB/' + a}; });
function prep(o) {
  return gems.prepare({lib: lib, moodOf: function(f){ return moods[f] || null; }, albums: albumList, artists: artists,
    rated: o.rated || {artists: {}, albums: {}, tracks: {}}, favs: o.favs || {}, stats: discover.statIndex(o.plays || [])});
}
function seq() { var i = 0; return function(){ i = (i * 9301 + 49297) % 233280; return i / 233280 || 0.5; }; }
function plays(ar, al, k) {
  var out = [];
  for (var j = 0; j < k; j++) for (var i = 1; i <= 4; i++) out.push({t: 1000 + j, ar: ar, ti: al + ' ' + i, al: al, u: 'USB/' + ar + '/' + al + '/' + i + '.flac'});
  return out;
}

t('no ratings and no history: no gems', function(){
  assert.deepStrictEqual(gems.pick(prep({}), 'album', 12, seq()), []);
});

t('heart for A: unheard jazz albums first, no metal; A2 as "unheard by A"', function(){
  var g = prep({rated: {artists: {a: {n: 'A', v: 1}}, albums: {}, tracks: {}}});
  var items = gems.pick(g, 'album', 12, seq()), names = items.map(function(x){ return x.al; });
  assert.ok(names.indexOf('B1') >= 0 && names.indexOf('C1') >= 0, names);
  assert.ok(names.indexOf('M1') < 0 && names.indexOf('N1') < 0, names);
  var a2 = items.filter(function(x){ return x.al === 'A2'; })[0];
  assert.deepStrictEqual(a2.why, {why: 'artist', ar: 'A'});
  var b = items.filter(function(x){ return x.al === 'B1'; })[0];
  assert.deepStrictEqual(b.why, {why: 'like', ar: 'A'});
});

t('artists tab: not the favorite artist itself, similar ones yes', function(){
  var g = prep({rated: {artists: {a: {n: 'A', v: 1}}, albums: {}, tracks: {}}});
  var names = gems.pick(g, 'artist', 12, seq()).map(function(x){ return x.ar; });
  assert.ok(names.indexOf('A') < 0 && names.indexOf('B') >= 0 && names.indexOf('M') < 0, names);
});

t('stars: 5 stars for metal pulls metal; albums with 1–2 stars and rated ones are dropped', function(){
  var g = prep({rated: {artists: {}, albums: {'USB/M/M1': {v: 5}, 'USB/B/B1': {v: 1}}, tracks: {}}});
  var names = gems.pick(g, 'album', 12, seq()).map(function(x){ return x.al; });
  assert.ok(names.indexOf('N1') >= 0, names);
  assert.ok(names.indexOf('M1') < 0 && names.indexOf('B1') < 0, names);
});

t('tracks: "don\'t like" and favorites are dropped, favorites shape the taste', function(){
  var g = prep({favs: {'USB/M/M1/1.flac': true}, rated: {artists: {}, albums: {}, tracks: {'USB/N/N1/2.flac': {v: -1}}}});
  var fs = gems.pick(g, 'track', 12, seq()).map(function(x){ return x.f; });
  assert.ok(fs.indexOf('USB/M/M1/1.flac') < 0 && fs.indexOf('USB/N/N1/2.flac') < 0, fs);
  assert.ok(fs.indexOf('USB/N/N1/1.flac') >= 0, fs);
  assert.ok(fs.every(function(f){ return /\/(M|N)\//.test(f); }), fs);
});

t('history only: often heard jazz pulls unheard jazz, not the often heard itself', function(){
  var g = prep({plays: plays('A', 'A1', 5)});
  var items = gems.pick(g, 'album', 12, seq()), names = items.map(function(x){ return x.al; });
  assert.ok(names.indexOf('A1') < 0 && names.indexOf('B1') >= 0 && names.indexOf('M1') < 0, names);
  assert.ok(items.every(function(x){ return x.why.why === 'like' || x.why.why === 'tags'; }));
});

t('album with mostly "don\'t like" is dropped', function(){
  var bad = {};
  [1, 2].forEach(function(i){ bad['USB/B/B1/' + i + '.flac'] = {v: -1}; });
  var g = prep({rated: {artists: {a: {n: 'A', v: 1}}, albums: {}, tracks: bad}});
  assert.ok(gems.pick(g, 'album', 12, seq()).every(function(x){ return x.al !== 'B1'; }));
});

t('reason: like a favorite artist, else by features (only genre known)', function(){
  var g = prep({rated: {artists: {}, albums: {'USB/M/M1': {v: 5}, 'USB/A/A1': {v: 5}}, tracks: {}}});
  var items = gems.pick(g, 'album', 12, seq());
  var it = items.filter(function(x){ return x.al === 'N1'; })[0];
  assert.ok(it && it.why.why === 'like' && it.why.ar === 'M', JSON.stringify(it));
  var e = items.filter(function(x){ return x.al === 'E1'; })[0];
  assert.ok(e, JSON.stringify(items));
  assert.deepStrictEqual(e.why, {why: 'tags', mood: '', ge: 'Jazz'});
  var v = gems.trackVec('Jazz', R.jazz);
  assert.ok(v['g:jazz'] === 1 && v['m:melancholic'] > 0 && v['e:2'] === 0.5);
});

console.log(n + ' checks passed');
