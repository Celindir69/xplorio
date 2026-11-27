/* Importing music on the Mac (tags/musicimport.js): copy or move to <music folder>/import, MPD, tag check, rsgain, analysis */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var mi = require('../tags/musicimport.js');

var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }

function setup() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-imp-')), src = path.join(dir, 'Neu', 'Band - Album'), music = path.join(dir, 'musik'), disk = path.join(dir, 'platte');
  fs.mkdirSync(path.join(dir, 'Neu')); fs.mkdirSync(src); fs.mkdirSync(path.join(src, 'CD2'));
  fs.mkdirSync(music); fs.mkdirSync(disk);
  fs.writeFileSync(path.join(src, '01.flac'), 'aaaa'); fs.writeFileSync(path.join(src, 'CD2', '01.flac'), 'bbbbbb');
  fs.writeFileSync(path.join(src, 'cover.jpg'), 'img'); fs.writeFileSync(path.join(src, '.DS_Store'), 'x'); fs.writeFileSync(path.join(src, '._01.flac'), 'x');
  fs.utimesSync(path.join(src, '01.flac'), 1000, 1000);
  fs.symlinkSync(disk, path.join(music, 'USB'));
  var log = [], known = true;
  var mpd = function(cmds, cb){
    log.push(cmds[0]);
    if (/^lsinfo "USB\/import"/.test(cmds[0]) && !known) { known = true; return cb(new Error('ACK [50@0] {lsinfo} No such directory')); }
    if (/^listallinfo/.test(cmds[0])) return cb(null, [['directory: USB/import/Band - Album',
      'file: USB/import/Band - Album/01.flac', 'Artist: Band', 'Album: Album', 'Title: Eins', 'Track: 1', 'Date: 2024',
      'file: USB/import/Band - Album/CD2/01.flac', 'Artist: Band', 'Album: Album', 'Title: Zwei', 'Track: 1']]);
    cb(null, [[]]);
  };
  return {dir: dir, src: src, music: music, disk: disk, mpd: mpd, log: log};
}
function waitEnd(imp, cb) { (function w(){ var j = imp.status().job; if (!j || !j.end) return setTimeout(w, 10); cb(j); })(); }

t('copy: everything but .DS_Store and ._ files, file times kept; MPD reads exactly that folder; tags checked', function(done){
  var x = setup(), imp = new mi.Import({musicRoot: x.music, mpd: x.mpd});
  imp.start({source: x.src, rel: 'USB', target: x.disk, move: false}, function(e){
    assert.strictEqual(e, null);
    imp.start({source: x.src, rel: 'USB', target: x.disk}, function(e2){ assert.strictEqual(e2, 'running'); });
    waitEnd(imp, function(j){
      var dest = path.join(x.disk, 'import', 'Band - Album');
      assert.strictEqual(j.error, ''); assert.strictEqual(j.step, 'done'); assert.deepStrictEqual([j.done, j.total, j.totalBytes], [3, 3, 13]);
      assert.deepStrictEqual(fs.readdirSync(dest).sort(), ['01.flac', 'CD2', 'cover.jpg']);
      assert.strictEqual(fs.statSync(path.join(dest, '01.flac')).mtime.getTime(), 1000000);
      assert.ok(fs.existsSync(x.src));                         /* copied: the source stays */
      assert.deepStrictEqual(x.log, ['lsinfo "USB/import"', 'update "USB/import"', 'status', 'listallinfo "USB/import/Band - Album"',
                                     'listallinfo "USB/import/Band - Album"']);      /* checked again at the end */
      assert.strictEqual(j.check.tracks, 2); assert.strictEqual(j.check.audioFiles, 2);
      assert.deepStrictEqual(j.check.missing, {artist: 0, album: 0, title: 0, track: 0, genre: 2, date: 1});
      assert.deepStrictEqual(j.check.noCover, ['USB/import/Band - Album/CD2']);
      imp.start({source: x.src, rel: 'USB', target: x.disk}, function(e3){ assert.strictEqual(e3, 'exists'); done(); });
    });
  });
});

t('move: on the same drive renamed, the source is gone', function(done){
  var x = setup(), imp = new mi.Import({musicRoot: x.music, mpd: x.mpd});
  imp.start({source: x.src, rel: 'USB', target: x.disk, move: true}, function(e){
    assert.strictEqual(e, null);
    waitEnd(imp, function(j){
      assert.strictEqual(j.error, '');
      assert.ok(!fs.existsSync(x.src));
      assert.ok(fs.existsSync(path.join(x.disk, 'import', 'Band - Album', 'CD2', '01.flac')));
      done();
    });
  });
});

