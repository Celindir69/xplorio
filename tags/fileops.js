/* File management (menu "Dateien", web/js/files.js): browse the drives below the music root, make folders, copy and move
   files and folders, move them into "Xplorio Trash" (duplicates.js trashPath), delete empty folders.
   Paths are relative to the music root (/mnt), e.g. "USB/S/Beatles/Help/01.flac". Rules:
   - only below INTERNAL, USB/<drive>, NAS/<share>; never into or out of "Xplorio Trash" (that is the Papierkorb's job);
     a symlink must not lead out of its drive;
   - never overwrites: a name that is taken gets " (2)", " (3)" …;
   - moving within a drive is a rename; between drives it is a copy (size checked) and the original then goes into the
     trash of its own drive, so an interrupted copy loses nothing.
   Node 8, ES5 only. */
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var duplicates = require('./duplicates.js');

var ROOTS = ['INTERNAL', 'USB', 'NAS'];
var MAX_LIST = 5000;                                  /* entries shown per folder */
var MAX_ITEMS = 500;                                  /* items per request */
var AUDIO_RE = /\.(flac|mp3|m4a|mp4|m4b|aac|ogg|oga|opus|wav|aiff?|dsf|dff|wv|ape|alac|wma)$/i;

function children(p) { try { return fs.readdirSync(p); } catch (e) { return []; } }
function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function mkdirs(dir) {
  var parts = path.resolve(dir).split(path.sep), cur = '';
  parts.forEach(function(p, i){
    cur = i ? path.join(cur, p) : (p || path.sep);
    try { fs.mkdirSync(cur); } catch (e) { if (!isDir(cur)) throw e; }
  });
}
function rmrf(p) {
  var st;
  try { st = fs.lstatSync(p); } catch (e) { return; }
  if (st.isDirectory()) { children(p).forEach(function(c){ rmrf(path.join(p, c)); }); fs.rmdirSync(p); }
  else fs.unlinkSync(p);
}
/* Mac leftovers: count as nothing in an "empty" folder, never shown */
function macJunk(name) { return name === '.DS_Store' || name.indexOf('._') === 0; }

/* number of path parts of the drive: INTERNAL 1, USB/<x> and NAS/<x> 2 */
function driveParts(parts) { return parts[0] === 'INTERNAL' ? 1 : 2; }
function driveOf(rel) { var p = String(rel).split('/'); return p.slice(0, driveParts(p)).join('/'); }

/* the one check: rel -> {rel, full, drive, parts} or null.
   item: must lie inside a drive (not be the drive itself); missing: may not exist yet */
function check(root, rel, item, missing) {
  if (typeof rel !== 'string' || !rel || rel.length > 4000 || rel.indexOf('\0') >= 0) return null;
  var parts = rel.split('/');
  if (ROOTS.indexOf(parts[0]) < 0) return null;
  var n = driveParts(parts);
  if (parts.length < n + (item ? 1 : 0)) return null;
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..' || duplicates.isTrash(parts[i])) return null;
  }
  var full = path.join(root, rel), drive = parts.slice(0, n).join('/'), driveReal;
  try { driveReal = fs.realpathSync(path.join(root, drive)); } catch (e) { return null; }
  var real;
  try { real = fs.realpathSync(full); }
  catch (e) {
    if (!missing) return null;
    try { real = path.join(fs.realpathSync(path.dirname(full)), path.basename(full)); } catch (x) { return null; }
  }
  if (real !== driveReal && real.indexOf(driveReal + path.sep) !== 0) return null;   /* a symlink leads out of the drive */
  return {rel: rel, full: full, drive: drive, parts: parts};
}

/* a name for a new file or folder: one path part, no hidden name, not the trash */
function goodName(name) {
  return typeof name === 'string' && !!name.trim() && name === name.trim() && name.length <= 200 && !/[\/\0]/.test(name) &&
    name.charAt(0) !== '.' && !duplicates.isTrash(name);
}

