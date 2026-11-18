/* Backing up Xplorio's own data on the Mac (settings page, "Backup"): the data folder (analysis, history, smart playlists,
   ratings, check results …) and the settings (xplorio.conf, config.local.js, mpd.conf, MPD's playlists) are copied to
   <target>/Xplorio-Sicherung/<date>. Files unchanged since the last backup are hard links to it, so every backup is
   complete but only changed files take space. The newest `keep` backups stay. Optionally every night at 01:00 (before
   rsgain at 02:00 and the analysis at 03:00).
   Left out: caches that are loaded again by themselves (artist photos, radio covers, TIDAL cache, track lists) and the
   sign-ins (TIDAL, Last.fm, the password): they are like passwords and are simply made again after a restore.
   Node 8, ES5 only.
   opts: dataDir, settings: [{from (file or folder), as (name in the backup)}], stateFile, now(), log(text), onDone() */
var fs = require('fs'), path = require('path');
var mi = require('./musicimport.js');

var NIGHT_HOUR = 1;
var KEEP = 7;
var FOLDER = 'Xplorio-Sicherung';
var PART = '.unvollstaendig';
var SKIP = ['tidal-cache', 'artists', 'radio-covers', 'stations', 'library-tracks.json', 'albums.json', 'check-files.json',
            'tidal.json', 'lastfm.json', 'keys.json', 'admin.json', 'run'];

function pad(n) { return (n < 10 ? '0' : '') + n; }
function stamp(t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); }
function skipped(rel) {
  var top = rel.split('/')[0], base = path.basename(rel);
  return SKIP.indexOf(top) >= 0 || /\.neu$/.test(base) || base === '.DS_Store';
}

/* complete backups in <target>/Xplorio-Sicherung, oldest first */
function generations(root) {
  var names = [];
  try { names = fs.readdirSync(root); } catch (e) { return []; }
  return names.filter(function(n){ return /^\d{4}-\d\d-\d\d_\d{4}(-\d+)?$/.test(n); }).sort();
}

function Backup(o) {
  this.o = o;
  this.now = o.now || Date.now;
  this.progress = null;
  this.s = {target: '', nightly: false, keep: KEEP, lastStart: 0, lastEnd: 0, lastError: '', lastDir: '', lastFiles: 0,
            lastBytes: 0, lastCopied: 0, lastCopiedBytes: 0, lastNight: ''};
  try { var d = JSON.parse(fs.readFileSync(o.stateFile, 'utf8')); Object.keys(this.s).forEach(function(k){ if (d[k] !== undefined) this.s[k] = d[k]; }, this); }
  catch (e) { /* first start */ }
}
Backup.prototype.save = function() {
  try { fs.writeFileSync(this.o.stateFile + '.neu', JSON.stringify(this.s)); fs.renameSync(this.o.stateFile + '.neu', this.o.stateFile); }
  catch (e) { this.log('Backup: state not saved: ' + e.message); }
};
Backup.prototype.log = function(t) { if (this.o.log) this.o.log(t); };
Backup.prototype.running = function() { return !!this.progress; };
Backup.prototype.root = function() { return this.s.target ? path.join(this.s.target, FOLDER) : ''; };

Backup.prototype.status = function() {
  var s = this.s, root = this.root(), gens = root ? generations(root) : [];
  return {ok: true, running: this.running(), progress: this.progress, target: s.target, targetOk: !!s.target && this.targetError() === '',
          folder: root, backups: gens.slice().reverse(), nightly: s.nightly, keep: s.keep,
          lastStart: s.lastStart, lastEnd: s.lastEnd, lastError: s.lastError, lastDir: s.lastDir, lastFiles: s.lastFiles,
          lastBytes: s.lastBytes, lastCopied: s.lastCopied, lastCopiedBytes: s.lastCopiedBytes};
};

/* '' or why the target does not work: unset, missing, write */
Backup.prototype.targetError = function(t) {
  t = t === undefined ? this.s.target : t;
  if (!t) return 'unset';
  try { if (!fs.statSync(t).isDirectory()) return 'missing'; } catch (e) { return 'missing'; }
  try { fs.accessSync(t, fs.constants ? fs.constants.W_OK : 2); } catch (e) { return 'write'; }
  return '';
};

/* target folder: an existing folder, not inside the data folder -> error code or '' */
Backup.prototype.setTarget = function(t) {
  t = path.resolve(String(t || ''));
  var e = this.targetError(t);
  if (e) return e;
  var real = function(p){ try { return fs.realpathSync(p); } catch (x) { return p; } };
  if ((real(t) + '/').indexOf(real(this.o.dataDir) + '/') === 0) return 'inside';
  this.s.target = t; this.save();
  return '';
};
Backup.prototype.setNightly = function(on) { this.s.nightly = !!on; this.save(); };

/* what is backed up: [{from (absolute), rel (in the backup), size, mtime}] */
Backup.prototype.sources = function(cb) {
  var self = this, out = [], items = [{from: this.o.dataDir, as: 'daten', data: true}].concat(this.o.settings || []);
  (function next(i){
    if (i >= items.length) return cb(null, out);
    var it = items[i], st;
    try { st = fs.statSync(it.from); } catch (e) { return next(i + 1); }
    if (st.isFile()) { out.push({from: it.from, rel: it.as, size: st.size, mtime: st.mtime, atime: st.atime}); return next(i + 1); }
    mi.list(it.from, function(e, files){
      if (e && it.data) return cb(e);
      (files || []).forEach(function(f){
        if (it.data && skipped(f.rel)) return;
        out.push({from: path.join(it.from, f.rel), rel: it.as + '/' + f.rel, size: f.size, mtime: f.mtime, atime: f.atime});
      });
      next(i + 1);
    });
  })(0);
};

