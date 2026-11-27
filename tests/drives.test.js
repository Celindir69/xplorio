/* Drives: USB or NAS as one drive (Mac: the place is a link to one music folder), else USB/<x>, NAS/<x> (tags/drives.js),
   and what follows from it in the Dateimanager, the trash and the library check */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
var drives = require('../tags/drives.js');
var fileops = require('../tags/fileops.js');
var duplicates = require('../tags/duplicates.js');
var trash = require('../tags/trash.js');
var mpdignore = require('../tags/mpdignore.js');
var n = 0;
function t(name, fn) {
  try { fn(); } catch (e) { console.log('FAIL ' + name + '\n' + (e.stack || e)); process.exit(1); }
  n++; console.log('ok   ' + name);
}
function mkdirs(d) { d.split(path.sep).reduce(function(cur, p){ cur = cur ? path.join(cur, p) : (p || path.sep); try { fs.mkdirSync(cur); } catch (e) {} return cur; }, ''); }
function mk(root, rel, text) { var f = path.join(root, rel); mkdirs(path.dirname(f)); fs.writeFileSync(f, text || 'x'); }
function has(root, rel) { try { fs.lstatSync(path.join(root, rel)); return true; } catch (e) { return false; } }
function tmp(name) { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name))); }

/* the Mac: music folder with INTERNAL (empty), USB -> /Volumes/MX-Media (here: a folder elsewhere) */
function macRoot() {
  var root = tmp('xdrv-'), vol = tmp('xvol-');
  mk(vol, 'Musik/Beatles/Help/01 Help.flac', 'help');
  mk(vol, 'Musik/Beatles/Help/folder.jpg', 'img');
  mk(vol, 'Hoerbuecher/Krimi/1.mp3', 'book');
  mk(vol, 'lose.flac', 'loose');
  mkdirs(path.join(root, 'INTERNAL'));
  fs.symlinkSync(vol, path.join(root, 'USB'));
  return {root: root, vol: vol};
}

t('Volumio layout: every folder in USB and NAS is a drive, as before', function(){
  var root = tmp('xdrv-');
  mk(root, 'USB/S/Beatles/1.flac'); mk(root, 'USB/T/x.flac'); mk(root, 'NAS/N/y.flac'); mkdirs(path.join(root, 'INTERNAL'));
  drives.setup(root, false);
  assert.deepStrictEqual(drives.wholeList(root), []);
  assert.strictEqual(drives.driveOf('USB/S/Beatles/1.flac', root), 'USB/S');
  assert.strictEqual(drives.driveOf('INTERNAL/a/b', root), 'INTERNAL');
  assert.deepStrictEqual(drives.list(root), ['USB/S', 'USB/T', 'NAS/N']);
  assert.deepStrictEqual(fileops.list(root, '').drives.map(function(d){ return d.path; }), ['INTERNAL', 'USB/S', 'USB/T', 'NAS/N']);
  assert.strictEqual(duplicates.trashPath('USB/S/Beatles', root), 'USB/S/Xplorio Trash/Beatles');
  assert.strictEqual(fileops.check(root, 'USB/S', true, false), null);           /* the drive itself is not an item */
});

t('Volumio layout with the Mac rule on: a real USB folder without links stays a folder of drives only when it holds links', function(){
  var root = tmp('xdrv-'), vol = tmp('xvol-');
  mk(root, 'USB/S/1.flac'); mkdirs(vol);
  drives.setup(root, false);
  assert.deepStrictEqual(drives.wholeList(root), []);                           /* Volumio: never from a real folder */
  drives.setup(root, true);
  assert.deepStrictEqual(drives.wholeList(root), ['USB']);                      /* Mac: music right in USB */
  fs.symlinkSync(vol, path.join(root, 'USB', 'Platte'));
  drives.reset();
  assert.deepStrictEqual(drives.wholeList(root), []);                           /* links inside: one drive per entry */
  assert.deepStrictEqual(drives.list(root), ['USB/Platte', 'USB/S']);
  drives.setup(root, function(){ return false; });                              /* the flag may be a function */
  assert.deepStrictEqual(drives.wholeList(root), []);
});

t('Mac: USB as a link to one folder is one drive; library paths stay as they are', function(){
  var m = macRoot(), root = m.root;
  drives.setup(root, true);
  assert.deepStrictEqual(drives.wholeList(root), ['USB']);
  assert.strictEqual(drives.driveOf('USB/Musik/Beatles/Help/01 Help.flac', root), 'USB');
  assert.strictEqual(duplicates.driveOf('USB/Musik/Beatles'), 'USB');           /* the root from setup */
  assert.strictEqual(duplicates.trashPath('USB/Musik/Beatles/Help'), 'USB/Xplorio Trash/Musik/Beatles/Help');
  assert.strictEqual(fileops.driveOf('USB/Musik/Beatles'), 'USB');
  drives.setup(root, false);                                                    /* a link counts even without the Mac rule */
  assert.deepStrictEqual(drives.wholeList(root), ['USB']);
  var dangling = tmp('xdrv-');
  fs.symlinkSync(path.join(dangling, 'gone'), path.join(dangling, 'USB'));
  assert.deepStrictEqual(drives.wholeList(dangling), []);                       /* volume not mounted: no drive */
  assert.deepStrictEqual(drives.list(dangling), []);
});

