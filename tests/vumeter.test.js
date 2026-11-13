/* VU meter (tags/vumeter.js): fifo output found, format, levels per 25 ms window, pacing; GET /vu end to end with a fake MPD
   and a real fifo (output switched on while someone watches, off again afterwards) */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http'), cp = require('child_process');
var vu = require('../tags/vumeter.js'), remote = require('../tags/remote.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var CONF = 'audio_output {\n  type "alsa"\n  name "alsa"\n}\n' +
           'audio_output {\n  type "fifo"\n  name "multiroom"\n  path "/tmp/snapfifo"\n  format "48000:16:2"\n}\n' +
           'audio_output {\n  type "fifo"\n  name "VU"\n  path "/tmp/mpd-vu.fifo"\n  format "44100:16:2"\n  enabled "no"\n}\n';
var LINES = ['outputid: 0', 'outputname: alsa', 'outputenabled: 1', 'outputid: 1', 'outputname: multiroom', 'outputenabled: 1',
             'outputid: 2', 'outputname: VU', 'outputenabled: 0'];

t('fifo output with "VU" in its name, never another fifo (Snapcast)', function(){
  var f = vu.find(remote.parseOutputs(LINES), remote.confOutputs(CONF));
  assert.deepStrictEqual(f, {id: 2, enabled: false, name: 'VU', path: '/tmp/mpd-vu.fifo', format: '44100:16:2'});
  assert.strictEqual(vu.find(remote.parseOutputs(LINES.slice(0, 6)), remote.confOutputs(CONF)), null);
  var newer = remote.parseOutputs(['outputid: 0', 'outputname: vu-meter', 'plugin: fifo', 'outputenabled: 1']);
  assert.strictEqual(vu.find(newer, []).id, 0);                     /* newer MPD reports the plugin itself */
});

t('format: fixed rate, 16/24/32 bit, mono or stereo; otherwise not readable', function(){
  assert.deepStrictEqual(vu.parseFormat('44100:16:2'), {rate: 44100, bits: 16, channels: 2, bytes: 2});
  assert.deepStrictEqual(vu.parseFormat('48000:24:1'), {rate: 48000, bits: 24, channels: 1, bytes: 4});
  ['', '*:16:2', '44100:*:2', '44100:16:6', 'dsd64:2', '44100:f:2'].forEach(function(s){ assert.strictEqual(vu.parseFormat(s), null, s); });
});

function sine(fmt, frames, ampL, ampR) {
  var b = Buffer.alloc(frames * fmt.channels * fmt.bytes), full = fmt.bits === 16 ? 32767 : 8388607;
  for (var i = 0; i < frames; i++) {
    var s = Math.sin(2 * Math.PI * 1000 * i / fmt.rate);
    [ampL, ampR].slice(0, fmt.channels).forEach(function(a, ch){
      var v = Math.round(s * a * full), o = (i * fmt.channels + ch) * fmt.bytes;
      if (fmt.bytes === 2) b.writeInt16LE(v, o); else b.writeInt32LE(v, o);
    });
  }
  return b;
}

t('levels: sine at full scale = -3 dBFS RMS, 0 dBFS peak; half = -6 dB lower; one window per 25 ms', function(){
  var fmt = vu.parseFormat('44100:16:2'), an = vu.analyzer(fmt);
  var w = an.push(sine(fmt, 4412, 1, 0.5));                         /* 100 ms (4 × 1103 frames) */
  assert.strictEqual(w.length, 4);
  assert.ok(Math.abs(w[1][0] + 3) < 0.15 && Math.abs(w[1][1]) < 0.15, JSON.stringify(w[1]));
  assert.ok(Math.abs(w[1][2] + 9) < 0.2 && Math.abs(w[1][3] + 6) < 0.2, JSON.stringify(w[1]));
  assert.deepStrictEqual(vu.analyzer(fmt).push(Buffer.alloc(4 * 1103)), [[-99, -99, -99, -99]]);   /* silence */
});

t('levels: frames split across chunks, 24 bit, mono on both sides', function(){
  var fmt = vu.parseFormat('48000:24:1'), an = vu.analyzer(fmt), b = sine(fmt, 1200, 0.1, 0), out = [];
  [b.slice(0, 7), b.slice(7, 2001), b.slice(2001)].forEach(function(c){ out = out.concat(an.push(c)); });
  assert.strictEqual(out.length, 1);
  assert.ok(Math.abs(out[0][0] + 23) < 0.2, JSON.stringify(out[0]));
  assert.strictEqual(out[0][0], out[0][2]);
});

t('pacing: one window per tick, a long queue is shortened from the front', function(){
  var p = vu.pacer(3);
  p.add([[1], [2], [3], [4], [5]]);
  assert.strictEqual(p.size(), 3);
  assert.deepStrictEqual([p.next(), p.next(), p.next(), p.next()], [[3], [4], [5], null]);
});

t('pacing: a backlog drains at double speed, peaks kept; ticks a little slow do not build up a lag', function(){
  var p = vu.pacer(12, 2);
  p.add([[-20, -3], [-10, -9], [-30, -1], [-25, -5], [-15, -8]]);
  assert.deepStrictEqual(p.next(), [-10, -3]);          /* 5 waiting: two as one, the louder of each */
  assert.deepStrictEqual([p.next(), p.next(), p.next(), p.next()], [[-30, -1], [-25, -5], [-15, -8], null]);
  /* MPD delivers 40 windows per second, the timer ticks only 37 times: the queue stays short */
  var q = vu.pacer(12, 2), arrived = 0, most = 0;
  for (var ms = 0; ms < 60000; ms++) {
    if (ms % 25 === 0) { q.add([[arrived++]]); }
    if (ms % 27 === 0) { q.next(); most = Math.max(most, q.size()); }
  }
  assert.ok(most <= 3, 'queue grew to ' + most);
});

/* end to end: fake MPD, mpd.conf with a VU output on a real fifo */
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vu-')), fifo = path.join(dir, 'vu.fifo');
cp.execFileSync('mkfifo', [fifo]);
fs.writeFileSync(path.join(dir, 'mpd.conf'), CONF.replace('/tmp/mpd-vu.fifo', fifo));
var enabled = false, cmds = [];
var mpd = net.createServer(function(c){
  c.write('OK MPD 0.21.0\n');
  var b = '';
  c.on('data', function(d){
    b += d;
    var i;
    while ((i = b.indexOf('\n')) >= 0) {
      var l = b.slice(0, i); b = b.slice(i + 1);
      if (l === 'outputs') { c.write(LINES.slice(0, 8).join('\n') + '\noutputenabled: ' + (enabled ? 1 : 0) + '\nOK\n'); continue; }
      var m = /^(enable|disable)output 2$/.exec(l);
      if (m) { enabled = m[1] === 'enable'; cmds.push(l); c.write('OK\n'); }
    }
  });
});
mpd.listen(0, function(){
  process.env.TAGS_LOG = path.join(dir, 'changes.jsonl');
  process.env.APP_CONFIG_DIR = dir;
  process.env.MPD_PORT = String(mpd.address().port);
  process.env.MPD_CONF = path.join(dir, 'mpd.conf');
  var svc = require('../tags/tag-service.js').server;
  svc.listen(0, function(){
    var port = svc.address().port;
    http.get({port: port, path: '/vustatus'}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){
        t('/vustatus: VU output available', function(){ assert.deepStrictEqual(JSON.parse(d), {ok: true, available: true, reason: '', format: '44100:16:2'}); });
        var got = [];
        var req = http.get({port: port, path: '/vu'}, function(r){
          t('/vu: event stream', function(){ assert.strictEqual(r.statusCode, 200); assert.ok(/text\/event-stream/.test(r.headers['content-type'])); });
          r.setEncoding('utf8');
          r.on('data', function(c){ c.split('\n').forEach(function(l){ if (l.indexOf('data: ') === 0) got.push(l.slice(6).split(',').map(Number)); }); });
          var fmt = vu.parseFormat('44100:16:2'), pcm = sine(fmt, 4412, 0.5, 0.25), wfd = null;
          (function write(tries){                                      /* like MPD: open the writing end once the reader is there */
            try { wfd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK); }
            catch (e) { if (tries < 100) return setTimeout(function(){ write(tries + 1); }, 20); throw e; }
            fs.writeSync(wfd, pcm);
            setTimeout(function(){
              t('/vu: output switched on, levels arrive evenly, a block of 4 windows as 3 lines (catching up)', function(){
                assert.deepStrictEqual(cmds, ['enableoutput 2']);
                assert.strictEqual(got.length, 3);
                assert.ok(Math.abs(got[1][0] + 9) < 0.2 && Math.abs(got[1][2] + 15) < 0.2, JSON.stringify(got[1]));
              });
              fs.closeSync(wfd);
              req.abort();
              setTimeout(function(){
                t('nobody watching: output switched off again after the grace period', function(){
                  assert.deepStrictEqual(cmds, ['enableoutput 2', 'disableoutput 2']);
                });
                console.log(n + ' checks');
                process.exit(0);
              }, 5600);
            }, 400);
          })(0);
        });
      });
    });
  });
});