/* -> cb(error code or null) at the start; the backup runs on */
Backup.prototype.start = function(cb, done) {
  var self = this;
  if (this.running()) return cb('running');
  var te = this.targetError();
  if (te) { this.s.lastError = 'target'; this.save(); return cb(te === 'unset' ? 'unset' : 'target'); }
  var root = this.root();
  try { fs.mkdirSync(root); } catch (e) { if (e.code !== 'EEXIST') return cb('fs'); }
  var gens = generations(root), prev = gens.length ? path.join(root, gens[gens.length - 1]) : '';
  var name = stamp(this.now()), k = 1;
  while (gens.indexOf(name) >= 0 || fs.existsSync(path.join(root, name + PART))) name = stamp(this.now()) + '-' + (++k);
  var dest = path.join(root, name), part = dest + PART;
  this.progress = {phase: 'listing', done: 0, total: 0};
  this.s.lastStart = this.now(); this.s.lastError = ''; this.save();
  this.log('Backup started: ' + dest);
  cb(null);

  function fail(e) {
    self.log('Backup failed: ' + (e && e.message || e));
    mi.removeTree(part, function(){ end('fs'); });
  }
  function end(err) {
    self.s.lastEnd = self.now(); self.s.lastError = err || '';
    self.progress = null; self.save();
    if (self.o.onDone) self.o.onDone(err);
    if (done) done(err);
  }

  this.sources(function(e, files){
    if (e) return end('source');
    self.progress = {phase: 'copying', done: 0, total: files.length};
    var made = {}, copied = 0, copiedBytes = 0, bytes = 0;
    function dirOf(p) {
      var d = path.dirname(p);
      if (made[d]) return;
      var parts = path.relative(part, d).split(path.sep), cur = part;
      try { fs.mkdirSync(part); } catch (x) { /* there */ }
      parts.forEach(function(s){ if (!s) return; cur = path.join(cur, s); try { fs.mkdirSync(cur); } catch (x) { /* there */ } });
      made[d] = true;
    }
    try { fs.mkdirSync(part); } catch (x) { if (x.code !== 'EEXIST') return fail(x); }
    (function next(i){
      if (i >= files.length) return finish();
      var f = files[i], to = path.join(part, f.rel), old = prev ? path.join(prev, f.rel) : '';
      bytes += f.size;
      try { dirOf(to); } catch (x) { return fail(x); }
      function done1() { self.progress.done = i + 1; setImmediate(function(){ next(i + 1); }); }
      function copy() {
        fs.copyFile(f.from, to, function(e2){
          if (e2) { if (e2.code === 'ENOENT') return done1(); return fail(e2); }   /* gone meanwhile (e.g. a .neu file) */
          copied++; copiedBytes += f.size;
          fs.utimes(to, f.atime, f.mtime, function(){ done1(); });
        });
      }
      if (!old) return copy();
      fs.stat(old, function(e3, st){
        if (e3 || st.size !== f.size || Math.floor(st.mtime.getTime() / 1000) !== Math.floor(f.mtime.getTime() / 1000)) return copy();
        fs.link(old, to, function(e4){ if (e4) return copy(); done1(); });   /* unchanged: a link to the last backup */
      });
    })(0);
    function finish() {
      fs.rename(part, dest, function(e5){
        if (e5) return fail(e5);
        self.s.lastDir = dest; self.s.lastFiles = files.length; self.s.lastBytes = bytes;
        self.s.lastCopied = copied; self.s.lastCopiedBytes = copiedBytes;
        self.log('Backup done: ' + dest + ' (' + files.length + ' files, ' + copied + ' copied)');
        self.progress.phase = 'pruning';
        self.prune(function(){ end(''); });
      });
    }
  });
};

/* only the newest `keep` backups stay; unfinished ones go */
Backup.prototype.prune = function(cb) {
  var root = this.root(), keep = Math.max(1, this.s.keep || KEEP), names = [];
  try { names = fs.readdirSync(root); } catch (e) { return cb(); }
  var gens = generations(root), gone = gens.slice(0, Math.max(0, gens.length - keep));
  names.forEach(function(n){ if (n.slice(-PART.length) === PART && (!this.progress || this.progress.phase === 'pruning')) gone.push(n); }, this);
  (function next(i){
    if (i >= gone.length) return cb();
    mi.removeTree(path.join(root, gone[i]), function(){ next(i + 1); });
  })(0);
};

Backup.prototype.tick = function() {
  var d = new Date(this.now()), day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  if (!this.s.nightly || !this.s.target || this.running() || d.getHours() !== NIGHT_HOUR || this.s.lastNight === day) return false;
  this.s.lastNight = day; this.save();
  var self = this;
  this.start(function(e){ if (e) self.log('Backup at night not started: ' + e); });
  return true;
};

module.exports = {Backup: Backup, generations: generations, skipped: skipped, FOLDER: FOLDER};
