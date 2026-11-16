/* Audio analysis on this Mac (Xplorio.app, settings page "Audio analysis"): runs tools/essentia/analyse.py over the
   music folder and writes straight into the result file the tag service reads (essentia.jsonl, also when it is a link
   to a file elsewhere). Only new or changed tracks are analysed; a stopped run continues next time.
   Needs Python with Essentia (pip install essentia-tensorflow mutagen); on old Macs with MacPorts the Essentia package
   finds its libraries only with DYLD_FALLBACK_LIBRARY_PATH (set here). Runs with low priority (nice), so playback
   keeps the processor first. Optionally every night (03:00, once a day).
   Node 8, ES5 only.
   opts: script (analyse.py), out() -> result file, roots() -> [music folders], stateFile, spawn, execFile, now(),
         pythons ([candidates]), busy() (ReplayGain running), log(text), onDone() */
var fs = require('fs'), cp = require('child_process');

var CHECK_MS = 10 * 60 * 1000;            /* "no Python with Essentia" is remembered this long */
var NIGHT_HOUR = 3;
var TAIL = 40;

function libPath() { return ['/opt/local/lib', '/usr/local/lib', '/opt/homebrew/lib'].join(':'); }

/* Pythons on PATH, as full paths; not the one in /usr/bin (on a Mac without the developer tools it opens an
   "install the tools" dialog, and it never has Essentia) */
var NAMES = ['python3.11', 'python3.12', 'python3.13', 'python3.14', 'python3.10', 'python3'];
function findPythons(pathVar, exists) {
  var dirs = String(pathVar || '').split(':').filter(function(d){ return d && d !== '/usr/bin' && d !== '/bin'; }), out = [];
  NAMES.forEach(function(n){ dirs.forEach(function(d){ var f = d.replace(/\/$/, '') + '/' + n; if (out.indexOf(f) < 0 && exists(f)) out.push(f); }); });
  return out;
}

