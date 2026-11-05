/* Library check: find problem cases in the collection (read only, writes nothing to the music files).
   The source is the MPD database (folder by folder via "lsinfo", so no response gets too large),
   plus a look into the folders for cover images. Node 8, ES5 only. */
var net  = require('net');
var fs   = require('fs');
var path = require('path');
var genres = require('./genres.js');
var duplicates = require('./duplicates.js');

var IMG_RE = /\.(jpe?g|png)$/i;
var DISC_DIR_RE = /^(cd|dis[ck]|disco|seite|side|vol(ume)?)[\s._-]*(\d+)\b/i;     /* subfolder of a multi-disc set, as albums.js */

/* ---------- read MPD ---------- */

function mpdQuote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

/* all tracks below roots: cb(err, songs, dirCount); songs: [{file, artist, albumartist, album, title, track, date, genre, time, disc, format}].
   onProgress(folders done, folders known) */
function mpdWalk(opts, cb, onProgress) {
  var sock = net.createConnection({host: opts.host || 'localhost', port: opts.port || 6600});
  var buf = '', greeted = false, cur = null, queue = (opts.roots || ['']).slice(), done = 0, songs = [], finished = false;
  var song = null, pending = null;
  function finish(err) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { sock.end('close\n'); } catch (e) { /* already closed */ }
    cb(err, songs, done);
  }
  var timer = setTimeout(function(){ finish(new Error('MPD not responding')); sock.destroy(); }, opts.timeout || 600000);
  function next() {
    if (!queue.length) return finish(null);
    cur = queue.shift();
    song = null;
    sock.write('lsinfo ' + mpdQuote(cur) + '\n');
  }
  function line(l) {
    if (!greeted) {
      if (l.indexOf('OK MPD') !== 0) return finish(new Error('not MPD: ' + l));
      greeted = true;
      return next();
    }
    if (l === 'OK') {
      done++;
      if (onProgress) onProgress(done, done + queue.length);
      return next();
    }
    if (l.indexOf('ACK') === 0) {                        /* folder not readable: skip */
      done++;
      return next();
    }
    var i = l.indexOf(': ');
    if (i < 0) return;
    var k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
    if (k === 'directory') {                             /* moved-aside duplicates are not part of the library */
      if (!duplicates.isTrash(path.basename(v))) queue.push(v);
      song = null; return;
    }
    if (k === 'file') { song = {file: v, artist: '', albumartist: '', album: '', title: '', track: '', date: '', genre: '', time: '', 'last-modified': '', disc: '', format: ''}; songs.push(song); return; }
    if (k === 'playlist') { song = null; return; }
    if (song && song.hasOwnProperty(k) && !song[k]) song[k] = v;          /* with multiple values the first counts */
  }
  sock.setEncoding('utf8');
  sock.on('data', function(d){
    buf += d;
    var n;
    while ((n = buf.indexOf('\n')) >= 0) { var l = buf.slice(0, n); buf = buf.slice(n + 1); if (!finished) line(l); }
  });
  sock.on('error', function(e){ finish(e); });
  sock.on('close', function(){ if (!finished) finish(queue.length || !greeted ? new Error('MPD connection closed') : null); });
}

/* a single MPD command (e.g. "stats") -> cb(err, {key: value}) */
function mpdCommand(opts, cmd, cb) {
  var sock = net.createConnection({host: opts.host || 'localhost', port: opts.port || 6600});
  var buf = '', greeted = false, out = {}, finished = false;
  function finish(err) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { sock.end('close\n'); } catch (e) { /* already closed */ }
    cb(err, out);
  }
  var timer = setTimeout(function(){ finish(new Error('MPD not responding')); sock.destroy(); }, opts.timeout || 10000);
  sock.setEncoding('utf8');
  sock.on('data', function(d){
    buf += d;
    var n;
    while ((n = buf.indexOf('\n')) >= 0) {
      var l = buf.slice(0, n); buf = buf.slice(n + 1);
      if (!greeted) { greeted = true; if (l.indexOf('OK MPD') !== 0) return finish(new Error('not MPD: ' + l)); sock.write(cmd + '\n'); continue; }
      if (l === 'OK') return finish(null);
      if (l.indexOf('ACK') === 0) return finish(new Error(l));
      var i = l.indexOf(': ');
      if (i > 0) out[l.slice(0, i).toLowerCase()] = l.slice(i + 2);
    }
  });
  sock.on('error', function(e){ finish(e); });
  sock.on('close', function(){ finish(new Error('MPD connection closed')); });
}

