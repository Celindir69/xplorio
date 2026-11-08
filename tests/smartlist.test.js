/* smart playlist editor: rule line <-> fields, web/js/smartlist.js */
var assert = require('assert');
global.T = function(k, v){ return k === 'sp.nameMore' ? v.names + ' & ' + v.n + ' more' : k; };
var s = require('../web/js/smartlist.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function st(over) { var x = s.smartEmpty(); Object.keys(over).forEach(function(k){ x[k] = over[k]; }); return x; }

t('fields to line: artists, years, genres (or), album, extras, order', function(){
  assert.strictEqual(s.smartLine(st({name: 'Rock 70s', artists: ['Genesis', 'Supertramp'], yFrom: '1970', yTo: '1979',
    genres: 'Rock; Prog', notAlbum: 'Live', recent: '30', various: true, dedup: true, sort: 'year+album+track+', limit: '50'})),
    'Rock 70s::Genesis;Supertramp|year>=1970|year<=1979|genre~Rock,genre~Prog|album!~Live|added<=30|various=true|duplicate=false|sort=year+album+track+|limit=50');
  assert.strictEqual(s.smartLine(st({name: 'New', all: true, recent: '14', orig: true, yFrom: '1980'})), 'New::*|originalyear>=1980|added<=14');
});
t('line to fields and back gives the same line', function(){
  var line = 'Rock 70s::Genesis;Supertramp|year>=1970|year<=1979|genre~Rock,genre~Prog|album!~Live|added<=30|various=true|duplicate=false|sort=year+album+track+|limit=50';
  assert.strictEqual(s.smartLine(s.smartParse(line)), line);
  var p = s.smartParse('  X :: A ; B | year >= 1970 | sort = year+ ');
  assert.deepStrictEqual([p.name, p.artists, p.yFrom, p.sort], ['X', ['A', 'B'], '1970', 'year+']);
});
t('lines the fields cannot show: only the line', function(){
  ['Genesis', 'X::Genesis|title~Love', 'X::Genesis|year>1970', 'X::Genesis|year>=1970,genre~Rock', 'X::Genesis|year>=1970|originalyear<=1980',
   'X::Genesis|sort=album-', 'X::|year>=1970', 'X::Genesis|album!~Live|album!~Demo'].forEach(function(l){
    assert.strictEqual(s.smartParse(l), null, l);
  });
  assert.ok(s.smartParse('X::Genesis|various=false|duplicate=true|sort=random'));   /* the defaults */
  assert.strictEqual(s.smartParse('X::Genesis|sort=mix').sort, 'mix');
  assert.strictEqual(s.smartLine(s.smartParse('X::Genesis|sort=mix')), 'X::Genesis|sort=mix');
});
t('name proposal from the artists; with "all artists" from genre and years', function(){
  assert.strictEqual(s.smartNameFor(st({artists: ['Genesis']})), 'Genesis');
  assert.strictEqual(s.smartNameFor(st({artists: ['A', 'B', 'C']})), 'A, B & C');
  assert.strictEqual(s.smartNameFor(st({artists: ['A', 'B', 'C', 'D', 'E']})), 'A, B & 3 more');
  assert.strictEqual(s.smartNameFor(st({all: true, genres: 'Rock; Pop', yFrom: '1970', yTo: '1979'})), 'Rock, Pop 1970–1979');
  assert.strictEqual(s.smartNameFor(st({all: true})), '');
});
console.log(n + ' tests passed');
