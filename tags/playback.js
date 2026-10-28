/* "Playback" page (gear menu): crossfade and ReplayGain directly in MPD, plus, for display, Volumio's
   normalization (volume_normalization, in the MPD configuration). The AutoDJ plugin's automatic mode comes from its
   own REST endpoint (web/js/autodj.js), not from its files.
   MPD sets crossfade and ReplayGain mode at runtime (without restart). Node 8, ES5 only.
   "Automatic" ReplayGain is Xplorio's own (rgauto.js): album or track gain depending on the queue.
   opts: mpd(cmd, cb(err, fields)), files: {mpdConf, volumioMpd} (tests), rg: RgAuto (optional) */
var fs = require('fs');

var MODES = ['off', 'track', 'album', 'auto'], MAX_XFADE = 60;
var FILES = {
  mpdConf: '/etc/mpd.conf',
  volumioMpd: '/data/configuration/music_service/mpd/config.json'
};

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
/* Volumio configuration: {"name": {"type": …, "value": …}} or plain {"name": value} */
function cfgValue(j, k) {
  if (!j || !Object.prototype.hasOwnProperty.call(j, k)) return undefined;
  var v = j[k];
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}
function yes(v) { return v === true || /^(yes|true|on|1)$/i.test(String(v)); }

/* volume_normalization: Volumio's setting first, else the MPD configuration; null = unknown */
function normalization(files) {
  var v = cfgValue(readJson(files.volumioMpd), 'volume_normalization');
  if (v !== undefined && v !== '') return yes(v);
  var conf;
  try { conf = fs.readFileSync(files.mpdConf, 'utf8'); } catch (e) { return null; }
  var m = /^\s*volume_normalization\s+"?(\w+)"?/m.exec(conf);
  return m ? yes(m[1]) : false;
}

/* validate input -> MPD commands; error code for invalid values */
function commands(body) {
  var cmds = [];
  if (body.crossfade !== undefined) {
    var s = String(body.crossfade);
    if (!/^\d{1,3}$/.test(s) || +s > MAX_XFADE) return {error: 'crossfade'};
    cmds.push('crossfade ' + (+s));
  }
  if (body.replaygain !== undefined) {
    if (MODES.indexOf(body.replaygain) < 0) return {error: 'replaygain'};
    cmds.push('replay_gain_mode ' + body.replaygain);
  }
  return cmds.length ? {cmds: cmds} : {error: 'leer'};
}

function Playback(opts) {
  opts = opts || {};
  this.mpd = opts.mpd;
  this.files = opts.files || FILES;
  this.rg = opts.rg || null;
}

Playback.prototype.read = function(cb) {
  var self = this;
  this.mpd('status', function(err, st){
    if (err) return cb({ok: false, error: 'mpd'});
    self.mpd('replay_gain_status', function(e2, rg){
      var mode = self.rg && self.rg.on ? 'auto' : (!e2 && rg.replay_gain_mode || 'off');
      cb({ok: true, crossfade: parseInt(st.xfade, 10) || 0, replaygain: mode,
          normalization: normalization(self.files)});
    });
  });
};

Playback.prototype.set = function(body, cb) {
  var self = this, c = commands(body || {});
  if (c.error) return cb(400, {ok: false, error: c.error});
  /* "auto" is not passed to MPD, rgauto.js sets album or track itself */
  var cmds = this.rg ? c.cmds.filter(function(x){ return x !== 'replay_gain_mode auto'; }) : c.cmds;
  (function next(i){
    if (i >= cmds.length) {
      if (!self.rg || body.replaygain === undefined) return self.read(function(r){ cb(200, r); });
      return self.rg.choose(body.replaygain, function(){ self.read(function(r){ cb(200, r); }); });
    }
    self.mpd(cmds[i], function(err){
      if (err) return cb(200, {ok: false, error: 'mpd'});
      next(i + 1);
    });
  })(0);
};

module.exports = {Playback: Playback, commands: commands, normalization: normalization, MODES: MODES, MAX_XFADE: MAX_XFADE};
