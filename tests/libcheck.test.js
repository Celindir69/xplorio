/* library check: evaluation, spelling key, reading from a fake MPD, folders without image */
var assert = require('assert'), net = require('net'), fs = require('fs'), path = require('path'), os = require('os');
var lc = require('../tags/libcheck.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function S(file, o) { var s = {file: file, artist: '', albumartist: '', album: '', title: '', track: '', date: ''}; for (var k in o) s[k] = o[k]; return s; }

var songs = [
  S('USB/A/Album1/01.flac', {artist: 'Spliff', albumartist: 'Spliff', album: '85555', title: 'Carbonara', track: '1', date: '1982'}),
  S('USB/A/Album1/02.flac', {artist: 'Spliff', albumartist: 'Spliff', album: '85555', title: 'Deja Vu', track: '2', date: '1982-05-01'}),
  S('USB/C/NDW/01.flac', {artist: 'SPLIFF', album: 'NDW Hits', title: 'Das Blech', track: '1', date: '1999'}),
  S('USB/C/NDW/02.flac', {artist: 'Nena', album: 'NDW Hits', title: '99 Luftballons', track: '', date: '1999'}),
  S('USB/C/Mix/01.flac', {artist: 'The Cure', albumartist: 'Various Artists', album: 'Mix', track: '1', date: '2001'}),
  S('USB/C/Mix/02.flac', {artist: 'Cure', albumartist: 'Various', album: 'Mix 2', track: '2', date: '2003'}),
  S('USB/D/Café/01.flac', {artist: 'Café del Mar', album: 'C', track: '1'}),
  S('USB/D/Cafe/01.flac', {artist: 'Cafe Del Mar', album: 'C', track: '1'})
];
var r = lc.analyze(songs, function(d){ return d !== 'USB/C/NDW'; });
t('counters', function(){ assert.strictEqual(r.songs, 8); assert.strictEqual(r.albums, 5); });
t('no cover: only the folder without image', function(){
  assert.deepStrictEqual(r.noCover.map(function(x){ return x.dir; }), ['USB/C/NDW']);
  assert.deepStrictEqual(r.noCover[0].files[0], {uri: 'USB/C/NDW/01.flac', title: 'Das Blech'});
});
t('album artist: compilation without and with inconsistent album artist', function(){
  assert.deepStrictEqual(r.albumArtist.map(function(x){ return x.dir; }), ['USB/C/Mix', 'USB/C/NDW']);
  var ndw = r.albumArtist[1];
  assert.strictEqual(ndw.missing, true); assert.deepStrictEqual(ndw.artists, ['SPLIFF', 'Nena']);
});
t('inconsistent: album name and year separately (same year in another format does not count)', function(){
  assert.deepStrictEqual(r.albumName.map(function(x){ return x.dir; }), ['USB/C/Mix']);
  assert.deepStrictEqual(r.albumName[0].names, [{name: 'Mix', count: 1}, {name: 'Mix 2', count: 1}]);
  assert.deepStrictEqual(r.yearMixed.map(function(x){ return [x.dir, x.years.map(function(y){ return y.name; }), x.most]; }), [['USB/C/Mix', ['2001', '2003'], '2001']]);
});
t('album name: disc additions over disc folders, bare name, disc number only where empty', function(){
  var a = lc.analyze([S('U/B/Hits/CD1/01.flac', {artist: 'B', album: 'Hits (Disc 1)', title: 'a', track: '1', disc: '1'}),
                      S('U/B/Hits/CD2/01.flac', {artist: 'B', album: 'Hits (Disc 2)', title: 'b', track: '1'}),
                      S('U/B/Hits/CD2/02.flac', {artist: 'B', album: 'Hits [CD 2]', title: 'c', track: '2'})], function(){ return true; }).albumName;
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].dir, 'U/B/Hits'); assert.strictEqual(a[0].bare, 'Hits');
  assert.deepStrictEqual(a[0].files.map(function(f){ return [f.album, f.disc]; }), [['Hits (Disc 1)', undefined], ['Hits (Disc 2)', '2'], ['Hits [CD 2]', '2']]);
  assert.deepStrictEqual([lc.bareAlbum('Greatest Hits Vol. 2'), lc.discOfName('Album - CD2'), lc.discOfName('Album (Disc 1 of 2)')], ['Greatest Hits Vol. 2', '2', '1']);
});
t('no track number', function(){
  assert.deepStrictEqual(r.noTrack.map(function(x){ return [x.dir, x.missing]; }), [['USB/C/NDW', 1]]);
});
t('missing basic tags: per folder, counted per tag, file names of the tracks', function(){
  assert.deepStrictEqual(r.noTags.map(function(x){ return [x.dir, x.title, x.artist, x.album]; }),
    [['USB/C/Mix', 2, 0, 0], ['USB/D/Cafe', 1, 0, 0], ['USB/D/Café', 1, 0, 0]]);
  assert.deepStrictEqual(r.noTags[0].without, ['01.flac', '02.flac']);
  assert.strictEqual(lc.missingTags([S('U/a.mp3', {title: ' ', artist: 'A', album: ''})]).album, 1);
  assert.strictEqual(lc.missingTags([S('U/a.mp3', {title: 'T', artist: 'A', album: 'B'})]), null);
});
t('mixed quality: lossless next to lossy in one album (disc folders together), not FLAC next to ALAC', function(){
  var q = lc.analyze([
    S('U/X/Alb/CD1/01.flac', {artist: 'X', album: 'Alb', title: 'a', track: '1', disc: '1', format: '44100:16:2'}),
    S('U/X/Alb/CD1/02.flac', {artist: 'X', album: 'Alb', title: 'b', track: '2', disc: '1', format: '44100:16:2'}),
    S('U/X/Alb/CD2/01.mp3', {artist: 'X', album: 'Alb', title: 'c', track: '1', disc: '2', format: '44100:24:2', time: '200', size: 8000000}),
    S('U/Y/Ok/01.flac', {artist: 'Y', album: 'Ok', title: 'd', track: '1', format: '44100:16:2'}),
    S('U/Y/Ok/02.m4a', {artist: 'Y', album: 'Ok', title: 'e', track: '2', format: '44100:16:2'})
  ], function(){ return true; }).mixedQuality;
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].dir, 'U/X/Alb');
  assert.deepStrictEqual(q[0].formats, [{name: 'FLAC 16/44.1', count: 2}, {name: 'MP3', count: 1}]);
  assert.strictEqual(q[0].lossy, 1);
  assert.deepStrictEqual(q[0].worse, [{uri: 'U/X/Alb/CD2/01.mp3', name: 'c', format: 'MP3 320 kbps', seconds: 200, track: 1, disc: 2}]);
  assert.strictEqual(q[0].files.length, 3);
  assert.deepStrictEqual(r.mixedQuality, []);
});
t('no gaps in the regular test albums', function(){ assert.deepStrictEqual(r.gaps, []); });
function G(dir, tracks, o) {
  return tracks.map(function(tr, i){ return S(dir + '/' + i + '.flac', Object.assign({album: 'A', track: tr}, o || {})); });
}
function gaps(dir, list) { return lc.trackGaps(dir, list).map(function(g){ return [g.disc, g.nums]; }); }
t('gaps: missing numbers, from 1', function(){
  assert.deepStrictEqual(gaps('X', G('X', ['3', '7', '10'])), [[0, '1–2, 4–6, 8–9']]);
  assert.deepStrictEqual(gaps('X', G('X', ['5', '6', '7'])), [[0, '1–4']]);
  assert.deepStrictEqual(gaps('X', G('X', ['1', '2', '3'])), []);
});
t('gaps: total from 3/10 finds missing tracks at the end', function(){
  assert.deepStrictEqual(gaps('X', G('X', ['1/10', '2/10', '3/10'])), [[0, '4–10']]);
  assert.deepStrictEqual(gaps('X', G('X', ['1/3', '2/3', '3/3'])), []);
});
t('gaps: numbers used twice are no gap (duplicate tracks)', function(){
  assert.deepStrictEqual(gaps('X', G('X', ['1', '2', '2', '3'])), []);
});
t('gaps: discs one by one (tag or CD2 folder), a later disc may count on', function(){
  var two = G('X', ['1', '2', '3'], {disc: '1/2'}).concat(G('X', ['1', '3'], {disc: '2/2'}));
  assert.deepStrictEqual(gaps('X', two), [[2, '2']]);
  assert.deepStrictEqual(gaps('X/CD2', G('X/CD2', ['11', '12', '13'])), []);
  assert.deepStrictEqual(gaps('X/CD2', G('X/CD2', ['1', '3'])), [[2, '2']]);
});
t('gaps: not checked for single tracks, tracks without number, nonsense numbers; track 0 ignored', function(){
  assert.deepStrictEqual(gaps('X', G('X', ['7'])), []);
  assert.deepStrictEqual(gaps('X', G('X', ['1', '', '3'])), []);
  assert.deepStrictEqual(gaps('X', G('X', ['1', '1999'])), []);
  assert.deepStrictEqual(gaps('X', G('X', ['0', '1', '2'])), []);
});
t('gaps: loose tracks of different albums in one folder are single tracks', function(){
  var loose = [S('L/a.mp3', {album: 'A', track: '4'}), S('L/b.mp3', {album: 'B', track: '9'})];
  assert.deepStrictEqual(gaps('L', loose), []);
});
t('gaps: in analyze, with files of the folder', function(){
  var g = lc.analyze(G('USB/G', ['1', '3']), function(){ return true; }).gaps;
  assert.strictEqual(g.length, 1); assert.strictEqual(g[0].nums, '2'); assert.strictEqual(g[0].missing, 1);
  assert.strictEqual(g[0].files.length, 2); assert.strictEqual(g[0].dir, 'USB/G');
});
t('no duplicate tracks in the regular test albums', function(){ assert.deepStrictEqual(r.dupTracks, []); });
function D(file, o) { var s = S(file, {artist: 'A', album: 'X'}); for (var k in o) s[k] = o[k]; return s; }
function dups(list) { return lc.trackDups(list).map(function(g){ return [g.why, g.sure, g.files.map(function(s){ return s.file; })]; }); }
t('duplicate tracks: copy names, the same track in two formats', function(){
  assert.deepStrictEqual(dups([D('U/a/01 Song.flac', {title: 'Song', track: '1', time: '200', format: '44100:16:2'}), D('U/a/01 Song (1).flac', {title: 'Song', track: '1', time: '200'})]),
    [['copy', true, ['U/a/01 Song.flac', 'U/a/01 Song (1).flac']]]);
  assert.deepStrictEqual(dups([D('U/a/02.mp3', {title: 'Other', track: '2', time: '100'}), D('U/a/02.flac', {title: 'Other', track: '2', time: '100'})]),
    [['format', true, ['U/a/02.flac', 'U/a/02.mp3']]]);   /* lossless first */
});
t('duplicate tracks: lossy ones by data rate (file size and time), AAC a little ahead; songs for the tag service', function(){
  var list = [D('U/a/r1.mp3', {title: 'Rate', track: '3', time: '200', size: 128000 / 8 * 200}),
              D('U/a/r2.m4a', {title: 'Rate', track: '3', time: '200', size: 300000 / 8 * 200, format: '44100:f:2'}),
              D('U/a/r3.mp3', {title: 'Rate', track: '3', time: '200', size: 320000 / 8 * 200})];
  assert.deepStrictEqual(dups(list), [['same', true, ['U/a/r2.m4a', 'U/a/r3.mp3', 'U/a/r1.mp3']]]);
  assert.deepStrictEqual(lc.dupTrackSongs(list.concat([D('U/a/04.mp3', {title: 'Alone', track: '4'})])).map(function(x){ return x.file; }).sort(),
    ['U/a/r1.mp3', 'U/a/r2.m4a', 'U/a/r3.mp3']);
});
t('duplicate tracks: same title, same or different length; remaster additions do not count, others do', function(){
  assert.deepStrictEqual(dups([D('U/a/05.flac', {title: 'Jump', track: '5', time: '100'}), D('U/a/06.flac', {title: 'Jump (2009 Remaster)', track: '6', time: '101'})]),
    [['same', true, ['U/a/05.flac', 'U/a/06.flac']]]);
  assert.deepStrictEqual(dups([D('U/a/05.flac', {title: 'Jump', track: '5', time: '100'}), D('U/a/06.flac', {title: 'Jump', track: '6', time: '250'})]),
    [['length', false, ['U/a/05.flac', 'U/a/06.flac']]]);
  assert.deepStrictEqual(dups([D('U/a/03.flac', {title: 'Hey (Live)', track: '3'}), D('U/a/04.flac', {title: 'Hey', track: '4'})]), []);
});
t('duplicate tracks: same number with different titles is a hint; "Song 2" alone is no copy; compilations by artist', function(){
  assert.deepStrictEqual(dups([D('U/a/07.flac', {title: 'X1', track: '7'}), D('U/a/07b.flac', {title: 'X2', track: '7'})]),
    [['number', false, ['U/a/07.flac', 'U/a/07b.flac']]]);
  assert.deepStrictEqual(dups([D('U/a/01 Song.flac', {title: 'Beetlebum', track: '1'}), D('U/a/02 Song 2.flac', {title: 'Song 2', track: '2'})]), []);
  assert.deepStrictEqual(dups([D('U/c/01.flac', {artist: 'Bing Crosby', title: 'Silent Night', track: '1'}), D('U/c/02.flac', {artist: 'Enya', title: 'Silent Night', track: '2'})]), []);
});
t('duplicate tracks: in analyze per album, disc folders together', function(){
  var d = lc.analyze([D('USB/T/A/CD1/01.flac', {title: 'Intro', track: '1', time: '60'}), D('USB/T/A/CD2/01.flac', {title: 'Intro', track: '1', time: '60'})], function(){ return true; }).dupTracks;
  assert.strictEqual(d.length, 1); assert.strictEqual(d[0].dir, 'USB/T/A');
  assert.deepStrictEqual(d[0].groups[0].files.map(function(f){ return [f.uri, f.best]; }), [['USB/T/A/CD1/01.flac', true], ['USB/T/A/CD2/01.flac', false]]);
});
t('duplicate tracks: not across versions of an album (incomplete copy in the album folder next to CD1/CD2)', function(){
  function V(f, o) { o.album = 'Hits'; o.albumartist = 'Band'; return D(f, o); }
  var d = lc.analyze([V('USB/V/Hits/01.mp3', {title: 'Intro', track: '1', time: '60'}),
                      V('USB/V/Hits/CD1/01.flac', {title: 'Intro', track: '1', disc: '1', time: '60'}),
                      V('USB/V/Hits/CD2/01.flac', {title: 'Outro', track: '1', disc: '2', time: '90'}),
                      V('USB/V/Hits/CD2/02.flac', {title: 'Outro', track: '2', disc: '2', time: '90'})], function(){ return true; });
  assert.strictEqual(d.duplicates.length, 1);                       /* listed as two versions */
  assert.deepStrictEqual(d.dupTracks.map(function(a){ return a.groups.map(function(g){ return g.title; }); }), [['Outro']]);
});
t('duplicate albums: tracks the best version lacks, with the folder to copy them into', function(){
  function V(f, o) { o.album = 'Hits'; o.albumartist = 'Band'; return D(f, o); }
  var r2 = lc.analyze([V('USB/B/Hits/CD1/01.flac', {title: 'Intro', track: '1', disc: '1', format: '44100:16:2'}),
                       V('USB/B/Hits/CD2/01.flac', {title: 'Outro', track: '1', disc: '2', format: '44100:16:2'}),
                       V('USB/M/Hits/01.mp3', {title: 'Intro (2009 Remaster)', track: '1', disc: '1'}),
                       V('USB/M/Hits/02.mp3', {title: 'Bonus', track: '2', disc: '1'}),
                       V('USB/M/Hits/03.mp3', {title: 'Outro', track: '1', disc: '2'}),
                       V('USB/M/Hits/04.mp3', {title: 'Extra', track: '2', disc: '2'}),
                       V('USB/M/Hits/05.mp3', {title: 'Third', track: '1', disc: '3'})], function(){ return true; });
  var g = r2.duplicates[0];
  assert.deepStrictEqual(g.versions[0].dirs, ['USB/B/Hits/CD1', 'USB/B/Hits/CD2']);
  assert.deepStrictEqual(g.missing.map(function(m){ return [m.title, m.to, m.worse]; }),
    [['Bonus', 'USB/B/Hits/CD1', true], ['Extra', 'USB/B/Hits/CD2', true], ['Third', 'USB/B/Hits/CD3', true]]);
  var r3 = lc.analyze([V('USB/B/Hits/01.flac', {title: 'Intro', track: '1'}), V('USB/M/Hits/01.mp3', {title: 'Intro', track: '1'})], function(){ return true; });
  assert.strictEqual(r3.duplicates[0].missing, undefined);           /* nothing missing */
  var r4 = lc.analyze([V('USB/B/Hits/03.flac', {title: 'The More You Live, The More You Love', track: '3'}),
                       V('USB/B/Hits/04.flac', {title: 'Four', track: '4'}),
                       V('USB/M/Hits/03.mp3', {title: 'The More You Live, The More Yo', track: '3'}),     /* cut short */
                       V('USB/M/Hits/04.mp3', {title: 'Vier', track: '4'}),                             /* number there */
                       V('USB/M/Hits/09.mp3', {title: 'Bonus', track: '9'})], function(){ return true; });
  assert.deepStrictEqual(r4.duplicates[0].missing.map(function(m){ return [m.title, m.sure, m.taken]; }),
    [['Vier', false, 'Four'], ['Bonus', true, undefined]]);                /* number taken: listed, but not checked */
  var r5 = lc.analyze([V('USB/B/Hits/11.flac', {title: 'Northern Skies', track: '11'}),
                       V('USB/M/Hits/2-3.mp3', {title: 'Northern Skies (Remix)', track: '3', disc: '2'})], function(){ return true; });
  assert.deepStrictEqual(r5.duplicates[0].missing.map(function(m){ return m.title; }), ['Northern Skies (Remix)']);   /* addition: another track */
});
t('spellings: case, The, accents', function(){
  var g = r.spelling.map(function(x){ return x.variants.map(function(v){ return v.name; }).sort().join('|'); });
  assert.ok(g.indexOf('SPLIFF|Spliff') >= 0);
  assert.ok(g.indexOf('Cure|The Cure') >= 0);
  assert.ok(g.indexOf('Cafe Del Mar|Café del Mar') >= 0);
  assert.ok(!g.some(function(x){ return /Various/.test(x); }));     /* "Various" and "Various Artists" are different */
  assert.strictEqual(r.spelling.filter(function(x){ return x.variants[0].name === 'Spliff'; })[0].variants[0].count, 2);
});
t('spellings: suggestion is the most common one, cleaned; invisible differences are named', function(){
  assert.strictEqual(r.spelling.filter(function(x){ return x.variants[0].name === 'Spliff'; })[0].suggest, 'Spliff');
  var songs = [];
  function add(a, k) { for (var i = 0; i < k; i++) songs.push({file: 'USB/S/' + a.length + '/' + i + '.flac', artist: a, title: 't' + i, album: 'A', track: String(i + 1)}); }
  add('Lumen Drift', 3); add('Lumen  Drift', 1); add('Velvet\u00a0Static ', 1); add('Velvet Static', 1);
  var sp = lc.analyze(songs, function(){ return true; }).spelling;
  var lumen = sp.filter(function(x){ return x.key === 'lumendrift'; })[0], velvet = sp.filter(function(x){ return x.key === 'velvetstatic'; })[0];
  assert.strictEqual(lumen.suggest, 'Lumen Drift');
  assert.deepStrictEqual(lumen.variants[1].flaws, ['double']);
  assert.strictEqual(velvet.suggest, 'Velvet Static');                            /* tie: the one without flaws */
  assert.deepStrictEqual(velvet.variants.filter(function(v){ return v.flaws; })[0].flaws, ['edge', 'nbsp']);
});
t('artistKey', function(){
  assert.strictEqual(lc.artistKey('Simon & Garfunkel'), lc.artistKey('Simon and Garfunkel'));
  assert.notStrictEqual(lc.artistKey('Nena'), lc.artistKey('Nina'));
});

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
['USB/A/Album1', 'USB/C/NDW'].forEach(function(d){ fs.mkdirSync(path.join(root, d), {recursive: true}); });
fs.writeFileSync(path.join(root, 'USB/A/Album1/folder.JPG'), 'x');
lc.dirsWithoutImage(songs.slice(0, 4), root, function(list){
  t('folders without image file (asynchronous)', function(){
    assert.deepStrictEqual(list, [{dir: 'USB/C/NDW', file: 'USB/C/NDW/01.flac'}]);
  });
});

