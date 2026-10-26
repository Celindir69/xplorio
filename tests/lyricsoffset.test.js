/* lyrics offset per track: GET/POST /lyricsoffset in the tag service */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyr-'));
process.env.TAGS_LOG = path.join(dir, 'data', 'changes.jsonl');
process.env.APP_CONFIG_DIR = dir;
var svc = require('../tags/tag-service.js').server;
svc.listen(0, function(){
  function req(method, p, body, cb) {
    var r = http.request({port: svc.address().port, path: p, method: method, headers: {'X-Xplorio': '1'}}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(res.statusCode, JSON.parse(d)); });
    });
    r.end(body ? JSON.stringify(body) : undefined);
  }
  var key = 'inxs|need you tonight';
  req('GET', '/lyricsoffset?key=' + encodeURIComponent(key), null, function(c0, j0){
    t('no entry: 0', function(){ assert.strictEqual(c0, 200); assert.strictEqual(j0.ms, 0); });
    req('POST', '/lyricsoffset', {key: key, ms: -1500}, function(c1){
      req('GET', '/lyricsoffset?key=' + encodeURIComponent(key), null, function(c2, j2){
        t('saved and read back, file created', function(){
          assert.strictEqual(c1, 200); assert.strictEqual(j2.ms, -1500);
          assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'lyrics-offsets.json'), 'utf8'))[key], -1500);
        });
        req('POST', '/lyricsoffset', {key: key, ms: 0}, function(){
          req('POST', '/lyricsoffset', {key: '', ms: 5}, function(c4){
            t('0 removes the entry; rejected without key', function(){
              assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'lyrics-offsets.json'), 'utf8')), {});
              assert.strictEqual(c4, 400);
            });
            var many = {};
            for (var i = 0; i < 10000; i++) many['a|' + i] = 100;
            fs.writeFileSync(path.join(dir, 'data', 'lyrics-offsets.json'), JSON.stringify(many));
            req('POST', '/lyricsoffset', {key: 'new|one', ms: 200}, function(c5){
              req('POST', '/lyricsoffset', {key: 'a|5', ms: 300}, function(c6){
                t('full: no new entries, existing ones can still change', function(){
                  assert.strictEqual(c5, 400); assert.strictEqual(c6, 200);
                });
                console.log(n + ' tests');
                svc.close();
              });
            });
          });
        });
      });
    });
  });
});
