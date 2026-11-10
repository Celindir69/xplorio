/* Dateien: browse, make folders, copy, move, trash, delete empty folders (tags/fileops.js) */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
var fileops = require('../tags/fileops.js');
var ratings = require('../tags/ratings.js'), nomix = require('../tags/nomix.js'), plays = require('../tags/plays.js');
var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }
function mkd(d) { d.split(path.sep).reduce(function(cur, p){ cur = cur ? path.join(cur, p) : (p || path.sep); try { fs.mkdirSync(cur); } catch (e) {} return cur; }, ''); }
function mk(root, rel, text) { var f = path.join(root, rel); mkd(path.dirname(f)); fs.writeFileSync(f, text || 'x'); }
function has(root, rel) { return fs.existsSync(path.join(root, rel)); }
function read(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function setup() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'xfiles-'));
  mk(root, 'USB/S/Beatles/Help/01 Help.flac', 'help');
  mk(root, 'USB/S/Beatles/Help/02 The Night.flac', 'night!');
  mk(root, 'USB/S/Beatles/Help/.DS_Store', 'mac');
  mk(root, 'USB/S/Mix/a.mp3', 'aaa');
  mk(root, 'USB/S/Mix/b.mp3', 'bb');
  mk(root, 'USB/S/Xplorio Trash/Old/x.flac');
  mk(root, 'USB/S/.mpdignore', 'Xplorio Trash\n');
  mk(root, 'NAS/N/Music/readme.txt', 'r');
  mkd(path.join(root, 'INTERNAL'));
  fs.symlinkSync(os.tmpdir(), path.join(root, 'USB/S/out'));
  return root;
}
function run(root, items, dest, mode, cb) {
  var p = fileops.plan(root, items, dest, mode);
  if (!p.ok) return cb(p);
  fileops.run(root, p.steps, mode, {}, function(job){ job.plan = p; cb(job); });
}

