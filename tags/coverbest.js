/* Cover suggestions for the library check ("Cover quality", image too small): searches online (coversearch.js) for
   one album after another, loads the hits and keeps the largest image that is larger than the current one.
   Only the address and size are stored (cover-best.json), not the image: it is loaded again when shown or saved.
   One search at a time with a pause in between (iTunes answers only about 20 searches a minute). Node 8, ES5 only.
   opts: file, search({artist, album}, cb(list of {source, url})), load(url, cb(err, {mime, body})), dims(buf) -> {w, h},
         gapMs (pause between searches), now() (tests) */
var fs = require('fs');
var writeAtomic = require('./atomic.js').writeAtomic;

var GAP_MS = 4000;                    /* between two searches: 15 a minute */
var NONE_DAYS = 30;                   /* nothing better found: search again after that */
var MAX_ENTRIES = 5000;
var QUEUE_MAX = 200;                  /* only what the list shows is asked for; more is dropped */

/* the better image: larger shorter side; nearly square before clearly not square; on a tie the earlier source */
function square(c) { return Math.min(c.w, c.h) / Math.max(c.w, c.h) >= 0.9; }
function better(a, b) {
  if (!b) return true;
  if (square(a) !== square(b)) return square(a);
  return Math.min(a.w, a.h) > Math.min(b.w, b.h);
}

function Best(opts) {
  this.file = opts.file;
  this.search = opts.search; this.load = opts.load; this.dims = opts.dims;
  this.gapMs = opts.gapMs === undefined ? GAP_MS : opts.gapMs;
  this.now = opts.now || Date.now;
  this.by = {};                       /* dir -> {at, src, url, w, h, bytes} or {at, none: true} */
  this.queue = []; this.queued = {}; this.busy = null; this.last = 0; this.timer = null;
  try { this.by = JSON.parse(fs.readFileSync(this.file, 'utf8')).by || {}; } catch (e) { /* none yet */ }
}

/* stored result for a folder, null if still unknown (or nothing found long ago). cur: {w, h} of the current image */
Best.prototype.get = function(dir, cur) {
  var e = Object.prototype.hasOwnProperty.call(this.by, dir) ? this.by[dir] : null;
  if (!e) return null;
  if (e.none) return this.now() - e.at < NONE_DAYS * 86400000 ? e : null;
  if (cur && Math.min(e.w, e.h) <= Math.min(cur.w || 0, cur.h || 0)) return {at: e.at, none: true};   /* the folder has a better one now */
  return e;
};

/* state per folder for the list: 'found' (with the image's size), 'none', 'wait' (queued or searching) */
Best.prototype.state = function(dir, cur) {
  var e = this.get(dir, cur);
  if (e) return e.none ? {state: 'none'} : {state: 'found', src: e.src, w: e.w, h: e.h, bytes: e.bytes};
  return {state: 'wait'};
};

/* job: {dir, artist, album, cur: {w, h}} -> queued unless known */
Best.prototype.ask = function(job) {
  if (this.get(job.dir, job.cur) || this.queued[job.dir] || this.queue.length >= QUEUE_MAX) return;
  this.queued[job.dir] = true;
  this.queue.push(job);
  this.kick();
};
/* the list scrolled on: forget what is no longer shown (keep: dirs still wanted) */
Best.prototype.only = function(keep) {
  var want = {}, self = this;
  keep.forEach(function(d){ want[d] = true; });
  this.queue = this.queue.filter(function(j){ if (want[j.dir]) return true; delete self.queued[j.dir]; return false; });
};

Best.prototype.kick = function() {
  var self = this;
  if (this.busy || this.timer || !this.queue.length) return;
  var wait = Math.max(0, this.last + this.gapMs - this.now());
  if (wait) { this.timer = setTimeout(function(){ self.timer = null; self.kick(); }, wait); return; }
  var job = this.busy = this.queue.shift();
  this.last = this.now();
  this.find(job, function(){
    delete self.queued[job.dir];
    self.busy = null;
    self.kick();
  });
};

/* search, load every hit (one after another, the images can be large) and keep the best one above the current size */
Best.prototype.find = function(job, done) {
  var self = this, cur = job.cur || {w: 0, h: 0};
  this.search({artist: job.artist, album: job.album}, function(list){
    var best = null, i = 0;
    (function next() {
      if (i >= list.length) return finish();
      var hit = list[i++];
      self.load(hit.url, function(e, img){
        var d = !e && img && self.dims(img.body);
        if (d && d.w && d.h && Math.min(d.w, d.h) > Math.min(cur.w || 0, cur.h || 0)) {
          var c = {src: hit.source, url: hit.url, w: d.w, h: d.h, bytes: img.body.length};
          if (better(c, best)) best = c;
        }
        next();
      });
    })();
    function finish() {
      var e = best || {none: true};
      e.at = self.now();
      self.by[job.dir] = e;
      self.save();
      done(e);
    }
  });
};

Best.prototype.save = function() {
  var dirs = Object.keys(this.by), self = this;
  if (dirs.length > MAX_ENTRIES) {                     /* oldest out */
    dirs.sort(function(a, b){ return self.by[a].at - self.by[b].at; }).slice(0, dirs.length - MAX_ENTRIES)
      .forEach(function(d){ delete self.by[d]; });
  }
  try { writeAtomic(this.file, JSON.stringify({by: this.by})); } catch (e) { console.error('cover-best.json: ' + e.message); }
};

module.exports = {Best: Best, better: better, GAP_MS: GAP_MS};