/* "Album" -> "Album (2)", "01.flac" -> "01 (2).flac" (folders keep dots in their name) */
function numbered(name, n, dir) {
  var ext = dir ? '' : path.extname(name);
  if (ext.length > 8 || ext === name) ext = '';
  return name.slice(0, name.length - ext.length) + ' (' + n + ')' + ext;
}
/* a free name in folder full; taken: names already given away in this run (lower case) */
function freeName(full, name, dir, taken) {
  var n = 2, cand = name;
  while (exists(path.join(full, cand)) || (taken && taken[cand.toLowerCase()])) cand = numbered(name, n++, dir);
  if (taken) taken[cand.toLowerCase()] = true;
  return cand;
}

/* ---------- listing ---------- */

function cmpName(a, b) { return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}); }

/* '' -> the drives; a folder -> its folders and files.
   -> {ok, path, drives: [{path, name}]} or {ok, path, dirs: [{name, n}], files: [{name, bytes, audio}], more} */
function list(root, rel) {
  if (!rel) {
    var out = [];
    if (isDir(path.join(root, 'INTERNAL'))) out.push({path: 'INTERNAL', name: 'INTERNAL'});
    ['USB', 'NAS'].forEach(function(r){
      children(path.join(root, r)).sort(cmpName).forEach(function(d){
        if (d.charAt(0) !== '.' && isDir(path.join(root, r, d))) out.push({path: r + '/' + d, name: r + '/' + d});
      });
    });
    return {ok: true, path: '', drives: out};
  }
  var p = check(root, rel, false, false);
  if (!p || !isDir(p.full)) return {ok: false, error: 'not found'};
  var dirs = [], files = [], names = children(p.full);
  names.forEach(function(name){
    if (name.charAt(0) === '.' || duplicates.isTrash(name)) return;       /* hidden files, .mpdignore, the trash */
    var st;
    try { st = fs.lstatSync(path.join(p.full, name)); } catch (e) { return; }
    if (st.isSymbolicLink()) {                                             /* only if it stays on the drive */
      if (!check(root, rel + '/' + name, true, false)) return;
      try { st = fs.statSync(path.join(p.full, name)); } catch (e) { return; }
    }
    if (st.isDirectory()) dirs.push({name: name});
    else if (st.isFile()) files.push({name: name, bytes: st.size, audio: AUDIO_RE.test(name), image: /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)});
  });
  dirs.sort(function(a, b){ return cmpName(a.name, b.name); });
  files.sort(function(a, b){ return cmpName(a.name, b.name); });
  var more = dirs.length + files.length > MAX_LIST;
  if (more) { dirs = dirs.slice(0, MAX_LIST); files = files.slice(0, Math.max(0, MAX_LIST - dirs.length)); }
  return {ok: true, path: rel, dirs: dirs, files: files, more: more};
}

/* an image for the preview: rel -> {ok, full, mime, bytes} or {ok: false, error} */
var IMAGE_TYPES = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp'};
var MAX_IMAGE = 20 * 1024 * 1024;
function image(root, rel) {
  var p = check(root, rel, true, false), ext = (/\.([a-z]+)$/i.exec(String(rel)) || [])[1];
  var mime = ext && IMAGE_TYPES[ext.toLowerCase()];
  if (!p || !mime) return {ok: false, error: 'not found'};
  var st;
  try { st = fs.statSync(p.full); } catch (e) { return {ok: false, error: 'not found'}; }
  if (!st.isFile()) return {ok: false, error: 'not found'};
  if (st.size > MAX_IMAGE) return {ok: false, error: 'too large'};
  return {ok: true, full: p.full, mime: mime, bytes: st.size};
}

/* ---------- simple operations ---------- */

/* new folder name in dest -> {ok, path} */
function mkdir(root, dest, name) {
  var d = check(root, dest, false, false);
  if (!d || !isDir(d.full)) return {ok: false, error: 'not found'};
  if (!goodName(name)) return {ok: false, error: 'bad name'};
  if (exists(path.join(d.full, name))) return {ok: false, error: 'exists'};
  fs.mkdirSync(path.join(d.full, name));
  return {ok: true, path: dest + '/' + name};
}

