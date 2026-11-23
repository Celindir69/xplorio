/* shared MusicBrainz queue (tags/mbgate.js): one request at a time with a gap, pause and retry on 503, front first */
var assert = require('assert');
var Gate = require('../tags/mbgate.js').Gate;
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var log = [], answers = {};
function fetch(u, cb) {
  log.push({u: u, at: Date.now()});
  var a = answers[u] && answers[u].length ? answers[u].shift() : 'ok';
  setTimeout(function(){
    if (a === 'ok') return cb(null, {body: Buffer.from(JSON.stringify({u: u}))});
    cb(new Error(a));
  }, 2);
}
var g = new Gate({fetch: fetch, gapMs: 30, pauseMs: 60, pauseMaxMs: 200});
answers.a = ['HTTP 503', 'HTTP 503'];
var got = [], start = Date.now();
g.getJson('a', function(e, j){ got.push(['a', e ? e.message : j.u, Date.now() - start]); });
g.getJson('b', function(e, j){ got.push(['b', e ? e.message : j.u]); });
g.getJson('c', function(e, j){ got.push(['c', e ? e.message : j.u]); }, {front: true});
setTimeout(function(){
  t('503: the whole queue pauses (5 s, doubling), the request is tried again and then answered', function(){
    assert.deepStrictEqual(log.map(function(x){ return x.u; }), ['a', 'a', 'a', 'c', 'b']);
    assert.strictEqual(got[0][0], 'a'); assert.strictEqual(got[0][1], 'a');
    assert.ok(got[0][2] >= 60 + 120, 'paused ' + got[0][2]);
    assert.ok(log[2].at - log[1].at >= 115);                         /* second pause doubled */
    assert.ok(g.congested());
  });
  t('a request a person waits for goes before the background ones', function(){
    assert.deepStrictEqual(got.map(function(x){ return x[0]; }), ['a', 'c', 'b']);
  });
  t('at least the gap between two requests', function(){
    for (var i = 1; i < log.length; i++) assert.ok(log[i].at - log[i - 1].at >= 28, 'gap ' + (log[i].at - log[i - 1].at));
  });
  answers.d = ['HTTP 503', 'HTTP 503', 'HTTP 503', 'HTTP 503', 'HTTP 503'];
  answers.e = ['HTTP 404'];
  var g2 = new Gate({fetch: fetch, gapMs: 1, pauseMs: 2, pauseMaxMs: 4}), res = [];
  g2.getJson('d', function(e){ res.push(e && e.message); });
  g2.getJson('e', function(e){ res.push(e && e.message); });
  setTimeout(function(){
    t('after 4 retries the error goes to the caller; other errors right away', function(){
      assert.deepStrictEqual(res, ['HTTP 503', 'HTTP 404']);
      assert.strictEqual(g2.stats.failed, 2);
    });
    console.log(n + ' checks passed');
  }, 300);
}, 600);
