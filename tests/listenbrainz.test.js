/* ListenBrainz scrobbling (tags/listenbrainz.js): token check, queue, "now playing", refused token, bad listens */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function waitFor(cond, cb) { (function poll(){ if (cond()) return cb(); setTimeout(poll, 10); })(); }

var GOOD = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';
var posts = [], down = false, reject400 = false, html = false;
var fake = http.createServer(function(req, res){
  var body = '';
  req.on('data', function(d){ body += d; });
  req.on('end', function(){
    function json(code, o) { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
    var tok = String(req.headers.authorization || '').replace(/^Token /, ''), q = req.url.split('?');
    if (q[0] === '/1/validate-token' && html) { res.writeHead(200, {'Content-Type': 'text/html'}); return res.end('<html>proxy</html>'); }
    if (q[0] === '/1/validate-token' && q[1] !== 'token=' + encodeURIComponent(tok)) return json(400, {error: 'token mismatch'});
    if (q[0] === '/1/validate-token') return json(200, tok === GOOD ? {code: 200, valid: true, user_name: 'christian'} : {code: 200, valid: false});
    if (req.url === '/1/submit-listens') {
      if (down) return json(503, {error: 'maintenance'});
      if (tok !== GOOD) return json(401, {code: 401, error: 'Invalid authorization token.'});
      var b = JSON.parse(body);
      posts.push({ua: req.headers['user-agent'], b: b});
      if (reject400) return json(400, {code: 400, error: 'bad listen'});
      return json(200, {status: 'ok'});
    }
    json(404, {});
  });
});

fake.listen(0, function(){
  process.env.LISTENBRAINZ_URL = 'http://127.0.0.1:' + fake.address().port;
  var lb = require('../tags/listenbrainz.js');
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lbz-')), file = path.join(dir, 'listenbrainz.json'), token = '';
  var s = new lb.Sync(file, function(){ return token; });
  s.played({t: 1700000000, ar: 'R.E.M.', ti: 'Begin The Begin', al: 'Lifes Rich Pageant', d: 208});
  t('without a token: nothing queued, nothing sent', function(){
    assert.deepStrictEqual(s.status(), {configured: false, valid: null, user: null, queue: 0, sendError: null, lastSent: null});
    assert.strictEqual(posts.length, 0);
  });
  token = GOOD;
  s.check(function(){
    t('token checked: user name', function(){
      var st = s.status();
      assert.strictEqual(st.valid, true); assert.strictEqual(st.user, 'christian');
    });
    s.nowPlaying({ar: 'R.E.M.', ti: 'Begin The Begin', al: 'Lifes Rich Pageant', d: 208});
    s.played({t: 1700000000, ar: 'R.E.M.', ti: 'Begin The Begin', al: 'Lifes Rich Pageant', d: 208});
    waitFor(function(){ return posts.length === 2 && !s.state.queue.length; }, function(){
      t('now playing without a time, the play as "single" with time, album and length', function(){
        var now = posts.filter(function(p){ return p.b.listen_type === 'playing_now'; })[0].b.payload[0];
        assert.strictEqual(now.listened_at, undefined);
        assert.strictEqual(now.track_metadata.track_name, 'Begin The Begin');
        var one = posts.filter(function(p){ return p.b.listen_type === 'single'; })[0];
        assert.ok(/^Xplorio\//.test(one.ua));
        assert.deepStrictEqual(one.b.payload, [{listened_at: 1700000000, track_metadata: {artist_name: 'R.E.M.', track_name: 'Begin The Begin',
          release_name: 'Lifes Rich Pageant', additional_info: {submission_client: 'Xplorio', media_player: 'Xplorio', duration_ms: 208000}}}]);
        assert.ok(s.status().lastSent > 0);
      });
      /* offline: the queue survives a restart and goes out as "import" */
      down = true;
      s.played({t: 1700000300, ar: 'A', ti: 'Eins'});
      waitFor(function(){ return !!s.sendError; }, function(){
        clearTimeout(s.timer);
        s.played({t: 1700000600, ar: 'B', ti: 'Zwei'});
        waitFor(function(){ return !s.sending; }, function(){
          clearTimeout(s.timer);
          var s2 = new lb.Sync(file, function(){ return token; });
          t('service unreachable: plays stay queued, also after a restart', function(){
            assert.strictEqual(s2.status().queue, 2);
            assert.ok(/maintenance/.test(s.sendError));
          });
          down = false;
          posts = [];
          s2.flush();
          waitFor(function(){ return !s2.state.queue.length; }, function(){
            t('several waiting plays: one "import" request', function(){
              assert.strictEqual(posts.length, 1);
              assert.strictEqual(posts[0].b.listen_type, 'import');
              assert.deepStrictEqual(posts[0].b.payload.map(function(l){ return l.track_metadata.track_name; }), ['Eins', 'Zwei']);
            });
            reject400 = true;
            s2.played({t: 1700000900, ar: 'C', ti: 'Drei'});
            waitFor(function(){ return !s2.sending && !!s2.sendError; }, function(){
              clearTimeout(s2.timer);
              t('listens ListenBrainz refuses (400) are dropped, not sent again and again', function(){ assert.strictEqual(s2.status().queue, 0); });
              reject400 = false;
              token = '11111111-2222-3333-4444-555555555555';
              s2.played({t: 1700001200, ar: 'D', ti: 'Vier'});
              waitFor(function(){ return !s2.sending && s2.status().valid === false; }, function(){
                t('token refused (401): checked again, invalid, the play stays queued', function(){
                  assert.strictEqual(s2.status().queue, 1);
                  assert.strictEqual(s2.status().user, null);
                });
                /* a refusal stored earlier must not stick: a forced check (button, new token) asks again */
                token = GOOD; posts = [];
                s2.state.checked = {token: GOOD, at: Date.now(), valid: false, user: ''};
                s2.flush();
                t('stored refusal: nothing sent until checked again', function(){ assert.strictEqual(posts.length, 0); });
                html = true; s2.state.checked.at = Date.now() - 16 * 60000;   /* refusal older than 15 min: asked again */
                s2.check(function(e){
                  t('a check without a clear answer (HTML) keeps the last result', function(){
                    assert.ok(e); assert.strictEqual(s2.status().valid, false);
                  });
                  html = false;
                  s2.check(function(){ s2.flush(); }, true);
                  waitFor(function(){ return !s2.state.queue.length; }, function(){
                    t('forced check: valid again, the waiting play goes out', function(){
                      assert.strictEqual(s2.status().valid, true); assert.strictEqual(s2.status().user, 'christian');
                      assert.strictEqual(posts.length, 1); assert.strictEqual(s2.sendError, null);
                    });
                    s2.played({t: 1700001500, ar: 'E', ti: 'Fünf'});
                    s2.clear();
                    t('token deleted: queue and check forgotten', function(){ assert.strictEqual(s2.status().queue, 0); });
                    fake.close();
                    console.log(n + ' checks passed');
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