/* ---------- evaluate ---------- */

/* key for spellings: ignoring accents, case, leading "The ", punctuation; & = and */
function artistKey(name) {
  var s = String(name || '').normalize ? String(name || '').normalize('NFKD') : String(name || '');
  s = s.replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  s = s.replace(/^the\s+/, '').replace(/\s*&\s*/g, ' and ').replace(/\s*\+\s*/g, ' and ');
  return s.replace(/[^a-z0-9]+/g, '');
}

function year(d) { var m = /\d{4}/.exec(d || ''); return m ? m[0] : ''; }
function uniq(list) { var o = {}, out = []; list.forEach(function(x){ if (!o.hasOwnProperty(x)) { o[x] = 1; out.push(x); } }); return out; }
function filesOf(list) { return list.map(function(s){ return {uri: s.file, title: s.title || path.basename(s.file)}; }); }
function byName(a, b) { return a.name.localeCompare(b.name); }

/* "1-3, 5" from sorted numbers */
function ranges(nums) {
  var out = [], i = 0;
  while (i < nums.length) {
    var j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? nums[i] + '\u2013' + nums[j] : String(nums[i]));
    i = j + 1;
  }
  return out.join(', ');
}

/* gaps in the track numbers of one folder, per disc (Disc tag; a CD2 folder counts as disc 2) and album name.
   Missing: from 1 (from the lowest number on a later disc, which may count on from the first) up to the highest
   number or the total from "3/10" (numbers used twice: trackDups). Not checked: single tracks (loose files) and groups
   with tracks without number (own category). Returns [{disc, missing: n, nums: "1-2, 4", files}] */
function trackGaps(dir, list) {
  var m = DISC_DIR_RE.exec(path.basename(dir)), dirDisc = m ? parseInt(m[3], 10) : 0;
  var groups = {}, keys = [];
  list.forEach(function(s){
    var dm = /^\s*(\d+)/.exec(s.disc || ''), disc = dm ? parseInt(dm[1], 10) : dirDisc;
    var k = disc + '\n' + (s.album || '');
    if (!groups[k]) { groups[k] = {disc: disc, songs: []}; keys.push(k); }
    groups[k].songs.push(s);
  });
  var out = [];
  keys.forEach(function(k){
    var g = groups[k], seen = {}, nums = [], total = 0, bad = false;
    if (g.songs.length < 2) return;
    g.songs.forEach(function(s){
      var tm = /^\s*(\d+)\s*(?:\/\s*(\d+))?/.exec(s.track || '');
      if (!tm) { bad = true; return; }
      var n = parseInt(tm[1], 10);
      if (tm[2]) total = Math.max(total, parseInt(tm[2], 10));
      if (!n) return;                                    /* track 0: hidden track or pregap */
      if (!seen[n]) { seen[n] = true; nums.push(n); }
    });
    if (bad || !nums.length) return;
    nums.sort(function(a, b){ return a - b; });
    var from = g.disc > 1 ? nums[0] : 1, to = Math.max(nums[nums.length - 1], total), missing = [];
    if (to - from > 999) return;                         /* nonsense numbers (e.g. a year): not a gap */
    for (var n = from; n <= to; n++) if (!seen[n]) missing.push(n);
    if (!missing.length) return;
    out.push({disc: g.disc > 0 && (g.disc > 1 || keys.length > 1 || dirDisc) ? g.disc : 0, missing: missing.length,
              nums: ranges(missing), files: g.songs});
  });
  return out;
}

