/* mood tags: conversion of Last.fm tags (classify), collecting only in silence (Collector) and route /moodtags */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), url = require('url');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function waitFor(cond, cb) { (function poll(){ if (cond()) return cb(); setTimeout(poll, 10); })(); }

var TAGS = {                                            /* "Last.fm": track tags and artist tags */
  'track|Anna|Eins':  [{name: 'Melancholy', count: 100}, {name: 'rock', count: 60}, {name: 'seen live', count: 90}],
  'track|Anna|Zwei':  null,                             /* track unknown (error 6) */
  'track|Bert|Drei':  [{name: 'awesome', count: 100}],  /* nothing usable */
  'artist|Anna':      [{name: 'ambient', count: 100}],
  'artist|Bert':      [{name: 'happy', count: 100}, {name: 'electronic', count: 80}]
};
var calls = [];
var fake = http.createServer(function(req, res){
  var p = url.parse(req.url, true).query;
  calls.push(p);
  function json(o) { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
  if (p.api_key !== 'KEY') return json({error: 10, message: 'Invalid API key'});
  var k = p.method === 'track.gettoptags' ? 'track|' + p.artist + '|' + p.track : 'artist|' + p.artist;
  if (!TAGS[k]) return json({error: 6, message: 'Track not found'});
  json({toptags: {tag: TAGS[k], '@attr': {}}});
});

fake.listen(0, function(){
  process.env.LASTFM_URL = 'http://127.0.0.1:' + fake.address().port;
  var mt = require('../tags/moodtags.js'), classify = mt.classify;

  t('alias and case: Melancholy -> melancholic, energy from the specific tag', function(){
    var r = classify([['Melancholy', 100], ['rock', 80]]);
    assert.deepStrictEqual(r.mood, ['melancholic']);
    assert.strictEqual(r.energy, 2);                     /* rock (broad, 4) does not count against melancholic (2) */
    assert.deepStrictEqual(r.style, ['rock']);
  });
  t('only a broad genre: its energy', function(){
    assert.deepStrictEqual(classify([['rock', 100]]), {mood: [], energy: 4, style: ['rock']});
  });
  t('ignored tags do not count, but set the maximum', function(){
    var r = classify([['seen live', 100], ['ambient', 50]]);
    assert.deepStrictEqual(r.mood, ['atmospheric']);
    assert.strictEqual(r.energy, 1);
    assert.strictEqual(classify([['seen live', 100], ['favorites', 50]]), null);
  });
  t('too small counts are dropped (below 5 or below 5 % of the strongest)', function(){
    assert.deepStrictEqual(classify([['happy', 100], ['sad', 4]]).mood, ['happy']);
    assert.deepStrictEqual(classify([['happy', 1000], ['sad', 40]]).mood, ['happy']);
    assert.strictEqual(classify([['happy', 3]]), null);
  });
  t('duplicates via aliases count once (highest value)', function(){
    var a = classify([['melancholy', 100], ['melancholic', 90], ['electronic', 100]]);
    var b = classify([['melancholy', 100], ['electronic', 100]]);
    assert.deepStrictEqual(a, b);
  });
  t('opposites: both only with enough evidence', function(){
    assert.deepStrictEqual(classify([['happy', 100], ['sad', 90]]).mood.sort(), ['happy', 'sad']);
    assert.deepStrictEqual(classify([['electronic', 100], ['happy', 30], ['sad', 28]]).mood, ['happy']);
  });
  t('weak evidence: no energy, no result', function(){
    assert.strictEqual(classify([['xyz', 100], ['rock', 20]]), null);
    assert.strictEqual(classify([]), null);
    assert.strictEqual(classify(null), null);
  });
  t('artist tags weakened', function(){
    var full = classify([['happy', 100], ['sad', 90]]), weak = classify([['happy', 100], ['sad', 90]], 0.3);
    assert.deepStrictEqual(full.mood.sort(), ['happy', 'sad']);
    assert.deepStrictEqual(weak.mood, ['happy']);        /* 0.285/0.25 are below 0.35: the weaker one is dropped */
  });
  t('main artist without guests', function(){
    assert.strictEqual(mt.mainArtist('Anna feat. Bert'), 'Anna');
    assert.strictEqual(mt.mainArtist('Anna & Bert'), 'Anna');
    assert.strictEqual(mt.mainArtist('Anna, Bert'), 'Anna');
  });

  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moodtags-'));
  var libFile = path.join(dir, 'library-tracks.json');
  fs.writeFileSync(libFile, JSON.stringify([['Anna', 'Eins', 'USB/a/1.flac'], ['Anna', 'Zwei', 'USB/a/2.flac'],
    ['Bert', 'Drei', 'USB/b/3.flac'], ['Anna', 'Eins', 'USB/c/1.flac'], ['', 'Ohne', 'USB/x.flac']]));
  var playing = true, key = 'KEY';
  var c = new mt.Collector({dir: path.join(dir, 'mt'), libFile: libFile, getCfg: function(){ return {key: key}; },
    playing: function(cb){ setImmediate(function(){ cb(playing); }); }, stepMs: 5, idleMs: 1, waitMs: 20, backoffMs: 20});
  c.start();

  setTimeout(function(){
    t('music playing: no request to Last.fm', function(){
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(c.status().state, 'wartet');
    });
    playing = false;
    waitFor(function(){ return c.status().state === 'fertig'; }, function(){
      t('silent: all tracks queried, artist tags only where needed', function(){
        var m = calls.map(function(p){ return p.method + ' ' + p.artist + (p.track ? ' / ' + p.track : ''); }).sort();
        assert.deepStrictEqual(m, ['artist.gettoptags Anna', 'artist.gettoptags Bert',
          'track.gettoptags Anna / Eins', 'track.gettoptags Anna / Zwei', 'track.gettoptags Bert / Drei']);
        calls.forEach(function(p){ assert.strictEqual(p.autocorrect, '1'); });
        assert.deepStrictEqual(c.status(), {state: 'fertig', error: null, total: 3, done: 3, fetched: 5});
      });
      t('result per track: track tags, else artist tags', function(){
        var r = c.moodOf('Anna', 'Eins');
        assert.strictEqual(r.src, 'track'); assert.deepStrictEqual(r.mood, ['melancholic']);
        r = c.moodOf('anna', 'zwei');
        assert.strictEqual(r.src, 'artist'); assert.deepStrictEqual(r.mood, ['atmospheric']);
        r = c.moodOf('Bert feat. Carl', 'Drei');
        assert.strictEqual(r.src, 'artist'); assert.deepStrictEqual(r.mood, ['happy']);
        var s = c.summary();
        assert.strictEqual(s.track, 1); assert.strictEqual(s.artist, 2); assert.strictEqual(s.none, 0);
        assert.deepStrictEqual(s.moods, {melancholic: 1, atmospheric: 1, happy: 1});
      });
      t('raw tags are stored on the player (jsonl)', function(){
        var lines = fs.readFileSync(path.join(dir, 'mt', 'tracks.jsonl'), 'utf8').trim().split('\n');
        assert.strictEqual(lines.length, 3);
        assert.deepStrictEqual(JSON.parse(lines[0]).g.slice(0, 2), [['Melancholy', 100], ['rock', 60]]);
      });
      c.stop();
      var before = calls.length;
      var c2 = new mt.Collector({dir: path.join(dir, 'mt'), libFile: libFile, getCfg: function(){ return {key: key}; },
        playing: function(cb){ cb(false); }, stepMs: 5, idleMs: 1, waitMs: 20});
      t('after restart: stored tags are read', function(){
        assert.strictEqual(c2.status().done, 3);
        assert.strictEqual(c2.moodOf('Anna', 'Zwei').src, 'artist');
      });
      /* new tracks in the library, but key invalid */
      key = 'FALSCH';
      fs.writeFileSync(libFile, JSON.stringify([['Anna', 'Eins'], ['Carl', 'Vier']]));
      fs.utimesSync(libFile, new Date(), new Date(Date.now() + 5000));
      c2.start();
      waitFor(function(){ return c2.status().state === 'fehler'; }, function(){
        t('invalid key: stopped with message', function(){
          assert.ok(/Invalid API key/.test(c2.status().error));
          assert.strictEqual(calls.length, before + 1);
        });
        c2.stop();
        key = '';
        var c3 = new mt.Collector({dir: path.join(dir, 'mt'), libFile: libFile, getCfg: function(){ return {key: key}; },
          playing: function(cb){ cb(false); }, waitMs: 20});
        c3.running = true; c3.step();
        t('no LASTFM_KEY: hint instead of request', function(){
          assert.strictEqual(c3.status().state, 'fehler');
          assert.ok(/LASTFM_KEY/.test(c3.status().error));
          assert.strictEqual(calls.length, before + 1);
        });
        c3.stop();
        routeTest(dir, function(){
          fake.close();
          console.log(n + ' checks passed');
        });
      });
    });
  }, 80);
});

/* route /moodtags of the tag service */
function routeTest(dir, done) {
  var data = path.join(dir, 'svc');
  fs.mkdirSync(data); fs.mkdirSync(path.join(data, 'moodtags'));
  fs.writeFileSync(path.join(data, 'library-tracks.json'), JSON.stringify([['Anna', 'Eins', 'USB/a/1.flac'], ['Bert', 'Drei', 'USB/b/3.flac']]));
  fs.writeFileSync(path.join(data, 'moodtags', 'tracks.jsonl'), JSON.stringify({k: 'anna|eins', g: [['sad', 100]], at: 1}) + '\n');
  process.env.TAGS_LOG = path.join(data, 'changes.jsonl');
  process.env.APP_CONFIG_DIR = path.join(dir, 'keine-config');
  var svc = require('../tags/tag-service.js');
  svc.server.listen(0, function(){
    var port = svc.server.address().port;
    function get(p, cb) {
      http.get('http://127.0.0.1:' + port + p, function(res){
        var b = ''; res.on('data', function(d){ b += d; }); res.on('end', function(){ cb(JSON.parse(b)); });
      });
    }
    get('/moodtags', function(j){
      t('GET /moodtags: status and distribution', function(){
        assert.strictEqual(j.ok, true);
        assert.strictEqual(j.enabled, false);              /* switched on only on a real start */
        assert.strictEqual(j.status.total, 2); assert.strictEqual(j.status.done, 1);
        assert.deepStrictEqual(j.summary.moods, {sad: 1});
      });
      get('/moodtags?artist=Anna&title=Eins', function(j2){
        t('GET /moodtags?artist&title: raw tags and result', function(){
          assert.deepStrictEqual(j2.track, [['sad', 100]]);
          assert.strictEqual(j2.artist, null);
          assert.deepStrictEqual(j2.result.mood, ['sad']);
          assert.strictEqual(j2.result.src, 'track');
        });
        svc.server.close();
        done();
      });
    });
  });
}
