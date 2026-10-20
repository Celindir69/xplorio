/* artist photos: Deezer (faked), matching name, placeholder, storage on the player, route /artistimage */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), url = require('url');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 3)]);
var searches = [], down = false;
var fake = http.createServer(function(req, res){
  var u = url.parse(req.url, true), base = 'http://127.0.0.1:' + fake.address().port;
  function json(o) { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
  if (u.pathname === '/search/artist') {
    searches.push(u.query.q);
    if (down) return json({error: {type: 'Exception', message: 'Quota limit exceeded', code: 4}});
    if (u.query.q === 'Niemand') return json({data: [{name: 'Niemand', picture_big: 'https://e-cdns-images.dzcdn.net/images/artist//500x500-000000-80-0-0.jpg'}]});
    return json({data: [
      {name: 'The Jam Band', nb_fan: 9000, picture_big: base + '/img/falsch.jpg'},
      {name: 'Jam', nb_fan: 10, picture_big: base + '/img/klein.jpg'},
      {name: 'The Jam', nb_fan: 500000, picture_big: base + '/img/jam.jpg'}]});
  }
  if (u.pathname === '/img/jam.jpg') { res.writeHead(200); return res.end(JPG); }
  res.writeHead(404); res.end();
});

fake.listen(0, function(){
  process.env.DEEZER_URL = 'http://127.0.0.1:' + fake.address().port;
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  process.env.TAGS_LOG = path.join(dir, 'changes.jsonl');
  process.env.APP_CONFIG_DIR = dir;
  var svc = require('../tags/tag-service.js').server;
  svc.listen(0, function(){
    function get(name, cb) {
      http.get({port: svc.address().port, path: '/artistimage?name=' + encodeURIComponent(name)}, function(res){
        var d = []; res.on('data', function(c){ d.push(c); }); res.on('end', function(){ cb(res, Buffer.concat(d)); });
      });
    }
    var both = 0, bodies = [];
    function after() {
      t('same name (ignoring "The", case), most fans; two concurrent requests = one search', function(){
        assert.ok(bodies.every(function(b){ return b.equals(JPG); }));
        assert.strictEqual(searches.length, 1);
        assert.ok(fs.readdirSync(path.join(dir, 'artists')).some(function(f){ return /\.jpg$/.test(f); }));
      });
      get('the jam', function(r3){
        t('second time from the player, without Deezer', function(){ assert.strictEqual(r3.statusCode, 200); assert.strictEqual(searches.length, 1); });
        get('Niemand', function(r4){
          get('Niemand', function(r5){
            t('Deezer placeholder image = no photo (404), remembered', function(){
              assert.strictEqual(r4.statusCode, 404); assert.strictEqual(r5.statusCode, 404);
              assert.strictEqual(searches.filter(function(q){ return q === 'Niemand'; }).length, 1);
            });
            down = true;
            get('Spliff', function(r6){
              down = false;
              get('Spliff', function(r7){
                t('Deezer error is not remembered: next attempt asks again', function(){
                  assert.strictEqual(r6.statusCode, 404); assert.strictEqual(r7.statusCode, 404);
                  assert.strictEqual(searches.filter(function(q){ return q === 'Spliff'; }).length, 2);
                });
                console.log(n + ' checks');
                svc.close(); fake.close();
              });
            });
          });
        });
      });
    }
    ['The Jam', 'THE JAM'].forEach(function(name){
      get(name, function(r, b){
        assert.strictEqual(r.statusCode, 200, name);
        bodies.push(b);
        if (++both === 2) after();
      });
    });
  });
});