/* ---------- duplicate tracks within an album ---------- */
var COPY_RE = /(\s*\(\d+\)|\s+(copy|kopie|copie|copia)(\s*\d+)?|\s+\d)$/i;          /* "Song (1)", "Song Kopie", "Song 2" */
var REMASTER_RE = /\s*([(\[][^)\]]*remaster[^)\]]*[)\]]|-\s*(\d{4}\s*)?(digital\s*)?remaster(ed)?(\s*\d{4})?(\s*version)?\s*$)/gi;
function base(file) { var b = path.basename(file); return b.replace(/\.[a-z0-9]+$/i, ''); }
function extOf(file) { var m = /\.([a-z0-9]+)$/i.exec(file); return m ? m[1].toLowerCase() : ''; }
/* title for comparing: case, accents, punctuation and leading track numbers do not count, remaster additions neither;
   other additions ("(Live)", "(Demo)", "(Single Edit)") do: those are different tracks */
function titleKey(t) {
  var s = String(t || '');
  if (s.normalize) s = s.normalize('NFKD');
  s = s.replace(/[̀-ͯ]/g, '').replace(REMASTER_RE, '').replace(/^\s*\d{1,3}\s*[-._)]\s*/, '');
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}
function quality(s) { var q = duplicates.quality([s]); return q; }
function secs(s) { return parseFloat(s.time) || 0; }

/* songs of one album (all its disc folders) -> [{key, title, sure, why, files: [song]}], best file first.
   sure: same title and length (within 2 s), a copy name ("Song (1).flac" next to "Song.flac") or the same file in two
   formats ("01.flac" and "01.mp3"); otherwise (lengths differ, or the same disc and track number with different
   titles) only a hint. Same title by different artists (compilations) does not count. */
function trackDups(list) {
  var out = [], used = {};
  function add(key, title, files, sure, why) {
    if (files.length < 2) return;
    var fresh = files.filter(function(s){ return !used[s.file]; });
    if (fresh.length < 2) return;
    fresh.forEach(function(s){ used[s.file] = 1; });
    out.push({key: key, title: title, sure: sure, why: why, files: rank(fresh)});
  }
  /* 1. copy names and the same file in two formats: by file name */
  var byBase = {};
  list.forEach(function(s){
    var d = path.dirname(s.file), b = base(s.file), plain = b.replace(COPY_RE, '');
    (byBase[d + '/' + b.toLowerCase()] = byBase[d + '/' + b.toLowerCase()] || []).push(s);
    if (plain !== b) (byBase['copy|' + d + '/' + plain.toLowerCase()] = byBase['copy|' + d + '/' + plain.toLowerCase()] || []).push(s);
  });
  Object.keys(byBase).forEach(function(k){
    if (k.indexOf('copy|') !== 0) return;
    var orig = byBase[k.slice(5)];                       /* only if the name without the addition exists as well */
    if (orig) add('f|' + k.slice(5), orig[0].title || base(orig[0].file), orig.concat(byBase[k]), true, 'copy');
  });
  Object.keys(byBase).forEach(function(k){
    if (k.indexOf('copy|') === 0) return;
    var g = byBase[k], exts = {};
    g.forEach(function(s){ exts[extOf(s.file)] = 1; });
    if (Object.keys(exts).length > 1) add('f|' + k, g[0].title || base(g[0].file), g, true, 'format');
  });
  /* 2. same artist and title */
  var byTitle = {};
  list.forEach(function(s){
    var t = titleKey(s.title);
    if (!t) return;
    var k = artistKey(s.artist || s.albumartist) + '|' + t;
    (byTitle[k] = byTitle[k] || []).push(s);
  });
  Object.keys(byTitle).forEach(function(k){
    var g = byTitle[k];
    if (g.length < 2) return;
    var ts = g.map(secs), same = Math.max.apply(null, ts) - Math.min.apply(null, ts) <= 2;
    add('t|' + k, g[0].title, g, same, same ? 'same' : 'length');
  });
  /* 3. the same disc and track number with different titles */
  var byNum = {};
  list.forEach(function(s){
    var tm = /^\s*(\d+)/.exec(s.track || ''), dm = /^\s*(\d+)/.exec(s.disc || '');
    if (!tm || !+tm[1]) return;
    var disc = dm ? +dm[1] : (DISC_DIR_RE.exec(path.basename(path.dirname(s.file))) || [0, 0, 0, 0])[3] || 0;
    var k = path.dirname(s.file) + '|' + disc + '|' + (+tm[1]);
    (byNum[k] = byNum[k] || []).push(s);
  });
  Object.keys(byNum).forEach(function(k){
    var g = byNum[k];
    add('n|' + k, g.map(function(s){ return s.title || base(s.file); }).join(' / '), g, false, 'number');
  });
  return out;
}
/* best first: lossless before lossy, more bits, higher rate, then without copy name, then the older file */
function rank(files) {
  return files.map(function(s){ return {s: s, q: quality(s), c: COPY_RE.test(base(s.file)) ? 1 : 0, m: Date.parse(s['last-modified'] || '') || 0}; })
    .sort(function(a, b){ return b.q.rank - a.q.rank || b.q.bits - a.q.bits || b.q.rate - a.q.rate || a.c - b.c || (a.m && b.m ? a.m - b.m : 0) || (a.s.file < b.s.file ? -1 : 1); })
    .map(function(x){ return x.s; });
}