[false, true].forEach(function(useCp){
  if (useCp && process.platform !== 'linux') return;
  var tag = useCp ? ' (cp)' : ' (streams)';

  t('list: drives, then folders before files, hidden files and the trash left out' + tag, function(done){
    var root = setup();
    assert.deepStrictEqual(fileops.list(root, '').drives.map(function(d){ return d.path; }), ['INTERNAL', 'USB/S', 'NAS/N']);
    var l = fileops.list(root, 'USB/S');
    assert.deepStrictEqual(l.dirs.map(function(d){ return d.name; }), ['Beatles', 'Mix']);   /* not "out": leads off the drive */
    var h = fileops.list(root, 'USB/S/Beatles/Help');
    assert.deepStrictEqual(h.files.map(function(f){ return [f.name, f.bytes, f.audio]; }), [['01 Help.flac', 4, true], ['02 The Night.flac', 6, true]]);
    ['USB/S/Xplorio Trash', 'USB/S/out', 'USB/S/../S', 'USB', 'X/S', 'USB/S/Beatles/Help/01 Help.flac'].forEach(function(p){
      assert.strictEqual(fileops.list(root, p).ok, false, p);
    });
    done();
  });

  t('copy within a drive: names that exist get (2)' + tag, function(done){
    var root = setup();
    run(root, ['USB/S/Mix/a.mp3', 'USB/S/Beatles/Help'], 'USB/S/Mix', 'copy', function(j){
      assert.deepStrictEqual(j.errors, []);
      assert.strictEqual(read(root, 'USB/S/Mix/a (2).mp3'), 'aaa');
      assert.strictEqual(read(root, 'USB/S/Mix/Help/02 The Night.flac'), 'night!');
      assert.ok(!has(root, 'USB/S/Mix/Help/.DS_Store'), 'Mac leftovers are not copied');
      assert.ok(has(root, 'USB/S/Mix/a.mp3') && has(root, 'USB/S/Beatles/Help/01 Help.flac'), 'originals stay');
      assert.strictEqual(j.files, 3); assert.strictEqual(j.filesDone, 3); assert.strictEqual(j.bytesDone, 3 + 4 + 6);
      assert.ok(!fs.readdirSync(path.join(root, 'USB/S/Mix')).some(function(f){ return /xplorio-copy/.test(f); }), 'no temporary files left');
      done();
    });
  });

  t('move within a drive is a rename; already in the folder: skipped' + tag, function(done){
    var root = setup();
    mkd(path.join(root, 'USB/S/Neu'));
    run(root, ['USB/S/Mix/a.mp3', 'USB/S/Beatles/Help', 'USB/S/Neu'], 'USB/S', 'move', function(j){
      assert.deepStrictEqual(j.plan.skipped, ['USB/S/Neu']);
      assert.deepStrictEqual(j.done.map(function(d){ return [d.from, d.to]; }), [['USB/S/Mix/a.mp3', 'USB/S/a.mp3'], ['USB/S/Beatles/Help', 'USB/S/Help']]);
      assert.ok(!has(root, 'USB/S/Mix/a.mp3') && has(root, 'USB/S/a.mp3') && has(root, 'USB/S/Help/.DS_Store'));
      assert.ok(!has(root, 'USB/S/Xplorio Trash/Mix'), 'nothing goes into the trash');
      done();
    });
  });

  t('move to another drive: copy, then the original into the trash of its drive' + tag, function(done){
    var root = setup();
    run(root, ['USB/S/Beatles/Help', 'USB/S/Mix/b.mp3'], 'NAS/N/Music', 'move', function(j){
      assert.deepStrictEqual(j.errors, []);
      assert.strictEqual(read(root, 'NAS/N/Music/Help/01 Help.flac'), 'help');
      assert.strictEqual(read(root, 'NAS/N/Music/b.mp3'), 'bb');
      assert.ok(!has(root, 'USB/S/Beatles/Help'));
      assert.strictEqual(read(root, 'USB/S/Xplorio Trash/Beatles/Help/02 The Night.flac'), 'night!');
      assert.strictEqual(read(root, 'USB/S/Xplorio Trash/Mix/b.mp3'), 'bb');
      assert.deepStrictEqual(j.done.map(function(d){ return d.trashed; }), ['USB/S/Xplorio Trash/Beatles/Help', 'USB/S/Xplorio Trash/Mix/b.mp3']);
      done();
    });
  });

  t('a failed copy leaves the original and no half copy' + tag, function(done){
    var root = setup();
    var p = fileops.plan(root, ['USB/S/Beatles/Help'], 'NAS/N/Music', 'move');
    var gone = path.join(root, 'USB/S/Beatles/Help/02 The Night.flac'), saved = read(root, 'USB/S/Beatles/Help/02 The Night.flac');
    /* the second file disappears while the first is being copied (a drive that drops out) */
    function hook(j) { if (j.filesDone === 1 && fs.existsSync(gone)) fs.unlinkSync(gone); }
    fileops.run(root, p.steps, 'move', {progress: hook}, function(j){
      fs.writeFileSync(gone, saved);
      assert.strictEqual(j.done.length, 0);
      assert.strictEqual(j.errors.length, 1);
      assert.ok(!has(root, 'NAS/N/Music/Help'), 'half copy removed');
      assert.ok(has(root, 'USB/S/Beatles/Help/01 Help.flac'), 'original stays');
      assert.ok(!has(root, 'USB/S/Xplorio Trash/Beatles'));
      done();
    });
  });

  t('cancel: stops between files' + tag, function(done){
    var root = setup();
    var p = fileops.plan(root, ['USB/S/Beatles/Help', 'USB/S/Mix'], 'NAS/N/Music', 'copy'), k = 0;
    fileops.run(root, p.steps, 'copy', {progress: function(){ k++; }, cancelled: function(){ return k >= 3; }}, function(j){
      assert.ok(j.cancelled);
      assert.ok(has(root, 'USB/S/Mix/a.mp3'));
      done();
    });
  });
});

