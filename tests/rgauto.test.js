/* ReplayGain "Automatic" (tags/rgauto.js): album gain inside an album, track gain for mixes and shuffle */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var rga = require('../tags/rgauto.js');
var pb = require('../tags/playback.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgauto-'));

function song(album, aa) { return {file: 'x', album: album, albumartist: aa || ''}; }
var A = song('Blue', 'Joni'), A2 = song('blue', 'JONI'), B = song('Rumours', 'Fleetwood Mac'), S = {file: 'http://stream'};

t('pick: neighbour from the same album gives album gain, otherwise track gain', function(){
  assert.strictEqual(rga.pick({random: '0'}, null, A, A2), 'album');
  assert.strictEqual(rga.pick({random: '0'}, A, A2, B), 'album');
  assert.strictEqual(rga.pick({random: '0'}, A, B, A), 'track');
  assert.strictEqual(rga.pick({random: '0'}, null, B, null), 'track');
  assert.strictEqual(rga.pick({random: '1'}, A, A2, A), 'track', 'shuffle');
  assert.strictEqual(rga.pick({random: '0'}, S, S, S), 'track', 'no album tag');
  assert.strictEqual(rga.pick({random: '0'}, A, null, A), null, 'nothing playing');
  assert.strictEqual(rga.pick({random: '0'}, song('Hits', 'X'), song('Hits', 'Y'), null), 'track', 'same title, other artist');
});

/* fake MPD: queue, current position, shuffle, mode */
var mpdState;
function reset(queue, pos, mode) { mpdState = {queue: queue, pos: pos, random: '0', mode: mode, sent: []}; }
function mpd(cmd, cb) {
  var m;
  mpdState.sent.push(cmd);
  if (cmd === 'replay_gain_status') return cb(null, {replay_gain_mode: mpdState.mode});
  if (cmd === 'status') {
    var st = {random: mpdState.random, playlistlength: String(mpdState.queue.length)};
    if (mpdState.pos !== null) st.song = String(mpdState.pos);
    return cb(null, st);
  }
  if ((m = /^playlistinfo (\d+)$/.exec(cmd))) return cb(null, mpdState.queue[+m[1]]);
  if ((m = /^replay_gain_mode (\w+)$/.exec(cmd))) { mpdState.mode = m[1]; return cb(null, {}); }
  cb(new Error('ACK unknown'));
}
function make(name) {
  var change = null;
  var r = new rga.RgAuto({file: path.join(dir, name), mpd: mpd, idle: function(fn){ change = fn; return function(){}; }});
  r.start();
  return {rg: r, change: function(){ change(); }};
}

t('off: does nothing as long as nobody chose "Automatic"', function(){
  reset([A, A2], 0, 'track');
  var x = make('off.json');
  x.change();
  assert.strictEqual(mpdState.mode, 'track');
  assert.strictEqual(x.rg.on, false);
});

t('Volumio or MPD on "auto": taken over, album then track as the queue moves into a mix', function(){
  reset([A, A2, B, song('Tusk', 'Fleetwood Mac')], 0, 'auto');
  var x = make('take.json');
  x.change();
  assert.strictEqual(x.rg.on, true);
  assert.strictEqual(mpdState.mode, 'album');
  mpdState.pos = 2; x.change();
  assert.strictEqual(mpdState.mode, 'track');
  mpdState.pos = 1; mpdState.random = '1'; x.change();
  assert.strictEqual(mpdState.mode, 'track', 'shuffle');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8')).auto, true);
});

t('a mode set elsewhere (e.g. AutoDJ) ends the automatic', function(){
  reset([A, A2], 0, 'auto');
  var x = make('else.json');
  x.change();
  assert.strictEqual(mpdState.mode, 'album');
  mpdState.mode = 'track'; x.change();
  assert.strictEqual(x.rg.on, false);
  mpdState.pos = 1; x.change();
  assert.strictEqual(mpdState.mode, 'track');
});

t('remembered across restarts', function(){
  fs.writeFileSync(path.join(dir, 'keep.json'), JSON.stringify({auto: true}));
  reset([B, A, A2], 2, 'off');
  var x = make('keep.json');
  x.change();
  assert.strictEqual(mpdState.mode, 'album');
});

t('Playback page: "Automatic" goes to rgauto, not to MPD; other modes switch it off', function(){
  reset([A, A2], 0, 'off');
  var x = make('page.json');
  var ctl = new pb.Playback({mpd: mpd, rg: x.rg, files: {mpdConf: path.join(dir, 'none.conf'), volumioMpd: path.join(dir, 'none.json')}});
  ctl.set({replaygain: 'auto'}, function(c, r){
    assert.strictEqual(c, 200);
    assert.strictEqual(r.replaygain, 'auto');
    assert.strictEqual(mpdState.mode, 'album');
    assert.ok(mpdState.sent.indexOf('replay_gain_mode auto') < 0);
  });
  ctl.set({replaygain: 'off'}, function(c, r){
    assert.strictEqual(r.replaygain, 'off');
    assert.strictEqual(x.rg.on, false);
  });
});
console.log(n + ' checks');
