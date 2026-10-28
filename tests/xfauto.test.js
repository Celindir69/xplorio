/* crossfade "Automatic" (tags/xfauto.js): none inside an album, crossfade into another album or in mixes */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var xfa = require('../tags/xfauto.js');
var pb = require('../tags/playback.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfauto-'));

function song(album, aa) { return {file: 'x', album: album, albumartist: aa || ''}; }
var A = song('Blue', 'Joni'), A2 = song('Blue', 'Joni'), B = song('Rumours', 'Fleetwood Mac'), S = {file: 'http://stream'};

t('pick: 0 inside an album, the seconds into another album, a stream or the end', function(){
  assert.strictEqual(xfa.pick(A, A2, 8), 0);
  assert.strictEqual(xfa.pick(A, B, 8), 8);
  assert.strictEqual(xfa.pick(S, S, 8), 8, 'no album tag');
  assert.strictEqual(xfa.pick(A, null, 8), 8, 'last track');
  assert.strictEqual(xfa.pick(null, A, 8), null, 'nothing playing');
});

/* fake MPD: queue, current and next position (shuffle = any order), crossfade */
var m;
function reset(queue, song, next, xfade) { m = {queue: queue, song: song, next: next, xfade: xfade, sent: []}; }
function mpd(cmd, cb) {
  var x;
  m.sent.push(cmd);
  if (cmd === 'status') {
    var st = {};
    if (m.xfade) st.xfade = String(m.xfade);
    if (m.song !== null) st.song = String(m.song);
    if (m.next !== null) st.nextsong = String(m.next);
    return cb(null, st);
  }
  if (cmd === 'replay_gain_status') return cb(null, {replay_gain_mode: 'off'});
  if ((x = /^playlistinfo (\d+)$/.exec(cmd))) return cb(null, m.queue[+x[1]]);
  if ((x = /^crossfade (\d+)$/.exec(cmd))) { m.xfade = +x[1]; return cb(null, {}); }
  cb(new Error('ACK unknown'));
}

t('automatic: off inside the album, on at the change to the mix, follows shuffle via nextsong', function(){
  reset([A, A2, B, song('Tusk', 'Fleetwood Mac')], 0, 1, 0);
  var x = new xfa.XfAuto({file: path.join(dir, 'a.json'), mpd: mpd});
  x.choose(true, 8, function(){});
  assert.strictEqual(m.xfade, 0);
  m.song = 1; m.next = 2; x.check();
  assert.strictEqual(m.xfade, 8);
  m.song = 0; m.next = 1; x.check();
  assert.strictEqual(m.xfade, 0);
  m.next = 3; x.check();
  assert.strictEqual(m.xfade, 8, 'shuffle picked another album');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'a.json'), 'utf8')), {auto: true, seconds: 8});
});

t('a value set elsewhere (e.g. AutoDJ) ends the automatic; remembered across restarts', function(){
  reset([A, B], 0, 1, 0);
  var x = new xfa.XfAuto({file: path.join(dir, 'b.json'), mpd: mpd});
  x.choose(true, 6, function(){});
  assert.strictEqual(m.xfade, 6);
  m.xfade = 3; x.check();
  assert.strictEqual(x.on, false);
  fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({auto: true, seconds: 4}));
  reset([A, B], 0, 1, 0);
  var y = new xfa.XfAuto({file: path.join(dir, 'c.json'), mpd: mpd});
  y.check();
  assert.strictEqual(m.xfade, 4);
});

t('Playback page: "Automatic" with seconds goes to xfauto; a fixed value switches it off', function(){
  reset([A, A2], 0, 1, 0);
  var x = new xfa.XfAuto({file: path.join(dir, 'd.json'), mpd: mpd});
  var ctl = new pb.Playback({mpd: mpd, xf: x, files: {mpdConf: path.join(dir, 'none.conf'), volumioMpd: path.join(dir, 'none.json')}});
  ctl.set({crossfade: 7, crossfadeAuto: true}, function(c, r){
    assert.strictEqual(c, 200);
    assert.strictEqual(r.crossfadeAuto, true); assert.strictEqual(r.crossfadeSeconds, 7);
    assert.strictEqual(m.xfade, 0, 'inside the album');
    assert.ok(m.sent.indexOf('crossfade 7') < 0);
  });
  ctl.set({crossfade: 5}, function(c, r){
    assert.strictEqual(r.crossfadeAuto, false); assert.strictEqual(r.crossfade, 5);
  });
  ctl.set({crossfadeAuto: true}, function(c){ assert.strictEqual(c, 400, 'automatic needs seconds'); });
});
console.log(n + ' checks');