t('plan: not into itself, not outside the drives, not from or into the trash', function(done){
  var root = setup();
  assert.strictEqual(fileops.plan(root, ['USB/S/Beatles'], 'USB/S/Beatles/Help', 'move').error, 'into itself: USB/S/Beatles');
  assert.strictEqual(fileops.plan(root, ['USB/S/Beatles'], 'USB/S/Beatles', 'copy').error, 'into itself: USB/S/Beatles');
  [['USB/S'], ['USB/S/Xplorio Trash/Old'], ['USB/S/../S/Mix'], ['USB/S/out'], ['NAS/N/nothing']].forEach(function(items){
    assert.strictEqual(fileops.plan(root, items, 'NAS/N/Music', 'copy').ok, false, items[0]);
  });
  ['USB/S/Xplorio Trash', 'USB/S/out', 'USB', '/tmp', 'USB/S/Mix/a.mp3'].forEach(function(d){
    assert.strictEqual(fileops.plan(root, ['USB/S/Mix'], d, 'copy').ok, false, d);
  });
  assert.strictEqual(fileops.plan(root, ['USB/S/Mix/a.mp3'], 'USB/S/Mix', 'move').error, 'nothing to do');
  /* an item inside another one of the list goes along with it */
  assert.deepStrictEqual(fileops.plan(root, ['USB/S/Beatles', 'USB/S/Beatles/Help/01 Help.flac'], 'INTERNAL', 'copy').steps.map(function(s){ return s.from; }), ['USB/S/Beatles']);
  /* two items with the same name: both get a free name */
  mk(root, 'NAS/N/Music/a.mp3', 'other');
  mk(root, 'USB/S/Beatles/a.mp3', 'x');
  assert.deepStrictEqual(fileops.plan(root, ['USB/S/Mix/a.mp3', 'USB/S/Beatles/a.mp3'], 'NAS/N/Music', 'copy').steps.map(function(s){ return s.to; }),
    ['NAS/N/Music/a (2).mp3', 'NAS/N/Music/a (3).mp3']);
  assert.strictEqual(fileops.plan(root, ['USB/S/Mix'], 'NAS/N/Music', 'copy').steps[0].cross, true);
  done();
});

t('mkdir, rmdir (only empty, Mac leftovers do not count), trash', function(done){
  var root = setup();
  assert.deepStrictEqual(fileops.mkdir(root, 'USB/S', 'Neu'), {ok: true, path: 'USB/S/Neu'});
  assert.strictEqual(fileops.mkdir(root, 'USB/S', 'Neu').error, 'exists');
  ['', '.x', 'a/b', '..', 'Xplorio Trash', ' a'].forEach(function(name){ assert.strictEqual(fileops.mkdir(root, 'USB/S', name).error, 'bad name', name); });
  assert.strictEqual(fileops.mkdir(root, 'USB/S/out', 'x').ok, false);
  mk(root, 'USB/S/Neu/.DS_Store'); mk(root, 'USB/S/Neu/._x');
  assert.ok(fileops.rmdir(root, 'USB/S/Neu').ok);
  assert.ok(!has(root, 'USB/S/Neu'));
  assert.strictEqual(fileops.rmdir(root, 'USB/S/Mix').error, 'not empty');
  assert.strictEqual(fileops.rmdir(root, 'USB/S').ok, false, 'never the drive');
  mk(root, 'USB/S/Xplorio Trash/Mix/a.mp3', 'older');
  var r = fileops.toTrash(root, ['USB/S/Mix/a.mp3', 'USB/S/Beatles']);
  assert.deepStrictEqual(r.moved.map(function(m){ return [m.from, m.to, m.dir]; }),
    [['USB/S/Mix/a.mp3', 'USB/S/Xplorio Trash/Mix/a (2).mp3', false], ['USB/S/Beatles', 'USB/S/Xplorio Trash/Beatles', true]]);
  assert.strictEqual(read(root, 'USB/S/Xplorio Trash/Mix/a.mp3'), 'older');
  assert.strictEqual(fileops.toTrash(root, ['USB/S/Xplorio Trash/Old']).ok, false);
  done();
});

