/* Hiding folders and files from the library with .mpdignore (Dateimanager "In der Bibliothek ausblenden", overview
   "Ausgeblendet" under System › Laufwerke and Mac settings › Musikordner).
   MPD's rules (src/db/update/ExcludeList.cxx, Walk.cxx): a .mpdignore holds one shell pattern per line (*, ?, [...]),
   matched with fnmatch against the names inside its folder; blank lines and lines starting with # do not count, every line
   is trimmed. The patterns also apply to all folders below (a line "Live" in Beatles/.mpdignore hides Beatles/Live and
   Beatles/Help/Live). MPD drops a hidden entry only when the folder holding the .mpdignore is read again.
   Xplorio writes the exact name of an entry into the .mpdignore of its folder; characters with a meaning in patterns
   become "?". Lines Xplorio did not write stay as they are. Paths relative to the music root, like fileops.js.
   Node 8, ES5 only. */
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var fileops = require('./fileops.js');
var duplicates = require('./duplicates.js');
var writeAtomic = require('./atomic.js').writeAtomic;

var NAME = '.mpdignore';

/* the line for an entry: its name, with *, ?, [, ], \ and a leading # or space (and a trailing space) as "?" */
function lineFor(name) {
  var s = String(name).replace(/[*?[\]\\]/g, '?');
  s = s.replace(/^[#\s]/, '?').replace(/\s$/, '?');
  return s;
}

/* fnmatch(pattern, name, 0): *, ?, [abc], [a-z], [!x] / [^x], \ escapes; "*" also matches a leading dot */
function match(pattern, name) {
  var p = String(pattern), s = String(name);
  function at(pi, si) {
    while (pi < p.length) {
      var c = p.charAt(pi);
      if (c === '*') {
        while (p.charAt(pi) === '*') pi++;
        if (pi === p.length) return true;
        for (var k = si; k <= s.length; k++) if (at(pi, k)) return true;
        return false;
      }
      if (si >= s.length) return false;
      if (c === '?') { pi++; si++; continue; }
      if (c === '[') {
        var end = p.indexOf(']', pi + 2), j = pi + 1, neg = false, hit = false;
        if (p.charAt(j) === '!' || p.charAt(j) === '^') { neg = true; j++; end = p.indexOf(']', j + 1); }
        if (end < 0) { if (s.charAt(si) !== '[') return false; pi++; si++; continue; }   /* no closing bracket: a plain "[" */
        var ch = s.charAt(si);
        for (; j < end; j++) {
          var lo = p.charAt(j);
          if (p.charAt(j + 1) === '-' && j + 2 < end) { if (ch >= lo && ch <= p.charAt(j + 2)) hit = true; j += 2; }
          else if (ch === lo) hit = true;
        }
        if (hit === neg) return false;
        pi = end + 1; si++; continue;
      }
      if (c === '\\' && pi + 1 < p.length) { pi++; c = p.charAt(pi); }
      if (c !== s.charAt(si)) return false;
      pi++; si++;
    }
    return si === s.length;
  }
  return at(0, 0);
}

/* text of a .mpdignore -> the patterns as MPD reads them */
function patterns(text) {
  return String(text || '').split(/\r?\n/).map(function(l){ return l.trim(); }).filter(function(l){ return l && l.charAt(0) !== '#'; });
}
function readPatterns(full) {
  try { return patterns(fs.readFileSync(path.join(full, NAME), 'utf8')); } catch (e) { return []; }
}

/* the .mpdignore files that apply inside folder rel: [{dir, patterns}] from the music root down to rel itself */
function chain(root, rel) {
  var out = [], parts = rel ? String(rel).split('/') : [];
  for (var k = 0; k <= parts.length; k++) {
    var dir = parts.slice(0, k).join('/'), ps = readPatterns(path.join(root, dir));
    if (ps.length) out.push({dir: dir, patterns: ps});
  }
  return out;
}
/* is name (inside folder dir) hidden by these files? -> {dir, pattern} or null */
function hits(files, name) {
  for (var i = 0; i < files.length; i++) {
    for (var k = 0; k < files[i].patterns.length; k++) {
      if (match(files[i].patterns[k], name)) return {dir: files[i].dir, pattern: files[i].patterns[k]};
    }
  }
  return null;
}
/* is entry rel hidden from the library, by its own folder's .mpdignore or by one above, or because a folder on its way is?
   -> {path: the hidden entry (rel or a folder above it), dir, pattern, own: Xplorio's line for it in its own folder} or null */
function hiddenBy(root, rel) {
  var parts = String(rel).split('/');
  for (var k = 1; k <= parts.length; k++) {
    var parent = parts.slice(0, k - 1).join('/'), name = parts[k - 1];
    var h = hits(chain(root, parent), name);
    if (h) {
      h.path = parts.slice(0, k).join('/');
      h.own = h.dir === parent && h.pattern === lineFor(name);
      return h;
    }
  }
  return null;
}

/* a folder listing of fileops.list: every entry hidden from the library gets hidden: {dir, pattern, own}; the folder itself,
   if it lies inside a hidden folder (or is one): l.hidden = {path, dir, pattern, own} */
function mark(root, l) {
  if (!l || !l.ok || !l.path) return l;
  var drive = fileops.driveOf(l.path, root), up = hiddenBy(root, l.path);
  if (up && up.path.split('/').length > drive.split('/').length) l.hidden = up;   /* the drive itself is not ours to show */
  var files = chain(root, l.path);
  if (!files.length) return l;
  function one(e) {
    var h = hits(files, e.name);
    if (h) { h.own = h.dir === l.path && h.pattern === lineFor(e.name); e.hidden = h; }
  }
  (l.dirs || []).forEach(one);
  (l.files || []).forEach(one);
  return l;
}

/* write or remove Xplorio's line in the .mpdignore of folder full. The file goes when nothing but blank lines is left */
function edit(full, fn) {
  var f = path.join(full, NAME), text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  var lines = text ? text.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  var neu = fn(lines);
  if (neu === null) return false;
  if (!neu.some(function(l){ return l.trim(); })) { try { fs.unlinkSync(f); } catch (e) { if (e.code !== 'ENOENT') throw e; } return true; }
  writeAtomic(f, neu.join('\n') + '\n');
  return true;
}

/* entries -> hidden: {ok, done: [{path, dir, line}], skipped: [already hidden], error} */
function hide(root, items) {
  var done = [], skipped = [];
  for (var i = 0; i < items.length; i++) {
    var rel = String(items[i]), p = fileops.check(root, rel, true, false);
    if (!p) return {ok: false, error: 'not found: ' + rel, done: done, skipped: skipped};
    if (hiddenBy(root, rel)) { skipped.push(rel); continue; }
    var dir = path.dirname(rel), line = lineFor(path.basename(rel));
    edit(path.join(root, dir), function(lines){ return lines.concat([line]); });
    done.push({path: rel, dir: dir, line: line});
  }
  return {ok: true, done: done, skipped: skipped};
}

/* entries hidden by Xplorio's line in their own folder -> shown again: {ok, done: [{path, dir}], still: [{path, dir, pattern}]}.
   still: hidden by another pattern after all (e.g. "*.wav", or a folder above) */
function unhide(root, items) {
  var done = [], still = [];
  for (var i = 0; i < items.length; i++) {
    var rel = String(items[i]), p = fileops.check(root, rel, true, false);
    if (!p) return {ok: false, error: 'not found: ' + rel, done: done, still: still};
    var dir = path.dirname(rel), line = lineFor(path.basename(rel)), name = path.basename(rel);
    var changed = edit(path.join(root, dir), function(lines){
      var keep = lines.filter(function(l){ var t = l.trim(); return t !== line && t !== name; });
      return keep.length === lines.length ? null : keep;
    });
    if (changed) done.push({path: rel, dir: dir});
    var h = hiddenBy(root, rel);
    if (h) still.push({path: rel, dir: h.dir, pattern: h.pattern});
  }
  return {ok: true, done: done, still: still};
}

/* one line of the .mpdignore in folder dir removed (overview). Never the trash's line -> {ok, dir} */
function removeLine(root, dir, pattern) {
  dir = String(dir || ''); pattern = String(pattern || '').trim();
  if (!pattern || pattern === duplicates.TRASH) return {ok: false, error: 'bad pattern'};
  var p = fileops.check(root, dir, false, false);
  if (!p) return {ok: false, error: 'not found'};
  var changed = edit(p.full, function(lines){
    var keep = lines.filter(function(l){ return l.trim() !== pattern; });
    return keep.length === lines.length ? null : keep;
  });
  return changed ? {ok: true, dir: dir} : {ok: false, error: 'not found'};
}

/* all .mpdignore files below the drives (not in hidden folders, not in the trash), with find (fast, reads no file).
   cb({ok, files: [{dir, lines: [{pattern, trash}]}], partial}) ; partial: the search took too long and stopped */
function findAll(root, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  var starts = ['INTERNAL', 'USB', 'NAS'].filter(function(r){ try { return fs.statSync(path.join(root, r)).isDirectory(); } catch (e) { return false; } });
  if (!starts.length) return cb({ok: true, files: [], partial: false});
  var args = ['-L'].concat(starts.map(function(r){ return path.join(root, r); })).concat([
    '(', '-type', 'd', '(', '-name', '.*', '-o', '-name', duplicates.TRASH, '-o', '-name', '$RECYCLE.BIN', '-o', '-name', 'System Volume Information', ')', '-prune', ')',
    '-o', '-name', NAME, '-type', 'f', '-print']);
  cp.execFile('find', args, {timeout: opts.timeout || 60000, maxBuffer: 8 * 1024 * 1024}, function(err, out){
    var partial = !!(err && (err.killed || err.signal));
    var rootReal = path.resolve(root);
    var files = String(out || '').split('\n').filter(Boolean).map(function(f){
      var dir = path.relative(rootReal, path.dirname(f)).split(path.sep).join('/');
      var lines = readPatterns(path.dirname(f)).map(function(pt){ return {pattern: pt, trash: pt === duplicates.TRASH}; });
      return {dir: dir, lines: lines};
    }).filter(function(x){ return x.lines.length && x.dir && !x.dir.split('/').some(function(part){ return part.charAt(0) === '.' || duplicates.isTrash(part); }); });
    files.sort(function(a, b){ return a.dir.localeCompare(b.dir, undefined, {numeric: true, sensitivity: 'base'}); });
    cb({ok: true, files: files, partial: partial});
  });
}

/* folders MPD has to read again: hiding needs the folder holding the .mpdignore (only there MPD drops what it now ignores),
   showing again the entry itself (MPD then reads it in) */
function scanAfterHide(done) {
  return done.map(function(d){ return d.dir; }).filter(function(d, i, all){ return all.indexOf(d) === i; });
}
function scanAfterUnhide(done) {
  return done.map(function(d){ return d.path; }).filter(function(d, i, all){ return all.indexOf(d) === i; });
}

module.exports = {NAME: NAME, lineFor: lineFor, match: match, patterns: patterns, hiddenBy: hiddenBy, mark: mark, hide: hide,
  unhide: unhide, removeLine: removeLine, findAll: findAll, scanAfterHide: scanAfterHide, scanAfterUnhide: scanAfterUnhide};
