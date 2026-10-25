/* search covers online: iTunes, Last.fm, Cover Art Archive (faked), choice of hits, images via /coverimage */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), url = require('url');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 2)]);
var seen = [];
var fake = http.createServer(function(req, res){
  seen.push(req.url);
  var u = url.parse(req.url, true), base = 'http://127.0.0.1:' + fake.address().port;
  function json(o) { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
  if (u.pathname === '/search') {                                         /* iTunes */
    if (/Nichts/.test(u.query.term)) return json({results: []});
    return json({results: [
      {artistName: 'Billy Joel', collectionName: 'Greatest Hits', artworkUrl100: base + '/it/falsch/100x100bb.jpg'},
      {artistName: 'Billy Joel', collectionName: 'The Stranger (Remastered)', artworkUrl100: base + '/it/a/100x100bb.jpg'}]});
  }
  if (u.pathname === '/2.0/') {                                           /* Last.fm */
    if (u.query.api_key !== 'KEY') return json({error: 10});
    if (u.query.album === 'Nichts') return json({album: {image: [{'#text': base + '/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png'}]}});
    return json({album: {image: [{'#text': base + '/i/u/34s/x.png', size: 'small'}, {'#text': base + '/i/u/300x300/x.png', size: 'extralarge'}]}});
  }
  if (u.pathname === '/ws/2/release-group/') {                            /* MusicBrainz */
    if (/Nichts/.test(u.query.query)) return json({'release-groups': [{id: 'zz', score: 60, title: 'Etwas'}]});
    return json({'release-groups': [{id: 'rg1', score: 100, title: 'The Stranger'}]});
  }
  if (u.pathname === '/release-group/rg1/front-1200') { res.writeHead(307, {Location: base + '/archive/x.jpg'}); return res.end(); }
  if (u.pathname === '/it/a/1200x1200bb.jpg' || u.pathname === '/archive/x.jpg') { res.writeHead(200); return res.end(JPG); }
  if (u.pathname === '/i/u/x.png') { res.writeHead(200); return res.end(PNG); }
  res.writeHead(404); res.end();
});
fake.listen(0, function(){
  var base = 'http://127.0.0.1:' + fake.address().port;
  process.env.ITUNES_URL = base; process.env.LASTFM_URL = base; process.env.MB_URL = base; process.env.CAA_URL = base;
  var cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.writeFileSync(path.join(cfg, 'config.js'), 'window.APP_CONFIG = {};');
  fs.mkdirSync(path.join(cfg, 'log')); fs.writeFileSync(path.join(cfg, 'log', 'keys.json'), JSON.stringify({LASTFM_KEY: 'KEY'}));
  process.env.APP_CONFIG_DIR = cfg;
  process.env.TAGS_LOG = path.join(cfg, 'log', 'changes.jsonl');
  var svc = require('../tags/tag-service.js').server;
  svc.listen(0, function(){
    function get(p, cb) {
      http.get({port: svc.address().port, path: p}, function(res){
        var d = []; res.on('data', function(c){ d.push(c); }); res.on('end', function(){ cb(res, Buffer.concat(d)); });
      });
    }
    get('/coversearch?artist=Billy%20Joel&album=The%20Stranger', function(r, b){
      var j = JSON.parse(b);
      t('three sources, in fixed order', function(){
        assert.ok(j.ok);
        assert.deepStrictEqual(j.results.map(function(x){ return x.source; }), ['iTunes', 'Last.fm', 'Cover Art Archive']);
        assert.ok(seen.some(function(s){ return /api_key=KEY/.test(s); }), 'Last.fm key from config.local.js');
      });
      get('/coverimage?id=' + j.results[0].id, function(r1, b1){
        t('iTunes: matching album (bracketed addition ignored), 1200 px', function(){
          assert.strictEqual(r1.statusCode, 200); assert.strictEqual(r1.headers['content-type'], 'image/jpeg');
          assert.ok(b1.equals(JPG)); assert.ok(seen.indexOf('/it/a/1200x1200bb.jpg') >= 0);
        });
        get('/coverimage?id=' + j.results[1].id, function(r2, b2){
          t('Last.fm: original size instead of 300x300', function(){ assert.strictEqual(r2.headers['content-type'], 'image/png'); assert.ok(b2.equals(PNG)); });
          get('/coverimage?id=' + j.results[2].id, function(r3, b3){
            t('Cover Art Archive: via redirect', function(){ assert.strictEqual(r3.statusCode, 200); assert.ok(b3.equals(JPG)); });
            get('/coverimage?id=999', function(r4){
              t('unknown id: 404 (no foreign URLs)', function(){ assert.strictEqual(r4.statusCode, 404); });
              get('/coversearch?artist=X&album=Nichts', function(r5, b5){
                t('nothing found: empty list (Last.fm placeholder and weak MusicBrainz hit do not count)', function(){
                  assert.deepStrictEqual(JSON.parse(b5).results, []);
                });
                get('/coversearch?artist=X', function(r6, b6){
                  t('no album: error', function(){ assert.strictEqual(JSON.parse(b6).ok, false); });
                  svc.close(); fake.close();
                  console.log(n + ' checks');
                });
              });
            });
          });
        });
      });
    });
  });
});
