/* Seite „Wiedergabe“ (Zahnrad-Menü): Crossfade und ReplayGain direkt in MPD, dazu zum Anzeigen Volumios
   Normalisierung (volume_normalization, steht in der MPD-Konfiguration) und die Automatik des AutoDJ-Plugins.
   Crossfade und ReplayGain-Modus setzt MPD zur Laufzeit (ohne Neustart). Node 8, nur ES5.
   opts: mpd(cmd, cb(err, felder)), files: {mpdConf, volumioMpd, autodj} (Tests) */
var fs = require('fs');

var MODES = ['off', 'track', 'album', 'auto'], MAX_XFADE = 30;
var FILES = {
  mpdConf: '/etc/mpd.conf',
  volumioMpd: '/data/configuration/music_service/mpd/config.json',
  autodj: '/data/configuration/miscellanea/volumio_autodj/config.json'
};

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
/* Volumio-Konfiguration: {"name": {"type": …, "value": …}} oder schlicht {"name": wert} */
function cfgValue(j, k) {
  if (!j || !Object.prototype.hasOwnProperty.call(j, k)) return undefined;
  var v = j[k];
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}
function yes(v) { return v === true || /^(yes|true|on|1)$/i.test(String(v)); }

/* volume_normalization: erst Volumios Einstellung, sonst die MPD-Konfiguration; null = unbekannt */
function normalization(files) {
  var v = cfgValue(readJson(files.volumioMpd), 'volume_normalization');
  if (v !== undefined && v !== '') return yes(v);
  var conf;
  try { conf = fs.readFileSync(files.mpdConf, 'utf8'); } catch (e) { return null; }
  var m = /^\s*volume_normalization\s+"?(\w+)"?/m.exec(conf);
  return m ? yes(m[1]) : false;
}

/* AutoDJ-Plugin: installiert? Automatik für Angleichen und Crossfade an? */
function autodjInfo(files) {
  var j = readJson(files.autodj);
  if (!j) return null;
  var xf = parseInt(cfgValue(j, 'autoCrossfadeSeconds'), 10);
  return {replayGain: yes(cfgValue(j, 'autoReplayGain')), crossfade: xf > 0 ? xf : 0};
}

/* Eingabe prüfen -> MPD-Befehle; Fehlertext bei ungültigen Werten */
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
}

Playback.prototype.read = function(cb) {
  var self = this;
  this.mpd('status', function(err, st){
    if (err) return cb({ok: false, error: 'mpd'});
    self.mpd('replay_gain_status', function(e2, rg){
      cb({ok: true, crossfade: parseInt(st.xfade, 10) || 0, replaygain: !e2 && rg.replay_gain_mode || 'off',
          normalization: normalization(self.files), autodj: autodjInfo(self.files)});
    });
  });
};

Playback.prototype.set = function(body, cb) {
  var self = this, c = commands(body || {});
  if (c.error) return cb(400, {ok: false, error: c.error});
  (function next(i){
    if (i >= c.cmds.length) return self.read(function(r){ cb(200, r); });
    self.mpd(c.cmds[i], function(err){
      if (err) return cb(200, {ok: false, error: 'mpd'});
      next(i + 1);
    });
  })(0);
};

module.exports = {Playback: Playback, commands: commands, normalization: normalization, autodjInfo: autodjInfo, MODES: MODES, MAX_XFADE: MAX_XFADE};
