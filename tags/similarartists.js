/* Similar artists without Last.fm: Deezer's related artists (no key needed), otherwise ListenBrainz (MusicBrainz ID
   from the MusicBrainz artist search, then the artists of LB Radio). Results are kept in memory for a day.
   Used by the info page, "More" of an artist, the AutoDJ on the Mac and the mixes of the day when there is no
   (working) Last.fm key. Node 8, ES5 only. */
var coversearch = require('./coversearch.js');
var artistimg   = require('./artistimg.js');
var mbgate      = require('./mbgate.js');

var DEEZER = process.env.DEEZER_URL       || 'https://api.deezer.com';
var MB     = process.env.MB_URL           || 'https://musicbrainz.org';
var LB     = process.env.LISTENBRAINZ_URL || 'https://api.listenbrainz.org';
var TTL = 24 * 3600000, NONE_TTL = 3600000, MAX = 500;

function json(u, cb) {
  coversearch.fetchUrl(u, 1024 * 1024, function(e, r){
    if (e) return cb(e);
    var j;
    try { j = JSON.parse(r.body.toString('utf8')); } catch (x) { return cb(new Error('no JSON response')); }
    cb(null, j);
  });
}
function uniqNames(list, self) {
  var seen = {}, out = [];
  seen[artistimg.norm(self)] = 1;
  list.forEach(function(n){ var k = artistimg.norm(n); if (n && k && !seen[k]) { seen[k] = 1; out.push(n); } });
  return out;
}

/* Deezer: the artist of that name with the most fans, then its related artists. cb(err, [names]) */
function deezer(name, limit, cb) {
  json(DEEZER + '/search/artist?limit=10&q=' + encodeURIComponent(name), function(e, j){
    if (e || !j || !Array.isArray(j.data)) return cb(e || new Error('deezer'));
    var want = artistimg.norm(name);
    var hit = j.data.filter(function(a){ return a && artistimg.norm(a.name) === want; })
      .sort(function(a, b){ return (b.nb_fan || 0) - (a.nb_fan || 0); })[0];
    if (!hit || !hit.id) return cb(null, []);
    json(DEEZER + '/artist/' + encodeURIComponent(hit.id) + '/related?limit=' + limit, function(e2, j2){
      if (e2 || !j2 || !Array.isArray(j2.data)) return cb(e2 || new Error('deezer'));
      cb(null, uniqNames(j2.data.map(function(a){ return a && a.name; }), name));
    });
  });
}

/* MusicBrainz: ID of the artist with exactly that name (best score); through the shared queue, before the background lookups */
function mbid(name, cb) {
  mbgate.getJson(MB + '/ws/2/artist?fmt=json&limit=5&query=' + encodeURIComponent('artist:"' + name.replace(/"/g, '') + '"'), function(e, j){
    if (e || !j) return cb(e || new Error('musicbrainz'));
    var want = artistimg.norm(name);
    var hit = (j.artists || []).filter(function(a){
      return a && (artistimg.norm(a.name) === want || (a.aliases || []).some(function(x){ return x && artistimg.norm(x.name) === want; }));
    })[0];
    cb(null, hit ? hit.id : '');
  }, {front: true});
}

/* LB Radio: {artist mbid: [recordings with similar_artist_name]}, or a flat list of recordings */
function lbNames(j) {
  var recs = [];
  if (Array.isArray(j)) recs = j;
  else if (j && typeof j === 'object') Object.keys(j).forEach(function(k){ if (Array.isArray(j[k])) recs = recs.concat(j[k]); else if (j[k] && j[k].similar_artist_name) recs.push(j[k]); });
  var score = {}, names = {};
  recs.forEach(function(r){
    if (!r || !r.similar_artist_name) return;
    var k = r.similar_artist_mbid || r.similar_artist_name;
    names[k] = r.similar_artist_name;
    score[k] = Math.max(score[k] || 0, +r.total_listen_count || 0);
    if (r.score !== undefined) score[k] = Math.max(score[k], +r.score || 0);
  });
  return Object.keys(names).sort(function(a, b){ return (score[b] || 0) - (score[a] || 0); }).map(function(k){ return names[k]; });
}
function listenbrainz(name, limit, cb) {
  mbid(name, function(e, id){
    if (e) return cb(e);
    if (!id) return cb(null, []);
    json(LB + '/1/lb-radio/artist/' + encodeURIComponent(id) + '?mode=easy&max_similar_artists=' + limit +
         '&max_recordings_per_artist=1&pop_begin=0&pop_end=100', function(e2, j){
      if (e2) return cb(e2);
      cb(null, uniqNames(lbNames(j), name));
    });
  });
}

/* cached lookup: Deezer first, ListenBrainz when Deezer knows nothing. cb(err, [names]) */
var cache = {}, order = [];
function find(name, limit, cb) {
  name = String(name || '').trim();
  limit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  if (!name) return cb(null, []);
  var k = artistimg.norm(name) || name.toLowerCase(), hit = cache[k];
  if (hit && Date.now() - hit.at < (hit.list.length ? TTL : NONE_TTL)) return cb(null, hit.list.slice(0, limit));
  function keep(list) {
    if (!cache[k]) { order.push(k); if (order.length > MAX) delete cache[order.shift()]; }
    cache[k] = {at: Date.now(), list: list};
    cb(null, list.slice(0, limit));
  }
  deezer(name, 50, function(e, list){
    if (!e && list.length) return keep(list);
    listenbrainz(name, 30, function(e2, list2){
      if (e2 && e) return cb(e2);                         /* both unreachable: not cached */
      keep(list2 || []);
    });
  });
}

module.exports = {find: find, deezer: deezer, listenbrainz: listenbrainz, lbNames: lbNames};
