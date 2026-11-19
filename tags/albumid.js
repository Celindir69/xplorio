/* Recognise an album from its files (like a CD player looking up its disc): the CD's table of contents is rebuilt from
   track count and lengths (2 s lead-in, 75 sectors per second; FLAC/ALAC rips of a CD give its exact lengths), the
   MusicBrainz disc ID computed from it and looked up there: exact by disc ID, otherwise MusicBrainz's fuzzy search by
   table of contents. Without a match the folder and file names help: "Artist - Album", "Artist/Album", "01 - Title".
   Every suggestion comes with the tags for each file ({uri, tags}), ready for POST /write (Undo as usual).
   Node 8, ES5 only. opts: getJson(url, cb(err, json)), stepMs (MusicBrainz: one request per second), mb (base URL) */
var crypto = require('crypto');
var path = require('path');

var MB = process.env.MB_URL || 'https://musicbrainz.org';
var DISCOGS = process.env.DISCOGS_URL || 'https://api.discogs.com';
var ITUNES = process.env.ITUNES_URL || 'https://itunes.apple.com';
var DEEZER = process.env.DEEZER_URL || 'https://api.deezer.com';
var SOURCES = ['mb', 'discogs', 'itunes', 'deezer'];
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
  /* a compilation without the track's own artist: none (the file keeps its own), never "Various Artists" */
  function trackArtist(t) { return credit(t['artist-credit']) || (va ? '' : albumArtist); }
  var titleScore = 0;
  if (h) tracks.forEach(function(t, i){ titleScore += similar(h.titles[i], t.title) / tracks.length; });
  return {
    release: rel.id, title: rel.title || '', artist: albumArtist, date: date, country: rel.country || '',
    disc: medium.position || 1, discs: discs, format: medium.format || '', match: match,
    avgDiff: n ? Math.round(diff / n * 10) / 10 : null, nameScore: Math.round(nameScore * 100) / 100,
    titleScore: Math.round(titleScore * 100) / 100,
    tracks: tracks.map(function(t){ return {n: t._n || t.position, title: t.title || '', artist: trackArtist(t),
                                            length: Math.round((t.length || (t.recording && t.recording.length) || 0) / 1000)}; }),
    items: files.map(function(f, i){
      var t = tracks[i] || {}, tags = {title: t.title || '', artist: trackArtist(t), album: rel.title || '',
                                       albumartist: va ? 'Various Artists' : albumArtist, date: date, track: String(t._n || t.position || i + 1)};
      if (discs > 1) tags.disc = String(t._disc || medium.position || 1);
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
  this.discogs = opts.discogs || DISCOGS;
  this.itunes = opts.itunes || ITUNES;
  this.deezer = opts.deezer || DEEZER;
  this.lastBy = {};
  this.discogsToken = opts.discogsToken || function(){ return ''; };
  this.last = 0;
  this.lastDiscogs = 0;
  this.cache = {};                                         /* source:id -> normalised release (manual search) */
  this.cacheOrder = [];
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
      cb(null, {discid: id, hints: h, candidates: found.slice(0, MAX_RESULTS),
                fileNames: files.map(function(f){ return {uri: f.uri, name: path.basename(f.rel || f.uri), length: Math.round(f.length || 0)}; })});
    });
  });
};
/* ---------- manual search: artist and album at MusicBrainz or Discogs ---------- */