/* songs: as from mpdWalk; hasCover(dir) -> true/false; audioOf(song) -> audio analysis entry or null (optional).
   Result: lists per category */
function analyze(songs, hasCover, audioOf) {
  var dirs = {}, order = [];
  songs.forEach(function(s){
    var d = path.dirname(s.file);
    if (!dirs[d]) { dirs[d] = []; order.push(d); }
    dirs[d].push(s);
  });
  var res = {songs: songs.length, albums: order.length, noCover: [], albumArtist: [], mixed: [], noTrack: [], gaps: [], dupTracks: [], spelling: []};
  var forGenres = [];
  order.sort().forEach(function(d){
    var list = dirs[d];
    var albums = uniq(list.map(function(s){ return s.album; }).filter(Boolean));
    var name = albums[0] || path.basename(d);
    var artists = uniq(list.map(function(s){ return s.artist; }).filter(Boolean));
    var aas = uniq(list.map(function(s){ return s.albumartist; }));
    var who = aas.filter(Boolean)[0] || (artists.length === 1 ? artists[0] : 'Verschiedene');
    var base = {dir: d, name: name, artist: who, count: list.length};
    function item(extra, files) { var o = {}; for (var k in base) o[k] = base[k]; for (k in extra) o[k] = extra[k]; o.files = filesOf(files || list); return o; }

    if (!hasCover(d)) res.noCover.push(item({}));
    var aaFilled = aas.filter(Boolean);
    if (aaFilled.length > 1 || (artists.length > 1 && aaFilled.length < aas.length)) {
      res.albumArtist.push(item({artists: artists.slice(0, 6), albumartists: aaFilled, missing: aaFilled.length < aas.length}));
    }
    var years = uniq(list.map(function(s){ return year(s.date); }));
    if (albums.length > 1 || years.length > 1 || (albums.length === 1 && list.some(function(s){ return !s.album; }))) {
      res.mixed.push(item({albums: albums, years: years.map(function(y){ return y || '(none)'; })}));
    }
    var noTrack = list.filter(function(s){ return !/\d/.test(s.track); });
    if (noTrack.length) res.noTrack.push(item({missing: noTrack.length}));
    trackGaps(d, list).forEach(function(g){
      res.gaps.push(item({disc: g.disc, missing: g.missing, nums: g.nums}, list));
    });
    forGenres.push({dir: d, name: name, artist: who, files: filesOf(list), songs: list,
                    audio: audioOf ? list.map(audioOf).filter(Boolean) : []});
  });
  /* duplicate tracks: per album, disc folders ("CD2") together with their album */
  var albumsOf = {}, albumOrder = [];
  order.forEach(function(d){
    var m = DISC_DIR_RE.exec(path.basename(d)), a = m ? path.dirname(d) : d;
    if (!albumsOf[a]) { albumsOf[a] = []; albumOrder.push(a); }
    albumsOf[a] = albumsOf[a].concat(dirs[d]);
  });
  albumOrder.sort().forEach(function(a){
    var list = albumsOf[a], groups = trackDups(list);
    if (!groups.length) return;
    var albumNames = uniq(list.map(function(s){ return s.album; }).filter(Boolean));
    var aas = uniq(list.map(function(s){ return s.albumartist; }).filter(Boolean)), artists = uniq(list.map(function(s){ return s.artist; }).filter(Boolean));
    res.dupTracks.push({dir: a, name: albumNames[0] || path.basename(a), artist: aas[0] || (artists.length === 1 ? artists[0] : 'Verschiedene'),
      count: list.length, files: filesOf(list), groups: groups.map(function(g){
        return {key: g.key, title: g.title, sure: g.sure, why: g.why, files: g.files.map(function(s, i){
          var q = quality(s);
          return {uri: s.file, name: path.basename(s.file), format: q.format, seconds: Math.round(secs(s)), best: i === 0};
        })};
      })});
  });
  var gc = genres.check(forGenres);
  res.genreMissing = gc.missing; res.genreMerge = gc.merge; res.genreConflict = gc.conflict; res.genreStyles = gc.styles;
  res.duplicates = duplicates.find(songs, artistKey);

  /* spellings: artist and album artist, grouped by artistKey */
  var groups = {};
  songs.forEach(function(s){
    uniq([s.artist, s.albumartist].filter(Boolean)).forEach(function(n){
      var k = artistKey(n);
      if (!k) return;
      var g = groups[k] || (groups[k] = {});
      g[n] = (g[n] || 0) + 1;
    });
  });
  Object.keys(groups).forEach(function(k){
    var names = Object.keys(groups[k]);
    if (names.length < 2) return;
    res.spelling.push({variants: names.map(function(n){ return {name: n, count: groups[k][n]}; })
      .sort(function(a, b){ return b.count - a.count || a.name.localeCompare(b.name); })});
  });
  res.spelling.sort(function(a, b){ return byName(a.variants[0], b.variants[0]); });
  /* names with their number of tracks (as artist or album artist), for the usual spelling (artistnames.js) */
  res.names = {};
  songs.forEach(function(s){ uniq([s.artist, s.albumartist].filter(Boolean)).forEach(function(n){ res.names[n] = (res.names[n] || 0) + 1; }); });
  return res;
}

