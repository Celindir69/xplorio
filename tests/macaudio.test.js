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
var BT = '{"devices":[{"name":"B&W Headphones","transport":"bluetooth","outputs":2},{"name":"RME","transport":"usb","outputs":2}]}';
var CONF = 'music_directory "/m"\nport "6600"\naudio_output {\n  type       "osx"\n  name       "Mac"\n  mixer_type "software"\n}\n' +
           'audio_output {\n  type "fifo"\n  name "vu"\n  path "/tmp/vu"\n}\n';

t('devices: only those that play, with their kind', function(){
  assert.deepStrictEqual(ma.parseDevices(JSON.stringify(PROFILER)), [
    {name: 'RME ADI-2 DAC', kind: 'usb'}, {name: 'MacBook Pro-Lautsprecher', kind: 'builtin'}, {name: 'Wohnzimmer', kind: 'airplay'}, {name: 'Say "Hi"', kind: 'other'}]);
  assert.deepStrictEqual(ma.parseDevices('kaputt'), []);
  assert.deepStrictEqual(ma.parseDevices('{"devices":[{"name":"ROTEL USB Audio 2.0 ","transport":"usb","outputs":2},{"name":"Mikro","transport":"usb","outputs":0}]}'),
    [{name: 'ROTEL USB Audio 2.0 ', kind: 'usb'}]);                          /* Core Audio's name exactly, even with a space */
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
  var bt = ma.blocks(ma.writeConf(CONF, ma.parseDevices(BT), true)).map(function(x){ return [x.name, x.hog]; });
  assert.deepStrictEqual(bt.slice(2), [['B&W Headphones', false], ['RME', true]]);   /* Bluetooth: never exclusive, it stays silent */
});

t('DSD through ffmpeg: MPD\'s dsf/dsdiff decoders off (also hand-written ones are taken over), on and off again; ffmpeg seen in mpd --version', function(){
  var hand = CONF + 'decoder {\n  plugin "dsf"\n  enabled "no"\n}\ndecoder {\n  plugin "dsdiff"\n  enabled "no"\n}\ndecoder {\n  plugin "flac"\n}\n';
  assert.strictEqual(ma.dsdViaFfmpeg(CONF), false);
  assert.strictEqual(ma.dsdViaFfmpeg(hand), true);
  var on = ma.writeDsd(hand, true);
  assert.strictEqual(ma.dsdViaFfmpeg(on), true);
  assert.strictEqual(ma.decoderBlocks(on).filter(function(d){ return d.plugin === 'dsf'; }).length, 1);   /* not twice */
  assert.strictEqual(ma.writeDsd(on, true), on);
  var off = ma.writeDsd(on, false);
  assert.strictEqual(ma.dsdViaFfmpeg(off), false);
  assert.deepStrictEqual(ma.decoderBlocks(off).map(function(d){ return d.plugin; }), ['flac']);   /* other decoders stay */
  assert.strictEqual(ma.blocks(off).length, ma.blocks(CONF).length);                               /* outputs untouched */
  var d = ma.parseDevices(PROFILER);
  assert.strictEqual(ma.dsdViaFfmpeg(ma.writeConf(on, d, true)), true);                            /* a device scan keeps it */
  assert.strictEqual(ma.ffmpegDecodes('Decoder plugins:\n [dsf] dsf\n [ffmpeg] 264 dff dsf flac\n'), true);
  assert.strictEqual(ma.ffmpegDecodes('Decoder plugins:\n [dsf] dsf\n'), false);
});

t('buffer: audio_buffer_size written once, replaced, removed for the default; only the offered sizes', function(){
  var t1 = ma.writeBuffer(CONF, 16384);
  assert.strictEqual(ma.bufferSize(t1), 16384);
  var t2 = ma.writeBuffer(t1, 32768);
  assert.strictEqual(ma.bufferSize(t2), 32768);
  assert.strictEqual((t2.match(/audio_buffer_size/g) || []).length, 1);
  assert.strictEqual(ma.bufferSize(ma.writeBuffer(t2, 0)), 0);
  assert.strictEqual(ma.writeBuffer(t2, 0).indexOf('audio_buffer_size'), -1);
  assert.strictEqual(ma.blocks(t2).length, ma.blocks(CONF).length);
  var a = new ma.MacAudio({confFile: '/gibt/es/nicht'});
  a.setBuffer(1234, function(e){ assert.strictEqual(e && e.message, 'value'); });
});

t('ReplayGain for radio/streaming: replay_gain_missing_preamp written once, replaced, removed at 0; only offered values', function(){
  var t1 = ma.writeMissingPreamp(CONF, -6);
  assert.strictEqual(ma.missingPreamp(t1), -6);
  assert.ok(/^replay_gain_missing_preamp "-6"$/m.test(t1));
  var t2 = ma.writeMissingPreamp(t1, -9);
  assert.strictEqual(ma.missingPreamp(t2), -9);
  assert.strictEqual((t2.match(/replay_gain_missing_preamp/g) || []).length, 1);
  assert.strictEqual(ma.writeMissingPreamp(t2, 0).indexOf('replay_gain_missing_preamp'), -1);
  assert.strictEqual(ma.missingPreamp(CONF), 0);
  assert.strictEqual(ma.blocks(t2).length, ma.blocks(CONF).length);
  var a = new ma.MacAudio({confFile: '/gibt/es/nicht'});
  a.setMissingPreamp(-5, function(e){ assert.strictEqual(e && e.message, 'value'); });
});