t('then rsgain and the analysis only on the new folder (as the import\'s own runs), MPD reads it again after rsgain', function(done){
  var x = setup(), calls = [];
  var rsgain = {bin: function(){ return '/bin/rsgain'; }, start: function(cb, run){ calls.push(['rsgain', run.dirs, run.walkRoot, run.own]); cb(null); setTimeout(function(){ run.done(2); }, 5); }};
  var analysis = {start: function(cb, run){ calls.push(['analysis', run.roots, run.own]); cb(null); setTimeout(function(){ run.done({done: 2}); }, 5); }};
  var imp = new mi.Import({musicRoot: x.music, mpd: x.mpd, rsgain: rsgain, analysis: analysis});
  imp.start({source: x.src, rel: 'USB', target: x.disk, rsgain: true, analysis: true}, function(){
    waitEnd(imp, function(j){
      var viaMusic = path.join(x.music, 'USB/import/Band - Album');
      assert.deepStrictEqual(calls, [['rsgain', [path.join(x.disk, 'import', 'Band - Album')], viaMusic, true], ['analysis', [viaMusic], true]]);
      assert.deepStrictEqual(j.steps, ['copy', 'scan', 'check', 'rsgain', 'rescan', 'analysis']);
      assert.deepStrictEqual([j.rsgainFiles, j.analysed], [2, 2]);
      assert.strictEqual(x.log.filter(function(c){ return /^update/.test(c); }).length, 2);
      done();
    });
  });
});

t('folders without title, artist or album: recognised; something written: MPD reads it again and the check is redone', function(done){
  var x = setup(), asked = [], lists = 0;
  var mpd = function(cmds, cb){
    if (/^listallinfo/.test(cmds[0]) && !lists++) { x.log.push(cmds[0]); return cb(null, [['file: USB/import/Band - Album/01.flac', 'Artist: Band', 'Album: Album', 'Title: Eins',
      'file: USB/import/Band - Album/CD2/01.flac', 'Track: 1']]); }
    x.mpd(cmds, cb);
  };
  var imp = new mi.Import({musicRoot: x.music, mpd: mpd, recognize: function(dir, files, cb){
    asked.push([dir, files]); setTimeout(function(){ cb({dir: dir, state: 'written', batch: 'abc123'}); }, 5);
  }});
  imp.start({source: x.src, rel: 'USB', target: x.disk}, function(){
    waitEnd(imp, function(j){
      assert.strictEqual(j.error, '');
      assert.deepStrictEqual(asked, [['USB/import/Band - Album/CD2', ['USB/import/Band - Album/CD2/01.flac']]]);
      assert.deepStrictEqual(j.recognized, [{dir: 'USB/import/Band - Album/CD2', state: 'written', batch: 'abc123', files: ['USB/import/Band - Album/CD2/01.flac']}]);
      assert.deepStrictEqual(j.steps, ['copy', 'scan', 'check', 'recognize', 'rescan', 'check']);
      assert.deepStrictEqual(j.check.needTags, []);                 /* the second check sees the new tags */
      done();
    });
  });
});

t('tags still missing: rsgain and the analysis wait; resume() checks again and carries on', function(done){
  var x = setup(), calls = [], lists = 0;
  var mpd = function(cmds, cb){
    if (/^listallinfo/.test(cmds[0]) && lists++ < 2) return cb(null, [['file: USB/import/Band - Album/01.flac', 'Track: 1']]);
    x.mpd(cmds, cb);
  };
  var rsgain = {bin: function(){ return '/bin/rsgain'; }, start: function(cb, run){ calls.push('rsgain'); cb(null); setTimeout(function(){ run.done(0); }, 5); }};
  var analysis = {start: function(cb, run){ calls.push('analysis'); cb(null); setTimeout(function(){ run.done({done: 2}); }, 5); }};
  var imp = new mi.Import({musicRoot: x.music, mpd: mpd, rsgain: rsgain, analysis: analysis,
                           recognize: function(dir, files, cb){ setTimeout(function(){ cb({dir: dir, state: 'none'}); }, 5); }});
  imp.start({source: x.src, rel: 'USB', target: x.disk, rsgain: true, analysis: true}, function(){
    waitEnd(imp, function(j){
      assert.deepStrictEqual([j.step, j.waitTags, calls], ['waitTags', true, []]);
      assert.deepStrictEqual(j.check.needTags.map(function(d){ return d.dir; }), ['USB/import/Band - Album']);
      imp.resume(function(e){
        assert.strictEqual(e, null);
        assert.ok(!j.end);
        waitEnd(imp, function(j2){
          assert.deepStrictEqual([j2.step, j2.waitTags, calls], ['done', false, ['rsgain', 'analysis']]);
          assert.deepStrictEqual(j2.steps.slice(-6), ['recognize', 'waitTags', 'rescan', 'check', 'rsgain', 'analysis']);
          imp.resume(function(e2){ assert.strictEqual(e2, 'nothing'); done(); });
        });
      });
    });
  });
});

