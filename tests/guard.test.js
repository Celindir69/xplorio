/* access protection: tag service and Rotel bridge accept only requests from their own UI */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var guard = require('../tags/guard.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function rq(h) { return {headers: h}; }

t('host: home network names and IPs allowed, foreign names not', function(){
  ['volumio.local:8766', '192.168.1.20:8766', 'localhost', 'volumio', '[::1]:8766', 'player.fritz.box', 'x.home.arpa']
    .forEach(function(h){ assert.ok(guard.hostOk(h), h); });
  ['evil.example.com:8766', 'volumio.local.evil.com', '', 'a b'].forEach(function(h){ assert.ok(!guard.hostOk(h), h); });
  assert.ok(guard.hostOk('player.example.net', ['player.example.net']));
});

t('origin: same device only; "null" and foreign pages rejected', function(){
  assert.ok(guard.check(rq({host: 'volumio.local:8766', origin: 'http://volumio.local'}), true).ok);
  assert.strictEqual(guard.check(rq({host: 'volumio.local:8766', origin: 'http://volumio.local:3000'}), false).origin, 'http://volumio.local:3000');
  assert.strictEqual(guard.check(rq({host: 'volumio.local:8766', origin: 'https://evil.example.com'}), false).reason, 'origin');
  assert.strictEqual(guard.check(rq({host: 'volumio.local:8766', origin: 'http://192.168.1.66'}), true).reason, 'origin');
  assert.strictEqual(guard.check(rq({host: 'volumio.local:8766', origin: 'null'}), true).reason, 'origin');
  assert.strictEqual(guard.check(rq({host: 'evil.example.com:8766', origin: 'http://evil.example.com:8766'}), false).reason, 'host');
});

t('no origin: reading free, writing only with X-Xplorio or JSON type', function(){
  assert.ok(guard.check(rq({host: 'volumio.local:8766'}), false).ok);
  assert.strictEqual(guard.check(rq({host: 'volumio.local:8766', 'content-type': 'text/plain'}), true).reason, 'marker');
  assert.ok(guard.check(rq({host: 'volumio.local:8766', 'x-xplorio': '1'}), true).ok);
  assert.ok(guard.check(rq({host: 'volumio.local:8766', 'content-type': 'application/x-ndjson'}), true).ok);
});

t('CORS headers only for the allowed origin', function(){
  assert.strictEqual(guard.corsHeaders('')['Access-Control-Allow-Origin'], undefined);
  assert.strictEqual(guard.corsHeaders('http://volumio.local')['Access-Control-Allow-Origin'], 'http://volumio.local');
});

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
process.env.TAGS_LOG = path.join(dir, 'data', 'changes.jsonl');
process.env.APP_CONFIG_DIR = dir;
var tagSvc = require('../tags/tag-service.js').server;
var rotelSvc = require('../rotel/rotel-bridge.js').server;

function call(svc, method, p, headers, body, cb) {
  var r = http.request({port: svc.address().port, path: p, method: method, headers: headers}, function(res){
    var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(res.statusCode, res.headers); });
  });
  r.end(body);
}
var steps = [
  ['tag service: foreign page may not write', tagSvc, 'POST', '/lyricsoffset', {Origin: 'https://evil.example.com', 'Content-Type': 'text/plain'}, '{"key":"a|b","ms":5}', 403],
  ['tag service: UI may write (text/plain, no preflight)', tagSvc, 'POST', '/lyricsoffset', {Host: 'volumio.local:8766', Origin: 'http://volumio.local', 'Content-Type': 'text/plain'}, '{"key":"a|b","ms":5}', 200],
  ['tag service: form without origin is rejected', tagSvc, 'POST', '/lyricsoffset', {'Content-Type': 'text/plain'}, '{"key":"a|b","ms":5}', 403],
  ['tag service: DNS rebinding (foreign host) is rejected', tagSvc, 'GET', '/health', {Host: 'evil.example.com:8766'}, null, 403],
  ['tag service: curl /health still works', tagSvc, 'GET', '/health', {}, null, 200],
  ['Rotel: foreign page may not switch', rotelSvc, 'GET', '/cmd?c=power_off', {Origin: 'https://evil.example.com'}, null, 403],
  ['Rotel: image link without origin may not switch', rotelSvc, 'GET', '/cmd?c=power_off', {}, null, 403],
  ['Rotel: UI may switch (no amplifier: 503)', rotelSvc, 'GET', '/cmd?c=power_off', {Host: 'volumio.local:8765', Origin: 'http://volumio.local'}, null, 503],
  ['Rotel: state readable', rotelSvc, 'GET', '/state', {}, null, 200]
];
tagSvc.listen(0, function(){ rotelSvc.listen(0, function(){
  (function next(i){
    if (i >= steps.length) {
      return call(tagSvc, 'GET', '/health', {Host: 'volumio.local:8766', Origin: 'http://volumio.local'}, null, function(c, h){
        t('tag service: response carries the allowed origin instead of *', function(){ assert.strictEqual(h['access-control-allow-origin'], 'http://volumio.local'); });
        console.log(n + ' checks passed'); process.exit(0);
      });
    }
    var s = steps[i];
    call(s[1], s[2], s[3], s[4], s[5], function(code){
      t(s[0], function(){ assert.strictEqual(code, s[6]); });
      next(i + 1);
    });
  })(0);
}); });
