/* Papierkorb (trash) of the library check: what was moved into "Xplorio Trash" on each drive (duplicates.js trashPath),
   put back, or deleted for good. Paths are relative to the music root (/mnt), e.g. "USB/S/Xplorio Trash/Help/1.flac".
   Journal: [{to, from, at, reason}] written by the tag service when it moves something (reason: dupAlbum, albumEditor,
   dupTrack, mixedQuality); what is in the trash without an entry (moved by an earlier version) counts as one entry per
   folder with files, its old place is the path without "Xplorio Trash". Node 8, ES5 only. */
var fs = require('fs');
var path = require('path');
var duplicates = require('./duplicates.js');
var TRASH = duplicates.TRASH;

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } }
function children(p) { try { return fs.readdirSync(p).sort(); } catch (e) { return []; } }

/* the drives: INTERNAL, USB/<name>, NAS/<name> */
function drives(root) {
  var out = ['INTERNAL'];
  ['USB', 'NAS'].forEach(function(r){ children(path.join(root, r)).forEach(function(d){ if (isDir(path.join(root, r, d))) out.push(r + '/' + d); }); });
  return out;
}

/* "USB/S/Xplorio Trash/Help/1.flac" -> {drive: 'USB/S', rest: 'Help/1.flac'}; null if not inside a trash folder or not safe */
function split(rel) {
  if (typeof rel !== 'string' || !rel || rel.indexOf('\0') >= 0 || rel.charAt(0) === '/') return null;
  var parts = rel.split('/');
  if (parts.some(function(p){ return !p || p === '.' || p === '..'; })) return null;
  var n = parts[0] === 'INTERNAL' ? 1 : (parts[0] === 'USB' || parts[0] === 'NAS') ? 2 : 0;
  if (!n || parts.length < n + 2 || parts[n] !== TRASH) return null;
  return {drive: parts.slice(0, n).join('/'), rest: parts.slice(n + 1).join('/')};
}

/* old place of something in the trash, without a journal entry */
function origin(rel) {
  var s = split(rel);
  return s ? s.drive + '/' + s.rest : null;
}

/* bytes and number of files below p (one level of symlinks is not followed: lstat) */
function measure(p) {
  var st;
  try { st = fs.lstatSync(p); } catch (e) { return {bytes: 0, files: 0}; }
  if (!st.isDirectory()) return {bytes: st.isFile() ? st.size : 0, files: st.isFile() ? 1 : 0};
  var sum = {bytes: 0, files: 0};
  children(p).forEach(function(c){ var m = measure(path.join(p, c)); sum.bytes += m.bytes; sum.files += m.files; });
  return sum;
}

function changed(p) { try { var st = fs.lstatSync(p); return Math.round(st.ctime.getTime()); } catch (e) { return 0; } }

