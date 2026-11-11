/* /replaygain and /mqa share one Python call per file: several devices asking at once and again later do not start
   tags.py again; a changed file (saved tags) is read anew */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), http = require('http');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'rgcache-'));
fs.mkdirSync(path.join(root, 'USB')); fs.mkdirSync(path.join(root, 'USB', 'A')); fs.mkdirSync(path.join(root, 'log'));
var song = path.join(root, 'USB', 'A', '01.flac');
fs.writeFileSync(song, 'x');
var calls = path.join(root, 'calls');
/* fake python: counts its starts, answers like tags.py op "replaygain" */
fs.writeFileSync(path.join(root, 'py'), '#!/bin/sh\necho x >> "' + calls + '"\ncat > /dev/null\nsleep 0.2\n' +
  'echo \'{"ok":true,"track":-7.5,"album":-6.1,"mqa":{"orig":96000}}\'\n', {mode: 493});
var mpd = net.createServer(function(c){
  c.write('OK MPD 0.20.0\n');
  c.on('data', function(d){
    String(d).split('\n').filter(Boolean).forEach(function(l){
      if (/^replay_gain_status/.test(l)) c.write('replay_gain_mode: track\nOK\n');
      else if (/^status/.test(l)) c.write('random: 0\nOK\n');
      else if (/^close/.test(l)) c.end(); else c.write('OK\n');
    });
  });
  c.on('error', function(){});
});
function count() { try { return fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length; } catch (e) { return 0; } }

mpd.listen(0, function(){
  process.env.MUSIC_ROOT = root; process.env.MPD_PORT = String(mpd.address().port); process.env.PYTHON = path.join(root, 'py');
  process.env.TAGS_LOG = path.join(root, 'log', 'changes.jsonl'); process.env.MPC = 'true';
  var s = require('../tags/tag-service.js').server;
  function get(route, cb) {
    http.get({port: s.address().port, path: route, headers: {'X-Xplorio': '1'}}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
    });
  }
  var uri = encodeURIComponent('USB/A/01.flac');
  s.listen(0, function(){
    var left = 3, got = [];
    function one(r){ got.push(r); if (--left) return;
      t('three devices at once: one Python call, all get the value', function(){
        assert.strictEqual(count(), 1);
        assert.strictEqual(got.filter(function(x){ return x.mqa; })[0].mqa.orig, 96000);
        assert.ok(got.filter(function(x){ return x.gain; }).length === 2);
      });
      get('/replaygain?uri=' + uri, function(r2){
        get('/mqa?uri=' + uri, function(){
          t('asked again later: from the cache', function(){ assert.strictEqual(count(), 1); assert.ok(r2.gain); });
          var later = new Date(Date.now() + 5000);
          fs.utimesSync(song, later, later);
          get('/replaygain?uri=' + uri, function(){
            t('file changed (tags saved): read anew', function(){ assert.strictEqual(count(), 2); });
            console.log(n + ' checks'); process.exit(0);
          });
        });
      });
    }
    get('/replaygain?uri=' + uri, one); get('/replaygain?uri=' + uri, one); get('/mqa?uri=' + uri, one);
  });
});
