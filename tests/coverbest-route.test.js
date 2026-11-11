/* cover suggestions in the tag service: POST /coverbest, GET /coverbestimage (online sources faked) */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), url = require('url');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function jpeg(w, h) {                                     /* SOF0 header with the size, enough for imageDims */
  var b = Buffer.alloc(64, 0);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0; b.writeUInt16BE(17, 4); b[6] = 8;
  b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9);
  return b;
}
var fake = http.createServer(function(req, res){
  var u = url.parse(req.url, true), base = 'http://127.0.0.1:' + fake.address().port;
  function json(o) { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
  if (u.pathname === '/search') return json({results: [{artistName: 'Lumen Drift', collectionName: 'Glass Hours', artworkUrl100: base + '/it/100x100bb.jpg'}]});
  if (u.pathname === '/ws/2/release-group/') return json({'release-groups': []});
  if (u.pathname === '/it/1200x1200bb.jpg') { res.writeHead(200); return res.end(jpeg(1200, 1200)); }
  res.writeHead(404); res.end();
});
fake.listen(0, function(){
  var base = 'http://127.0.0.1:' + fake.address().port;
  process.env.ITUNES_URL = base; process.env.LASTFM_URL = base; process.env.MB_URL = base; process.env.CAA_URL = base;
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbr-')), music = path.join(root, 'music'), data = path.join(root, 'data');
  fs.mkdirSync(music); fs.mkdirSync(path.join(music, 'USB')); fs.mkdirSync(path.join(music, 'USB', 'Glass Hours')); fs.mkdirSync(data);
  fs.writeFileSync(path.join(music, 'USB', 'Glass Hours', 'cover.jpg'), jpeg(300, 300));
  fs.writeFileSync(path.join(data, 'check.json'), JSON.stringify({at: 1, coverQuality: [
    {dir: 'USB/Glass Hours', name: 'Glass Hours', artist: 'Lumen Drift', count: 1, why: 'small', image: 'cover.jpg', w: 300, h: 300,
     files: [{uri: 'USB/Glass Hours/01.flac', title: 'One'}]},
    {dir: 'USB/Big', name: 'Big', artist: 'Aurora Kite', count: 1, why: 'big', image: 'folder.jpg', bytes: 3000000, files: []}]}));
  process.env.MUSIC_ROOT = music;
  process.env.APP_CONFIG_DIR = path.join(root, 'no-config');
  process.env.TAGS_LOG = path.join(data, 'changes.jsonl');
  var svc = require('../tags/tag-service.js').server;
  svc.listen(0, function(){
    var port = svc.address().port;
    function get(p, cb) {
      http.get({port: port, path: p}, function(res){
        var d = []; res.on('data', function(c){ d.push(c); }); res.on('end', function(){ cb(res, Buffer.concat(d)); });
      });
    }
    function post(p, body, cb) {
      var req = http.request({port: port, path: p, method: 'POST', headers: {'Content-Type': 'text/plain', 'X-Xplorio': '1'}}, function(res){
        var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
      });
      req.end(JSON.stringify(body));
    }
    var dirs = ['USB/Glass Hours', 'USB/Big', '../etc'];
    post('/coverbest', {dirs: dirs}, function(r){
      t('first ask: searching; only small covers of the last check', function(){
        assert.deepStrictEqual(r.covers, {'USB/Glass Hours': {state: 'wait'}});
      });
      (function again() {
        post('/coverbest', {dirs: dirs}, function(r2){
          if (r2.covers['USB/Glass Hours'].state === 'wait') return setTimeout(again, 50);
          t('found: size and source', function(){
            assert.deepStrictEqual(r2.covers['USB/Glass Hours'], {state: 'found', src: 'iTunes', w: 1200, h: 1200, bytes: 64});
          });
          get('/coverbestimage?which=new&dir=' + encodeURIComponent('USB/Glass Hours'), function(res, b){
            t('image found: loaded again from the source', function(){
              assert.strictEqual(res.statusCode, 200); assert.strictEqual(b.length, 64);
            });
            get('/coverbestimage?which=cur&dir=' + encodeURIComponent('USB/Glass Hours'), function(res2, b2){
              t('current image of the folder', function(){ assert.strictEqual(res2.statusCode, 200); assert.strictEqual(b2.readUInt16BE(9), 300); });
              get('/coverbestimage?which=cur&dir=' + encodeURIComponent('../etc'), function(res3){
                t('only folders of the last check', function(){ assert.strictEqual(res3.statusCode, 404); });
                svc.close(); fake.close();
                console.log(n + ' checks');
                process.exit(0);
              });
            });
          });
        });
      })();
    });
  });
});
