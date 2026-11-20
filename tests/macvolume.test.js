/* volume slider on the Mac with the amplifier (macaudio.js ampOutput, GET /mac/volume): amplifier for a device output,
   MPD's volume for the system output (Bluetooth, AirPlay, Mac speakers) */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
var ma = require('../tags/macaudio.js');

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-vol-')), conf = path.join(dir, 'mpd.conf');
fs.writeFileSync(conf, 'music_directory "/m"\naudio_output {\n  type "osx"\n  name "' + ma.SYSTEM + '"\n}\naudio_output {\n  type "osx"\n  name "RME"\n  device "RME"\n}\n' +
                       'audio_output {\n  type "httpd"\n  name "Mobile"\n}\n');
var outs = [{id: 0, name: ma.SYSTEM, plugin: 'osx', enabled: false}, {id: 1, name: 'RME', plugin: 'osx', enabled: true}, {id: 2, name: 'Mobile', plugin: 'httpd', enabled: true}];
function mpd(cmds, cb) {
  var res = cmds.map(function(c){
    if (c === 'outputs') return [].concat.apply([], outs.map(function(o){ return ['outputid: ' + o.id, 'outputname: ' + o.name, 'plugin: ' + o.plugin, 'outputenabled: ' + (o.enabled ? 1 : 0)]; }));
    return [];
  });
  setImmediate(function(){ cb(null, res); });
}
var a = new ma.MacAudio({mpd: mpd, confFile: conf});
a.ampOutput(function(e, amp){
  assert.ifError(e); assert.strictEqual(amp, true);                           /* USB DAC into the amplifier */
  outs[1].enabled = false; outs[0].enabled = true;
  a.ampOutput(function(e2, amp2){
    assert.strictEqual(amp2, false);                                         /* system output: MPD's volume */
    outs[0].enabled = false;
    a.ampOutput(function(e3, amp3){
      assert.strictEqual(amp3, true);                                        /* only the stream to the phone: as before */
      console.log('ok   volume slider: amplifier for a device output, MPD for the system output, nothing on: amplifier');
      console.log('1 tests passed');
    });
  });
});
