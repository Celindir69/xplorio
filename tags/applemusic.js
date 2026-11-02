/* Hidden test: hand the queue to Apple Music via an iOS shortcut (web/js/amexport.js).
   For each track, the free iTunes search finds the Apple Music entry (artist and title must match); the shortcut then
   searches for Apple's own spelling and gets the right song. Tracks without a match are dropped silently.
   match() is pure and tested by tests/applemusic.test.js. */
var coversearch = require('./coversearch.js');
var BASE = process.env.ITUNES_URL || 'https://itunes.apple.com';
var COUNTRY = process.env.ITUNES_COUNTRY || 'de';
var MAX = 100;

/* best result for {artist, title, album} among the iTunes songs, or null */
function match(t, results) {
  var ka = coversearch.key(t.artist), kt = coversearch.key(t.title), kb = coversearch.key(t.album);
  if (!ka || !kt) return null;
  function low(x) { return String(x || '').toLowerCase().trim(); }
  function same(a, b) { return !!a && !!b && (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0); }
  var hits = (results || []).filter(function(r){
    return r && r.kind === 'song' && r.trackId && same(coversearch.key(r.artistName), ka) && same(coversearch.key(r.trackName), kt);
  });
  if (!hits.length) return null;
  var best = hits.filter(function(r){ return kb && coversearch.key(r.collectionName) === kb; })[0]
    || hits.filter(function(r){ return low(r.trackName) === low(t.title); })[0] || hits[0];   /* "So What" before "So What (Live)" */
  return {id: best.trackId, artist: best.artistName, title: best.trackName, album: best.collectionName};
}

function bare(s) { return String(s || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+[-–]\s+.*$/, '').trim(); }
function search(term, limit, cb) {
  coversearch.getJson(BASE + '/search?media=music&entity=song&limit=' + limit + '&country=' + COUNTRY + '&term=' + encodeURIComponent(term), function(e, j){
    cb(e ? [] : (j && j.results) || []);
  });
}
/* first artist + title; if that finds nothing, the title alone with more results (Apple's search often misses
   artist spellings such as "feat." or "&") */
function lookup(t, cb) {
  search(String(t.artist || '') + ' ' + bare(t.title), 15, function(r1){
    var m = match(t, r1);
    if (m) return cb(m);
    setTimeout(function(){ search(bare(t.title), 50, function(r2){ cb(match(t, r2)); }); }, 150);
  });
}

/* tracks -> cb([{id, artist, title, album}]) in order, one request after another (Apple limits the rate) */
function resolve(tracks, cb) {
  var list = (tracks || []).slice(0, MAX), out = [], i = 0;
  (function next(){
    if (i >= list.length) return cb(out);
    lookup(list[i++], function(m){ if (m) out.push(m); setTimeout(next, 150); });
  })();
}

module.exports = {match: match, resolve: resolve};
