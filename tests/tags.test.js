/* Tests the tag service: path resolution (protection against ../ and foreign folders) and, if python3 or python is present,
   writing/reading/deleting tags on a small DSF file generated here.
   Usage: node tests/tags.test.js */
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), assert = require('assert');

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-test-'));
fs.mkdirSync(path.join(root, 'USB')); fs.mkdirSync(path.join(root, 'USB', 'Ärzte'));
fs.writeFileSync(path.join(root, 'USB', 'Ärzte', 'a.flac'), '');
fs.writeFileSync(path.join(root, 'USB', 'notes.txt'), '');
fs.mkdirSync(path.join(root, 'elsewhere')); fs.writeFileSync(path.join(root, 'elsewhere', 'x.mp3'), '');
fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, 'USB', 'link'));
process.env.MUSIC_ROOT = root;
var svc = require('../tags/tag-service.js');

var n = 0;
function t(name, fn) {
  try { fn(); console.log('ok   ' + name); n++; } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}

t('USB path is resolved', function(){
  var p = svc.resolveUri('USB/Ärzte/a.flac');
  assert.strictEqual(p.full, path.join(root, 'USB', 'Ärzte', 'a.flac'));
  assert.strictEqual(p.rel, 'USB/Ärzte/a.flac');
});
t('prefixes music-library/ and mnt/ are removed', function(){
  assert.strictEqual(svc.resolveUri('music-library/USB/Ärzte/a.flac').rel, 'USB/Ärzte/a.flac');
  assert.strictEqual(svc.resolveUri('/mnt/USB/Ärzte/a.flac').rel, 'USB/Ärzte/a.flac');
});
t('.. is rejected', function(){
  assert.strictEqual(svc.resolveUri('USB/../../etc/x.mp3'), null);
  assert.strictEqual(svc.resolveUri('USB/Ärzte/../a.flac'), null);
});
t('foreign folder, wrong extension, TIDAL, empty are rejected', function(){
  assert.strictEqual(svc.resolveUri('etc/x.mp3'), null);
  assert.strictEqual(svc.resolveUri('USB/notes.txt'), null);
  assert.strictEqual(svc.resolveUri('tidal://song/1'), null);
  assert.strictEqual(svc.resolveUri(''), null);
  assert.strictEqual(svc.resolveUri(null), null);
  assert.strictEqual(svc.resolveUri('USB/a\0.mp3'), null);
});
t('symlink out of the music folder is rejected', function(){
  assert.strictEqual(svc.resolveUri('USB/link/x.mp3'), null);
});
t('missing file is reported as missing', function(){
  assert.strictEqual(svc.resolveUri('USB/nix.flac').missing, true);
});
t('rescan: common parent folder from 3 levels, otherwise individual folders', function(){
  assert.deepStrictEqual(svc.scanDirs(['USB/M/Künstler/A1/1.flac', 'USB/M/Künstler/A1/2.flac']), ['USB/M/Künstler/A1']);
  assert.deepStrictEqual(svc.scanDirs(['USB/M/Künstler/A1/1.flac', 'USB/M/Künstler/A2/1.flac']), ['USB/M/Künstler']);
  assert.deepStrictEqual(svc.scanDirs(['USB/M/K1/A/1.flac', 'USB/M/K2/A/1.flac']), ['USB/M/K1/A', 'USB/M/K2/A']);
  assert.deepStrictEqual(svc.scanDirs(['USB/M/X/a.flac', 'INTERNAL/b.flac']), ['USB/M/X', 'INTERNAL']);
});
t('rescan: many folders (genre across many albums) result in one scan', function(){
  assert.deepStrictEqual(svc.scanDirs(['USB/A/1/a.flac', 'USB/B/1/a.flac', 'USB/C/1/a.flac', 'USB/D/1/a.flac']), ['USB']);
  assert.deepStrictEqual(svc.scanDirs(['USB/A/1/a.flac', 'USB/B/1/a.flac', 'NAS/C/1/a.flac', 'NAS/D/1/a.flac']), ['']);
});

