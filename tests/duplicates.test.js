/* duplicate albums (tags/duplicates.js): grouping, disc folders, quality, where moved folders go */
var assert = require('assert');
var dup = require('../tags/duplicates.js'), lc = require('../tags/libcheck.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function S(file, o) { var s = {file: file, artist: '', albumartist: '', album: '', disc: '', format: '', time: '200'}; for (var k in o) s[k] = o[k]; return s; }
function find(songs) { return dup.find(songs, lc.artistKey); }

t('same album: "The", case, remaster additions do not count; best quality first', function(){
  var r = find([
    S('INTERNAL/mp3/Beatles/Abbey Road/01.mp3', {artist: 'The Beatles', album: 'Abbey Road', format: '44100:24:2'}),
    S('INTERNAL/mp3/Beatles/Abbey Road/02.mp3', {artist: 'The Beatles', album: 'Abbey Road', format: '44100:24:2'}),
    S('USB/Stick/Beatles - Abbey Road [24-96]/01.flac', {artist: 'beatles', album: 'Abbey Road (2019 Remaster) [Deluxe Edition]', format: '96000:24:2'}),
    S('USB/Stick/Beatles - Abbey Road [24-96]/02.flac', {artist: 'beatles', album: 'Abbey Road (2019 Remaster) [Deluxe Edition]', format: '96000:24:2'}),
    S('USB/Stick/AR/01.flac', {albumartist: 'The Beatles', artist: 'x', album: 'Abbey Road - 2009 Remaster', format: '44100:16:2'})
  ]);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].versions.map(function(v){ return [v.dirs[0], v.format, v.tracks, v.keep, v.drive]; }), [
    ['USB/Stick/Beatles - Abbey Road [24-96]', 'FLAC 24/96', 2, true, 'USB/Stick'],
    ['USB/Stick/AR', 'FLAC 16/44.1', 1, false, 'USB/Stick'],
    ['INTERNAL/mp3/Beatles/Abbey Road', 'MP3', 2, false, 'INTERNAL']
  ]);
  assert.strictEqual(r[0].versions[0].seconds, 400);
});

t('not duplicates: other artist, live album, no album tag, folder already moved aside', function(){
  assert.deepStrictEqual(find([
    S('USB/S/a/1.flac', {artist: 'Nena', album: 'Greatest Hits'}),
    S('USB/S/b/1.flac', {artist: 'Queen', album: 'Greatest Hits'}),
    S('USB/S/c/1.flac', {artist: 'Queen', album: 'Live Killers'}),
    S('USB/S/d/1.flac', {artist: 'Queen', album: 'Live Killers (Live)'}),
    S('USB/S/e/1.flac', {artist: 'Queen'}),
    S('USB/S/f/1.flac', {artist: 'Queen'}),
    S('USB/S/.duplicates/b/1.flac', {artist: 'Queen', album: 'Greatest Hits'}),
    S('USB/S/Xplorio Duplicates/b/1.flac', {artist: 'Queen', album: 'Greatest Hits'})
  ]), []);
});

t('compilations by album name only', function(){
  var r = find([
    S('USB/S/Bravo/1.flac', {artist: 'A', album: 'Bravo Hits 12'}), S('USB/S/Bravo/2.flac', {artist: 'B', album: 'Bravo Hits 12'}),
    S('USB/S/Bravo 2/1.mp3', {albumartist: 'Various Artists', artist: 'C', album: 'Bravo Hits 12'})
  ]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].artist, '');
  assert.strictEqual(r[0].versions[0].dirs[0], 'USB/S/Bravo');
});

t('disc folders and different disc numbers next to each other are one album', function(){
  assert.deepStrictEqual(find([
    S('USB/S/Wall/CD1/1.flac', {artist: 'Pink Floyd', album: 'The Wall'}),
    S('USB/S/Wall/CD 2/1.flac', {artist: 'Pink Floyd', album: 'The Wall'}),
    S('USB/S/PF/Wall A/1.flac', {artist: 'Pink Floyd', album: 'Animals', disc: '1/2'}),
    S('USB/S/PF/Wall B/1.flac', {artist: 'Pink Floyd', album: 'Animals', disc: '2/2'})
  ]), []);
  var r = find([                                                    /* a copy of the two-disc album elsewhere is one */
    S('USB/S/Wall/CD1/1.flac', {artist: 'Pink Floyd', album: 'The Wall', format: '44100:16:2'}),
    S('USB/S/Wall/CD2/1.flac', {artist: 'Pink Floyd', album: 'The Wall', format: '44100:16:2'}),
    S('INTERNAL/Wall/1.mp3', {artist: 'Pink Floyd', album: 'The Wall'})
  ]);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].versions[0].dirs, ['USB/S/Wall/CD1', 'USB/S/Wall/CD2']);
  assert.strictEqual(r[0].versions[0].tracks, 2);
});

t('quality: DSD before lossless before m4a before lossy', function(){
  function q(file, fmt) { return dup.quality([{file: file, format: fmt}]); }
  assert.deepStrictEqual(q('a.dsf', 'dsd64:2').format, 'DSD64');
  assert.deepStrictEqual(q('a.flac', '192000:24:2').format, 'FLAC 24/192');
  assert.deepStrictEqual(q('a.mp3', '44100:24:2').format, 'MP3');
  assert.ok(q('a.dsf', 'dsd64:2').rank > q('a.flac', '44100:16:2').rank);
  assert.ok(q('a.m4a', '').rank > q('a.mp3', '').rank && q('a.m4a', '').rank < q('a.flac', '').rank);
});

t('moved aside: hidden folder on the same drive, keeps the path', function(){
  assert.strictEqual(dup.trashPath('INTERNAL/bandcamp/X/Album'), 'INTERNAL/Xplorio Duplicates/bandcamp/X/Album');
  assert.strictEqual(dup.trashPath('USB/Stick/Album'), 'USB/Stick/Xplorio Duplicates/Album');
  assert.strictEqual(dup.trashPath('NAS/Musik/Rock/Album'), 'NAS/Musik/Xplorio Duplicates/Rock/Album');
});

t('.mpdignore: the duplicates folder added once, other lines stay', function(){
  assert.strictEqual(dup.ignoreLine(''), 'Xplorio Duplicates\n');
  assert.strictEqual(dup.ignoreLine('.duplicates'), '.duplicates\nXplorio Duplicates\n');
  assert.strictEqual(dup.ignoreLine('a\nXplorio Duplicates\n'), null);
  assert.ok(dup.isTrash('USB/S/.duplicates/x/1.mp3') && dup.isTrash('USB/S/Xplorio Duplicates/x') && !dup.isTrash('USB/S/Duplicates/x'));
});
console.log(n + ' checks');