t('volume on the amplifier (mixer none) and DSD as DoP (USB DACs only); the system output keeps its volume', function(){
  var d = ma.parseDevices(PROFILER), c = ma.writeConf(CONF, d, {exclusive: true, fixedVolume: true, dop: true}), b = ma.blocks(c);
  var osx = b.filter(function(x){ return x.type === 'osx'; }).map(function(x){ return [x.name, x.mixer, x.dop]; });
  var kinds = {}; d.forEach(function(x){ kinds[x.name] = x.kind; });
  osx.forEach(function(o){
    if (o[0] === ma.SYSTEM) return assert.deepStrictEqual(o.slice(1), ['software', false]);
    assert.strictEqual(o[2], kinds[o[0]] === 'usb', o[0]);
    assert.strictEqual(o[1], /^(airplay|bluetooth)$/.test(kinds[o[0]]) ? 'software' : 'none', o[0]);
  });
  assert.ok(osx.some(function(o){ return o[2]; }), 'one USB DAC with DoP');
  var back = ma.blocks(ma.writeConf(c, d, {exclusive: true}));
  assert.ok(back.every(function(x){ return x.type !== 'osx' || (x.mixer === 'software' && !x.dop); }));
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

ta('Bluetooth (with uid): no MPD output of its own, choosing it switches the Mac output and plays on the system output', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-audio-')), conf = path.join(dir, 'mpd.conf');
  var BTU = {devices: [{name: 'B&W Headphones', transport: 'bluetooth', outputs: 2, uid: 'bt-1', 'default': false},
                       {name: 'RME', transport: 'usb', outputs: 2, uid: 'usb-1', 'default': true}]};
  fs.writeFileSync(conf, CONF);
  var mpd = fakeMpd(conf), set = [];
  var a = new ma.MacAudio({mpd: mpd, confFile: conf, devices: function(cb){ cb(null, JSON.stringify(BTU)); },
                           listDevices: function(cb){ cb(null, JSON.stringify(BTU)); },
                           setDefault: function(uid, cb){ set.push(uid); BTU.devices.forEach(function(d){ d['default'] = d.uid === uid; }); cb(); },
                           restart: function(cb){ mpd.sync(); cb(); }});
  a.scan(true, function(e){
    assert.ifError(e);
    assert.deepStrictEqual(ma.blocks(fs.readFileSync(conf, 'utf8')).map(function(b){ return b.name; }), ['vu', ma.SYSTEM, 'RME']);
    a.status(function(e2, st){
      var bt = st.outputs.filter(function(o){ return o.via; })[0];
      assert.deepStrictEqual([bt.id, bt.name, bt.enabled], ['via:bt-1', 'B&W Headphones', false]);
      a.select('via:bt-1', function(e3){
        assert.ifError(e3);
        assert.deepStrictEqual(set, ['bt-1']);
        a.status(function(e4, st4){
          assert.deepStrictEqual(st4.outputs.filter(function(o){ return o.enabled; }).map(function(o){ return o.name; }), [ma.SYSTEM, 'B&W Headphones']);
          done();
        });
      });
    });
  });
});

ta('USB DAC off and on again: the playing output is opened again once; others and a device that stays are left alone', function(done){
  var conf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ma-w-')), 'mpd.conf');
  fs.writeFileSync(conf, 'audio_output {\n  type "osx"\n  name "ROTEL"\n  device "ROTEL USB Audio 2.0"\n}\n' +
                         'audio_output {\n  type "osx"\n  name "Lautsprecher"\n  device "Lautsprecher"\n}\n');
  var present = ['ROTEL USB Audio 2.0', 'Lautsprecher'], sent = [];
  var a = new ma.MacAudio({confFile: conf,
    listDevices: function(cb){ cb(null, JSON.stringify({devices: present.map(function(nm){ return {name: nm, transport: 'usb', outputs: 2}; })})); },
    mpd: function(cmds, cb){
      if (cmds[0] === 'outputs') return cb(null, [['outputid: 0', 'outputname: ROTEL', 'plugin: osx', 'outputenabled: 1',
                                                   'outputid: 1', 'outputname: Lautsprecher', 'plugin: osx', 'outputenabled: 0']]);
      sent.push(cmds); cb(null, [[]]);
    }});
  a.watch(function(e, back){
    assert.deepStrictEqual(back, []);                              /* first look: nothing known yet */
    present = ['Lautsprecher'];
    a.watch(function(e2, back2){
      assert.deepStrictEqual(back2, []);                           /* switched off */
      present = ['ROTEL USB Audio 2.0', 'Lautsprecher'];
      a.watch(function(e3, back3){
        assert.deepStrictEqual(back3, ['ROTEL']);
        assert.deepStrictEqual(sent, [['disableoutput 0', 'enableoutput 0']]);
        a.watch(function(e4, back4){
          assert.deepStrictEqual(back4, []);                       /* still there: nothing more */
          assert.strictEqual(sent.length, 1);
          done();
        });
      });
    });
  });
});
