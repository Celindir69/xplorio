/* "Did you mean …?" (tags/suggest.js): similar artist and album names when the local search finds nothing */
var assert = require('assert');
var sg = require('../tags/suggest.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var LIST = [
  {al: 'Ace of Spades', ar: 'Motörhead'}, {al: 'Overkill', ar: 'Motörhead'},
  {al: 'Abbey Road', ar: 'The Beatles'}, {al: 'Revolver', ar: 'The Beatles'},
  {al: 'Appetite for Destruction', ar: "Guns N' Roses"},
  {al: 'Master of Puppets', ar: 'Metallica'},
  {al: 'Born in the U.S.A.', ar: 'Bruce Springsteen'},
  {al: 'Bravo Hits 12', ar: 'Verschiedene'},
  {al: 'Simon & Garfunkel’s Greatest Hits', ar: 'Simon & Garfunkel'}
];
var IDX = sg.index(LIST);
function names(q) { return sg.suggest(IDX, q).map(function(x){ return x.kind + ':' + x.name; }); }

t('distance: typo, swap, early stop', function(){
  assert.strictEqual(sg.distance('metalica', 'metallica', 3), 1);
  assert.strictEqual(sg.distance('beatels', 'beatles', 3), 1);         /* swapped letters count once */
  assert.strictEqual(sg.distance('abc', 'xyzxyz', 2), 3);              /* above max: max + 1 */
});

t('accents, "The", "&", punctuation', function(){
  assert.strictEqual(names('Motorhead')[0], 'artist:Motörhead');
  assert.strictEqual(names('guns n roses')[0], "artist:Guns N' Roses");
  assert.strictEqual(names('Simon and Garfunkel')[0], 'artist:Simon & Garfunkel');
  assert.strictEqual(names('the metallica')[0], 'artist:Metallica');
});

t('typos in artist and album names', function(){
  assert.strictEqual(names('Metalica')[0], 'artist:Metallica');
  assert.strictEqual(names('Beatels')[0], 'artist:The Beatles');
  assert.strictEqual(names('Abey Raod')[0], 'album:Abbey Road');
  assert.strictEqual(names('Springstein')[0], 'artist:Bruce Springsteen');   /* one word of the name */
  assert.strictEqual(names('master of pupets')[0], 'album:Master of Puppets');
});

t('albums carry their artist, "Verschiedene" is no artist', function(){
  var r = sg.suggest(IDX, 'Revolvr');
  assert.deepStrictEqual(r[0], {kind: 'album', name: 'Revolver', ar: 'The Beatles'});
  assert.ok(!IDX.some(function(e){ return e.kind === 'artist' && e.name === 'Verschiedene'; }));
  assert.strictEqual(sg.suggest(IDX, 'Bravo Hits 21')[0].ar, '');
});

t('nothing for short or unrelated terms, at most three', function(){
  assert.deepStrictEqual(names('ab'), []);
  assert.deepStrictEqual(names('Zappa'), []);
  assert.deepStrictEqual(names('Xylophon'), []);
  var many = sg.index([{al: 'Live 1', ar: 'Band'}, {al: 'Live 2', ar: 'Band'}, {al: 'Live 3', ar: 'Band'}, {al: 'Live 4', ar: 'Band'}]);
  assert.strictEqual(sg.suggest(many, 'Livex').length, 3);
});

t('artist with more albums first on equal distance', function(){
  var idx = sg.index([{al: 'X', ar: 'Kraan'}, {al: 'A', ar: 'Kraam'}, {al: 'B', ar: 'Kraam'}]);
  assert.strictEqual(sg.suggest(idx, 'Kraax')[0].name, 'Kraam');
});

t('fast enough for a large collection', function(){
  var big = [];
  for (var i = 0; i < 8000; i++) big.push({al: 'Album number ' + i + ' of the collection', ar: 'Artist name ' + (i % 3000)});
  var idx = sg.index(big), t0 = Date.now();
  sg.suggest(idx, 'Artst nme 1234');
  var ms = Date.now() - t0;
  console.log('     8000 albums: ' + ms + ' ms');
  assert.ok(ms < 1000);
});

console.log(n + ' tests passed');
