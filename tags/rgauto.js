/* ReplayGain "Automatic" (Playback page): album gain while an album plays in order, track gain for mixes.
   MPD's own "auto" only looks at the shuffle switch, so a mix in a queue in order would play with album gain.
   Here the current track decides: album gain if its neighbour before or after in the queue is from the same album
   (and shuffle is off), otherwise track gain. The queue is Volumio's (opts.queue): Volumio 2 hands MPD only the
   current track (plus the next one shortly before the end, consume on), so MPD's own queue has no neighbours;
   without opts.queue, or if Volumio does not answer, MPD's queue is used. MPD reports every change (idle), the mode is switched at runtime.
   Taken over: Volumio or MPD set to "auto" (e.g. Volumio's playback options). Ended: another mode set here or
   elsewhere (e.g. AutoDJ's automatic mode). The choice is kept in replaygain.json. Node 8, ES5 only.
   opts: file, mpd(cmd, cb(err, fields)), idle(onChange) -> stop(),
         queue(cb(err, {pos, random, items})) optional: Volumio's queue (all replaceable for tests) */
var fs  = require('fs');
var net = require('net');

/* album key of a queue entry; '' = unknown (no album tag, e.g. streams without tags) */
function albumKey(s) {
  if (!s || !s.album) return '';
  return String(s.album).toLowerCase() + '\0' + String(s.albumartist || '').toLowerCase();
}

/* entry of Volumio's queue -> like an MPD entry; Volumio has no album artist there, the folder stands in for it
   (a compilation has one folder but many artists) */
function fromVolumio(it) {
  if (!it) return null;
  var uri = String(it.uri || '');
  return {file: uri, album: it.album || '', albumartist: it.album ? uri.replace(/\/[^\/]*$/, '') : ''};
}

/* status: MPD status; prev, cur, next: queue entries (or null) -> 'album' | 'track' | null (nothing playing) */
function pick(status, prev, cur, next) {
  if (!cur) return null;
  if (status && status.random === '1') return 'track';
  var k = albumKey(cur);
  return k && (albumKey(prev) === k || albumKey(next) === k) ? 'album' : 'track';
}

/* MPD idle on its own connection: onChange() after each change to the queue, the player or the options;
   reconnects after errors. Returns stop() */
function mpdIdle(host, port, onChange) {
  var sock = null, stopped = false, timer = null;
  function connect() {
    if (stopped) return;
    var buf = '', greeted = false;
    sock = net.createConnection({host: host, port: port});
    sock.setEncoding('utf8');
    sock.on('data', function(d){
      buf += d;
      var n;
      while ((n = buf.indexOf('\n')) >= 0) {
        var l = buf.slice(0, n); buf = buf.slice(n + 1);
        if (!greeted) { greeted = true; onChange(); sock.write('idle playlist player options\n'); continue; }
        if (l === 'OK') { onChange(); sock.write('idle playlist player options\n'); }
      }
    });
    sock.on('error', function(){ /* close follows */ });
    sock.on('close', function(){ sock = null; if (!stopped) timer = setTimeout(connect, 10000); });
  }
  connect();
  return function(){ stopped = true; clearTimeout(timer); if (sock) sock.destroy(); };
}

function RgAuto(opts) {
  this.file = opts.file;
  this.mpd = opts.mpd;
  this.idle = opts.idle;
  this.queue = opts.queue || null;
  this.on = false;
  this.mine = null;              /* mode last set here: a different one comes from elsewhere */
  this.busy = false; this.again = false;
  try { this.on = JSON.parse(fs.readFileSync(this.file, 'utf8')).auto === true; } catch (e) { /* not chosen yet */ }
}

RgAuto.prototype.start = function() {
  var self = this;
  var later = null;
  this.stop = this.idle(function(){
    self.check();
    /* Volumio updates its state a moment after MPD: look again so a track change is judged by the new position */
    if (self.queue) { clearTimeout(later); later = setTimeout(function(){ self.check(); }, 2500); if (later.unref) later.unref(); }
  });
};

RgAuto.prototype.save = function(on) {
  this.on = on;
  if (!on) this.mine = null;
  try { fs.writeFileSync(this.file, JSON.stringify({auto: on})); } catch (e) { console.log('replaygain.json: ' + e.message); }
};

/* Playback page: "auto" switches it on (and sets the mode right away), any other mode off */
RgAuto.prototype.choose = function(mode, cb) {
  if (mode !== 'auto') { if (this.on) this.save(false); return cb(); }
  if (!this.on) this.save(true);
  this.mine = null;
  this.check(cb);
};

/* after every MPD change: take over "auto", notice a mode set elsewhere, set the mode for the current track */
RgAuto.prototype.check = function(cb) {
  var self = this;
  cb = cb || function(){};
  if (this.busy) { this.again = true; return cb(); }
  this.busy = true;
  function done() {
    self.busy = false;
    if (self.again) { self.again = false; self.check(); }
    cb();
  }
  this.mpd('replay_gain_status', function(err, rg){
    if (err) return done();
    var now = rg.replay_gain_mode;
    if (now === 'auto') { if (!self.on) self.save(true); self.mine = null; }
    else if (self.on && self.mine && now !== self.mine) { self.save(false); return done(); }
    if (!self.on) return done();
    function apply(want) {
      if (!want || want === now) { if (want) self.mine = want; return done(); }
      self.mpd('replay_gain_mode ' + want, function(e4){
        if (!e4) self.mine = want;
        done();
      });
    }
    function fromMpd() {
      self.mpd('status', function(e2, st){
        if (e2 || st.song === undefined) return done();
        var pos = parseInt(st.song, 10), len = parseInt(st.playlistlength, 10) || 0;
        function entry(p, next) {
          if (p < 0 || p >= len) return next(null);
          self.mpd('playlistinfo ' + p, function(e3, s){ next(e3 ? null : s); });
        }
        entry(pos, function(cur){
          entry(pos - 1, function(prev){
            entry(pos + 1, function(nxt){ apply(pick(st, prev, cur, nxt)); });
          });
        });
      });
    }
    if (!self.queue) return fromMpd();
    self.queue(function(eq, q){
      if (eq || !q || !q.items || !(q.pos >= 0) || !q.items[q.pos]) return fromMpd();
      var it = q.items;
      apply(pick({random: q.random ? '1' : '0'}, fromVolumio(it[q.pos - 1]), fromVolumio(it[q.pos]), fromVolumio(it[q.pos + 1])));
    });
  });
};

module.exports = {RgAuto: RgAuto, pick: pick, albumKey: albumKey, fromVolumio: fromVolumio, mpdIdle: mpdIdle};
