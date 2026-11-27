/* Hiding from the library with .mpdignore (tags/mpdignore.js). Run: node tests/mpdignore.test.js */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
var ig = require('../tags/mpdignore.js');
var fileops = require('../tags/fileops.js');
var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }
function mkd(d) { d.split(path.sep).reduce(function(cur, p){ cur = cur ? path.join(cur, p) : (p || path.sep); try { fs.mkdirSync(cur); } catch (e) {} return cur; }, ''); }
function mk(root, rel, text) { var f = path.join(root, rel); mkd(path.dirname(f)); fs.writeFileSync(f, text === undefined ? 'x' : text); }
function read(root, rel) { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return null; } }
function setup() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'xignore-'));
  mk(root, 'USB/S/Beatles/Help/01 Help.flac');
  mk(root, 'USB/S/Beatles/Help/Live/01.flac');
  mk(root, 'USB/S/Beatles/Live/01.flac');
  mk(root, 'USB/S/Beatles/Anthology [1995]/01.flac');
  mk(root, 'USB/S/Hörbücher/a.mp3');
  mk(root, 'USB/S/Mix/a.wav');
  mk(root, 'USB/S/Mix/b.flac');
  mk(root, 'USB/S/.mpdignore', 'Xplorio Trash\n');
  mk(root, 'USB/S/Xplorio Trash/Old/x.flac');
  mkd(path.join(root, 'INTERNAL'));
  return root;
}

t('lineFor: pattern characters and leading # or spaces become "?"', function(){
  assert.strictEqual(ig.lineFor('Help'), 'Help');
  assert.strictEqual(ig.lineFor('Anthology [1995]'), 'Anthology ?1995?');
  assert.strictEqual(ig.lineFor('What?*'), 'What??');
  assert.strictEqual(ig.lineFor('#1 Hits'), '?1 Hits');
  assert.strictEqual(ig.lineFor(' x '), '?x?');
  assert.ok(ig.match(ig.lineFor('Anthology [1995]'), 'Anthology [1995]'));
});

t('match: like fnmatch without flags', function(){
  assert.ok(ig.match('*.wav', 'a.wav'));
  assert.ok(!ig.match('*.wav', 'a.flac'));
  assert.ok(ig.match('*', '.hidden'));
  assert.ok(ig.match('CD[12]', 'CD2'));
  assert.ok(!ig.match('CD[!12]', 'CD2'));
  assert.ok(ig.match('CD[0-9]', 'CD7'));
  assert.ok(ig.match('a\\*b', 'a*b'));
  assert.ok(!ig.match('a\\*b', 'axb'));
  assert.ok(ig.match('H?lp', 'Help'));
  assert.ok(!ig.match('Help', 'help'), 'case counts');
  assert.ok(ig.match('[x', '[x'), 'no closing bracket: a plain [');
});

t('patterns: trimmed, blank lines and comments left out', function(){
  assert.deepStrictEqual(ig.patterns('  a  \r\n\n# note\nb\n'), ['a', 'b']);
});

t('hide: the exact name into the folder\'s .mpdignore, listing marks it, MPD reads the folder', function(){
  var root = setup();
  var r = ig.hide(root, ['USB/S/Beatles/Anthology [1995]', 'USB/S/Hörbücher']);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.done.map(function(d){ return [d.path, d.dir, d.line]; }),
    [['USB/S/Beatles/Anthology [1995]', 'USB/S/Beatles', 'Anthology ?1995?'], ['USB/S/Hörbücher', 'USB/S', 'Hörbücher']]);
  assert.strictEqual(read(root, 'USB/S/Beatles/.mpdignore'), 'Anthology ?1995?\n');
  assert.strictEqual(read(root, 'USB/S/.mpdignore'), 'Xplorio Trash\nHörbücher\n', 'the trash line stays');
  assert.deepStrictEqual(ig.scanAfterHide(r.done), ['USB/S/Beatles', 'USB/S']);
  var l = ig.mark(root, fileops.list(root, 'USB/S'));
  assert.deepStrictEqual(l.dirs.map(function(d){ return [d.name, !!d.hidden, d.hidden && d.hidden.own]; }),
    [['Beatles', false, undefined], ['Hörbücher', true, true], ['Mix', false, undefined]]);
  assert.deepStrictEqual(ig.hide(root, ['USB/S/Hörbücher']).skipped, ['USB/S/Hörbücher'], 'already hidden: no second line');
  assert.strictEqual(ig.hide(root, ['USB/S/nope']).ok, false);
  assert.strictEqual(ig.hide(root, ['USB/S/Xplorio Trash/Old']).ok, false, 'not inside the trash');
  assert.strictEqual(ig.hide(root, ['USB/S']).ok, false, 'never a whole drive');
});

