/* own web server (server/xplorio-server.js): interface from its folder, config.local.js, everything else to Volumio
   (HTTP with body and Range, WebSocket upgrade), no files outside the folder */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var T = fs.mkdtempSync(path.join(os.tmpdir(), 'xsrv-')), www = path.join(T, 'www'), vh = path.join(T, 'volumio-http');
fs.mkdirSync(path.join(www, 'web/js'), {recursive: true});
fs.mkdirSync(path.join(vh, 'www3/web'), {recursive: true});
fs.writeFileSync(path.join(www, 'xplorio.html'), '<html>X</html>');
fs.writeFileSync(path.join(www, 'web/js/core.js'), 'var core;');
fs.writeFileSync(path.join(T, 'geheim.txt'), 'nein');
fs.writeFileSync(path.join(vh, 'www3/web/config.local.js'), 'window.LOCAL = "alt";');

/* fake Volumio: echoes method, path, Range and body; WebSocket: answers 101, then echoes */
var volumio = http.createServer(function(req, res){
  var b = '';
  req.on('data', function(c){ b += c; });
  req.on('end', function(){ res.writeHead(206, {'Content-Type': 'application/json', 'X-Volumio': '1'});
    res.end(JSON.stringify({m: req.method, u: req.url, range: req.headers.range || '', body: b})); });
});
volumio.on('upgrade', function(req, sock){
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  sock.on('data', function(d){ sock.write('echo:' + d); });
});

volumio.listen(0, function(){
  var srv = require('../server/xplorio-server.js').create({volumioPort: volumio.address().port, www: www, volumioHttp: vh});
  srv.listen(0, function(){
    var port = srv.address().port, steps = [];
    function get(p, o, cb) {
      var r = http.request(Object.assign({port: port, path: p}, o || {}), function(res){
        var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(res, d); });
      });
      r.end(o && o.body);
    }
    steps.push(function(next){ get('/', null, function(res, d){
      t('"/" is Xplorio, from its own folder, checked each time', function(){
        assert.strictEqual(res.statusCode, 200); assert.strictEqual(d, '<html>X</html>');
        assert.ok(/text\/html/.test(res.headers['content-type'])); assert.strictEqual(res.headers['cache-control'], 'no-cache');
      });
      get('/web/js/core.js?v=abc', {headers: {'If-None-Match': res.headers.etag}}, function(r2){
        get('/xplorio.html', {headers: {'If-None-Match': res.headers.etag}}, function(r3){
          t('unchanged file: 304', function(){ assert.strictEqual(r2.statusCode, 200); assert.strictEqual(r3.statusCode, 304); });
          next();
        });
      });
    }); });
    steps.push(function(next){ get('/web/config.local.js?t=1', null, function(res, d){
      t('config.local.js: from the earlier installation below /volumio as long as there is no own one', function(){ assert.strictEqual(d, 'window.LOCAL = "alt";'); });
      fs.writeFileSync(path.join(www, 'web/config.local.js'), 'window.LOCAL = "neu";');
      get('/web/config.local.js', null, function(r2, d2){
        t('config.local.js: the own one comes first', function(){ assert.strictEqual(d2, 'window.LOCAL = "neu";'); });
        next();
      });
    }); });
    steps.push(function(next){ get('/web/../../geheim.txt', null, function(res, d){
      get('/web/%2e%2e/%2e%2e/geheim.txt', null, function(r2, d2){
        get('/web/fehlt.js', null, function(r3){
          t('nothing outside the folder; missing interface file: 404, not to Volumio', function(){
            assert.ok(d.indexOf('nein') < 0 && d2.indexOf('nein') < 0, d + d2);
            assert.strictEqual(r3.statusCode, 404); assert.ok(!r3.headers['x-volumio']);
          });
          next();
        });
      });
    }); });
    steps.push(function(next){ get('/api/v1/commands/?cmd=play', {method: 'POST', body: '{"a":1}', headers: {'Content-Type': 'application/json'}}, function(res, d){
      get('/music-library/USB/a.m4a', {headers: {Range: 'bytes=0-99'}}, function(r2, d2){
        t('everything else to Volumio: status, headers, body, Range', function(){
          var j = JSON.parse(d);
          assert.deepStrictEqual([res.statusCode, res.headers['x-volumio'], j.m, j.u, j.body], [206, '1', 'POST', '/api/v1/commands/?cmd=play', '{"a":1}']);
          assert.strictEqual(JSON.parse(d2).range, 'bytes=0-99');
        });
        next();
      });
    }); });
    steps.push(function(next){
      var r = http.request({port: port, path: '/socket.io/?EIO=3&transport=websocket', headers: {Connection: 'Upgrade', Upgrade: 'websocket'}});
      r.on('upgrade', function(res, sock){
        sock.once('data', function(d){
          t('WebSocket (socket.io) goes through to Volumio', function(){ assert.strictEqual(res.statusCode, 101); assert.strictEqual(String(d), 'echo:hallo'); });
          sock.destroy(); next();
        });
        sock.write('hallo');
      });
      r.end();
    });
    steps.push(function(next){
      volumio.close(); volumio.removeAllListeners('upgrade');
      setTimeout(function(){ get('/api/v1/getState', null, function(res){
        t('Volumio not running: 502', function(){ assert.strictEqual(res.statusCode, 502); });
        next();
      }); }, 50);
    });
    (function run() {
      var s = steps.shift();
      if (s) return s(run);
      console.log(n + ' checks passed'); process.exit(0);
    })();
  });
});
