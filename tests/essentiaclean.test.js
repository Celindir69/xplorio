/* clean up the audio analysis (tags/essentiaclean.js): duplicates, deleted files, old paths, disconnected drives */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var ec = require('../tags/essentiaclean.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'essclean-')));
var music = path.join(dir, 'music'), usb = path.join(music, 'USB'), drive = path.join(dir, 'Platte'), old = path.join(dir, 'Alt');
[music, usb, drive, path.join(drive, 'A'), old, path.join(old, 'A')].forEach(function(d){ fs.mkdirSync(d); });
fs.symlinkSync(drive, path.join(usb, 'Platte'));                 /* music folder as a link, like on the Mac */
fs.symlinkSync(path.join(dir, 'Weg'), path.join(usb, 'Weg'));   /* drive not connected: dangling link */
['1.flac', '2.flac'].forEach(function(f){ fs.writeFileSync(path.join(drive, 'A', f), ''); });
fs.writeFileSync(path.join(old, 'A', 'nur-hier.flac'), '');
fs.writeFileSync(path.join(old, 'A', '1.flac'), '');
function e(p, ar, ti, x) { var o = {v: 3, p: p, ar: ar, ti: ti, bpm: 100}; if (x) Object.keys(x).forEach(function(k){ o[k] = x[k]; }); return JSON.stringify(o); }
var file = path.join(dir, 'essentia.jsonl');
var lines = [
  e(path.join(usb, 'Platte/A/1.flac'), 'Anna', 'Eins', {bpm: 90}),     /* older line of the same file */
  e(path.join(usb, 'Platte/A/1.flac'), 'Anna', 'Eins'),
  e(path.join(usb, 'Platte/A/2.flac'), 'Anna', 'Zwei'),
  e(path.join(usb, 'Platte/A/3.flac'), 'Anna', 'Drei'),               /* deleted */
  e(path.join(old, 'A/1.flac'), 'Anna', 'Eins'),                      /* old path, analysed inside as well */
  e(path.join(old, 'A/nur-hier.flac'), 'Bert', 'Nur hier'),           /* outside, nothing else knows it */
  e(path.join(old, 'B/weg.flac'), 'Bert', 'Weg'),                     /* old path, gone */
  e(path.join(usb, 'Weg/X/1.flac'), 'Carl', 'Eins'),                  /* drive not connected */
  e('/Volumes/GibtsNicht/X/1.flac', 'Dora', 'Eins'),                  /* volume not mounted */
  '{kaputt'
];
fs.writeFileSync(file, lines.join('\n') + '\n');
var opts = {file: file, inside: [music, drive], bases: [music, usb]};
ec.clean({file: file, inside: opts.inside, bases: opts.bases, dry: true}, function(err, r){
  t('count only: what would go and why', function(){
    assert.ifError(err);
    assert.deepStrictEqual(r.drop, {dup: 1, missing: 2, outside: 1, broken: 1});
    assert.strictEqual(r.removed, 5); assert.strictEqual(r.keep, 5); assert.strictEqual(r.offline, 2); assert.strictEqual(r.total, 10);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), lines.join('\n') + '\n');
    assert.ok(!fs.existsSync(file + '.bak'));
  });
  ec.clean(opts, function(err2, r2){
    t('clean: backup, kept lines in order, the last line of a path', function(){
      assert.ifError(err2); assert.ok(r2.cleaned);
      assert.strictEqual(fs.readFileSync(file + '.bak', 'utf8'), lines.join('\n') + '\n');
      var kept = fs.readFileSync(file, 'utf8').trim().split('\n').map(function(l){ return JSON.parse(l); });
      assert.deepStrictEqual(kept.map(function(o){ return o.ti; }), ['Eins', 'Zwei', 'Nur hier', 'Eins', 'Eins']);
      assert.strictEqual(kept[0].bpm, 100);
    });
    ec.clean(opts, function(err3, r3){
      t('second time: nothing to do, no new backup', function(){ assert.ifError(err3); assert.strictEqual(r3.removed, 0); assert.ok(!r3.cleaned); });
      console.log(n + ' checks passed');
    });
  });
});
