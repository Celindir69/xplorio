/* Tests classifyQuality. The first six cases are real getState answers from the MX-Stream (trimmed to
   the relevant fields), those marked "[assumed]" are not measured.
   Run: node tests/quality.test.js */
var fs = require('fs'), vm = require('vm'), assert = require('assert');
vm.runInThisContext(fs.readFileSync(__dirname + '/../web/js/quality.js', 'utf8'));

var cases = [
  ['MP3 (MPD reports 24 bit)', {trackType:'mp3', samplerate:'44.1 kHz', bitdepth:'24 bit', service:'mpd'},
    'lossy', 'Lossy', ['44.1 kHz', 'MP3']],
  ['M4A CD-Rip', {trackType:'m4a', samplerate:'44.1 kHz', bitdepth:'16 bit', service:'mpd'},
    'lossless', 'Lossless', ['44.1 kHz', '16 bit', 'M4A']],
  ['M4A Hi-Res 96 kHz', {trackType:'m4a', samplerate:'96 kHz', bitdepth:'32 bit', service:'mpd'},
    'hires', 'Hi-Res', ['96 kHz', '32 bit', 'M4A']],
  ['DSF (SACD rip)', {trackType:'dsf', samplerate:'2.82 MHz', bitdepth:'1 bit', service:'mpd'},
    'dsd', 'DSD64', ['2.82 MHz', '1 bit', 'DSF']],
  ['web radio 192 kbps', {trackType:'webradio', samplerate:'', bitdepth:'', bitrate:'192 Kbps', service:'webradio'},
    'radio', 'Radio', ['192 kbps']],
  ['Tidal 16/44.1, 571 kbps', {trackType:'tidal', samplerate:'44.1 kHz', bitdepth:'16 bit', bitrate:'571 Kbps', service:'tidal'},
    'lossless', 'Lossless', ['44.1 kHz', '16 bit', 'TIDAL']],
  ['[assumed] Tidal Hi-Res 24/96', {trackType:'tidal', samplerate:'96 kHz', bitdepth:'24 bit', bitrate:'2900 Kbps', service:'tidal'},
    'hires', 'Hi-Res', ['96 kHz', '24 bit', 'TIDAL']],
  ['[assumed] Tidal AAC 320 kbps', {trackType:'tidal', samplerate:'44.1 kHz', bitdepth:'16 bit', bitrate:'320 Kbps', service:'tidal'},
    'lossy', 'Lossy', ['44.1 kHz', 'TIDAL', '320 kbps']],
  ['[assumed] FLAC 24/192', {trackType:'flac', samplerate:'192 kHz', bitdepth:'24 bit', service:'mpd'},
    'hires', 'Hi-Res', ['192 kHz', '24 bit', 'FLAC']],
  ['[assumed] FLAC 16/48', {trackType:'flac', samplerate:'48 kHz', bitdepth:'16 bit', service:'mpd'},
    'lossless', 'Lossless', ['48 kHz', '16 bit', 'FLAC']],
  ['[assumed] DSD128 (.dff)', {trackType:'dff', samplerate:'5.64 MHz', bitdepth:'1 bit', service:'mpd'},
    'dsd', 'DSD128', ['5.64 MHz', '1 bit', 'DFF']],
  ['[assumed] Spotify', {trackType:'spotify', samplerate:'44.1 kHz', bitdepth:'16 bit', bitrate:'320 Kbps', service:'spotify'},
    'lossy', 'Lossy', ['44.1 kHz', 'SPOTIFY', '320 kbps']],
  ['[assumed] unknown type', {trackType:'xyz', samplerate:'44.1 kHz', bitdepth:'16 bit', service:'mpd'},
    '', '', ['44.1 kHz', '16 bit', 'XYZ']],
  ['empty', {}, '', '', []]
];
var fail = 0;
cases.forEach(function(c){
  try {
    var r = classifyQuality(c[1]);
    assert.strictEqual(r.kind, c[2]); assert.strictEqual(r.label, c[3]); assert.deepStrictEqual(r.tech, c[4]);
    console.log('ok   ' + c[0] + '  ->  ' + (r.label || '(no badge)') + '  |  ' + r.tech.join(' · '));
  } catch (e) { fail++; console.log('FAIL ' + c[0] + ': ' + e.message.split('\n')[0]); }
});
// M4A configurable as unknown
var r = classifyQuality({trackType:'m4a', samplerate:'44.1 kHz', bitdepth:'16 bit'}, {M4A_LOSSLESS:false});
assert.strictEqual(r.kind, ''); console.log('ok   M4A_LOSSLESS=false  ->  (no badge)');
process.exit(fail ? 1 : 0);
