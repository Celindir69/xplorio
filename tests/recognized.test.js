/* Erkannter Titel (tags/recognized.js, GET/POST /recognized im Tag-Dienst): Kurzbefehl schickt, Oberfläche liest */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var rec = require('../tags/recognized.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
process.on('exit', function(code){ if (!code) { assert.strictEqual(n, 5, 'nicht alle Prüfungen fertig'); console.log(n + ' Prüfungen'); } });

t('setzen, säubern, Cover nur als https-Adresse', function(){
  var r = new rec.Recognized();
  assert.strictEqual(r.get(1000), null);
  var o = r.set({artist: ' Massive Attack ', title: 'Teardrop\n', album: 'Mezzanine', art: 'javascript:alert(1)'}, 1000);
  assert.deepStrictEqual(o, {ok: true, text: 'Massive Attack – Teardrop'});
  var g = r.get(2000);
  assert.strictEqual(g.title, 'Teardrop'); assert.strictEqual(g.album, 'Mezzanine'); assert.strictEqual(g.art, '');
  r.set({artist: 'A', title: 'B', art: 'https://is1-ssl.mzstatic.com/image/x/600x600bb.jpg'}, 3000);
  assert.strictEqual(r.get(3000).art, 'https://is1-ssl.mzstatic.com/image/x/600x600bb.jpg');
  assert.strictEqual(r.get(3000).album, '');
});

t('ohne Künstler oder Titel abgelehnt, alter Titel bleibt', function(){
  var r = new rec.Recognized();
  r.set({artist: 'A', title: 'B'}, 0);
  assert.strictEqual(r.set({artist: 'A'}, 1).ok, false);
  assert.strictEqual(r.set(null, 1).ok, false);
  assert.strictEqual(r.get(2).title, 'B');
});

t('nach der Höchstdauer vergessen; clear vergisst sofort', function(){
  var r = new rec.Recognized({maxAgeMs: 1000});
  r.set({artist: 'A', title: 'B'}, 0);
  assert.ok(r.get(1000));
  assert.strictEqual(r.get(1001), null);
  r.set({artist: 'A', title: 'B'}, 5000);
  assert.deepStrictEqual(r.set({clear: true}), {ok: true});
  assert.strictEqual(r.get(5001), null);
  assert.strictEqual(rec.MAX_AGE_MS, 600000);
});

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recog-'));
process.env.TAGS_LOG = path.join(dir, 'data', 'changes.jsonl');
process.env.APP_CONFIG_DIR = dir;
var svc = require('../tags/tag-service.js').server;
svc.listen(0, function(){
  function req(method, p, body, headers, cb) {
    var r = http.request({port: svc.address().port, path: p, method: method, headers: headers}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(res.statusCode, JSON.parse(d)); });
    });
    r.end(body ? JSON.stringify(body) : undefined);
  }
  var log = console.log;
  console.log = function(){};
  /* wie der Kurzbefehl: JSON, ohne Origin und ohne X-Xplorio */
  req('POST', '/recognized', {artist: 'Portishead', title: 'Roads'}, {'Content-Type': 'application/json'}, function(c1, j1){
    req('GET', '/recognized', null, {}, function(c2, j2){
      req('POST', '/recognized', {artist: 'X', title: 'Y'}, {'Content-Type': 'text/plain'}, function(c3){
        req('POST', '/recognized', {artist: 'X', title: 'Y'}, {'Content-Type': 'application/json', 'Origin': 'http://evil.example'}, function(c4){
          console.log = log;
          t('POST vom Kurzbefehl angenommen, GET liefert den Titel', function(){
            assert.strictEqual(c1, 200); assert.strictEqual(j1.text, 'Portishead – Roads');
            assert.strictEqual(c2, 200); assert.strictEqual(j2.track.artist, 'Portishead'); assert.strictEqual(j2.track.title, 'Roads');
          });
          t('ohne JSON-Inhaltstyp oder von fremder Seite abgelehnt', function(){
            assert.strictEqual(c3, 403); assert.strictEqual(c4, 403);
          });
          svc.close();
        });
      });
    });
  });
});
