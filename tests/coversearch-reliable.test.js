/* online cover search: MusicBrainz through the shared queue, answer deadline, image retry and 500 px fallback,
   ids that stay unique after a restart of the tag service */
var assert = require('assert'), http = require('http'), url = require('url'), path = require('path'), cp = require('child_process');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
var hits = {};
var fake = http.createServer(function(req, res){
  var u = url.parse(req.url, true);
  hits[u.pathname] = (hits[u.pathname] || 0) + 1;
  if (u.pathname === '/flaky.jpg' && hits[u.pathname] === 1) { res.writeHead(502); return res.end(); }
  if (u.pathname === '/slow.jpg' && hits[u.pathname] === 1) return setTimeout(function(){ res.writeHead(200); res.end(JPG); }, 400);
  if (u.pathname === '/flaky.jpg' || u.pathname === '/slow.jpg' || u.pathname === '/release-group/rg/front-500') { res.writeHead(200); return res.end(JPG); }
  if (u.pathname === '/gone.jpg') { res.writeHead(404); return res.end(); }
  res.writeHead(404); res.end();
});
fake.listen(0, function(){
  var base = 'http://127.0.0.1:' + fake.address().port;
  process.env.ITUNES_URL = base; process.env.LASTFM_URL = base; process.env.MB_URL = base; process.env.CAA_URL = base;
  process.env.COVER_IMAGE_TIMEOUT_MS = '200';
  var cs = require('../tags/coversearch.js');
  var mbAsked = [];
  function mbJson(u, cb) {                                   /* stands in for the shared queue */
    mbAsked.push(u);
    setTimeout(function(){ cb(null, {'release-groups': [{id: 'rg', score: 100, title: 'Gold'}]}); }, 5);
  }
  cs.search({artist: 'ABBA', album: 'Gold', mbJson: mbJson}, function(list){
    t('MusicBrainz query goes through the queue given (not directly)', function(){
      assert.strictEqual(mbAsked.length, 1); assert.ok(/release-group/.test(mbAsked[0]));
      assert.deepStrictEqual(list.filter(function(r){ return r.source === 'Cover Art Archive'; }).map(function(r){ return r.url; }),
                             [base + '/release-group/rg/front-1200']);
    });
    var start = Date.now();
    cs.search({artist: 'ABBA', album: 'Gold', waitMs: 150, mbJson: function(){ /* MusicBrainz paused, never answers */ }}, function(list2){
      t('answer after the deadline even when MusicBrainz is paused; the other sources still count', function(){
        assert.ok(Date.now() - start < 1000);
        assert.ok(Array.isArray(list2));
        assert.ok(!list2.some(function(r){ return r.source === 'Cover Art Archive'; }));
      });
      cs.image(base + '/flaky.jpg', function(e, img){
        t('image: one more try after a 5xx', function(){ assert.ifError(e); assert.strictEqual(img.mime, 'image/jpeg'); assert.strictEqual(hits['/flaky.jpg'], 2); });
        cs.image(base + '/slow.jpg', function(e2){
          t('image: one more try after a timeout', function(){ assert.ifError(e2); assert.strictEqual(hits['/slow.jpg'], 2); });
          cs.image(base + '/release-group/rg/front-1200', function(e3, img3){
            t('Cover Art Archive without 1200 px thumbnail: 500 px instead', function(){ assert.ifError(e3); assert.ok(img3.body.equals(JPG)); });
            cs.image(base + '/gone.jpg', function(e4){
              t('404: no second try', function(){ assert.ok(e4); assert.strictEqual(hits['/gone.jpg'], 1); });
              ids();
            });
          });
        });
      });
    });
  });
  /* two runs of the tag service (= restart): the ids of the first search differ */
  function ids() {
    var code = "var s=require(" + JSON.stringify(path.join(__dirname, '..', 'tags', 'tag-service.js')) + ").server;" +
      "s.listen(0,function(){require('http').get({port:s.address().port,path:'/coversearch?artist=ABBA&album=Gold'},function(r){" +
      "var d='';r.on('data',function(c){d+=c});r.on('end',function(){console.log(d);process.exit(0)})})})";
    var os = require('os'), fs = require('fs');
    var cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'csr-'));
    fs.writeFileSync(path.join(cfg, 'config.js'), 'window.APP_CONFIG = {};');
    var env = Object.assign({}, process.env, {APP_CONFIG_DIR: cfg, TAGS_LOG: path.join(cfg, 'changes.jsonl')});
    function run(cb) {                                      /* asynchronous: the fake server here must answer */
      cp.execFile(process.execPath, ['-e', code], {env: env, encoding: 'utf8'}, function(e, out){
        if (e) throw e;
        cb(JSON.parse(out.trim().split('\n').pop()));
      });
    }
    fake.close();
    fake = http.createServer(function(req, res){
      var u = url.parse(req.url, true);
      res.writeHead(200, {'Content-Type': 'application/json'});
      if (u.pathname === '/search') return res.end(JSON.stringify({results: [{artistName: 'ABBA', collectionName: 'Gold', artworkUrl100: base + '/x/100x100bb.jpg'}]}));
      res.end('{}');
    });
    fake.listen(0, function(){
      base = 'http://127.0.0.1:' + fake.address().port;
      env.ITUNES_URL = env.LASTFM_URL = env.MB_URL = env.CAA_URL = base;
      env.COVER_WAIT_MS = '3000';
      run(function(a){ run(function(b){
      t('ids differ after a restart (the browser cache cannot show the cover of an earlier search)', function(){
        assert.ok(a.ok && a.results.length && b.results.length);
        assert.notStrictEqual(a.results[0].id, b.results[0].id);
      });
      fake.close();
      console.log(n + ' checks');
      }); });
    });
  }
});