/* one line of analyse.py -> what the page shows */
function parseLine(l, p) {
  var m;
  if ((m = /^(\d+) audio files found, (\d+) to analyse/.exec(l))) { p.found = +m[1]; p.total = +m[2]; p.done = 0; }
  else if ((m = /^\s*(\d+)\/(\d+)\s+\(([\d.]+) s per file, about (\d+) min left, (\d+) errors/.exec(l))) {
    p.done = +m[1]; p.total = +m[2]; p.perFile = +m[3]; p.minutesLeft = +m[4]; p.errors = +m[5];
  }
  else if ((m = /^Done: (\d+) entries in .*, (\d+) of them analysed/.exec(l))) { p.entries = +m[1]; p.finished = true; }
  else if (/^Loading model /.test(l)) p.models = true;
  return p;
}

function Runner(o) {
  this.o = o;
  this.spawn = o.spawn || cp.spawn;
  this.execFile = o.execFile || cp.execFile;
  this.now = o.now || Date.now;
  this.child = null; this.progress = null; this.tail = [];
  this.py = null; this.pyAt = 0; this.checking = null;
  this.s = {nightly: false, lastStart: 0, lastEnd: 0, lastAnalysed: 0, lastError: '', lastNight: '', perFile: 0};
  try { var d = JSON.parse(fs.readFileSync(o.stateFile, 'utf8')); Object.keys(this.s).forEach(function(k){ if (d[k] !== undefined) this.s[k] = d[k]; }, this); }
  catch (e) { /* first start */ }
}

Runner.prototype.save = function() {
  try { fs.writeFileSync(this.o.stateFile + '.neu', JSON.stringify(this.s)); fs.renameSync(this.o.stateFile + '.neu', this.o.stateFile); }
  catch (e) { this.log('Analysis: state not saved: ' + e.message); }
};
Runner.prototype.log = function(t) { if (this.o.log) this.o.log(t); };
Runner.prototype.env = function() {
  var env = {};
  Object.keys(process.env).forEach(function(k){ env[k] = process.env[k]; });
  env.DYLD_FALLBACK_LIBRARY_PATH = libPath() + (env.DYLD_FALLBACK_LIBRARY_PATH ? ':' + env.DYLD_FALLBACK_LIBRARY_PATH : '');
  env.PYTHONUNBUFFERED = '1';
  return env;
};

/* the first Python that can import Essentia -> cb(path or '') (remembered for a while; force: look again) */
Runner.prototype.python = function(force, cb) {
  var self = this;
  if (!force && this.pyAt && (this.py || this.now() - this.pyAt < CHECK_MS)) return cb(this.py || '');   /* a found one stays */
  if (this.checking) return this.checking.push(cb);
  this.checking = [cb];
  var list = (this.o.pythons || findPythons(process.env.PATH, fs.existsSync)).slice();
  if (process.env.XPLORIO_PYTHON) list.unshift(process.env.XPLORIO_PYTHON);
  (function next(){
    var p = list.shift();
    if (!p) return finish('');
    self.execFile(p, ['-c', 'import essentia.standard'], {timeout: 60000, env: self.env()}, function(e){ if (e) next(); else finish(p); });
  })();
  function finish(p) {
    self.py = p; self.pyAt = self.now();
    var cbs = self.checking; self.checking = null;
    cbs.forEach(function(f){ f(p); });
  }
};

/* {ok, python, running, progress, tail, nightly, last…} */
Runner.prototype.status = function(cb, force) {
  var self = this, s = this.s;
  this.python(!!force, function(py){
    cb({ok: true, python: py, script: fs.existsSync(self.o.script), running: !!self.child, progress: self.progress,
        tail: self.tail.slice(-8), nightly: s.nightly, lastStart: s.lastStart, lastEnd: s.lastEnd,
        lastAnalysed: s.lastAnalysed, lastError: s.lastError, perFile: s.perFile});
  });
};

/* start a run -> cb(error code or null) */
Runner.prototype.start = function(cb) {
  var self = this;
  if (this.child) return cb('running');
  if (!fs.existsSync(this.o.script)) return cb('script');
  if (this.o.busy && this.o.busy()) return cb('busy');        /* ReplayGain tags are being written */
  this.python(false, function(py){
    if (!py) return cb('python');
    if (self.child) return cb('running');
    var out = self.o.out(), roots = self.o.roots().filter(function(r){ return fs.existsSync(r); });
    if (!roots.length) return cb('roots');
    var args = ['-n', '15', py, self.o.script, '--out', out].concat(roots);
    var ch;
    try { ch = self.spawn('nice', args, {env: self.env(), detached: true, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch (e) { return cb('start'); }
    self.child = ch; self.progress = {done: 0, total: 0}; self.tail = [];
    self.s.lastStart = self.now(); self.s.lastError = ''; self.save();
    self.log('Analysis started: ' + roots.join(', ') + ' -> ' + out);
    var buf = '';
    function onData(d) {
      buf += String(d);
      var parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      parts.forEach(function(l){
        if (!l.trim()) return;
        self.tail.push(l); if (self.tail.length > TAIL) self.tail.shift();
        parseLine(l, self.progress);
      });
    }
    if (ch.stdout) ch.stdout.on('data', onData);
    if (ch.stderr) ch.stderr.on('data', onData);
    ch.on('error', function(e){ self.s.lastError = 'start'; self.log('Analysis: ' + e.message); });
    ch.on('close', function(code){
      if (self.child !== ch) return;
      var p = self.progress || {};
      self.child = null;
      self.s.lastEnd = self.now();
      self.s.lastAnalysed = p.done || 0;
      if (p.perFile) self.s.perFile = p.perFile;                /* for the estimate before the next run's first progress */
      if (!p.finished && !self.stopping) self.s.lastError = self.s.lastError || ('exit ' + code);
      self.stopping = false;
      self.save();
      self.log('Analysis ended (' + code + '): ' + (p.done || 0) + ' of ' + (p.total || 0) + ' analysed');
      if (self.o.onDone) self.o.onDone();
    });
    cb(null);
  });
};

/* like Ctrl-C for the whole process group: analyse.py keeps what it has and continues there next time */
Runner.prototype.stop = function() {
  if (!this.child) return false;
  this.stopping = true;
  try { process.kill(-this.child.pid, 'SIGINT'); } catch (e) { try { this.child.kill('SIGINT'); } catch (e2) { /* gone */ } }
  return true;
};
Runner.prototype.kill = function() {
  if (!this.child) return;
  try { process.kill(-this.child.pid, 'SIGTERM'); } catch (e) { /* gone */ }
};

Runner.prototype.setNightly = function(on) { this.s.nightly = !!on; this.save(); };

/* every few minutes: at night (from 03:00, at the latest 05:59 when ReplayGain runs longer), once a day */
Runner.prototype.tick = function() {
  var d = new Date(this.now()), day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  if (!this.s.nightly || this.child || d.getHours() < NIGHT_HOUR || d.getHours() > NIGHT_HOUR + 2 || this.s.lastNight === day) return false;
  if (this.o.busy && this.o.busy()) return false;             /* ReplayGain still running: try again until 05:59 */
  this.s.lastNight = day; this.save();
  var self = this;
  this.start(function(e){ if (e) self.log('Analysis at night not started: ' + e); });
  return true;
};

module.exports = {Runner: Runner, parseLine: parseLine, findPythons: findPythons};
