/* Endless playback without Volumio (PLAYER 'mpd'): the idea of the AutoDJ plugin (Celindir69/autodj-plugin,
   volumio-autodj-local.sh) in the tag service. When only a few tracks are left after the one playing, a track by an
   artist similar to one of the last ones in the queue (Last.fm artist.getsimilar) is taken from the own library and
   added at the end. Repeat on: paused (the ∞ state of the repeat button is "AutoDJ on, repeat off").
   Repeat guards as in the plugin: the last few artists are not picked again right away, the last added tracks for
   longer. If every candidate is guarded, the one guarded longest ago is taken, so the queue never runs dry.
   Exclude keywords (title or album, ";"-separated) and a maximum length as in the plugin's settings.
   Node 8, ES5 only.
   opts: mpd(cmds, cb(err, lists)), file (state JSON), similar(artist, cb(err, [names])) (Last.fm), ready() (key there),
         log(text), random() */
var fs = require('fs');

var LOW = 3;               /* refill when this many tracks or fewer are left after the current one */
var SEEDS = 5;             /* seed pool: the last tracks of the queue */
var RETRIES = 2;           /* other seeds when the first gives nothing */
var ARTISTS = 4, TRACKS = 15;
var DEADLINE_MS = 25000;

function q(s) { return '"' + String(s).replace(/[\\"]/g, '\\$&') + '"'; }
function norm(s) { return String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9À-ɏ]+/g, ''); }

/* MPD lines -> [{file, artist, title, album, dur}] */
function songs(lines) {
  var out = [], cur = null;
  (lines || []).forEach(function(l){
    var i = l.indexOf(': '); if (i < 0) return;
    var k = l.slice(0, i), v = l.slice(i + 2);
    if (k === 'file') { cur = {file: v, artist: '', title: '', album: '', dur: 0}; out.push(cur); }
    else if (!cur) return;
    else if (k === 'Artist' && !cur.artist) cur.artist = v;
    else if (k === 'Title') cur.title = v;
    else if (k === 'Album') cur.album = v;
    else if (k === 'duration' || (k === 'Time' && !cur.dur)) cur.dur = Math.round(+v) || 0;
  });
  return out;
}
function keyVals(lines) {
  var o = {};
  (lines || []).forEach(function(l){ var i = l.indexOf(': '); if (i > 0) o[l.slice(0, i)] = l.slice(i + 2); });
  return o;
}
function keywords(s) { return String(s || '').split(';').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean); }

/* does the track pass the settings (excludes, length)? */
function allowed(t, cfg) {
  var hay = (t.title + '\n' + t.album).toLowerCase();
  if (keywords(cfg.excludes).some(function(k){ return hay.indexOf(k) >= 0; })) return false;
  var max = +cfg.maxMinutes || 0;
  return !(max > 0 && t.dur > max * 60);
}

/* the artist a queue entry stands for (first of several: "A; B", "A feat. B") */
function mainArtist(a) { return String(a || '').split(/\s*;\s*|\s+feat\.?\s+|\s+ft\.\s+/i)[0].trim(); }

function AutoDJ(opts) {
  this.o = opts;
  this.rnd = opts.random || Math.random;
  this.busy = false;
  this.s = {enabled: false, excludes: '', maxMinutes: 20, artists: [], tracks: []};
  try { var d = JSON.parse(fs.readFileSync(opts.file, 'utf8')); Object.keys(this.s).forEach(function(k){ if (d[k] !== undefined) this.s[k] = d[k]; }, this); }
  catch (e) { /* first start */ }
}

AutoDJ.prototype.save = function() {
  try { fs.writeFileSync(this.o.file + '.neu', JSON.stringify(this.s)); fs.renameSync(this.o.file + '.neu', this.o.file); }
  catch (e) { this.log('AutoDJ: state not saved: ' + e.message); }
};
AutoDJ.prototype.log = function(t) { if (this.o.log) this.o.log(t); };

/* REST like the plugin's endpoint: {} = state, {enabled}, {excludes}, {maxMinutes} switch or set */
AutoDJ.prototype.api = function(body, cb) {
  var s = this.s, ch = false;
  body = body || {};
  if (typeof body.enabled === 'boolean' && body.enabled !== s.enabled) { s.enabled = body.enabled; ch = true; }
  if (typeof body.excludes === 'string') { s.excludes = body.excludes.slice(0, 1000); ch = true; }
  if (body.maxMinutes !== undefined) {
    var m = parseInt(body.maxMinutes, 10);
    if (!(m >= 0 && m <= 600)) return cb({ok: false, error: 'value'});
    s.maxMinutes = m; ch = true;
  }
  if (ch) this.save();
  if (body.enabled === true) this.tick(function(){});
  cb({ok: true, enabled: s.enabled, ready: !!this.o.ready(), replayGain: null, crossfade: null, excludes: s.excludes, maxMinutes: s.maxMinutes});
};

