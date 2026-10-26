/* Last.fm: signature, connecting, scrobbling (queue), history import with sync; routes /lastfm and /plays */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), url = require('url'), qs = require('querystring'), crypto = require('crypto');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var NOW = Math.floor(Date.now() / 1000);
var calls = [], approved = false, sessionOk = true;
var HISTORY = [];                                   /* "Last.fm history": 450 scrobbles, newest first */
for (var i = 0; i < 450; i++) HISTORY.push({artist: {'#text': 'Künstler ' + (i % 7)}, name: 'Titel ' + i, album: {'#text': 'Album ' + (i % 5)}, date: {uts: String(NOW - 3600 - i * 600)}});

function md5sig(p) {
  var s = Object.keys(p).filter(function(k){ return k !== 'format' && k !== 'api_sig'; }).sort().map(function(k){ return k + p[k]; }).join('');
  return crypto.createHash('md5').update(s + 'GEHEIM', 'utf8').digest('hex');
}
var fake = http.createServer(function(req, res){
  var body = '';
  req.on('data', function(d){ body += d; });
  req.on('end', function(){
    var p = req.method === 'POST' ? qs.parse(body) : url.parse(req.url, true).query;
    calls.push(p);
    function json(o) { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
    if (p.api_key !== 'KEY') return json({error: 10, message: 'Invalid API key'});
    if (p.api_sig && p.api_sig !== md5sig(p)) return json({error: 13, message: 'Invalid method signature'});
    if (p.method === 'auth.gettoken') return json({token: 'TOK'});
    if (p.method === 'auth.getsession') return approved ? json({session: {name: 'celindir', key: 'SK'}}) : json({error: 14, message: 'Unauthorized Token'});
    if (p.method === 'track.scrobble' || p.method === 'track.updatenowplaying') {
      if (!sessionOk) return json({error: 9, message: 'Invalid session key'});
      return json({scrobbles: {'@attr': {accepted: 1, ignored: 0}}});
    }
    if (p.method === 'user.getrecenttracks') {
      var list = HISTORY.filter(function(x){ return (!p.from || +x.date.uts >= +p.from) && (!p.to || +x.date.uts <= +p.to); });
      var page = parseInt(p.page, 10), tracks = list.slice((page - 1) * 200, page * 200);
      if (page === 1) tracks = [{artist: {'#text': 'Jetzt'}, name: 'Läuft', '@attr': {nowplaying: 'true'}}].concat(tracks);
      return json({recenttracks: {track: tracks, '@attr': {page: String(page), totalPages: String(Math.max(1, Math.ceil(list.length / 200))), total: String(list.length)}}});
    }
    json({error: 3, message: 'Invalid method'});
  });
});

function waitFor(cond, cb) { (function poll(){ if (cond()) return cb(); setTimeout(poll, 20); })(); }

fake.listen(0, function(){
  var base = 'http://127.0.0.1:' + fake.address().port;
  process.env.LASTFM_URL = base;
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfm-'));
  fs.writeFileSync(path.join(dir, 'config.js'), 'window.APP_CONFIG = {};');
  fs.mkdirSync(path.join(dir, 'data')); fs.writeFileSync(path.join(dir, 'data', 'keys.json'), JSON.stringify({LASTFM_KEY: 'KEY', LASTFM_SECRET: 'GEHEIM'}));
  process.env.APP_CONFIG_DIR = dir;
  process.env.TAGS_LOG = path.join(dir, 'data', 'changes.jsonl');
  var lastfm = require('../tags/lastfm.js');
  var svcMod = require('../tags/tag-service.js'), svc = svcMod.server, sync = svcMod.lastfm, store = svcMod.playStore;

  t('signature as described by Last.fm (sorted, without format, md5 with secret)', function(){
    var p = {method: 'auth.getSession', api_key: 'KEY', token: 'TOK'};
    assert.strictEqual(lastfm.sign(p, 'GEHEIM'), md5sig(p));
    assert.strictEqual(lastfm.sign({b: 'ä', a: '1', format: 'json'}, 's'), crypto.createHash('md5').update('a1bäs', 'utf8').digest('hex'));
  });

  svc.listen(0, function(){
    function req(method, p, body, cb) {
      var r = http.request({port: svc.address().port, path: p, method: method, headers: {'X-Xplorio': '1'}}, function(res){
        var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
      });
      r.end(body ? JSON.stringify(body) : undefined);
    }
    req('GET', '/lastfm', null, function(s0){
      t('status: configured but not connected; the session key never goes to the browser', function(){
        assert.ok(s0.lastfm.configured); assert.ok(!s0.lastfm.connected);
        assert.ok(!('sk' in s0.lastfm));
      });
      req('POST', '/lastfm', {action: 'connect'}, function(c){
        t('connect: authorization URL with token', function(){
          assert.ok(c.ok); assert.ok(/api\/auth\/\?api_key=KEY&token=TOK$/.test(c.url), c.url);
        });
        req('POST', '/lastfm', {action: 'finish'}, function(f1){
          t('finish without authorization: understandable hint', function(){ assert.ok(!f1.ok); assert.ok(/Allow/.test(f1.error)); });
          approved = true;
          req('POST', '/lastfm', {action: 'finish'}, function(f2){
            t('finish after authorization: connected, session saved, import starts', function(){
              assert.ok(f2.ok, JSON.stringify(f2)); assert.strictEqual(f2.status.user, 'celindir');
              assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'lastfm.json'), 'utf8')).sk, 'SK');
            });
            waitFor(function(){ return !sync.importRun; }, function(){
              t('import: all pages, without "now playing", with source lastfm', function(){
                assert.ok(!sync.importError, sync.importError);
                var list = store.load();
                assert.strictEqual(list.length, 450);
                assert.ok(list.every(function(e){ return e.s === 'lastfm' && e.ar && e.ti && e.al; }));
                assert.strictEqual(sync.state.lastImport.added, 450);
                assert.strictEqual(sync.state.importedTo, NOW - 3600);
              });
              /* new play on the player: history + scrobble */
              var entry = {t: NOW - 300, ar: 'Spliff', ti: 'Carbonara', al: '85555', d: 200, u: 'USB/x.flac', s: 'mpd'};
              svcMod.tracker.onStart(entry);
              svcMod.tracker.onPlay(entry);
              waitFor(function(){ return !sync.sending && calls.some(function(p){ return p.method === 'track.scrobble'; }); }, function(){
                var sc = calls.filter(function(p){ return p.method === 'track.scrobble'; })[0];
                t('scrobbling: signed, via POST, with timestamp; "now playing" reported before', function(){
                  assert.strictEqual(sc['artist[0]'], 'Spliff'); assert.strictEqual(sc['timestamp[0]'], String(NOW - 300));
                  assert.strictEqual(sc['album[0]'], '85555'); assert.strictEqual(sc.sk, 'SK');
                  assert.ok(calls.some(function(p){ return p.method === 'track.updatenowplaying' && p.track === 'Carbonara'; }));
                  assert.strictEqual(sync.state.queue.length, 0);
                });
                /* new scrobble shows up at Last.fm; the sync must not add it twice */
                HISTORY.unshift({artist: {'#text': 'Spliff'}, name: 'Carbonara', album: {'#text': '85555'}, date: {uts: String(NOW - 300)}});
                HISTORY.unshift({artist: {'#text': 'Nena'}, name: 'Leuchtturm', date: {uts: String(NOW - 100)}});
                req('POST', '/lastfm', {action: 'import'}, function(){
                  waitFor(function(){ return !sync.importRun; }, function(){
                    t('sync: only new items since the last import, own scrobbles not twice', function(){
                      var list = store.load();
                      assert.strictEqual(list.length, 452);
                      assert.strictEqual(sync.state.lastImport.added, 1);
                      assert.strictEqual(list.filter(function(e){ return e.ti === 'Carbonara'; }).length, 1);
                      var imp = calls.filter(function(p){ return p.method === 'user.getrecenttracks'; }).pop();
                      assert.ok(+imp.from > 0 && +imp.from < NOW - 3600, 'from the last state (with buffer)');
                    });
                    sessionOk = false;
                    svcMod.tracker.onPlay({t: NOW - 50, ar: 'Nena', ti: 'Irgendwie', d: 200});
                    waitFor(function(){ return !sync.sending && !sync.state.sk; }, function(){
                      t('session invalid: queue stays, status shows "reconnect"', function(){
                        assert.strictEqual(sync.state.queue.length, 1);
                        var s = sync.status();
                        assert.ok(!s.connected); assert.strictEqual(s.user, 'celindir');
                      });
                      clearTimeout(sync.timer);
                      req('GET', '/plays?view=recent&limit=3', null, function(r){
                        t('/plays: recently played, newest first', function(){
                          assert.deepStrictEqual(r.items.map(function(e){ return e.ti; }), ['Irgendwie', 'Leuchtturm', 'Carbonara']);
                        });
                        req('GET', '/plays?view=stats&range=d30&tzw=60&tzs=120', null, function(s){
                          t('/plays: statistics', function(){ assert.strictEqual(s.stats.plays, 453); assert.strictEqual(s.stats.buckets.length, 30); });
                          console.log(n + ' checks');
                          svc.close(); fake.close();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