/* delete an empty folder (Mac leftovers in it go along) -> {ok} */
function rmdir(root, rel) {
  var p = check(root, rel, true, false);
  if (!p || !isDir(p.full)) return {ok: false, error: 'not found'};
  var left = children(p.full);
  if (left.some(function(c){ return !macJunk(c); })) return {ok: false, error: 'not empty'};
  left.forEach(function(c){ fs.unlinkSync(path.join(p.full, c)); });
  fs.rmdirSync(p.full);
  return {ok: true};
}

/* items into "Xplorio Trash" of their drive, with the rest of the path -> {ok, moved: [{from, to}], error} */
function toTrash(root, items) {
  var moved = [];
  for (var i = 0; i < items.length; i++) {
    var p = check(root, items[i], true, false);
    if (!p) return {ok: false, error: 'not found: ' + items[i], moved: moved};
    var dir = isDir(p.full), base = duplicates.trashPath(items[i]);
    var to = path.dirname(base) + '/' + freeName(path.join(root, path.dirname(base)), path.basename(base), dir);
    mkdirs(path.dirname(path.join(root, to)));
    fs.renameSync(p.full, path.join(root, to));
    moved.push({from: items[i], to: to, dir: dir});
  }
  return {ok: true, moved: moved};
}

/* ---------- copy and move ---------- */

/* items into folder dest -> {ok, steps: [{from, to, dir, cross}], skipped} or {ok: false, error}.
   Items inside another item of the list are left out (they go along with it). */
function plan(root, items, dest, mode) {
  if (mode !== 'copy' && mode !== 'move') return {ok: false, error: 'bad mode'};
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return {ok: false, error: 'items missing or too many'};
  var d = check(root, dest, false, false);
  if (!d || !isDir(d.full)) return {ok: false, error: 'target not found'};
  items = items.map(String).filter(function(x, i, all){ return all.indexOf(x) === i; });
  items = items.filter(function(x){ return !items.some(function(y){ return y !== x && x.indexOf(y + '/') === 0; }); });
  var steps = [], skipped = [], taken = {};
  for (var i = 0; i < items.length; i++) {
    var p = check(root, items[i], true, false);
    if (!p) return {ok: false, error: 'not found: ' + items[i]};
    var dir = isDir(p.full);
    if (dest === items[i] || dest.indexOf(items[i] + '/') === 0) return {ok: false, error: 'into itself: ' + items[i]};
    if (mode === 'move' && path.dirname(items[i]) === dest) { skipped.push(items[i]); continue; }   /* already there */
    var name = freeName(d.full, path.basename(items[i]), dir, taken);
    steps.push({from: items[i], to: dest + '/' + name, dir: dir, cross: p.drive !== d.drive});
  }
  if (!steps.length) return {ok: false, error: 'nothing to do'};
  return {ok: true, steps: steps, skipped: skipped};
}

/* files and folders below a folder (relative), folders first */
function walk(full, pre, out) {
  out = out || {dirs: [], files: []};
  children(full).forEach(function(c){
    var f = path.join(full, c), r = pre ? pre + '/' + c : c, st;
    try { st = fs.lstatSync(f); } catch (e) { return; }
    if (st.isDirectory()) { out.dirs.push(r); walk(f, r, out); }
    else if (st.isFile() && !macJunk(c)) out.files.push({rel: r, bytes: st.size});
  });
  return out;
}

/* copy one file: to a hidden temporary name next to the target, then renamed (never over an existing file).
   With "ionice -c3 cp" if there (idle priority on the disk), else with Node streams */
