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
