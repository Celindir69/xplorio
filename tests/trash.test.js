/* Papierkorb: list, put back, delete (tags/trash.js) */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
var trash = require('../tags/trash.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function mk(root, rel, text) { var f = path.join(root, rel); trashMk(path.dirname(f)); fs.writeFileSync(f, text || 'x'); }
function trashMk(d) { d.split(path.sep).reduce(function(cur, p){ cur = cur ? path.join(cur, p) : (p || path.sep); try { fs.mkdirSync(cur); } catch (e) {} return cur; }, ''); }
function rm(p) { if (!fs.existsSync(p)) return; if (fs.statSync(p).isDirectory()) { fs.readdirSync(p).forEach(function(c){ rm(path.join(p, c)); }); fs.rmdirSync(p); } else fs.unlinkSync(p); }
function setup() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'xtrash-'));
  mk(root, 'USB/S/Beatles/Help/1.flac');
  mk(root, 'USB/S/Xplorio Trash/Beatles/Help/1 (1).flac', 'dup');                 /* a duplicate track, with journal */
  mk(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road/1.mp3', 'abc');                /* a whole album, with journal */
  mk(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road/2.mp3', 'de');
  mk(root, 'USB/S/Xplorio Trash/Old/Album/a.flac', 'older');                      /* moved by an earlier version: no journal */
  mk(root, 'USB/S/Xplorio Trash/.DS_Store', 'mac');
  mk(root, 'INTERNAL/Xplorio Trash/Solo/x.flac');
  fs.mkdirSync(path.join(root, 'NAS'));
  return root;
}
var J = [{to: 'USB/S/Xplorio Trash/Beatles/Help/1 (1).flac', from: 'USB/S/Beatles/Help/1 (1).flac', at: 2000, reason: 'dupTrack'},
         {to: 'USB/S/Xplorio Trash/Beatles/Abbey Road', from: 'USB/S/Beatles/Abbey Road', at: 3000, reason: 'dupAlbum'},
         {to: 'USB/S/Xplorio Trash/Gone', from: 'USB/S/Gone', at: 1000, reason: 'dupAlbum'}];

t('paths: only inside a trash folder, nothing outside', function(){
  assert.deepStrictEqual(trash.split('USB/S/Xplorio Trash/a/b.flac'), {drive: 'USB/S', rest: 'a/b.flac'});
  assert.deepStrictEqual(trash.split('INTERNAL/Xplorio Trash/a'), {drive: 'INTERNAL', rest: 'a'});
  ['USB/S/a/b.flac', 'USB/S/Xplorio Trash', 'USB/S/Xplorio Trash/../x', '/USB/S/Xplorio Trash/a', 'NAS/Xplorio Trash/a', 'X/Xplorio Trash/a', ''].forEach(function(p){
    assert.strictEqual(trash.split(p), null, p);
  });
  assert.strictEqual(trash.origin('USB/S/Xplorio Trash/Old/Album'), 'USB/S/Old/Album');
});
t('list: journal entries with reason, the rest one entry per folder, newest first, sizes', function(){
  var root = setup(), l = trash.list(root, J);
  assert.deepStrictEqual(l.drives.map(function(d){ return d.drive; }), ['INTERNAL', 'USB/S']);
  var usb = l.drives[1];
  var abbey = usb.entries.filter(function(e){ return /Abbey/.test(e.path); })[0];
  assert.deepStrictEqual([abbey.kind, abbey.reason, abbey.bytes, abbey.files, abbey.from], ['dir', 'dupAlbum', 5, 2, 'USB/S/Beatles/Abbey Road']);
  var help = usb.entries.filter(function(e){ return /Help/.test(e.path); });
  assert.strictEqual(help.length, 1);                                    /* the folder Help holds only the journal file */
  assert.deepStrictEqual([help[0].kind, help[0].reason], ['file', 'dupTrack']);
  var old = usb.entries.filter(function(e){ return /Old/.test(e.path); })[0];
  assert.deepStrictEqual([old.path, old.kind, old.reason, old.from], ['USB/S/Xplorio Trash/Old/Album', 'dir', '', 'USB/S/Old/Album']);
  assert.ok(old.at > 3000);                                               /* time of the move from the file system */
  assert.deepStrictEqual([l.drives[0].entries[0].path, l.drives[0].entries[0].kind], ['INTERNAL/Xplorio Trash/Solo', 'dir']);
  assert.strictEqual(l.count, 4);
  assert.strictEqual(l.bytes, 3 + 5 + 5 + 1);
  rm(root);
});
t('put back: file and album to their old place, empty folders in the trash go', function(){
  var root = setup();
  var r1 = trash.restore(root, 'USB/S/Xplorio Trash/Beatles/Help/1 (1).flac', 'USB/S/Beatles/Help/1 (1).flac');
  assert.ok(r1.ok, r1.error);
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/S/Beatles/Help/1 (1).flac'), 'utf8'), 'dup');
  assert.ok(!fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Beatles/Help')));
  var r2 = trash.restore(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road', 'USB/S/Beatles/Abbey Road');
  assert.ok(r2.ok, r2.error);
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Beatles/Abbey Road/2.mp3')));
  assert.ok(!fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Beatles')));
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Xplorio Trash')));        /* the trash folder itself stays */
  rm(root);
});
t('put back never overwrites; an album folder that is there again gets the files added', function(){
  var root = setup();
  mk(root, 'USB/S/Beatles/Help/1 (1).flac', 'new');
  var r = trash.restore(root, 'USB/S/Xplorio Trash/Beatles/Help/1 (1).flac', 'USB/S/Beatles/Help/1 (1).flac');
  assert.deepStrictEqual([r.ok, r.error], [false, 'exists']);
  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/S/Beatles/Help/1 (1).flac'), 'utf8'), 'new');
  mk(root, 'USB/S/Old/Album/b.flac');
  var r2 = trash.restore(root, 'USB/S/Xplorio Trash/Old/Album');
  assert.ok(r2.ok, r2.error);
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Old/Album/a.flac')) && fs.existsSync(path.join(root, 'USB/S/Old/Album/b.flac')));
  mk(root, 'USB/S/Xplorio Trash/Old/Album/a.flac', 'again');
  var r3 = trash.restore(root, 'USB/S/Xplorio Trash/Old/Album');
  assert.deepStrictEqual([r3.ok, r3.conflict], [false, 'USB/S/Old/Album/a.flac']);
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Old/Album/a.flac')));   /* nothing moved */
  rm(root);
});
t('put back only within the same drive and only from the trash', function(){
  var root = setup();
  assert.strictEqual(trash.restore(root, 'USB/S/Beatles/Help/1.flac').error, 'gone');
  assert.strictEqual(trash.restore(root, 'USB/S/Xplorio Trash/Old/Album', 'INTERNAL/x').error, 'bad origin');
  assert.strictEqual(trash.restore(root, 'USB/S/Xplorio Trash/Old/Album', 'USB/S/Xplorio Trash/y').error, 'bad origin');
  rm(root);
});
t('delete: one entry, or empty a drive; nothing outside the trash', function(){
  var root = setup();
  assert.ok(trash.remove(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road').ok);
  assert.ok(!fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road')));
  assert.strictEqual(trash.remove(root, 'USB/S/Beatles/Help').error, 'gone');
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Beatles/Help/1.flac')));
  fs.symlinkSync(path.join(root, 'USB/S/Beatles'), path.join(root, 'USB/S/Xplorio Trash/link'));
  assert.strictEqual(trash.remove(root, 'USB/S/Xplorio Trash/link/Help').error, 'not in the trash');
  var e = trash.empty(root, 'USB/S');
  assert.ok(e.ok);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'USB/S/Xplorio Trash')), []);
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Beatles/Help/1.flac')));  /* the link was removed, not what it points to */
  assert.strictEqual(trash.empty(root, 'USB/Nope').error, 'no such drive');
  assert.strictEqual(trash.list(root, J).drives.length, 1);
  rm(root);
});
t('journal: new entries replace old ones with the same place, gone ones drop out', function(){
  var root = setup();
  var j = trash.journalAdd(J, [{to: 'USB/S/Xplorio Trash/Old/Album', from: 'USB/S/Old/Album', at: 5, reason: 'albumEditor'}], root);
  assert.deepStrictEqual(j.map(function(x){ return x.to; }), ['USB/S/Xplorio Trash/Beatles/Help/1 (1).flac', 'USB/S/Xplorio Trash/Beatles/Abbey Road', 'USB/S/Xplorio Trash/Old/Album']);
  rm(root);
});
t('a folder entry one by one: its files, the old place of each, put back a single file', function(){
  var root = setup();
  var f = trash.files(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road');
  assert.deepStrictEqual(f.files.map(function(x){ return [x.name, x.bytes]; }), [['1.mp3', 3], ['2.mp3', 2]]);
  assert.strictEqual(trash.files(root, 'USB/S/Beatles').error, 'gone');
  var J2 = J.concat([{to: 'USB/S/Xplorio Trash/Beatles/Abbey Road (2)', from: 'USB/S/Beatles/Abbey Road', at: 1}]);
  assert.strictEqual(trash.originOf(J2, 'USB/S/Xplorio Trash/Beatles/Abbey Road (2)/2.mp3'), 'USB/S/Beatles/Abbey Road/2.mp3');
  assert.strictEqual(trash.originOf(J2, 'USB/S/Xplorio Trash/Old/Album/a.flac'), 'USB/S/Old/Album/a.flac');
  var r = trash.restore(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road/2.mp3', trash.originOf(J, 'USB/S/Xplorio Trash/Beatles/Abbey Road/2.mp3'));
  assert.ok(r.ok, r.error);
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Beatles/Abbey Road/2.mp3')));
  assert.ok(fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road/1.mp3')));   /* the rest stays */
  assert.ok(trash.remove(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road/1.mp3').ok);
  assert.ok(!fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Beatles/Abbey Road')));       /* empty: gone */
  rm(root);
});
console.log(n + ' tests passed');
