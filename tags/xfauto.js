/* Crossfade "Automatic" (Playback page): no crossfade inside an album, crossfade for mixes.
   The transition decides: if the next track (MPD's nextsong, so shuffle too) is from the same album as the current one,
   crossfade is 0, otherwise the chosen seconds. Set at runtime after every MPD change (idle, see rgauto.js).
   Ended: a crossfade value set elsewhere (e.g. AutoDJ's automatic mode). Kept in crossfade.json. Node 8, ES5 only.
   opts: file, mpd(cmd, cb(err, fields)) */
var fs = require('fs');
var albumKey = require('./rgauto.js').albumKey;

/* cur, next: queue entries (next null = none); seconds -> crossfade to use, null = nothing playing */
function pick(cur, next, seconds) {
  if (!cur) return null;
  var k = albumKey(cur);
  return k && next && albumKey(next) === k ? 0 : seconds;
}

function XfAuto(opts) {
  this.file = opts.file;
  this.mpd = opts.mpd;
  this.on = false; this.seconds = 5;
  this.mine = null;              /* value last set here: a different one comes from elsewhere */
  this.busy = false; this.again = false;
  try {
    var j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.on = j.auto === true;
    if (j.seconds > 0) this.seconds = j.seconds;
  } catch (e) { /* not chosen yet */ }
}

XfAuto.prototype.save = function(on, seconds) {
  this.on = on;
  if (seconds > 0) this.seconds = seconds;
  if (!on) this.mine = null;
  try { fs.writeFileSync(this.file, JSON.stringify({auto: on, seconds: this.seconds})); } catch (e) { console.log('crossfade.json: ' + e.message); }
};

/* Playback page: auto true (with seconds) switches it on and sets the value right away, false off */
XfAuto.prototype.choose = function(auto, seconds, cb) {
  if (!auto) { if (this.on) this.save(false); return cb(); }
  this.save(true, seconds);
  this.mine = null;
  this.check(cb);
};

/* after every MPD change: notice a value set elsewhere, set the value for the coming transition */
XfAuto.prototype.check = function(cb) {
  var self = this;
  cb = cb || function(){};
  if (!this.on) return cb();
  if (this.busy) { this.again = true; return cb(); }
  this.busy = true;
  function done() {
    self.busy = false;
    if (self.again) { self.again = false; self.check(); }
    cb();
  }
  this.mpd('status', function(err, st){
    if (err) return done();
    var now = parseInt(st.xfade, 10) || 0;
    if (self.mine !== null && now !== self.mine) { self.save(false); return done(); }
    if (st.song === undefined) return done();
    function entry(p, next) {
      if (p === undefined) return next(null);
      self.mpd('playlistinfo ' + p, function(e2, s){ next(e2 ? null : s); });
    }
    entry(st.song, function(cur){
      entry(st.nextsong, function(nxt){
        var want = pick(cur, nxt, self.seconds);
        if (want === null || want === now) { if (want !== null) self.mine = want; return done(); }
        self.mpd('crossfade ' + want, function(e3){
          if (!e3) self.mine = want;
          done();
        });
      });
    });
  });
};

module.exports = {XfAuto: XfAuto, pick: pick};
