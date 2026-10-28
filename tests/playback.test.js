/* playback (tags/playback.js): crossfade and ReplayGain via MPD, read normalization and AutoDJ automatic mode */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var pb = require('../tags/playback.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-'));
function f(name, text) { var p = path.join(dir, name); if (text !== undefined) fs.writeFileSync(p, text); return p; }

t('input: crossfade as whole seconds 0–30, ReplayGain only known modes', function(){
  assert.deepStrictEqual(pb.commands({crossfade: 5}).cmds, ['crossfade 5']);
  assert.deepStrictEqual(pb.commands({crossfade: '0', replaygain: 'album'}).cmds, ['crossfade 0', 'replay_gain_mode album']);
  ['-1', '2.5', 'abc', 31, '5; kill'].forEach(function(x){ assert.strictEqual(pb.commands({crossfade: x}).error, 'crossfade', x); });
  assert.strictEqual(pb.commands({replaygain: 'loud'}).error, 'replaygain');
  assert.strictEqual(pb.commands({}).error, 'leer');
});

t('normalization: Volumio setting before mpd.conf, unknown without either', function(){
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

var sent = [], state = {xfade: '0', mode: 'off'};
function mpd(cmd, cb) {
  sent.push(cmd);
  var m;
  if (cmd === 'status') return cb(null, state.xfade === '0' ? {state: 'play'} : {state: 'play', xfade: state.xfade});
  if (cmd === 'replay_gain_status') return cb(null, {replay_gain_mode: state.mode});
  if ((m = /^crossfade (\d+)$/.exec(cmd))) { state.xfade = m[1]; return cb(null, {}); }
  if ((m = /^replay_gain_mode (\w+)$/.exec(cmd))) { state.mode = m[1]; return cb(null, {}); }
  cb(new Error('ACK unknown'));
}
var files = {mpdConf: f('nichts2.conf'), volumioMpd: f('fehlt2.json')};
var ctl = new pb.Playback({mpd: mpd, files: files});

t('read: MPD omits xfade at 0', function(){
  ctl.read(function(r){ assert.deepStrictEqual(r, {ok: true, crossfade: 0, replaygain: 'off', normalization: null}); });
});
t('set: commands to MPD, response with the new state', function(){
  sent = [];
  ctl.set({crossfade: 6, replaygain: 'track'}, function(c, r){
    assert.strictEqual(c, 200);
    assert.deepStrictEqual(sent.slice(0, 2), ['crossfade 6', 'replay_gain_mode track']);
    assert.strictEqual(r.crossfade, 6); assert.strictEqual(r.replaygain, 'track');
  });
  ctl.set({crossfade: 'x'}, function(c){ assert.strictEqual(c, 400); });
});
t('no MPD: error instead of values', function(){
  new pb.Playback({mpd: function(c, cb){ cb(new Error('gone')); }, files: files}).read(function(r){ assert.deepStrictEqual(r, {ok: false, error: 'mpd'}); });
});
t('applied gain: mode, fallback to the other value, auto by shuffle', function(){
  var both = {track: -6.5, album: -4}, onlyTrack = {track: -6.5, album: null};
  assert.deepStrictEqual(pb.applied('track', '0', both), {mode: 'track', db: -6.5});
  assert.deepStrictEqual(pb.applied('album', '0', both), {mode: 'album', db: -4});
  assert.deepStrictEqual(pb.applied('album', '0', onlyTrack), {mode: 'track', db: -6.5});
  assert.deepStrictEqual(pb.applied('auto', '1', both), {mode: 'track', db: -6.5});
  assert.deepStrictEqual(pb.applied('auto', '0', both), {mode: 'album', db: -4});
  assert.strictEqual(pb.applied('off', '0', both), null);
  assert.strictEqual(pb.applied('track', '0', {track: null, album: null}), null);
});
t('gain for the player view: mode from MPD, values from the file', function(){
  state.mode = 'album';
  ctl.gain(function(cb){ cb(null, {track: -6.5, album: -4}); }, function(r){ assert.deepStrictEqual(r, {ok: true, mode: 'album', gain: {mode: 'album', db: -4}}); });
  state.mode = 'off';
  ctl.gain(function(){ throw new Error('not read when off'); }, function(r){ assert.strictEqual(r.gain, null); });
});
console.log(n + ' checks');