var useCp = process.platform === 'linux';
function copyFile(from, to, cb) {
  var tmp = path.join(path.dirname(to), '.xplorio-copy-' + process.pid + '-' + path.basename(to));
  function done(e) {
    if (!e) {
      try {
        if (fs.statSync(tmp).size !== fs.statSync(from).size) e = new Error('size differs after copying');
        else if (exists(to)) e = new Error('exists');
        else fs.renameSync(tmp, to);
      } catch (x) { e = x; }
    }
    if (e) { try { fs.unlinkSync(tmp); } catch (x) { /* none */ } }
    cb(e || null);
  }
  function streams() {
    var ended = false;
    function end(e) { if (!ended) { ended = true; done(e); } }
    var rd = fs.createReadStream(from), wr = fs.createWriteStream(tmp, {flags: 'wx'});
    rd.on('error', end); wr.on('error', end); wr.on('close', function(){ end(null); });
    rd.pipe(wr);
  }
  if (!useCp) return streams();
  if (exists(tmp)) { try { fs.unlinkSync(tmp); } catch (e) { /* stays, cp then fails */ } }
  cp.execFile('ionice', ['-c3', 'cp', '--', from, tmp], {timeout: 3600000}, function(e, so, se){
    if (e && e.code === 'ENOENT') { useCp = false; return streams(); }   /* no ionice: Node streams from now on */
    if (e) return done(new Error(String(se || e.message).trim().split('\n').pop()));
    done(null);
  });
}

/* run planned steps. hooks: progress(job) after every file, cancelled() -> true to stop between files,
   toTrash(rel) -> {to} (original after a copy between drives; default: toTrash above).
   cb(job): job = {done: [{from, to, dir, trashed}], errors: [{from, error}], files, filesDone, bytes, bytesDone, current} */
function run(root, steps, mode, hooks, cb) {
  hooks = hooks || {};
  var job = {done: [], errors: [], files: 0, filesDone: 0, bytes: 0, bytesDone: 0, current: ''};
  var trees = steps.map(function(s){
    var full = path.join(root, s.from);
    if (mode === 'move' && !s.cross) return null;                                  /* a rename: nothing to copy */
    if (!s.dir) { var b = 0; try { b = fs.statSync(full).size; } catch (e) { /* gone */ } return {dirs: [], files: [{rel: '', bytes: b}]}; }
    return walk(full, '');
  });
  trees.forEach(function(t){ if (t) t.files.forEach(function(f){ job.files++; job.bytes += f.bytes; }); });
  function progress() { if (hooks.progress) hooks.progress(job); }
  var i = 0;
  (function nextStep() {
    if (i >= steps.length) { job.current = ''; return cb(job); }
    if (hooks.cancelled && hooks.cancelled()) { job.cancelled = true; job.current = ''; return cb(job); }
    var s = steps[i], t = trees[i++], src = path.join(root, s.from), dst = path.join(root, s.to);
    job.current = s.from;
    progress();
    if (!t) {                                                                         /* move on the same drive */
      try {
        if (exists(dst)) throw new Error('exists');
        mkdirs(path.dirname(dst));
        fs.renameSync(src, dst);
        job.done.push({from: s.from, to: s.to, dir: s.dir});
        return nextStep();
      } catch (e) {
        if (e.code !== 'EXDEV') { job.errors.push({from: s.from, error: errText(e, s)}); return nextStep(); }
        t = trees[i - 1] = s.dir ? walk(src, '') : {dirs: [], files: [{rel: '', bytes: fs.statSync(src).size}]};   /* another file system after all */
        t.files.forEach(function(f){ job.files++; job.bytes += f.bytes; });
      }
    }
    copyTree(s, t, src, dst, function(err){
      if (err) {
        try { rmrf(dst); } catch (e) { /* half a copy stays; the name was free before */ }
        job.errors.push({from: s.from, error: errText(err, s)});
        return nextStep();
      }
      var entry = {from: s.from, to: s.to, dir: s.dir};
      if (mode === 'move') {
        try { entry.trashed = (hooks.toTrash ? hooks.toTrash(s.from) : toTrash(root, [s.from]).moved[0]).to; }
        catch (e) { job.errors.push({from: s.from, error: 'copied, but the original stays: ' + errText(e, s)}); entry.copyOnly = true; }
      }
      job.done.push(entry);
      nextStep();
    });
  })();

  function copyTree(s, t, src, dst, done) {
    try {
      if (exists(dst)) throw new Error('exists');
      if (s.dir) { mkdirs(dst); t.dirs.forEach(function(d){ mkdirs(path.join(dst, d)); }); }
      else mkdirs(path.dirname(dst));
    } catch (e) { return done(e); }
    var k = 0;
    (function nextFile() {
      if (k >= t.files.length) return done(null);
      if (hooks.cancelled && hooks.cancelled()) return done(new Error('cancelled'));
      var f = t.files[k++];
      var from = f.rel ? path.join(src, f.rel) : src, to = f.rel ? path.join(dst, f.rel) : dst;
      job.current = f.rel ? s.from + '/' + f.rel : s.from;
      copyFile(from, to, function(e){
        if (e) return done(e);
        job.filesDone++; job.bytesDone += f.bytes;
        progress();
        nextFile();
      });
    })();
  }
}

