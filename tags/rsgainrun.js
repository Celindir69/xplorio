/* ReplayGain tags on this Mac (Xplorio.app, settings page "Playback"): runs rsgain ("easy" mode, -S: only albums
   without tags) over the music folders, with low priority (nice). rsgain changes the files, so afterwards:
   - the audio analysis (essentia.jsonl) learns the new size and time of every file rsgain wrote, so it does not
     analyse them again (the sound is the same): the files are listed before and after, what changed gets a new line;
   - MPD reads the library again (onDone).
   Needs rsgain (brew install rsgain, or MacPorts). Optionally every night (02:00, before the analysis at 03:00).
   Node 8, ES5 only.
   opts: dirs() -> [folders for rsgain], walkRoot() -> folder as the analysis walks it (links followed),
         essentia() -> analysis result file, stateFile, spawn, now(), bins ([candidates]), busy() (analysis running),
         log(text), onDone(changed) */
var fs = require('fs'), path = require('path'), cp = require('child_process');

var NIGHT_HOUR = 2;
var TAIL = 40;
var AUDIO = ['.flac', '.m4a', '.mp4', '.mp3', '.wav', '.aif', '.aiff', '.dsf', '.dff', '.ogg', '.oga', '.opus', '.wv', '.ape', '.wma', '.alac'];
var SKIP_DIRS = ['Xplorio Trash', 'Xplorio Duplicates'];

/* rsgain on PATH, as a full path */
function findBin(pathVar, exists) {
  var dirs = String(pathVar || '').split(':').filter(Boolean);
  for (var i = 0; i < dirs.length; i++) { var f = dirs[i].replace(/\/$/, '') + '/rsgain'; if (exists(f)) return f; }
  return '';
}

/* all audio files below root, like analyse.py walks them (links followed, hidden folders and Xplorio's trash left out)
   -> cb({path: [size, mtime s]}). Asynchronous, a few at a time, so the tag service keeps answering */
function walk(root, cb) {
  var out = {}, queue = [[root, 0]], active = 0;
  function next() {
    while (active < 8 && queue.length) one(queue.shift());
    if (!active && !queue.length) cb(out);
  }
  function one(item) {
    var dir = item[0];
    active++;
    fs.readdir(dir, function(e, names){
      if (e || !names.length) { active--; return next(); }
      var left = names.length;
      names.forEach(function(n){
        var p = dir + '/' + n;
        fs.stat(p, function(e2, st){
          if (!e2) {
            if (st.isDirectory()) { if (n.charAt(0) !== '.' && SKIP_DIRS.indexOf(n) < 0 && item[1] < 30) queue.push([p, item[1] + 1]); }   /* depth: against link loops */
            else if (n.slice(0, 2) !== '._' && AUDIO.indexOf(path.extname(n).toLowerCase()) >= 0) out[p] = [st.size, Math.floor(st.mtime.getTime() / 1000)];
          }
          if (--left === 0) { active--; next(); }
        });
      });
    });
  }
  next();
}

/* entries of files whose size or time changed (and nothing else did) get a new line with the new values;
   the last line of a path counts (analyse.py, essentia.js). -> number of entries carried along */
function carryAlong(file, before, after) {
  var changed = {}, n = 0;
  Object.keys(after).forEach(function(p){
    var a = before[p], b = after[p];
    if (a && (a[0] !== b[0] || a[1] !== b[1])) changed[p] = b;
  });
  if (!Object.keys(changed).length) return 0;
  var text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return 0; }
  var last = {};
  text.split('\n').forEach(function(l){
    if (!l) return;
    try { var o = JSON.parse(l); if (o && changed[o.p]) last[o.p] = o; } catch (e) { /* broken line */ }
  });
  var add = [];
  Object.keys(last).forEach(function(p){
    var o = last[p], was = before[p];
    if (o.sz !== was[0] || o.mt !== was[1]) return;       /* the entry belongs to an older state of the file: leave it */
    o.sz = changed[p][0]; o.mt = changed[p][1];
    add.push(JSON.stringify(o));
  });
  if (!add.length) return 0;
  fs.appendFileSync(file, (text && text.slice(-1) !== '\n' ? '\n' : '') + add.join('\n') + '\n');
  n = add.length;
  return n;
}

function Runner(o) {
  this.o = o;
  this.spawn = o.spawn || cp.spawn;
  this.now = o.now || Date.now;
  this.child = null; this.progress = null; this.tail = []; this.stopping = false;
  this.s = {nightly: false, lastStart: 0, lastEnd: 0, lastFiles: 0, lastCarried: 0, lastError: '', lastNight: ''};
  try { var d = JSON.parse(fs.readFileSync(o.stateFile, 'utf8')); Object.keys(this.s).forEach(function(k){ if (d[k] !== undefined) this.s[k] = d[k]; }, this); }
  catch (e) { /* first start */ }
}
Runner.prototype.save = function() {
  try { fs.writeFileSync(this.o.stateFile + '.neu', JSON.stringify(this.s)); fs.renameSync(this.o.stateFile + '.neu', this.o.stateFile); }
  catch (e) { this.log('ReplayGain: state not saved: ' + e.message); }
};
Runner.prototype.log = function(t) { if (this.o.log) this.o.log(t); };
Runner.prototype.bin = function() {
  if (this.o.bins) { for (var i = 0; i < this.o.bins.length; i++) if (fs.existsSync(this.o.bins[i])) return this.o.bins[i]; return ''; }
  return findBin(process.env.PATH, fs.existsSync);
};
Runner.prototype.running = function() { return !!this.progress; };

