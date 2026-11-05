/* Duplicate albums for the library check: folders with the same album artist and album name, each with its quality.
   Names are compared like the artist spellings (libcheck.artistKey); additions such as "(Remastered)" or
   "[Deluxe Edition]" do not count, compilations are compared by album name only. Folders of one album split by
   disc (CD1, CD2 or different disc numbers next to each other) are one version. Node 8, ES5 only. */
var path = require('path');

var LOSSLESS = ['flac', 'wav', 'aiff', 'aif', 'alac', 'ape', 'wv', 'tta', 'tak'];
var DSD      = ['dsf', 'dff', 'dsd'];
var LOSSY    = ['mp3', 'mp2', 'aac', 'ogg', 'oga', 'opus', 'wma'];
var TRASH    = 'Xplorio Trash';               /* folder per drive, visible over SMB; .mpdignore keeps it out of MPD (ignoreLine) */
var OLD_TRASHES = ['Xplorio Duplicates', '.duplicates'];   /* names in earlier versions: renamed at the start (tag service) */

var EXTRA_RE = /\s*[(\[][^)\]]*(remaster|deluxe|edition|expanded|anniversary|bonus|reissue|re-issue|version|mono|stereo|hi-?res|\d+\s*-?\s*bit|khz|special|collector|legacy|definitive|audiophile|\b(hd|hdcd|hdtracks|sacd|shm(-?cd)?|xrcd|uhqcd|blu-?spec|mfsl|mofi|dsd\d*|mqa|flac|vinyl|japan(ese)?)\b|\b(16|24|32)\s*[-\/]\s*(44|48|88|96|176|192|352|384)(\.\d+)?\b)[^)\]]*[)\]]/gi;
/* additions that do not make another album: remaster, edition, … and medium or quality markers such as [HD], (SACD),
   [24-96], [MFSL] */
var DASH_RE  = /\s+[-–]\s+[^-–]*(remaster|deluxe|edition|anniversary|version)[^-–]*$/i;
var VA_RE    = /^(various|various artists|va|v\.a\.|verschiedene|verschiedene interpreten|sampler)$/i;
var DISC_RE  = /^(cd|disc|disk|disco|disque|side)\s*[-_.]?\s*\d+\b/i;

function albumKey(name, artistKey) { return artistKey(String(name || '').replace(EXTRA_RE, '').replace(DASH_RE, '')); }

/* "INTERNAL/x/y" -> "INTERNAL", "USB/Stick/x" -> "USB/Stick": the drive a folder is on */
function driveOf(dir) {
  var p = String(dir).split('/');
  return p[0] === 'INTERNAL' ? 'INTERNAL' : p.slice(0, 2).join('/');
}
/* where a folder goes when it is moved aside: <drive>/Xplorio Trash/<rest of the path> */
function trashPath(dir) {
  var drive = driveOf(dir);
  return drive + '/' + TRASH + '/' + String(dir).slice(drive.length + 1);
}

/* .mpdignore in the drive folder: MPD then leaves the folder out of the library. Returns the new content, or null if
   the line is already there */
function ignoreLine(text) {
  text = String(text || '');
  if (text.split(/\r?\n/).some(function(l){ return l.trim() === TRASH; })) return null;
  return text + (text && !/\n$/.test(text) ? '\n' : '') + TRASH + '\n';
}

/* "USB/S/Xplorio Trash/x/1.flac" (or an old name, see OLD_TRASHES) -> true */
function isTrash(file) {
  return String(file).split('/').some(function(p){ return p === TRASH || OLD_TRASHES.indexOf(p) >= 0; });
}

function most(list) {
  var c = {}, best = '', n = 0;
  list.forEach(function(x){ if (x === '' || x == null) return; c[x] = (c[x] || 0) + 1; if (c[x] > n) { n = c[x]; best = x; } });
  return best;
}
function kHz(rate) { var k = rate / 1000; return String(Math.round(k * 10) / 10); }

/* songs of one version -> {format: 'FLAC 24/96', rank, bits, rate, ext, codec}; codec only for m4a: 'aac' (MPD reports
   float samples, "44100:f:2") or 'alac' */
function quality(songs) {
  var ext = most(songs.map(function(s){ var m = /\.([a-z0-9]+)$/i.exec(s.file); return m ? m[1].toLowerCase() : ''; }));
  var fmt = most(songs.map(function(s){ return s.format || ''; })).split(':');
  var dsd = /^dsd(\d+)/i.exec(fmt[0] || '');
  var rate = parseInt(fmt[0], 10) || 0, bits = parseInt(fmt[1], 10) || 0;
  if (DSD.indexOf(ext) >= 0 || dsd) return {format: 'DSD' + (dsd ? dsd[1] : ''), rank: 3, bits: 1, rate: dsd ? dsd[1] * 44100 : 0, ext: ext};
  if (LOSSLESS.indexOf(ext) >= 0) {
    return {format: ext.toUpperCase() + (bits && rate ? ' ' + bits + '/' + kHz(rate) : ''), rank: 2, bits: bits, rate: rate, ext: ext};
  }
  if (ext === 'm4a' || ext === 'mp4') {                                     /* ALAC or AAC */
    var codec = fmt[1] === 'f' ? 'aac' : bits ? 'alac' : '';
    var shown = codec === 'alac' ? 'ALAC' + (rate ? ' ' + bits + '/' + kHz(rate) : '') : codec === 'aac' ? 'AAC' : ext.toUpperCase();
    return {format: shown, rank: codec === 'alac' ? 2 : codec === 'aac' ? 1 : 1.5, bits: codec === 'alac' ? bits : 0, rate: rate, ext: ext, codec: codec};
  }
  return {format: (ext || '?').toUpperCase(), rank: LOSSY.indexOf(ext) >= 0 ? 1 : 0, bits: 0, rate: rate, ext: ext};
}