/* fake MPD: lsinfo per folder */
var tree = {
  '': 'directory: USB\nplaylist: x.m3u\n',
  'USB': 'directory: USB/A\ndirectory: USB/kaputt\ndirectory: USB/S\n',
  'USB/S': 'directory: USB/S/Xplorio Duplicates\ndirectory: USB/S/Abbey Road\ndirectory: USB/S/Abbey Road (Remastered)\ndirectory: USB/S/Let It Be\ndirectory: USB/S/Help\n',
  'USB/S/Help': 'file: USB/S/Help/1.flac\nArtist: The Beatles\nAlbum: Help!\nTitle: Help!\nTrack: 1\nfile: USB/S/Help/1 (1).flac\nArtist: The Beatles\nAlbum: Help!\nTitle: Help!\nTrack: 1\n',
  'USB/S/Let It Be': 'file: USB/S/Let It Be/1.flac\nArtist: The Beatles\nAlbum: Let It Be\nTrack: 1\n',
  'USB/S/Xplorio Duplicates': 'directory: USB/S/Xplorio Duplicates/Help\n',
  'USB/S/Xplorio Duplicates/Help': 'file: USB/S/Xplorio Duplicates/Help/1.mp3\nArtist: The Beatles\nAlbum: Help!\n',
  'USB/S/Abbey Road': 'file: USB/S/Abbey Road/1.mp3\nArtist: The Beatles\nAlbum: Abbey Road\nFormat: 44100:24:2\nTime: 259\n' +
                      'file: USB/S/Abbey Road/2.mp3\nArtist: The Beatles\nAlbum: Abbey Road\nTitle: Something\nTrack: 2\nTime: 180\n',
  'USB/S/Abbey Road (Remastered)': 'file: USB/S/Abbey Road (Remastered)/1.flac\nArtist: Beatles\nAlbum: Abbey Road (2019 Remaster)\nFormat: 96000:24:2\nTime: 260\n',
  'USB/A': 'file: USB/A/1.flac\nArtist: Spliff\nArtist: Zweiter\nAlbum: 85555\nTrack: 1\nTitle: Carbonara\nGenre: Rock\nTime: 245\nfile: USB/A/2.flac\nTitle: Ohne Tags\n'
};
var srv = net.createServer(function(c){
  c.write('OK MPD 0.19.0\n');
  var b = '';
  c.on('data', function(d){
    b += d;
    var i;
    while ((i = b.indexOf('\n')) >= 0) {
      var l = b.slice(0, i); b = b.slice(i + 1);
      if (l === 'status') { c.write('state: stop\nOK\n'); continue; }
      if (l === 'stats') { c.write('db_update: 1\nOK\n'); continue; }
      var m = /^lsinfo "(.*)"$/.exec(l);
      if (!m) continue;
      if (tree.hasOwnProperty(m[1])) c.write(tree[m[1]] + 'OK\n');
      else c.write('ACK [50@0] {lsinfo} No such directory\n');
    }
  });
});
srv.listen(0, function(){
  var prog = [];
  lc.mpdWalk({port: srv.address().port}, function(err, list, dirs){
    t('read MPD: all folders, tracks with tags, broken folder skipped, duplicates folder left out', function(){
      assert.ifError(err);
      assert.strictEqual(dirs, 9);
      assert.strictEqual(list.length, 8);
      assert.deepStrictEqual(list[0], {file: 'USB/A/1.flac', artist: 'Spliff', albumartist: '', album: '85555', title: 'Carbonara', track: '1', date: '', genre: 'Rock', time: '245', 'last-modified': '', disc: '', format: ''});
      assert.strictEqual(list[4].format, '96000:24:2');
      assert.strictEqual(list[1].title, 'Ohne Tags');
      assert.ok(prog.length >= 3);
    });
    lc.mpdWalk({port: 1}, function(err2){
      t('MPD unreachable: error instead of hanging', function(){ assert.ok(err2); });
      service(srv.address().port);
    });
  }, function(d, total){ prog.push([d, total]); });
});

