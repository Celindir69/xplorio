/* Fallback texts for artist and album (web/js/infotext.js) when Volumio returns nothing */
var assert = require('assert');
var it = require('../web/js/infotext.js');
var n = 0, pending = [];
function t(name, fn) { pending.push(fn().then(function(){ n++; console.log('ok   ' + name); })); }
function res(j, ok) { return Promise.resolve({ok: ok !== false, json: function(){ return Promise.resolve(j); }}); }
var LONG = 'Massive Attack sind eine britische Band aus Bristol, gegründet 1988, Wegbereiter des Trip-Hop.';

t('clean Last.fm text: link and license note removed, short stubs do not count', function(){
  assert.strictEqual(it.infoClean(LONG + ' <a href="https://www.last.fm/music/x">Read more on Last.fm</a>. User-contributed text is available under the Creative Commons By-SA License; additional terms may apply.'), LONG);
  assert.strictEqual(it.infoClean(' <a href="x">Read more on Last.fm</a>'), '');
  return Promise.resolve();
});

t('artist: Last.fm German first', function(){
  var urls = [];
  return it.infoFallback(function(u){ urls.push(u); return res({artist: {bio: {content: LONG}}}); }, 'KEY', 'storyArtist', 'Massive Attack', undefined, 'de')
    .then(function(r){
      assert.strictEqual(r.src, 'Last.fm');
      assert.ok(/Quelle: Last\.fm$/.test(r.value));
      assert.strictEqual(urls.length, 1);
      assert.ok(/method=artist\.getinfo/.test(urls[0]) && /lang=de/.test(urls[0]) && /artist=Massive%20Attack/.test(urls[0]));
    });
});

t('album: Last.fm English if there is no German text', function(){
  var urls = [];
  return it.infoFallback(function(u){ urls.push(u); return res(/lang=de/.test(u) ? {album: {}} : {album: {wiki: {summary: LONG}}}); },
    'KEY', 'storyAlbum', 'Massive Attack', 'Mezzanine', 'de').then(function(r){
      assert.strictEqual(urls.length, 2);
      assert.ok(/album=Mezzanine/.test(urls[1]) && !/lang=/.test(urls[1]));
      assert.ok(r.value.indexOf(LONG) === 0);
    });
});

t('artist without Last.fm key: Wikipedia, skip disambiguation and unrelated articles', function(){
  var urls = [];
  return it.infoFallback(function(u){
    urls.push(u);
    if (/de\.wikipedia/.test(u)) return res({type: 'disambiguation', extract: 'Air steht für …'});
    return res({type: 'standard', description: 'French music duo', extract: 'Air is a French music duo from Versailles, formed in 1995.'});
  }, '', 'storyArtist', 'Air', undefined, 'de').then(function(r){
    assert.strictEqual(r.src, 'Wikipedia');
    assert.ok(/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Air$/.test(urls[1]));
    return it.infoFallback(function(){ return res({type: 'standard', description: 'Gas', extract: 'Luft ist das Gasgemisch der Erdatmosphäre.'}); }, '', 'storyArtist', 'Luft');
  }).then(function(r){ assert.strictEqual(r, null); });
});

