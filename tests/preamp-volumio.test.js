/* Radio and streams quieter under Volumio: the tag service asks the Xplorio plugin (POST /api/v1/pluginEndpoint,
   endpoint xplorio, plugin/index.js restApi), which adds replaygain_missing_preamp to Volumio's mpd.conf */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), http = require('http');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'preamp-'));
var mpd = net.createServer(function(c){
  c.write('OK MPD 0.23.0\n');
  c.on('data', function(d){
    String(d).split('\n').filter(Boolean).forEach(function(l){
      if (/^replay_gain_status/.test(l)) c.write('replay_gain_mode: album\nOK\n');
      else if (/^status/.test(l)) c.write('xfade: 0\nOK\n');
      else if (/^close/.test(l)) c.end(); else c.write('OK\n');
    });
  });
  c.on('error', function(){});
});
/* Volumio with the plugin: answers like Volumio's REST, {data: <what restApi returns>} */
var asked = [], cur = 0, byHand = false;
var volumio = http.createServer(function(req, res){
  var b = '';
  req.on('data', function(d){ b += d; });
  req.on('end', function(){
    if (req.url !== '/api/v1/pluginEndpoint') { res.end('{}'); return; }
    var j = JSON.parse(b); asked.push(j);
    var d = j.data, r;
    if (j.endpoint !== 'xplorio') r = {};
    else if (d.db === undefined) r = {ok: true, missingPreamp: cur, missingPreamps: [0, -3, -6, -9, -12], byHand: byHand, hook: true};
    else if ([0, -3, -6, -9, -12].indexOf(d.db) < 0) r = {ok: false, error: 'value'};
    else { cur = d.db; r = {ok: true, missingPreamp: cur}; }
    res.end(JSON.stringify({success: true, data: r}));
  });
});

mpd.listen(0, function(){ volumio.listen(0, function(){
  process.env.MUSIC_ROOT = root; process.env.MPD_PORT = String(mpd.address().port); process.env.MPC = 'true';
  process.env.TAGS_DATA = path.join(root, 'data'); process.env.TAGS_LOG = path.join(root, 'changes.jsonl');
  process.env.VOLUMIO_URL = 'http://127.0.0.1:' + volumio.address().port;
  process.env.XPLORIO_PLUGIN = '1';
  var s = require('../tags/tag-service.js').server;
  function call(method, route, body, cb) {
    var req = http.request({port: s.address().port, path: route, method: method, headers: {'Content-Type': 'application/json', 'X-Xplorio': '1'}}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(res.statusCode, JSON.parse(d)); });
    });
    req.end(body ? JSON.stringify(body) : undefined);
  }
  s.listen(0, function(){
    call('GET', '/playback', null, function(c, r){
      t('Playback page under Volumio: level for radio and streams from the plugin, offered values', function(){
        assert.strictEqual(c, 200);
        assert.strictEqual(r.missingPreamp, 0);
        assert.deepStrictEqual(r.missingPreamps, [0, -3, -6, -9, -12]);
        assert.strictEqual(r.preampByHand, false);
        assert.deepStrictEqual(asked[0], {endpoint: 'xplorio', data: {action: 'preamp'}});
      });
      call('POST', '/playback', {missingPreamp: -6}, function(c2, r2){
        t('set -6 dB: handed to the plugin, answer with the new value', function(){
          assert.strictEqual(r2.ok, true);
          assert.strictEqual(r2.missingPreamp, -6);
          assert.ok(asked.some(function(a){ return a.data.db === -6; }));
        });
        call('POST', '/playback', {missingPreamp: -5}, function(c3, r3){
          t('value not offered: refused', function(){ assert.deepStrictEqual(r3, {ok: false, error: 'value'}); });
          byHand = true;
          call('GET', '/playback', null, function(c4, r4){
            t('set by hand in Volumio\'s template: shown as such', function(){ assert.strictEqual(r4.preampByHand, true); });
            volumio.close(); call('GET', '/playback', null, function(c5, r5){
              t('plugin not answering (older plugin): the choice is not offered', function(){
                assert.strictEqual(r5.ok, true); assert.strictEqual(r5.missingPreamp, undefined);
              });
              console.log(n + ' checks'); process.exit(0);
            });
          });
        });
      });
    });
  });
}); });
