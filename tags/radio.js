/* Web radio: cover for the current track (iTunes, else Deezer) and station logos (URL from Volumio, else radio-browser.info).
   Both are loaded once and stored on the player (artistimg.Store). Node 8, ES5 only. */
var coversearch = require('./coversearch.js');

var ITUNES = process.env.ITUNES_URL       || 'https://itunes.apple.com';
var DEEZER = process.env.DEEZER_URL       || 'https://api.deezer.com';
var RADIOB = process.env.RADIOBROWSER_URL || 'https://all.api.radio-browser.info';

var key = coversearch.key;
function similar(a, b) { a = key(a); b = key(b); return !!a && !!b && (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0); }
/* best match: same artist before similar, same title before similar */
function best(list, artistOf, titleOf, artist, title) {
  var ka = key(artist), kt = key(title);
  return list.filter(function(r){ return similar(artistOf(r), artist) && similar(titleOf(r), title); })
    .map(function(r, i){ return {r: r, s: (key(artistOf(r)) === ka ? 2 : 0) + (key(titleOf(r)) === kt ? 1 : 0), i: i}; })
    .sort(function(a, b){ return b.s - a.s || a.i - b.i; })
    .map(function(x){ return x.r; })[0];
}
function json(u, cb) {
  coversearch.fetchUrl(u, 1024 * 1024, function(e, r){
    if (e) return cb(e);
    try { cb(null, JSON.parse(r.body.toString('utf8'))); } catch (x) { cb(x); }
  });
}

/* detect image format from content; svg and unknown formats are not accepted */
function mime(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  return '';
}
/* URLs come from Volumio or radio-browser.info: public servers only */
function loadImage(u, cb) {
  coversearch.fetchUrl(u, 4 * 1024 * 1024, function(e, r){ cb(e || !mime(r.body) ? null : r.body, !!e); }, {pub: !process.env.RADIO_ALLOW_LOCAL});
}

/* "artist - title" -> {artist, title}; null if no title can be recognized */
function split(name) {
  var p = String(name || '').split('\n');
  return p.length === 2 && p[0].trim() && p[1].trim() ? {artist: p[0].trim(), title: p[1].trim()} : null;
}

/* cover for a track: name = artist + "\n" + title. cb(image or null, temporary?) */
function songLookup(name, cb) {
  var s = split(name);
  if (!s) return cb(null);
  json(ITUNES + '/search?media=music&entity=song&limit=15&term=' + encodeURIComponent(s.artist + ' ' + s.title), function(e, j){
    var hit = !e && j && best((j.results || []).filter(function(r){ return r.artworkUrl100; }),
      function(r){ return r.artistName; }, function(r){ return r.trackName; }, s.artist, s.title);
    if (hit) return loadImage(hit.artworkUrl100.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/, '/600x600bb.jpg'), function(img, tmp){
      if (img) return cb(img);
      deezer(tmp || !!e);
    });
    deezer(!!e);
  });
  function deezer(failed) {
    json(DEEZER + '/search/track?limit=15&q=' + encodeURIComponent('artist:"' + s.artist.replace(/"/g, '') + '" track:"' + s.title.replace(/"/g, '') + '"'), function(e, j){
      var list = !e && j && Array.isArray(j.data) ? j.data : null;
      if (!list) return cb(null, true);
      var hit = best(list.filter(function(t){ return t.artist && t.album && t.album.cover_xl; }),
        function(t){ return t.artist.name; }, function(t){ return t.title; }, s.artist, s.title);
      if (!hit) return cb(null, failed);
      loadImage(hit.album.cover_xl, cb);
    });
  }
}

/* station logo: first the URL from Volumio (extra), else radio-browser.info by station name */
function logoLookup(name, cb, extra) {
  if (extra && /^https?:\/\//.test(extra)) {
    return loadImage(extra, function(img){ if (img) cb(img); else search(); });
  }
  search();
  function search() {
    json(RADIOB + '/json/stations/byname/' + encodeURIComponent(name) + '?limit=20&hidebroken=true&order=votes&reverse=true', function(e, list){
      if (e || !Array.isArray(list)) return cb(null, true);
      var want = key(name);
      var withIcon = list.filter(function(s){ return s && s.favicon && /^https?:\/\//.test(s.favicon); });
      var hit = withIcon.filter(function(s){ return key(s.name) === want; })[0] || withIcon.filter(function(s){ return similar(s.name, name); })[0];
      if (!hit) return cb(null);
      loadImage(hit.favicon, function(img, tmp){ cb(img, tmp); });
    });
  }
}

module.exports = {songLookup: songLookup, logoLookup: logoLookup, mime: mime};
