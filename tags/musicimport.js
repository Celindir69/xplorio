/* Importing new music on the Mac (settings page, "Music folders"): a folder is copied or moved to <music folder>/import/<name>,
   MPD reads exactly that folder, its tags are checked, then (if wanted and installed) rsgain and the audio analysis run on
   that folder only, and MPD reads it once more. One import at a time; the steps can be followed with status().
   Node 8, ES5 only.
   opts: musicRoot, mpd(cmds, cb(err, lists)), rsgain (rsgainrun Runner), analysis (essentiarun Runner), now(), log(text),
         onDone() */
var fs = require('fs'), path = require('path');

var AUDIO = ['.flac', '.m4a', '.mp4', '.mp3', '.wav', '.aif', '.aiff', '.dsf', '.dff', '.ogg', '.oga', '.opus', '.wv', '.ape', '.wma', '.alac'];
var IMAGES = /^(cover|folder|front|album|albumart|albumartsmall)\.(jpe?g|png|webp)$/i;
var FIELDS = ['artist', 'album', 'title', 'track', 'genre', 'date'];

function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function junk(n) { return n === '.DS_Store' || n.slice(0, 2) === '._'; }

/* every file below dir -> cb(err, [{rel, size, atime, mtime}], dirs [rel]) */
function list(dir, cb) {
  var files = [], dirs = [], queue = [''], active = 0, failed = null;
  function next() {
    while (active < 8 && queue.length) one(queue.shift());
    if (!active && !queue.length) cb(failed, files, dirs);
  }
  function one(rel) {
    active++;
    fs.readdir(path.join(dir, rel), function(e, names){
      if (e) { failed = failed || e; active--; return next(); }
      var left = names.length;
      if (!left) { active--; return next(); }
      names.forEach(function(n){
        var r = rel ? rel + '/' + n : n;
        fs.stat(path.join(dir, r), function(e2, st){
          if (e2) failed = failed || e2;
          else if (st.isDirectory()) { dirs.push(r); queue.push(r); }
          else if (st.isFile() && !junk(n)) files.push({rel: r, size: st.size, atime: st.atime, mtime: st.mtime});
          if (--left === 0) { active--; next(); }
        });
      });
    });
  }
  next();
}

/* remove a folder and everything in it (after a move to another drive, once the copy is complete) */
function removeTree(dir, cb) {
  fs.readdir(dir, function(e, names){
    if (e) return cb(e);
    (function next(i){
      if (i >= names.length) return fs.rmdir(dir, cb);
      var p = path.join(dir, names[i]);
      fs.lstat(p, function(e2, st){
        if (e2) return cb(e2);
        if (st.isDirectory()) return removeTree(p, function(e3){ if (e3) return cb(e3); next(i + 1); });
        fs.unlink(p, function(e4){ if (e4) return cb(e4); next(i + 1); });
      });
    })(0);
  });
}

/* MPD's listallinfo -> what is missing: {tracks, missing: {field: n}, examples: [{file, missing}], noCover: [album folders]} */
function checkTags(lines, imageDirs) {
  var tracks = [], cur = null;
  (lines || []).forEach(function(l){
    var i = l.indexOf(': ');
    if (i < 0) return;
    var k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
    if (k === 'file') { cur = {file: v}; tracks.push(cur); return; }
    if (k === 'directory' || k === 'playlist') { cur = null; return; }
    if (cur && v.trim()) cur[k] = v;
  });
  var missing = {}, examples = [], dirs = {};
  FIELDS.forEach(function(f){ missing[f] = 0; });
  tracks.forEach(function(t){
    var lack = FIELDS.filter(function(f){ return !t[f]; });
    lack.forEach(function(f){ missing[f]++; });
    if (lack.length && examples.length < 20) examples.push({file: t.file, missing: lack});
    dirs[path.dirname(t.file)] = true;
  });
  var noCover = Object.keys(dirs).filter(function(d){ return !imageDirs[d]; }).sort();
  return {tracks: tracks.length, missing: missing, examples: examples, noCover: noCover,
          files: tracks.slice(0, 2000).map(function(t){ return t.file; })};   /* for the tag editor */
}

function Import(o) {
  this.o = o;
  this.now = o.now || Date.now;
  this.job = null;          /* the current or last import */
}
Import.prototype.log = function(t) { if (this.o.log) this.o.log(t); };
Import.prototype.running = function() { return !!(this.job && !this.job.end); };
Import.prototype.status = function() { return {ok: true, job: this.job}; };

/* opts: {source (folder on this Mac), rel (music folder, e.g. "USB" or "USB/AllFlac"), target (its folder), move,
          rsgain, analysis} -> cb(error code or null) at the start */
