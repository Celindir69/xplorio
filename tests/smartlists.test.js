/* Smart playlists without Volumio (tags/smartlists.js): the plugin's rule lines, results as MPD playlists */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var sl = require('../tags/smartlists.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); }); }

var NOW = Math.floor(Date.now() / 1000);   /* the REST test runs the rules with the real clock, so the dates follow it  */
function iso(daysAgo) { return new Date((NOW - daysAgo * 86400) * 1000).toISOString(); }
var DB = [
  {file: 'USB/DM/Violator/01.flac', AlbumArtist: 'Depeche Mode', Artist: 'Depeche Mode', Title: 'World in My Eyes', Album: 'Violator', Genre: 'Synthpop', Date: '1990-03-19', Track: '1', duration: '266.1', 'Last-Modified': iso(400)},
  {file: 'USB/DM/Violator/02.flac', AlbumArtist: 'Depeche Mode', Artist: 'Depeche Mode', Title: 'Sweetest Perfection', Album: 'Violator', Genre: 'Synthpop', Date: '1990', Track: '2/9', duration: '283', 'Last-Modified': iso(400)},
  {file: 'USB/DM/Live/01.flac', AlbumArtist: 'Depeche Mode', Artist: 'Depeche Mode', Title: 'World in My Eyes', Album: '101 (Live)', Genre: 'Synthpop', Date: '1989', OriginalDate: '1988', Track: '1', duration: '300', 'Last-Modified': iso(3)},
  {file: 'USB/Mix/01.flac', AlbumArtist: 'Various Artists', Artist: 'Depeche Mode', Title: 'Enjoy the Silence', Album: '80s Mix', Genre: 'Pop', Date: '2001', Track: '1', duration: '250', 'Last-Modified': iso(1)},
  {file: 'USB/Nena/01.flac', Artist: 'Nena', Title: '99 Luftballons', Album: 'Nena', Genre: 'NDW', Date: '1983', Track: '1', duration: '230', comment: 'Single', 'Last-Modified': iso(10)}
];
function lines(list) {
  var out = [];
  list.forEach(function(s){ Object.keys(s).forEach(function(k){ out.push(k + ': ' + s[k]); }); });
  return out;
}
var TRACKS = sl.songs(lines(DB));
function files(line, rnd) { return sl.evaluate(TRACKS, sl.parse(line, function(){}), NOW, rnd || Math.random).rows.map(function(r){ return r.file; }); }

t('tracks from MPD: year from the date, track number, seconds, days since added', function(){
  assert.strictEqual(TRACKS.length, 5);
  assert.strictEqual(TRACKS[1].trk, 2); assert.strictEqual(TRACKS[0].yr, 1990); assert.strictEqual(TRACKS[2].oyr, 1988);
  assert.strictEqual(TRACKS[0].dur, 266); assert.strictEqual(TRACKS[4].aa, '-'); assert.strictEqual(TRACKS[4].cm, 'Single');
});

t('artists (album artist, else artist; various=true: the artist), filters AND of ORs', function(){
  assert.deepStrictEqual(files('DM::depeche-mode|sort=album+track+'), ['USB/DM/Live/01.flac', 'USB/DM/Violator/01.flac', 'USB/DM/Violator/02.flac']);
  assert.deepStrictEqual(files('DM::Depeche Mode|various=true|sort=added+'), ['USB/Mix/01.flac', 'USB/DM/Live/01.flac', 'USB/DM/Violator/01.flac', 'USB/DM/Violator/02.flac']);
  assert.deepStrictEqual(files('N::Nena'), ['USB/Nena/01.flac']);                              /* no album artist: by artist */
  assert.deepStrictEqual(files('X::*|album!~live|title~eyes,title~perfection|sort=track+'), ['USB/DM/Violator/01.flac', 'USB/DM/Violator/02.flac']);
  assert.deepStrictEqual(files('X::*|year<1990|sort=year+'), ['USB/Nena/01.flac', 'USB/DM/Live/01.flac']);
  assert.deepStrictEqual(files('X::*|originalyear=1988'), ['USB/DM/Live/01.flac']);
  assert.deepStrictEqual(files('X::*|added<=7|sort=added+'), ['USB/Mix/01.flac', 'USB/DM/Live/01.flac']);
  assert.deepStrictEqual(files('X::*|duration>=280').sort(), ['USB/DM/Live/01.flac', 'USB/DM/Violator/02.flac']);
  assert.deepStrictEqual(files('X::*|comment=single'), ['USB/Nena/01.flac']);
  assert.strictEqual(files('X::*|genre=synth pop').length, 3);                               /* = compares without spaces and - _ . */
  assert.strictEqual(files('X::*|genre=synth-pop').length, 3);
  assert.deepStrictEqual(files('X::*|genre=synth'), []);
});

t('duplicate=false, sort with direction, limit; unknown sort: random', function(){
  assert.deepStrictEqual(files('D::Depeche Mode|duplicate=false|sort=title+'), ['USB/DM/Violator/02.flac', 'USB/DM/Violator/01.flac']);
  assert.deepStrictEqual(files('L::*|sort=year-|limit=2'), ['USB/Mix/01.flac', 'USB/DM/Violator/01.flac']);
  assert.strictEqual(sl.parse('X::*|sort=albumx-', function(){}).sort, null);
  assert.deepStrictEqual(sl.parse('X::*|sort=originalyear-track', function(){}).sort, [{k: 'originalyear', desc: true}, {k: 'track', desc: false}]);
});

t('sort=mix: never the same artist twice in a row while another is left, artists about equally often', function(){
  var rows = [];
  for (var i = 0; i < 6; i++) rows.push({artist: 'A', al: 'a' + (i % 2), file: 'a' + i});
  for (var j = 0; j < 3; j++) rows.push({artist: 'B', al: 'b', file: 'b' + j});
  for (var r = 0; r < 20; r++) {
    var out = sl.mix(rows, Math.random), seq = out.map(function(x){ return x.artist; }).join('');
    assert.strictEqual(out.length, 9);
    assert.ok(!/BB/.test(seq), seq);
    assert.ok(/^(A|B)/.test(seq));
    var firstSix = seq.slice(0, 6);
    assert.ok((firstSix.match(/B/g) || []).length >= 2, seq);                         /* B spread out, not saved for the end */
  }
});

t('names and checks as in the plugin', function(){
  assert.strictEqual(sl.playlistOf('My/List::*'), 'My_List');
  assert.strictEqual(sl.playlistOf('A;B|year>1990'), 'A, B|year>1990');
  assert.strictEqual(sl.checkLine('A;B'), 'no_name');
  assert.strictEqual(sl.checkLine('N::|year>1'), 'bad_line');
  assert.strictEqual(sl.checkLine('N::*'), '');
});

/* MPD stand-in: database pages, stored playlists */
function fakeMpd() {
  var pls = {}, stamp = '100';
  var m = function(cmds, cb){
    var res = cmds.map(function(c){
      var x;
      if (c === 'stats') return ['db_update: ' + stamp];
      if ((x = /^search any "" window (\d+):(\d+)$/.exec(c))) return lines(DB.slice(+x[1], +x[2]));
      if ((x = /^rm "(.*)"$/.exec(c))) { delete pls[x[1]]; return []; }
      if ((x = /^playlistadd "(.*)" "(.*)"$/.exec(c))) { (pls[x[1]] = pls[x[1]] || []).push(x[2]); return []; }
      return [];
    });
    setImmediate(function(){ cb(null, res); });
  };
  m.pls = pls; m.stamp = function(s){ stamp = s; };
  return m;
}
function waitIdle(s, cb) { (function w(){ if (s.running) return setTimeout(w, 5); cb(); })(); }

ta('REST like the plugin: save runs and writes MPD playlists, list, preview, delete removes', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-smart-')), mpd = fakeMpd();
  var s = new sl.Smart({mpd: mpd, dir: dir});
  s.api({action: 'save', line: 'Depeche::Depeche Mode|sort=track+'}, function(r){
    assert.deepStrictEqual(r, {ok: true, slot: 1, playlist: 'Depeche'});
    waitIdle(s, function(){
      assert.strictEqual(mpd.pls.Depeche.length, 3);
      s.api({action: 'save', line: 'Depeche::Nena'}, function(r2){
        assert.strictEqual(r2.error, 'name_taken');
        s.api({action: 'save', line: 'Neu::*|added<5', run: false}, function(r3){
          assert.strictEqual(r3.slot, 2);
          s.api({action: 'list'}, function(l){
            assert.strictEqual(l.max, 90);
            assert.deepStrictEqual(l.rules.map(function(x){ return [x.slot, x.playlist, x.created]; }), [[1, 'Depeche', true], [2, 'Neu', false]]);
            s.api({action: 'preview', line: 'Nena|year=1983'}, function(p){
              assert.deepStrictEqual(p, {ok: true, count: 1, tracks: [{title: '99 Luftballons', artist: 'Nena', album: 'Nena'}]});
              s.api({action: 'delete', slot: 1}, function(d){
                assert.ok(d.ok);
                waitIdle(s, function(){
                  assert.ok(!mpd.pls.Depeche);
                  assert.deepStrictEqual(mpd.pls.Neu.slice().sort(), ['USB/DM/Live/01.flac', 'USB/Mix/01.flac']);   /* random order */
                  assert.ok(fs.existsSync(path.join(dir, 'smart_playlists.txt.bak')));
                  s.api({action: 'nix'}, function(b){ assert.strictEqual(b.error, 'bad_action'); done(); });
                });
              });
            });
          });
        });
      });
    });
  });
});
