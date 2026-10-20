/* Tests the m4a codec detection (mp4probe.js) with synthetic MP4 files and a small server
   with range requests, plus the related classification in quality.js. Run: node tests/mp4probe.test.js */
var fs = require('fs'), vm = require('vm'), http = require('http'), assert = require('assert');
global.window = { APP_CONFIG: {} };
vm.runInThisContext(fs.readFileSync(__dirname + '/../web/js/quality.js', 'utf8'));
vm.runInThisContext(fs.readFileSync(__dirname + '/../web/js/mp4probe.js', 'utf8'));

/* ---- building blocks for test files ---- */
function u32(n) { var b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function box(type, payload) { payload = payload || Buffer.alloc(0); return Buffer.concat([u32(payload.length + 8), Buffer.from(type, 'latin1'), payload]); }
function sampleEntryFields(rate) {
  var b = Buffer.alloc(28); b.writeUInt16BE(1, 6); b.writeUInt16BE(2, 16); b.writeUInt16BE(16, 18); b.writeUInt32BE(rate * 65536 >>> 0, 24); return b;
}
function alacCfg(bits, rate) {
  var c = Buffer.alloc(24); c.writeUInt32BE(4096, 0); c[5] = bits; c[9] = 2; c.writeUInt32BE(rate, 20);
  return Buffer.concat([u32(0), c]);                       /* version/flags + ALACSpecificConfig */
}
function stsd(kind, bits, rate) {
  var inner = kind === 'alac' ? Buffer.concat([sampleEntryFields(rate), box('alac', alacCfg(bits, rate))])
                              : Buffer.concat([sampleEntryFields(rate), box('esds', Buffer.alloc(30))]);
  return box('stsd', Buffer.concat([u32(0), u32(1), box(kind === 'alac' ? 'alac' : 'mp4a', inner)]));
}
function trak(handler, kind, bits, rate) {
  var hdlr = box('hdlr', Buffer.concat([u32(0), u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(13)]));
  var stbl = box('stbl', Buffer.concat([stsd(kind, bits, rate), box('stts', Buffer.alloc(8))]));
  return box('trak', Buffer.concat([box('tkhd', Buffer.alloc(84)), box('mdia', Buffer.concat([box('mdhd', Buffer.alloc(24)), hdlr, box('minf', Buffer.concat([box('smhd', Buffer.alloc(8)), stbl]))]))]));
}
var ftyp = box('ftyp', Buffer.concat([Buffer.from('M4A ', 'latin1'), u32(0), Buffer.from('M4A mp42isom', 'latin1')]));
function mdat(n) { return box('mdat', Buffer.alloc(n, 7)); }
var FILES = {
  '/music/mnt/USB/alac-front.m4a': Buffer.concat([ftyp, box('moov', Buffer.concat([box('mvhd', Buffer.alloc(100)), trak('soun', 'alac', 24, 96000)])), mdat(1500000)]),
  '/music/mnt/USB/aac-end.m4a':    Buffer.concat([ftyp, box('free', Buffer.alloc(40)), mdat(2500000), box('moov', Buffer.concat([box('mvhd', Buffer.alloc(100)), trak('soun', 'aac', 0, 44100)]))]),
  '/music/mnt/USB/video-first.m4a':Buffer.concat([ftyp, box('moov', Buffer.concat([trak('vide', 'aac', 0, 0), trak('soun', 'alac', 16, 44100)])), mdat(1000)]),
  '/music/mnt/USB/broken.m4a':     Buffer.concat([ftyp, Buffer.alloc(64, 0xff)])
};
var requests = [], noRange = false;
var srv = http.createServer(function(q, r){
  var path = decodeURIComponent(q.url), f = FILES[path];
  if (!f) { r.statusCode = 404; return r.end(); }
  var m = /bytes=(\d+)-(\d+)/.exec(q.headers.range || '');
  requests.push(path.split('/').pop() + ' ' + (q.headers.range || '(no range)'));
  if (noRange || !m) { r.statusCode = 200; return r.end(f); }
  var a = +m[1], b = Math.min(+m[2], f.length - 1);
  if (a >= f.length) { r.statusCode = 416; return r.end(); }
  r.statusCode = 206; r.setHeader('content-range', 'bytes ' + a + '-' + b + '/' + f.length); r.end(f.slice(a, b + 1));
});

var fail = 0;
function t(name, fn) { return Promise.resolve().then(fn).then(function(){ console.log('ok   ' + name); }, function(e){ fail++; console.log('FAIL ' + name + ': ' + String(e.message).split('\n')[0]); }); }

srv.listen(0, function(){
  MP4_BASE = 'http://127.0.0.1:' + srv.address().port;
  var steps = Promise.resolve();
  function add(name, fn) { steps = steps.then(function(){ return t(name, fn); }); }

  add('URLs: mnt/…, music-library/…, INTERNAL/…', function(){
    MP4_BASE = '';
    assert.deepStrictEqual(mp4Candidates('mnt/USB/a b/x (1).m4a'), ['/music/mnt/USB/a%20b/x%20(1).m4a']);
    assert.deepStrictEqual(mp4Candidates('music-library/USB/Hi Res/x.m4a'), ['/music/mnt/USB/Hi%20Res/x.m4a']);
    assert.deepStrictEqual(mp4Candidates('INTERNAL/x.m4a'), ['/music/mnt/INTERNAL/x.m4a', '/music/data/INTERNAL/x.m4a']);
    assert.deepStrictEqual(mp4Candidates('music-library/INTERNAL/x.m4a'), ['/music/mnt/INTERNAL/x.m4a', '/music/data/INTERNAL/x.m4a']);
    MP4_BASE = 'http://127.0.0.1:' + srv.address().port;
  });
  add('ALAC, moov at the front: codec alac, 24 bit, 96 kHz', function(){
    return mp4Codec('mnt/USB/alac-front.m4a').then(function(r){ assert.deepStrictEqual(r, {codec:'alac', bits:24, rate:96000}); });
  });
  add('AAC, moov at the end after 2.5 MB mdat: codec aac', function(){
    requests.length = 0;
    return mp4Codec('mnt/USB/aac-end.m4a').then(function(r){
      assert.strictEqual(r.codec, 'aac');
      var total = requests.length; assert(total <= 4, 'too many requests: ' + requests.join(' | '));
    });
  });
  add('audio track after video track: takes the audio track', function(){
    return mp4Codec('mnt/USB/video-first.m4a').then(function(r){ assert.strictEqual(r.codec, 'alac'); assert.strictEqual(r.bits, 16); });
  });
  add('broken file, missing file: false', function(){
    return Promise.all([mp4Codec('mnt/USB/broken.m4a'), mp4Codec('mnt/USB/does-not-exist.m4a')]).then(function(r){ assert.deepStrictEqual(r, [false, false]); });
  });
  add('server without range requests: load nothing big, false', function(){
    noRange = true; delete mp4Cache['mnt/USB/alac-front.m4a'];
    return mp4Codec('mnt/USB/alac-front.m4a').then(function(r){ noRange = false; assert.strictEqual(r, false); });
  });
  add('cache: second call without request', function(){
    requests.length = 0;
    return mp4Codec('mnt/USB/aac-end.m4a').then(function(){ assert.strictEqual(requests.length, 0); });
  });
  add('classification: ALAC 24 bit/96 kHz -> Hi-Res, tech line with 24 bit (MPD reports 32)', function(){
    var r = classifyQuality({trackType:'m4a', samplerate:'96 kHz', bitdepth:'32 bit', fileCodec:{codec:'alac', bits:24}});
    assert.strictEqual(r.label, 'Hi-Res'); assert.deepStrictEqual(r.tech, ['96 kHz', '24 bit', 'M4A']);
  });
  add('classification: ALAC 16 bit -> Lossless', function(){
    var r = classifyQuality({trackType:'m4a', samplerate:'44.1 kHz', bitdepth:'16 bit', fileCodec:{codec:'alac', bits:16}});
    assert.strictEqual(r.label, 'Lossless'); assert.deepStrictEqual(r.tech, ['44.1 kHz', '16 bit', 'M4A']);
  });
  add('classification: AAC (even if MPD reports 32 bit) -> Lossy, AAC', function(){
    var r = classifyQuality({trackType:'m4a', samplerate:'44.1 kHz', bitdepth:'32 bit', fileCodec:{codec:'aac'}});
    assert.strictEqual(r.label, 'Lossy'); assert.deepStrictEqual(r.tech, ['44.1 kHz', 'AAC']);
  });
  add('classification: probe still running -> no badge', function(){
    var st = {trackType:'m4a', samplerate:'44.1 kHz', bitdepth:'16 bit'}; st.fileCodec = undefined;
    assert.strictEqual(classifyQuality(st).kind, '');
  });
  add('classification: probe failed -> M4A_LOSSLESS decides', function(){
    var st = {trackType:'m4a', samplerate:'44.1 kHz', bitdepth:'16 bit', fileCodec:false};
    assert.strictEqual(classifyQuality(st).label, 'Lossless');
    assert.strictEqual(classifyQuality(st, {M4A_LOSSLESS:false}).kind, '');
  });
  add('mp4Attach: tracks without probe (radio, mp3, http URL)', function(){
    var a = {trackType:'mp3', uri:'mnt/USB/x.mp3'}, b = {trackType:'m4a', uri:'http://x/y.m4a'};
    mp4Attach(a, function(){}); mp4Attach(b, function(){});
    assert(!a.hasOwnProperty('fileCodec') && !b.hasOwnProperty('fileCodec'));
  });
  add('mp4Attach: m4a -> first undefined, then result via repaint', function(){
    delete mp4Cache['mnt/USB/video-first.m4a'];
    var st = {trackType:'m4a', uri:'mnt/USB/video-first.m4a'};
    return new Promise(function(res){ mp4Attach(st, res); assert(st.hasOwnProperty('fileCodec') && st.fileCodec === undefined); })
      .then(function(){ var again = {trackType:'m4a', uri:'mnt/USB/video-first.m4a'}; mp4Attach(again, function(){}); assert.strictEqual(again.fileCodec.codec, 'alac'); });
  });
  steps.then(function(){ srv.close(); process.exit(fail ? 1 : 0); });
});
