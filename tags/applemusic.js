/* Hidden test: hand the queue to Apple Music via an iOS shortcut (web/js/amexport.js).
   For each track, the free iTunes search finds the Apple Music entry (artist and title must match); the shortcut then
   searches for Apple's own spelling and gets the right song. Tracks without a match are dropped silently.
   match() is pure and tested by tests/applemusic.test.js. */
var coversearch = require('./coversearch.js');
var BASE = process.env.ITUNES_URL || 'https://itunes.apple.com';
var COUNTRY = process.env.ITUNES_COUNTRY || 'de';
var MAX = 100;

/* leading track number in the title ("01 - Song", "3. Song", "07_Song"); needs a separator, so "99 Luftballons" stays */
function noNum(s) { return String(s || '').replace(/^\s*\d{1,3}\s*[-._)]\s*(?=\S)/, '').replace(/^\s*\d{1,3}\s+[-–]\s+/, ''); }

/* best result for {artist, title, album} among the iTunes songs, or null */
function match(t, results) {
  var title = noNum(t.title), ka = coversearch.key(t.artist), kt = coversearch.key(title), kb = coversearch.key(t.album);
  if (!ka || !kt) return null;
  function low(x) { return String(x || '').toLowerCase().trim(); }
  function same(a, b) { return !!a && !!b && (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0); }
  var hits = (results || []).filter(function(r){
    return r && r.kind === 'song' && r.trackId && same(coversearch.key(r.artistName), ka) && same(coversearch.key(r.trackName), kt);
  });
  if (!hits.length) return null;
  var best = hits.filter(function(r){ return kb && coversearch.key(r.collectionName) === kb; })[0]
    || hits.filter(function(r){ return low(r.trackName) === low(title); })[0] || hits[0];   /* "So What" before "So What (Live)" */
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
  search(String(t.artist || '') + ' ' + bare(noNum(t.title)), 15, function(r1){
    var m = match(t, r1);
    if (m) return cb(m);
    setTimeout(function(){ search(bare(noNum(t.title)), 50, function(r2){ cb(match(t, r2)); }); }, 150);
  });
}

var MISS_RETRY_MS = 30 * 24 * 3600000;                  /* not found: ask Apple again after 30 days (catalog grows) */
function cacheKey(t) { return String(t.artist || '').toLowerCase().trim() + '|' + noNum(t.title).toLowerCase().trim(); }

/* tracks -> cb([{id, artist, title, album}]) in order, one request after another (Apple limits the rate).
   cache (optional): {get(key), set(key, value)} remembers hits and misses, so a track is looked up only once */
function resolve(tracks, cb, cache, now) {
  var list = (tracks || []).slice(0, MAX), out = [], i = 0;
  now = now || Date.now();
  (function next(){
    if (i >= list.length) return cb(out);
    var t = list[i++], k = cacheKey(t), c = cache && cache.get(k);
    if (c && c.id) { out.push({id: c.id, artist: c.artist, title: c.title, album: c.album}); return next(); }
    if (c && c.miss && now - c.at < MISS_RETRY_MS) return next();
    lookup(t, function(m){
      if (cache) cache.set(k, m ? {id: m.id, artist: m.artist, title: m.title, album: m.album} : {miss: true, at: now});
      if (m) out.push(m);
      setTimeout(next, 150);
    });
  })();
}

module.exports = {match: match, resolve: resolve, cacheKey: cacheKey, noNum: noNum};