/* better first: lossless before lossy, then bit depth, sample rate, more tracks, longer */
function better(a, b) {
  return b.rank - a.rank || b.bits - a.bits || b.rate - a.rate || b.tracks - a.tracks || b.seconds - a.seconds || a.dirs[0].localeCompare(b.dirs[0]);
}

/* songs: [{file, artist, albumartist, album, disc, format, time}] as from libcheck.mpdWalk; artistKey from libcheck.
   -> [{name, artist, versions: [{dirs, format, tracks, seconds, keep, drive, name, ext, bits, rate, codec}]}], sorted by artist and
   album; name of a version: its own album tag (e.g. with "(Deluxe Edition)") */
function find(songs, artistKey) {
  var dirs = {}, order = [];
  songs.forEach(function(s){
    if (/(^|\/)\./.test(s.file) || isTrash(s.file)) return;                 /* already moved aside */
    var d = path.dirname(s.file);
    if (!dirs[d]) { dirs[d] = []; order.push(d); }
    dirs[d].push(s);
  });

  /* one entry per folder: album key and the parent it may be merged into (disc folders) */
  var groups = {};
  order.forEach(function(d){
    var list = dirs[d];
    var name = most(list.map(function(s){ return s.album; }));
    if (!name) return;                                                      /* without album tag: not comparable */
    var aa = most(list.map(function(s){ return s.albumartist; }));
    var artists = {};
    list.forEach(function(s){ if (s.artist) artists[s.artist] = 1; });
    var names = Object.keys(artists);
    var who = aa || (names.length === 1 ? names[0] : '');
    var va = !who || VA_RE.test(who);
    var key = (va ? '*' : artistKey(who)) + '|' + albumKey(name, artistKey);
    if (/\|$/.test(key)) return;
    var discs = {};
    list.forEach(function(s){ var m = /\d+/.exec(s.disc || ''); if (m) discs[+m[0]] = 1; });
    (groups[key] = groups[key] || []).push({dir: d, name: name, artist: va ? '' : who, songs: list, discs: Object.keys(discs)});
  });

  var out = [];
  Object.keys(groups).forEach(function(key){
    var folders = groups[key];
    if (folders.length < 2) return;
    /* disc folders of one album: same parent and the folder name says CD1/Disc 2, or no disc number in common */
    var versions = [];
    folders.forEach(function(f){
      var parent = path.dirname(f.dir);
      var v = versions.filter(function(x){
        if (x.parent !== parent) return false;
        if (DISC_RE.test(path.basename(f.dir)) && x.discFolder) return true;
        if (!f.discs.length || !x.discs.length) return false;
        return !f.discs.some(function(n){ return x.discs.indexOf(n) >= 0; });
      })[0];
      if (v) { v.dirs.push(f.dir); v.songs = v.songs.concat(f.songs); v.discs = v.discs.concat(f.discs); return; }
      versions.push({parent: parent, dirs: [f.dir], songs: f.songs, discs: f.discs.slice(), discFolder: DISC_RE.test(path.basename(f.dir)),
                     name: f.name, artist: f.artist});
    });
    if (versions.length < 2) return;
    versions = versions.map(function(v){
      var q = quality(v.songs);
      return {dirs: v.dirs.sort(), format: q.format, rank: q.rank, bits: q.bits, rate: q.rate, ext: q.ext, codec: q.codec || '', tracks: v.songs.length,
              seconds: v.songs.reduce(function(n, s){ return n + (parseFloat(s.time) || 0); }, 0), drive: driveOf(v.dirs[0]),
              name: v.name, artist: v.artist};
    }).sort(better);
    out.push({name: versions[0].name, artist: versions[0].artist, versions: versions.map(function(v, i){
      return {dirs: v.dirs, format: v.format, tracks: v.tracks, seconds: Math.round(v.seconds), keep: i === 0, drive: v.drive,
              name: v.name, ext: v.ext, bits: v.bits, rate: v.rate, codec: v.codec};
    })});
  });
  return out.sort(function(a, b){
    return (a.artist ? 0 : 1) - (b.artist ? 0 : 1) || a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
  });
}

/* album name without additions, as shown for an album with several versions: "Abbey Road [HD]" -> "Abbey Road" */
function bareName(name) {
  var b = String(name || '').replace(EXTRA_RE, '').replace(DASH_RE, '').trim();
  return b || String(name || '');
}
function isVA(name) { return !name || VA_RE.test(String(name).trim()); }

module.exports = {find: find, albumKey: albumKey, bareName: bareName, isVA: isVA, quality: quality, driveOf: driveOf, trashPath: trashPath, ignoreLine: ignoreLine, isTrash: isTrash, TRASH: TRASH, OLD_TRASHES: OLD_TRASHES};
