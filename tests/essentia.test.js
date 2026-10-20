/* audio analysis (Essentia from the Mac): read the file, convert to mood/energy/style, merge with Last.fm,
   tempo in Mood Mix and upload via POST /essentia */
var assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'essentia-'));
var file = path.join(dir, 'essentia.jsonl');
function line(ar, ti, o) {
  var r = {v: 1, p: '/Volumes/Data/' + ar + '/' + ti + '.flac', ar: ar, ti: ti, al: o.al || 'Album', d: 200,
           bpm: o.bpm, key: 'A', scale: o.scale || 'minor', mood: o.mood || {}, dance: 0.4, voice: 0.9,
           val: o.val, aro: o.aro, styles: o.styles || []};
  return JSON.stringify(r);
}
/* 10 tracks with evenly spread arousal 3.0 … 7.5; valence as given */
var rows = [];
for (var i = 0; i < 10; i++) rows.push(line('Kai', 'Lied ' + i, {aro: 3 + i * 0.5, val: 5, bpm: 80 + i * 10}));
rows.push(line('Lena', 'Traurig', {aro: 3.1, val: 2.5, bpm: 70, mood: {sad: 0.8, relaxed: 0.7, happy: 0.1}, styles: [['Electronic---Trip Hop', 0.6], ['Electronic---Ambient', 0.3]]}));
rows.push(line('Lena', 'Wild', {aro: 7.4, val: 2.5, bpm: 170, mood: {aggressive: 0.9}}));
rows.push(line('Lena', 'Wild', {aro: 7.4, val: 2.5, bpm: 85, al: 'Live'}));   /* same title, different album */
rows.push('{"v":1,"p":"/x.dsf","err":"nicht lesbar"}');
rows.push('kaputt');
fs.writeFileSync(file, rows.join('\n') + '\n');

var essentia = require('../tags/essentia.js');
var store = new essentia.Store(file);

t('read file: skip error lines and broken lines, prefer album', function(){
  assert.strictEqual(store.status().tracks, 13);
  assert.strictEqual(store.get('Lena', 'Wild').bpm, 170);
  assert.strictEqual(store.get('Lena', 'Wild', 'Live').bpm, 85);
  assert.strictEqual(store.get('LENA', 'wild!').bpm, 170);           /* same normalization as the mood tags */
  assert.strictEqual(store.get('Niemand', 'Nichts'), null);
});

t('energy relative to the collection, moods from 0.6, quadrants from valence and arousal', function(){
  var low = store.classify(store.get('Kai', 'Lied 0')), high = store.classify(store.get('Kai', 'Lied 9'));
  assert.strictEqual(low.energy, 1);
  assert.strictEqual(high.energy, 5);
  var sad = store.classify(store.get('Lena', 'Traurig'));
  assert.deepStrictEqual(sad.mood, ['relaxed', 'sad', 'melancholic']);
  assert.strictEqual(sad.bpm, 70);
  assert.strictEqual(sad.key, 'Am');
  assert.ok(sad.style.indexOf('trip-hop') >= 0, sad.style.join());
  var wild = store.classify(store.get('Lena', 'Wild'));
  assert.deepStrictEqual(wild.mood, ['aggressive', 'intense', 'dark']);
});

t('merge: energy and tempo from the audio, moods and styles from both', function(){
  var lf = {mood: ['dreamy', 'sad'], energy: 3, style: ['ambient'], src: 'artist'};
  var r = essentia.merge(lf, store.classify(store.get('Lena', 'Traurig')));
  assert.deepStrictEqual(r.mood, ['relaxed', 'sad', 'melancholic', 'dreamy']);
  assert.strictEqual(r.energy, 1);
  assert.strictEqual(r.src, 'audio');                                 /* audio counts as track-exact */
  assert.strictEqual(r.bpm, 70);
  assert.strictEqual(essentia.merge(lf, null), lf);
  assert.strictEqual(essentia.merge(null, store.classify(store.get('Kai', 'Lied 4'))).energy, 3);
});