/* {drives: [{drive, bytes, entries: [{path, kind, from, at, reason, bytes, files}]}], bytes, count} */
function list(root, journal) {
  var byTo = {};
  (journal || []).forEach(function(j){ if (j && j.to) byTo[j.to] = j; });
  var out = {drives: [], bytes: 0, count: 0};
  drives(root).forEach(function(drive){
    var base = drive + '/' + TRASH;
    if (!isDir(path.join(root, base))) return;
    var entries = [], covered = {};
    Object.keys(byTo).forEach(function(to){
      if (to.indexOf(base + '/') !== 0 || !exists(path.join(root, to))) return;
      covered[to] = true;
    });
    function inCovered(rel) { return Object.keys(covered).some(function(c){ return rel === c || rel.indexOf(c + '/') === 0; }); }
    Object.keys(covered).sort().forEach(function(to){
      var j = byTo[to], full = path.join(root, to), m = measure(full);
      entries.push({path: to, kind: isDir(full) ? 'dir' : 'file', from: j.from || origin(to), at: j.at || changed(full),
                    reason: j.reason || '', bytes: m.bytes, files: m.files});
    });
    /* the rest: every folder with files of its own (or a file right in the trash folder) is one entry */
    (function walk(rel) {
      var full = path.join(root, rel), own = false;
      children(full).forEach(function(c){
        if (c.charAt(0) === '.') return;                                    /* .DS_Store, ._ files of the Mac */
        var r = rel + '/' + c, f = path.join(root, r);
        if (inCovered(r)) return;
        if (isDir(f)) walk(r);
        else if (rel === base) { var m = measure(f); entries.push({path: r, kind: 'file', from: origin(r), at: changed(f), reason: '', bytes: m.bytes, files: 1}); }
        else own = true;
      });
      if (own && rel !== base) {
        var m = measure(full), mine = 0;
        /* without the parts that are entries of their own */
        Object.keys(covered).forEach(function(c){ if (c.indexOf(rel + '/') === 0) { var x = measure(path.join(root, c)); mine += x.bytes; m.files -= x.files; } });
        entries.push({path: rel, kind: 'dir', from: origin(rel), at: changed(full), reason: '', bytes: m.bytes - mine, files: m.files});
      }
    })(base);
    entries.sort(function(a, b){ return b.at - a.at || (a.path < b.path ? -1 : 1); });
    var bytes = entries.reduce(function(s, e){ return s + e.bytes; }, 0);
    if (!entries.length) return;
    out.drives.push({drive: drive, bytes: bytes, entries: entries});
    out.bytes += bytes; out.count += entries.length;
  });
  return out;
}

function mkdirs(dir) {
  var parts = path.resolve(dir).split(path.sep), cur = '';
  parts.forEach(function(p, i){
    cur = i ? path.join(cur, p) : (p || path.sep);
    try { fs.mkdirSync(cur); } catch (e) { /* already exists */ }
  });
}

function rmrf(p) {
  var st;
  try { st = fs.lstatSync(p); } catch (e) { return; }
  if (st.isDirectory()) { children(p).forEach(function(c){ rmrf(path.join(p, c)); }); fs.rmdirSync(p); }
  else fs.unlinkSync(p);
}

/* empty folders above rel, up to (not including) the trash folder of its drive; Mac leftovers do not count */
function pruneUp(root, rel) {
  var s = split(rel);
  if (!s) return;
  var base = s.drive + '/' + TRASH, cur = path.dirname(rel);
  while (cur.indexOf(base + '/') === 0) {
    var full = path.join(root, cur), left = children(full);
    if (left.some(function(c){ return c !== '.DS_Store' && c.indexOf('._') !== 0; })) return;
    left.forEach(function(c){ try { fs.unlinkSync(path.join(full, c)); } catch (e) { /* stays */ } });
    try { fs.rmdirSync(full); } catch (e) { return; }
    cur = path.dirname(cur);
  }
}

/* files below p, relative to p */
function filesBelow(p, pre) {
  var out = [];
  children(p).forEach(function(c){
    var f = path.join(p, c), r = pre ? pre + '/' + c : c;
    if (isDir(f)) out = out.concat(filesBelow(f, r)); else out.push(r);
  });
  return out;
}

/* the real path stays inside the drive (a symlink could lead out) */
function inside(root, rel) {
  var s = split(rel);
  if (!s) return false;
  try {
    var real = fs.realpathSync(path.join(root, rel)), base = fs.realpathSync(path.join(root, s.drive, TRASH));
    return real.indexOf(base + path.sep) === 0;
  } catch (e) { return false; }
}