/* one check: add a track if the queue is about to run out. cb(err, added file or '') */
AutoDJ.prototype.tick = function(cb) {
  var self = this;
  cb = cb || function(){};
  if (!this.s.enabled || this.busy || !this.o.ready()) return cb(null, '');
  this.busy = true;
  function done(e, f) { self.busy = false; if (e) self.log('AutoDJ: ' + e.message); cb(e, f || ''); }
  this.o.mpd(['status', 'playlistinfo'], function(err, lists){
    if (err) return done(err);
    var st = keyVals(lists[0]), queue = songs(lists[1]);
    if (st.repeat === '1' || st.single === '1' || st.state !== 'play' && st.state !== 'pause' || !queue.length) return done(null, '');
    var left = queue.length - (+st.song + 1);
    if (!(left <= LOW)) return done(null, '');
    self.pick(queue, function(e2, t){
      if (e2 || !t) return done(e2, '');
      self.o.mpd(['add ' + q(t.file)], function(e3){
        if (e3) return done(e3);
        var s = self.s;
        s.artists = s.artists.filter(function(a){ return a !== norm(t.artist); }).concat(norm(t.artist)).slice(-ARTISTS);
        s.tracks = s.tracks.filter(function(f){ return f !== t.file; }).concat(t.file).slice(-TRACKS);
        self.save();
        self.log('AutoDJ: added ' + t.artist + ' - ' + t.title + (t.why ? ' (' + t.why + ')' : ''));
        done(null, t.file);
      });
    });
  });
};

/* the next track: similar artists of a seed from the end of the queue, found in the library */
AutoDJ.prototype.pick = function(queue, cb) {
  var self = this, s = this.s, start = Date.now();
  var inQueue = {}; queue.forEach(function(t){ inQueue[t.file] = true; });
  var pool = [];
  queue.slice(-SEEDS).forEach(function(t){ var a = mainArtist(t.artist); if (a && pool.indexOf(a) < 0) pool.push(a); });
  if (!pool.length) return cb(null, null);
  var guarded = [];                                     /* found, but the artist was picked just now: last resort */
  var tried = 0, seed = pool.splice(Math.floor(self.rnd() * pool.length), 1)[0];
  trySeed();
  function trySeed() {
    self.o.similar(seed, function(e, names){
      var cands = (names || []).filter(function(n){ return norm(n) && norm(n) !== norm(seed); });
      var i = 0;
      (function next() {
        if (i >= cands.length || Date.now() - start > DEADLINE_MS) return afterSeed();
        var name = cands[i++];
        self.tracksOf(name, inQueue, function(list){
          if (!list.length) return next();
          var t = list[Math.floor(self.rnd() * list.length)];
          t.why = 'like ' + seed;
          if (s.artists.indexOf(norm(name)) >= 0) { guarded.push(t); return next(); }
          cb(null, t);
        });
      })();
    });
  }
  function afterSeed() {
    if (pool.length && tried++ < RETRIES && Date.now() - start <= DEADLINE_MS) {
      seed = pool.splice(Math.floor(self.rnd() * pool.length), 1)[0];
      return trySeed();
    }
    if (guarded.length) {                               /* the artist guarded longest ago */
      guarded.sort(function(a, b){ return s.artists.indexOf(norm(a.artist)) - s.artists.indexOf(norm(b.artist)); });
      return cb(null, guarded[0]);
    }
    cb(null, null);
  }
};

/* the artist's tracks in the library that may be added (same name, case and "The" aside) */
AutoDJ.prototype.tracksOf = function(name, inQueue, cb) {
  var self = this, want = norm(name);
  this.o.mpd(['search artist ' + q(name)], function(err, lists){
    if (err) return cb([]);
    var list = songs(lists[0]).filter(function(t){
      return norm(mainArtist(t.artist)) === want && !inQueue[t.file] && self.s.tracks.indexOf(t.file) < 0 && allowed(t, self.s) && !/^https?:/.test(t.file);
    });
    cb(list);
  });
};

module.exports = {AutoDJ: AutoDJ, songs: songs, norm: norm, allowed: allowed, mainArtist: mainArtist, LOW: LOW};