function errText(e, s) {
  if (e && (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS')) return 'no write permission: /mnt/' + s.to.split('/').slice(0, -1).join('/');
  if (e && e.code === 'ENOSPC') return 'drive full: /mnt/' + driveOf(s.to);
  return (e && e.message) || String(e);
}

/* ---------- after a move: paths in Xplorio's own data ---------- */

/* key "USB/S/A/1.flac" with moves [{from: 'USB/S/A', to: 'NAS/N/A'}] -> "NAS/N/A/1.flac"; null if not affected */
function moveKey(key, moves) {
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    if (key === m.from) return m.to;
    if (key.indexOf(m.from + '/') === 0) return m.to + key.slice(m.from.length);
  }
  return null;
}
/* the same for keys made of parts ("dupt|USB/S/A|x"), and for Volumio URIs ("mnt/USB/…", "music-library/USB/…") */
function movePartsKey(key, moves) {
  var changed = false, parts = String(key).split('|').map(function(p){
    var pre = /^(\/?mnt\/|music-library\/)/.exec(p), bare = pre ? p.slice(pre[0].length) : p, n = moveKey(bare, moves);
    if (n === null) return p;
    changed = true;
    return (pre ? pre[0] : '') + n;
  });
  return changed ? parts.join('|') : null;
}
/* object with path keys: moved keys renamed (an existing key with the new name stays) -> number changed */
function moveObjectKeys(obj, moves) {
  var n = 0;
  Object.keys(obj || {}).forEach(function(k){
    var nk = movePartsKey(k, moves);
    if (nk === null || nk === k) return;
    if (!Object.prototype.hasOwnProperty.call(obj, nk)) obj[nk] = obj[k];
    delete obj[k];
    n++;
  });
  return n;
}

/* folders MPD has to read again: the old places (gone) and the new ones. Folders exactly; a file by its folder,
   unless that is the drive itself (a whole drive would be read again), then the file */
function scanPaths(changes) {
  var out = [];
  changes.forEach(function(c){
    var p = c.dir ? c.path : path.dirname(c.path);
    if (!c.dir && driveOf(c.path) === p) p = c.path;
    if (out.indexOf(p) < 0) out.push(p);
  });
  return out.filter(function(p){ return !out.some(function(q){ return q !== p && p.indexOf(q + '/') === 0; }); });
}

module.exports = {MAX_ITEMS: MAX_ITEMS, image: image, check: check, goodName: goodName, freeName: freeName, numbered: numbered, list: list,
  mkdir: mkdir, rmdir: rmdir, toTrash: toTrash, plan: plan, run: run, copyFile: copyFile, moveKey: moveKey,
  movePartsKey: movePartsKey, moveObjectKeys: moveObjectKeys, scanPaths: scanPaths, driveOf: driveOf,
  setUseCp: function(on){ useCp = !!on; }};