t('language en: only one request per source, without lang and only en.wikipedia', function(){
  var urls = [];
  return it.infoFallback(function(u){ urls.push(u); return res({}); }, 'KEY', 'storyArtist', 'Nobody', undefined, 'en')
    .then(function(r){
      assert.strictEqual(r, null);
      assert.strictEqual(urls.length, 2);
      assert.ok(/audioscrobbler/.test(urls[0]) && !/lang=/.test(urls[0]));
      assert.ok(/^https:\/\/en\.wikipedia\.org\//.test(urls[1]));
      urls = [];
      return it.infoFallback(function(u){ urls.push(u); return res({}); }, 'KEY', 'storyArtist', 'Nobody');   /* without lang = en */
    }).then(function(){ assert.strictEqual(urls.length, 2); });
});

t('language fr: first Last.fm and Wikipedia in French, then both in English', function(){
  var urls = [];
  return it.infoFallback(function(u){
    urls.push(u);
    if (/en\.wikipedia/.test(u)) return res({type: 'standard', description: 'French music duo', extract: 'Air is a French music duo from Versailles, formed in 1995.'});
    return res({});
  }, 'KEY', 'storyArtist', 'Air', undefined, 'fr').then(function(r){
    assert.strictEqual(urls.length, 4);
    assert.ok(/audioscrobbler.*lang=fr/.test(urls[0]) && /^https:\/\/fr\.wikipedia\.org\//.test(urls[1]));
    assert.ok(/audioscrobbler/.test(urls[2]) && !/lang=/.test(urls[2]) && /^https:\/\/en\.wikipedia\.org\//.test(urls[3]));
    assert.strictEqual(r.src, 'Wikipedia');
  });
});

t('album without key and network error: nothing', function(){
  return Promise.all([
    it.infoFallback(function(){ throw new Error('never'); }, '', 'storyAlbum', 'A', 'B'),
    it.infoFallback(function(){ return Promise.reject(new Error('offline')); }, 'KEY', 'storyArtist', 'A')
  ]).then(function(r){ assert.deepStrictEqual(r, [null, null]); });
});

/* ---------- single tracks ---------- */
var SONG = 'Teardrop ist ein Lied der britischen Band Massive Attack aus dem Jahr 1998, gesungen von Elizabeth Fraser.';
function wiki(pages, summaries) {
  return function(u){
    if (/rest\.php\/v1\/search/.test(u)) return res({pages: pages});
    var k = decodeURIComponent(u.split('/summary/')[1] || '');
    return summaries[k] ? res(summaries[k]) : res({}, false);
  };
}

t('track: song name without additions', function(){
  assert.strictEqual(it.infoSongName('Paint It Black (Remastered 2019)'), 'Paint It Black');
  assert.strictEqual(it.infoSongName('Hey Jude - Remastered 2015'), 'Hey Jude');
  assert.strictEqual(it.infoSongName('Live and Let Die'), 'Live and Let Die');
  return Promise.resolve();
});

t('track: Last.fm text for the song', function(){
  var urls = [];
  return it.infoTrack(function(u){ urls.push(u); return res({track: {wiki: {content: SONG}}}); }, 'KEY', 'Massive Attack', 'Teardrop (2019 Remaster)', 'de')
    .then(function(r){
      assert.strictEqual(r.src, 'Last.fm');
      assert.ok(/method=track\.getinfo/.test(urls[0]) && /track=Teardrop&/.test(urls[0]) && /lang=de/.test(urls[0]));
    });
});

t('track: Wikipedia only with a matching article (song, artist named)', function(){
  var fetchFn = wiki([{key: 'Teardrop', title: 'Teardrop'}, {key: 'Teardrop_(Lied)', title: 'Teardrop (Lied)'}], {
    'Teardrop': {type: 'standard', description: 'Begriffsklärung', extract: 'Teardrop steht für mehrere Dinge, die lang genug beschrieben sind.'},
    'Teardrop_(Lied)': {type: 'standard', description: 'Lied von Massive Attack', extract: SONG}
  });
  return it.infoTrack(fetchFn, '', 'Massive Attack', 'Teardrop', 'de').then(function(r){
    assert.strictEqual(r.src, 'Wikipedia');
    assert.ok(r.value.indexOf(SONG) === 0);
    /* different artist: the song of the same name does not belong */
    return it.infoTrack(fetchFn, '', 'Elton John', 'Teardrop', 'de');
  }).then(function(r){ assert.strictEqual(r, null); });
});

t('track: album of the same name (title track) is not used', function(){
  var fetchFn = wiki([{key: 'Mezzanine_(Album)', title: 'Mezzanine (Album)'}], {
    'Mezzanine_(Album)': {type: 'standard', description: 'Album von Massive Attack', extract: 'Mezzanine ist das dritte Album von Massive Attack mit dem Titel Teardrop als Single.'}
  });
  return it.infoTrack(fetchFn, '', 'Massive Attack', 'Mezzanine', 'en').then(function(r){ assert.strictEqual(r, null); });
});

t('track: offline or empty gives null', function(){
  return Promise.all([
    it.infoTrack(function(){ return Promise.reject(new Error('offline')); }, 'KEY', 'A', 'B', 'de'),
    it.infoTrack(function(){ return res({}); }, 'KEY', 'A', '', 'de')
  ]).then(function(r){ assert.deepStrictEqual(r, [null, null]); });
});

Promise.all(pending).then(function(){ console.log(n + ' checks passed'); }, function(e){ console.error(e); process.exit(1); });
