/* albumid.js: album recognised from track count and lengths (MusicBrainz disc ID / table of contents), names as hints */
var assert = require('assert');
var a = require('../tags/albumid.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' checks ok'); }); }

t('disc ID as MusicBrainz computes it (its documented example)', function(){
  assert.strictEqual(a.discId({first: 1, last: 6, offsets: [95462, 150, 15363, 32314, 46592, 63414, 80489]}), '49HHV7Eb8UKF3aQiNmu1GR8vKTY-');
});
t('table of contents from lengths: 2 s lead-in, 75 sectors per second', function(){
  var x = a.toc([15213 / 75, 16951 / 75, 14278 / 75, 16822 / 75, 17075 / 75, 14973 / 75]);
  assert.deepStrictEqual(x.offsets, [95462, 150, 15363, 32314, 46592, 63414, 80489]);
  assert.strictEqual(a.tocParam(x), '1+6+95462+150+15363+32314+46592+63414+80489');
  assert.strictEqual(a.toc([200, 0]), null);
});
t('hints from folder and file names', function(){
  assert.deepStrictEqual(a.hints(['USB/import/Tears for Fears - 1985 - Songs from the Big Chair [FLAC]/01 - Shout.flac']),
    {artist: 'Tears for Fears', album: 'Songs from the Big Chair', titles: ['Shout']});
  assert.deepStrictEqual(a.hints(['USB/Prince/Purple Rain/CD2/03 Prince - Computer Blue.flac']),
    {artist: 'Prince', album: 'Purple Rain', titles: ['Computer Blue']});
  assert.strictEqual(a.hints(['USB/import/Album ohne Künstler/track01.mp3']).artist, '');
});
t('album order: track numbers when all differ, else file names (natural)', function(){
  var o = a.order([{rel: 'x/10.flac'}, {rel: 'x/2.flac'}, {rel: 'x/1.flac'}]);
  assert.deepStrictEqual(o.map(function(f){ return f.rel; }), ['x/1.flac', 'x/2.flac', 'x/10.flac']);
  var p = a.order([{rel: 'x/a.flac', tags: {track: '2'}}, {rel: 'x/b.flac', tags: {track: '1/2'}}]);
  assert.deepStrictEqual(p.map(function(f){ return f.rel; }), ['x/b.flac', 'x/a.flac']);
});

/* a stand-in MusicBrainz */
function release(id, title, artist, lens, discId, va) {
  return {id: id, title: title, date: '1985-02-25', country: 'GB', 'release-group': {'first-release-date': '1985-02-25'},
    'artist-credit': [{name: artist, artist: {id: va ? '89ad4ac3-39f7-470e-963a-56509c546377' : 'a1', name: artist}}],
    media: [{position: 1, format: 'CD', discs: discId ? [{id: discId}] : [], tracks: lens.map(function(l, i){
      return {position: i + 1, title: 'Track ' + (i + 1), length: l * 1000, 'artist-credit': va ? [{name: 'Artist ' + i}] : undefined};
    })}]};
}
var LENS = [392.5, 251.2, 310.0];
var FILES = [{uri: 'USB/import/TFF - Big Chair/03.flac', rel: 'USB/import/TFF - Big Chair/03.flac', length: LENS[2]},
             {uri: 'USB/import/TFF - Big Chair/01.flac', rel: 'USB/import/TFF - Big Chair/01.flac', length: LENS[0]},
             {uri: 'USB/import/TFF - Big Chair/02.flac', rel: 'USB/import/TFF - Big Chair/02.flac', length: LENS[1]}];
var ID = a.discId(a.toc(LENS));

ta('exact disc ID: tags for each file in album order', function(done){
  var asked = [];
  var r = new a.Recognizer({stepMs: 0, getJson: function(u, cb){
    asked.push(u);
    if (/\/discid\//.test(u)) return cb(null, {id: ID, releases: [release('r1', 'Big Chair', 'TFF', LENS, ID)]});
    cb(new Error('unexpected ' + u));
  }});
  r.lookup(FILES, function(e, res){
    assert.ifError(e);
    assert.strictEqual(res.discid, ID);
    assert.strictEqual(asked.length, 1);                                    /* exact: no name search */
    var c = res.candidates[0];
    assert.strictEqual(c.match, 'exact');
    assert.ok(c.chance >= 95);
    assert.deepStrictEqual(c.items.map(function(i){ return [i.uri.slice(-7), i.tags.title, i.tags.track]; }),
      [['01.flac', 'Track 1', '1'], ['02.flac', 'Track 2', '2'], ['03.flac', 'Track 3', '3']]);
    assert.deepStrictEqual(c.items[0].tags, {title: 'Track 1', artist: 'TFF', album: 'Big Chair', albumartist: 'TFF', date: '1985-02-25', track: '1'});
    done();
  });
});

ta('fuzzy: by lengths and names, the better fitting first; compilations get Various Artists', function(done){
  var r = new a.Recognizer({stepMs: 0, getJson: function(u, cb){
    if (/\/discid\//.test(u)) return cb(null, {releases: [{id: 'far'}, {id: 'near'}]});   /* fuzzy: without tracks */
    if (/release\/far/.test(u)) return cb(null, release('far', 'Something Else', 'Other', [100, 200, 300]));
    if (/release\/near/.test(u)) return cb(null, release('near', 'Big Chair', 'TFF', [393, 251, 309]));
    if (/release\/\?query=/.test(u)) {
      assert.ok(/release%3A%22Big%20Chair%22%20AND%20artist%3A%22TFF%22%20AND%20tracks%3A3/.test(u), u);
      return cb(null, {releases: [{id: 'va'}]});
    }
    if (/release\/va/.test(u)) return cb(null, release('va', 'Big Chair Hits', 'Various Artists', [392, 251, 310], null, true));
    cb(new Error('unexpected ' + u));
  }});
  r.lookup(FILES, function(e, res){
    assert.ifError(e);
    assert.deepStrictEqual(res.candidates.map(function(c){ return [c.release, c.match]; }), [['near', 'toc'], ['far', 'toc'], ['va', 'name']]);
    assert.ok(res.candidates[0].chance > res.candidates[1].chance && res.candidates[0].chance <= 90);
    var va = res.candidates[2].items[0].tags;
    assert.deepStrictEqual([va.albumartist, va.compilation, va.artist], ['Various Artists', '1', 'Artist 0']);
    done();
  });
});

ta('wrong track count or MusicBrainz not reachable: no suggestion, no error', function(done){
  var r = new a.Recognizer({stepMs: 0, getJson: function(u, cb){
    if (/\/discid\//.test(u)) return cb(null, {releases: [release('two', 'X', 'Y', [1, 2])]});
    cb(new Error('offline'));
  }});
  r.lookup(FILES, function(e, res){
    assert.ifError(e);
    assert.deepStrictEqual(res.candidates, []);
    done();
  });
});

/* manual search: artist and album at MusicBrainz, Discogs, Apple Music, Deezer; a release fitted to the files */
var FILES2 = [1, 2, 3, 4].map(function(i){ return {uri: 'USB/x/CD' + (i < 3 ? 1 : 2) + '/0' + i + '.flac', rel: 'USB/x/CD' + (i < 3 ? 1 : 2) + '/0' + i + '.flac', length: 100 * i}; });
ta('manual search at MusicBrainz: the editions that fit the file count first, with format and track count', function(done){
  var r = new a.Recognizer({stepMs: 0, getJson: function(u, cb){
    assert.ok(/release%3A%22Big%20Chair%22%20AND%20artist%3A%22TFF%22/.test(u), u);
    cb(null, {releases: [{id: 'a', title: 'Big Chair', 'artist-credit': [{name: 'TFF'}], date: '1985', media: [{format: '12" Vinyl', 'track-count': 8}], 'track-count': 8},
                         {id: 'b', title: 'Big Chair', 'artist-credit': [{name: 'TFF'}], date: '2014', country: 'XE', status: 'Official', disambiguation: 'Deluxe',
                          media: [{format: 'CD', 'track-count': 2}, {format: 'CD', 'track-count': 2}], 'track-count': 4}]});
  }});
  r.search({source: 'mb', artist: 'TFF', album: 'Big Chair'}, FILES2, function(e, res){
    assert.ifError(e);
    assert.deepStrictEqual(res.results.map(function(x){ return [x.id, x.format, x.tracks, x.fits, x.note]; }),
      [['b', '2×CD', 4, true, 'Deluxe'], ['a', 'Vinyl', 8, false, '']]);
    done();
  });
});
ta('Discogs: only with a token (sent along); release with two CDs fitted over both folders, disc per file', function(done){
  var seen = [];
  var r = new a.Recognizer({stepMs: 0, discogsToken: function(){ return 'abc123tok'; }, getJson: function(u, cb, h){
    seen.push([u.replace(/^https:\/\/api\.discogs\.com/, ''), h.Authorization]);
    if (/database\/search/.test(u)) return cb(null, {results: [{id: 7, title: 'TFF - Big Chair', year: 2014, country: 'Europe', formats: [{name: 'CD', qty: '2', descriptions: ['Album', 'Deluxe Edition']}], label: ['Mercury']}]});
    cb(null, {id: 7, title: 'Big Chair', year: 2014, artists: [{name: 'Tears For Fears (2)', join: ''}], formats: [{name: 'CD', qty: '2'}],
              tracklist: [{position: '', type_: 'heading', title: 'CD 1'}, {position: '1-1', type_: 'track', title: 'Shout', duration: '1:41'},
                          {position: '1-2', type_: 'track', title: 'Mothers Talk', duration: '3:20'},
                          {position: '2-1', type_: 'track', title: 'Pale Shelter', duration: '5:00'}, {position: '2-2', type_: 'track', title: 'Broken', duration: '6:40'}]});
  }});
  new a.Recognizer({stepMs: 0, getJson: function(){ throw new Error('no request without token'); }}).search({source: 'discogs', album: 'x'}, FILES2, function(e0){
    assert.ok(/token/.test(e0.message));
    r.search({source: 'discogs', artist: 'TFF', album: 'Big Chair'}, FILES2, function(e, res){
      assert.ifError(e);
      assert.deepStrictEqual([res.results[0].artist, res.results[0].title, res.results[0].format, res.results[0].tracks, res.results[0].note], ['TFF', 'Big Chair', '2×CD', null, 'Deluxe Edition']);
      r.release({source: 'discogs', id: '7'}, FILES2, function(e2, c){
        assert.ifError(e2);
        assert.strictEqual(c.fit, 'ok');
        assert.deepStrictEqual(c.items.map(function(i){ return [i.tags.disc, i.tags.track, i.tags.title, i.tags.artist]; }),
          [['1', '1', 'Shout', 'Tears For Fears'], ['1', '2', 'Mothers Talk', 'Tears For Fears'], ['2', '1', 'Pale Shelter', 'Tears For Fears'], ['2', '2', 'Broken', 'Tears For Fears']]);
        assert.strictEqual(c.avgDiff, 0.3);
        assert.deepStrictEqual(c.fileNames.map(function(f){ return f.name; }), ['01.flac', '02.flac', '03.flac', '04.flac']);
        assert.ok(seen.every(function(x){ return x[1] === 'Discogs token=abc123tok'; }));
        r.release({source: 'discogs', id: '7'}, FILES2, function(){ assert.strictEqual(seen.length, 2); done(); });   /* from the cache */
      });
    });
  });
});
ta('Apple Music and Deezer: track counts in the list; more tracks than files: only as many get tags', function(done){
  var r = new a.Recognizer({stepMs: 0, getJson: function(u, cb){
    if (/itunes.*\/search/.test(u)) return cb(null, {results: [{collectionId: 11, collectionName: 'Big Chair (Deluxe)', artistName: 'TFF', trackCount: 4, releaseDate: '2014-11-10T08:00:00Z', country: 'DEU'}]});
    if (/itunes.*\/lookup/.test(u)) return cb(null, {results: [{wrapperType: 'collection', collectionId: 11, collectionName: 'Big Chair (Deluxe)', artistName: 'TFF', releaseDate: '2014-11-10T08:00:00Z'}].concat(
      [1, 2, 3, 4, 5].map(function(n){ return {wrapperType: 'track', kind: 'song', discNumber: 1, trackNumber: n, trackName: 'T' + n, trackTimeMillis: n * 100000, artistName: n === 5 ? 'TFF feat. X' : 'TFF'}; }))});
    if (/deezer.*\/search\/album/.test(u)) { assert.ok(/artist%3A%22TFF%22%20album%3A%22Big%20Chair%22/.test(u), u); return cb(null, {data: [{id: 22, title: 'Big Chair', artist: {name: 'TFF'}, nb_tracks: 3, record_type: 'album'}]}); }
    if (/deezer.*\/album\/22\/tracks/.test(u)) return cb(null, {data: [{title: 'A', duration: 100, disk_number: 1, track_position: 1, artist: {name: 'TFF'}}]});
    if (/deezer.*\/album\/22/.test(u)) return cb(null, {id: 22, title: 'Big Chair', artist: {name: 'TFF'}, release_date: '1985-02-25'});
    cb(new Error('unexpected ' + u));
  }});
  r.search({source: 'itunes', artist: 'TFF', album: 'Big Chair'}, FILES2, function(e, res){
    assert.deepStrictEqual([res.results[0].tracks, res.results[0].fits, res.results[0].format, res.results[0].date], [4, true, 'File', '2014-11-10']);
    r.release({source: 'itunes', id: '11'}, FILES2, function(e2, c){
      assert.deepStrictEqual([c.fit, c.tracksTotal, c.items.length], ['count', 5, 4]);
      r.search({source: 'deezer', artist: 'TFF', album: 'Big Chair'}, FILES2, function(e3, res3){
        assert.deepStrictEqual([res3.results[0].tracks, res3.results[0].fits], [3, false]);
        r.release({source: 'deezer', id: '22'}, FILES2, function(e4, c4){
          assert.deepStrictEqual([c4.fit, c4.items.length, c4.items[0].tags.title, c4.items[0].tags.date], ['count', 1, 'A', '1985-02-25']);
          r.release({source: 'mb', id: '../etc'}, FILES2, function(e5){ assert.ok(e5); done(); });
        });
      });
    });
  });
});

ta('Discogs compilation: each track its own artist; a track without one keeps the file\'s, never "Various Artists"', function(done){
  var r = new a.Recognizer({stepMs: 0, discogsToken: function(){ return 't'; }, getJson: function(u, cb){
    cb(null, {id: 9, title: 'Hits', year: 1999, artists: [{name: 'Various'}], formats: [{name: 'CD', qty: '1'}], tracklist: [
      {position: '1', title: 'Eins', duration: '1:40', artists: [{name: 'Nena'}]},
      {position: '2', title: 'Zwei', duration: '3:20', artists: [{name: 'Falco (2)', join: '&'}, {name: 'Udo', join: ''}]},
      {position: '3', title: 'Drei', duration: '5:00'},
      {position: '4', title: 'Vier', duration: '6:40', artists: [{name: 'Alphaville'}]}]});
  }});
  var files = [1, 2, 3, 4].map(function(i){ return {uri: 'USB/h/0' + i + '.flac', rel: 'USB/h/0' + i + '.flac', length: 100 * i}; });
  r.release({source: 'discogs', id: '9'}, files, function(e, c){
    assert.ifError(e);
    assert.deepStrictEqual(c.items.map(function(it){ return it.tags.artist; }), ['Nena', 'Falco & Udo', '', 'Alphaville']);
    assert.deepStrictEqual([c.items[0].tags.albumartist, c.items[0].tags.compilation], ['Various Artists', '1']);
    done();
  });
});