t('Dateimanager: one drive "USB", its folders are folders, moving inside is a rename', function(){
  var m = macRoot(), root = m.root;
  drives.setup(root, true);
  var l = fileops.list(root, '');
  assert.deepStrictEqual(l.drives, [{path: 'INTERNAL', name: 'INTERNAL'}, {path: 'USB', name: 'USB'}]);
  assert.deepStrictEqual(l.whole, ['USB']);
  var u = fileops.list(root, 'USB');
  assert.ok(u.ok);
  assert.deepStrictEqual(u.dirs.map(function(d){ return d.name; }), ['Hoerbuecher', 'Musik']);
  assert.deepStrictEqual(u.files.map(function(f){ return f.name; }), ['lose.flac']);
  assert.deepStrictEqual(u.whole, ['USB']);
  assert.strictEqual(fileops.check(root, 'USB', true, false), null);            /* the drive itself cannot be moved or trashed */
  assert.ok(fileops.check(root, 'USB/Musik', true, false));
  assert.ok(fileops.check(root, 'USB', false, false));
  var p = fileops.plan(root, ['USB/Hoerbuecher/Krimi'], 'USB/Musik', 'move');
  assert.strictEqual(p.steps[0].cross, false);                                  /* same drive: no copy, no trash */
  var q = fileops.plan(root, ['USB/Hoerbuecher/Krimi'], 'INTERNAL', 'copy');
  assert.strictEqual(q.steps[0].cross, true);
  assert.deepStrictEqual(fileops.scanPaths([{path: 'USB/lose.flac'}, {path: 'USB/Musik/Beatles', dir: true}]), ['USB/lose.flac', 'USB/Musik/Beatles']);
});

t('trash: one "Xplorio Trash" for the whole drive, listed, put back', function(){
  var m = macRoot(), root = m.root;
  drives.setup(root, true);
  var r = fileops.toTrash(root, ['USB/Musik/Beatles/Help', 'USB/Hoerbuecher/Krimi/1.mp3']);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.moved.map(function(x){ return x.to; }), ['USB/Xplorio Trash/Musik/Beatles/Help', 'USB/Xplorio Trash/Hoerbuecher/Krimi/1.mp3']);
  assert.ok(!has(root, 'USB/Musik/Xplorio Trash'));                              /* not one trash per folder */
  assert.deepStrictEqual(trash.split('USB/Xplorio Trash/Musik/Beatles/Help', root), {drive: 'USB', rest: 'Musik/Beatles/Help'});
  assert.strictEqual(trash.origin('USB/Xplorio Trash/Musik/Beatles/Help', root), 'USB/Musik/Beatles/Help');
  assert.deepStrictEqual(trash.drives(root), ['INTERNAL', 'USB']);
  var l = trash.list(root, []);
  assert.deepStrictEqual(l.drives.map(function(d){ return d.drive; }), ['USB']);
  assert.deepStrictEqual(l.drives[0].entries.map(function(e){ return e.path + ' <- ' + e.from; }).sort(),
    ['USB/Xplorio Trash/Hoerbuecher/Krimi <- USB/Hoerbuecher/Krimi', 'USB/Xplorio Trash/Musik/Beatles/Help <- USB/Musik/Beatles/Help']);   /* without journal: one entry per folder */
  assert.strictEqual(fileops.list(root, 'USB').dirs.map(function(d){ return d.name; }).indexOf('Xplorio Trash'), -1);   /* hidden in the Dateimanager */
  var back = trash.restore(root, 'USB/Xplorio Trash/Musik/Beatles/Help');
  assert.ok(back.ok, back.error);
  assert.ok(has(root, 'USB/Musik/Beatles/Help/01 Help.flac'));
  assert.ok(trash.empty(root, 'USB').ok);
  assert.ok(!has(root, 'USB/Xplorio Trash/Hoerbuecher'));
});

