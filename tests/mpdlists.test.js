/* Own lists without Volumio (tags/mpdlists.js): favourite tracks as an MPD playlist, favourite radio stations */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ml = require('../tags/mpdlists.js');
var n = 0, pending = 0;
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); }); }

function fakeMpd() {
  var pls = {};
  var m = function(cmds, cb){
    var err = null, res = cmds.map(function(c){
      var x;
      if ((x = /^listplaylist(info)? "(.*)"$/.exec(c))) {
        if (!pls[x[2]]) { err = new Error('No such playlist'); return []; }
        return [].concat.apply([], pls[x[2]].map(function(f){ return x[1] ? ['file: ' + f, 'Title: T ' + f] : ['file: ' + f]; }));
      }
      if ((x = /^playlistadd "(.*)" "(.*)"$/.exec(c))) { (pls[x[1]] = pls[x[1]] || []).push(x[2]); return []; }
      if ((x = /^playlistdelete "(.*)" (\d+)$/.exec(c))) { pls[x[1]].splice(+x[2], 1); return []; }
      return [];
    });
    setImmediate(function(){ cb(err, res); });
  };
  m.pls = pls;
  return m;
}
function items(r) { return r.navigation.lists[0].items; }

ta('favourite tracks: add once, list like Volumio\'s favourites, remove', function(done){
  var mpd = fakeMpd(), l = new ml.Lists({mpd: mpd, radioFile: '/nonexistent/x.json'});
  l.favourites(function(e0, r0){
    assert.deepStrictEqual(items(r0), []);                                     /* no playlist yet */
    l.favAdd('music-library/USB/A/1.flac', function(e){
      assert.ifError(e);
      l.favAdd('mnt/USB/A/1.flac', function(){                                 /* the same file: not twice */
        l.favAdd('http://radio/x', function(e2){
          assert.ok(e2);
          assert.deepStrictEqual(mpd.pls[ml.FAV], ['USB/A/1.flac']);
          l.favourites(function(e3, r){
            assert.strictEqual(items(r)[0].uri, 'music-library/USB/A/1.flac');
            assert.strictEqual(items(r)[0].title, 'T USB/A/1.flac');
            l.favRemove('music-library/USB/A/1.flac', function(){
              assert.deepStrictEqual(mpd.pls[ml.FAV], []);
              done();
            });
          });
        });
      });
    });
  });
});

ta('radio stations: add (http only, no duplicates), list as web radio, remove', function(done){
  var f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-radio-')), 'r.json');
  var l = new ml.Lists({mpd: fakeMpd(), radioFile: f});
  assert.strictEqual(l.radioAdd({title: 'X', uri: 'file:///etc/passwd'}).error, 'uri');
  assert.ok(l.radioAdd({title: 'SWR3', uri: 'http://swr3/live', albumart: 'javascript:x'}).ok);
  assert.ok(l.radioAdd({title: 'SWR3 neu', uri: 'http://swr3/live'}).ok);
  var it = items(l.radio());
  assert.deepStrictEqual(it, [{service: 'webradio', type: 'webradio', title: 'SWR3 neu', name: 'SWR3 neu', uri: 'http://swr3/live', albumart: ''}]);
  l.radioRemove('http://swr3/live');
  assert.deepStrictEqual(items(l.radio()), []);
  done();
});