t('refused: missing source, missing target, target inside the source', function(done){
  var x = setup(), imp = new mi.Import({musicRoot: x.music, mpd: x.mpd});
  imp.start({source: path.join(x.dir, 'gibt-es-nicht'), rel: 'USB', target: x.disk}, function(e){
    assert.strictEqual(e, 'source');
    imp.start({source: x.src, rel: 'USB', target: path.join(x.dir, 'fehlt')}, function(e2){
      assert.strictEqual(e2, 'target');
      imp.start({source: x.dir, rel: 'USB', target: x.disk}, function(e3){ assert.strictEqual(e3, 'inside'); done(); });
    });
  });
});

t('resume after editing tags: MPD reads them first, and the result shows the tags as they are at the end (genre)', function(done){
  var x = setup(), updated = false, edited = false;
  var mpd = function(cmds, cb){
    if (/^update/.test(cmds[0]) && edited) updated = true;
    if (/^listallinfo/.test(cmds[0])) {
      if (!updated) return cb(null, [['file: USB/import/Band - Album/01.flac', 'Track: 1']]);     /* MPD still has the old tags */
      return cb(null, [['file: USB/import/Band - Album/01.flac', 'Artist: Band', 'Album: Album', 'Title: Eins', 'Track: 1', 'Date: 2024', 'Genre: Rock']]);
    }
    x.mpd(cmds, cb);
  };
  var analysis = {start: function(cb, run){ cb(null); setTimeout(function(){ run.done({done: 1}); }, 5); }};
  var imp = new mi.Import({musicRoot: x.music, mpd: mpd, analysis: analysis,
                           recognize: function(dir, files, cb){ setTimeout(function(){ cb({dir: dir, state: 'none'}); }, 5); }});
  imp.start({source: x.src, rel: 'USB', target: x.disk, analysis: true}, function(){
    waitEnd(imp, function(j){
      assert.strictEqual(j.step, 'waitTags');
      edited = true;                                                 /* tags written in the tag editor */
      imp.resume(function(){
        waitEnd(imp, function(j2){
          assert.strictEqual(j2.step, 'done');
          assert.strictEqual(j2.check.missing.genre, 0);
          assert.deepStrictEqual(j2.check.needTags, []);
          done();
        });
      });
    });
  });
});

/* Madonna/Music imported earlier, now Madonna with American Pie: added to import/Madonna */
function artist(x, albums) {
  var src = path.join(x.dir, 'Neu', 'Madonna'), old = path.join(x.disk, 'import', 'Madonna', 'Music');
  fs.mkdirSync(src); fs.writeFileSync(path.join(src, 'artist.jpg'), 'img'); fs.writeFileSync(path.join(src, '.DS_Store'), 'x');
  albums.forEach(function(a){ fs.mkdirSync(path.join(src, a)); fs.writeFileSync(path.join(src, a, '01.flac'), 'cccc'); });
  fs.mkdirSync(path.join(x.disk, 'import')); fs.mkdirSync(path.dirname(old)); fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, '01.flac'), 'alt');
  return {src: src, dest: path.dirname(old), old: old};
}
function artistMpd(x) {
  return function(cmds, cb){
    x.log.push(cmds[0]);
    if (cmds[0] === 'listallinfo "USB/import/Madonna/American Pie"') return cb(null, [['directory: USB/import/Madonna/American Pie',
      'file: USB/import/Madonna/American Pie/01.flac', 'Artist: Madonna', 'Album: American Pie', 'Title: American Pie', 'Track: 1']]);
    if (/^listallinfo/.test(cmds[0])) return cb(new Error('ACK [50@0] {listallinfo} No such directory'));
    cb(null, [[]]);
  };
}

