/* Library check: find problem cases in the collection (read only, writes nothing to the music files).
   The source is the MPD database (folder by folder via "lsinfo", so no response gets too large),
   plus a look into the folders for cover images. Node 8, ES5 only. */
var net  = require('net');
var fs   = require('fs');
var path = require('path');
var genres = require('./genres.js');
var duplicates = require('./duplicates.js');

var IMG_RE = /\.(jpe?g|png)$/i;

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
      if (path.basename(v) !== duplicates.TRASH) queue.push(v);
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

/* songs: as from mpdWalk; hasCover(dir) -> true/false; audioOf(song) -> audio analysis entry or null (optional).
   Result: lists per category */
function analyze(songs, hasCover, audioOf) {
  var dirs = {}, order = [];
  songs.forEach(function(s){
    var d = path.dirname(s.file);
    if (!dirs[d]) { dirs[d] = []; order.push(d); }
    dirs[d].push(s);
  });
  var res = {songs: songs.length, albums: order.length, noCover: [], albumArtist: [], mixed: [], noTrack: [], spelling: []};
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
    forGenres.push({dir: d, name: name, artist: who, files: filesOf(list), songs: list,
                    audio: audioOf ? list.map(audioOf).filter(Boolean) : []});
  });
  var gc = genres.check(forGenres);
  res.genreMissing = gc.missing; res.genreMerge = gc.merge; res.genreStyles = gc.styles;
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

module.exports = {mpdWalk: mpdWalk, mpdCommand: mpdCommand, analyze: analyze, artistKey: artistKey, dirsWithoutImage: dirsWithoutImage};