/* tags.py with a self-built DSF file */
var py = ['python3', 'python'].filter(function(c){ return cp.spawnSync(c, ['--version']).status === 0; })[0];
if (!py) { console.log('ok   (tags.py skipped: no Python found)'); }
else {
  var dsf = path.join(root, 'USB', 't.dsf');
  var mk = 'import struct\nblk=4096\nfmt=struct.pack("<4sQIIIIIIQII",b"fmt ",52,1,0,2,1,2822400,1,blk*8,blk,0)\n' +
    'dat=b"data"+struct.pack("<Q",12+blk)+b"\\x69"*blk\ntotal=28+len(fmt)+len(dat)\n' +
    'open(%s,"wb").write(struct.pack("<4sQQQ",b"DSD ",28,total,0)+fmt+dat)\n';
  cp.spawnSync(py, ['-c', mk.replace('%s', JSON.stringify(dsf))]);
  function run(job) {
    var r = cp.spawnSync(py, [path.join(__dirname, '..', 'tags', 'tags.py')], {input: JSON.stringify(job), encoding: 'utf8'});
    return JSON.parse(r.stdout);
  }
  t('tags.py via sudo (root rights from the plugin): only music below /mnt and /media, images only from the data folder', function(){
    if (process.getuid() !== 0) return;
    function sudoRun(job) {
      var env = {}; Object.keys(process.env).forEach(function(k){ env[k] = process.env[k]; }); env.SUDO_USER = 'volumio';
      return JSON.parse(cp.spawnSync(py, [path.join(__dirname, '..', 'tags', 'tags.py')], {input: JSON.stringify(job), encoding: 'utf8', env: env}).stdout);
    }
    assert.deepStrictEqual(sudoRun({op: 'read', path: dsf}), {ok: false, error: 'path not allowed'});
    assert.deepStrictEqual(sudoRun({op: 'read', path: '/mnt/../etc/x.flac'}), {ok: false, error: 'path not allowed'});
    assert.deepStrictEqual(sudoRun({op: 'read', path: '/mnt/USB/none.flac'}), {ok: false, error: 'file not found'});
  });
  t('tags.py: read empty DSF', function(){
    var r = run({op: 'read', path: dsf});
    assert.ok(r.ok); assert.strictEqual(r.format, 'dsf'); assert.strictEqual(r.tags.title, '');
  });
  t('tags.py: write, umlauts, before/after', function(){
    var r = run({op: 'write', path: dsf, tags: {title: 'Tëst', track: '3/12', artist: 'Ärzte'}});
    assert.ok(r.ok && r.changed); assert.strictEqual(r.before.title, ''); assert.strictEqual(r.after.title, 'Tëst');
    assert.strictEqual(run({op: 'read', path: dsf}).tags.track, '3/12');
  });
  t('tags.py: unchanged fields are skipped', function(){
    var r = run({op: 'write', path: dsf, tags: {title: 'Tëst'}});
    assert.ok(r.ok); assert.strictEqual(r.changed, false);
  });
  t('tags.py: empty value deletes the field', function(){
    run({op: 'write', path: dsf, tags: {title: ''}});
    assert.strictEqual(run({op: 'read', path: dsf}).tags.title, '');
  });
  t('tags.py: null and lists are not written as text', function(){
    var r = run({op: 'write', path: dsf, tags: {title: null, artist: ['a'], album: true}});
    assert.ok(r.ok); assert.strictEqual(r.changed, false);
    assert.strictEqual(run({op: 'read', path: dsf}).tags.title, '');
  });
  t('tags.py: write, read and delete comment', function(){
    var r = run({op: 'write', path: dsf, tags: {comment: 'Live in Köln\nzweite Zeile'}});
    assert.ok(r.ok && r.changed); assert.strictEqual(r.before.comment, '');
    assert.strictEqual(run({op: 'read', path: dsf}).tags.comment, 'Live in Köln\nzweite Zeile');
    run({op: 'write', path: dsf, tags: {comment: ''}});
    assert.strictEqual(run({op: 'read', path: dsf}).tags.comment, '');
  });
  t('tags.py: unsupported extension and missing file', function(){
    assert.strictEqual(run({op: 'read', path: path.join(root, 'USB', 'notes.txt')}).ok, false);
    assert.strictEqual(run({op: 'read', path: path.join(root, 'USB', 'nix.flac')}).ok, false);
  });

  /* cover: small JPEG (only header and filler bytes; mutagen does not check the content) */
  var jpgA = path.join(root, 'a.jpg'), jpgB = path.join(root, 'b.jpg');
  fs.writeFileSync(jpgA, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]));
  fs.writeFileSync(jpgB, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 2)]));
  var bak = path.join(root, 'bak', 'x');
  t('tags.py: without cover, cover_get returns no image', function(){
    var r = run({op: 'cover_get', path: dsf});
    assert.ok(r.ok); assert.strictEqual(r.data, undefined);
    assert.strictEqual(run({op: 'cover_has', path: dsf}).has, false);
  });
  t('tags.py: embed cover and read it back', function(){
    var r = run({op: 'cover_set', path: dsf, image: jpgA, mime: 'image/jpeg', backup: bak});
    assert.ok(r.ok && r.changed); assert.strictEqual(r.backup, null);
    var g = run({op: 'cover_get', path: dsf});
    assert.strictEqual(g.mime, 'image/jpeg');
    assert.ok(Buffer.from(g.data, 'base64').equals(fs.readFileSync(jpgA)));
    assert.strictEqual(run({op: 'cover_has', path: dsf}).has, true);
  });
  t('tags.py: same image changes nothing', function(){
    assert.strictEqual(run({op: 'cover_set', path: dsf, image: jpgA, backup: bak}).changed, false);
  });
  t('tags.py: replacing backs up the old cover, text tags are kept', function(){
    run({op: 'write', path: dsf, tags: {title: 'With Cover'}});
    var r = run({op: 'cover_set', path: dsf, image: jpgB, backup: bak});
    assert.ok(r.changed); assert.strictEqual(r.backup, bak + '.jpg');
    assert.ok(fs.readFileSync(r.backup).equals(fs.readFileSync(jpgA)));
    assert.ok(Buffer.from(run({op: 'cover_get', path: dsf}).data, 'base64').equals(fs.readFileSync(jpgB)));
    assert.strictEqual(run({op: 'read', path: dsf}).tags.title, 'With Cover');
  });
  t('tags.py: without image the cover is removed', function(){
    assert.ok(run({op: 'cover_set', path: dsf}).changed);
    assert.strictEqual(run({op: 'cover_get', path: dsf}).data, undefined);
  });
  t('tags.py: several jobs in one call, one error does not affect the others', function(){
    var r = run({op: 'batch', jobs: [{op: 'read', path: dsf}, {op: 'read', path: path.join(root, 'USB', 'nix.dsf')}, 'broken',
                                     {op: 'write', path: dsf, tags: {genre: 'Batch'}}]});
    assert.ok(r.ok); assert.strictEqual(r.results.length, 4);
    assert.strictEqual(r.results[0].tags.title, 'With Cover');
    assert.strictEqual(r.results[1].ok, false); assert.strictEqual(r.results[2].ok, false);
    assert.ok(r.results[3].changed);
    assert.strictEqual(run({op: 'read', path: dsf}).tags.genre, 'Batch');
  });

  /* service over HTTP: write folder.jpg, confirmation for an existing file, undo */
  var http = require('http');
  process.env.TAGS_LOG = path.join(root, 'log', 'changes.jsonl');
  function post(port, route, body, cb) {
    var req = http.request({port: port, path: route, method: 'POST', headers: {'X-Xplorio': '1'}}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
    });
    req.end(JSON.stringify(body));
  }
  var asyncTests = function(done){
    delete require.cache[require.resolve('../tags/tag-service.js')];
    process.env.PYTHON = py; process.env.MPC = 'true';
    var s2 = require('../tags/tag-service.js').server;
    s2.listen(0, function(){
      var port = s2.address().port, img = fs.readFileSync(jpgA).toString('base64');
      var folderJpg = path.join(root, 'USB', 'folder.jpg');
      post(port, '/cover', {uris: ['USB/t.dsf'], image: img, folder: true, embed: true}, function(r1){
        t('service: embed cover and create folder.jpg', function(){
          assert.ok(r1.ok && r1.batch); assert.ok(fs.existsSync(folderJpg));
          assert.strictEqual(r1.items[0].changed, true);
        });
        post(port, '/cover', {uris: ['USB/t.dsf'], image: fs.readFileSync(jpgB).toString('base64'), folder: true}, function(r2){
          t('service: existing folder.jpg only with overwrite', function(){
            assert.strictEqual(r2.ok, false); assert.deepStrictEqual(r2.exists, ['USB']);
          });
          post(port, '/cover', {uris: ['USB/t.dsf'], image: 'not-a-jpeg', folder: true}, function(r3){
            t('service: non-JPEG is rejected', function(){ assert.strictEqual(r3.ok, false); });
            var other = path.join(root, 'fremd.jpg');
            fs.writeFileSync(other, 'do not overwrite');
            fs.renameSync(folderJpg, folderJpg + '.echt'); fs.symlinkSync(other, folderJpg);
            post(port, '/cover', {uris: ['USB/t.dsf'], image: fs.readFileSync(jpgB).toString('base64'), folder: true, overwrite: true}, function(r5){
            t('service: folder.jpg as a link is not overwritten', function(){
              assert.strictEqual(r5.folders[0].ok, false);
              assert.strictEqual(fs.readFileSync(other, 'utf8'), 'do not overwrite');
            });
            fs.unlinkSync(folderJpg); fs.renameSync(folderJpg + '.echt', folderJpg);
            post(port, '/undo', {batch: r1.batch}, function(r4){
              t('service: undo removes folder.jpg and embedded cover', function(){
                assert.ok(r4.ok); assert.ok(!fs.existsSync(folderJpg));
                assert.strictEqual(run({op: 'cover_get', path: dsf}).data, undefined);
              });
              var dsf2 = path.join(root, 'USB', 't2.dsf');
              fs.writeFileSync(dsf2, fs.readFileSync(dsf));
              var b = 'stapel1', vorher = run({op: 'read', path: dsf}).tags.artist;
              post(port, '/write', {items: [{uri: 'USB/t.dsf', tags: {artist: 'New'}}], batch: b, scan: false}, function(w1){
                post(port, '/write', {items: [{uri: 'USB/t2.dsf', tags: {artist: 'New'}}], batch: b, scan: false}, function(w2){
                  t('service: writing in parts with a shared ID', function(){
                    assert.strictEqual(w1.batch, b); assert.strictEqual(w2.batch, b);
                    assert.strictEqual(w1.scan, null);
                    assert.strictEqual(run({op: 'read', path: dsf2}).tags.artist, 'New');
                  });
                  post(port, '/write', {items: [{uri: 'USB/t.dsf', tags: {}}], batch: '../x'}, function(w3){
                    t('service: invalid ID is rejected', function(){ assert.strictEqual(w3.ok, false); });
                    post(port, '/undo', {batch: b}, function(u){
                      t('service: undo restores all parts', function(){
                        assert.ok(u.ok);
                        assert.notStrictEqual(vorher, 'New');
                        assert.strictEqual(run({op: 'read', path: dsf}).tags.artist, vorher);
                        assert.strictEqual(run({op: 'read', path: dsf2}).tags.artist, vorher);
                      });
                      post(port, '/scan', {uris: ['USB/t.dsf', 'USB/t2.dsf']}, function(sc){
                        t('service: /scan rescans', function(){ assert.ok(sc.ok); assert.strictEqual(sc.scan, true); });
                        post(port, '/scan', {hold: true}, function(h1){
                          post(port, '/scan', {uris: ['USB/t.dsf']}, function(){
                            post(port, '/scan', {hold: false}, function(h2){
                              t('service: hold back scans (library check open) and scan on release', function(){
                                assert.strictEqual(h1.hold, true);
                                assert.strictEqual(h2.hold, false); assert.ok(h2.pending >= 1);
                              });
                              post(port, '/scan', {all: true}, function(all){
                              t('service: scan the whole library (button in the library check)', function(){ assert.ok(all.ok && all.scan); });
                              var ckFile = path.join(root, 'log', 'check.json');
                              fs.mkdirSync(path.dirname(ckFile), {recursive: true});
                              fs.writeFileSync(ckFile, JSON.stringify({at: 1, noCover: []}));
                              post(port, '/checkdone', {key: 'noCover|USB/A'}, function(d1){
                                post(port, '/checkdone', {}, function(d2){
                                  t('service: handled check entries are remembered until the next check', function(){
                                    assert.ok(d1.ok); assert.strictEqual(d2.ok, false);
                                    var ck = JSON.parse(fs.readFileSync(ckFile, 'utf8'));
                                    assert.deepStrictEqual(ck.done, {'noCover|USB/A': 1}); assert.strictEqual(ck.at, 1);
                                  });
                                  s2.close();
                                  artistTracks(done);
                                });
                              });
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
            });
        });
      });
    });
  };
}
/* GET /artist?tracks=1 with a fake mpc: all search hits with title and album */
function artistTracks(done) {
  var http = require('http'), os = require('os');
  var fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mpc-')), 'mpc');
  fs.writeFileSync(fake, '#!/bin/sh\n[ "$4" = artist ] && printf \'USB/C/01.flac\\tSpliff\\tVarious Artists\\tCarbonara\\tNDW Hits\\nUSB/C/02.flac\\tSpliff feat. Nina\\t\\tDas Blech\\tNDW Hits\\n\'\nexit 0\n');
  fs.chmodSync(fake, 493);
  delete require.cache[require.resolve('../tags/tag-service.js')];
  process.env.MPC = fake;
  var s3 = require('../tags/tag-service.js').server;
  s3.listen(0, function(){
    http.get({port: s3.address().port, path: '/artist?tracks=1&name=Spliff'}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){
        var r = JSON.parse(d);
        t('service: /artist?tracks=1 returns title and album', function(){
          assert.ok(r.ok); assert.strictEqual(r.tracks.length, 2);
          assert.deepStrictEqual(r.tracks[0], {file: 'USB/C/01.flac', artist: 'Spliff', albumartist: 'Various Artists', title: 'Carbonara', album: 'NDW Hits'});
          assert.strictEqual(r.tracks[1].artist, 'Spliff feat. Nina');
        });
        s3.close(); done();
      });
    });
  });
}
if (typeof asyncTests === 'function') asyncTests(function(){ console.log(n + ' tests'); });
else console.log(n + ' tests');
