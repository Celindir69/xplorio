/* data folder (move from /data/INTERNAL/tags), Last.fm credentials in keys.json and GET /lastfmapi */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
var ad = require('../tags/appdata.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
var oldDir = path.join(root, 'INTERNAL', 'tags'), newDir = path.join(root, 'web-app', 'data');
fs.mkdirSync(path.join(root, 'INTERNAL')); fs.mkdirSync(oldDir); fs.mkdirSync(path.join(root, 'web-app'));
fs.writeFileSync(path.join(oldDir, 'tag-service.js'), '// program');
fs.writeFileSync(path.join(oldDir, 'plays.jsonl'), '{"t":1}\n');
fs.writeFileSync(path.join(oldDir, 'lastfm.json'), '{"sk":"S"}');
fs.mkdirSync(path.join(oldDir, 'moodtags')); fs.writeFileSync(path.join(oldDir, 'moodtags', 'tracks.jsonl'), 'x\n');

t('move: data goes to the new folder, program files stay', function(){
  var logs = [], r = ad.prepare(newDir, oldDir, function(m){ logs.push(m); });
  assert.strictEqual(r.dir, newDir);
  assert.deepStrictEqual(r.moved.sort(), ['lastfm.json', 'moodtags', 'plays.jsonl']);
  assert.ok(fs.existsSync(path.join(newDir, 'moodtags', 'tracks.jsonl')));
  assert.ok(fs.existsSync(path.join(oldDir, 'tag-service.js')) && !fs.existsSync(path.join(oldDir, 'plays.jsonl')));
  assert.strictEqual(fs.statSync(newDir).mode & 511, 448);                    /* 0700 */
  assert.ok(/data moved to/.test(logs.join(' ')));
});

t('move: existing files in the new folder are not overwritten', function(){
  fs.writeFileSync(path.join(oldDir, 'check.json'), 'alt');
  fs.writeFileSync(path.join(newDir, 'check.json'), 'neu');
  var r = ad.prepare(newDir, oldDir);
  assert.deepStrictEqual(r.moved, []);
  assert.strictEqual(fs.readFileSync(path.join(newDir, 'check.json'), 'utf8'), 'neu');
});

t('folder cannot be created: continue with the old one', function(){
  var r = ad.prepare(path.join(root, 'fehlt', 'web-app'), oldDir);
  assert.strictEqual(r.dir, oldDir); assert.strictEqual(r.error, 'ENOENT');
});

t('default data folder: new folder, unless only the old hand-made one exists', function(){
  var b = fs.mkdtempSync(path.join(os.tmpdir(), 'appdir-'));
  var neu = path.join(b, 'xplorio', 'data'), alt = path.join(b, 'web-app', 'data');
  assert.strictEqual(ad.defaultDir(neu, alt), neu);                           /* fresh: new folder */
  fs.mkdirSync(path.join(b, 'web-app')); fs.mkdirSync(alt);
  assert.strictEqual(ad.defaultDir(neu, alt), alt);                           /* only old one present: stay there */
  fs.mkdirSync(path.join(b, 'xplorio'));
  assert.strictEqual(ad.defaultDir(neu, alt), neu);                           /* moved (xplorio-deploy) */
});

t('Last.fm credentials: copied from config.local.js to keys.json, then read from there', function(){
  var cfg = {LASTFM_KEY: 'KEY', LASTFM_SECRET: 'GEHEIM'};
  var k = new ad.Keys(newDir, function(){ return cfg; });
  assert.strictEqual(k.migrate(), true);
  var file = path.join(newDir, 'keys.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {LASTFM_KEY: 'KEY', LASTFM_SECRET: 'GEHEIM'});
  assert.strictEqual(fs.statSync(file).mode & 511, 384);                      /* 0600 */
  assert.strictEqual(k.inWeb(), true);
  cfg = {};                                                                   /* lines removed from config.local.js */
  assert.deepStrictEqual(k.lastfm(), {key: 'KEY', secret: 'GEHEIM'});
  assert.strictEqual(k.inWeb(), false);
  assert.strictEqual(k.migrate(), false);
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
  fs.writeFileSync(path.join(dir, 'config.local.js'), 'window.APP_CONFIG.LASTFM_KEY = "KEY";');
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
            t('service: /health reports Last.fm and key still in the web folder', function(){
              assert.strictEqual(h.lastfm, true); assert.strictEqual(h.keysInWeb, true);
            });
            t('service: /lastfmapi asks with its own key, foreign parameters are dropped, second request from the cache', function(){
              assert.strictEqual(c1, 200); assert.strictEqual(a.artist.bio.content, 'Text');
              assert.deepStrictEqual(b, a);
              assert.strictEqual(seen.length, 1);
              assert.ok(/method=artist\.getinfo&artist=Massive%20Attack&lang=de&api_key=KEY&format=json$/.test(seen[0]), seen[0]);
              assert.ok(fs.existsSync(path.join(dir, 'data', 'keys.json')));
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
