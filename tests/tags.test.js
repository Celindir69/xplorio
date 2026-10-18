/* Prüft den Tag-Dienst: Pfadauflösung (Schutz vor ../ und fremden Ordnern) und, falls python3 oder python da ist,
   Schreiben/Lesen/Löschen von Tags an einer kleinen DSF-Datei, die hier selbst erzeugt wird.
   Aufruf: node tests/tags.test.js */
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

t('USB-Pfad wird aufgelöst', function(){
  var p = svc.resolveUri('USB/Ärzte/a.flac');
  assert.strictEqual(p.full, path.join(root, 'USB', 'Ärzte', 'a.flac'));
  assert.strictEqual(p.rel, 'USB/Ärzte/a.flac');
});
t('Präfixe music-library/ und mnt/ werden entfernt', function(){
  assert.strictEqual(svc.resolveUri('music-library/USB/Ärzte/a.flac').rel, 'USB/Ärzte/a.flac');
  assert.strictEqual(svc.resolveUri('/mnt/USB/Ärzte/a.flac').rel, 'USB/Ärzte/a.flac');
});
t('.. wird abgelehnt', function(){
  assert.strictEqual(svc.resolveUri('USB/../../etc/x.mp3'), null);
  assert.strictEqual(svc.resolveUri('USB/Ärzte/../a.flac'), null);
});
t('fremder Ordner, falsche Endung, TIDAL, leer werden abgelehnt', function(){
  assert.strictEqual(svc.resolveUri('etc/x.mp3'), null);
  assert.strictEqual(svc.resolveUri('USB/notes.txt'), null);
  assert.strictEqual(svc.resolveUri('tidal://song/1'), null);
  assert.strictEqual(svc.resolveUri(''), null);
  assert.strictEqual(svc.resolveUri(null), null);
  assert.strictEqual(svc.resolveUri('USB/a\0.mp3'), null);
});
t('Symlink aus dem Musikordner hinaus wird abgelehnt', function(){
  assert.strictEqual(svc.resolveUri('USB/link/x.mp3'), null);
});
t('fehlende Datei wird als missing gemeldet', function(){
  assert.strictEqual(svc.resolveUri('USB/nix.flac').missing, true);
});
t('Neu einlesen: gemeinsamer Elternordner ab 3 Ebenen, sonst einzelne Ordner', function(){
  assert.deepStrictEqual(svc.scanDirs(['USB/M/Künstler/A1/1.flac', 'USB/M/Künstler/A1/2.flac']), ['USB/M/Künstler/A1']);
  assert.deepStrictEqual(svc.scanDirs(['USB/M/Künstler/A1/1.flac', 'USB/M/Künstler/A2/1.flac']), ['USB/M/Künstler']);
  assert.deepStrictEqual(svc.scanDirs(['USB/M/K1/A/1.flac', 'USB/M/K2/A/1.flac']), ['USB/M/K1/A', 'USB/M/K2/A']);
  assert.deepStrictEqual(svc.scanDirs(['USB/M/X/a.flac', 'INTERNAL/b.flac']), ['USB/M/X', 'INTERNAL']);
});
t('Neu einlesen: viele Ordner (Genre über viele Alben) ergeben einen Scan', function(){
  assert.deepStrictEqual(svc.scanDirs(['USB/A/1/a.flac', 'USB/B/1/a.flac', 'USB/C/1/a.flac', 'USB/D/1/a.flac']), ['USB']);
  assert.deepStrictEqual(svc.scanDirs(['USB/A/1/a.flac', 'USB/B/1/a.flac', 'NAS/C/1/a.flac', 'NAS/D/1/a.flac']), ['']);
});

