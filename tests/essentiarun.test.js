/* Audio analysis on the Mac (tags/essentiarun.js): finding Python, starting analyse.py, progress, stopping, at night */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var EventEmitter = require('events');
var er = require('../tags/essentiarun.js');

var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }

function make(extra) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-ess-')), log = [], spawned = [], now = {v: Date.UTC(2026, 10, 15, 12)};
  fs.writeFileSync(path.join(dir, 'analyse.py'), '# test\n');
  fs.mkdirSync(path.join(dir, 'musik'));
  var o = {script: path.join(dir, 'analyse.py'), out: function(){ return path.join(dir, 'essentia.jsonl'); },
    roots: function(){ return [path.join(dir, 'musik'), path.join(dir, 'fehlt')]; }, stateFile: path.join(dir, 'run.json'),
    pythons: ['/a/python3.11', '/b/python3'],
    execFile: function(p, args, opts, cb){ log.push('check ' + p + ' ' + (opts.env.DYLD_FALLBACK_LIBRARY_PATH.indexOf('/opt/local/lib') === 0)); cb(p === '/b/python3' ? null : new Error('no')); },
    spawn: function(bin, args, opts){
      var ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 4711;
      ch.kill = function(sig){ log.push('kill ' + sig); };
      spawned.push({bin: bin, args: args, opts: opts, ch: ch});
      return ch;
    },
    now: function(){ return now.v; }, log: function(){}, onDone: function(){ log.push('done'); }};
  Object.keys(extra || {}).forEach(function(k){ o[k] = extra[k]; });
  return {r: new er.Runner(o), log: log, spawned: spawned, now: now, dir: dir};
}

t('progress lines of analyse.py', function(done){
  var p = {};
  er.parseLine('1200 audio files found, 300 to analyse (1 processes).', p);
  assert.deepStrictEqual(p, {found: 1200, total: 300, done: 0});
  er.parseLine('  25/300  (10.5 s per file, about 48 min left, 1 errors, 0 skipped)', p);
  assert.deepStrictEqual([p.done, p.total, p.perFile, p.minutesLeft, p.errors], [25, 300, 10.5, 48, 1]);
  er.parseLine('Done: 1200 entries in /x/essentia.jsonl, 300 of them analysed.', p);
  assert.strictEqual(p.finished, true); assert.strictEqual(p.entries, 1200);
  done();
});

t('Python: the first that can import Essentia, with the MacPorts library path; not the one in /usr/bin', function(done){
  var m = make();
  m.r.status(function(st){
    assert.strictEqual(st.python, '/b/python3'); assert.strictEqual(st.script, true); assert.strictEqual(st.running, false);
    assert.deepStrictEqual(m.log, ['check /a/python3.11 true', 'check /b/python3 true']);
    m.r.status(function(){
      assert.strictEqual(m.log.length, 2);                /* remembered */
      var found = er.findPythons('/usr/bin:/opt/local/bin:/bin', function(f){ return /python3(\.11)?$/.test(f); });
      assert.deepStrictEqual(found, ['/opt/local/bin/python3.11', '/opt/local/bin/python3']);
      done();
    });
  });
});

t('start: nice, the script, the result file, only existing music folders; progress; end -> state saved', function(done){
  var m = make();
  m.r.start(function(e){
    assert.strictEqual(e, null);
    var s = m.spawned[0];
    assert.strictEqual(s.bin, 'nice');
    assert.deepStrictEqual(s.args, ['-n', '15', '/b/python3', path.join(m.dir, 'analyse.py'), '--out', path.join(m.dir, 'essentia.jsonl'), path.join(m.dir, 'musik')]);
    assert.strictEqual(s.opts.detached, true);
    m.r.start(function(e2){
      assert.strictEqual(e2, 'running');
      s.ch.stdout.emit('data', '10 audio files found, 4 to analyse (1 processes).\n  4/4  (10.5 s per');
      s.ch.stdout.emit('data', ' file, about 0 min left, 0 errors, 0 skipped)\r\nDone: 10 entries in x, 4 of them analysed.\n');
      m.r.status(function(st){
        assert.strictEqual(st.running, true); assert.strictEqual(st.progress.done, 4);
        m.now.v += 60000;
        s.ch.emit('close', 0);
        m.r.status(function(st2){
          assert.strictEqual(st2.running, false); assert.strictEqual(st2.lastAnalysed, 4); assert.strictEqual(st2.lastError, '');
          assert.ok(m.log.indexOf('done') >= 0);
          var saved = JSON.parse(fs.readFileSync(path.join(m.dir, 'run.json'), 'utf8'));
          assert.strictEqual(saved.lastEnd, m.now.v);
          done();
        });
      });
    });
  });
});

