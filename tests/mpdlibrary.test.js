/* Library and search from MPD alone (tags/mpdlibrary.js): answers in the shape of Volumio's browse and search */
var assert = require('assert');
var lib = require('../tags/mpdlibrary.js');
var n = 0, pending = 0;
function ta(name, fn) {
  pending++;
  var timer = setTimeout(function(){ console.log('FAIL ' + name + ': timeout'); process.exit(1); }, 5000);
  fn(function(){ clearTimeout(timer); n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); });
}

var SONGS = {
  'DM/Singles/01.flac': {Artist: 'Depeche Mode', AlbumArtist: 'Depeche Mode', Album: 'The Singles 86-98', Title: 'Stripped', Track: '1', Date: '1998', Genre: 'Synthpop'},
  'DM/Singles/02.flac': {Artist: 'Depeche Mode', AlbumArtist: 'Depeche Mode', Album: 'The Singles 86-98', Title: 'A Question of Lust', Track: '2', Date: '1998', Genre: 'Synthpop'},
  'DM/Violator/01.flac': {Artist: 'Depeche Mode', Album: 'Violator', Title: 'World in My Eyes', Track: '1', Date: '1990', Genre: 'Synthpop'},
  'Mix/01.flac': {Artist: 'Depeche Mode', AlbumArtist: 'Various Artists', Album: '80s Mix', Title: 'Enjoy the Silence', Track: '1'}
};
function lines(files) {
  var out = [];
  files.forEach(function(f){ out.push('file: ' + f); Object.keys(SONGS[f]).forEach(function(k){ out.push(k + ': ' + SONGS[f][k]); }); });
  return out;
}
function unq(s) { return s.replace(/^"|"$/g, '').replace(/\\"/g, '"'); }
/* MPD stand-in: find/search/lsinfo/list over SONGS */
function mpd(cmds, cb) {
  var res = cmds.map(function(c){
    var m, all = Object.keys(SONGS);
    c = c.replace(/ window \d+:\d+$/, '');
    if ((m = /^find (\w+) ("(?:[^"\\]|\\.)*")(?: (\w+) ("(?:[^"\\]|\\.)*"))?$/.exec(c))) {
      return lines(all.filter(function(f){
        function has(tag, v) { var k = Object.keys(SONGS[f]).filter(function(x){ return x.toLowerCase() === tag; })[0]; return k && SONGS[f][k] === unq(v); }
        return has(m[1], m[2]) && (!m[3] || has(m[3], m[4]));
      }));
    }
    if ((m = /^search (\w+) ("(?:[^"\\]|\\.)*")$/.exec(c))) {
      var q = unq(m[2]).toLowerCase();
      return lines(all.filter(function(f){
        var k = Object.keys(SONGS[f]).filter(function(x){ return x.toLowerCase() === m[1]; })[0];
        return k && SONGS[f][k].toLowerCase().indexOf(q) >= 0;
      }));
    }
    if ((m = /^lsinfo ("(?:[^"\\]|\\.)*")$/.exec(c))) {
      var d = unq(m[1]);
      if (d === '') return ['directory: DM', 'directory: Mix'];
      if (d === 'DM') return ['directory: DM/Singles', 'directory: DM/Violator'];
      return lines(all.filter(function(f){ return f.indexOf(d + '/') === 0 && f.slice(d.length + 1).indexOf('/') < 0; }));
    }
    if (c === 'list albumartist') return ['AlbumArtist: Depeche Mode', 'AlbumArtist: Various Artists'];
    if (c === 'list genre') return ['Genre: Synthpop'];
    if (c === 'listplaylists') return ['playlist: Abend', 'Last-Modified: x'];
    if ((m = /^listplaylistinfo /.exec(c))) return lines(['Mix/01.flac']);
    return [];
  });
  setImmediate(function(){ cb(null, res); });
}
function items(r) { var out = []; r.navigation.lists.forEach(function(l){ out = out.concat(l.items); }); return out; }

ta('folders: folders and songs, covers as Volumio\'s /albumart', function(done){
  lib.browse(mpd, 'music-library/DM', function(err, r){
    assert.ifError(err);
    var it = items(r);
    assert.deepStrictEqual(it.map(function(x){ return x.uri; }), ['music-library/DM/Singles', 'music-library/DM/Violator']);
    assert.strictEqual(it[0].type, 'folder');
    assert.strictEqual(it[0].albumart, '/albumart?path=' + encodeURIComponent('/mnt/DM/Singles'));
    lib.browse(mpd, 'music-library/DM/Singles', function(e2, r2){
      var s = items(r2);
      assert.strictEqual(s.length, 2);
      assert.strictEqual(s[0].type, 'song');
      assert.strictEqual(s[0].uri, 'music-library/DM/Singles/01.flac');
      done();
    });
  });
});

ta('artist: own albums (also without album artist tag), not the compilation', function(done){
  lib.browse(mpd, 'artists://Depeche%20Mode', function(err, r){
    assert.ifError(err);
    var it = items(r);
    assert.deepStrictEqual(it.map(function(x){ return x.title; }), ['Violator', 'The Singles 86-98']);   /* by year */
    assert.strictEqual(it[1].uri, 'albums://Depeche%20Mode/The%20Singles%2086-98');
    done();
  });
});

ta('album: tracks in order, info for the head', function(done){
  lib.browse(mpd, 'albums://Depeche%20Mode/The%20Singles%2086-98', function(err, r){
    assert.ifError(err);
    assert.deepStrictEqual(items(r).map(function(x){ return x.title; }), ['Stripped', 'A Question of Lust']);
    assert.strictEqual(r.navigation.info.artist, 'Depeche Mode');
    lib.browse(mpd, 'albums://Depeche%20Mode/Violator', function(e2, r2){       /* no album artist tag: by artist */
      assert.deepStrictEqual(items(r2).map(function(x){ return x.title; }), ['World in My Eyes']);
      done();
    });
  });
});

ta('search: artists, albums, tracks under headings the interface recognizes', function(done){
  lib.search(mpd, 'depeche', function(err, r){
    assert.ifError(err);
    var lists = r.navigation.lists;
    assert.deepStrictEqual(lists.map(function(l){ return l.title; }), ['Artists']);
    assert.deepStrictEqual(lists[0].items.map(function(x){ return x.uri; }), ['artists://Depeche%20Mode']);
    lib.search(mpd, 'silence', function(e2, r2){
      assert.deepStrictEqual(r2.navigation.lists.map(function(l){ return l.title; }), ['Tracks']);
      assert.strictEqual(r2.navigation.lists[0].items[0].artist, 'Depeche Mode');
      lib.search(mpd, 'sing', function(e3, r3){
        assert.deepStrictEqual(r3.navigation.lists[0].items.map(function(x){ return x.title; }), ['The Singles 86-98']);
        lib.search(mpd, 'x', function(e4, r4){ assert.strictEqual(r4.navigation.lists.length, 0); done(); });
      });
    });
  });
});

ta('genres, playlists, Volumio-only lists empty', function(done){
  lib.browse(mpd, 'genres://Synthpop', function(err, r){
    assert.deepStrictEqual(items(r).map(function(x){ return x.title; }), ['Violator', 'The Singles 86-98']);   /* its albums */
    lib.browse(mpd, 'playlists', function(e2, r2){
      assert.deepStrictEqual(items(r2), [{service: 'mpd', type: 'playlist', title: 'Abend', uri: 'playlists/Abend'}]);
      lib.browse(mpd, 'playlists/Abend', function(e3, r3){
        assert.strictEqual(items(r3)[0].title, 'Enjoy the Silence');
        lib.browse(mpd, 'radio/favourites', function(e4, r4){ assert.strictEqual(items(r4).length, 0); done(); });
      });
    });
  });
});

ta('cover address -> file: folder (first song, also one level down), file, artist and album', function(done){
  lib.artFile(mpd, {path: '/mnt/DM/Singles'}, function(err, f){
    assert.strictEqual(f, 'DM/Singles/01.flac');
    lib.artFile(mpd, {path: '/mnt/DM'}, function(e2, f2){
      assert.strictEqual(f2, 'DM/Singles/01.flac');
      lib.artFile(mpd, {path: '/mnt/Mix/01.flac'}, function(e3, f3){
        assert.strictEqual(f3, 'Mix/01.flac');
        lib.artFile(mpd, {web: 'Depeche%20Mode/Violator/extralarge'}, function(e4, f4){
          assert.strictEqual(f4, 'DM/Violator/01.flac');
          lib.artFile(mpd, {web: 'Depeche Mode/large', icon: 'users'}, function(e5){ assert.ok(e5); done(); });
        });
      });
    });
  });
});