Runner.prototype.status = function() {
  var s = this.s;
  return {ok: true, rsgain: this.bin(), running: this.running(), progress: this.progress, tail: this.tail.slice(-8),
          nightly: s.nightly, lastStart: s.lastStart, lastEnd: s.lastEnd, lastFiles: s.lastFiles, lastCarried: s.lastCarried, lastError: s.lastError};
};

/* list the files, rsgain folder by folder, list again, carry the analysis along -> cb(error code or null) at the start */
Runner.prototype.start = function(cb) {
  var self = this;
  if (this.running()) return cb('running');
  if (this.o.busy && this.o.busy()) return cb('busy');
  var bin = this.bin();
  if (!bin) return cb('rsgain');
  var dirs = this.o.dirs().filter(function(d){ return fs.existsSync(d); });
  if (!dirs.length) return cb('roots');
  this.progress = {phase: 'listing', dir: 0, dirs: dirs.length}; this.tail = []; this.stopping = false;
  this.s.lastStart = this.now(); this.s.lastError = ''; this.save();
  this.log('ReplayGain started: ' + dirs.join(', '));
  cb(null);
  walk(this.o.walkRoot(), function(before){
    if (self.stopping) return self.finish(before, '');
    var i = 0;
    (function nextDir(){
      if (self.stopping || i >= dirs.length) return self.finish(before, '');
      self.progress.phase = 'tagging'; self.progress.dir = i + 1; self.progress.current = dirs[i];
      var ch, buf = '';
      try { ch = self.spawn('nice', ['-n', '15', bin, 'easy', '-S', '-m', 'MAX', dirs[i]], {detached: true, stdio: ['ignore', 'pipe', 'pipe']}); }
      catch (e) { return self.finish(before, 'start'); }
      self.child = ch;
      function onData(d) {
        buf += String(d);
        var parts = buf.split(/\r?\n|\r/);
        buf = parts.pop();
        parts.forEach(function(l){ l = l.trim(); if (l) { self.tail.push(l); if (self.tail.length > TAIL) self.tail.shift(); } });
      }
      if (ch.stdout) ch.stdout.on('data', onData);
      if (ch.stderr) ch.stderr.on('data', onData);
      ch.on('error', function(e){ self.log('ReplayGain: ' + e.message); });
      ch.on('close', function(code){
        if (self.child !== ch) return;
        self.child = null;
        if (code && !self.stopping) self.s.lastError = self.s.lastError || ('exit ' + code);
        i++; nextDir();
      });
    })();
  });
};

Runner.prototype.finish = function(before, err) {
  var self = this;
  if (err) this.s.lastError = err;
  this.progress.phase = 'checking';
  walk(this.o.walkRoot(), function(after){
    var files = 0, carried = 0;
    Object.keys(after).forEach(function(p){ var a = before[p]; if (a && (a[0] !== after[p][0] || a[1] !== after[p][1])) files++; });
    try { carried = self.o.essentia ? carryAlong(self.o.essentia(), before, after) : 0; }
    catch (e) { self.log('ReplayGain: analysis not carried along: ' + e.message); }
    self.s.lastEnd = self.now(); self.s.lastFiles = files; self.s.lastCarried = carried;
    self.progress = null; self.stopping = false;
    self.save();
    self.log('ReplayGain ended: ' + files + ' files tagged, ' + carried + ' analysis entries carried along');
    if (self.o.onDone) self.o.onDone(files);
  });
};

/* like Ctrl-C: rsgain finishes nothing more; files it wrote keep their tags and are carried along */
Runner.prototype.stop = function() {
  if (!this.running()) return false;
  this.stopping = true;
  if (this.child) { try { process.kill(-this.child.pid, 'SIGINT'); } catch (e) { try { this.child.kill('SIGINT'); } catch (e2) { /* gone */ } } }
  return true;
};
Runner.prototype.setNightly = function(on) { this.s.nightly = !!on; this.save(); };
Runner.prototype.tick = function() {
  var d = new Date(this.now()), day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  if (!this.s.nightly || this.running() || d.getHours() !== NIGHT_HOUR || this.s.lastNight === day) return false;
  if (this.o.busy && this.o.busy()) return false;
  this.s.lastNight = day; this.save();
  var self = this;
  this.start(function(e){ if (e) self.log('ReplayGain at night not started: ' + e); });
  return true;
};

module.exports = {Runner: Runner, walk: walk, carryAlong: carryAlong, findBin: findBin};