t('artist folder already there: only the new album is added, and only it is checked, tagged and analysed', function(done){
  var x = setup(), a = artist(x, ['American Pie']), calls = [];
  var rsgain = {bin: function(){ return '/bin/rsgain'; }, start: function(cb, run){ calls.push(['rsgain', run.dirs]); cb(null); setTimeout(function(){ run.done(1); }, 5); }};
  var analysis = {start: function(cb, run){ calls.push(['analysis', run.roots]); cb(null); setTimeout(function(){ run.done({done: 1}); }, 5); }};
  var imp = new mi.Import({musicRoot: x.music, mpd: artistMpd(x), rsgain: rsgain, analysis: analysis});
  imp.start({source: a.src, rel: 'USB', target: x.disk, rsgain: true, analysis: true}, function(e){
    assert.strictEqual(e, null);
    waitEnd(imp, function(j){
      assert.strictEqual(j.error, '');
      assert.deepStrictEqual(j.parts, ['American Pie', 'artist.jpg']);
      assert.deepStrictEqual(fs.readdirSync(a.dest).sort(), ['American Pie', 'Music', 'artist.jpg']);
      assert.strictEqual(fs.readFileSync(path.join(a.old, '01.flac'), 'utf8'), 'alt');        /* the earlier album untouched */
      assert.ok(fs.existsSync(a.src));
      assert.deepStrictEqual([j.done, j.total], [2, 2]);
      assert.deepStrictEqual(calls, [['rsgain', [path.join(a.dest, 'American Pie')]],
                                     ['analysis', [path.join(x.music, 'USB/import/Madonna/American Pie')]]]);
      assert.ok(x.log.every(function(c){ return !/^listallinfo/.test(c) || c === 'listallinfo "USB/import/Madonna/American Pie"'; }));
      assert.deepStrictEqual([j.check.tracks, j.check.audioFiles], [1, 1]);
      assert.deepStrictEqual(j.check.noCover, ['USB/import/Madonna/American Pie']);
      done();
    });
  });
});

t('artist folder already there, moved on the same drive: the new album moves in, the source is gone', function(done){
  var x = setup(), a = artist(x, ['American Pie', 'Ray of Light']), imp = new mi.Import({musicRoot: x.music, mpd: artistMpd(x)});
  imp.start({source: a.src, rel: 'USB', target: x.disk, move: true}, function(e){
    assert.strictEqual(e, null);
    waitEnd(imp, function(j){
      assert.strictEqual(j.error, '');
      assert.ok(!fs.existsSync(a.src));
      assert.deepStrictEqual(fs.readdirSync(a.dest).sort(), ['American Pie', 'Music', 'Ray of Light', 'artist.jpg']);
      assert.strictEqual(fs.readFileSync(path.join(a.old, '01.flac'), 'utf8'), 'alt');
      done();
    });
  });
});

t('refused with what is there: an album folder that exists already, an album imported again', function(done){
  var x = setup(), a = artist(x, ['American Pie', 'Music']), imp = new mi.Import({musicRoot: x.music, mpd: x.mpd});
  imp.start({source: a.src, rel: 'USB', target: x.disk}, function(e){
    assert.strictEqual(e, 'exists'); assert.strictEqual(imp.conflict(), 'Madonna/Music');
    assert.ok(!fs.existsSync(path.join(a.dest, 'American Pie')));                              /* nothing copied */
    fs.mkdirSync(path.join(x.disk, 'import', 'Band - Album'));                                 /* an album: never merged */
    imp.start({source: x.src, rel: 'USB', target: x.disk}, function(e2){
      assert.strictEqual(e2, 'exists'); assert.strictEqual(imp.conflict(), 'Band - Album');
      assert.deepStrictEqual(fs.readdirSync(path.join(x.disk, 'import', 'Band - Album')), []);
      done();
    });
  });
});

t('tag editor after the import: the albums one after another, CD1, CD2 … of one album together', function(done){
  var src = fs.readFileSync(path.join(__dirname, '../web/js/macsettings.js'), 'utf8');
  var m = /\nfunction msImpEditorGroups[\s\S]*?\n}\n/.exec(src), ed = fs.readFileSync(path.join(__dirname, '../web/js/tagedit.js'), 'utf8');
  var disc = Function('return ' + /var TAG_DISC_RE = (\/.*\/i);/.exec(ed)[1])();
  var groups = Function(m[0] + 'return msImpEditorGroups;')();
  var g = groups([{dir: 'USB/import/Madonna/American Pie', files: ['a1', 'a2']},
                  {dir: 'USB/import/Madonna/Eroica/CD1', files: ['e1']}, {dir: 'USB/import/Madonna/Eroica/CD2', files: ['e2']},
                  {dir: 'USB/import/Madonna/Music', files: ['m1']}], disc);
  assert.deepStrictEqual(g, [{dir: 'USB/import/Madonna/American Pie', name: 'American Pie', files: ['a1', 'a2'], disc: false},
                             {dir: 'USB/import/Madonna/Eroica/CD1', name: 'Eroica', files: ['e1', 'e2'], disc: true},
                             {dir: 'USB/import/Madonna/Music', name: 'Music', files: ['m1'], disc: false}]);
  assert.deepStrictEqual(groups([], disc), []);
  done();
});

(function run(i){
  if (i >= queue.length) { console.log(n + ' tests passed'); return; }
  queue[i][1](function(){ n++; console.log('ok   ' + queue[i][0]); run(i + 1); });
})(0);
