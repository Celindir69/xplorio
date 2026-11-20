/* AirPlay speakers on the Mac (tags/macairplay.js, macaudio.js): list from System Preferences, choose one, plays on the system output */
var assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
var ap = require('../tags/macairplay.js'), ma = require('../tags/macaudio.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); }); }

/* rows as the user's Mac mini (Big Sur) lists them */
var ROWS = [['Interne Lautsprecher', 'Integriert'], ['HDMI2K', 'HDMI'], ['ROTEL USB Audio 2.0 ', 'USB'], ['', ''],
            ['LivingPod', 'AirPlay'], ['65" QLED', 'AirPlay'], ['SleepPod', 'AirPlay'], ['Wohnzimmer ', 'AirPlay']];
/* fake osascript: args [-e, script, want]; cur: the row chosen now */
function fakeRun(state) {
  return function(file, args, cb){
    assert.strictEqual(file, '/usr/bin/osascript'); assert.strictEqual(args[0], '-e'); assert.strictEqual(args[1], ap.SCRIPT);
    state.calls.push(args[2]);
    if (state.fail) return setImmediate(function(){ cb(new Error('Command failed'), '', state.fail); });
    var out = '';
    ROWS.forEach(function(r){
      if (args[2] && r[0] === args[2]) { state.cur = r[0]; out += '#chosen\n'; }
      out += r[0] + '\t' + r[1] + '\t' + (state.cur === r[0] ? 1 : 0) + '\n';
    });
    setImmediate(function(){ cb(null, out, ''); });
  };
}

t('list: only AirPlay rows, names trimmed, the current one marked', function(){
  var r = ap.parse('Interne Lautsprecher\tIntegriert\t0\n\t\t0\nLivingPod\tAirPlay\t1\nWohnzimmer \tAirPlay\t0\n');
  assert.deepStrictEqual(r.speakers, [{name: 'LivingPod', raw: 'LivingPod', current: true}, {name: 'Wohnzimmer', raw: 'Wohnzimmer ', current: false}]);
  assert.strictEqual(r.chosen, false);
});

t('errors: Accessibility and Automation not allowed, anything else', function(){
  assert.strictEqual(ap.errorCode(null, 'execution error: System Events got an error: osascript is not allowed assistive access. (-25211)'), 'access');
  assert.strictEqual(ap.errorCode(null, 'execution error: Not authorized to send Apple events to System Events. (-1743)'), 'automation');
  assert.strictEqual(ap.errorCode(null, 'execution error: nolist (-2700)'), 'airplay');
});

ta('choose a speaker: clicked by its exact name; unknown name -> output', function(done){
  var st = {calls: [], cur: 'LivingPod'}, a = new ap.AirPlay({run: fakeRun(st)});
  a.select('Wohnzimmer ', function(e, list){
    assert.ifError(e);
    assert.deepStrictEqual(st.calls, ['Wohnzimmer ']);
    assert.deepStrictEqual(list.filter(function(x){ return x.current; }).map(function(x){ return x.name; }), ['Wohnzimmer']);
    a.select('Küche', function(e2){ assert.strictEqual(e2.message, 'output'); done(); });
  });
});

t('settings page: every audio action reaches doMacAudio (the service routes only actions starting with "audio")', function(){
  var ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'macsettings.js'), 'utf8');
  var svc = fs.readFileSync(path.join(__dirname, '..', 'tags', 'tag-service.js'), 'utf8');
  assert.ok(/if \(\/\^audio\/\.test\(String\(body\.action\)\)\) return doMacAudio/.test(svc));
  var sent = (ui.match(/msAudioSend\(\{action: '[^']+'/g) || []).concat(ui.match(/var b = \{action: '[^']+'/g) || []);
  assert.ok(sent.length >= 2);
  sent.forEach(function(x){ assert.ok(/action: 'audio/.test(x), x); });
  assert.ok(/body\.action === 'audioAirplayScan'\) return macAudio\.airScan/.test(svc));
});

var CONF = 'music_directory "/m"\nport "6600"\n';
function fakeMpd() {
  var outs = [{id: 0, name: ma.SYSTEM, plugin: 'osx', enabled: false}, {id: 1, name: 'RME', plugin: 'osx', enabled: true}];
  var m = function(cmds, cb){
    var res = cmds.map(function(c){
      var x;
      if (c === 'outputs') return [].concat.apply([], outs.map(function(o){ return ['outputid: ' + o.id, 'outputname: ' + o.name, 'plugin: ' + o.plugin, 'outputenabled: ' + (o.enabled ? 1 : 0)]; }));
      if ((x = /^(en|dis)ableoutput (\d+)$/.exec(c))) outs[+x[2]].enabled = x[1] === 'en';
      return [];
    });
    setImmediate(function(){ cb(null, res); });
  };
  m.outs = function(){ return outs; };
  return m;
}

ta('settings: AirPlay speakers after the search, choosing one plays on the system output; the list stays after a restart', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-air-')), conf = path.join(dir, 'mpd.conf'), airFile = path.join(dir, 'airplay.json');
  fs.writeFileSync(conf, CONF + 'audio_output {\n  type "osx"\n  name "' + ma.SYSTEM + '"\n}\naudio_output {\n  type "osx"\n  name "RME"\n  device "RME"\n}\n');
  var st = {calls: [], cur: 'Interne Lautsprecher'}, mpd = fakeMpd();
  var DEV = {devices: [{name: 'RME', transport: 'usb', outputs: 2, uid: 'usb-1', 'default': true}]};
  function opts() {
    return {mpd: mpd, confFile: conf, airplay: new ap.AirPlay({run: fakeRun(st)}), airFile: airFile,
            listDevices: function(cb){ cb(null, JSON.stringify(DEV)); }};
  }
  var a = new ma.MacAudio(opts());
  a.status(function(e, s0){
    assert.ifError(e);
    assert.ok(!s0.outputs.some(function(o){ return o.airplay; }));            /* nothing before the search */
    assert.deepStrictEqual(st.calls, []);                                     /* status never opens System Preferences */
    a.airScan(function(e2, r){
      assert.ifError(e2);
      assert.strictEqual(r.speakers, 4);
      a.status(function(e3, s3){
        var air = s3.outputs.filter(function(o){ return o.airplay; });
        assert.deepStrictEqual(air.map(function(o){ return [o.id, o.enabled]; }), [['air:LivingPod', false], ['air:65" QLED', false], ['air:SleepPod', false], ['air:Wohnzimmer', false]]);
        a.select('air:Wohnzimmer', function(e4){
          assert.ifError(e4);
          assert.deepStrictEqual(st.calls, ['', 'Wohnzimmer ']);
          assert.deepStrictEqual(mpd.outs().map(function(o){ return o.enabled; }), [true, false]);   /* system output plays */
          DEV.devices = [{name: 'RME', transport: 'usb', outputs: 2, uid: 'usb-1', 'default': false},
                         {name: 'AirPlay', transport: 'airplay', outputs: 2, uid: 'ap-1', 'default': true}];
          var b = new ma.MacAudio(opts());                                    /* after a restart: from airplay.json */
          b.status(function(e5, s5){
            assert.deepStrictEqual(s5.outputs.filter(function(o){ return o.enabled; }).map(function(o){ return o.name; }), [ma.SYSTEM, 'Wohnzimmer']);
            DEV.devices[1]['default'] = false; DEV.devices[0]['default'] = true;   /* switched back in the menu bar */
            b.status(function(e6, s6){
              assert.ok(!s6.outputs.some(function(o){ return o.airplay && o.enabled; }));
              st.fail = 'execution error: osascript is not allowed assistive access. (-25211)';
              b.airScan(function(e7){
                assert.strictEqual(e7.message, 'access');
                /* device scan while a speaker plays: Core Audio's "AirPlay" device gets no MPD output of its own */
                DEV.devices[1]['default'] = true;
                var o = opts(); o.devices = function(cb){ cb(null, JSON.stringify(DEV)); }; o.restart = function(cb){ cb(); };
                new ma.MacAudio(o).scan(false, function(e8){
                  assert.ifError(e8);
                  assert.deepStrictEqual(ma.blocks(fs.readFileSync(conf, 'utf8')).map(function(x){ return x.name; }), [ma.SYSTEM, 'RME']);
                  done();
                });
              });
            });
          });
        });
      });
    });
  });
});