Import.prototype.start = function(opts, cb) {
  var self = this, src = path.resolve(String(opts.source || '')), name = path.basename(src);
  if (this.running()) return cb('running');
  if (!opts.source || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) return cb('source');
  if (!opts.target || !fs.existsSync(opts.target)) return cb('target');
  var destDir = path.join(opts.target, 'import'), dest = path.join(destDir, name);
  var real = function(p){ try { return fs.realpathSync(p); } catch (e) { return p; } };
  if ((real(opts.target) + '/').indexOf(real(src) + '/') === 0 || (real(src) + '/').indexOf(real(opts.target) + '/') === 0) return cb('inside');
  if (fs.existsSync(dest)) return cb('exists');
  var mpdPath = String(opts.rel).replace(/^\/+|\/+$/g, '') + '/import/' + name;
  var job = this.job = {source: src, dest: dest, mpdPath: mpdPath, move: !!opts.move, start: this.now(), end: 0,
                        step: 'copy', done: 0, total: 0, bytes: 0, totalBytes: 0, error: '', steps: [], check: null};
  cb(null);
  function fail(code, e) {
    job.error = code; job.end = self.now();
    self.log('Import failed (' + code + '): ' + (e && e.message || ''));
    if (self.o.onDone) self.o.onDone(job);
  }
  function step(s) { job.steps.push(job.step); job.step = s; }
  try { fs.mkdirSync(destDir); } catch (e) { if (e.code !== 'EEXIST') return fail('fs', e); }

  function placed() {
    step('scan');
    self.scan(mpdPath, function(e){
      if (e) return fail('mpd', e);
      step('check');
      self.check(dest, mpdPath, function(c){
        job.check = c;
        afterCheck();
      });
    });
  }
  function afterCheck() {
    if (!opts.rsgain || !self.o.rsgain || !self.o.rsgain.bin()) return analyse();
    step('rsgain');
    self.o.rsgain.start(function(e){ if (e) { job.rsgainError = e; analyse(); } },
      {dirs: [dest], walkRoot: path.join(self.o.musicRoot, mpdPath), own: true, done: function(files){
        job.rsgainFiles = files;
        if (!files) return analyse();
        step('rescan');
        self.scan(mpdPath, function(){ analyse(); });
      }});
  }
  function analyse() {
    if (!opts.analysis || !self.o.analysis) return finish();
    step('analysis');
    self.o.analysis.start(function(e){ if (e) { job.analysisError = e; finish(); } },
      {roots: [path.join(self.o.musicRoot, mpdPath)], own: true, done: function(p){ job.analysed = p && p.done || 0; finish(); }});
  }
  function finish() {
    step('done'); job.end = self.now();
    self.log('Import done: ' + dest + ' (' + job.total + ' files)');
    if (self.o.onDone) self.o.onDone(job);
  }

  list(src, function(e, files, dirs){
    if (e) return fail('source', e);
    job.total = files.length;
    job.totalBytes = files.reduce(function(a, f){ return a + f.size; }, 0);
    if (job.move) {                                      /* same drive: just rename */
      return fs.rename(src, dest, function(e2){
        if (!e2) { job.done = job.total; job.bytes = job.totalBytes; return placed(); }
        if (e2.code !== 'EXDEV') return fail('fs', e2);
        copyAll(files, dirs);
      });
    }
    copyAll(files, dirs);
  });

  function copyAll(files, dirs) {
    try { fs.mkdirSync(dest); dirs.slice().sort().forEach(function(d){ fs.mkdirSync(path.join(dest, d)); }); }
    catch (e) { return fail('fs', e); }
    (function next(i){
      if (i >= files.length) return copied();
      var f = files[i], to = path.join(dest, f.rel);
      fs.copyFile(path.join(src, f.rel), to, function(e){
        if (e) return fail('fs', e);
        fs.utimes(to, f.atime, f.mtime, function(){         /* keep the file time (the analysis and rsync go by it) */
          job.done = i + 1; job.bytes += f.size;
          setImmediate(function(){ next(i + 1); });
        });
      });
    })(0);
    function copied() {
      if (!job.move) return placed();
      list(dest, function(e, got){                        /* moved to another drive: remove the source only when all arrived */
        var ok = !e && got.length === files.length && got.reduce(function(a, f){ return a + f.size; }, 0) === job.totalBytes;
        if (!ok) { job.keptSource = true; return placed(); }
        removeTree(src, function(e2){ if (e2) job.keptSource = true; placed(); });
      });
    }
  }
};

/* MPD reads the new folder; cb once it is done (at most 30 min). MPD only updates folders whose parent it knows
   (else "No such directory"): the import folder when MPD has it already, else the music folder (first import there) */
Import.prototype.scan = function(mpdPath, cb) {
  var self = this, t0 = this.now(), parent = path.dirname(mpdPath);
  this.o.mpd(['lsinfo ' + q(parent)], function(e0){
    self.o.mpd(['update ' + q(e0 ? path.dirname(parent) : parent)], function(e){ waitDone(e); });
  });
  function waitDone(e) {
    if (e) return cb(e);
    (function wait(){
      self.o.mpd(['status'], function(e2, lists){
        var busy = !e2 && (lists && lists[0] || []).some(function(l){ return l.indexOf('updating_db: ') === 0; });
        if (busy && self.now() - t0 < 30 * 60000) return setTimeout(wait, 1000);
        cb(null);
      });
    })();
  }
};

/* tags from MPD, cover files from the folder */
Import.prototype.check = function(dest, mpdPath, cb) {
  var self = this;
  list(dest, function(e, files){
    var imageDirs = {};
    (files || []).forEach(function(f){
      if (IMAGES.test(path.basename(f.rel))) imageDirs[path.dirname(mpdPath + '/' + f.rel)] = true;
    });
    var audio = (files || []).filter(function(f){ return AUDIO.indexOf(path.extname(f.rel).toLowerCase()) >= 0; }).length;
    self.o.mpd(['listallinfo ' + q(mpdPath)], function(e2, lists){
      var c = checkTags(e2 ? [] : lists && lists[0], imageDirs);
      c.audioFiles = audio;
      cb(c);
    });
  });
};

module.exports = {Import: Import, checkTags: checkTags, list: list, removeTree: removeTree};
