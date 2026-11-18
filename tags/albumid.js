/* Recognise an album from its files (like a CD player looking up its disc): the CD's table of contents is rebuilt from
   track count and lengths (2 s lead-in, 75 sectors per second; FLAC/ALAC rips of a CD give its exact lengths), the
   MusicBrainz disc ID computed from it and looked up there: exact by disc ID, otherwise MusicBrainz's fuzzy search by
   table of contents. Without a match the folder and file names help: "Artist - Album", "Artist/Album", "01 - Title".
   Every suggestion comes with the tags for each file ({uri, tags}), ready for POST /write (Undo as usual).
   Node 8, ES5 only. opts: getJson(url, cb(err, json)), stepMs (MusicBrainz: one request per second), mb (base URL) */
var crypto = require('crypto');
var path = require('path');

var MB = process.env.MB_URL || 'https://musicbrainz.org';
var STEP_MS = 1100, LEAD_IN = 150, MAX_TRACKS = 99, MAX_DETAILS = 5, MAX_RESULTS = 5;
var VA = '89ad4ac3-39f7-470e-963a-56509c546377';                /* MusicBrainz "Various Artists" */
var INC = 'recordings+artist-credits+release-groups';
var GENERIC = /^(import|music|musik|usb|internal|nas|flac|mp3|aac|alac|wav|dsd|hi-?res|downloads?|neu|new|incoming|cds?|alben|albums?)$/i;
var DISC_DIR = /^(cd|disc|disk|dis[ck]o|seite|side)\s*[-_ ]?\s*(\d{1,2})$/i;

/* ---------- table of contents and disc ID ---------- */

/* lengths in seconds -> {first, last, offsets: [leadout, o1 … oN], frames} or null */
function toc(lengths) {
  if (!lengths.length || lengths.length > MAX_TRACKS || lengths.some(function(l){ return !(l > 0); })) return null;
  var offsets = [], at = LEAD_IN;
  lengths.forEach(function(l){ offsets.push(at); at += Math.round(l * 75); });
  return {first: 1, last: lengths.length, offsets: [at].concat(offsets)};
}
function hex(n, w) { var s = n.toString(16).toUpperCase(); while (s.length < w) s = '0' + s; return s; }
/* MusicBrainz disc ID: SHA-1 over first, last and 100 offsets in hex, Base64 with . _ - */
function discId(t) {
  var s = hex(t.first, 2) + hex(t.last, 2);
  for (var i = 0; i < 100; i++) s += hex(t.offsets[i] || 0, 8);
  return crypto.createHash('sha1').update(s, 'ascii').digest('base64').replace(/\+/g, '.').replace(/\//g, '_').replace(/=/g, '-');
}
function tocParam(t) { return [t.first, t.last].concat(t.offsets).join('+'); }

/* ---------- hints from folder and file names ---------- */

function clean(s) {
  return String(s || '').replace(/[_]+/g, ' ')
    .replace(/\s*[\[(](?:\d{4}|flac|mp3|aac|alac|wav|dsd\d*|24[- ]?bit|16[- ]?bit|[0-9.]+\s*khz|hi-?res|remaster(?:ed)?|deluxe(?: edition)?|web|cd|vinyl)[^\])]*[\])]\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
/* rel paths of one album's files -> {artist, album, titles: [per file]} */
function hints(rels) {
  var dir = path.dirname(rels[0] || ''), folder = path.basename(dir), up = path.dirname(dir), parent = path.basename(up);
  var disc = DISC_DIR.exec(folder);
  if (disc) { folder = parent; parent = path.basename(path.dirname(up)); }
  var f = clean(folder), artist = '', album = f, m = /^(.+?)\s+-\s+(?:(?:19|20)\d\d\s+-\s+)?(.+)$/.exec(f);
  if (m) { artist = m[1]; album = m[2]; }
  else if (parent && !GENERIC.test(parent) && parent !== '.') artist = clean(parent);
  album = album.replace(/^(?:19|20)\d\d\s+-\s+/, '');
  var titles = rels.map(function(r){
    return clean(path.basename(r).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\s*(?:\d{1,2}[-.]?)?\d{1,3}\s*[-._)]?\s*/, ''));
  });
  if (artist) titles = titles.map(function(t){                  /* "Artist - Title" */
    var a = artist.toLowerCase() + ' - ';
    return t.toLowerCase().indexOf(a) === 0 ? t.slice(a.length) : t;
  });
  return {artist: artist, album: GENERIC.test(album) ? '' : album, titles: titles};
}

