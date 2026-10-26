/* data folder, Last.fm credentials in keys.json and GET /lastfmapi */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
var ad = require('../tags/appdata.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-')), newDir = path.join(root, 'data');

t('data folder: created, readable only by the service; a second time stays', function(){
  var r = ad.prepare(newDir);
  assert.strictEqual(r.dir, newDir); assert.ok(!r.error);
  assert.strictEqual(fs.statSync(newDir).mode & 511, 448);                    /* 0700 */
  assert.ok(!ad.prepare(newDir).error);
});

t('folder cannot be created: error reported', function(){
  var logs = [], r = ad.prepare(path.join(root, 'fehlt', 'data'), function(m){ logs.push(m); });
  assert.strictEqual(r.error, 'ENOENT'); assert.ok(/cannot create/.test(logs.join(' ')));
});

t('Last.fm credentials: from keys.json, written with mode 0600, environment first', function(){
  var k = new ad.Keys(newDir), file = path.join(newDir, 'keys.json');
  assert.deepStrictEqual(k.lastfm(), {key: '', secret: ''});
  k.write({LASTFM_KEY: 'KEY', LASTFM_SECRET: 'GEHEIM'});
  assert.strictEqual(fs.statSync(file).mode & 511, 384);                      /* 0600 */
  assert.deepStrictEqual(k.lastfm(), {key: 'KEY', secret: 'GEHEIM'});
  process.env.LASTFM_KEY = 'ENV';
  assert.strictEqual(k.lastfm().key, 'ENV');
  delete process.env.LASTFM_KEY;
});

/* GET /lastfmapi: request with the service's key, allowed methods only, cache */
var seen = [];
var fake = http.createServer(function(q, r){
  seen.push(q.url);
  r.writeHead(200, {'Content-Type': 'application/json'});
  r.end(JSON.stringify({artist: {bio: {content: 'Text'}}}));
});
fake.listen(0, function(){
  process.env.LASTFM_URL = 'http://127.0.0.1:' + fake.address().port;
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfmapi-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'config.js'), 'window.APP_CONFIG = {};');
  fs.writeFileSync(path.join(dir, 'data', 'keys.json'), JSON.stringify({LASTFM_KEY: 'KEY'}));
  process.env.APP_CONFIG_DIR = dir;
  process.env.TAGS_LOG = path.join(dir, 'data', 'changes.jsonl');
  process.env.HISTORY = '0'; process.env.MOODTAGS = '0';
  var svc = require('../tags/tag-service.js').server;
  svc.listen(0, function(){
    function get(p, cb) {
      http.get({port: svc.address().port, path: p}, function(res){
        var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(res.statusCode, JSON.parse(d)); });
      });
    }
    get('/health', function(c0, h){
      get('/lastfmapi?method=artist.getinfo&artist=Massive%20Attack&lang=de&api_key=FREMD', function(c1, a){
        get('/lastfmapi?method=artist.getinfo&artist=Massive%20Attack&lang=de', function(c2, b){
          get('/lastfmapi?method=auth.getsession&token=x', function(c3, e){
            t('service: /health reports Last.fm', function(){ assert.strictEqual(h.lastfm, true); });
            t('service: /lastfmapi asks with its own key, foreign parameters are dropped, second request from the cache', function(){
              assert.strictEqual(c1, 200); assert.strictEqual(a.artist.bio.content, 'Text');
              assert.deepStrictEqual(b, a);
              assert.strictEqual(seen.length, 1);
              assert.ok(/method=artist\.getinfo&artist=Massive%20Attack&lang=de&api_key=KEY&format=json$/.test(seen[0]), seen[0]);
            });
            t('service: other Last.fm methods are rejected', function(){ assert.strictEqual(c3, 400); assert.strictEqual(e.ok, false); });
            svc.close(); fake.close();
            console.log(n + ' checks passed');
            process.exit(0);
          });
        });
      });
    });
  });
});
