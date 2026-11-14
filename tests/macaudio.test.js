/* Audio output on the Mac (tags/macaudio.js): devices -> MPD outputs, switching, device scan with MPD restart */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ma = require('../tags/macaudio.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); }); }

var PROFILER = {SPAudioDataType: [{_name: 'Devices', _items: [
  {_name: 'RME ADI-2 DAC', coreaudio_device_output: 2, coreaudio_device_transport: 'coreaudio_device_type_usb', coreaudio_device_srate: 768000},
  {_name: 'MacBook Pro-Lautsprecher', coreaudio_device_output: 2, coreaudio_device_transport: 'coreaudio_device_type_builtin'},
  {_name: 'MacBook Pro-Mikrofon', coreaudio_device_input: 1, coreaudio_device_transport: 'coreaudio_device_type_builtin'},
  {_name: 'Wohnzimmer', coreaudio_device_output: 2, coreaudio_device_transport: 'coreaudio_device_type_airplay'},
  {_name: 'Say "Hi"', coreaudio_device_output: 2}
]}]};
var CONF = 'music_directory "/m"\nport "6600"\naudio_output {\n  type       "osx"\n  name       "Mac"\n  mixer_type "software"\n}\n' +
           'audio_output {\n  type "fifo"\n  name "vu"\n  path "/tmp/vu"\n}\n';

t('devices: only those that play, with their kind', function(){
  assert.deepStrictEqual(ma.parseDevices(JSON.stringify(PROFILER)), [
    {name: 'RME ADI-2 DAC', kind: 'usb'}, {name: 'MacBook Pro-Lautsprecher', kind: 'builtin'}, {name: 'Wohnzimmer', kind: 'airplay'}, {name: 'Say "Hi"', kind: 'other'}]);
  assert.deepStrictEqual(ma.parseDevices('kaputt'), []);
});

t('mpd.conf: osx outputs replaced by system output and one per device; other outputs stay; again gives the same', function(){
  var d = ma.parseDevices(PROFILER), c = ma.writeConf(CONF, d, true), b = ma.blocks(c);
  assert.deepStrictEqual(b.map(function(x){ return [x.type, x.name, x.device, x.hog]; }), [
    ['fifo', 'vu', '', false], ['osx', ma.SYSTEM, '', false], ['osx', 'RME ADI-2 DAC', 'RME ADI-2 DAC', true],
    ['osx', 'MacBook Pro-Lautsprecher', 'MacBook Pro-Lautsprecher', true], ['osx', 'Wohnzimmer', 'Wohnzimmer', false], ['osx', 'Say "Hi"', 'Say "Hi"', true]]);
  assert.ok(c.indexOf('music_directory "/m"') === 0);
  assert.strictEqual(ma.writeConf(c, d, true), c);
  var off = ma.writeConf(c, d, false);
  assert.ok(ma.blocks(off).every(function(x){ return !x.hog; }));
  assert.strictEqual((off.match(/audio_output/g) || []).length, 6);
});

function fakeMpd(conf) {
  var outs = [];
  function sync() {
    var old = outs;
    outs = ma.blocks(fs.readFileSync(conf, 'utf8')).map(function(b, i){
      var was = old.filter(function(o){ return o.name === b.name; })[0];
      return {id: i, name: b.name, plugin: b.type, enabled: was ? was.enabled : i === 0};
    });
  }
  sync();
  var m = function(cmds, cb){
    var res = cmds.map(function(c){
      var x;
      if (c === 'outputs') return [].concat.apply([], outs.map(function(o){ return ['outputid: ' + o.id, 'outputname: ' + o.name, 'plugin: ' + o.plugin, 'outputenabled: ' + (o.enabled ? 1 : 0)]; }));
      if ((x = /^(en|dis)ableoutput (\d+)$/.exec(c))) outs[+x[2]].enabled = x[1] === 'en';
      return [];
    });
    setImmediate(function(){ cb(null, res); });
  };
  m.sync = sync; m.outs = function(){ return outs; };
  return m;
}

ta('switch: one sound output plays, the VU fifo stays; scan keeps the choice across the restart', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-audio-')), conf = path.join(dir, 'mpd.conf');
  fs.writeFileSync(conf, CONF);
  var mpd = fakeMpd(conf), restarts = 0;
  mpd.outs()[1].enabled = true;                                        /* vu on */
  var a = new ma.MacAudio({mpd: mpd, confFile: conf, devices: function(cb){ cb(null, JSON.stringify(PROFILER)); },
                           restart: function(cb){ restarts++; mpd.sync(); cb(); }});
  a.status(function(err, st){
    assert.ifError(err);
    assert.deepStrictEqual(st.outputs.map(function(o){ return o.name; }), ['Mac']);    /* the fifo is no sound output */
    a.scan(false, function(e2, r){
      assert.ifError(e2);
      assert.strictEqual(r.devices, 4); assert.strictEqual(restarts, 1);
      a.status(function(e3, st3){
        var names = st3.outputs.map(function(o){ return o.name; });
        assert.deepStrictEqual(names, [ma.SYSTEM, 'RME ADI-2 DAC', 'MacBook Pro-Lautsprecher', 'Wohnzimmer', 'Say "Hi"']);
        assert.ok(st3.outputs[0].enabled && st3.outputs[0].system);              /* "Mac" is gone: system output */
        var rme = st3.outputs[1].id;
        a.select(rme, function(e4){
          assert.ifError(e4);
          var on = mpd.outs().filter(function(o){ return o.enabled; }).map(function(o){ return o.name; });
          assert.deepStrictEqual(on, ['vu', 'RME ADI-2 DAC']);
          a.scan(true, function(e5){
            assert.ifError(e5);
            a.status(function(e6, st6){
              assert.strictEqual(st6.exclusive, true);
              assert.deepStrictEqual(st6.outputs.filter(function(o){ return o.enabled; }).map(function(o){ return o.name; }), ['RME ADI-2 DAC']);
              a.select(99, function(e7){ assert.strictEqual(e7.message, 'output'); done(); });
            });
          });
        });
      });
    });
  });
});