t('errors: no Python, no script, no music folder', function(done){
  var m = make({execFile: function(p, a, o, cb){ cb(new Error('no')); }});
  m.r.start(function(e){
    assert.strictEqual(e, 'python');
    var m2 = make({roots: function(){ return ['/gibt/es/nicht']; }});
    m2.r.start(function(e2){
      assert.strictEqual(e2, 'roots');
      var m3 = make({script: '/gibt/es/nicht.py'});
      m3.r.start(function(e3){ assert.strictEqual(e3, 'script'); assert.strictEqual(m3.spawned.length, 0); done(); });
    });
  });
});

t('stop: Ctrl-C for the process group, not counted as an error; an unexpected end is', function(done){
  var m = make(), killed = [];
  var orig = process.kill;
  process.kill = function(pid, sig){ killed.push([pid, sig]); };
  m.r.start(function(){
    assert.strictEqual(m.r.stop(), true);
    process.kill = orig;
    assert.deepStrictEqual(killed, [[-4711, 'SIGINT']]);
    m.spawned[0].ch.emit('close', 1);
    assert.strictEqual(m.r.s.lastError, '');
    m.r.start(function(){
      m.spawned[1].ch.emit('close', 1);
      assert.strictEqual(m.r.s.lastError, 'exit 1');
      done();
    });
  });
});

t('at night: only when switched on, at 3 o\'clock, once a day', function(done){
  var m = make();
  m.now.v = new Date(2026, 10, 15, 3, 5).getTime();
  assert.strictEqual(m.r.tick(), false);
  m.r.setNightly(true);
  m.now.v = new Date(2026, 10, 15, 2, 55).getTime();
  assert.strictEqual(m.r.tick(), false);
  m.now.v = new Date(2026, 10, 15, 3, 5).getTime();
  assert.strictEqual(m.r.tick(), true);
  setTimeout(function(){
    assert.strictEqual(m.spawned.length, 1);
    m.spawned[0].ch.emit('close', 0);
    m.now.v = new Date(2026, 10, 15, 3, 50).getTime();
    assert.strictEqual(m.r.tick(), false);             /* already today */
    m.now.v = new Date(2026, 10, 16, 3, 0).getTime();
    assert.strictEqual(m.r.tick(), true);
    var again = new er.Runner({stateFile: m.r.o.stateFile});
    assert.strictEqual(again.s.nightly, true);           /* kept */
    done();
  }, 20);
});

t('crashes and errors of the analysis also go to tags.log, progress lines do not', function(done){
  var logged = [], m = make({log: function(x){ logged.push(x); }});
  m.r.start(function(){
    var ch = m.spawned[0].ch;
    ch.stdout.emit('data', '  3/10  (2.0 s per file, about 0 min left, 0 errors, 0 skipped)\n  Worker process crashed, continuing \u2026\n');
    ch.stderr.emit('data', '  Error: USB/A/01.flac: analysis crashed (file damaged or too large?)\n');
    var mine = logged.filter(function(x){ return /^Analysis: /.test(x); });
    assert.deepStrictEqual(mine, ['Analysis: Worker process crashed, continuing \u2026', 'Analysis: Error: USB/A/01.flac: analysis crashed (file damaged or too large?)']);
    ch.emit('close', 0);
    done();
  });
});

(function run(i){
  if (i >= queue.length) { console.log(n + ' tests passed'); return; }
  queue[i][1](function(){ n++; console.log('ok   ' + queue[i][0]); run(i + 1); });
})(0);