/* similarity 0…1 of two names (shared letter pairs, Dice) */
function norm(s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^0-9a-z\u00c0-\u024f]+/g, ''); }
function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  function pairs(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var p = s.substr(i, 2); o[p] = (o[p] || 0) + 1; } return o; }
  var pa = pairs(a), pb = pairs(b), both = 0, na = 0, nb = 0, k;
  for (k in pa) { na += pa[k]; if (pb[k]) both += Math.min(pa[k], pb[k]); }
  for (k in pb) nb += pb[k];
  return na + nb ? 2 * both / (na + nb) : 0;
}

/* ---------- MusicBrainz answers -> suggestions ---------- */

function credit(ac) {
  return (ac || []).map(function(c){ return (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || ''); }).join('').trim();
}
function isVa(ac) { return (ac || []).some(function(c){ return c.artist && c.artist.id === VA; }); }
/* release + medium -> suggestion; files in album order */
function suggestion(rel, medium, files, match, h) {
  var tracks = (medium.tracks || []).slice().sort(function(a, b){ return (a.position || 0) - (b.position || 0); });
  var va = isVa(rel['artist-credit']), albumArtist = credit(rel['artist-credit']);
  var rg = rel['release-group'] || {}, date = rg['first-release-date'] || rel.date || '';
  var discs = (rel.media || []).length, diff = 0, n = 0;
  tracks.forEach(function(t, i){
    var l = (t.length || (t.recording && t.recording.length) || 0) / 1000;
    if (l && files[i] && files[i].length) { diff += Math.abs(l - files[i].length); n++; }
  });
  var nameScore = h ? (h.album ? similar(h.album, rel.title) : 0.5) * 0.6 + (h.artist ? similar(h.artist, albumArtist) : 0.5) * 0.4 : 0;
  var titleScore = 0;
  if (h) tracks.forEach(function(t, i){ titleScore += similar(h.titles[i], t.title) / tracks.length; });
  return {
    release: rel.id, title: rel.title || '', artist: albumArtist, date: date, country: rel.country || '',
    disc: medium.position || 1, discs: discs, format: medium.format || '', match: match,
    avgDiff: n ? Math.round(diff / n * 10) / 10 : null, nameScore: Math.round(nameScore * 100) / 100,
    titleScore: Math.round(titleScore * 100) / 100,
    tracks: tracks.map(function(t){ return {n: t.position, title: t.title || '', artist: credit(t['artist-credit']) || albumArtist,
                                            length: Math.round((t.length || (t.recording && t.recording.length) || 0) / 1000)}; }),
    items: files.map(function(f, i){
      var t = tracks[i] || {}, tags = {title: t.title || '', artist: credit(t['artist-credit']) || albumArtist, album: rel.title || '',
                                       albumartist: va ? 'Various Artists' : albumArtist, date: date, track: String(t.position || i + 1)};
      if (discs > 1) tags.disc = String(medium.position || 1);
      if (va) tags.compilation = '1';
      return {uri: f.uri, tags: tags};
    })
  };
}
/* the medium of a release that fits: the one with the disc ID, else same track count and closest lengths */
function pickMedium(rel, files, id) {
  var media = (rel.media || []).filter(function(m){ return (m.tracks || []).length === files.length; });
  var exact = id && media.filter(function(m){ return (m.discs || []).some(function(d){ return d.id === id; }); })[0];
  if (exact) return {medium: exact, exact: true};
  var best = null, bestDiff = Infinity;
  media.forEach(function(m){
    var d = 0;
    m.tracks.forEach(function(t, i){ d += Math.abs(((t.length || (t.recording && t.recording.length) || 0) / 1000) - (files[i].length || 0)); });
    if (d < bestDiff) { bestDiff = d; best = m; }
  });
  return best ? {medium: best, exact: false} : null;
}