t('old trash folders inside a whole drive are gathered into the drive\'s trash, journal follows', function(){
  var m = macRoot(), root = m.root;
  mk(root, 'USB/Musik/Xplorio Trash/Beatles/Help/1.flac', 'old1');
  mk(root, 'USB/Musik/Xplorio Trash/Beatles/Help/2.flac', 'old2');
  mk(root, 'USB/Musik/Xplorio Trash/.DS_Store', 'mac');
  mk(root, 'USB/Musik/.mpdignore', 'Live\nXplorio Trash\n');
  mk(root, 'USB/Hoerbuecher/Xplorio Trash/Krimi/a.mp3', 'book');
  mk(root, 'USB/Hoerbuecher/.mpdignore', 'Xplorio Trash\n');
  mk(root, 'USB/Rock/.duplicates/Queen/x.flac', 'very old');                    /* name of an earlier version */
  mk(root, 'USB/Xplorio Trash/Musik/Beatles/Help/1.flac', 'newer');             /* the same file is already in the new place */
  drives.setup(root, true);
  var g = trash.gatherWhole(root);
  assert.deepStrictEqual(g.errors, []);
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/Xplorio Trash/Musik/Beatles/Help/1.flac'), 'utf8'), 'newer');
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/Xplorio Trash/Musik/Beatles/Help/1 (2).flac'), 'utf8'), 'old1');
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/Xplorio Trash/Musik/Beatles/Help/2.flac'), 'utf8'), 'old2');
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/Xplorio Trash/Hoerbuecher/Krimi/a.mp3'), 'utf8'), 'book');
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/Xplorio Trash/Rock/Queen/x.flac'), 'utf8'), 'very old');
  ['USB/Musik/Xplorio Trash', 'USB/Hoerbuecher/Xplorio Trash', 'USB/Rock/.duplicates', 'USB/Hoerbuecher/.mpdignore'].forEach(function(p){ assert.ok(!has(root, p), p); });
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/Musik/.mpdignore'), 'utf8'), 'Live\n');   /* other lines stay */
  assert.ok(has(root, 'USB/Musik/Beatles/Help/01 Help.flac'));                  /* music untouched */
  var j = trash.journalMove([{to: 'USB/Musik/Xplorio Trash/Beatles/Help/2.flac', from: 'USB/Musik/Beatles/Help/2.flac', at: 1, reason: 'dupTrack'},
                             {to: 'USB/Hoerbuecher/Xplorio Trash/Krimi', from: 'USB/Hoerbuecher/Krimi', at: 2, reason: 'files'},
                             {to: 'INTERNAL/Xplorio Trash/x', from: 'INTERNAL/x', at: 3}], g.moves);
  assert.deepStrictEqual(j.map(function(x){ return x.to; }), ['USB/Xplorio Trash/Musik/Beatles/Help/2.flac', 'USB/Xplorio Trash/Hoerbuecher/Krimi', 'INTERNAL/Xplorio Trash/x']);
  assert.strictEqual(j[0].from, 'USB/Musik/Beatles/Help/2.flac');
  assert.strictEqual(trash.originOf(j, 'USB/Xplorio Trash/Hoerbuecher/Krimi/a.mp3'), 'USB/Hoerbuecher/Krimi/a.mp3');
  assert.deepStrictEqual(trash.gatherWhole(root).moves, []);                    /* a second run finds nothing */
});

t('gathering leaves Volumio drives and folders behind links alone', function(){
  var root = tmp('xdrv-'), vol = tmp('xvol-');
  mk(root, 'USB/S/Musik/Xplorio Trash/a.flac');
  drives.setup(root, false);
  assert.deepStrictEqual(trash.gatherWhole(root).moves, []);
  assert.ok(has(root, 'USB/S/Musik/Xplorio Trash/a.flac'));
  var m = macRoot();
  mk(vol, 'Xplorio Trash/b.flac');
  fs.symlinkSync(vol, path.join(m.root, 'USB', 'Fremd'));                        /* a link inside the drive: not followed */
  drives.setup(m.root, true);
  assert.deepStrictEqual(trash.gatherWhole(m.root).moves, []);
  assert.ok(has(vol, 'Xplorio Trash/b.flac'));
});

t('hiding from the library: folders right on the whole drive are not the drive itself', function(){
  var m = macRoot(), root = m.root;
  drives.setup(root, true);
  mk(root, 'USB/.mpdignore', 'Hoerbuecher\n');
  var l = mpdignore.mark(root, fileops.list(root, 'USB/Hoerbuecher'));
  assert.strictEqual(l.hidden && l.hidden.path, 'USB/Hoerbuecher');            /* shown as hidden: it is a folder now */
  var v = tmp('xdrv-');
  mk(v, 'USB/S/.mpdignore', 'x\n'); mk(v, 'USB/S/a/1.flac');
  mk(v, 'USB/.mpdignore', 'S\n');
  drives.setup(v, false);
  assert.strictEqual(mpdignore.mark(v, fileops.list(v, 'USB/S')).hidden, undefined);   /* Volumio: USB/S is the drive */
});

console.log(n + ' tests passed');