/* put an entry back at its old place; never overwrites. -> {ok, from, to} or {ok: false, error, conflict} */
function restore(root, rel, from) {
  if (!split(rel) || !exists(path.join(root, rel))) return {ok: false, error: 'gone'};
  if (!inside(root, rel)) return {ok: false, error: 'not in the trash'};
  var to = from || origin(rel), s = split(rel);
  if (!to || to.split('/')[0] !== rel.split('/')[0] || to.indexOf(s.drive + '/') !== 0 || split(to) || to.split('/').indexOf('..') >= 0) return {ok: false, error: 'bad origin'};
  var src = path.join(root, rel), dst = path.join(root, to);
  if (!isDir(src)) {
    if (exists(dst)) return {ok: false, error: 'exists', conflict: to};
    mkdirs(path.dirname(dst));
    fs.renameSync(src, dst);
  } else if (!exists(dst)) {
    mkdirs(path.dirname(dst));
    fs.renameSync(src, dst);
  } else {
    if (!isDir(dst)) return {ok: false, error: 'exists', conflict: to};
    var files = filesBelow(src, '');                                       /* the album folder is there again: add the files */
    var clash = files.filter(function(f){ return exists(path.join(dst, f)); });
    if (clash.length) return {ok: false, error: 'exists', conflict: to + '/' + clash[0]};
    files.forEach(function(f){ mkdirs(path.dirname(path.join(dst, f))); fs.renameSync(path.join(src, f), path.join(dst, f)); });
    rmrf(src);
  }
  pruneUp(root, rel);
  return {ok: true, from: rel, to: to};
}

/* delete an entry for good -> {ok} */
function remove(root, rel) {
  if (!split(rel) || !exists(path.join(root, rel))) return {ok: false, error: 'gone'};
  if (!inside(root, rel)) return {ok: false, error: 'not in the trash'};
  rmrf(path.join(root, rel));
  pruneUp(root, rel);
  return {ok: true};
}

/* empty the trash folder of a drive (the folder itself stays, with its .mpdignore line) -> {ok, removed} */
function empty(root, drive) {
  if (drives(root).indexOf(drive) < 0) return {ok: false, error: 'no such drive'};
  var base = path.join(root, drive, TRASH), n = 0;
  if (!isDir(base)) return {ok: true, removed: 0};
  var real;
  try { real = fs.realpathSync(base); } catch (e) { return {ok: false, error: 'not in the trash'}; }
  if (real !== path.join(fs.realpathSync(path.join(root, drive)), TRASH)) return {ok: false, error: 'not in the trash'};
  children(base).forEach(function(c){ rmrf(path.join(base, c)); n++; });
  return {ok: true, removed: n};
}

/* the files of a folder entry, for putting back or deleting one by one -> {ok, files: [{path, name, bytes}]} */
function files(root, rel) {
  if (!split(rel) || !isDir(path.join(root, rel))) return {ok: false, error: 'gone'};
  if (!inside(root, rel)) return {ok: false, error: 'not in the trash'};
  return {ok: true, files: filesBelow(path.join(root, rel), '').filter(function(f){
    var b = path.basename(f);
    return b !== '.DS_Store' && b.indexOf('._') !== 0;
  }).map(function(f){
    var m = measure(path.join(root, rel, f));
    return {path: rel + '/' + f, name: f, bytes: m.bytes};
  })};
}

/* old place of something in the trash: from the journal entry it belongs to (itself or a folder above it), else the path */
function originOf(journal, rel) {
  var best = null;
  (journal || []).forEach(function(j){
    if (j && j.to && j.from && (rel === j.to || rel.indexOf(j.to + '/') === 0) && (!best || j.to.length > best.to.length)) best = j;
  });
  return best ? best.from + rel.slice(best.to.length) : origin(rel);
}

/* journal after a move: new entries in, ones whose file is gone out, at most the newest 2000 */
function journalAdd(journal, entries, root) {
  var keep = (journal || []).filter(function(j){
    return j && j.to && !entries.some(function(e){ return e.to === j.to; }) && (!root || exists(path.join(root, j.to)));
  });
  return keep.concat(entries).slice(-2000);
}

module.exports = {drives: drives, split: split, origin: origin, originOf: originOf, files: files, list: list, restore: restore, remove: remove, empty: empty, journalAdd: journalAdd};
