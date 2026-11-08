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

/* what makes two names look the same but differ: spaces at the start or end, double spaces, protected space, invisible
   characters, another Unicode form (é as e + accent) -> ['edge', 'double', 'nbsp', 'invisible', 'unicode'] */
var INVISIBLE_RE = /[\u200B-\u200F\u2060\uFEFF\u00AD]/;
function nameFlaws(n) {
  var f = [];
  if (/^\s|\s$/.test(n)) f.push('edge');
  if (/\S\s{2,}\S/.test(n)) f.push('double');
  if (/[\u00A0\u2000-\u200A\u202F\u3000]/.test(n)) f.push('nbsp');
  if (INVISIBLE_RE.test(n)) f.push('invisible');
  if (n.normalize && n.normalize('NFC') !== n) f.push('unicode');
  return f;
}
function cleanName(n) {
  n = String(n || '');
  if (n.normalize) n = n.normalize('NFC');
  return n.replace(new RegExp(INVISIBLE_RE.source, 'g'), '').replace(/[\s\u00A0\u2000-\u200A\u202F\u3000]+/g, ' ').trim();
}
/* suggestion among the spellings of one artist: the most common one (ties: the one without flaws, then the one with fewer
   special characters), cleaned of invisible flaws */
function spellingSuggest(variants) {
  function odd(n) { return (n.match(/[^\x20-\x7e]/g) || []).length; }   /* letters with accents and the like */
  var best = variants.slice().sort(function(a, b){
    return b.count - a.count || (a.flaws ? 1 : 0) - (b.flaws ? 1 : 0) || odd(a.name) - odd(b.name) || a.name.localeCompare(b.name);
  })[0];
  return cleanName(best.name);
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
/* duplicate albums: tracks of the other versions that the best one lacks (same artist and title as for duplicate
   tracks, a title cut short counts as the same); sure: its disc and track number is free in the best version (otherwise
   taken: the title there, perhaps the same track spelled otherwise; offered unchecked). Each with the folder of the
   best version to copy it into: the disc folder with the same disc number, a new disc folder next to them for a disc
   the best version lacks ("CD3" like "CD1"), otherwise its (first) folder.
   g: entry of duplicates.find; songsOf(dir) -> songs. -> [{uri, title, artist, format, worse, disc, track, to, sure, taken}] */
function missingTracks(g, songsOf) {
  var best = g.versions[0], have = {}, bestSongs = [];
  best.dirs.forEach(function(d){ bestSongs = bestSongs.concat(songsOf(d)); });
  function key(s) { var t = titleKey(s.title); return t ? artistKey(s.artist || s.albumartist) + '|' + t : ''; }
  function num(s, d) {                                   /* "disc|track"; no disc counts as disc 1 */
    var tm = /^\s*(\d+)/.exec(s.track || ''), dm = /^\s*(\d+)/.exec(s.disc || ''), fm = DISC_DIR_RE.exec(path.basename(d || path.dirname(s.file)));
    return tm && +tm[1] ? ((dm ? +dm[1] : fm ? +fm[3] : 0) || 1) + '|' + (+tm[1]) : '';
  }
  var keys = [], nums = {};
  bestSongs.forEach(function(s){ var k = key(s); have[k] = 1; keys.push({k: k, t: String(s.title || '')}); var n = num(s); if (n && !nums[n]) nums[n] = s.title || path.basename(s.file); });
  /* the same title, also cut short in one of them ("The More You Live, The More Yo", e.g. ID3v1 with 30 characters);
     but an addition after the shorter one ("Northern Skies (Remix)", "Song - Live") is another track */
  function known(k, title) {
    if (have[k]) return true;
    title = String(title || '');
    return keys.some(function(h){
      if (!h.k) return false;
      var short = h.k.length < k.length ? h : {k: k, t: title}, long = short === h ? {k: k, t: title} : h;
      if (short.k.split('|')[1].length < 12 || long.k.indexOf(short.k) !== 0) return false;
      return !/[(\[]|\s[-–]\s/.test(long.t.slice(Math.max(0, short.t.trim().length - 1)));
    });
  }
  var bestRank = duplicates.quality(bestSongs).rank, discDirs = {};
  best.dirs.forEach(function(d){
    var m = DISC_DIR_RE.exec(path.basename(d));
    if (m) discDirs[+m[3]] = d;
    songsOf(d).forEach(function(s){ var dm = /^\s*(\d+)/.exec(s.disc || ''); if (dm && !discDirs[+dm[1]]) discDirs[+dm[1]] = d; });
  });
  var multi = best.dirs.length > 1 || Object.keys(discDirs).some(function(n){ return discDirs[n] !== best.dirs[0]; });
  var out = [];
  g.versions.slice(1).forEach(function(v){
    v.dirs.forEach(function(d){
      songsOf(d).forEach(function(s){
        var k = key(s), n = num(s, d);
        if (!k || known(k, s.title)) return;
        var taken = n && nums[n];                        /* number already there: perhaps the same track spelled otherwise */
        have[k] = 1; keys.push({k: k, t: String(s.title || '')}); if (n && !taken) nums[n] = s.title || path.basename(s.file);
        var dm = /^\s*(\d+)/.exec(s.disc || ''), fm = DISC_DIR_RE.exec(path.basename(d));
        var disc = dm ? +dm[1] : fm ? +fm[3] : 0, to = best.dirs[0];
        if (disc && discDirs[disc]) to = discDirs[disc];
        else if (disc && multi && DISC_DIR_RE.test(path.basename(best.dirs[0]))) {   /* a disc the best version lacks: new disc folder */
          to = path.dirname(best.dirs[0]) + '/' + (fm ? path.basename(d) : path.basename(best.dirs[0]).replace(/\d+/, String(disc)));
        }
        var q = duplicates.quality([s]);
        var o = {uri: s.file, title: s.title || path.basename(s.file), artist: s.artist || '', format: q.format, worse: q.rank < bestRank,
                 disc: s.disc || '', track: s.track || '', to: to, sure: !taken};
        if (taken) o.taken = taken;
        out.push(o);
      });
    });
  });
  return out.sort(function(a, b){ return (parseInt(a.disc, 10) || 0) - (parseInt(b.disc, 10) || 0) || (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0); });
}

/* best first: lossless before lossy, the higher data rate (lossy, from s.size), more bits, higher rate, then without
   copy name, then the older file */
function rank(files) {
  return files.map(function(s){ return {s: s, q: quality(s), c: COPY_RE.test(base(s.file)) ? 1 : 0, m: Date.parse(s['last-modified'] || '') || 0}; })
    .sort(function(a, b){ return b.q.rank - a.q.rank || (b.q.eff || 0) - (a.q.eff || 0) || b.q.bits - a.q.bits || b.q.rate - a.q.rate || a.c - b.c || (a.m && b.m ? a.m - b.m : 0) || (a.s.file < b.s.file ? -1 : 1); })
    .map(function(x){ return x.s; });
}

/* disc addition at the end of an album name: "Album (Disc 2)", "Album [CD 1]", "Album - CD2", "Album CD2",
   "Album (Disc 1 of 2)"; "Vol. 2" is part of the name */
var DISC_SFX_RE = /(?:\s*[(\[{]\s*(?:cd|dis[ck]|disco|disque)\s*[-_.]?\s*(\d+)(?:\s*(?:of|von|\/)\s*\d+)?\s*[)\]}]|\s+[-–:]\s*(?:cd|dis[ck]|disco|disque)\s*[-_.]?\s*(\d+)(?:\s*(?:of|von|\/)\s*\d+)?|\s+(?:cd|dis[ck])\s*(\d+))\s*$/i;
function bareAlbum(name) { return String(name || '').replace(DISC_SFX_RE, '').trim(); }
function discOfName(name) { var m = DISC_SFX_RE.exec(String(name || '')); return m ? String(+(m[1] || m[2] || m[3])) : ''; }
/* [{name, count}] of the values fn(song), most common first */
function counted(list, fn) {
  var c = {}, order = [];
  list.forEach(function(s){ var v = fn(s); if (!c.hasOwnProperty(v)) { c[v] = 0; order.push(v); } c[v]++; });
  return order.map(function(v){ return {name: v, count: c[v]}; }).sort(function(a, b){ return b.count - a.count; });
}
function whoOf(list) {
  var aas = uniq(list.map(function(s){ return s.albumartist; }).filter(Boolean)), artists = uniq(list.map(function(s){ return s.artist; }).filter(Boolean));
  return aas[0] || (artists.length === 1 ? artists[0] : 'Verschiedene');
}
function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

/* songs of an album: disc folders ("CD2") together with their album -> {albumsOf: {dir: [song]}, albumOrder: [dir]} */
function albumGroups(dirs, order) {
  var albumsOf = {}, albumOrder = [];
  order.forEach(function(d){
    var m = DISC_DIR_RE.exec(path.basename(d)), a = m ? path.dirname(d) : d;
    if (!albumsOf[a]) { albumsOf[a] = []; albumOrder.push(a); }
    albumsOf[a] = albumsOf[a].concat(dirs[d]);
  });
  return {albumsOf: albumsOf, albumOrder: albumOrder};
}
/* all songs that are in a group of duplicate tracks (before analyze: the tag service then reads their size and m4a codec) */
function dupTrackSongs(songs) {
  var dirs = {}, order = [], out = [];
  songs.forEach(function(s){ var d = path.dirname(s.file); if (!dirs[d]) { dirs[d] = []; order.push(d); } dirs[d].push(s); });
  var ag = albumGroups(dirs, order);
  ag.albumOrder.forEach(function(a){ trackDups(ag.albumsOf[a]).forEach(function(g){ out = out.concat(g.files); }); });
  return out;
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
  var res = {songs: songs.length, albums: order.length, noCover: [], albumArtist: [], albumName: [], yearMixed: [], noTrack: [], noTags: [], gaps: [], dupTracks: [], spelling: [], mixedQuality: []};
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
    var noTrack = list.filter(function(s){ return !/\d/.test(s.track); });
    if (noTrack.length) res.noTrack.push(item({missing: noTrack.length}));
    var noTags = missingTags(list);                                  /* title, artist or album tag empty */
    if (noTags) res.noTags.push(item(noTags));
    trackGaps(d, list).forEach(function(g){
      res.gaps.push(item({disc: g.disc, missing: g.missing, nums: g.nums}, list));
    });
    forGenres.push({dir: d, name: name, artist: who, files: filesOf(list), songs: list,
                    audio: audioOf ? list.map(audioOf).filter(Boolean) : []});
  });
  /* duplicate tracks: per album, disc folders ("CD2") together with their album */
  var ag = albumGroups(dirs, order), albumsOf = ag.albumsOf, albumOrder = ag.albumOrder;
  /* album name and year not the same in all tracks of an album (disc folders together): the suggestion is added by the
     tag service (MusicBrainz), here the most common value; album names without a disc addition ("Album (Disc 2)") */
  albumOrder.slice().sort().forEach(function(a){
    var list = albumsOf[a], names = counted(list, function(s){ return s.album || ''; }), years = counted(list, function(s){ return year(s.date); });
    var base = {dir: a, name: names.filter(function(x){ return x.name; }).concat([{name: path.basename(a)}])[0].name, artist: whoOf(list), count: list.length};
    function files(extra) {
      return list.map(function(s){ var o = {uri: s.file, title: s.title || path.basename(s.file)}; if (extra) extra(o, s); return o; });
    }
    if (names.length > 1) {
      var bare = counted(list, function(s){ return bareAlbum(s.album); }).filter(function(x){ return x.name; });
      res.albumName.push(merge(base, {names: names, bare: bare.length ? bare[0].name : base.name, files: files(function(o, s){
        var n = discOfName(s.album);
        if (n && !/\d/.test(s.disc || '')) o.disc = n;                 /* "Album (Disc 2)" without disc number: 2 */
        o.album = s.album || '';
      })}));
    }
    if (years.length > 1) {
      var most = years.filter(function(x){ return x.name; });
      res.yearMixed.push(merge(base, {years: years, most: most.length ? most[0].name : '', files: files()}));
    }
    var mq = mixedQuality(list);
    if (mq) res.mixedQuality.push(merge(base, merge(mq, {files: files()})));
  });
  /* folders that the duplicate check counts as different versions of an album (e.g. an incomplete copy in the album
     folder next to CD1/CD2): the same track in two versions is listed there, not here */
  var verOf = {};
  res.duplicates = duplicates.find(songs, artistKey);
  res.duplicates.forEach(function(g){
    var m = missingTracks(g, function(d){ return dirs[d] || []; });
    if (m.length) g.missing = m;
  });
  res.duplicates.forEach(function(g, i){
    g.versions.forEach(function(v, k){ v.dirs.forEach(function(d){ verOf[d] = i + '.' + k; }); });
  });
  function oneVersion(g) {
    var seen = {};
    g.files.forEach(function(s){ var v = verOf[path.dirname(s.file)]; if (v) seen[v] = 1; });
    return Object.keys(seen).length < 2;
  }
  albumOrder.sort().forEach(function(a){
    var list = albumsOf[a], groups = trackDups(list).filter(oneVersion);
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
    var variants = names.map(function(n){ var o = {name: n, count: groups[k][n]}, f = nameFlaws(n); if (f.length) o.flaws = f; return o; })
      .sort(function(a, b){ return b.count - a.count || a.name.localeCompare(b.name); });
    res.spelling.push({key: k, variants: variants, suggest: spellingSuggest(variants)});
  });
  res.spelling.sort(function(a, b){ return byName(a.variants[0], b.variants[0]); });
  /* names with their number of tracks (as artist or album artist), for the usual spelling (artistnames.js) */
  res.names = {};
  songs.forEach(function(s){ uniq([s.artist, s.albumartist].filter(Boolean)).forEach(function(n){ res.names[n] = (res.names[n] || 0) + 1; }); });
  return res;
}

/* tracks of one folder without title, artist or album tag (the player then shows the file name or nothing; such tracks
   also fall out of the artist and album lists) -> {title: n, artist: n, album: n, without: [file names, at most 8]} or null */
function missingTags(list) {
  var o = {title: 0, artist: 0, album: 0}, without = [];
  list.forEach(function(s){
    var miss = false;
    ['title', 'artist', 'album'].forEach(function(k){ if (!String(s[k] || '').trim()) { o[k]++; miss = true; } });
    if (miss && without.length < 8) without.push(path.basename(s.file));
  });
  if (!o.title && !o.artist && !o.album) return null;
  o.without = without;
  return o;
}

/* an album (disc folders together) with lossless and lossy tracks, typically left over after "Fill in" from another
   version: -> {formats: [{name: 'FLAC 16/44.1', count}], lossy: n, worse: [{uri, name, format}]} or null. Only lossless
   next to lossy counts; FLAC next to ALAC or different sample rates are fine */
function mixedQuality(list) {
  var lossless = 0, worse = [], formats = {};
  list.forEach(function(s){
    var q = duplicates.quality([s]);
    if (!q.rank) return;                                             /* unknown file type */
    var shown = q.format.replace(/ \d+ kbps$/, '');                 /* "MP3", not every data rate on its own */
    formats[shown] = (formats[shown] || 0) + 1;
    if (q.rank >= 2) lossless++;
    else worse.push({uri: s.file, name: s.title || path.basename(s.file), format: q.format, seconds: Math.round(secs(s))});
  });
  if (!lossless || !worse.length) return null;
  return {formats: Object.keys(formats).map(function(k){ return {name: k, count: formats[k]}; })
                   .sort(function(a, b){ return b.count - a.count || a.name.localeCompare(b.name); }),
          lossy: worse.length, worse: worse.slice(0, 50)};
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

module.exports = {mpdWalk: mpdWalk, mpdCommand: mpdCommand, analyze: analyze, artistKey: artistKey, trackGaps: trackGaps, trackDups: trackDups, titleKey: titleKey, missingTracks: missingTracks, missingTags: missingTags, mixedQuality: mixedQuality, dupTrackSongs: dupTrackSongs, bareAlbum: bareAlbum, discOfName: discOfName, dirsWithoutImage: dirsWithoutImage};