/* tags.py mit einer selbst gebauten DSF-Datei */
var py = ['python3', 'python'].filter(function(c){ return cp.spawnSync(c, ['--version']).status === 0; })[0];
if (!py) { console.log('ok   (tags.py übersprungen: kein Python gefunden)'); }
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
  t('tags.py: leere DSF lesen', function(){
    var r = run({op: 'read', path: dsf});
    assert.ok(r.ok); assert.strictEqual(r.format, 'dsf'); assert.strictEqual(r.tags.title, '');
  });
  t('tags.py: schreiben, Umlaute, before/after', function(){
    var r = run({op: 'write', path: dsf, tags: {title: 'Tëst', track: '3/12', artist: 'Ärzte'}});
    assert.ok(r.ok && r.changed); assert.strictEqual(r.before.title, ''); assert.strictEqual(r.after.title, 'Tëst');
    assert.strictEqual(run({op: 'read', path: dsf}).tags.track, '3/12');
  });
  t('tags.py: unveränderte Felder werden übersprungen', function(){
    var r = run({op: 'write', path: dsf, tags: {title: 'Tëst'}});
    assert.ok(r.ok); assert.strictEqual(r.changed, false);
  });
  t('tags.py: leerer Wert löscht das Feld', function(){
    run({op: 'write', path: dsf, tags: {title: ''}});
    assert.strictEqual(run({op: 'read', path: dsf}).tags.title, '');
  });
  t('tags.py: null und Listen werden nicht als Text geschrieben', function(){
    var r = run({op: 'write', path: dsf, tags: {title: null, artist: ['a'], album: true}});
    assert.ok(r.ok); assert.strictEqual(r.changed, false);
    assert.strictEqual(run({op: 'read', path: dsf}).tags.title, '');
  });
  t('tags.py: Kommentar schreiben, lesen und löschen', function(){
    var r = run({op: 'write', path: dsf, tags: {comment: 'Live in Köln\nzweite Zeile'}});
    assert.ok(r.ok && r.changed); assert.strictEqual(r.before.comment, '');
    assert.strictEqual(run({op: 'read', path: dsf}).tags.comment, 'Live in Köln\nzweite Zeile');
    run({op: 'write', path: dsf, tags: {comment: ''}});
    assert.strictEqual(run({op: 'read', path: dsf}).tags.comment, '');
  });
  t('tags.py: nicht unterstützte Endung und fehlende Datei', function(){
    assert.strictEqual(run({op: 'read', path: path.join(root, 'USB', 'notes.txt')}).ok, false);
    assert.strictEqual(run({op: 'read', path: path.join(root, 'USB', 'nix.flac')}).ok, false);
  });

  /* Cover: kleines JPEG (nur Kopf und Füllbytes; mutagen prüft den Inhalt nicht) */
  var jpgA = path.join(root, 'a.jpg'), jpgB = path.join(root, 'b.jpg');
  fs.writeFileSync(jpgA, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]));
  fs.writeFileSync(jpgB, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 2)]));
  var bak = path.join(root, 'bak', 'x');
  t('tags.py: ohne Cover liefert cover_get kein Bild', function(){
    var r = run({op: 'cover_get', path: dsf});
    assert.ok(r.ok); assert.strictEqual(r.data, undefined);
    assert.strictEqual(run({op: 'cover_has', path: dsf}).has, false);
  });
  t('tags.py: Cover einbetten und wieder lesen', function(){
    var r = run({op: 'cover_set', path: dsf, image: jpgA, mime: 'image/jpeg', backup: bak});
    assert.ok(r.ok && r.changed); assert.strictEqual(r.backup, null);
    var g = run({op: 'cover_get', path: dsf});
    assert.strictEqual(g.mime, 'image/jpeg');
    assert.ok(Buffer.from(g.data, 'base64').equals(fs.readFileSync(jpgA)));
    assert.strictEqual(run({op: 'cover_has', path: dsf}).has, true);
  });
  t('tags.py: gleiches Bild ändert nichts', function(){
    assert.strictEqual(run({op: 'cover_set', path: dsf, image: jpgA, backup: bak}).changed, false);
  });
  t('tags.py: Ersetzen sichert das alte Cover, Text-Tags bleiben', function(){
    run({op: 'write', path: dsf, tags: {title: 'Mit Cover'}});
    var r = run({op: 'cover_set', path: dsf, image: jpgB, backup: bak});
    assert.ok(r.changed); assert.strictEqual(r.backup, bak + '.jpg');
    assert.ok(fs.readFileSync(r.backup).equals(fs.readFileSync(jpgA)));
    assert.ok(Buffer.from(run({op: 'cover_get', path: dsf}).data, 'base64').equals(fs.readFileSync(jpgB)));
    assert.strictEqual(run({op: 'read', path: dsf}).tags.title, 'Mit Cover');
  });
  t('tags.py: ohne image wird das Cover entfernt', function(){
    assert.ok(run({op: 'cover_set', path: dsf}).changed);
    assert.strictEqual(run({op: 'cover_get', path: dsf}).data, undefined);
  });
  t('tags.py: mehrere Aufträge in einem Aufruf, ein Fehler stört die anderen nicht', function(){
    var r = run({op: 'batch', jobs: [{op: 'read', path: dsf}, {op: 'read', path: path.join(root, 'USB', 'nix.dsf')}, 'kaputt',
                                     {op: 'write', path: dsf, tags: {genre: 'Stapel'}}]});
    assert.ok(r.ok); assert.strictEqual(r.results.length, 4);
    assert.strictEqual(r.results[0].tags.title, 'Mit Cover');
    assert.strictEqual(r.results[1].ok, false); assert.strictEqual(r.results[2].ok, false);
    assert.ok(r.results[3].changed);
    assert.strictEqual(run({op: 'read', path: dsf}).tags.genre, 'Stapel');
  });

  /* Dienst über HTTP: folder.jpg schreiben, Rückfrage bei vorhandener Datei, Rückgängig */
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
        t('Dienst: Cover einbetten und folder.jpg anlegen', function(){
          assert.ok(r1.ok && r1.batch); assert.ok(fs.existsSync(folderJpg));
          assert.strictEqual(r1.items[0].changed, true);
        });
        post(port, '/cover', {uris: ['USB/t.dsf'], image: fs.readFileSync(jpgB).toString('base64'), folder: true}, function(r2){
          t('Dienst: vorhandene folder.jpg nur mit overwrite', function(){
            assert.strictEqual(r2.ok, false); assert.deepStrictEqual(r2.exists, ['USB']);
          });
          post(port, '/cover', {uris: ['USB/t.dsf'], image: 'kein-jpeg', folder: true}, function(r3){
            t('Dienst: Nicht-JPEG wird abgelehnt', function(){ assert.strictEqual(r3.ok, false); });
            var other = path.join(root, 'fremd.jpg');
            fs.writeFileSync(other, 'nicht überschreiben');
            fs.renameSync(folderJpg, folderJpg + '.echt'); fs.symlinkSync(other, folderJpg);
            post(port, '/cover', {uris: ['USB/t.dsf'], image: fs.readFileSync(jpgB).toString('base64'), folder: true, overwrite: true}, function(r5){
            t('Dienst: folder.jpg als Verweis wird nicht überschrieben', function(){
              assert.strictEqual(r5.folders[0].ok, false);
              assert.strictEqual(fs.readFileSync(other, 'utf8'), 'nicht überschreiben');
            });
            fs.unlinkSync(folderJpg); fs.renameSync(folderJpg + '.echt', folderJpg);
            post(port, '/undo', {batch: r1.batch}, function(r4){
              t('Dienst: Rückgängig entfernt folder.jpg und eingebettetes Cover', function(){
                assert.ok(r4.ok); assert.ok(!fs.existsSync(folderJpg));
                assert.strictEqual(run({op: 'cover_get', path: dsf}).data, undefined);
              });
              var dsf2 = path.join(root, 'USB', 't2.dsf');
              fs.writeFileSync(dsf2, fs.readFileSync(dsf));
              var b = 'stapel1', vorher = run({op: 'read', path: dsf}).tags.artist;
              post(port, '/write', {items: [{uri: 'USB/t.dsf', tags: {artist: 'Neu'}}], batch: b, scan: false}, function(w1){
                post(port, '/write', {items: [{uri: 'USB/t2.dsf', tags: {artist: 'Neu'}}], batch: b, scan: false}, function(w2){
                  t('Dienst: Schreiben in Teilen mit gemeinsamer Kennung', function(){
                    assert.strictEqual(w1.batch, b); assert.strictEqual(w2.batch, b);
                    assert.strictEqual(w1.scan, null);
                    assert.strictEqual(run({op: 'read', path: dsf2}).tags.artist, 'Neu');
                  });
                  post(port, '/write', {items: [{uri: 'USB/t.dsf', tags: {}}], batch: '../x'}, function(w3){
                    t('Dienst: ungültige Kennung wird abgelehnt', function(){ assert.strictEqual(w3.ok, false); });
                    post(port, '/undo', {batch: b}, function(u){
                      t('Dienst: Rückgängig setzt alle Teile zurück', function(){
                        assert.ok(u.ok);
                        assert.notStrictEqual(vorher, 'Neu');
                        assert.strictEqual(run({op: 'read', path: dsf}).tags.artist, vorher);
                        assert.strictEqual(run({op: 'read', path: dsf2}).tags.artist, vorher);
                      });
                      post(port, '/scan', {uris: ['USB/t.dsf', 'USB/t2.dsf']}, function(sc){
                        t('Dienst: /scan liest neu ein', function(){ assert.ok(sc.ok); assert.strictEqual(sc.scan, true); });
                        post(port, '/scan', {hold: true}, function(h1){
                          post(port, '/scan', {uris: ['USB/t.dsf']}, function(){
                            post(port, '/scan', {hold: false}, function(h2){
                              t('Dienst: Scans zurückhalten (Bibliotheks-Check offen) und beim Loslassen einlesen', function(){
                                assert.strictEqual(h1.hold, true);
                                assert.strictEqual(h2.hold, false); assert.ok(h2.pending >= 1);
                              });
                              post(port, '/scan', {all: true}, function(all){
                              t('Dienst: ganze Bibliothek einlesen (Knopf im Bibliotheks-Check)', function(){ assert.ok(all.ok && all.scan); });
                              var ckFile = path.join(root, 'log', 'check.json');
                              fs.mkdirSync(path.dirname(ckFile), {recursive: true});
                              fs.writeFileSync(ckFile, JSON.stringify({at: 1, noCover: []}));
                              post(port, '/checkdone', {key: 'noCover|USB/A'}, function(d1){
                                post(port, '/checkdone', {}, function(d2){
                                  t('Dienst: bearbeitete Check-Einträge bleiben bis zur nächsten Prüfung gemerkt', function(){
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
/* GET /artist?tracks=1 mit einem nachgebauten mpc: alle Suchtreffer mit Titel und Album */
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
        t('Dienst: /artist?tracks=1 liefert Titel und Album', function(){
          assert.ok(r.ok); assert.strictEqual(r.tracks.length, 2);
          assert.deepStrictEqual(r.tracks[0], {file: 'USB/C/01.flac', artist: 'Spliff', albumartist: 'Various Artists', title: 'Carbonara', album: 'NDW Hits'});
          assert.strictEqual(r.tracks[1].artist, 'Spliff feat. Nina');
        });
        s3.close(); done();
      });
    });
  });
}
if (typeof asyncTests === 'function') asyncTests(function(){ console.log(n + ' Prüfungen'); });
else console.log(n + ' Prüfungen');
