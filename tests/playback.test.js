/* Wiedergabe (tags/playback.js): Crossfade und ReplayGain über MPD, Normalisierung und AutoDJ-Automatik lesen */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var pb = require('../tags/playback.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-'));
function f(name, text) { var p = path.join(dir, name); if (text !== undefined) fs.writeFileSync(p, text); return p; }

t('Eingaben: Crossfade als ganze Sekunden 0–30, ReplayGain nur bekannte Modi', function(){
  assert.deepStrictEqual(pb.commands({crossfade: 5}).cmds, ['crossfade 5']);
  assert.deepStrictEqual(pb.commands({crossfade: '0', replaygain: 'album'}).cmds, ['crossfade 0', 'replay_gain_mode album']);
  ['-1', '2.5', 'abc', 31, '5; kill'].forEach(function(x){ assert.strictEqual(pb.commands({crossfade: x}).error, 'crossfade', x); });
  assert.strictEqual(pb.commands({replaygain: 'loud'}).error, 'replaygain');
  assert.strictEqual(pb.commands({}).error, 'leer');
});

t('Normalisierung: Volumios Einstellung vor mpd.conf, ohne beides unbekannt', function(){
  var files = {volumioMpd: f('v.json', JSON.stringify({volume_normalization: {type: 'boolean', value: true}})), mpdConf: f('mpd.conf', 'volume_normalization "no"\n')};
  assert.strictEqual(pb.normalization(files), true);
  files.volumioMpd = f('fehlt.json');
  assert.strictEqual(pb.normalization(files), false);
  f('mpd2.conf', '# volume_normalization "yes"\nvolume_normalization\t"yes"\n');
  files.mpdConf = path.join(dir, 'mpd2.conf');
  assert.strictEqual(pb.normalization(files), true);
  files.mpdConf = f('nichts.conf');
  assert.strictEqual(pb.normalization(files), null);
});

t('AutoDJ: nicht installiert = null, sonst Automatik für Angleichen und Crossfade', function(){
  assert.strictEqual(pb.autodjInfo({autodj: f('kein.json')}), null);
  var p = f('adj.json', JSON.stringify({autoReplayGain: {type: 'boolean', value: true}, autoCrossfadeSeconds: {type: 'string', value: '6'}}));
  assert.deepStrictEqual(pb.autodjInfo({autodj: p}), {replayGain: true, crossfade: 6});
  p = f('adj2.json', JSON.stringify({autoReplayGain: {value: false}, autoCrossfadeSeconds: {value: ''}}));
  assert.deepStrictEqual(pb.autodjInfo({autodj: p}), {replayGain: false, crossfade: 0});
});

var sent = [], state = {xfade: '0', mode: 'off'};
function mpd(cmd, cb) {
  sent.push(cmd);
  var m;
  if (cmd === 'status') return cb(null, state.xfade === '0' ? {state: 'play'} : {state: 'play', xfade: state.xfade});
  if (cmd === 'replay_gain_status') return cb(null, {replay_gain_mode: state.mode});
  if ((m = /^crossfade (\d+)$/.exec(cmd))) { state.xfade = m[1]; return cb(null, {}); }
  if ((m = /^replay_gain_mode (\w+)$/.exec(cmd))) { state.mode = m[1]; return cb(null, {}); }
  cb(new Error('ACK unbekannt'));
}
var files = {mpdConf: f('nichts2.conf'), volumioMpd: f('fehlt2.json'), autodj: f('fehlt3.json')};
var ctl = new pb.Playback({mpd: mpd, files: files});

t('lesen: MPD lässt xfade bei 0 weg', function(){
  ctl.read(function(r){ assert.deepStrictEqual(r, {ok: true, crossfade: 0, replaygain: 'off', normalization: null, autodj: null}); });
});
t('setzen: Befehle an MPD, Antwort mit dem neuen Stand', function(){
  sent = [];
  ctl.set({crossfade: 6, replaygain: 'track'}, function(c, r){
    assert.strictEqual(c, 200);
    assert.deepStrictEqual(sent.slice(0, 2), ['crossfade 6', 'replay_gain_mode track']);
    assert.strictEqual(r.crossfade, 6); assert.strictEqual(r.replaygain, 'track');
  });
  ctl.set({crossfade: 'x'}, function(c){ assert.strictEqual(c, 400); });
});
t('ohne MPD: Fehler statt Werte', function(){
  new pb.Playback({mpd: function(c, cb){ cb(new Error('weg')); }, files: files}).read(function(r){ assert.deepStrictEqual(r, {ok: false, error: 'mpd'}); });
});
console.log(n + ' Prüfungen');