/* service: POST /check starts, GET /check returns progress and then the saved result */
function service(mpdPort) {
  var http = require('http');
  process.env.MUSIC_ROOT = root; process.env.MPD_PORT = String(mpdPort);
  process.env.TAGS_LOG = path.join(root, 'log', 'changes.jsonl'); process.env.PYTHON = 'false';
  var mpcLog = path.join(root, 'mpc.log');                 /* fake mpc: notes its arguments */
  fs.writeFileSync(path.join(root, 'mpc'), '#!/bin/sh\necho "$@" >> "' + mpcLog + '"\n', {mode: 493});
  process.env.MPC = path.join(root, 'mpc');
  fs.mkdirSync(path.join(root, 'log'));
  var s2 = require('../tags/tag-service.js').server;
  function call(method, route, cb, body) {
    var req = http.request({port: s2.address().port, path: route, method: method, headers: {'X-Xplorio': '1'}}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
    });
    req.end(method === 'POST' ? JSON.stringify(body || {}) : undefined);
  }
  ['USB/S/Abbey Road', 'USB/S/Abbey Road (Remastered)', 'USB/S/Let It Be', 'USB/S/Fremd', 'USB/S/Help'].forEach(function(d){ fs.mkdirSync(path.join(root, d), {recursive: true}); });
  ['USB/S/Help/1.flac', 'USB/S/Help/1 (1).flac', 'USB/S/Abbey Road/2.mp3'].forEach(function(f){ fs.writeFileSync(path.join(root, f), 'x'); });
  s2.listen(0, function(){
    call('GET', '/check', function(r0){
      t('service: no result before the first check', function(){ assert.ok(r0.ok); assert.strictEqual(r0.result, null); });
      call('POST', '/check', function(r1){
        t('service: POST /check runs in the background', function(){ assert.ok(r1.ok && r1.running); });
        (function poll(k) {
          call('GET', '/check', function(r){
            if (r.running && k < 50) return setTimeout(function(){ poll(k + 1); }, 100);
            t('service: result saved', function(){
              assert.ok(!r.running && !r.error && r.result);
              assert.strictEqual(r.result.songs, 8);
              assert.deepStrictEqual(r.result.noCover.map(function(x){ return x.dir; }), ['USB/A', 'USB/S/Abbey Road', 'USB/S/Abbey Road (Remastered)', 'USB/S/Help', 'USB/S/Let It Be']);     /* Python missing: counts as without cover */
              assert.ok(fs.existsSync(path.join(root, 'log', 'check.json')));
              var d = r.result.duplicates;
              assert.strictEqual(d.length, 1);
              assert.deepStrictEqual(d[0].versions.map(function(v){ return [v.dirs[0], v.format, v.keep]; }),
                [['USB/S/Abbey Road (Remastered)', 'FLAC 24/96', true], ['USB/S/Abbey Road', 'MP3', false]]);
            });
            call('GET', '/check?have=' + r.result.at + '&fix=' + encodeURIComponent(r.fixStamp), function(rs){
            t('service: unchanged result and suggestions are not sent again', function(){
              assert.strictEqual(rs.result, 'same'); assert.strictEqual(rs.fix, 'same');
              assert.ok(Array.isArray(r.yearFix) && Array.isArray(r.nameFix)); assert.strictEqual(rs.yearFix, undefined);
            });
            call('POST', '/filemove', function(f1){
              t('service: /filemove moves a duplicate track listed by the check into Xplorio Trash', function(){
                assert.strictEqual(r.result.dupTracks.length, 1);
                assert.deepStrictEqual(r.result.dupTracks[0].groups[0].files.map(function(f){ return f.uri; }), ['USB/S/Help/1.flac', 'USB/S/Help/1 (1).flac']);
                assert.ok(f1.ok, f1.error);
                assert.deepStrictEqual(f1.moved, [{from: 'USB/S/Help/1 (1).flac', to: 'USB/S/Xplorio Trash/Help/1 (1).flac'}]);
                assert.ok(fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Help/1 (1).flac')) && fs.existsSync(path.join(root, 'USB/S/Help/1.flac')));
              });
              call('POST', '/filemove', function(f2){
              t('service: /filemove refuses tracks that are not listed', function(){ assert.ok(!f2.ok && /not listed by the check/.test(f2.error)); });
            call('POST', '/dupfill', function(c1){
              var copy = path.join(root, 'USB/S/Abbey Road (Remastered)/2.mp3');
              t('service: /dupfill copies the tracks the best version lacks into its folder', function(){
                assert.deepStrictEqual(r.result.duplicates[0].missing.map(function(m){ return [m.uri, m.to, m.worse]; }),
                  [['USB/S/Abbey Road/2.mp3', 'USB/S/Abbey Road (Remastered)', true]]);
                assert.ok(c1.ok, c1.error);
                assert.deepStrictEqual(c1.copied, ['USB/S/Abbey Road (Remastered)/2.mp3']);
                assert.strictEqual(fs.readFileSync(copy, 'utf8'), 'x');
                assert.ok(fs.existsSync(path.join(root, 'USB/S/Abbey Road/2.mp3')));            /* the original stays */
              });
              call('POST', '/dupfill', function(c2){
                t('service: /dupfill never overwrites a file', function(){
                  assert.ok(c2.ok && !c2.copied.length && c2.skipped[0].error === 'exists');
                });
                call('POST', '/dupfill', function(u1){
                  t('service: /dupfill undo deletes the unchanged copies', function(){
                    assert.ok(u1.ok, u1.error);
                    assert.deepStrictEqual(u1.removed, ['USB/S/Abbey Road (Remastered)/2.mp3']);
                    assert.ok(!fs.existsSync(copy));
                  });
            call('POST', '/dupmove', function(m1){
              t('service: /dupmove refuses folders that are no album folder (here a whole drive)', function(){
                assert.ok(!m1.ok && /not an album folder|not ready/.test(m1.error));
                assert.ok(fs.existsSync(path.join(root, 'USB/A')));
              });
              call('POST', '/dupmove', function(m2){
                t('service: /dupmove moves into Xplorio Trash on the same drive and marks it done', function(){
                  assert.ok(m2.ok, m2.error);
                  assert.deepStrictEqual(m2.moved, [{from: 'USB/S/Abbey Road', to: 'USB/S/Xplorio Trash/Abbey Road'}]);
                  assert.ok(!fs.existsSync(path.join(root, 'USB/S/Abbey Road')));
                  assert.ok(fs.statSync(path.join(root, 'USB/S/Xplorio Trash/Abbey Road')).isDirectory());
                  assert.strictEqual(fs.readFileSync(path.join(root, 'USB/S/.mpdignore'), 'utf8'), 'Xplorio Trash\n');   /* MPD leaves it out */
                  var saved = JSON.parse(fs.readFileSync(path.join(root, 'log', 'check-done.json'), 'utf8'));
                  assert.strictEqual(saved.done['duplicates|USB/S/Abbey Road'], 1);
                });
                call('POST', '/dupmove', function(m3){
                  t('service: /dupmove of a folder that is already gone fails', function(){ assert.ok(!m3.ok); });
                  setTimeout(function(){ call('POST', '/dupmove', function(m4){   /* album list built in the meantime */
                  t('service: album editor: /dupmove moves any album folder of the library, not only duplicates', function(){
                    assert.ok(m4.ok, m4.error);
                    assert.deepStrictEqual(m4.moved, [{from: 'USB/S/Let It Be', to: 'USB/S/Xplorio Trash/Let It Be'}]);
                    assert.ok(fs.statSync(path.join(root, 'USB/S/Xplorio Trash/Let It Be')).isDirectory());
                  });
                  call('POST', '/dupmove', function(m5){
                  t('service: /dupmove refuses a folder that is not in the library', function(){
                    assert.ok(!m5.ok && /not an album folder/.test(m5.error));
                    assert.ok(fs.existsSync(path.join(root, 'USB/S/Fremd')));
                  });
                  call('POST', '/scan', function(){                 /* check closed: collected scans run now */
                    setTimeout(function(){
                      t('service: after moving, MPD rescans exactly the moved folder, not its parent or the drive', function(){
                        assert.strictEqual(fs.readFileSync(mpcLog, 'utf8'), 'update USB/S/Help\nupdate USB/S/Abbey Road (Remastered)\nupdate USB/S/Abbey Road\nupdate USB/S/Let It Be\n');
                      });
                      call('GET', '/trash', function(g1){
                      t('service: Papierkorb lists what was moved, with the reason', function(){
                        assert.ok(g1.ok, g1.error);
                        var e = {};
                        g1.drives[0].entries.forEach(function(x){ e[x.path] = [x.kind, x.reason, x.from]; });
                        assert.deepStrictEqual(e, {
                          'USB/S/Xplorio Trash/Help/1 (1).flac': ['file', 'dupTrack', 'USB/S/Help/1 (1).flac'],
                          'USB/S/Xplorio Trash/Abbey Road': ['dir', 'dupAlbum', 'USB/S/Abbey Road'],
                          'USB/S/Xplorio Trash/Let It Be': ['dir', 'albumEditor', 'USB/S/Let It Be']});
                      });
                      call('GET', '/trashfiles?p=' + encodeURIComponent('USB/S/Xplorio Trash/Abbey Road'), function(gf){
                      t('service: the files of a folder entry, one by one', function(){
                        assert.ok(gf.ok, gf.error);
                        assert.deepStrictEqual(gf.files.map(function(x){ return x.path; }), ['USB/S/Xplorio Trash/Abbey Road/2.mp3']);
                      });
                      call('POST', '/trashrestore', function(g2){
                      t('service: put back: the album is in its old place again and MPD reads exactly it', function(){
                        assert.ok(g2.ok, g2.error);
                        assert.ok(fs.statSync(path.join(root, 'USB/S/Let It Be')).isDirectory());
                      });
                      call('POST', '/trashdelete', function(g3){
                      call('GET', '/trash', function(g4){
                      t('service: delete for good; the list and the journal follow', function(){
                        assert.ok(g3.ok, g3.error);
                        assert.ok(!fs.existsSync(path.join(root, 'USB/S/Xplorio Trash/Abbey Road')));
                        assert.deepStrictEqual(g4.drives[0].entries.map(function(x){ return x.path; }), ['USB/S/Xplorio Trash/Help/1 (1).flac']);
                      });
                      setTimeout(function(){
                      t('service: after putting back MPD is asked for the folder', function(){
                        assert.ok(/update USB\/S\/Let It Be\n$/.test(fs.readFileSync(mpcLog, 'utf8')));
                      });
                      s2.close(); srv.close();
                      console.log(n + ' checks');
                      process.exit(0);
                      }, 1500);
                      });
                      }, {path: 'USB/S/Xplorio Trash/Abbey Road'});
                      }, {path: 'USB/S/Xplorio Trash/Let It Be'});
                      });
                      });
                    }, 500);
                  }, {hold: false});
                  }, {dirs: ['USB/S/Fremd']});
                  }, {dirs: ['USB/S/Let It Be']}); }, 400);
                }, {dirs: ['USB/S/Abbey Road']});
              }, {dirs: ['USB/S/Abbey Road']});
            }, {dirs: ['USB/A']});
                }, {undo: c1.batch});
              }, {dir: 'USB/S/Abbey Road (Remastered)'});
            }, {dir: 'USB/S/Abbey Road (Remastered)'});
              }, {files: ['USB/A/1.flac']});
            }, {files: ['USB/S/Help/1 (1).flac']});
            });
          });
        })(0);
      });
    });
  });
}
