/* ReplayGain tags on the Mac (tags/rsgainrun.js): listing files, carrying the analysis along, the run itself */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var EventEmitter = require('events');
var rg = require('../tags/rsgainrun.js');

var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }

function tree() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-rg-')), music = path.join(dir, 'musik'), real = path.join(dir, 'platte');
  fs.mkdirSync(music); fs.mkdirSync(real); fs.mkdirSync(path.join(real, 'Album')); fs.mkdirSync(path.join(real, 'Xplorio Trash'));
  fs.mkdirSync(path.join(real, '.versteckt'));
  fs.writeFileSync(path.join(real, 'Album', '01.flac'), 'aaaa');
  fs.writeFileSync(path.join(real, 'Album', '02.flac'), 'bbbb');
  fs.writeFileSync(path.join(real, 'Album', 'cover.jpg'), 'x');
  fs.writeFileSync(path.join(real, 'Album', '._01.flac'), 'x');
  fs.writeFileSync(path.join(real, 'Xplorio Trash', 'alt.flac'), 'x');
  fs.writeFileSync(path.join(real, '.versteckt', 'x.flac'), 'x');
  fs.symlinkSync(real, path.join(music, 'USB'));
  return {dir: dir, music: music, real: real, f1: path.join(music, 'USB', 'Album', '01.flac'), f2: path.join(music, 'USB', 'Album', '02.flac')};
}
function setTime(f, s) { fs.utimesSync(f, s, s); }

t('files are listed like analyse.py does: through links, without hidden folders, the trash, ._ files and non-audio', function(done){
  var x = tree();
  setTime(x.f1, 1000); setTime(x.f2, 2000);
  rg.walk(x.music, function(list){
    assert.deepStrictEqual(Object.keys(list).sort(), [x.f1, x.f2]);
    assert.deepStrictEqual(list[x.f1], [4, 1000]);
    done();
  });
});

t('analysis carried along: only changed files whose entry fits the old state; the last line counts', function(done){
  var x = tree(), ess = path.join(x.dir, 'essentia.jsonl');
  fs.writeFileSync(ess, [JSON.stringify({p: x.f1, sz: 4, mt: 1000, bpm: 120}), JSON.stringify({p: x.f2, sz: 9, mt: 5, bpm: 90}),
                         JSON.stringify({p: '/anders.flac', sz: 1, mt: 1})].join('\n') + '\n');
  var before = {}, after = {};
  before[x.f1] = [4, 1000]; after[x.f1] = [4100, 3000];       /* tagged, entry fits */
  before[x.f2] = [4, 2000]; after[x.f2] = [4200, 3000];       /* tagged, but the entry is from an older state */
  assert.strictEqual(rg.carryAlong(ess, before, after), 1);
  var lines = fs.readFileSync(ess, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(lines.length, 4);
  assert.deepStrictEqual(lines[3], {p: x.f1, sz: 4100, mt: 3000, bpm: 120});
  assert.strictEqual(rg.carryAlong(ess, after, after), 0);   /* nothing changed */
  done();
});

t('a run: list, rsgain per folder with nice, list again, carry along, done; stop and errors', function(done){
  var x = tree(), ess = path.join(x.dir, 'essentia.jsonl'), spawned = [], ended = [];
  setTime(x.f1, 1000); setTime(x.f2, 2000);
  fs.writeFileSync(ess, JSON.stringify({p: x.f1, sz: 4, mt: 1000, bpm: 120}) + '\n');
  fs.writeFileSync(path.join(x.dir, 'rsgain'), '');
  var r = new rg.Runner({dirs: function(){ return [x.real, '/gibt/es/nicht']; }, walkRoot: function(){ return x.music; },
    essentia: function(){ return ess; }, stateFile: path.join(x.dir, 'state.json'), bins: [path.join(x.dir, 'rsgain')],
    spawn: function(bin, args){
      var ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 99;
      spawned.push([bin, args]);
      setTimeout(function(){
        fs.writeFileSync(x.f1, 'aaaa+tags'); setTime(x.f1, 3000);      /* rsgain writes its tags */
        ch.stdout.emit('data', 'Scanning directory ' + args[args.length - 1] + '\n');
        ch.emit('close', 0);
      }, 20);
      return ch;
    },
    onDone: function(files){ ended.push(files); }});
  r.start(function(e){
    assert.strictEqual(e, null);
    assert.strictEqual(r.status().running, true);
    r.start(function(e2){ assert.strictEqual(e2, 'running'); });
    (function wait(){
      if (!ended.length) return setTimeout(wait, 10);
      assert.deepStrictEqual(spawned, [['nice', ['-n', '15', path.join(x.dir, 'rsgain'), 'easy', '-S', '-m', 'MAX', x.real]]]);
      var st = r.status();
      assert.strictEqual(st.running, false); assert.strictEqual(st.lastFiles, 1); assert.strictEqual(st.lastCarried, 1);
      assert.deepStrictEqual(ended, [1]);
      var last = fs.readFileSync(ess, 'utf8').trim().split('\n').map(JSON.parse).pop();
      assert.deepStrictEqual([last.sz, last.mt, last.bpm], [9, 3000, 120]);
      var none = new rg.Runner({dirs: function(){ return [x.real]; }, walkRoot: function(){ return x.music; }, stateFile: path.join(x.dir, 's2.json'), bins: ['/gibt/es/nicht']});
      none.start(function(e3){
        assert.strictEqual(e3, 'rsgain');
        var busy = new rg.Runner({dirs: function(){ return [x.real]; }, walkRoot: function(){ return x.music; }, stateFile: path.join(x.dir, 's3.json'),
          bins: [path.join(x.dir, 'rsgain')], busy: function(){ return true; }});
        busy.start(function(e4){ assert.strictEqual(e4, 'busy'); done(); });
      });
    })();
  });
});

t('at night: 2 o\'clock, once a day, not while the analysis runs', function(done){
  var x = tree(), now = new Date(2026, 10, 16, 2, 10).getTime(), isBusy = true;
  var r = new rg.Runner({dirs: function(){ return []; }, walkRoot: function(){ return x.music; }, stateFile: path.join(x.dir, 'n.json'),
    bins: ['/gibt/es/nicht'], now: function(){ return now; }, busy: function(){ return isBusy; }});
  assert.strictEqual(r.tick(), false);                     /* off */
  r.setNightly(true);
  assert.strictEqual(r.tick(), false);                     /* analysis running */
  isBusy = false;
  assert.strictEqual(r.tick(), true);
  assert.strictEqual(r.tick(), false);                     /* already today */
  done();
});

(function run(i){
  if (i >= queue.length) { console.log(n + ' tests passed'); return; }
  queue[i][1](function(){ n++; console.log('ok   ' + queue[i][0]); run(i + 1); });
})(0);
