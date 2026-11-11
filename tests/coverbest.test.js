/* cover suggestions for the check (tags/coverbest.js): best hit, one search at a time, stored, re-search after a while */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var cb = require('../tags/coverbest.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverbest-'));
var file = path.join(dir, 'cover-best.json');
/* fake images: the "body" carries its size, dims reads it back */
var SIZES = {
  'it/a': [1200, 1200], 'lf/a': [1500, 1500], 'caa/a': [2000, 1400],   /* not square: behind the square ones */
  'it/b': [300, 300],                                                  /* not larger than the current one */
  'it/c': [800, 800]
};
var hits = {
  'Lumen Drift|Glass Hours': [{source: 'iTunes', url: 'it/a'}, {source: 'Last.fm', url: 'lf/a'}, {source: 'Cover Art Archive', url: 'caa/a'}, {source: 'X', url: 'gone'}],
  'Velvet Static|Small': [{source: 'iTunes', url: 'it/b'}],
  '|Nachtlichter': [{source: 'iTunes', url: 'it/c'}]
};
var searches = [], running = 0, maxRunning = 0, clock = 1700000000000;
function search(q, done) {
  searches.push(q.artist + '|' + q.album); running++; maxRunning = Math.max(maxRunning, running);
  setImmediate(function(){ running--; done(hits[q.artist + '|' + q.album] || []); });
}
function load(u, done) {
  setImmediate(function(){ if (!SIZES[u]) return done(new Error('HTTP 404')); done(null, {mime: 'image/jpeg', body: Buffer.from(SIZES[u].join('x'))}); });
}
function dims(buf) { var p = String(buf).split('x'); return {w: +p[0], h: +p[1]}; }
function make() { return new cb.Best({file: file, search: search, load: load, dims: dims, gapMs: 0, now: function(){ return clock; }}); }

t('better: square first, then the larger shorter side', function(){
  assert.ok(cb.better({w: 1200, h: 1200}, {w: 2000, h: 1400}));
  assert.ok(cb.better({w: 1500, h: 1500}, {w: 1200, h: 1200}));
  assert.ok(!cb.better({w: 1200, h: 1200}, {w: 1200, h: 1200}));
});

var b = make();
var A = {dir: 'USB/L/Glass Hours', artist: 'Lumen Drift', album: 'Glass Hours', cur: {w: 300, h: 300}};
var B = {dir: 'USB/V/Small', artist: 'Velvet Static', album: 'Small', cur: {w: 400, h: 400}};
var C = {dir: 'USB/N/Nachtlichter', artist: '', album: 'Nachtlichter', cur: {w: 200, h: 200}};
assert.deepStrictEqual(b.state(A.dir, A.cur), {state: 'wait'});
b.ask(A); b.ask(A); b.ask(B); b.ask(C);
b.only([A.dir, B.dir]);                                   /* C scrolled out of sight before its turn */
(function wait() {
  if (b.busy || b.queue.length) return setTimeout(wait, 5);
  t('one search at a time, asked twice = searched once, dropped when no longer shown', function(){
    assert.strictEqual(maxRunning, 1);
    assert.deepStrictEqual(searches, ['Lumen Drift|Glass Hours', 'Velvet Static|Small']);
  });
  t('found: the largest square image', function(){
    assert.deepStrictEqual(b.state(A.dir, A.cur), {state: 'found', src: 'Last.fm', w: 1500, h: 1500, bytes: 9});
    assert.strictEqual(b.get(A.dir, A.cur).url, 'lf/a');
  });
  t('nothing larger than the current image: none', function(){
    assert.deepStrictEqual(b.state(B.dir, B.cur), {state: 'none'});
    b.ask(B);
    assert.strictEqual(b.queue.length, 0);
  });
  t('the folder has a larger image meanwhile: no suggestion', function(){
    assert.deepStrictEqual(b.state(A.dir, {w: 1600, h: 1600}), {state: 'none'});
  });
  t('stored: known after a restart', function(){
    var b2 = make();
    assert.strictEqual(b2.state(A.dir, A.cur).state, 'found');
    assert.strictEqual(b2.state(B.dir, B.cur).state, 'none');
    clock += 31 * 86400000;                                /* nothing found a month ago: search again */
    assert.strictEqual(b2.state(B.dir, B.cur).state, 'wait');
    assert.strictEqual(b2.state(A.dir, A.cur).state, 'found');
  });
  t('compilation: searched without artist', function(){
    b.ask(C);
  });
  (function wait2() {
    if (b.busy || b.queue.length) return setTimeout(wait2, 5);
    t('compilation found', function(){
      assert.strictEqual(searches[searches.length - 1], '|Nachtlichter');
      assert.strictEqual(b.state(C.dir, C.cur).w, 800);
    });
    var g = new cb.Best({file: path.join(dir, 'gap.json'), search: search, load: load, dims: dims, gapMs: 60000});
    var before = searches.length;
    g.ask({dir: 'x1', artist: 'Lumen Drift', album: 'Glass Hours', cur: {w: 1, h: 1}});
    g.ask({dir: 'x2', artist: 'Velvet Static', album: 'Small', cur: {w: 1, h: 1}});
    setTimeout(function(){
      t('pause between searches', function(){
        assert.strictEqual(searches.length, before + 1);
        assert.ok(g.timer);
      });
      clearTimeout(g.timer);
      console.log(n + ' checks');
    }, 50);
  })();
})();
