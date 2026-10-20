/* genre suggestions: mapping table, audio majority per album, check groups */
var assert = require('assert');
var g = require('../tags/genres.js'), lc = require('../tags/libcheck.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function A(styles) { return {styles: styles}; }

t('key and table', function(){
  assert.strictEqual(g.genreKey('Hip-Hop'), 'hiphop');
  assert.strictEqual(g.genreKey('R&B'), 'randb');
  assert.deepStrictEqual(g.topsOf('Trip-Hop'), ['Electronic']);
  assert.deepStrictEqual(g.topsOf('Klassik'), ['Classical']);
  assert.deepStrictEqual(g.topsOf('Hörspiel'), ['Non-Music']);
  assert.deepStrictEqual(g.topsOf('Folk, World, & Country'), ['Folk, World, & Country']);
  assert.deepStrictEqual(g.topsOf('Pop/Rock'), ['Rock', 'Pop']);         /* as a whole in the table */
  assert.deepStrictEqual(g.topsOf('Jazz; Blues'), ['Jazz', 'Blues']);    /* split */
  assert.deepStrictEqual(g.topsOf('Irgendwas'), []);
});

t('learn substyles from the audio analysis', function(){
  var subs = g.learnStyles([A([['Electronic---Synthwave', 0.4], ['Rock---Krautrock', 0.2]])]);
  assert.deepStrictEqual(g.topsOf('Synthwave', subs), ['Electronic']);
});

t('audio: majority across the album, substyles of the winning category', function(){
  var v = g.audioVote([A([['Electronic---Trip Hop', 0.5], ['Electronic---Downtempo', 0.3], ['Rock---Indie Rock', 0.2]]),
                       A([['Rock---Indie Rock', 0.6], ['Electronic---Trip Hop', 0.4]]),
                       A([['Electronic---Trip Hop', 0.9]]), A([])]);
  assert.strictEqual(v.tracks, 3);
  assert.strictEqual(v.order[0], 'Electronic');
  assert.deepStrictEqual(v.subs, ['Trip Hop', 'Downtempo']);
});

t('suggestion: table, ambiguous with audio, audio only, nothing', function(){
  var el = g.audioVote([A([['Electronic---Synth-pop', 0.8], ['Pop---Synth-pop', 0.2]])]);
  assert.deepStrictEqual(g.suggest({'Trip-Hop': 3}, null), {genre: 'Electronic', how: 'table', share: null});
  assert.strictEqual(g.suggest({'Synth Pop': 3}, null).genre, 'Electronic');
  assert.deepStrictEqual(g.suggest({'Indie': 3}, el), {genre: 'Pop', how: 'both', share: 0.2});   /* rock or pop: audio says pop */
  var pop = g.audioVote([A([['Pop---Ballad', 0.7], ['Rock---Soft Rock', 0.3]])]);
  assert.deepStrictEqual(g.suggest({'Indie': 3}, pop), {genre: 'Pop', how: 'both', share: 0.7});
  assert.deepStrictEqual(g.suggest({}, el), {genre: 'Electronic', how: 'audio', share: 0.8});
  assert.strictEqual(g.suggest({'Irgendwas': 2}, null), null);
  var weak = g.audioVote([A([['Rock---Punk', 0.2], ['Pop---Ballad', 0.2], ['Jazz---Swing', 0.2], ['Latin---Salsa', 0.2], ['Blues---Delta Blues', 0.2]])]);
  assert.strictEqual(g.suggest({}, weak), null);                        /* too uncertain */
});

function S(file, o) { var s = {file: file, artist: 'X', albumartist: '', album: '', title: file, track: '1', date: '', genre: ''}; for (var k in o) s[k] = o[k]; return s; }
var songs = [
  S('M/A/1.flac', {album: 'A', genre: 'Trip-Hop'}), S('M/A/2.flac', {album: 'A', genre: 'TripHop'}),
  S('M/B/1.flac', {album: 'B', genre: 'Trip Hop'}),
  S('M/C/1.flac', {album: 'C'}), S('M/C/2.flac', {album: 'C'}),
  S('M/D/1.flac', {album: 'D', genre: 'Rock'}),
  S('M/E/1.flac', {album: 'E'})
];
var audio = {'M/C/1.flac': A([['Jazz---Cool Jazz', 0.9]]), 'M/C/2.flac': A([['Jazz---Bop', 0.6], ['Blues---Delta Blues', 0.4]]),
             'M/D/1.flac': A([['Rock---Punk', 0.9]])};
var r = lc.analyze(songs, function(){ return true; }, function(s){ return audio[s.file] || null; });

t('check: no genre with suggestion first, no audio no suggestion', function(){
  assert.deepStrictEqual(r.genreMissing.map(function(x){ return [x.dir, x.genre]; }), [['M/C', 'Jazz'], ['M/E', null]]);
  assert.deepStrictEqual(r.genreMissing[0].subs, ['Cool Jazz', 'Bop']);
  assert.strictEqual(r.genreMissing[0].files.length, 2);
});

t('check: spellings grouped, matching albums not listed', function(){
  assert.deepStrictEqual(r.genreMerge.map(function(x){ return [x.from, x.genre, x.albums.length, x.files.length]; }),
    [['Trip Hop', 'Electronic', 1, 1], ['Trip-Hop / TripHop', 'Electronic', 1, 2]]);
});

t('check: substyles per album only in the result', function(){
  assert.deepStrictEqual(r.genreStyles['M/D'], {genre: 'Rock', share: 1, subs: ['Punk']});
});

t('substyles per album within its genre', function(){
  assert.deepStrictEqual(g.albumSubs([A([['Electronic---Trip Hop', 0.5], ['Electronic---Downtempo', 0.3], ['Rock---Indie Rock', 0.9]]),
                                      A([['Electronic---Trip Hop', 0.6], ['Electronic---Ambient', 0.1]])], ['Electronic']),
    ['Trip Hop', 'Downtempo']);                                          /* ambient too weak, rock does not belong */
  assert.deepStrictEqual(g.albumSubs([A([['Rock---Punk', 0.9]])], ['Jazz']), []);
});

t('substyle index and tiles, search across all genres', function(){
  var list = [{dir: 'M/A', al: 'A', ar: 'X', ge: 'Electronic'}, {dir: 'M/B', al: 'B', ar: 'Y', ge: 'electronic'},
              {dir: 'M/C', al: 'C', ar: 'Z', ge: 'Rock'}, {dir: 'M/D', al: 'D', ar: 'Z', ge: 'Rock'}];
  var tracks = [['X', '1', 'M/A/1.flac', 0, 'A'], ['Y', '1', 'M/B/CD1/1.flac', 0, 'B'], ['Z', '1', 'M/C/1.flac', 0, 'C'], ['Z', '2', 'M/D/1.flac', 0, 'D']];
  var au = {X1: A([['Electronic---Trip Hop', 0.8]]), Y1: A([['Electronic---Trip Hop', 0.4], ['Electronic---Techno', 0.4]]),
            Z1: A([['Rock---Post Rock', 0.7], ['Electronic---Trip Hop', 0.3]])};
  var idx = g.subsIndex(list, tracks, function(ar, ti){ return au[ar + ti] || null; }, function(f){ return f.replace(/\/(CD\d+\/)?[^\/]*$/, ''); });
  assert.deepStrictEqual(idx, {'M/A': ['Trip Hop'], 'M/B': ['Techno', 'Trip Hop'], 'M/C': ['Post Rock']});
  assert.deepStrictEqual(g.subList(list, idx, 'Electronic').map(function(x){ return [x.s, x.n]; }), [['Trip Hop', 2], ['Techno', 1]]);
  assert.deepStrictEqual(g.subList(list, idx, '', 'rock').map(function(x){ return [x.g, x.s, x.n, x.al]; }), [['Rock', 'Post Rock', 1, 'C']]);
});

t('genre choice in the tag editor = Discogs main genres', function(){
  var src = require('fs').readFileSync(require('path').join(__dirname, '../web/js/tagedit.js'), 'utf8');
  var m = /var GENRE_TOPS = (\[[^\]]*\]);/.exec(src);
  assert.ok(m);
  assert.deepStrictEqual(Function('return ' + m[1])(), g.TOPS);
});

console.log(n + ' checks passed');