t('moved paths: keys, keys of parts, Volumio URIs; scan paths', function(done){
  var mv = [{from: 'USB/S/Beatles/Help', to: 'NAS/N/Help'}, {from: 'USB/S/Mix/a.mp3', to: 'USB/S/a.mp3'}];
  assert.strictEqual(fileops.moveKey('USB/S/Beatles/Help/01.flac', mv), 'NAS/N/Help/01.flac');
  assert.strictEqual(fileops.moveKey('USB/S/Beatles/Help', mv), 'NAS/N/Help');
  assert.strictEqual(fileops.moveKey('USB/S/Beatles/Help 2', mv), null);
  assert.strictEqual(fileops.movePartsKey('dupt|USB/S/Beatles/Help|x', mv), 'dupt|NAS/N/Help|x');
  assert.strictEqual(fileops.movePartsKey('mnt/USB/S/Mix/a.mp3', mv), 'mnt/USB/S/a.mp3');
  assert.strictEqual(fileops.movePartsKey('music-library/USB/S/Beatles/Help/1.flac', mv), 'music-library/NAS/N/Help/1.flac');
  assert.strictEqual(fileops.movePartsKey('tidal://x', mv), null);
  var o = {'USB/S/Beatles/Help': 1, 'NAS/N/Help': 2, 'USB/S/Mix/a.mp3': 3, 'other': 4};
  assert.strictEqual(fileops.moveObjectKeys(o, mv), 2);
  assert.deepStrictEqual(o, {'NAS/N/Help': 2, 'USB/S/a.mp3': 3, other: 4}, 'an existing key stays');
  assert.deepStrictEqual(fileops.scanPaths([{path: 'NAS/N/a.mp3'}, {path: 'NAS/N/Music/b.mp3'}, {path: 'NAS/N/Music/c.mp3'}, {path: 'USB/S/X', dir: true}, {path: 'USB/S/X/Y', dir: true}, {path: 'INTERNAL/z.flac'}]),
    ['NAS/N/a.mp3', 'NAS/N/Music', 'USB/S/X', 'INTERNAL/z.flac']);
  done();
});

t('ratings, NoMix and history follow a move', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfiles-data-'));
  var mv = [{from: 'USB/S/Beatles/Help', to: 'NAS/N/Help'}];
  function rename(obj) { return fileops.moveObjectKeys(obj, mv); }
  var rs = new ratings.Store(path.join(dir, 'ratings.json'));
  rs.set({kind: 'album', v: 5, uri: 'USB/S/Beatles/Help/01.flac'});
  rs.set({kind: 'track', v: -1, uri: 'music-library/USB/S/Beatles/Help/02.flac'});
  assert.strictEqual(rs.relocate(rename), 2);
  var again = new ratings.Store(path.join(dir, 'ratings.json'));
  assert.deepStrictEqual(again.get({album: 'NAS/N/Help/01.flac', tracks: ['NAS/N/Help/02.flac']}), {album: 5, tracks: [-1]});
  var nm = new nomix.Store(path.join(dir, 'nomix.json'));
  nm.noteComment('USB/S/Beatles/Help/01.flac', 'NoMix');
  assert.strictEqual(nm.relocate(rename), 1);
  assert.deepStrictEqual(Object.keys(new nomix.Store(path.join(dir, 'nomix.json')).load().files), ['NAS/N/Help/01.flac']);
  var f = path.join(dir, 'plays.jsonl');
  fs.writeFileSync(f, '{"t":1,"ar":"A","ti":"x","u":"mnt/USB/S/Beatles/Help/01.flac"}\nbroken\n{"t":2,"ar":"A","ti":"y","u":"tidal://1"}\n');
  var ps = new plays.Store(f);
  ps.load();
  assert.strictEqual(ps.relocate(function(u){ return fileops.movePartsKey(u, mv); }), 1);
  assert.strictEqual(ps.load()[0].u, 'mnt/NAS/N/Help/01.flac');
  assert.deepStrictEqual(fs.readFileSync(f, 'utf8').split('\n').slice(1), ['broken', '{"t":2,"ar":"A","ti":"y","u":"tidal://1"}', '']);
  done();
});

(function next() {
  var q = queue.shift();
  if (!q) return console.log(n + ' tests passed');
  var name = q[0];
  if (/\(cp\)$/.test(name)) fileops.setUseCp(true); else if (/\(streams\)$/.test(name)) fileops.setUseCp(false);
  try {
    q[1](function(){ n++; console.log('ok   ' + name); next(); });
  } catch (e) { console.log('FAIL ' + name + '\n' + (e.stack || e)); process.exit(1); }
})();
