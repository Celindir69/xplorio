/* playback on this device (tags/remote.js): outputs from mpd.conf and MPD, mode, commands, ranges for Safari */
var assert = require('assert');
var r = require('../tags/remote.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var CONF = 'audio_output {\n  type "alsa"\n  name "alsa"\n  device "hw:1,0"\n}\n' +
           'audio_output {\n    type "fifo"\n    enabled "no"\n    name "multiroom"\n    path "/tmp/snapfifo"\n}\n' +
           '# audio_output { type "httpd" }\naudio_output {\n  type      "httpd"\n  name      "Mobile"\n  encoder   "lame"\n  port      "8000"  # mp3\n}\n';
var LINES = ['outputid: 0', 'outputname: alsa', 'outputenabled: 1', 'outputid: 1', 'outputname: multiroom', 'outputenabled: 0',
             'outputid: 2', 'outputname: Mobile', 'outputenabled: 0'];

t('mpd.conf and outputs: stream output found by its type, amplifier output, port', function(){
  var c = r.confOutputs(CONF);
  assert.deepStrictEqual(c.map(function(o){ return [o.type, o.name, o.port]; }), [['alsa', 'alsa', 8000], ['fifo', 'multiroom', 8000], ['httpd', 'Mobile', 8000]]);
  var f = r.find(r.parseOutputs(LINES), c);
  assert.deepStrictEqual(f.stream, {id: 2, port: 8000, enabled: false, name: 'Mobile'});
  assert.deepStrictEqual(f.alsa, [{id: 0, enabled: true}]);
  assert.strictEqual(r.modeOf(f), 'lokal');
  assert.strictEqual(r.find(r.parseOutputs(LINES.slice(0, 6)), c), null);       /* no stream output -> nothing */
});

t('newer MPD reports the plugin itself', function(){
  var f = r.find(r.parseOutputs(['outputid: 0', 'outputname: A', 'plugin: alsa', 'outputenabled: 0', 'outputid: 1', 'outputname: S', 'plugin: httpd', 'outputenabled: 1']), []);
  assert.strictEqual(r.modeOf(f), 'remote');
});

t('commands per mode', function(){
  var f = r.find(r.parseOutputs(LINES), r.confOutputs(CONF));
  assert.deepStrictEqual(r.commands(f, 'remote'), ['disableoutput 0', 'enableoutput 2']);
  assert.deepStrictEqual(r.commands(f, 'both'), ['enableoutput 0', 'enableoutput 2']);
  assert.deepStrictEqual(r.commands(f, 'lokal'), ['enableoutput 0', 'disableoutput 2']);
  assert.strictEqual(r.commands({stream: f.stream, alsa: []}, 'remote'), null);
});

t('ranges: probe "bytes=0-1", open end, no range', function(){
  var a = r.rangeAnswer('bytes=0-1');
  assert.strictEqual(a.status, 206); assert.strictEqual(a.limit, 2); assert.strictEqual(a.headers['Content-Range'], 'bytes 0-1/2147483647');
  var b = r.rangeAnswer('bytes=0-');
  assert.strictEqual(b.status, 206); assert.strictEqual(b.limit, 2147483647);
  assert.strictEqual(r.rangeAnswer('').status, 200);
});

console.log(n + ' checks passed');
