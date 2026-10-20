/* Tests the text functions of the tag editor. Run: node tests/textfn.test.js */
var assert = require('assert');
var t = require('../web/js/textfn.js');

var n = 0;
function ok(name, fn) {
  try { fn(); console.log('ok   ' + name); n++; } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}

ok('capitalize words', function(){
  assert.strictEqual(t.textWords('tears for fears'), 'Tears For Fears');
  assert.strictEqual(t.textWords('TEARS FOR FEARS'), 'Tears For Fears');
  assert.strictEqual(t.textWords("don't stop me now"), "Don't Stop Me Now");
  assert.strictEqual(t.textWords("guns n' roses"), "Guns N' Roses");
  assert.strictEqual(t.textWords('hi-fi (live) st. etienne'), 'Hi-Fi (Live) St. Etienne');
  assert.strictEqual(t.textWords('über den wolken'), 'Über Den Wolken');
});
ok('capitalize words keeps capitals inside words', function(){
  assert.strictEqual(t.textWords('AC/DC'), 'AC/DC');
  assert.strictEqual(t.textWords('ABBA'), 'ABBA');
  assert.strictEqual(t.textWords('live at the BBC'), 'Live At The BBC');
  assert.strictEqual(t.textWords('Paul McCartney'), 'Paul McCartney');
  assert.strictEqual(t.textWords('r.e.m.'), 'R.E.M.');
});
ok('Title Case', function(){
  assert.strictEqual(t.textTitle('tears for fears'), 'Tears for Fears');
  assert.strictEqual(t.textTitle('BACK IN BLACK'), 'Back in Black');
  assert.strictEqual(t.textTitle('the lord of the rings: the return of the king'), 'The Lord of the Rings: The Return of the King');
  assert.strictEqual(t.textTitle('live at the bbc (the remastered edition)'), 'Live at the Bbc (The Remastered Edition)');
  assert.strictEqual(t.textTitle("it's - in the air"), "It's - In the Air");
  assert.strictEqual(t.textTitle('what is it for'), 'What Is It For');
});
ok('lower, UPPER, spaces', function(){
  assert.strictEqual(t.textLower('Tears For Fears'), 'tears for fears');
  assert.strictEqual(t.textUpper('Ärzte'), 'ÄRZTE');
  assert.strictEqual(t.textSpaces('  Tears   For\tFears '), 'Tears For Fears');
});
ok('replace', function(){
  assert.strictEqual(t.textReplace('Tears & Fears & more', ' & ', ' and '), 'Tears and Fears and more');
  assert.strictEqual(t.textReplace('a.b.c', '.', ''), 'abc');
  assert.strictEqual(t.textReplace('abc', '', 'x'), 'abc');
  assert.strictEqual(t.textReplace('Abc', 'a', 'x'), 'Abc');
});
ok('empty values', function(){
  assert.strictEqual(t.textWords(''), '');
  assert.strictEqual(t.textTitle(undefined), '');
  assert.strictEqual(t.textFunc('title'), t.textTitle);
  assert.strictEqual(t.textFunc('nix'), null);
});
ok('split by pattern', function(){
  var p = t.textPattern('%TITLE% - %ARTIST%');
  assert.deepStrictEqual(t.textSplit('Shout - Tears for Fears', p), {tags: {title: 'Shout', artist: 'Tears for Fears'}, ambiguous: false});
  assert.strictEqual(t.textSplit('Intro', p), null);
  assert.deepStrictEqual(t.textSplit('  a  -  b ', p).ambiguous, false);
  var q = t.textPattern('%track%. %Artist% / %title% (%dummy%)');
  assert.deepStrictEqual(t.textSplit('03. A / B (live)', q).tags, {track: '03', artist: 'A', title: 'B'});
  assert.deepStrictEqual(t.textSplit('x', t.textPattern('%YEAR%')).tags, {date: 'x'});
});
ok('split: ambiguous returns both variants', function(){
  var r = t.textSplit('Relax - Remix - Frankie', t.textPattern('%TITLE% - %ARTIST%'));
  assert.strictEqual(r.ambiguous, true);
  assert.deepStrictEqual(r.tags, {title: 'Relax', artist: 'Remix - Frankie'});
  assert.deepStrictEqual(r.alt, {title: 'Relax - Remix', artist: 'Frankie'});
});
ok('split: invalid patterns', function(){
  assert.ok(t.textPattern('%TITLE%%ARTIST%').error);
  assert.ok(t.textPattern('%FOO% - %TITLE%').error);
  assert.ok(t.textPattern('no placeholder').error);
  assert.ok(t.textPattern('%DUMMY% - x').error);
  assert.ok(!t.textPattern('(%TITLE%)').error);
});
console.log(n + ' checks');