var mm = require('../tags/moodmix.js'), moodtags = require('../tags/moodtags.js');
var lib = [];
for (var j = 0; j < 10; j++) lib.push(['Kai', 'Lied ' + j, 'USB/Kai/' + j + '.flac', 200, 'Album']);
lib.push(['Lena', 'Traurig', 'USB/Lena/t.flac', 200, 'Album'], ['Otto', 'Ohne', 'USB/Otto/o.flac', 200, 'Album']);
var libFile = path.join(dir, 'library-tracks.json');
fs.writeFileSync(libFile, JSON.stringify(lib));
var coll = new moodtags.Collector({dir: path.join(dir, 'moodtags'), libFile: libFile, audio: store, getCfg: function(){ return {}; }, playing: function(cb){ cb(true); }});
coll.artists[moodtags.artistKey('Otto')] = {k: 'otto', g: [['happy', 100]]};   /* Last.fm only, no audio */
var ottoK = moodtags.trackKey('Otto', 'Ohne'); coll.tracks[ottoK] = {k: ottoK, g: []};     /* track queried without own tags */

t('Mood Mix: tracks with only audio analysis count, tempo narrows down', function(){
  var all = mm.count(coll, mm.parse({}));
  assert.strictEqual(all.rated, 12);
  assert.strictEqual(all.bpm, 11);
  var c = mm.parse({bmin: 100, bmax: 130});
  assert.deepStrictEqual([c.bmin, c.bmax], [100, 130]);
  assert.strictEqual(mm.count(coll, c).count, 4);                      /* 100, 110, 120, 130 */
  var m = mm.build(coll, {}, mm.parse({bmin: 100, bmax: 130, n: 6}), Math.random);
  assert.strictEqual(m.level, 2);                                      /* 4 exact hits for 6 tracks: relaxed, tempo stays ±8 */
  m.tracks.forEach(function(x){ assert.ok(x.bpm === null || (x.bpm >= 92 && x.bpm <= 138), x.ti + ' ' + x.bpm); });
  assert.deepStrictEqual(mm.parse({bmin: 300, bmax: 10}), mm.parse({}));
});

t('summary counts tracks with audio analysis', function(){
  var s = coll.summary();
  assert.strictEqual(s.audio, 11);
  assert.strictEqual(s.audioOnly, 11);
  assert.strictEqual(s.artist, 1);
});

/* upload via the tag service */
process.env.TAGS_LOG = path.join(dir, 'svc', 'changes.jsonl');
process.env.MOODTAGS = '0';
var svc = require('../tags/tag-service.js');
svc.server.listen(0, function(){
  var port = svc.server.address().port;
  var body = rows.slice(0, 3).join('\n') + '\n';
  /* aborted upload: no half file, the next upload works */
  var ab = http.request({port: port, method: 'POST', path: '/essentia', headers: {'Content-Type': 'application/x-ndjson', 'Content-Length': 100000}});
  ab.on('error', function(){});
  ab.write(rows[0] + '\n');
  setTimeout(function(){ ab.destroy(); setTimeout(upload, 200); }, 100);
  function upload() {
  t('aborted upload leaves no file', function(){
    assert.ok(!fs.existsSync(path.join(dir, 'svc', 'essentia.jsonl.neu')));
    assert.ok(!fs.existsSync(path.join(dir, 'svc', 'essentia.jsonl')));
  });
  var req = http.request({port: port, method: 'POST', path: '/essentia', headers: {'Content-Type': 'application/x-ndjson'}}, function(res){
    var d = '';
    res.on('data', function(c){ d += c; });
    res.on('end', function(){
      var j = JSON.parse(d);
      t('POST /essentia saves the file and reports the number of entries', function(){
        assert.strictEqual(j.ok, true);
        assert.strictEqual(j.tracks, 3);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'svc', 'essentia.jsonl'), 'utf8'), body);
      });
      http.get({port: port, path: '/moodtags'}, function(r2){
        var e = '';
        r2.on('data', function(c){ e += c; });
        r2.on('end', function(){
          t('GET /moodtags reports the audio analysis status', function(){
            assert.strictEqual(JSON.parse(e).audio.tracks, 3);
          });
          svc.server.close();
          console.log(n + ' checks passed');
          process.exit(0);
        });
      });
    });
  });
  req.end(body);
  }
});