t('patterns apply below their folder too (as in MPD): inside a hidden folder everything is hidden', function(){
  var root = setup();
  ig.hide(root, ['USB/S/Beatles/Live']);
  var l = ig.mark(root, fileops.list(root, 'USB/S/Beatles/Help'));
  assert.deepStrictEqual(l.dirs.map(function(d){ return [d.name, d.hidden && d.hidden.dir, d.hidden && d.hidden.own]; }), [['Live', 'USB/S/Beatles', false]],
    'Beatles/Help/Live is hidden by the line in Beatles, but cannot be shown again from here');
  assert.ok(!l.hidden);
  ig.hide(root, ['USB/S/Beatles']);
  var inner = ig.mark(root, fileops.list(root, 'USB/S/Beatles/Help'));
  assert.deepStrictEqual([inner.hidden.path, inner.hidden.dir, inner.hidden.own], ['USB/S/Beatles', 'USB/S', true]);
  assert.strictEqual(ig.hiddenBy(root, 'USB/S/Beatles/Help/01 Help.flac').path, 'USB/S/Beatles');
});

t('unhide: Xplorio\'s line goes, the file too when empty; another pattern is reported', function(){
  var root = setup();
  ig.hide(root, ['USB/S/Beatles/Anthology [1995]', 'USB/S/Beatles/Live']);
  var r = ig.unhide(root, ['USB/S/Beatles/Anthology [1995]']);
  assert.deepStrictEqual(r.done, [{path: 'USB/S/Beatles/Anthology [1995]', dir: 'USB/S/Beatles'}]);
  assert.deepStrictEqual(ig.scanAfterUnhide(r.done), ['USB/S/Beatles/Anthology [1995]']);
  assert.strictEqual(read(root, 'USB/S/Beatles/.mpdignore'), 'Live\n');
  ig.unhide(root, ['USB/S/Beatles/Live']);
  assert.strictEqual(read(root, 'USB/S/Beatles/.mpdignore'), null, 'nothing left: the file is gone');
  mk(root, 'USB/S/Mix/.mpdignore', '# mine\n*.wav\n');
  ig.hide(root, ['USB/S/Mix/b.flac']);
  assert.strictEqual(read(root, 'USB/S/Mix/.mpdignore'), '# mine\n*.wav\nb.flac\n');
  var w = ig.unhide(root, ['USB/S/Mix/a.wav', 'USB/S/Mix/b.flac']);
  assert.deepStrictEqual(w.done, [{path: 'USB/S/Mix/b.flac', dir: 'USB/S/Mix'}]);
  assert.deepStrictEqual(w.still, [{path: 'USB/S/Mix/a.wav', dir: 'USB/S/Mix', pattern: '*.wav'}]);
  assert.strictEqual(read(root, 'USB/S/Mix/.mpdignore'), '# mine\n*.wav\n', 'own lines and comments stay');
  var l = ig.mark(root, fileops.list(root, 'USB/S/Mix'));
  assert.deepStrictEqual(l.files.map(function(f){ return [f.name, f.hidden && f.hidden.pattern, f.hidden && f.hidden.own]; }), [['a.wav', '*.wav', false], ['b.flac', undefined, undefined]]);
});

t('removeLine (overview): any line but the trash\'s', function(){
  var root = setup();
  mk(root, 'USB/S/Mix/.mpdignore', '*.wav\nb.flac\n');
  assert.deepStrictEqual(ig.removeLine(root, 'USB/S/Mix', '*.wav'), {ok: true, dir: 'USB/S/Mix'});
  assert.strictEqual(read(root, 'USB/S/Mix/.mpdignore'), 'b.flac\n');
  assert.strictEqual(ig.removeLine(root, 'USB/S', 'Xplorio Trash').ok, false);
  assert.strictEqual(ig.removeLine(root, 'USB/S/Mix', 'nope').ok, false);
  assert.strictEqual(ig.removeLine(root, '../x', 'a').ok, false);
  assert.strictEqual(read(root, 'USB/S/.mpdignore'), 'Xplorio Trash\n');
});

t('findAll: every .mpdignore below the drives, not in hidden folders or the trash', function(done){
  var root = setup();
  ig.hide(root, ['USB/S/Beatles/Live']);
  mk(root, 'USB/S/.hidden/.mpdignore', 'x\n');
  mk(root, 'USB/S/Xplorio Trash/Old/.mpdignore', 'y\n');
  mk(root, 'USB/S/Mix/.mpdignore', '# only a comment\n');
  mk(root, 'INTERNAL/A/.mpdignore', '*.cue\n');
  ig.findAll(root, function(r){
    assert.ok(r.ok && !r.partial);
    assert.deepStrictEqual(r.files, [
      {dir: 'INTERNAL/A', lines: [{pattern: '*.cue', trash: false}]},
      {dir: 'USB/S', lines: [{pattern: 'Xplorio Trash', trash: true}]},
      {dir: 'USB/S/Beatles', lines: [{pattern: 'Live', trash: false}]}]);
    done();
  });
});

(function next() {
  var q = queue.shift();
  if (!q) return console.log(n + ' tests passed');
  var name = q[0];
  try {
    if (q[1].length) q[1](function(){ n++; console.log('ok   ' + name); next(); });
    else { q[1](); n++; console.log('ok   ' + name); next(); }
  } catch (e) { console.log('FAIL ' + name + '\n' + (e.stack || e)); process.exit(1); }
})();
