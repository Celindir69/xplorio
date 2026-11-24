/* Endless playback without Volumio (tags/autodj.js): refill near the end of the queue with a similar artist's track */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ad = require('../tags/autodj.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); }); }

var LIB = [
  {file: 'USB/DM/1.flac', Artist: 'Depeche Mode', Title: 'Enjoy the Silence', Album: 'Violator', duration: '255'},
  {file: 'USB/NO/1.flac', Artist: 'New Order', Title: 'Blue Monday', Album: 'Power', duration: '450'},
  {file: 'USB/NO/2.flac', Artist: 'New Order', Title: 'Regret (Live)', Album: 'Live', duration: '250'},
  {file: 'USB/NO/3.flac', Artist: 'New Order', Title: 'Mix', Album: 'Mix', duration: '2400'},
  {file: 'USB/PSB/1.flac', Artist: 'The Pet Shop Boys', Title: 'West End Girls', Album: 'Please', duration: '280'},
  {file: 'USB/YZ/1.flac', Artist: 'Yazoo feat. X', Title: 'Only You', Album: 'Upstairs', duration: '190'}
];
function lines(list) { var o = []; list.forEach(function(s){ Object.keys(s).forEach(function(k){ o.push(k + ': ' + s[k]); }); }); return o; }

function fakeMpd(queue, st) {
  var m = function(cmds, cb){
    var res = cmds.map(function(c){
      var x;
      if (c === 'status') return Object.keys(st).map(function(k){ return k + ': ' + st[k]; });
      if (c === 'playlistinfo') return lines(queue);
      if ((x = /^search artist "(.*)"$/.exec(c))) return lines(LIB.filter(function(s){ return s.Artist.toLowerCase().indexOf(x[1].toLowerCase()) >= 0; }));
      if ((x = /^add "(.*)"$/.exec(c))) { queue.push(LIB.filter(function(s){ return s.file === x[1]; })[0]); return []; }
      return [];
    });
    setImmediate(function(){ cb(null, res); });
  };
  return m;
}
var SIM = {'depeche mode': ['Pet Shop Boys', 'New Order', 'Yazoo'], 'new order': ['Depeche Mode', 'Joy Division']};
function similar(a, cb) { setImmediate(function(){ cb(null, SIM[a.toLowerCase()] || []); }); }
function make(queue, st, extra) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-adj-'));
  var o = {mpd: fakeMpd(queue, st), file: path.join(dir, 'autodj.json'), similar: similar, ready: function(){ return true; }, random: function(){ return 0; }};
  Object.keys(extra || {}).forEach(function(k){ o[k] = extra[k]; });
  return new ad.AutoDJ(o);
}

t('helpers: names compared without case and "The", first artist, length and keywords', function(){
  assert.strictEqual(ad.norm('The Pet Shop Boys'), ad.norm('pet shop boys'));
  assert.strictEqual(ad.mainArtist('Yazoo feat. X'), 'Yazoo');
  assert.strictEqual(ad.mainArtist('A; B'), 'A');
  assert.ok(!ad.allowed({title: 'Regret (Live)', album: '', dur: 100}, {excludes: 'live; remix', maxMinutes: 20}));
  assert.ok(!ad.allowed({title: 'x', album: '', dur: 1500}, {excludes: '', maxMinutes: 20}));
  assert.ok(ad.allowed({title: 'x', album: '', dur: 1500}, {excludes: '', maxMinutes: 0}));
});

ta('adds a similar artist near the end, then guards it; nothing while off, with repeat or far from the end', function(done){
  var q = [LIB[0]], st = {state: 'play', song: '0', repeat: '0', single: '0'};
  var a = make(q, st);
  a.tick(function(e, f){
    assert.strictEqual(f, '');                                     /* off */
    a.api({enabled: true}, function(r){
      assert.deepStrictEqual([r.ok, r.enabled, r.ready, r.maxMinutes], [true, true, true, 20]);
      setTimeout(function(){
        assert.deepStrictEqual(q.map(function(x){ return x.file; }), ['USB/DM/1.flac', 'USB/PSB/1.flac']);   /* "The" aside */
        a.tick(function(e2, f2){
          assert.strictEqual(f2, 'USB/NO/1.flac');                 /* Pet Shop Boys guarded now: the next one */
          st.repeat = '1';
          a.tick(function(e3, f3){
            assert.strictEqual(f3, '');
            st.repeat = '0'; st.song = '0';
            q.push(LIB[0], LIB[0]);                                 /* 4 left after the current one */
            a.tick(function(e4, f4){
              assert.strictEqual(f4, '');
              var b = make([LIB[0]], {state: 'play', song: '0'});
              assert.strictEqual(b.s.enabled, false);               /* own file */
              var c = new ad.AutoDJ({mpd: a.o.mpd, file: a.o.file, similar: similar, ready: function(){ return true; }});
              assert.strictEqual(c.s.enabled, true);                /* kept across restarts */
              assert.strictEqual(c.s.artists.length, 2);
              done();
            });
          });
        });
      }, 30);
    });
  });
});

ta('excludes and length; all guarded: the one guarded longest ago; no key: nothing', function(done){
  var q = [LIB[1]], st = {state: 'play', song: '0'};
  var a = make(q, st);
  a.s.enabled = true;
  a.api({excludes: 'live', maxMinutes: 30}, function(r){
    assert.strictEqual(r.excludes, 'live');
    a.api({maxMinutes: -1}, function(bad){
      assert.strictEqual(bad.error, 'value');
      a.s.artists = [ad.norm('Depeche Mode')];
      a.tick(function(e, f){
        assert.strictEqual(f, 'USB/DM/1.flac');                     /* only candidate with tracks: guarded, taken anyway */
        q.length = 0; q.push(LIB[1]);
        a.s.tracks = [];
        var none = make([LIB[1]], st, {ready: function(){ return false; }});
        none.s.enabled = true;
        none.tick(function(e2, f2){
          assert.strictEqual(f2, '');
          var q2 = [LIB[1], LIB[4], LIB[0]], seen = [];                /* first seed gives nothing: other seeds of the queue */
          var r = make(q2, {state: 'play', song: '2'}, {similar: function(x, cb){ seen.push(x); similar(x, cb); }});
          r.s.enabled = true;
          r.tick(function(e3, f3){
            assert.ok(!e3);
            assert.ok(seen.length >= 2, seen.join());
            assert.strictEqual(seen[0], 'New Order');
            done();
          });
        });
      });
    });
  });
});

ta('"don\'t like" and NoMix (skipped): never picked, the next similar artist instead; no list: as before', function(done){
  var q = [LIB[0]], st = {state: 'play', song: '0'};
  var a = make(q, st, {skipped: function(){ return {'USB/PSB/1.flac': true}; }});
  a.s.enabled = true;
  a.tick(function(e, f){
    assert.strictEqual(f, 'USB/NO/1.flac');                         /* Pet Shop Boys' only track is NoMix */
    var b = make([LIB[0]], st, {skipped: function(){ throw new Error('not ready'); }});
    b.s.enabled = true;
    b.tick(function(e2, f2){
      assert.strictEqual(f2, 'USB/PSB/1.flac');                     /* list not available: not blocking */
      done();
    });
  });
});
