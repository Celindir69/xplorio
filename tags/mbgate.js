/* One queue for all MusicBrainz requests of the tag service (release dates, artist spellings, mood tags, similar
   artists): MusicBrainz allows about one request per second per address and answers 503 above that, also when it is
   busy itself. Requests go out one after the other with GAP_MS in between; after a 503 (or 429) the whole queue pauses
   (Retry-After, else 5 s, doubling up to 2 min) and the request is tried again, at most RETRIES times.
   Requests a person waits for (front) go before the background ones. Node 8, ES5 only. */
var coversearch = require('./coversearch.js');

var GAP_MS = 1100, PAUSE_MS = 5000, PAUSE_MAX = 120000, RETRIES = 4;

function Gate(opts) {
  opts = opts || {};
  this.gap = opts.gapMs || GAP_MS; this.pause0 = opts.pauseMs || PAUSE_MS; this.pauseMax = opts.pauseMaxMs || PAUSE_MAX;
  this.fetch = opts.fetch || function(u, cb){ coversearch.fetchUrl(u, 512 * 1024, cb); };
  this.queue = []; this.busy = false; this.last = 0; this.pause = 0; this.until = 0;
  this.stats = {sent: 0, busy503: 0, failed: 0, lastBusy: 0};
}

/* cb(err, json); opts.front: before the background requests */
Gate.prototype.getJson = function(u, cb, opts) {
  var job = {u: u, cb: cb, tries: 0};
  if (opts && opts.front) {
    var i = 0;
    while (i < this.queue.length && this.queue[i].front) i++;
    job.front = true;
    this.queue.splice(i, 0, job);
  } else this.queue.push(job);
  this.run();
};
Gate.prototype.waiting = function() { return this.queue.length + (this.busy ? 1 : 0); };
/* MusicBrainz said "too busy" within the last minute (collectors slow down) */
Gate.prototype.congested = function() { return Date.now() - this.stats.lastBusy < 60000; };

Gate.prototype.run = function() {
  var self = this;
  if (this.busy || !this.queue.length) return;
  var wait = Math.max(0, this.last + this.gap - Date.now(), this.until - Date.now());
  if (wait > 0) {
    if (!this.timer) this.timer = setTimeout(function(){ self.timer = null; self.run(); }, wait);
    return;
  }
  var job = this.queue.shift();
  this.busy = true; this.last = Date.now(); this.stats.sent++;
  this.fetch(job.u, function(e, r){
    self.busy = false; self.last = Date.now();
    var code = e && /HTTP (\d+)/.exec(e.message || '');
    if (code && (code[1] === '503' || code[1] === '429')) {
      self.stats.busy503++; self.stats.lastBusy = Date.now();
      self.pause = Math.min(self.pauseMax, self.pause ? self.pause * 2 : self.pause0);
      var ra = e.retryAfter && parseInt(e.retryAfter, 10);
      self.until = Date.now() + (ra > 0 ? Math.min(self.pauseMax, ra * 1000) : self.pause);
      if (++job.tries <= RETRIES) self.queue.unshift(job);
      else { self.stats.failed++; job.cb(e); }
      return self.run();
    }
    if (!e) self.pause = 0;                              /* answered: back to normal speed */
    if (e) { self.stats.failed++; job.cb(e); return self.run(); }
    var j;
    try { j = JSON.parse(r.body.toString('utf8')); } catch (x) { self.run(); return job.cb(new Error('no JSON response')); }
    self.run();
    job.cb(null, j);
  });
};

var shared = new Gate();
module.exports = {Gate: Gate, shared: shared, getJson: function(u, cb, opts){ shared.getJson(u, cb, opts); }};
