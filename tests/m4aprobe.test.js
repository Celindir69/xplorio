/* m4a codec on the player itself (tags/m4aprobe.js) and the best version of duplicate albums with it */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var m4a = require('../tags/m4aprobe.js'), duplicates = require('../tags/duplicates.js'), lc = require('../tags/libcheck.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
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

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'm4a-'));
['USB/CD', 'USB/HD', 'USB/AAC'].forEach(function(d){ fs.mkdirSync(path.join(root, d), {recursive: true}); });
fs.writeFileSync(path.join(root, 'USB/CD/01.m4a'), Buffer.concat([ftyp, box('moov', Buffer.concat([box('mvhd', Buffer.alloc(100)), trak('soun', 'alac', 16, 44100)])), mdat(1000)]));
fs.writeFileSync(path.join(root, 'USB/HD/01.m4a'), Buffer.concat([ftyp, box('free', Buffer.alloc(40)), mdat(200000), box('moov', Buffer.concat([box('mvhd', Buffer.alloc(100)), trak('soun', 'alac', 24, 192000)]))]));
fs.writeFileSync(path.join(root, 'USB/AAC/01.m4a'), Buffer.concat([ftyp, box('moov', Buffer.concat([trak('soun', 'aac', 0, 44100)])), mdat(1000)]));
function S(file, format) { return {file: file, artist: 'David Gray', albumartist: '', album: 'A New Day', title: 'One', track: '1', disc: '', time: '200', format: format}; }
m4a.probe(path.join(root, 'USB/HD/01.m4a'), function(r){
  t('probe: ALAC with resolution, also with moov after mdat', function(){ assert.deepStrictEqual(r, {codec: 'alac', bits: 24, rate: 192000}); });
  /* MPD reports float samples for the hi-res ALAC, as for AAC: without the probe the CD version would win */
  var songs = [S('USB/CD/01.m4a', '44100:16:2'), S('USB/HD/01.m4a', '192000:f:2'), S('USB/AAC/01.m4a', '')];
  t('without probe: wrong best version (MPD format)', function(){
    assert.strictEqual(duplicates.find(songs, lc.artistKey)[0].versions[0].dirs[0], 'USB/CD');
  });
  m4a.fixFormats(songs, {'USB/CD': 1, 'USB/HD': 1, 'USB/AAC': 1}, root, function(){
    t('with probe: 24/192 before 16/44.1 before AAC, shown as ALAC 24/192', function(){
      var v = duplicates.find(songs, lc.artistKey)[0].versions;
      assert.deepStrictEqual(v.map(function(x){ return [x.dirs[0], x.format]; }), [['USB/HD', 'ALAC 24/192'], ['USB/CD', 'ALAC 16/44.1'], ['USB/AAC', 'AAC']]);
    });
    console.log(n + ' checks');
  });
});