/* folders without an image file (folder.jpg, cover.jpg, …); the caller checks embedded covers afterwards.
   Reads asynchronously, a few folders at a time: the service stays responsive meanwhile. cb(list in song order) */
function dirsWithoutImage(songs, musicRoot, cb) {
  var seen = Object.create(null), dirs = [];
  songs.forEach(function(s){
    var d = path.dirname(s.file);
    if (!seen[d]) { seen[d] = true; dirs.push({dir: d, file: s.file}); }
  });
  var missing = [], i = 0, running = 0, left = dirs.length;
  if (!left) return cb([]);
  function next() {
    while (running < 4 && i < dirs.length) (function(k){
      running++; i++;
      fs.readdir(path.join(musicRoot, dirs[k].dir), function(e, names){   /* folder missing: count as without image */
        if (!(names || []).some(function(n){ return IMG_RE.test(n); })) missing[k] = true;
        running--; left--;
        if (!left) return cb(dirs.filter(function(d, j){ return missing[j]; }));
        next();
      });
    })(i);
  }
  next();
}

module.exports = {mpdWalk: mpdWalk, mpdCommand: mpdCommand, analyze: analyze, artistKey: artistKey, trackGaps: trackGaps, trackDups: trackDups, titleKey: titleKey, dirsWithoutImage: dirsWithoutImage};