function Recognizer(opts) {
  opts = opts || {};
  this.getJson = opts.getJson;
  this.stepMs = opts.stepMs !== undefined ? opts.stepMs : STEP_MS;
  this.mb = opts.mb || MB;
  this.last = 0;
}
/* one request at a time, at most one per stepMs (MusicBrainz' rule) */
Recognizer.prototype.get = function(u, cb) {
  var self = this, wait = Math.max(0, this.last + this.stepMs - Date.now());
  setTimeout(function(){
    self.last = Date.now();
    self.getJson(u, function(e, j){ self.last = Date.now(); cb(e, j); });
  }, wait);
};
/* files [{uri, rel, length, tags}] (one folder) -> cb(err, {discid, hints, candidates}) */
Recognizer.prototype.lookup = function(files, cb) {
  var self = this;
  files = order(files);
  var h = hints(files.map(function(f){ return f.rel || f.uri; }));
  var t = toc(files.map(function(f){ return f.length; })), id = t ? discId(t) : '';
  var found = [], seen = {};
  function add(rel, how) {
    if (!rel || !rel.id || seen[rel.id]) return;
    var pm = pickMedium(rel, files, id);
    if (!pm) return;
    seen[rel.id] = true;
    found.push(suggestion(rel, pm.medium, files, pm.exact ? 'exact' : how, h));
  }
  function details(ids, how, done) {                         /* releases with their tracks */
    var list = ids.filter(function(x){ return !seen[x]; }).slice(0, MAX_DETAILS);
    (function next(i){
      if (i >= list.length) return done();
      self.get(self.mb + '/ws/2/release/' + list[i] + '?inc=' + INC + '&fmt=json', function(e, rel){
        if (!e) add(rel, how);
        next(i + 1);
      });
    })(0);
  }
  function byToc(done) {
    if (!t) return done();
    self.get(self.mb + '/ws/2/discid/' + encodeURIComponent(id) + '?toc=' + tocParam(t) + '&cdstubs=no&inc=' + INC + '&fmt=json', function(e, j){
      if (e || !j) return done();
      var rels = j.releases || [], full = rels.filter(function(r){ return (r.media || []).some(function(m){ return m.tracks; }); });
      full.forEach(function(r){ add(r, j.id === id ? 'exact' : 'toc'); });
      details(rels.filter(function(r){ return full.indexOf(r) < 0; }).map(function(r){ return r.id; }), 'toc', done);
    });
  }
  function byName(done) {
    if (found.some(function(c){ return c.match === 'exact'; }) || !h.album) return done();
    var q = 'release:"' + h.album.replace(/["\\]/g, '') + '"' + (h.artist ? ' AND artist:"' + h.artist.replace(/["\\]/g, '') + '"' : '') +
            ' AND tracks:' + files.length;
    self.get(self.mb + '/ws/2/release/?query=' + encodeURIComponent(q) + '&limit=8&fmt=json', function(e, j){
      if (e || !j) return done();
      details((j.releases || []).map(function(r){ return r.id; }), 'name', done);
    });
  }
  byToc(function(){
    byName(function(){
      var rank = {exact: 0, toc: 1, name: 2};
      found.sort(function(a, b){
        return rank[a.match] - rank[b.match] || score(b) - score(a);
      });
      found.forEach(function(c){ c.chance = c.match === 'exact' ? Math.max(95, Math.round(score(c) * 100)) : Math.min(90, Math.round(score(c) * 100)); });
      cb(null, {discid: id, hints: h, candidates: found.slice(0, MAX_RESULTS)});
    });
  });
};
/* names and lengths together: 1 is a perfect fit */
function score(c) {
  var len = c.avgDiff === null ? 0.3 : Math.max(0, 1 - c.avgDiff / 10);
  return len * 0.5 + c.nameScore * 0.3 + c.titleScore * 0.2;
}
/* album order: track numbers when every file has a different one, else file names (natural order) */
function order(files) {
  var nums = files.map(function(f){ return parseInt(String((f.tags && f.tags.track) || '').split('/')[0], 10) || 0; });
  var distinct = nums.every(function(x){ return x > 0; }) && nums.filter(function(x, i){ return nums.indexOf(x) === i; }).length === nums.length;
  var withNum = files.map(function(f, i){ return {f: f, n: nums[i]}; });
  withNum.sort(distinct ? function(a, b){ return a.n - b.n; } : function(a, b){
    return String(a.f.rel || a.f.uri).localeCompare(String(b.f.rel || b.f.uri), undefined, {numeric: true, sensitivity: 'base'});
  });
  return withNum.map(function(x){ return x.f; });
}

module.exports = {Recognizer: Recognizer, toc: toc, discId: discId, tocParam: tocParam, hints: hints, similar: similar, order: order};
