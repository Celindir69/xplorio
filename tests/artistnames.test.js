/* usual spelling of artist names (tags/artistnames.js): spelling key, MusicBrainz/Last.fm hits, combinations, check list */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var an = require('../tags/artistnames.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

t('same name in another spelling: case, accents, umlauts, The, punctuation, & / and', function(){
  assert.ok(an.same('ac/dc', 'AC/DC') && an.same('Beatles', 'The Beatles') && an.same('Die Aerzte', 'Die Ärzte'));
  assert.ok(an.same('Beyonce', 'Beyoncé') && an.same('Simon and Garfunkel', 'Simon & Garfunkel'));
  assert.ok(!an.same('Nena', 'Nina') && !an.same('Prince', 'The Artist'));
});
t('MusicBrainz: only a hit in another spelling or via an alias, with a high score', function(){
  var j = {artists: [{name: 'AC/DC', score: 100, aliases: [{name: 'ACDC'}]}, {name: 'ACDC Tribute', score: 80}]};
  assert.strictEqual(an.pickMb(j, 'ac dc'), 'AC/DC');
  assert.strictEqual(an.pickMb({artists: [{name: 'Die Ärzte', score: 95, aliases: [{name: 'Die Aerzte'}]}]}, 'die aerzte'), 'Die Ärzte');
  assert.strictEqual(an.pickMb({artists: [{name: 'Diddy', score: 100, aliases: [{name: 'Puff Daddy'}]}]}, 'Puff Daddy'), 'Diddy');   /* known alias */
  assert.strictEqual(an.pickMb({artists: [{name: 'Nina Hagen', score: 100}]}, 'Nena'), '');                                  /* other name: never */
  assert.strictEqual(an.pickMb({artists: [{name: 'Nena', score: 70}]}, 'nena'), '');                                         /* score too low */
});
t('Last.fm: correction only in another spelling', function(){
  assert.strictEqual(an.pickLastfm({corrections: {correction: {artist: {name: 'Beyoncé'}}}}, 'beyonce'), 'Beyoncé');
  assert.strictEqual(an.pickLastfm({corrections: {correction: {artist: {name: 'Someone Else'}}}}, 'beyonce'), '');
  assert.strictEqual(an.pickLastfm({corrections: ''}, 'beyonce'), '');
});

/* collector with a fake MusicBrainz/Last.fm */
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an-')), file = path.join(dir, 'artistnames.jsonl'), asked = [];
var MB = {
  'ac dc': {artists: [{name: 'AC/DC', score: 100}]},
  'beyonce feat. jay-z': {artists: []},
  'beyonce': {artists: [{name: 'Beyoncé', score: 100}]},
  'jay-z': {artists: []},
  'Simon & Garfunkel': {artists: [{name: 'Simon & Garfunkel', score: 100}]}
};
var LF = {'jay-z': {corrections: {correction: {artist: {name: 'JAY-Z'}}}}};
function getJson(u, cb) {
  var m = /query=([^&]*)/.exec(u), l = /[?&]artist=([^&]*)/.exec(u);
  if (l) { var a = decodeURIComponent(l[1]); asked.push('lf:' + a); return cb(null, LF[a] || {corrections: ''}); }
  var q = JSON.parse(decodeURIComponent(m[1]));
  asked.push('mb:' + q);
  cb(null, MB[q] || {artists: []});
}
var c = new an.Collector({file: file, names: function(){ return ['ac dc', 'beyonce feat. jay-z', 'Simon & Garfunkel', 'Various Artists']; },
                         lastfmKey: function(){ return 'k'; }, getJson: getJson});
function run(k, done) { if (!k) return done(); c.step(function(){ run(k - 1, done); }); }
run(8, function(){
  t('collector: each name once, combinations whole first, then each name; Last.fm only without MusicBrainz hit', function(){
    assert.deepStrictEqual(asked, ['mb:ac dc', 'mb:beyonce feat. jay-z', 'lf:beyonce feat. jay-z', 'mb:beyonce', 'mb:jay-z', 'lf:jay-z',
                                   'mb:Simon & Garfunkel']);
    assert.strictEqual(c.next(Math.floor(Date.now() / 1000)), null);
  });
  t('suggestions: spelling, combination put back together, none if spelled right', function(){
    assert.deepStrictEqual(c.suggest('ac dc'), {to: 'AC/DC', src: 'mb'});
    assert.deepStrictEqual(c.suggest('beyonce feat. jay-z'), {to: 'Beyoncé feat. JAY-Z', src: 'lf+mb'});
    assert.strictEqual(c.suggest('Simon & Garfunkel'), null);
    assert.strictEqual(c.suggest('Unknown'), null);
  });
  t('stored: read again by a new collector', function(){
    var c2 = new an.Collector({file: file, names: function(){ return ['ac dc']; }});
    assert.deepStrictEqual(c2.suggest('ac dc'), {to: 'AC/DC', src: 'mb'});
    assert.deepStrictEqual(c2.status(), {names: 1, done: 1, fetched: 0, running: false});
  });
  t('check list: grouped by suggestion, track counts, ignored ones left out', function(){
    var sug = {'ac dc': {to: 'AC/DC', src: 'mb'}, 'Ac/Dc': {to: 'AC/DC', src: 'mb'}, 'Nena': null, 'beyonce': {to: 'Beyoncé', src: 'mb'}};
    var f = an.fixes({'ac dc': 3, 'Ac/Dc': 12, 'AC/DC': 40, 'Nena': 5, 'beyonce': 2}, function(x){ return sug[x] || null; },
                     function(name, to){ return name === 'beyonce' && to === 'Beyoncé'; });
    assert.deepStrictEqual(f, [{to: 'AC/DC', src: 'mb', variants: [{name: 'Ac/Dc', count: 12}, {name: 'ac dc', count: 3}]}]);
  });
  console.log(n + ' checks');
});