/* medium kind for the list: CD, Vinyl, File or the name as given */
function kind(f) {
  f = String(f || '');
  if (/digital|file|flac|mp3|wav|aac|alac/i.test(f)) return 'File';
  if (/vinyl|\blp\b|^\d+"|12"|7"|10"/i.test(f)) return 'Vinyl';
  if (/\bcd\b|cd-r|sacd|hdcd|shm|blu-spec|^cd/i.test(f)) return 'CD';
  if (/cassette/i.test(f)) return 'Cassette';
  return f;
}
/* [kinds per medium] -> "2×CD", "CD + DVD" */
function formatText(list) {
  var out = [], n = {};
  list.forEach(function(k){ if (!(k in n)) { n[k] = 0; out.push(k); } n[k]++; });
  return out.map(function(k){ return (n[k] > 1 ? n[k] + '×' : '') + (k || '?'); }).join(' + ');
}
function cleanDiscogsName(s) { return String(s || '').replace(/\s*\(\d+\)$/, '').replace(/\*$/, '').trim(); }
function discogsCredit(list) {
  return (list || []).map(function(a, i, all){
    var j = a.join && a.join !== ',' ? ' ' + a.join + ' ' : (i < all.length - 1 ? ', ' : '');
    return cleanDiscogsName(a.anv || a.name) + j;
  }).join('').replace(/\s+/g, ' ').trim();
}
function seconds(d) {
  var m = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(String(d || '').trim());
  return m ? (parseInt(m[1] || '0', 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
}
/* Discogs release -> the shape of a MusicBrainz one (media with numbered tracks); positions "1-3", "CD2-1", "A1", "3" */
function fromDiscogs(d) {
  var kinds = [];
  (d.formats || []).forEach(function(f){ var q = parseInt(f.qty, 10) || 1; for (var i = 0; i < q && kinds.length < 20; i++) kinds.push(kind(f.name)); });
  var media = {}, list = [];
  function addTrack(t, pos) {
    var m = /^(?:cd|dvd|disc|lp)?\s*(\d+)[-.](\d+)/i.exec(pos), disc = 1;
    if (m) disc = parseInt(m[1], 10);
    else if ((m = /^([A-Za-z])\d*$/.exec(pos))) disc = Math.floor((m[1].toUpperCase().charCodeAt(0) - 65) / 2) + 1;   /* sides A/B: record 1 */
    if (!media[disc]) { media[disc] = {position: disc, format: kinds[disc - 1] || kinds[0] || '', tracks: []}; list.push(media[disc]); }
    var md = media[disc];
    md.tracks.push({position: md.tracks.length + 1, title: t.title || '', length: seconds(t.duration) * 1000,
                    'artist-credit': t.artists && t.artists.length ? [{name: discogsCredit(t.artists)}] : undefined});
  }
  (d.tracklist || []).forEach(function(t){
    if (t.type_ === 'heading') return;
    if (t.type_ === 'index' && (t.sub_tracks || []).length) return t.sub_tracks.forEach(function(s){ addTrack(s, String(s.position || t.position || '')); });
    addTrack(t, String(t.position || ''));
  });
  list.sort(function(a, b){ return a.position - b.position; });
  list.forEach(function(m, i){ m.position = i + 1; });
  var artist = discogsCredit(d.artists), va = /^various$/i.test(artist);
  return {id: 'd' + d.id, title: d.title || '', date: String(d.released || d.year || '').replace(/-00/g, ''), country: d.country || '',
          'artist-credit': [{name: va ? 'Various Artists' : artist, artist: va ? {id: VA} : {}}], media: list};
}
/* Apple Music (iTunes lookup with songs) -> the shape of a MusicBrainz release */
function fromItunes(list) {
  var col = (list || []).filter(function(r){ return r.wrapperType === 'collection'; })[0] || {}, media = {}, out = [];
  (list || []).filter(function(r){ return r.wrapperType === 'track' && r.kind !== 'music-video'; }).forEach(function(t){
    var d = t.discNumber || 1;
    if (!media[d]) { media[d] = {position: d, format: 'Digital Media', tracks: []}; out.push(media[d]); }
    media[d].tracks.push({position: t.trackNumber || media[d].tracks.length + 1, title: t.trackName || '', length: t.trackTimeMillis || 0,
                          'artist-credit': t.artistName && t.artistName !== col.artistName ? [{name: t.artistName}] : undefined});
  });
  out.sort(function(a, b){ return a.position - b.position; });
  var va = /^various artists$/i.test(col.artistName || '');
  return {id: 'i' + col.collectionId, title: col.collectionName || '', date: String(col.releaseDate || '').slice(0, 10), country: col.country || '',
          'artist-credit': [{name: col.artistName || '', artist: va ? {id: VA} : {}}], media: out};
}
/* Deezer album + its tracks (with disk_number) -> the shape of a MusicBrainz release */
function fromDeezer(al, tracks) {
  var media = {}, out = [], aa = (al.artist && al.artist.name) || '';
  (tracks || []).forEach(function(t){
    var d = t.disk_number || 1;
    if (!media[d]) { media[d] = {position: d, format: 'Digital Media', tracks: []}; out.push(media[d]); }
    var a = t.artist && t.artist.name;
    media[d].tracks.push({position: t.track_position || media[d].tracks.length + 1, title: t.title || '', length: (t.duration || 0) * 1000,
                          'artist-credit': a && a !== aa ? [{name: a}] : undefined});
  });
  out.sort(function(a, b){ return a.position - b.position; });
  var va = /^various artists$/i.test(aa);
  return {id: 'z' + al.id, title: al.title || '', date: al.release_date || '', country: '', 'artist-credit': [{name: aa, artist: va ? {id: VA} : {}}], media: out};
}
/* release + files -> the suggestion that fits best: a medium with as many tracks as files, else all media one after the
   other, else the medium closest in track count (then only as many files as it has tracks get tags) */
function fitRelease(rel, files, h) {
  var pm = pickMedium(rel, files, '');
  if (pm) { var c = suggestion(rel, pm.medium, files, 'manual', h); c.fit = 'ok'; return c; }
  var media = rel.media || [], all = [];
  media.forEach(function(m){ (m.tracks || []).forEach(function(t){ var x = {}; for (var k in t) x[k] = t[k]; x._disc = m.position; x._n = t.position; x.position = all.length + 1; all.push(x); }); });
  if (all.length === files.length && media.length > 1) {
    var c2 = suggestion(rel, {position: 1, format: formatText(media.map(function(m){ return kind(m.format); })), tracks: all}, files, 'manual', h);
    c2.tracks.forEach(function(t, i){ t.disc = all[i]._disc; });
    c2.fit = 'ok'; c2.disc = 0;
    return c2;
  }
  var near = null;
  media.forEach(function(m){ if (!near || Math.abs((m.tracks || []).length - files.length) < Math.abs(near.tracks.length - files.length)) near = m; });
  if (!near || !(near.tracks || []).length) return null;
  var c3 = suggestion(rel, near, files.slice(0, near.tracks.length), 'manual', h);
  c3.fit = 'count'; c3.files = files.length;
  return c3;
}

/* {artist, album, source: 'mb'|'discogs'}, files -> cb(err, {results: [{source, id, title, artist, date, country, format,
   tracks (null: not known yet), fits}]}) */
Recognizer.prototype.search = function(q, files, cb) {
  var self = this, artist = String(q.artist || '').trim().slice(0, 200), album = String(q.album || '').trim().slice(0, 200);
  if (!artist && !album) return cb(new Error('artist or album missing'));
  var n = files.length;
  if (q.source === 'discogs') {
    var token = this.discogsToken();
    if (!token) return cb(new Error('discogs token missing'));
    var u = this.discogs + '/database/search?type=release&per_page=25' + (artist ? '&artist=' + encodeURIComponent(artist) : '') +
            (album ? '&release_title=' + encodeURIComponent(album) : '');
    return this.getDiscogs(u, function(e, j){
      if (e) return cb(e);
      cb(null, {results: ((j && j.results) || []).slice(0, 25).map(function(r){
        var parts = String(r.title || '').split(' - '), a = parts.length > 1 ? parts.shift() : '';
        var kinds = [];
        (r.formats || []).forEach(function(f){ var k = parseInt(f.qty, 10) || 1; for (var i = 0; i < k && kinds.length < 20; i++) kinds.push(kind(f.name)); });
        if (!kinds.length && r.format) kinds = [kind(r.format[0])];
        var desc = [];
        (r.formats || []).forEach(function(f){ (f.descriptions || []).forEach(function(x){ if (!/^(album|lp|cd|stereo)$/i.test(x)) desc.push(x); }); if (f.text) desc.push(f.text); });
        return {source: 'discogs', id: String(r.id), title: parts.join(' - '), artist: cleanDiscogsName(a), date: String(r.year || ''),
                country: r.country || '', format: formatText(kinds), tracks: null, fits: null,
                label: ((r.label || [])[0] || ''), note: desc.slice(0, 3).join(', ')};
      })});
    });
  }
  function fits(c) { return c === n; }
  if (q.source === 'itunes') {
    return this.getFrom('itunes', this.itunes + '/search?media=music&entity=album&limit=25&term=' + encodeURIComponent((artist + ' ' + album).trim()), function(e, j){
      if (e) return cb(e);
      cb(null, {results: ((j && j.results) || []).filter(function(r){ return r.collectionId; }).map(function(r){
        return {source: 'itunes', id: String(r.collectionId), title: r.collectionName || '', artist: r.artistName || '', date: String(r.releaseDate || '').slice(0, 10),
                country: r.country || '', format: 'File', tracks: r.trackCount || null, fits: r.trackCount ? fits(r.trackCount) : null, label: '',
                note: r.collectionExplicitness === 'explicit' ? 'Explicit' : ''};
      })});
    });
  }
  if (q.source === 'deezer') {
    var dq = (artist ? 'artist:"' + artist.replace(/"/g, '') + '" ' : '') + (album ? 'album:"' + album.replace(/"/g, '') + '"' : '');
    return this.getFrom('deezer', this.deezer + '/search/album?limit=25&q=' + encodeURIComponent(dq.trim()), function(e, j){
      if (e) return cb(e);
      cb(null, {results: ((j && j.data) || []).filter(function(r){ return r.id; }).map(function(r){
        return {source: 'deezer', id: String(r.id), title: r.title || '', artist: (r.artist && r.artist.name) || '', date: '', country: '',
                format: 'File', tracks: r.nb_tracks || null, fits: r.nb_tracks ? fits(r.nb_tracks) : null, label: '',
                note: r.record_type && r.record_type !== 'album' ? r.record_type : (r.explicit_lyrics ? 'Explicit' : '')};
      })});
    });
  }
  var lq = [];
  if (album) lq.push('release:"' + album.replace(/["\\]/g, '') + '"');
  if (artist) lq.push('artist:"' + artist.replace(/["\\]/g, '') + '"');
  this.get(this.mb + '/ws/2/release/?query=' + encodeURIComponent(lq.join(' AND ')) + '&limit=25&fmt=json', function(e, j){
    if (e) return cb(e);
    var list = ((j && j.releases) || []).map(function(r){
      var media = r.media || [], counts = media.map(function(m){ return m['track-count'] || 0; });
      var total = r['track-count'] || counts.reduce(function(a, b){ return a + b; }, 0);
      return {source: 'mb', id: r.id, title: r.title || '', artist: credit(r['artist-credit']), date: r.date || '', country: r.country || '',
              format: formatText(media.map(function(m){ return kind(m.format); })), tracks: total, media: counts,
              fits: counts.indexOf(n) >= 0 || total === n, label: (((r['label-info'] || [])[0] || {}).label || {}).name || '',
              note: [r.disambiguation, r.status && r.status !== 'Official' ? r.status : ''].filter(Boolean).join(', ')};
    });
    var fit = list.filter(function(r){ return r.fits; }), rest = list.filter(function(r){ return !r.fits; });
    cb(null, {results: fit.concat(rest)});
  });
};
/* {source, id}, files -> cb(err, suggestion with fit 'ok'|'count', or null when the release has no tracks) */
Recognizer.prototype.release = function(q, files, cb) {
  var self = this, source = SOURCES.indexOf(q.source) >= 0 ? q.source : 'mb', id = String(q.id || '');
  if (source === 'mb' ? !/^[0-9a-f-]{36}$/.test(id) : !/^\d{1,15}$/.test(id)) return cb(new Error('invalid id'));
  files = order(files);
  var h = hints(files.map(function(f){ return f.rel || f.uri; })), key = source + ':' + id;
  function done(rel) {
    if (!self.cache[key]) { self.cacheOrder.push(key); if (self.cacheOrder.length > 50) delete self.cache[self.cacheOrder.shift()]; }
    self.cache[key] = rel;
    var c = fitRelease(rel, files, h);
    if (c) { c.source = source; c.id = id; c.tracksTotal = (rel.media || []).reduce(function(a, m){ return a + (m.tracks || []).length; }, 0);
             c.files = files.length; c.fileNames = files.map(function(f){ return {uri: f.uri, name: path.basename(f.rel || f.uri), length: Math.round(f.length || 0)}; }); }
    cb(null, c);
  }
  if (this.cache[key]) return done(this.cache[key]);
  if (source === 'mb') return this.get(this.mb + '/ws/2/release/' + id + '?inc=' + INC + '&fmt=json', function(e, rel){ if (e) return cb(e); done(rel); });
  if (source === 'discogs') return this.getDiscogs(this.discogs + '/releases/' + id, function(e, d){ if (e) return cb(e); done(fromDiscogs(d || {})); });
  if (source === 'itunes') return this.getFrom('itunes', this.itunes + '/lookup?entity=song&limit=200&id=' + id, function(e, j){
    if (e) return cb(e); done(fromItunes((j && j.results) || []));
  });
  this.getFrom('deezer', this.deezer + '/album/' + id, function(e, al){
    if (e || !al || al.error) return cb(e || new Error('not found'));
    self.getFrom('deezer', self.deezer + '/album/' + id + '/tracks?limit=300', function(e2, tr){
      if (e2) return cb(e2); done(fromDeezer(al, (tr && tr.data) || []));
    });
  });
};
/* the other services: one request at a time per service, at most one per stepMs (Discogs: 60 a minute with a token) */
Recognizer.prototype.getFrom = function(src, u, cb, headers) {
  var self = this, wait = Math.max(0, (this.lastBy[src] || 0) + this.stepMs - Date.now());
  this.lastBy[src] = Date.now() + wait;
  setTimeout(function(){
    self.getJson(u, function(e, j){ self.lastBy[src] = Date.now(); cb(e, j); }, headers || {});
  }, wait);
};
Recognizer.prototype.getDiscogs = function(u, cb) {
  var token = this.discogsToken();
  this.getFrom('discogs', u, cb, token ? {Authorization: 'Discogs token=' + token} : {});
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

module.exports = {Recognizer: Recognizer, fromDiscogs: fromDiscogs, fromItunes: fromItunes, fromDeezer: fromDeezer, kind: kind, toc: toc, discId: discId, tocParam: tocParam, hints: hints, similar: similar, order: order};
