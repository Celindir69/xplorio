/* Tag service: reads and writes tags of audio files (m4a, flac, mp3, dsf).
   HTTP, port 8766. Runs on Node 8 (ES5 syntax only). The actual work is done by tags.py (Python 2.7/3 + mutagen). */
var http  = require('http');
var fs    = require('fs');
var path  = require('path');
var cp    = require('child_process');
var url   = require('url');
var vm    = require('vm');

var HTTP_PORT   = parseInt(process.env.HTTP_PORT || '8766', 10);
var MUSIC_ROOT  = process.env.MUSIC_ROOT  || '/mnt';
/* Volumio 2: python (2.7); Volumio 4 (Debian 12) only has python3 */
var PYTHON      = process.env.PYTHON      || (['/usr/bin/python', '/usr/local/bin/python'].some(function(p){
  try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) ? 'python' : 'python3');
var MPC         = process.env.MPC         || 'mpc';
/* data folder /data/xplorio/data (see appdata.js) */
var appdata     = require('./appdata.js');
var guard       = require('./guard.js');
var writeAtomic = require('./atomic.js').writeAtomic;      /* power cut: old or new file, never half of one */
var DATA_PREP   = process.env.TAGS_LOG ? {dir: path.dirname(process.env.TAGS_LOG)}
  : appdata.prepare(process.env.TAGS_DATA || '/data/xplorio/data', console.log);
var DATA_DIR    = DATA_PREP.dir;
var LOG_FILE    = process.env.TAGS_LOG    || path.join(DATA_DIR, 'changes.jsonl');
var MPD_HOST    = process.env.MPD_HOST    || 'localhost';
var MPD_PORT    = parseInt(process.env.MPD_PORT || '6600', 10);
var SCRIPT      = path.join(__dirname, 'tags.py');
var ROOTS       = ['INTERNAL', 'USB', 'NAS'];            /* allowed folders below MUSIC_ROOT */
var EXT_RE      = /\.(m4a|mp4|m4b|flac|mp3|dsf)$/i;
var MAX_ITEMS   = 500;                                   /* files per request */
var MAX_ARTIST  = 3000;                                  /* files per artist (/artist) */
var PY_BATCH    = 20;                                    /* files per Python call */
var MAX_BODY    = 12 * 1024 * 1024;                     /* cover images are sent along as base64 */
var JOB_TIMEOUT = 180000;
var KILL_GRACE  = 120000;                               /* after SIGTERM: time the current file may take to finish */
var COVER_DIR   = path.join(DATA_DIR, 'covers');   /* backups of old covers (for undo) */
var FOLDER_JPG  = 'folder.jpg';

/* ---------- Paths ---------- */

/* the one check for every path below the music folder: relative path ("USB/Drive/Album/…") -> {full} if it is a clean path
   below INTERNAL/USB/NAS that also stays there after symlinks; {full, missing} if it does not exist; null if not allowed.
   minParts: at least that many path parts; noTrash: no part may be the duplicates folder */
function libPath(rel, minParts, noTrash) {
  if (typeof rel !== 'string' || !rel || rel.indexOf('\0') >= 0) return null;
  var parts = rel.split('/');
  if (ROOTS.indexOf(parts[0]) < 0 || parts.length < (minParts || 2)) return null;
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..' || (noTrash && duplicates.isTrash(parts[i]))) return null;
  }
  var full = path.join(MUSIC_ROOT, rel), real, root;
  try { real = fs.realpathSync(full); } catch (e) { return {full: full, missing: true}; }
  try { root = fs.realpathSync(path.join(MUSIC_ROOT, parts[0])); } catch (e) { return null; }
  if (real.indexOf(root + path.sep) !== 0) return null;   /* symlink leads out of INTERNAL/USB/NAS */
  return {full: full};
}

/* Volumio URI ("USB/Folder/x.flac", "music-library/USB/…", "/mnt/USB/…") -> absolute path; null if not allowed */
function resolveUri(uri) {
  if (typeof uri !== 'string') return null;
  var rel = uri.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
  if (!EXT_RE.test(rel)) return null;
  var p = libPath(rel, 2, false);
  return p && (p.missing ? {rel: rel, full: p.full, missing: true} : {rel: rel, full: p.full});
}

/* ---------- Calling tags.py (only one job at a time; the CM3 has little memory) ---------- */

var queue = [], busy = false;

function runPy(job, cb) {
  queue.push({job: job, cb: cb});
  next();
}

/* several jobs, PY_BATCH per Python call; cb(results) in the same order */
function runPyMany(jobs, cb) {
  var out = [], i = 0;
  (function step() {
    if (i >= jobs.length) return cb(out);
    var chunk = jobs.slice(i, i + PY_BATCH);
    i += chunk.length;
    runPy({op: 'batch', jobs: chunk}, function(r){
      chunk.forEach(function(j, k){
        out.push(r.ok && r.results && r.results[k] ? r.results[k] : {ok: false, error: r.error || 'no response'});
      });
      step();
    });
  })();
}
function next() {
  if (busy || !queue.length) return;
  busy = true;
  var q = queue.shift();
  var child = cp.spawn(PYTHON, [SCRIPT], {stdio: ['pipe', 'pipe', 'pipe']});
  var out = '', err = '', done = false;
  function finish(res) {
    if (done) return;
    done = true; clearTimeout(timer); busy = false;
    q.cb(res); next();
  }
  var limit = Math.max(JOB_TIMEOUT, (q.job.jobs ? q.job.jobs.length : 1) * 30000);   /* rewriting m4a can take a while per file */
  /* timeout: ask first (tags.py finishes the current file and reports what is done),
     kill hard only if it still hangs after that */
  var timer = setTimeout(function(){
    try { child.kill('SIGTERM'); } catch (e) { /* already ended */ }
    timer = setTimeout(function(){
      try { child.kill('SIGKILL'); } catch (e) { /* already ended */ }
      finish({ok: false, error: 'timeout'});
    }, KILL_GRACE);
  }, limit);
  child.stdout.on('data', function(d){ out += d; });
  child.stderr.on('data', function(d){ err += d; });
  child.on('error', function(e){ finish({ok: false, error: 'cannot start Python: ' + e.message}); });
  child.on('close', function(){
    var res;
    try { res = JSON.parse(out); } catch (e) { res = {ok: false, error: (err || 'no response from tags.py').trim().split('\n').pop()}; }
    if (!res.ok && /permission denied|read-only/i.test(res.error || '')) {
      res.error += ' (no write permission on the drive)';
    }
    finish(res);
  });
  child.stdin.on('error', function(){});
  child.stdin.end(JSON.stringify(q.job));
}

/* ---------- Change log (for undo) ---------- */

var logAppends = 0;
function logEntry(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE));
  } catch (e) { /* already exists */ }
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n'); } catch (e) { return false; }
  if (++logAppends % 500 === 0) setTimeout(pruneLog, 0);
  return true;
}

/* limit the log and cover backups: only the last KEEP_BATCHES jobs stay undoable
   (the UI only offers undo for the last one anyway) */
var KEEP_BATCHES = 200;
function pruneLog() {
  var list = readLog(), order = [], seen = {};
  list.forEach(function(e){ if (e.batch && !seen[e.batch]) { seen[e.batch] = true; order.push(e.batch); } });
  var keep = {};
  order.slice(-KEEP_BATCHES).forEach(function(b){ keep[b] = true; });
  if (order.length > KEEP_BATCHES) {
    try {
      fs.writeFileSync(LOG_FILE + '.neu', list.filter(function(e){ return keep[e.batch]; })
        .map(function(e){ return JSON.stringify(e) + '\n'; }).join(''));
      fs.renameSync(LOG_FILE + '.neu', LOG_FILE);
    } catch (e) { console.error('log not pruned: ' + e.message); return; }
  }
  var dirs;
  try { dirs = fs.readdirSync(COVER_DIR); } catch (e) { return; }
  dirs.forEach(function(d){
    if (keep[d] || !BATCH_RE.test(d)) return;
    var full = path.join(COVER_DIR, d);
    try {
      if (Date.now() - fs.statSync(full).mtime.getTime() < 3600000) return;   /* job may still be running */
      fs.readdirSync(full).forEach(function(f){ fs.unlinkSync(path.join(full, f)); });
      fs.rmdirSync(full);
    } catch (e) { /* next time */ }
  });
}
function readLog() {
  var txt;
  try { txt = fs.readFileSync(LOG_FILE, 'utf8'); } catch (e) { return []; }
  var list = [];
  txt.split('\n').forEach(function(line){
    if (!line) return;
    try { list.push(JSON.parse(line)); } catch (e) { /* skip broken line */ }
  });
  return list;
}

/* ---------- MPD: rescan changed folders ---------- */

/* Every "mpc update" makes Volumio rebuild its whole album list (about 1 min of load). So scan as few folders
   as possible: the common parent folder as long as it is at least 3 levels deep
   (e.g. USB/MX-Media/AllFlac), otherwise the individual folders. If those are more than SCAN_MAX_DIRS (genre changed
   across many albums), use the common parent anyway, if need be the whole library (''): one scan instead of many. */
var SCAN_MAX_DIRS = 3;
var SCAN_QUIET = 15000;          /* wait this long after the last change, then scan all collected folders at once */
function scanDirs(relFiles) {
  var dirs = {};
  relFiles.forEach(function(r){ dirs[path.dirname(r)] = true; });
  var list = Object.keys(dirs);
  if (list.length < 2) return list;
  var common = list[0].split('/');
  list.forEach(function(d){
    var p = d.split('/'), k = 0;
    while (k < common.length && k < p.length && common[k] === p[k]) k++;
    common = common.slice(0, k);
  });
  return common.length >= 3 || list.length > SCAN_MAX_DIRS ? [common.join('/')] : list;
}

/* Collect rescans: changes in quick succession (bulk editor, library check, undo) result in one scan,
   SCAN_QUIET after the last one; never while MPD is still scanning. The response does not wait for the scan,
   cb(ok) reports whether the last "mpc update" succeeded.
   Hold (POST /scan {hold:true}, while the library check is open): only collect, the scan runs on
   release ({hold:false}); if that never comes (page closed), at the latest SCAN_HOLD_MAX after the last change. */
var SCAN_HOLD_MAX = 10 * 60000;
var scanPending = [], scanTimer = null, scanRunning = false, scanOk = true, scanHold = false;
var scanExact = [];              /* folders scanned exactly as they are, never merged into a parent (moved duplicates) */
var scanAll = false;             /* scan the whole library (button in the library check), even while holding */
function mpdUpdate(relFiles, cb) {
  scanPending = scanPending.concat(relFiles);
  scanSchedule(scanHold ? SCAN_HOLD_MAX : SCAN_QUIET, scanHold);
  cb(scanOk);
}
/* folders that are gone (moved aside into Xplorio Trash): MPD forgets them when exactly their path is updated. Never merged
   into a parent folder: on a large NTFS drive a scan of the whole drive overloads the player */
function mpdForget(relDirs, cb) {
  scanExact = scanExact.concat(relDirs);
  scanSchedule(scanHold ? SCAN_HOLD_MAX : SCAN_QUIET, scanHold);
  cb(scanOk);
}
function scanWaiting() { return scanPending.length + scanExact.length; }
function scanSchedule(ms, release) {               /* release: hold ends (maximum duration reached) */
  clearTimeout(scanTimer);
  scanTimer = setTimeout(function(){ if (release) scanHold = false; scanRun(); }, ms);
}
function scanSetHold(on) {
  scanHold = !!on;
  if (scanHold) { if (scanWaiting()) scanSchedule(SCAN_HOLD_MAX, true); else { clearTimeout(scanTimer); scanTimer = null; } }
  else if (scanWaiting()) scanSchedule(0);
}
/* after our own scan: "mpc update" only starts it, MPD reads on in the background. Wait until it is done, then give
   Volumio time for its own album list, then rebuild ours without waiting for quiet (genres, random album, versions).
   Meanwhile GET /scan reports building, so the symbol in the top bar stays until the new list is there */
var albumAfterTimer = null;
function albumsAfterScan(n) {
  clearTimeout(albumAfterTimer);
  albumSoonUntil = Date.now() + ALBUMS_AFTER_SCAN_MS + 10000;
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'status', function(err, st){
    if (!err && st.updating_db && n < 1440) {          /* still reading (at most 2 hours) */
      albumAfterTimer = setTimeout(function(){ albumsAfterScan(n + 1); }, 5000);
    } else {
      albumSoonUntil = Date.now() + ALBUMS_AFTER_SCAN_MS + 5000;   /* meanwhile Volumio rebuilds its own album list */
      albumAfterTimer = setTimeout(function(){ albumChecked = 0; albumsEnsure(null, true); }, ALBUMS_AFTER_SCAN_MS);
    }
    if (albumAfterTimer.unref) albumAfterTimer.unref();
  });
}
function scanRun() {
  scanTimer = null;
  if (scanRunning || (scanHold && !scanAll) || (!scanWaiting() && !scanAll)) return;
  scanRunning = true;
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'status', function(err, st){
    if (!err && st.updating_db) { scanRunning = false; scanSchedule(SCAN_QUIET); return; }
    var list = scanAll ? [''] : scanDirs(scanPending);
    if (!scanAll) list = list.concat(scanExact.filter(function(d, i, all){           /* unless a scan above already covers it */
      return all.indexOf(d) === i && !list.some(function(l){ return l === '' || d === l || d.indexOf(l + '/') === 0; });
    }));
    scanPending = []; scanExact = []; scanAll = false;
    (function step() {
      if (!list.length) {
        scanRunning = false;
        albumsAfterScan(0);
        if (scanWaiting() && !scanTimer) scanSchedule(scanHold ? SCAN_HOLD_MAX : SCAN_QUIET, scanHold);
        return;
      }
      var d = list.shift();
      cp.execFile(MPC, d ? ['update', d] : ['update'], {timeout: 15000}, function(e){ scanOk = !e; step(); });
    })();
  });
}

/* ---------- Jobs ---------- */

function mapSeq(items, fn, cb) {
  var res = [], i = 0;
  (function step() {
    if (i >= items.length) return cb(res);
    fn(items[i], function(r){ res.push(r); i++; step(); });
  })();
}

function doRead(body, cb) {
  var uris = body.uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_ITEMS) return cb(400, {ok: false, error: 'uris missing or too many'});
  var items = new Array(uris.length), jobs = [], at = [];
  uris.forEach(function(uri, k){
    var p = resolveUri(uri);
    if (!p || p.missing) items[k] = {uri: uri, ok: false, error: p ? 'file not found' : 'path not allowed'};
    else { jobs.push({op: 'read', path: p.full}); at.push(k); }
  });
  runPyMany(jobs, function(rs){
    rs.forEach(function(r, k){ r.uri = uris[at[k]]; items[at[k]] = r; });
    cb(200, {ok: true, items: items});
  });
}

var BATCH_RE = /^[a-z0-9]{6,16}$/;

/* POST /write {items:[{uri, tags}], batch?, scan?}
   batch: pass an ID so that several requests are undone together;
   scan:false: do not let MPD rescan (a final /scan does that later) */
function doWrite(body, cb) {
  var items = body.items;
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return cb(400, {ok: false, error: 'items missing or too many'});
  if (body.batch !== undefined && !BATCH_RE.test(String(body.batch))) return cb(400, {ok: false, error: 'invalid batch'});
  writeItems(items, body.batch || newBatch(), body.scan !== false, cb);
}

function writeItems(items, batch, scan, cb) {
  var results = new Array(items.length), jobs = [], at = [], paths = [], changedRel = [];
  items.forEach(function(it, k){
    var p = resolveUri(it && it.uri);
    if (!p || p.missing) results[k] = {uri: it && it.uri, ok: false, error: p ? 'file not found' : 'path not allowed'};
    else { jobs.push({op: 'write', path: p.full, tags: it.tags || {}}); at.push(k); paths.push(p); }
  });
  runPyMany(jobs, function(rs){
    rs.forEach(function(r, k){
      var it = items[at[k]];
      r.uri = it.uri;
      if (r.ok && r.changed) {
        changedRel.push(paths[k].rel);
        if (r.after && r.after.comment !== undefined) nomixStore.noteComment(paths[k].rel, r.after.comment);   /* NoMix */
        if (!logEntry({batch: batch, time: new Date().toISOString(), uri: it.uri, before: r.before, after: r.after})) r.logWarning = true;
      }
      results[at[k]] = r;
    });
    if (!changedRel.length) return cb(200, {ok: true, batch: null, items: results, scan: null});
    if (!scan) return cb(200, {ok: true, batch: batch, items: results, scan: null});
    mpdUpdate(changedRel, function(scanned){ cb(200, {ok: true, batch: batch, items: results, scan: scanned}); });
  });
}

/* POST /scan {uris}: let MPD rescan changed files (after several /write with scan:false);
   POST /scan {hold:true|false}: hold back scans, or scan everything collected now (see mpdUpdate);
   POST /scan {all:true}: scan the whole library now (like "Update library" in Volumio) */
function doScan(body, cb) {
  if (body.all === true) {                                 /* everything collected is covered by this one scan */
    scanAll = true;
    clearTimeout(scanTimer); scanTimer = null;
    scanRun();
    return cb(200, {ok: true, scan: true});
  }
  if (typeof body.hold === 'boolean') { scanSetHold(body.hold); return cb(200, {ok: true, hold: scanHold, pending: scanWaiting()}); }
  var rel = [];
  (Array.isArray(body.uris) ? body.uris : []).forEach(function(u){ var p = resolveUri(u); if (p && !p.missing) rel.push(p.rel); });
  if (!rel.length) return cb(400, {ok: false, error: 'uris missing'});
  mpdUpdate(rel, function(scanned){ cb(200, {ok: true, scan: scanned}); });
}

/* GET /scan: is MPD scanning right now? {ok, updating, pending, building} (progress for the button in the library check,
   symbol in the top bar); building: the album lists are being rebuilt after a scan (Volumio's and ours) */
function doScanGet(cb) {
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'status', function(err, st){
    if (err) return cb(200, {ok: false, error: 'MPD: ' + err.message});
    cb(200, {ok: true, updating: !!st.updating_db || scanRunning || scanAll, pending: scanWaiting(),
             building: albumBuilding || Date.now() < albumSoonUntil});
  });
}

/* GET /artist?name=…: all files whose artist or album artist matches the name
   (ignoring case and surrounding whitespace), via MPD.
   With &tracks=1 instead all search hits with title and album (artist page: tracks without their own album). */
function doArtist(query, cb) {
  var name = String(query.name || '').trim();
  if (!name) return cb(400, {ok: false, error: 'name missing'});
  var me = name.toLowerCase(), seen = {}, files = [], tracks = [], withTracks = query.tracks === '1';
  function search(tag, done) {
    cp.execFile(MPC, ['-f', '%file%\t[%artist%]\t[%albumartist%]\t[%title%]\t[%album%]', 'search', tag, name], {timeout: 30000, maxBuffer: 32 * 1024 * 1024}, function(e, out){
      if (e) return done(e);
      String(out).split('\n').forEach(function(line){
        var f = line.split('\t');
        if (!f[0] || seen[f[0]]) return;
        if (withTracks) {                                    /* partial matches ("A feat. B") are filtered by the browser */
          seen[f[0]] = true;
          tracks.push({file: f[0], artist: f[1] || '', albumartist: f[2] || '', title: f[3] || '', album: f[4] || ''});
          return;
        }
        if ((f[1] || '').trim().toLowerCase() !== me && (f[2] || '').trim().toLowerCase() !== me) return;
        seen[f[0]] = true;
        files.push(f[0]);
      });
      done();
    });
  }
  search('artist', function(e1){
    search('albumartist', function(e2){
      if (e1 && e2) return cb(500, {ok: false, error: 'MPD search failed: ' + e1.message});
      if (withTracks) return cb(200, {ok: true, tracks: tracks.slice(0, MAX_ARTIST)});
      files = files.filter(function(f){ var p = resolveUri(f); return p && !p.missing; }).sort();
      if (files.length > MAX_ARTIST) return cb(200, {ok: false, error: 'too many files (' + files.length + ', at most ' + MAX_ARTIST + ')'});
      cb(200, {ok: true, files: files});
    });
  });
}

/* ---------- Library check ---------- */
/* POST /check starts the check in the background, GET /check returns progress and the last result.
   The result stays in check.json next to the change log until the next check. */
var libcheck = require('./libcheck.js');
var batchSeq = 0;
function newBatch() { return Date.now().toString(36) + (++batchSeq % 1296).toString(36); }   /* two jobs in the same ms: different IDs */
var CHECK_FILE = path.join(DATA_DIR, 'check.json');
function writeCheck(obj) { writeAtomic(CHECK_FILE, JSON.stringify(obj)); checkCache = null; }
/* last result (can be several MB): reread only when the file has changed; null = never checked */
var checkCache = null, checkStamp = '', checkUsed = 0;
var CHECK_IDLE_MS = 5 * 60 * 1000;   /* then the parsed result leaves memory again (often 10+ MB on a 1 GB player) */
function checkFileStamp() {
  try { var st = fs.statSync(CHECK_FILE); return st.mtime.getTime() + ':' + st.size; } catch (e) { return ''; }
}
setInterval(function(){ if (checkCache && Date.now() - checkUsed > CHECK_IDLE_MS) checkCache = null; }, 60000).unref();
function readCheck() {
  var stamp = checkFileStamp();
  if (!stamp) return null;
  checkUsed = Date.now();
  if (checkCache && stamp === checkStamp) return checkCache;
  try { checkCache = JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8')); checkStamp = stamp; } catch (e) { checkCache = null; }
  if (checkCache) {                                      /* handled entries of this run (check-done.json) */
    var d = null;
    try { d = JSON.parse(fs.readFileSync(CHECK_DONE_FILE, 'utf8')); } catch (e) { /* none yet */ }
    if (d && d.at === checkCache.at && d.done && typeof d.done === 'object') {
      checkCache.done = checkCache.done || {};
      Object.keys(d.done).forEach(function(k){ checkCache.done[k] = 1; });
    }
  }
  return checkCache;
}
/* remember entries as handled: in a small file of their own, so that a tap on a pen does not rewrite the result (MBs) */
var CHECK_DONE_FILE = path.join(DATA_DIR, 'check-done.json');
function markDone(last, keys) {
  last.done = last.done || {};
  keys.forEach(function(k){ last.done[k] = 1; });
  try { writeAtomic(CHECK_DONE_FILE, JSON.stringify({at: last.at, done: last.done})); return true; }
  catch (e) { console.error('check-done.json: ' + e.message); return false; }
}
var checkRun = null;                                     /* {phase, done, total, started} while checking */
var checkError = null;

function doCheckStart(body, cb) {
  if (checkRun) return cb(200, {ok: true, running: checkRun});
  checkRun = {phase: 'mpd', done: 0, total: 0, started: Date.now()};
  checkError = null;
  cb(200, {ok: true, running: checkRun});
  libcheck.mpdWalk({host: MPD_HOST, port: MPD_PORT}, function(err, songs){
    if (err) { checkError = 'MPD: ' + err.message; checkRun = null; return; }
    checkRun.phase = 'cover';
    var cache = new filecheck.Cache(CHECK_FILES).load();
    libcheck.dirsWithoutImage(songs, MUSIC_ROOT, function(cand, images){
      checkFiles(songs, images, cache, function(extra){ checkCovers(songs, cand, cache, extra); });
    });
  }, function(done, total){ checkRun.done = done; checkRun.total = total; });
}
/* what the last check read about each file and folder (check-files.json): unchanged ones are not read again */
var CHECK_FILES = path.join(DATA_DIR, 'check-files.json');
var filecheck = require('./filecheck.js');
/* ID3 block of DSF files and pixel size of the cover images, from the cache when unchanged -> cb({dsfTag, cover}) */
function checkFiles(songs, images, cache, cb) {
  var dsf = {}, covers = {}, jobs = [];
  songs.forEach(function(s){
    if (!/\.dsf$/i.test(s.file)) return;
    var c = cache.get('f', s.file, s['last-modified'], 'dsf');
    if (c) dsf[s.file] = c.v; else jobs.push({kind: 'dsf', s: s});
  });
  Object.keys(images).forEach(function(d){ jobs.push({kind: 'img', d: d, name: images[d]}); });
  checkRun.phase = 'files'; checkRun.done = 0; checkRun.total = jobs.length;
  var i = 0;
  (function next() {
    if (i >= jobs.length) {
      return cb({dsfTag: function(f){ return dsf[f] || 0; }, cover: function(d){ return covers[d] || null; }});
    }
    var j = jobs[i++];
    checkRun.done = i;
    function go() { if (i % 50) next(); else setImmediate(next); }
    if (j.kind === 'dsf') {
      return filecheck.dsfTagSize(path.join(MUSIC_ROOT, j.s.file), function(n){
        dsf[j.s.file] = n; cache.put('f', j.s.file, j.s['last-modified'], 'dsf', n); go();
      });
    }
    var f = path.join(MUSIC_ROOT, j.d, j.name);
    fs.stat(f, function(e, st){
      if (e) return go();
      var stamp = j.name + ':' + st.size + ':' + st.mtime.getTime(), c = cache.get('d', j.d, stamp, 'img');
      if (c) { covers[j.d] = c.v; return go(); }
      filecheck.imageSize(f, function(dim){
        var v = {name: j.name, w: dim ? dim.w : 0, h: dim ? dim.h : 0, bytes: st.size};
        covers[j.d] = v; cache.put('d', j.d, stamp, 'img', v); go();
      });
    });
  })();
}
/* lossy files of duplicate albums: their size (s.size) for the data rate (duplicates.quality), one stat after another */
function fileSizes(list, cb) {
  var i = 0;
  (function next() {
    if (i >= list.length) return cb();
    var s = list[i++];
    fs.stat(path.join(MUSIC_ROOT, s.file), function(e, st){ if (!e) s.size = st.size; if (i % 200) next(); else setImmediate(next); });
  })();
}
function checkCovers(songs, cand, cache, extra) {
  var noCover = {}, lm = {};
  songs.forEach(function(s){ lm[s.file] = s['last-modified']; });
  checkRun.phase = 'cover'; checkRun.done = 0; checkRun.total = cand.length;
  /* embedded cover of the first track of each folder without an image: from the cache when the file is unchanged */
  var known = [], ask = [];
  cand.forEach(function(c, k){
    var hit = cache.get('f', c.file, lm[c.file], 'cover');
    if (hit) known[k] = {ok: true, has: hit.v}; else ask.push(k);
  });
  var jobs = ask.map(function(k){ return {op: 'cover_has', path: path.join(MUSIC_ROOT, cand[k].file)}; });
  var i = 0, results = [];
  (function step() {                                   /* in parts so that progress keeps updating */
    if (i >= jobs.length) {
      ask.forEach(function(k, n){
        known[k] = results[n];
        if (results[n] && results[n].ok) cache.put('f', cand[k].file, lm[cand[k].file], 'cover', !!results[n].has);
      });
      cand.forEach(function(c, k){ if (!(known[k] && known[k].ok && known[k].has)) noCover[c.dir] = true; });
      /* m4a in duplicate albums: codec and resolution from the file, MPD's format is not reliable there */
      var m4aDirs = {};
      var dups = duplicates.find(songs, libcheck.artistKey);
      dups.forEach(function(g){
        g.versions.forEach(function(v){ if (v.ext === 'm4a' || v.ext === 'mp4') v.dirs.forEach(function(d){ m4aDirs[d] = 1; }); });
      });
      var dupDirs = {}, dupFiles = {};
      dups.forEach(function(g){ g.versions.forEach(function(v){ v.dirs.forEach(function(d){ dupDirs[d] = 1; }); }); });
      libcheck.dupTrackSongs(songs).forEach(function(s){                   /* duplicate tracks: the same for their files */
        dupFiles[s.file] = 1;
        if (/\.(m4a|mp4)$/i.test(s.file)) m4aDirs[path.dirname(s.file)] = 1;
      });
      return m4aprobe.fixFormats(songs, m4aDirs, MUSIC_ROOT, function(){
        fileSizes(songs.filter(function(s){
          return (dupDirs[path.dirname(s.file)] || dupFiles[s.file]) && !/\.(flac|wav|aiff?|ape|wv|dsf|dff)$/i.test(s.file);
        }), finish);
      });
    }
    var part = jobs.slice(i, i + PY_BATCH);
    i += part.length;
    runPyMany(part, function(r){ results = results.concat(r); checkRun.done = cand.length - jobs.length + i; step(); });
  })();
  function finish() {
    var res = libcheck.analyze(songs, function(d){ return !noCover[d]; },
      function(s){ return audioStore.get(s.artist, s.title, s.album); }, extra);
    res.reread = cache.misses; res.cached = cache.hits;  /* how much the cache saved */
    try { cache.save(writeAtomic); } catch (e) { console.error('check-files.json: ' + e.message); }
    res.releaseDate = releasedates.diffs(albums.fromSongs(songs), songs,
      function(d){ var r = releaseDates.by[d]; return (r && r.d) || ''; }, albums.albumDir);   /* Date tag vs. MusicBrainz */
    res.at = Date.now();
    res.seconds = Math.round((res.at - checkRun.started) / 1000);
    try { writeCheck(res); } catch (e) { checkError = 'cannot save result: ' + e.message; }
    checkRun = null;
  }
}

/* GET /genres?dir=… -> main category and substyles of an album from the audio analysis (as of the last check);
   without dir all albums. The substyles are only stored here; the check writes only the main category into the files. */
function doGenres(query, cb) {
  var last = readCheck();
  var all = (last && last.genreStyles) || {};
  if (query.dir !== undefined) return cb(200, {ok: true, album: all[String(query.dir)] || null});
  cb(200, {ok: true, albums: all, at: last ? last.at : null});
}

/* ?have=<at>: caller already has the result of this state -> progress only, result: 'same' (saves MBs per request) */
/* ?fix=<stamp>: caller already has the suggestion lists of this state (MusicBrainz lookups, kept entries) -> fix: 'same';
   while a check runs the page asks every 2 s, and the lists carry all file names */
function doCheckGet(query, cb) {
  var last = readCheck();
  var same = last && query && query.have && String(last.at) === String(query.have);
  var ok = genreOkLoad(), st = artistNames.status();
  var stamp = [last ? last.at : 0, releaseDates.fetched, st.fetched, genreOkRev].join(':');
  var o = {ok: true, running: checkRun, error: checkError, result: same ? 'same' : last, artistStatus: st, fixStamp: stamp};
  if (same && query.fix && String(query.fix) === stamp) o.fix = 'same';
  else {
    o.genreOk = ok;
    o.artistFix = artistnames.fixes(last && last.names, function(n){ return artistNames.suggest(n); },
      function(n, to){ return ok['artist|' + n] === to; });   /* ignored: genre-ok.json "artist|<name>" = suggestion */
    o.yearFix = yearFix(last); o.nameFix = nameFix(last);
  }
  cb(200, o);
}

/* year not the same in all tracks, or Date tag differs from MusicBrainz: one entry per album with the years found
   ({name, count}), the MusicBrainz date (looked up in the background, see releaseDates.extra) and the suggestion:
   MusicBrainz date, else the most common year (src 'mb' | 'most') */
function yearFix(last) {
  if (!last) return [];
  var out = [], at = {};
  function mbOf(d) { var r = releaseDates.by[d]; return (r && r.d) || ''; }
  (last.yearMixed || []).forEach(function(it){
    var mb = mbOf(it.dir);
    at[it.dir] = out.length;
    out.push({dir: it.dir, name: it.name, artist: it.artist, count: it.count, years: it.years, mb: mb,
              suggest: mb || it.most, src: mb ? 'mb' : 'most', files: it.files});
  });
  (last.releaseDate || []).forEach(function(it){
    if (at.hasOwnProperty(it.dir)) return;
    var mb = mbOf(it.dir) || it.mb;
    out.push({dir: it.dir, name: it.name, artist: it.artist, count: it.count, years: [{name: it.tag, count: it.count}], mb: mb,
              suggest: mb, src: 'mb', files: it.files});
  });
  return out.filter(function(it){ return it.suggest; })
    .sort(function(a, b){ return String(a.artist).localeCompare(b.artist) || String(a.name).localeCompare(b.name); });
}
/* album name not the same in all tracks: suggestion is the MusicBrainz spelling, else the most common name without a disc
   addition; files carry disc where the addition names one and the disc tag is empty */
function nameFix(last) {
  return ((last && last.albumName) || []).map(function(it){
    var r = releaseDates.by[it.dir], t = (r && r.t) || '';
    return {dir: it.dir, name: it.name, artist: it.artist, count: it.count, names: it.names,
            suggest: t || it.bare, src: t ? 'mb' : 'most', files: it.files};
  });
}
/* albums of the check that MusicBrainz is asked about even with a full Date tag (year or album name mixed). Asked at every
   lookup step: kept as a small list per state of check.json, so the big result need not stay in memory */
var releaseExtraList = [], releaseExtraStamp = null;
function releaseExtra() {
  var stamp = checkFileStamp();
  if (stamp === releaseExtraStamp) return releaseExtraList;
  var last = readCheck(), out = [];
  releaseExtraStamp = stamp; releaseExtraList = out;
  if (!last) return out;
  (last.yearMixed || []).forEach(function(it){
    var ys = (it.years || []).map(function(y){ return +y.name; }).filter(Boolean);
    out.push({dir: it.dir, al: it.name, ar: it.artist, y: ys.length ? Math.max.apply(null, ys) : 0});
  });
  (last.albumName || []).forEach(function(it){ out.push({dir: it.dir, al: it.bare, ar: it.artist}); });
  return out;
}

/* Genre contradicts the audio analysis, but is right: POST /genreok {dir, tag, ok} remembers it for good (genre-ok.json,
   {dir: tag}); it counts only as long as the album still has this tag. ok false takes it back. */
var GENRE_OK_FILE = path.join(DATA_DIR, 'genre-ok.json'), genreOk = null, genreOkRev = 0;
var GENRE_OK_MAX = 20000;
function genreOkLoad() {
  if (!genreOk) { try { genreOk = JSON.parse(fs.readFileSync(GENRE_OK_FILE, 'utf8')); } catch (e) { genreOk = {}; } }
  if (!genreOk || typeof genreOk !== 'object' || Array.isArray(genreOk)) genreOk = {};
  return genreOk;
}
/* Patterns of "Split by pattern" that were saved with (bulk editor): GET /patterns -> {ok, patterns: [newest first]};
   POST /patterns {pattern} puts it first (patterns.json, at most PATTERNS_MAX) */
var PATTERNS_FILE = path.join(DATA_DIR, 'patterns.json'), PATTERNS_MAX = 20;
function patternsLoad() {
  try { var l = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8')); return Array.isArray(l) ? l.filter(function(x){ return typeof x === 'string'; }) : []; }
  catch (e) { return []; }
}
function doPatterns(body, cb) {
  var pat = body && typeof body.pattern === 'string' ? body.pattern.trim() : '';
  if (!pat || pat.length > 300 || !/%[a-zA-Z]+%/.test(pat)) return cb(400, {ok: false, error: 'pattern missing'});
  var list = [pat].concat(patternsLoad().filter(function(x){ return x !== pat; })).slice(0, PATTERNS_MAX);
  try { writeAtomic(PATTERNS_FILE, JSON.stringify(list)); }
  catch (e) { return cb(500, {ok: false, error: e.message}); }
  cb(200, {ok: true, patterns: list});
}

function doGenreOk(body, cb) {
  var dir = body && body.dir, tag = body && body.tag;
  if (typeof dir !== 'string' || !dir || dir.length > 1000 || typeof tag !== 'string' || tag.length > 300) return cb(400, {ok: false, error: 'dir or tag missing'});
  var m = genreOkLoad();
  if (body.ok) {
    if (!Object.prototype.hasOwnProperty.call(m, dir) && Object.keys(m).length >= GENRE_OK_MAX) return cb(400, {ok: false, error: 'too many'});
    m[dir] = tag;
  } else delete m[dir];
  genreOkRev++;
  try { writeAtomic(GENRE_OK_FILE, JSON.stringify(m)); }
  catch (e) { return cb(500, {ok: false, error: e.message}); }
  cb(200, {ok: true});
}

/* POST /checkdone {key}: remember an entry as handled (stays greyed out) until the next check.
   Stored in check-done.json with the time of the check; a new check makes the marks obsolete. */
function doCheckDone(body, cb) {
  var key = body && body.key;
  if (typeof key !== 'string' || !key || key.length > 1000) return cb(400, {ok: false, error: 'key missing'});
  var last = readCheck();
  if (!last) return cb(200, {ok: false, error: 'not checked yet'});
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  if (!markDone(last, [key])) return cb(500, {ok: false, error: 'cannot save'});
  cb(200, {ok: true});
}

/* POST /dupmove {dirs, token}: move an album aside (a version of a duplicate album as listed by the last check, or any
   album folder of the library, from the album editor) into the folder "Xplorio Trash" on the same drive (duplicates.js); MPD forgets it with the next scan. Nothing is deleted:
   moving it back restores it. Password only if one is set (adminpass.js), like restarting the player. */
var duplicates = require('./duplicates.js');
var m4aprobe = require('./m4aprobe.js');
var trash = require('./trash.js');
/* journal of what went into "Xplorio Trash" (trash.js): from where, when, why; for the Papierkorb view */
var TRASH_FILE = path.join(DATA_DIR, 'trash.json');
function trashJournal() { try { var j = JSON.parse(fs.readFileSync(TRASH_FILE, 'utf8')); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
function trashJournalSave(j) { try { mkdirs(DATA_DIR); writeAtomic(TRASH_FILE, JSON.stringify(j)); } catch (e) { console.error('cannot write ' + TRASH_FILE + ': ' + e.message); } }
function trashNote(moved, reasonOf) {
  var at = Date.now();
  trashJournalSave(trash.journalAdd(trashJournal(), moved.map(function(m){ return {to: m.to, from: m.from, at: at, reason: reasonOf(m.from)}; }), MUSIC_ROOT));
}
function dupFolder(rel) {
  var p = libPath(rel, String(rel).split('/')[0] === 'INTERNAL' ? 2 : 3, true);
  if (!p || p.missing) return null;
  try { if (!fs.statSync(p.full).isDirectory()) return null; } catch (e) { return null; }
  return p.full;
}
/* .mpdignore in the drive folder names the duplicates folder, so a later scan of the drive (or of the whole library) leaves it
   out. true if the file was written now */
function dupIgnore(drive) {
  var f = path.join(MUSIC_ROOT, drive, '.mpdignore'), text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { /* none yet */ }
  var neu = duplicates.ignoreLine(text);
  if (neu === null) return false;
  try { writeAtomic(f, neu); return true; }
  catch (e) { console.error('cannot write ' + f + ': ' + e.message); return false; }
}
/* at the start: the folder of earlier versions (".duplicates", hidden on the Mac, then "Xplorio Duplicates") gets its
   current name ("Xplorio Trash"), and every such folder its .mpdignore line. MPD forgets the old path when exactly it is updated */
function dupMigrate() {
  var drives = ['INTERNAL'];
  ['USB', 'NAS'].forEach(function(r){
    try { fs.readdirSync(path.join(MUSIC_ROOT, r)).forEach(function(d){ drives.push(r + '/' + d); }); } catch (e) { /* not there */ }
  });
  function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
  var forget = [];
  drives.forEach(function(d){
    var neu = path.join(MUSIC_ROOT, d, duplicates.TRASH);
    duplicates.OLD_TRASHES.forEach(function(name){
      var old = path.join(MUSIC_ROOT, d, name);
      if (!isDir(old)) return;
      if (isDir(neu)) return console.error('both ' + old + ' and ' + neu + ' exist: ' + old + ' left as it is');
      try { fs.renameSync(old, neu); forget.push(d + '/' + name); }
      catch (e) { console.error('cannot rename ' + old + ': ' + e.message); }
    });
    if (isDir(neu) && dupIgnore(d)) forget.push(d + '/' + duplicates.TRASH);
  });
  if (forget.length) mpdForget(forget, function(){});
}
function doDupMove(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  var dirs = Array.isArray(body.dirs) ? body.dirs.map(String) : [];
  if (!dirs.length || dirs.length > 50) return cb(400, {ok: false, error: 'dirs missing'});
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  var last = readCheck(), listed = {};
  if (last && last.duplicates) last.duplicates.forEach(function(g){ g.versions.forEach(function(v){ v.dirs.forEach(function(d){ listed[d] = 1; }); }); });
  albumsEnsure(function(list){
    var known = {};                                      /* album folders of the library (album editor), disc folders included */
    (list || []).forEach(function(a){ known[a.dir] = 1; });
    var bad = dirs.filter(function(d){ return !(listed[d] || known[d] || known[albums.albumDir(d + '/x')]) || !dupFolder(d); });
    if (bad.length) return cb(200, {ok: false, error: list ? 'not an album folder: ' + bad[0] : 'album list not ready yet'});
    var moved = [];
    for (var i = 0; i < dirs.length; i++) {
      var to = duplicates.trashPath(dirs[i]), n = 2;
      while (fs.existsSync(path.join(MUSIC_ROOT, to))) to = duplicates.trashPath(dirs[i]) + ' (' + (n++) + ')';
      try {
        mkdirs(path.dirname(path.join(MUSIC_ROOT, to)));
        fs.renameSync(path.join(MUSIC_ROOT, dirs[i]), path.join(MUSIC_ROOT, to));
      } catch (e) {
        if (moved.length) mpdForget(moved.map(function(m){ return m.from; }), function(){});
        return cb(200, {ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? 'no write permission: /mnt/' + dirs[i] : e.message, moved: moved});
      }
      moved.push({from: dirs[i], to: to});
      dupIgnore(duplicates.driveOf(dirs[i]));
      if (last && listed[dirs[i]]) markDone(last, ['duplicates|' + dirs[i]]);
    }
    mpdForget(dirs, function(){});                        /* only these folders: MPD drops them */
    trashNote(moved, function(d){ return listed[d] ? 'dupAlbum' : 'albumEditor'; });
    cb(200, {ok: true, moved: moved});
  });
}

/* GET /tracknums?d=["USB/S/Album", …]: track number tags of the files in these folders (MPD database), for the album view,
   which otherwise only has the position in the list -> {ok, tracks: {file: [track, disc]}} (disc only if tagged). At most 10 folders */
function doTrackNums(query, cb) {
  var dirs;
  try { dirs = JSON.parse(String(query.d || '[]')); } catch (e) { return cb(400, {ok: false, error: 'invalid d'}); }
  if (!Array.isArray(dirs) || !dirs.length || dirs.length > 10) return cb(400, {ok: false, error: 'invalid d'});
  dirs = dirs.map(String);
  if (dirs.some(function(d){ return !d || d.charAt(0) === '/' || d.indexOf('\0') >= 0 || d.split('/').indexOf('..') >= 0; })) return cb(400, {ok: false, error: 'invalid d'});
  libcheck.mpdWalk({host: MPD_HOST, port: MPD_PORT, roots: dirs, timeout: 20000}, function(err, songs){
    if (err) return cb(200, {ok: false, error: err.message});
    var out = {};
    songs.forEach(function(s){ if (s.track) out[s.file] = s.disc ? [s.track, s.disc] : [s.track]; });
    cb(200, {ok: true, tracks: out});
  });
}

/* POST /filemove {files, token}: move single tracks aside, only files the last check listed as duplicate tracks
   (dupTracks) or as the worse tracks of an album of mixed quality (mixedQuality), into "Xplorio Trash" on the same drive with the rest of the path (like /dupmove for folders) */
function dupFile(rel) {
  var p = libPath(rel, String(rel).split('/')[0] === 'INTERNAL' ? 2 : 3, true);
  if (!p || p.missing) return null;
  try { if (!fs.statSync(p.full).isFile()) return null; } catch (e) { return null; }
  return p.full;
}
function doFileMove(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  var files = Array.isArray(body.files) ? body.files.map(String) : [];
  if (!files.length || files.length > 50) return cb(400, {ok: false, error: 'files missing'});
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  var last = readCheck(), listed = {};
  if (!last || !last.dupTracks) return cb(200, {ok: false, error: 'not checked yet'});
  last.dupTracks.forEach(function(a){ a.groups.forEach(function(g){ g.files.forEach(function(f){ listed[f.uri] = 'dupTrack'; }); }); });
  (last.mixedQuality || []).forEach(function(a){ a.worse.forEach(function(f){ listed[f.uri] = listed[f.uri] || 'mixedQuality'; }); });   /* lossy tracks next to lossless ones */
  var bad = files.filter(function(f){ return !listed[f] || !dupFile(f); });
  if (bad.length) return cb(200, {ok: false, error: 'not listed by the check: ' + bad[0]});
  var moved = [];
  for (var i = 0; i < files.length; i++) {
    var to = duplicates.trashPath(files[i]), n = 2, ext = path.extname(to);
    while (fs.existsSync(path.join(MUSIC_ROOT, to))) to = duplicates.trashPath(files[i]).slice(0, -ext.length || undefined) + ' (' + (n++) + ')' + ext;
    try {
      mkdirs(path.dirname(path.join(MUSIC_ROOT, to)));
      fs.renameSync(path.join(MUSIC_ROOT, files[i]), path.join(MUSIC_ROOT, to));
    } catch (e) {
      if (moved.length) mpdForget(moved.map(function(m){ return path.dirname(m.from); }), function(){});
      return cb(200, {ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? 'no write permission: /mnt/' + files[i] : e.message, moved: moved});
    }
    moved.push({from: files[i], to: to});
    dupIgnore(duplicates.driveOf(files[i]));
    markDone(last, ['dupTracks|' + files[i], 'mixedQuality|' + files[i]]);
  }
  mpdForget(moved.map(function(m){ return path.dirname(m.from); }).filter(function(d, i, all){ return all.indexOf(d) === i; }), function(){});   /* their folders: MPD drops the files */
  trashNote(moved, function(f){ return listed[f]; });
  cb(200, {ok: true, moved: moved});
}

/* ---------- Papierkorb: what is in "Xplorio Trash" on the drives (trash.js) ---------- */
/* GET /trash -> {ok, drives: [{drive, bytes, entries: [{path, kind, from, at, reason, bytes, files}]}], bytes, count} */
function doTrashGet(cb) {
  try { var l = trash.list(MUSIC_ROOT, trashJournal()); l.ok = true; cb(200, l); }
  catch (e) { cb(200, {ok: false, error: e.message}); }
}
/* GET /trashfiles?p=<entry>: the files of a folder entry, to put back or delete one by one */
function doTrashFiles(query, cb) {
  var r;
  try { r = trash.files(MUSIC_ROOT, String(query.p || '')); }
  catch (e) { return cb(200, {ok: false, error: e.message}); }
  if (!r.ok) return cb(200, r);
  /* track number and title from the tags (the trash is not in MPD's database); without them the list still comes */
  var audio = r.files.filter(function(f){ return /\.(flac|mp3|m4a|ogg|opus|wav|aiff?|dsf|wv|ape)$/i.test(f.name); }).slice(0, 200);
  if (!audio.length) return cb(200, r);
  runPyMany(audio.map(function(f){ return {op: 'read', path: path.join(MUSIC_ROOT, f.path)}; }), function(res){
    res.forEach(function(x, i){
      if (!x || !x.ok || !x.tags) return;
      var m = /^\s*(\d+)/.exec(x.tags.track || '');
      if (m) audio[i].track = +m[1];
      if (x.tags.title) audio[i].title = String(x.tags.title);
    });
    cb(200, r);
  });
}
/* POST /trashrestore {path, token}: back to the old place (never overwrites); MPD reads exactly that folder again */
function doTrashRestore(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  var rel = String(body.path || ''), j = trashJournal();
  var r;
  try { r = trash.restore(MUSIC_ROOT, rel, trash.originOf(j, rel)); }   /* also a single file of a folder entry */
  catch (e) { return cb(200, {ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? 'no write permission: /mnt/' + rel : e.message}); }
  if (!r.ok) return cb(200, r);
  trashJournalSave(j.filter(function(x){ return x.to !== rel; }));
  var isFile = false;
  try { isFile = !fs.statSync(path.join(MUSIC_ROOT, r.to)).isDirectory(); } catch (e) { /* gone again */ }
  mpdForget([isFile ? path.dirname(r.to) : r.to], function(){});
  cb(200, r);
}
/* POST /trashdelete {path | drive, token}: delete one entry, or everything in the trash of a drive, for good */
function doTrashDelete(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  var r;
  try { r = body.drive ? trash.empty(MUSIC_ROOT, String(body.drive)) : trash.remove(MUSIC_ROOT, String(body.path || '')); }
  catch (e) { return cb(200, {ok: false, error: e.code === 'EACCES' || e.code === 'EPERM' ? 'no write permission' : e.message}); }
  if (r.ok) trashJournalSave(trash.journalAdd(trashJournal(), [], MUSIC_ROOT));   /* entries of deleted things drop out */
  cb(200, r);
}

/* ---------- Dateimanager: file management (fileops.js, menu "Dateimanager", web/js/files.js) ---------- */
/* Only with the password (System page, adminpass.js): without one set, nothing works, not even the listing.
   POST /files {op, token, …}:
     list {path}              -> the drives (path '') or the folders and files of a folder; audio files with album (al) and
                                 album artist (aa) from MPD's database, if MPD knows them
     image {path}             -> {mime, data}: an image (jpg, png, gif, webp, bmp) as base64, for the preview
     mkdir {dest, name}, rename {path, name}, rmdir {path}, trash {items}: right away
     copy / move {items, dest} -> runs as a job in the background (one at a time)
     job                      -> {ok, job}: the running or last job; cancel: stop it after the current file */
var fileops = require('./fileops.js');
var filesJob = null, filesJobSeq = 0;
function filesErr(e, rel) {
  if (e && (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS')) return 'no write permission: /mnt/' + rel;
  return (e && e.message) || String(e);
}
function filesJobView() {
  if (!filesJob) return null;
  var j = filesJob;
  return {id: j.id, op: j.op, state: j.state, dest: j.dest, n: j.steps.length, files: j.r.files, filesDone: j.r.filesDone,
          bytes: j.r.bytes, bytesDone: j.r.bytesDone, current: j.r.current, done: j.r.done, errors: j.r.errors, skipped: j.skipped,
          started: j.started, ended: j.ended || 0};
}
/* after moving: Xplorio's own data follows the new paths (ratings, NoMix, "keep" marks of the check, history) */
function filesRelocate(moves) {
  if (!moves.length) return;
  function rename(obj) { return fileops.moveObjectKeys(obj, moves); }
  try { ratingStore.relocate(rename); } catch (e) { console.error('ratings not moved along: ' + e.message); }
  try { nomixStore.relocate(rename); } catch (e) { console.error('nomix not moved along: ' + e.message); }
  try {
    var m = genreOkLoad();
    if (rename(m)) { genreOkRev++; writeAtomic(GENRE_OK_FILE, JSON.stringify(m)); }
  } catch (e) { console.error('genre-ok not moved along: ' + e.message); }
  try { playStore.relocate(function(u){ return fileops.movePartsKey(u, moves); }); } catch (e) { console.error('history not moved along: ' + e.message); }
}
/* MPD reads the old and the new places again (exactly these paths, see mpdForget) */
function filesScan(changes) { if (changes.length) mpdForget(fileops.scanPaths(changes), function(){}); }
function filesTrashNote(moved) {
  if (!moved.length) return;
  moved.forEach(function(m){ dupIgnore(duplicates.driveOf(m.from)); });
  trashNote(moved, function(){ return 'files'; });
}
function doFiles(body, cb) {
  if (!adminAuth.isSet()) return cb(200, {ok: false, error: 'nopw'});
  if (!adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  var op = String(body.op || ''), r;
  if (op === 'list') {
    var l = fileops.list(MUSIC_ROOT, String(body.path || ''));
    if (!l.ok || !l.files || !l.files.some(function(f){ return f.audio; })) return cb(200, l);
    /* album and album artist of the audio files from MPD's database (no file is opened), only this folder */
    return libcheck.mpdWalk({host: MPD_HOST, port: MPD_PORT, roots: [l.path], flat: true, timeout: 5000}, function(err, songs){
      if (!err) {
        var by = {};
        songs.forEach(function(x){ by[path.basename(x.file)] = x; });
        l.files.forEach(function(f){
          var x = f.audio && by[f.name];
          if (x) { f.al = x.album || ''; f.aa = x.albumartist || x.artist || ''; }
        });
      }
      cb(200, l);
    });
  }
  if (op === 'image') {                                   /* preview: the image as base64 (no token in a URL) */
    var im = fileops.image(MUSIC_ROOT, String(body.path || ''));
    if (!im.ok) return cb(200, im);
    return fs.readFile(im.full, function(e, buf){
      if (e) return cb(200, {ok: false, error: 'not found'});
      cb(200, {ok: true, mime: im.mime, data: buf.toString('base64')});
    });
  }
  if (op === 'job' || op === 'cancel') {
    if (op === 'cancel' && filesJob && filesJob.state === 'running') filesJob.cancel = true;
    return cb(200, {ok: true, job: filesJobView()});
  }
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  if (op === 'rename') {
    if (filesJob && filesJob.state === 'running') return cb(200, {ok: false, error: 'busy'});
    try { r = fileops.rename(MUSIC_ROOT, String(body.path || ''), body.name); }
    catch (e) { return cb(200, {ok: false, error: filesErr(e, body.path)}); }
    if (r.ok) {
      filesScan([{path: r.from, dir: r.dir}, {path: r.to, dir: r.dir}]);
      filesRelocate([{from: r.from, to: r.to}]);                    /* ratings, NoMix, history follow */
    }
    return cb(200, r);
  }
  if (op === 'mkdir') {
    try { r = fileops.mkdir(MUSIC_ROOT, String(body.dest || ''), body.name); }
    catch (e) { return cb(200, {ok: false, error: filesErr(e, body.dest)}); }
    return cb(200, r);
  }
  if (op === 'rmdir') {
    try { r = fileops.rmdir(MUSIC_ROOT, String(body.path || '')); }
    catch (e) { return cb(200, {ok: false, error: filesErr(e, body.path)}); }
    if (r.ok) filesScan([{path: String(body.path), dir: true}]);
    return cb(200, r);
  }
  var items = Array.isArray(body.items) ? body.items.map(String) : [];
  if (!items.length || items.length > fileops.MAX_ITEMS) return cb(400, {ok: false, error: 'items missing or too many'});
  if (filesJob && filesJob.state === 'running') return cb(200, {ok: false, error: 'busy'});
  if (op === 'trash') {
    try { r = fileops.toTrash(MUSIC_ROOT, items); }
    catch (e) { r = {ok: false, error: filesErr(e, items[0]), moved: []}; }
    filesTrashNote(r.moved);
    filesScan(r.moved.map(function(m){ return {path: m.from, dir: m.dir}; }));
    return cb(200, r);
  }
  if (op !== 'copy' && op !== 'move') return cb(400, {ok: false, error: 'unknown op'});
  var p = fileops.plan(MUSIC_ROOT, items, String(body.dest || ''), op);
  if (!p.ok) return cb(200, p);
  var job = filesJob = {id: ++filesJobSeq, op: op, dest: String(body.dest), steps: p.steps, skipped: p.skipped, state: 'running',
                        started: Date.now(), cancel: false, r: {done: [], errors: [], files: 0, filesDone: 0, bytes: 0, bytesDone: 0, current: ''}};
  var trashed = [];
  fileops.run(MUSIC_ROOT, p.steps, op, {
    progress: function(r){ job.r = r; },
    cancelled: function(){ return job.cancel; },
    toTrash: function(rel){ var t = fileops.toTrash(MUSIC_ROOT, [rel]).moved[0]; trashed.push(t); return t; }
  }, function(r){
    job.r = r; job.ended = Date.now();
    job.state = r.cancelled ? 'cancelled' : r.errors.length ? (r.done.length ? 'partly' : 'error') : 'done';
    var changes = [];
    r.done.forEach(function(d){
      changes.push({path: d.to, dir: d.dir});
      if (op === 'move') changes.push({path: d.from, dir: d.dir});
    });
    filesTrashNote(trashed);
    filesScan(changes);
    if (op === 'move') filesRelocate(r.done.filter(function(d){ return !d.copyOnly; }).map(function(d){ return {from: d.from, to: d.to}; }));
  });
  cb(200, {ok: true, job: filesJobView()});
}

/* POST /dupfill {dir, files, token}: duplicate albums: copy the tracks the best version lacks (files: the ones ticked of
   missing in the last check, the group whose best version starts with dir; without files the sure ones) from the other versions into its folders; album, album artist, date and
   genre then come from the best version (written with an undo ID). Never overwrites a file.
   POST /dupfill {undo: batch, token}: delete these copies again, as long as they are unchanged since */
var DUPFILL_FILE = path.join(DATA_DIR, 'dupfill.json');
function dupFillLoad() { try { return JSON.parse(fs.readFileSync(DUPFILL_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function dupFillSave(m) {
  var keys = Object.keys(m).sort(function(a, b){ return m[a].at - m[b].at; });
  while (keys.length > 30) delete m[keys.shift()];                       /* the last copies only */
  try { fs.writeFileSync(DUPFILL_FILE + '.neu', JSON.stringify(m)); fs.renameSync(DUPFILL_FILE + '.neu', DUPFILL_FILE); } catch (e) { /* undo not possible */ }
}
function copyFile(from, to, cb) {
  var tmp = path.join(path.dirname(to), '.xplorio-copy-' + process.pid + '-' + path.basename(to)), done = false;
  function end(e) {
    if (done) return; done = true;
    if (e) { try { fs.unlinkSync(tmp); } catch (x) { /* none */ } return cb(e); }
    try { if (fs.existsSync(to)) throw new Error('exists'); fs.renameSync(tmp, to); } catch (x) { try { fs.unlinkSync(tmp); } catch (y) { /* none */ } return cb(x); }
    cb(null);
  }
  var rd = fs.createReadStream(from), wr = fs.createWriteStream(tmp, {flags: 'wx'});
  rd.on('error', end); wr.on('error', end); wr.on('close', function(){ end(null); });
  rd.pipe(wr);
}
function doDupFill(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  if (checkRun) return cb(200, {ok: false, error: 'check running'});
  if (body.undo !== undefined) return dupFillUndo(String(body.undo), cb);
  var dir = String(body.dir || ''), last = readCheck();
  var g = last && (last.duplicates || []).filter(function(x){ return x.versions[0].dirs[0] === dir && x.missing; })[0];
  if (!g) return cb(200, {ok: false, error: 'nothing to add for ' + dir});
  var pick = Array.isArray(body.files) ? body.files.map(String) : null;      /* the tracks ticked in the list */
  var todo = pick ? g.missing.filter(function(m){ return pick.indexOf(m.uri) >= 0; }) : g.missing.filter(function(m){ return m.sure !== false; });
  if (!todo.length || (pick && todo.length !== pick.length)) return cb(200, {ok: false, error: 'nothing to add for ' + dir});
  var best = g.versions[0], bestDirs = {};
  best.dirs.forEach(function(d){ bestDirs[d] = 1; });
  /* only into a folder of the best version, or a new disc folder next to them */
  var bad = todo.filter(function(m){
    if (!dupFile(m.uri)) return true;
    if (bestDirs[m.to]) return !dupFolder(m.to);
    var nb = path.basename(m.to);
    if (!nb || nb === '.' || nb === '..' || duplicates.isTrash(nb)) return true;
    return !dupFolder(path.dirname(m.to)) || !bestDirs[best.dirs.filter(function(d){ return path.dirname(d) === path.dirname(m.to); })[0]];
  });
  if (bad.length) return cb(200, {ok: false, error: 'not possible: ' + bad[0].uri});
  var sample = '';
  try { sample = fs.readdirSync(dupFolder(best.dirs[0])).filter(function(f){ return EXT_RE.test(f); }).sort()[0]; } catch (e) { /* no tags to take */ }
  runPyMany(sample ? [{op: 'read', path: path.join(MUSIC_ROOT, best.dirs[0], sample)}] : [], function(rs){
    var t = (rs[0] && rs[0].ok && rs[0].tags) || {}, tags = {};
    ['album', 'albumartist', 'date', 'genre'].forEach(function(k){ if (t[k]) tags[k] = t[k]; });
    var copied = [], skipped = [], made = [], i = 0;
    (function next() {
      if (i >= todo.length) return written();
      var m = todo[i++], toDir = path.join(MUSIC_ROOT, m.to), to = path.join(toDir, path.basename(m.uri));
      if (fs.existsSync(to)) { skipped.push({uri: m.uri, error: 'exists'}); return next(); }
      if (!fs.existsSync(toDir)) { try { mkdirs(toDir); made.push(m.to); } catch (e) { skipped.push({uri: m.uri, error: e.message}); return next(); } }
      copyFile(path.join(MUSIC_ROOT, m.uri), to, function(e){
        if (e) skipped.push({uri: m.uri, error: e.code === 'EACCES' || e.code === 'EPERM' ? 'no write permission: /mnt/' + m.to : e.message});
        else copied.push(m.to + '/' + path.basename(m.uri));
        next();
      });
    })();
    function written() {
      var batch = newBatch(), items = copied.filter(function(f){ return EXT_RE.test(f); }).map(function(f){ return {uri: f, tags: tags}; });
      function finish() {
        var m = dupFillLoad();
        m[batch] = {at: Date.now(), dirs: made, files: copied.map(function(f){
          try { var st = fs.statSync(path.join(MUSIC_ROOT, f)); return {f: f, size: st.size, mtime: st.mtime.getTime()}; } catch (e) { return {f: f}; }
        })};
        if (copied.length) dupFillSave(m);
        if (copied.length) {
          markDone(last, ['dupfill|' + dir]);
          mpdForget(copied.map(function(f){ return path.dirname(f); }).filter(function(d, k, all){ return all.indexOf(d) === k; }), function(){});   /* exactly these folders */
        }
        cb(200, {ok: true, batch: copied.length ? batch : null, copied: copied, skipped: skipped});
      }
      if (!items.length || !Object.keys(tags).length) return finish();
      writeItems(items, batch, false, function(st, r){
        (r && r.items || []).forEach(function(x){ if (!x.ok) skipped.push({uri: x.uri, error: 'tags: ' + x.error}); });
        finish();
      });
    }
  });
}
function dupFillUndo(batch, cb) {
  var m = dupFillLoad(), b = m[batch];
  if (!b) return cb(200, {ok: false, error: 'unknown batch'});
  var removed = [], kept = [], dirs = {};
  b.files.forEach(function(x){
    var full = path.join(MUSIC_ROOT, x.f);
    try {
      var st = fs.statSync(full);
      if (st.size !== x.size || st.mtime.getTime() !== x.mtime || !dupFile(x.f)) { kept.push(x.f); return; }   /* edited since */
      fs.unlinkSync(full); removed.push(x.f); dirs[path.dirname(x.f)] = 1;
    } catch (e) { if (e.code !== 'ENOENT') kept.push(x.f); }
  });
  (b.dirs || []).forEach(function(d){ try { fs.rmdirSync(path.join(MUSIC_ROOT, d)); } catch (e) { /* not empty */ } });
  delete m[batch]; dupFillSave(m);
  mpdForget(Object.keys(dirs), function(){});
  cb(200, {ok: true, removed: removed, kept: kept});
}

/* ---------- Online cover search ---------- */
/* GET /coversearch?artist=…&album=… -> {ok, results:[{id, source}]}; GET /coverimage?id=… returns the image.
   Only addresses found by the search itself are loaded (via the id). Last.fm key from web/config*.js. */
var coversearch = require('./coversearch.js');
var APP_CONFIG_DIR = process.env.APP_CONFIG_DIR || path.join(__dirname, '..', 'web');   /* app/web in the plugin */
var coverHits = Object.create(null), coverHitIds = [], coverHitSeq = 0;   /* no prototype: ?id=constructor and the like match nothing */

/* reread only when one of the two files has changed (asked for very often) */
var appConfigCache = null, appConfigStamp = '';
function appConfig() {
  var files = ['config.js', 'config.local.js'];
  var stamp = files.map(function(f){
    try { var st = fs.statSync(path.join(APP_CONFIG_DIR, f)); return st.mtime.getTime() + ':' + st.size; } catch (e) { return '-'; }
  }).join('|');
  if (appConfigCache && stamp === appConfigStamp) return appConfigCache;
  var ctx = {window: {}};
  files.forEach(function(f){
    try { vm.runInNewContext(fs.readFileSync(path.join(APP_CONFIG_DIR, f), 'utf8'), ctx, {filename: f, timeout: 1000}); }
    catch (e) { /* file missing or broken: defaults */ }
  });
  appConfigCache = ctx.window.APP_CONFIG || {}; appConfigStamp = stamp;
  return appConfigCache;
}

function doCoverSearch(query, cb) {
  var album = String(query.album || '').trim();
  if (!album) return cb(400, {ok: false, error: 'album missing'});
  coversearch.search({artist: query.artist, album: album, lastfmKey: keys.lastfm().key}, function(list){
    cb(200, {ok: true, results: list.map(function(r){
      var id = String(++coverHitSeq);
      coverHits[id] = r.url; coverHitIds.push(id);
      if (coverHitIds.length > 100) delete coverHits[coverHitIds.shift()];
      return {id: id, source: r.source};
    })});
  });
}

function doCoverImage(query, res) {
  var u = coverHits[String(query.id || '')];
  if (typeof u !== 'string') return send(res, 404, {ok: false, error: 'unknown'});
  coversearch.image(u, function(e, img){
    if (e) return send(res, 404, {ok: false, error: e.message});
    res.writeHead(200, {'Content-Type': img.mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=600'});
    res.end(img.body);
  });
}

/* ---------- Cover suggestions in the check ("Cover quality", image too small) ---------- */
/* POST /coverbest {dirs:[…]} -> {ok, covers: {dir: {state: 'found'|'none'|'wait', src, w, h, bytes}}}: the list asks for
   the entries it shows; unknown ones are searched one after another in the background (coverbest.js), the list asks again.
   GET /coverbestimage?dir=…&which=new|cur: the image found, or the folder's current one. Only folders of the last check */
var coverbest = require('./coverbest.js');
var coverBest = new coverbest.Best({file: path.join(DATA_DIR, 'cover-best.json'),
  search: function(q, cb){ coversearch.search({artist: q.artist, album: q.album, lastfmKey: keys.lastfm().key}, cb); },
  load: coversearch.image, dims: filecheck.imageDims});
function coverSmall(dir) {
  var last = readCheck();
  return ((last && last.coverQuality) || []).filter(function(it){ return it.dir === dir && it.why === 'small'; })[0] || null;
}
function doCoverBest(body, cb) {
  if (!Array.isArray(body.dirs) || body.dirs.length > 200) return cb(400, {ok: false, error: 'dirs missing or too many'});
  var items = {}, dirs = body.dirs.map(String);
  dirs.forEach(function(d){
    var it = coverSmall(d);
    if (!it) return;
    var cur = {w: it.w, h: it.h};
    items[d] = coverBest.state(d, cur);
    if (items[d].state === 'wait') coverBest.ask({dir: d, artist: it.artist === 'Verschiedene' ? '' : it.artist, album: it.name, cur: cur});
  });
  coverBest.only(dirs);
  cb(200, {ok: true, covers: items});
}
function doCoverBestImage(query, res) {
  var d = String(query.dir || ''), it = coverSmall(d);
  function none(code) { send(res, code || 404, {ok: false, error: 'unknown'}); }
  if (!it) return none();
  if (query.which === 'cur') {
    var f = path.join(MUSIC_ROOT, d, String(it.image || ''));
    if (path.dirname(f) !== path.join(MUSIC_ROOT, d) || !/\.(jpe?g|png)$/i.test(f)) return none(400);
    return fs.lstat(f, function(e, st){
      if (e || !st.isFile()) return none();
      fs.readFile(f, function(e2, buf){
        if (e2) return none();
        res.writeHead(200, {'Content-Type': /\.png$/i.test(f) ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*'});
        res.end(buf);
      });
    });
  }
  var e = coverBest.get(d, {w: it.w, h: it.h});
  if (!e || e.none) return none();
  coversearch.image(e.url, function(err, img){
    if (err) return send(res, 502, {ok: false, error: err.message});
    res.writeHead(200, {'Content-Type': img.mime, 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*'});
    res.end(img.body);
  });
}

/* ---------- History and Last.fm ---------- */
/* The service asks Volumio for the playback state every few seconds and writes counted plays
   to plays.jsonl. GET /plays?view=recent|top|stats returns lists and statistics, /lastfm connects and syncs. */
var plays  = require('./plays.js');
var lastfm = require('./lastfm.js');
var VOLUMIO_URL = process.env.VOLUMIO_URL || 'http://localhost:3000';
var playStore = new plays.Store(path.join(DATA_DIR, 'plays.jsonl'));
var keys = new appdata.Keys(DATA_DIR);                   /* Last.fm key and secret (keys.json) */
var lfm = new lastfm.Sync(path.join(DATA_DIR, 'lastfm.json'), playStore, function(){ return keys.lastfm(); });
var tracker = new plays.Tracker(function(e){ playStore.add([e]); lfm.played(e); }, function(e){ lfm.nowPlaying(e); });
var recording = false;

function playerState(cb) { volumioGet('/api/v1/getState', 1024 * 1024, cb); }
function volumioGet(route, max, cb) {
  var done = false;
  function finish(e, st) { if (!done) { done = true; cb(e, st); } }
  var req = http.get(VOLUMIO_URL + route, function(res){
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function(d){ data += d; if (data.length > max) { req.abort(); finish(new Error('response too large')); } });
    res.on('aborted', function(){ finish(new Error('aborted')); });
    res.on('end', function(){ try { finish(null, JSON.parse(data)); } catch (e) { finish(e); } });
  });
  req.setTimeout(5000, function(){ req.abort(); finish(new Error('timeout')); });
  req.on('error', finish);
}

/* history: Volumio's state on every MPD change (idle, see rgAuto below) and otherwise every 25 s while local files
   play. Other sources (Spotify and the like) may report nothing to MPD: every 5 s as before. Stopped: every 15 s */
var watchTimer = null, watchBusy = false, watchAgain = false, watchSoon = null;
function watchPlayer() {
  if (watchBusy) { watchAgain = true; return; }
  watchBusy = true; clearTimeout(watchTimer);
  playerState(function(e, st){
    watchBusy = false;
    if (!e && st) tracker.update(st, Date.now());
    if (watchAgain) { watchAgain = false; return watchPlayer(); }
    var playing = tracker.cur && tracker.cur.playing, viaMpd = !e && st && /^(mpd|webradio|)$/.test(st.service || '');
    watchTimer = setTimeout(watchPlayer, playing ? (viaMpd ? 25000 : 5000) : 15000);
  });
}
/* MPD reports a change: Volumio updates its state a moment later */
function watchPlayerSoon() {
  if (!recording || watchSoon) return;                  /* several changes in a row: one query */
  watchSoon = setTimeout(function(){ watchSoon = null; watchPlayer(); }, 1000);
}

/* Volumio uri -> path relative to the music folder ("USB/…"), otherwise '' */
function relUri(u) {
  u = String(u || '');
  if (/^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(u)) return '';
  return u.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
}

function doPlays(query, cb) {
  var list = playStore.load(), now = Math.floor(Date.now() / 1000), view = query.view;
  var limit = Math.min(parseInt(query.limit, 10) || 100, 500);
  if (view === 'recent') return cb(200, {ok: true, recording: recording, items: plays.recent(list, parseInt(query.before, 10) || 0, limit)});
  if (view === 'top' && query.kind === 'genre') {
    return albumsEnsure(function(al){
      var fn = al && albumGenreFn();
      if (!fn) return cb(200, {ok: true, building: true, items: []});
      var items = plays.topGenre(list, fn, plays.rangeStart(query.range, now), limit);
      items.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; });
      cb(200, {ok: true, items: items});
    });
  }
  if (view === 'top') {
    var kind = ['track', 'album', 'artist'].indexOf(query.kind) >= 0 ? query.kind : 'track';
    var items = plays.top(list, kind, plays.rangeStart(query.range, now), limit);
    if (kind === 'album') items.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; });
    return cb(200, {ok: true, items: items});
  }
  var tz = {w: parseInt(query.tzw, 10) || 0, s: parseInt(query.tzs, 10) || 0};
  if (view === 'stats') {
    albumsEnsure();                                      /* genres come from the album list */
    return cb(200, {ok: true, recording: recording, stats: plays.stats(list, query.range, now, tz, albumGenreFn())});
  }
  if (view === 'year') {
    var ys = plays.years(list, tz), y = parseInt(query.y, 10) || ys[0] || plays.local(now, tz).getUTCFullYear();
    albumsEnsure();                                      /* genres come from the album list */
    var gi = albumIdx && albumIdx.list;
    albumGenreFn();
    var m = parseInt(query.m, 10);
    var yr = plays.year(list, y, tz, now, 10, gi ? albumGenre.fn : null, m >= 1 && m <= 12 ? m - 1 : -1);
    yr.albums_top.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; });
    return cb(200, {ok: true, years: ys, review: yr});
  }
  if (view === 'album') {                               /* album page: how often played, last played */
    var dir = relUri(query.u).replace(/\/+$/, '');
    return cb(200, {ok: true, stats: plays.albumStats(list, relUri, dir, query.al, query.ar)});
  }
  if (view === 'ago') {
    var ak = ['artist', 'track'].indexOf(query.kind) >= 0 ? query.kind : 'album';
    var ag = plays.ago(list, now, tz, 12, ak);
    ag.items.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; });
    return cb(200, {ok: true, ago: ag});
  }
  cb(400, {ok: false, error: 'view missing'});
}

/* ---------- Random album ---------- */
/* GET /random[?kind=artist|track] -> {ok, album: {dir, al, ar, last}} (artist: {ar, n, dir, last}; track: {ar, ti, al, f, d, last}) or {ok: false, building: true} while the album list is being built.
   The list comes from MPD (as in the library check), is stored in albums.json and is reread
   when MPD's database has changed (checked at most once a minute, just a short "stats"). */
var albums = require('./albums.js');
var genres = require('./genres.js');
var versions = require('./versions.js');
var ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');
var albumIdx = null, albumBuilding = false, albumSoonUntil = 0, albumChecked = 0, albumPicks = [], albumLast = null, albumGenre = null;
var ALBUMS_CHECK_MS = 60000;                             /* ask MPD at most this often whether the database has changed */
var ALBUMS_QUIET_MS = parseInt(process.env.ALBUMS_QUIET_MS || '300000', 10);   /* database changed: rebuild only after it stayed unchanged this long */
var albumQuiet = null, albumQuietTimer = null;
var ALBUMS_AFTER_SCAN_MS = 90000;                        /* after our own scan: update the album list once MPD and Volumio are done */
var ALBUMS_VERSION = 13;                                 /* 2: with genre, 3: plus library-tracks.json, 4: with duration and album, 5: tracks with genre, 6: albums with year, 7: with modification date, 8: with full date, 9: with album versions, 10: more additions ignored, 11: version name without additions, 12: MQA as addition, 13: file info (fi) per album */
var TRACKS_FILE = path.join(DATA_DIR, 'library-tracks.json');   /* [[artist, title, file, seconds, album, album genre], …] */

function albumsEnsure(cb, now) {
  cb = cb || function(){};
  if (!albumIdx) { try { albumIdx = JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8')); } catch (e) { /* never read yet */ } }
  if (albumBuilding || (albumIdx && Date.now() - albumChecked < ALBUMS_CHECK_MS)) return cb(albumIdx && albumIdx.list);
  albumChecked = Date.now();
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'stats', function(err, st){
    var stamp = !err && st.db_update;
    if (albumIdx && (err || stamp === albumIdx.db) && albumIdx.v === ALBUMS_VERSION) return cb(albumIdx.list);
    if (albumIdx && albumIdx.v === ALBUMS_VERSION && !now) {     /* changed: wait until the database is quiet (imports) */
      var q = albums.settled(albumQuiet, stamp, Date.now(), ALBUMS_QUIET_MS);
      albumQuiet = q.state;
      if (!q.ready) {
        clearTimeout(albumQuietTimer);                   /* check again once it may be quiet, even without a request */
        albumQuietTimer = setTimeout(function(){ albumChecked = 0; albumsEnsure(); }, ALBUMS_QUIET_MS + 5000);
        if (albumQuietTimer.unref) albumQuietTimer.unref();
        return cb(albumIdx.list);
      }
    }
    albumQuiet = null;
    albumBuilding = true;
    if (albumIdx) cb(albumIdx.list);                     /* old list until the new one is ready */
    libcheck.mpdWalk({host: MPD_HOST, port: MPD_PORT}, function(e2, songs){
      albumBuilding = false;
      if (!e2 && songs.length) {
        albumIdx = {v: ALBUMS_VERSION, db: stamp || null, at: Date.now(), list: albums.fromSongs(songs), versions: versions.build(songs, libcheck.artistKey)};
        try { writeAtomic(ALBUMS_FILE, JSON.stringify(albumIdx)); } catch (x) { /* next time */ }
        var ge = {};                                     /* album genre (most common in the folder) for each track */
        albumIdx.list.forEach(function(a){ if (a.ge) ge[a.dir] = a.ge; });
        var tl = songs.filter(function(s){ return s.artist && s.title; }).map(function(s){
          return [s.artist, s.title, s.file, parseInt(s.time, 10) || 0, s.album, ge[albums.albumDir(s.file)] || ''];
        });
        try { fs.writeFileSync(TRACKS_FILE + '.neu', JSON.stringify(tl)); fs.renameSync(TRACKS_FILE + '.neu', TRACKS_FILE); } catch (x) { /* next time */ }
      }
    });
    if (!albumIdx) cb(null);
  });
}

/* ---------- Mood tags ---------- */
/* Collect Last.fm tags per track, only while nothing is playing (pause and stop count as quiet).
   GET /moodtags -> {ok, status, summary}; GET /moodtags?artist=…&title=… -> raw tags and result for one track */
var moodtags = require('./moodtags.js');
var essentia = require('./essentia.js');
var ESSENTIA_FILE = path.join(DATA_DIR, 'essentia.jsonl');      /* audio analysis from the Mac (tools/essentia), via POST /essentia or scp */
var ESSENTIA_MAX = 100 * 1024 * 1024;             /* about 1 kB per track: enough for well over 50,000 tracks */
var essentiaBusy = false;
var audioStore = new essentia.Store(ESSENTIA_FILE);
var moodCollector = new moodtags.Collector({
  dir: path.join(DATA_DIR, 'moodtags'), libFile: TRACKS_FILE, audio: audioStore,
  libRaw: function(){ return libTracksLoad() ? libTracks : null; },     /* same track list as random and genres */
  libStamp: function(){ try { return +fs.statSync(TRACKS_FILE).mtime; } catch (e) { return 0; } },   /* changed? without reading it */
  getCfg: function(){ return {key: keys.lastfm().key}; },
  playing: function(cb){ playerState(function(e, st){ cb(!!(e || (st && st.status === 'play'))); }); }   /* when in doubt: playing */
});

/* ---------- Library genres (genre tag, the most common per album) ---------- */
/* GET /genrelist[?q=] -> {ok, genres:[{g, n, dir, al, ar}], subs:[{g, s, n, dir, al, ar}] (only with q)};
   GET /genrealbums?g= -> {ok, albums:[{dir, al, ar, st:[substyles]}], subs:[{g, s, n, dir, al, ar}]};
   GET /albumgenre?q=[[uri, album, artist], …] -> {ok, genres:[…], years:[…]} (empty = unknown). building: album list still being built.
   GET /decades -> {ok, decades:[{d, n, dir, al, ar}]}; GET /decadealbums?d=1990 -> {ok, albums:[{dir, al, ar, y}]} (year from the Date tag).
   GET /yearalbums?y=1984 -> {ok, albums}; GET /decadeprofile?d=1980 -> {ok, n, artists, moods, styles, decades} (Discover).
   /albumgenre also returns years:[…] (0 = unknown), with st=1 styles:[…] (strongest style of the album, '' = none),
   with fi=1 infos:[{dir, fi: {ext, bits, rate, codec, n, s}} or 0] (file type, tracks, duration for the album lists).
   Substyles come from the audio analysis (tools/essentia), per album within its genre */
var albumYear = null;
function albumGenreFn() {
  var gi = albumIdx && albumIdx.list;
  if (gi && (!albumGenre || albumGenre.list !== gi)) albumGenre = {list: gi, fn: albums.genreIndex(gi)};
  return gi ? albumGenre.fn : null;
}
var genreSubs = null;
function genreSubsIdx(list) {
  var tl = libTracksLoad() || [], st = audioStore.status();
  if (!genreSubs || genreSubs.list !== list || genreSubs.tl !== tl || genreSubs.at !== st.at) {
    var shares = {};
    genreSubs = {list: list, tl: tl, at: st.at, shares: shares,
                 idx: st.tracks ? genres.subsIndex(list, tl, function(ar, ti, al){ return audioStore.get(ar, ti, al); }, albums.albumDir, shares) : {}};
  }
  return genreSubs.idx;
}
/* GET /versions?u=<folder or Volumio address>&al=&ar= -> {ok, versions: [{dir, al, ext, bits, rate, codec, tracks, seconds, best, y}]}
   (tags/versions.js); empty if the album exists only once */
var versionsIdx = null;
function versionsFind(list) {
  var groups = (albumIdx && albumIdx.versions) || [];
  if (!versionsIdx || versionsIdx.groups !== groups || versionsIdx.list !== list) {
    var years = {};
    list.forEach(function(a){ if (a.y) years[a.dir] = a.y; });
    versionsIdx = {groups: groups, list: list, find: versions.index(groups, libcheck.artistKey), year: function(d){ return years[d] || 0; }};
  }
  return versionsIdx;
}
function histRelDir(u) { return /^[a-z]+:\/\//i.test(u || '') ? '' : String(u || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''); }
/* album lists (genre, decade, year): each album once, with the number of versions (nv) */
function versionsCollapse(list, al) { return versions.collapse(al, versionsFind(list).find); }
function versionsAnswer(list, query) {
  versionsFind(list);
  var g = versionsIdx.find(query.u, String(query.al || ''), String(query.ar || ''));
  if (!g) return {ok: true, versions: []};
  var r = versions.answer(g, versionsIdx.year);
  r.ok = true;
  return r;
}
function doGenreLib(route, query, cb) {
  albumsEnsure(function(list){
    if (!list) return cb(200, {ok: false, building: true});
    if (route === '/genrelist') {
      var q = String(query.q || '').trim();
      return cb(200, {ok: true, genres: albums.genreList(list, q), subs: q ? genres.subList(list, genreSubsIdx(list), '', q) : []});
    }
    if (route === '/decades') return cb(200, {ok: true, decades: albums.decadeList(list)});
    if (route === '/decadealbums') return cb(200, {ok: true, albums: versionsCollapse(list, albums.decadeAlbums(list, query.d))});
    if (route === '/yearalbums') return cb(200, {ok: true, albums: versionsCollapse(list, albums.yearAlbums(list, query.y))});
    if (route === '/decadeprofile') {
      var d = parseInt(query.d, 10);
      if (!(d >= 1900 && d < 2100) || d % 10) return cb(400, {ok: false, error: 'invalid d'});
      var pr = moodalbums.decadeProfile(moodmix.index(moodCollector), list, d, albums.albumDir);
      pr.ok = true;
      return cb(200, pr);
    }
    if (route === '/versions') return cb(200, versionsAnswer(list, query));
    if (route === '/genrealbums') {
      var idx = genreSubsIdx(list);
      var al = versionsCollapse(list, albums.genreAlbums(list, query.g));
      al.forEach(function(a){ if (idx[a.dir]) { a.st = idx[a.dir]; a.sp = genreSubs.shares[a.dir]; } });   /* substyles and their share in % */
      return cb(200, {ok: true, albums: al, subs: genres.subList(list, idx, query.g)});
    }
    q = [];
    try { q = JSON.parse(String(query.q || '[]')); } catch (e) { return cb(400, {ok: false, error: 'invalid q'}); }
    if (!Array.isArray(q) || q.length > 500) return cb(400, {ok: false, error: 'invalid q'});
    var fn = albumGenreFn();
    if (!albumYear || albumYear.list !== list) {
      var byDir = {};
      list.forEach(function(a){ byDir[a.dir] = a; });
      albumYear = {list: list, fn: albums.yearIndex(list), dir: albums.dirIndex(list), byDir: byDir};
    }
    var es = q.map(function(x){ x = Array.isArray(x) ? x : []; return {u: String(x[0] || ''), al: String(x[1] || ''), ar: String(x[2] || '')}; });
    var subs = query.st === '1' ? genreSubsIdx(list) : null;   /* strongest style of the album (player view) */
    var vf = versionsFind(list).find;                 /* album versions: [best folder, number, place of this one] or 0 */
    cb(200, {ok: true, genres: es.map(fn), years: es.map(albumYear.fn),
             versions: es.map(function(e){ var d = albumYear.dir(e) || histRelDir(e.u); return versions.mark(vf(d, e.al, e.ar), d); }),
             styles: subs ? es.map(function(e){ var d = albumYear.dir(e); return (d && subs[d] && subs[d][0]) || ''; }) : undefined,
             infos: query.fi === '1' ? es.map(function(e){ var d = albumYear.dir(e), a = d && albumYear.byDir[d]; return a && a.fi ? {dir: d, fi: a.fi} : 0; }) : undefined});
  });
}

function doMoodtags(query, cb) {
  if (query.artist || query.title) {
    var ar = String(query.artist || ''), ti = String(query.title || ''), k = moodtags.trackKey(ar, ti);
    var t = moodCollector.tracks[k], a = moodCollector.artists[moodtags.artistKey(ar)], au = audioStore.get(ar, ti, query.album);
    return cb(200, {ok: true, track: t ? t.g : null, artist: a ? a.g : null, audio: au ? strip(au) : null,
                    result: moodCollector.moodOf(ar, ti, query.album)});
  }
  cb(200, {ok: true, enabled: moodCollector.running, status: moodCollector.status(), summary: moodCollector.summary(),
           audio: audioStore.status()});
}
function strip(o) { var r = {}; Object.keys(o).forEach(function(k){ if (k.charAt(0) !== '_') r[k] = o[k]; }); return r; }

/* POST /essentia: the analysis script's result file (JSON Lines) replaces the current one.
   With a password for the services (adminpass.js) only with it, in the header X-Xplorio-Password */
function doEssentiaUpload(req, res) {
  if (essentiaBusy) { req.resume(); return send(res, 409, {ok: false, error: 'an upload is already running'}); }
  if (Number(req.headers['content-length']) > ESSENTIA_MAX) { req.resume(); return send(res, 413, {ok: false, error: 'file too large'}); }
  if (!adminAuth.isSet()) return essentiaReceive(req, res);
  req.pause();
  adminAuth.verify(String(req.headers['x-xplorio-password'] || ''), 0, function(r){
    if (!r.ok) { req.resume(); return send(res, 200, {ok: false, error: r.error === 'locked' ? 'locked' : 'auth', wait: r.wait || 0}); }
    if (req.aborted || req.destroyed) return;                 /* gone while checking */
    if (essentiaBusy) { req.resume(); return send(res, 409, {ok: false, error: 'an upload is already running'}); }
    essentiaReceive(req, res);
    req.resume();
  });
}
function essentiaReceive(req, res) {
  try { mkdirs(DATA_DIR); } catch (e) { /* exists */ }
  essentiaBusy = true;
  var tmp = ESSENTIA_FILE + '.neu', out = fs.createWriteStream(tmp), size = 0, failed = false, ended = false;
  function fail(code, msg) {
    if (failed) return; failed = true; essentiaBusy = false;
    req.unpipe(out); out.destroy(); try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ }
    if (!res.headersSent) send(res, code, {ok: false, error: msg});
  }
  req.on('data', function(d){ size += d.length; if (size > ESSENTIA_MAX) { fail(413, 'file too large'); req.destroy(); } });
  req.on('end', function(){ ended = true; });
  req.on('error', function(){ fail(400, 'transfer aborted'); });
  req.on('aborted', function(){ fail(400, 'transfer aborted'); });
  req.on('close', function(){ if (!ended) fail(400, 'transfer aborted'); });     /* connection lost: do not leave the file open */
  out.on('error', function(e){ fail(500, 'write failed: ' + e.message); });
  out.on('finish', function(){
    if (failed) return;
    essentiaBusy = false;
    try { fs.renameSync(tmp, ESSENTIA_FILE); } catch (e) { return fail(500, 'saving failed'); }
    audioStore.reload(true);
    var st = audioStore.status(), lib = moodCollector.loadLib(), matched = 0;
    lib.forEach(function(it){ if (audioStore.get(it.ar, it.ti, it.al)) matched++; });
    send(res, 200, {ok: true, tracks: st.tracks, library: lib.length, matched: matched, full: !!audioStore.full});
  });
  req.pipe(out);
}

/* GET /moodmix?moods=a,b&emin=&emax=&styles=&match=any|all&genres=&n=&disc=0..1 -> {ok, level, matches, tracks}
   with count=1 only {ok, count, rated, styles, genres} (hit count, style and genre chips) */
var moodmix = require('./moodmix.js');
var mixPlays = null;
/* GET /moodalbums?moods=a,b | styles=a,b | emin=&emax= -> {ok, albums:[{dir, al, ar, y}]}: albums whose classified tracks
   mostly carry this mood or style, or whose average energy lies in the range (moodalbums.js) */
var moodalbums = require('./moodalbums.js'), moodAlbumSums = null;
function doMoodAlbums(query, cb) {
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding});
    var c = moodmix.parse(query), idx = moodmix.index(moodCollector);
    if (!moodAlbumSums || moodAlbumSums.idx !== idx) moodAlbumSums = {idx: idx, sums: moodalbums.summarize(idx)};
    var q = {moods: c.moods, styles: c.styles, emin: query.emin ? c.emin : 0, emax: query.emax ? c.emax : 0};
    var d = parseInt(query.d, 10);                       /* only albums of this decade (Discover on the year/decade page) */
    if (d >= 1900 && d <= 2090 && d % 10 === 0) list = list.filter(function(a){ return a.y && a.y - a.y % 10 === d; });
    cb(200, {ok: true, albums: moodalbums.list(moodAlbumSums.sums, list, q)});
  });
}

/* GET /artistprofile?artist=… -> {ok, n, moods, styles, energy, decades} ("Discover more" on the artist page) */
function doArtistProfile(query, cb) {
  var artist = String(query.artist || '').trim();
  if (!artist) return cb(400, {ok: false, error: 'artist missing'});
  albumsEnsure(function(list){
    var r = moodalbums.artistProfile(moodmix.index(moodCollector), list || [], plays.norm(artist), plays.norm);
    r.ok = true;
    cb(200, r);
  });
}

/* GET /albumprofile?artist=…&album=…[&dir=…] -> Discover on the album page (moodalbums.albumProfile) */
function doAlbumProfile(query, cb) {
  var artist = String(query.artist || '').trim(), album = String(query.album || '').trim(), dir = relUri(query.dir || '').replace(/\/+$/, '');
  if (!album && !dir) return cb(400, {ok: false, error: 'album missing'});
  albumsEnsure(function(list){
    if (!list) return cb(200, {ok: false, building: true});              /* album list is being built for the first time */
    var r = moodalbums.albumProfile(moodmix.index(moodCollector), list, {dir: dir, artist: artist, album: album}, plays.norm);
    r.ok = true;
    cb(200, r);
  });
}

/* GET /similar?file=…&artist=…&title=…&album=…[&shuffle=1] -> {ok, seed: {mood, energy, bpm, style}, items: [{f, ar, ti, al, d, why}]}
   (More like this track); without mood data for the track {ok: false, nodata: true} */
var similar = require('./similar.js');
function doSimilar(query, cb) {
  albumsEnsure();
  var idx = moodmix.index(moodCollector), bad = mixExcluded();
  var seed = similar.seedOf(idx, {f: relUri(query.file), ar: String(query.artist || ''), ti: String(query.title || ''), al: String(query.album || '')},
    function(ar, ti, al){ return moodCollector.moodOf(ar, ti, al); });
  if (!seed) return cb(200, {ok: false, nodata: true, items: []});
  var recent = query.shuffle === '1' ? discover.recentFn(discoverStats(playStore.load()), Math.floor(Date.now() / 1000)) : null;
  var list = similar.pick(idx, seed, {n: 25, shuffle: query.shuffle === '1', skip: function(it){ return !!bad[ratings.trackKey(it.f)]; },
    recent: recent && function(it){ return recent([it.ar, it.ti]); }});
  if (query.shuffle === '1') list = discover.mix(list.map(function(x){ return [x.it.ar, x.it.ti, x.it.f, x.it.d, x.it.al, x]; }), list.length).map(function(t){ return t[5]; });
  cb(200, {ok: true, seed: {mood: seed.r.mood || [], energy: seed.r.energy, bpm: seed.r.bpm || null, style: seed.r.style || []},
    items: list.map(function(x){ return {f: relUri(x.it.f) || x.it.f, ar: x.it.ar, ti: x.it.ti, al: x.it.al || '', d: x.it.d || 0, why: similar.why(seed.r, x.r)}; })});
}

/* album year per track (albums.json, most common Date tag in the folder); range of known years for the slider */
var mixYears = null;
function mixYearsOf(list) {
  if (!mixYears || mixYears.list !== list) {
    var by = {}, lo = 0, hi = 0;
    (list || []).forEach(function(a){
      if (!a.y) return;
      by[a.dir] = a.y;
      if (!lo || a.y < lo) lo = a.y;
      if (a.y > hi) hi = a.y;
    });
    mixYears = {list: list, by: by, span: lo ? [lo, hi] : null};
  }
  return mixYears;
}
function doMoodmix(query, cb) {
  albumsEnsure();                                        /* keeps library-tracks.json (with genre) and albums.json current */
  var c = moodmix.parse(query), yrs = mixYearsOf(albumIdx && albumIdx.list);   /* do not wait: no years until the first album list exists */
  var bad = mixExcluded();
  c.skip = function(it){ return !!bad[ratings.trackKey(it.f)]; };
  c.yearOf = function(it){ return yrs.by[albums.albumDir(relUri(it.f) || it.f)] || 0; };
  if (query.count) { var r = moodmix.count(moodCollector, c); r.ok = true; r.years = yrs.span; return cb(200, r); }
  var pl = playStore.load();
  if (!mixPlays || mixPlays.n !== pl.length) mixPlays = {n: pl.length, pc: moodmix.playCounts(pl)};
  var m = moodmix.build(moodCollector, mixPlays.pc, c);
  m.ok = true;
  m.tracks.forEach(function(t){ t.y = c.yearOf(t) || null; t.f = relUri(t.f) || t.f; });
  cb(200, m);
}

var artistPicks = [], trackPicks = [], libTracks = null, artistList = null, libTracksUsed = 0;
/* library track list (library-tracks.json), reread when the file has changed */
function libTracksLoad() {
  var st;
  try { st = fs.statSync(TRACKS_FILE); } catch (e) { return null; }
  libTracksUsed = Date.now();
  if (!libTracks || libTracks.m !== +st.mtime) {
    try { libTracks = {m: +st.mtime, list: JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'))}; } catch (e) { return libTracks && libTracks.list; }
  }
  return libTracks.list;
}

function doRandom(query, cb) {
  var kind = query.kind === 'artist' || query.kind === 'track' ? query.kind : 'album';
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding, error: albumBuilding ? null : 'no albums found'});
    var pl = playStore.load(), now = Math.floor(Date.now() / 1000);
    if (kind === 'artist') {
      if (!artistList || artistList.src !== list) artistList = {src: list, list: albums.artists(list)};
      var ar = albums.pickArtist(artistList.list, albums.lastArtistIndex(pl), now, artistPicks);
      return cb(200, ar ? {ok: true, artist: ar} : {ok: false, error: 'no artists found'});
    }
    if (kind === 'track') {
      var tl = libTracksLoad();
      if (!tl || !tl.length) return cb(200, {ok: false, building: albumBuilding, error: 'no tracks found'});
      return cb(200, {ok: true, track: albums.pickTrack(tl, albums.lastTrackIndex(pl), now, trackPicks)});
    }
    if (!albumLast || albumLast.n !== pl.length) albumLast = {n: pl.length, fn: albums.lastIndex(pl)};
    cb(200, {ok: true, album: albums.pick(list, albumLast.fn, now, albumPicks)});
  });
}

/* ---------- Discover and random mix (discover.js) ---------- */
/* GET /discover?kind=artist|album|track -> {ok, shelves: [{id: random|forgotten|never|oldfav, items}]}
   POST /randommix {artist}, {artists: [...]}, {dirs: [...]} or {shelf: random|gems|ago|forgotten|never|oldfav[, tzw, tzs]}
   -> {ok, items: [{f, ar, ti, al, d}]} (25 tracks, dice next to "Play all" or on the Discover rows) */
var discover = require('./discover.js');
var ratings  = require('./ratings.js');
var discStats = null;
function discoverStats(pl) {
  if (!discStats || discStats.n !== pl.length || discStats.first !== (pl[0] && pl[0].t)) discStats = {n: pl.length, first: pl[0] && pl[0].t, idx: discover.statIndex(pl)};
  return discStats.idx;
}
function doDiscover(query, cb) {
  var kind = query.kind === 'artist' || query.kind === 'track' ? query.kind : 'album';
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding});
    var ents = list;
    if (kind === 'artist') {
      if (!artistList || artistList.src !== list) artistList = {src: list, list: albums.artists(list)};
      ents = artistList.list;
    }
    if (kind === 'track') { var bad = ratingStore.disliked(); ents = (libTracksLoad() || []).filter(function(t){ return !bad[t[2]]; }); }
    if (!ents.length) return cb(200, {ok: false, building: albumBuilding});
    var now = Math.floor(Date.now() / 1000);
    cb(200, {ok: true, shelves: discover.shelves(kind, ents, discoverStats(playStore.load()), now)});
  });
}
/* ---------- Welcome ---------- */
/* GET /welcome?day=2026-10-09 (listener's local date) -> {ok, day: {dir, al, ar, y, last}, recent: [{ti, ar, u, y, last}], fresh: [{dir, al, ar, y, m}],
   birthdays: {today, week, month: [{dir, al, ar, y, date, years, mark}]}, dates: {albums, dated, fetched, running}}.
   The album of the day stays the same all day, even if it has been played meanwhile (welcome.json) */
var WELCOME_FILE = path.join(DATA_DIR, 'welcome.json');
var releasedates = require('./releasedates.js');          /* release dates (Date tag, otherwise MusicBrainz) for the birthdays */
var releaseDates = new releasedates.Collector({file: path.join(DATA_DIR, 'releasedates.jsonl'), list: function(){ return albumIdx && albumIdx.list; },
  extra: releaseExtra});
/* usual spelling of the artists (MusicBrainz, Last.fm) for the library check; slower while the release dates are looked up */
var artistnames = require('./artistnames.js');
var artistNames = new artistnames.Collector({file: path.join(DATA_DIR, 'artistnames.jsonl'),
  names: function(){
    var tl = libTracksLoad(), seen = {}, out = [];
    function add(n) { if (n && !seen[n]) { seen[n] = 1; out.push(n); } }
    ((albumIdx && albumIdx.list) || []).forEach(function(a){ if (a.ar !== 'Verschiedene') add(a.ar); });
    (tl || []).forEach(function(t){ add(t[0]); });
    return out;
  },
  lastfmKey: function(){ return keys.lastfm().key || ''; },
  busy: function(){ return releaseDates.running && !!releaseDates.next(Math.floor(Date.now() / 1000)); }});
var welcomeDay = null;
function doWelcome(query, cb) {
  var day = /^\d{4}-\d\d-\d\d$/.test(query.day || '') ? query.day : new Date().toISOString().slice(0, 10);
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding});
    var pl = playStore.load(), now = Math.floor(Date.now() / 1000);
    if (!albumYear || albumYear.list !== list) albumYear = {list: list, fn: albums.yearIndex(list)};
    if (!albumLast || albumLast.n !== pl.length) albumLast = {n: pl.length, fn: albums.lastIndex(pl)};
    var yearOf = albumYear.fn, last = albumLast.fn;
    if (!welcomeDay) { try { welcomeDay = JSON.parse(fs.readFileSync(WELCOME_FILE, 'utf8')); } catch (e) { welcomeDay = {}; } }
    var pick = null;
    if (welcomeDay.day === day) list.some(function(a){ return a.dir === welcomeDay.dir && (pick = a); });
    if (pick) pick = {dir: pick.dir, al: pick.al, ar: pick.ar, y: pick.y, last: last(pick)};
    else {
      pick = albums.dayAlbum(list, day, last, now);
      welcomeDay = {day: day, dir: pick && pick.dir};
      try { writeAtomic(WELCOME_FILE, JSON.stringify(welcomeDay)); } catch (e) { /* then it is simply picked again */ }
    }
    var recent = plays.recentAlbums(pl, 8);
    recent.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; var y = yearOf({u: it.u, al: it.ti, ar: it.ar}); if (y) it.y = y; });
    var tz = {w: parseInt(query.tzw, 10) || 0, s: parseInt(query.tzs, 10) || 0};
    var ago = plays.ago(pl, now, tz, 8, 'album');        /* played around this time X years ago (like the row in Discover) */
    ago.items.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; var y = yearOf({u: it.u, al: it.ti, ar: it.ar}); if (y) it.y = y; });
    cb(200, {ok: true, day: pick, recent: recent, fresh: albums.freshAlbums(list, now, 8), ago: ago.items.length ? ago : null,
             birthdays: releasedates.birthdays(list, function(a){ return releaseDates.dateOf(a); }, day), dates: releaseDates.status()});
  });
}

/* ---------- "Did you mean …?" (suggest.js) ---------- */
/* GET /suggest?q=motorhed -> {ok, items: [{kind: artist|album, name, ar}]}; only asked when the local search found nothing */
var suggest = require('./suggest.js'), suggestIdx = null;
function doSuggest(query, cb) {
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding});
    if (!suggestIdx || suggestIdx.list !== list) suggestIdx = {list: list, idx: suggest.index(list)};
    cb(200, {ok: true, items: suggest.suggest(suggestIdx.idx, String(query.q || '').slice(0, 100))});
  });
}

/* ---------- Hidden gems (gems.js) ---------- */
/* GET /gems?kind=artist|album|track -> {ok, items: [{…, why: {why: artist|like|tags, ar, mood, ge}}]} */
var gems = require('./gems.js'), gemState = null, favState = {at: 0, map: {}, rev: 0, loading: false};
/* Volumio favourites (thumbs up) -> {file: true}; asked at most once a minute, last known state on errors */
function volumioFavs(cb) {
  if (Date.now() - favState.at < 60000 || favState.loading) return cb(favState);
  favState.loading = true;
  var finished = false;
  function done(map) {
    if (finished) return;
    finished = true;
    favState.loading = false; favState.at = Date.now();
    if (map && Object.keys(map).sort().join('\n') !== Object.keys(favState.map).sort().join('\n')) { favState.map = map; favState.rev++; }
    cb(favState);
  }
  var req = http.get(VOLUMIO_URL + '/api/v1/browse?uri=favourites', function(res){
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function(d){ data += d; if (data.length > 20 * 1024 * 1024) { req.abort(); done(null); } });
    res.on('aborted', function(){ done(null); });
    res.on('end', function(){
      if (finished) return;
      var map = {};
      try {
        ((JSON.parse(data).navigation || {}).lists || []).forEach(function(l){
          (l.items || []).forEach(function(it){ var f = relUri(it.uri); if (f) map[f] = true; });
        });
      } catch (e) { return done(null); }
      done(map);
    });
  });
  req.setTimeout(5000, function(){ req.abort(); done(null); });
  req.on('error', function(){ done(null); });
}
/* unused for LIB_IDLE_MS: the track list and everything built from it leave memory (20-30 MB with 50,000 tracks);
   the next dice mix, gems or mood request reads it again (a second or two on the player) */
var LIB_IDLE_MS = +process.env.LIB_IDLE_MS || 30 * 60000;
function libRelease(now) {
  if (!libTracks || now - libTracksUsed < LIB_IDLE_MS) return false;
  libTracks = null; genreSubs = null; mixEx = null; gemState = null;
  moodCollector.release();
  return true;
}
setInterval(function(){ libRelease(Date.now()); }, Math.min(60000, LIB_IDLE_MS)).unref();

/* prepared taste for the gems (gems.prepare), rebuilt only when library, history, ratings or favourites change */
function gemsReady(cb) {
  albumsEnsure(function(list){
    var tl = libTracksLoad();
    if (!list || !list.length || !tl || !tl.length) return cb(null);
    volumioFavs(function(fs_){
      var pl = playStore.load(), idx = moodmix.index(moodCollector);
      var stamp = [libTracks.m, list.length, pl.length, ratingStore.rev, fs_.rev].join(':');
      if (!gemState || gemState.stamp !== stamp || gemState.idx !== idx || gemState.list !== list) {
        var moods = {};
        idx.forEach(function(x){ moods[x.it.f] = x.r; });
        if (!artistList || artistList.src !== list) artistList = {src: list, list: albums.artists(list)};
        gemState = {stamp: stamp, idx: idx, list: list, g: gems.prepare({
          lib: tl, moodOf: function(f){ return moods[f] || null; }, albums: list, artists: artistList.list,
          rated: ratingStore.load(), favs: fs_.map, stats: discoverStats(pl)})};
      }
      cb(gemState.g);
    });
  });
}
function doGems(query, cb) {
  var kind = query.kind === 'artist' || query.kind === 'track' ? query.kind : 'album';
  gemsReady(function(g){
    if (!g) return cb(200, {ok: false, building: albumBuilding, items: []});
    cb(200, {ok: true, items: gems.pick(g, kind)});
  });
}

/* ---------- Goes together (together.js) ---------- */
/* GET /together?day=YYYY-MM-DD[&reroll=1]: mixes of the day from 2–3 matching artists; the anchors' Last.fm
   "similar artists" count too (if a key is set). together.json remembers shown pairings for 7 days so they do not
   repeat right away. GET /togethermix?ar=…&ar=…[&day=…][&shuffle=1]: the tracks of a mix. */
var together = require('./together.js');
var TOGETHER_FILE = path.join(DATA_DIR, 'together.json'), TOGETHER_KEEP = 7;
function togetherLoad() { try { return JSON.parse(fs.readFileSync(TOGETHER_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function togetherSave(all) {
  var out = {};
  Object.keys(all).sort().slice(-TOGETHER_KEEP).forEach(function(d){ out[d] = all[d]; });
  try { mkdirs(DATA_DIR); fs.writeFileSync(TOGETHER_FILE + '.neu', JSON.stringify(out)); fs.renameSync(TOGETHER_FILE + '.neu', TOGETHER_FILE); }
  catch (e) { console.error('together.json: ' + e.message); }
}
/* Last.fm: similar artists of the anchors as {ak: {ak: true}}; doLastfmApi caches the responses for 6 h */
function togetherSimilar(g, cb) {
  if (!keys.lastfm().key) return cb({});
  var list = together.anchors(g), map = {}, left = list.length, done = false;
  function fin() { if (!done) { done = true; cb(map); } }
  if (!left) return fin();
  var timer = setTimeout(fin, 8000);                     /* a slow Last.fm does not hold up the page */
  list.forEach(function(a){
    doLastfmApi({method: 'artist.getsimilar', artist: a.ar, limit: 100}, function(c, d){
      var sim = d && d.similarartists && d.similarartists.artist;
      if (Array.isArray(sim)) {
        var m = map[a.ak] = {};
        sim.forEach(function(s){ if (s && s.name) m[plays.norm(s.name)] = true; });
      }
      if (--left === 0) { clearTimeout(timer); fin(); }
    });
  });
}
/* together.json: {day: {items: [mixes], seen: [keys of all pairings shown on that day]}};
   a day's mixes stay the same until you reroll */
function doTogether(query, cb) {
  var day = /^\d{4}-\d\d-\d\d$/.test(query.day || '') ? query.day : new Date().toISOString().slice(0, 10);
  var reroll = query.reroll === '1', all = togetherLoad(), today = all[day];
  if (today && !Array.isArray(today.items)) today = null;
  if (today && !reroll && today.items.length) return cb(200, {ok: true, items: today.items});
  gemsReady(function(g){
    if (!g) return cb(200, {ok: false, building: albumBuilding, items: []});
    togetherSimilar(g, function(sim){
      var avoid = {};
      Object.keys(all).forEach(function(d){ ((all[d] && all[d].seen) || []).forEach(function(k){ avoid[k] = true; }); });
      var rnd = together.seeded(day + (reroll ? ':' + Date.now() : ''));
      var items = together.build(g, {rnd: rnd, similar: sim, avoid: avoid});
      if (!items.length) items = together.build(g, {rnd: rnd, similar: sim});   /* everything shown already: then repeat */
      var seen = ((today && today.seen) || []).concat(items.map(function(it){ return it.key; }));
      all[day] = {items: items, seen: seen.filter(function(k, i){ return seen.indexOf(k) === i; }).slice(-60)};
      togetherSave(all);
      cb(200, {ok: true, items: items});
    });
  });
}
function doTogetherMix(query, cb) {
  var names = [].concat(query.ar || []).slice(0, 3).map(String);
  if (names.length < 2) return cb(400, {ok: false, error: 'at least two artists (ar) required'});
  var day = /^\d{4}-\d\d-\d\d$/.test(query.day || '') ? query.day : new Date().toISOString().slice(0, 10);
  gemsReady(function(g){
    if (!g) return cb(200, {ok: false, building: albumBuilding, items: []});
    var rnd = query.shuffle === '1' ? Math.random : together.seeded(day + '|' + names.map(plays.norm).sort().join('+'));
    cb(200, {ok: true, items: together.mix(g, names, {rnd: rnd, bad: mixExcluded()})});
  });
}

/* ---------- Ratings (ratings.js) ---------- */
/* POST /ratings {artist, album, tracks: [uri, …]} -> {ok, artist, album, tracks}; POST /rate {kind, v, name | uri, ar, al, ti} */
var ratingStore = new ratings.Store(path.join(DATA_DIR, 'ratings.json'));
/* never in a mix: "don't like" and NoMix in the comment (nomix.js); cached until ratings, list, tracks or analysis change */
var nomix = require('./nomix.js'), nomixStore = new nomix.Store(path.join(DATA_DIR, 'nomix.json')), mixEx = null;
/* album versions: only the version with the most stars (else the best quality) plays in a mix (versions.js) */
function mixExcluded() {
  var tl = libTracksLoad() || [], stamp = ratingStore.rev + ':' + nomixStore.rev + ':' + audioStore.status().at;
  var vg = (albumIdx && albumIdx.versions) || [];
  if (!mixEx || mixEx.tl !== tl || mixEx.stamp !== stamp || mixEx.vg !== vg) {
    var map = nomixStore.excluded(ratingStore.disliked(), tl, function(ar, ti, al){ return audioStore.get(ar, ti, al); });
    var rated = ratingStore.load().albums;
    var ver = versions.excluded(vg, tl, function(dir){ var r = Object.prototype.hasOwnProperty.call(rated, dir) && rated[dir]; return r ? r.v : 0; },
                                function(ti){ return duplicates.albumKey(ti, libcheck.artistKey); });
    var all = {};
    Object.keys(map).forEach(function(f){ all[f] = true; });
    Object.keys(ver).forEach(function(f){ all[f] = true; });
    mixEx = {tl: tl, stamp: stamp, vg: vg, map: all, base: map};
  }
  return mixEx.map;
}
/* the same without the album versions (e.g. a mix from given album folders) */
function mixExcludedBase() {
  mixExcluded();
  return mixEx.base;
}
function doRatings(body, cb) {
  if (Array.isArray(body.tracks) && body.tracks.length > MAX_ITEMS) return cb(400, {ok: false, error: 'too many tracks'});
  var out = ratingStore.get(body);
  out.ok = true;
  cb(200, out);
}
function doRate(body, cb) {
  var v;
  try { v = ratingStore.set(body); } catch (e) { return cb(500, {ok: false, error: 'saving failed'}); }
  if (v === null) return cb(400, {ok: false, error: 'invalid rating'});
  cb(200, {ok: true, v: v});
}

var SHELF_MIX = ['random', 'gems', 'ago', 'forgotten', 'never', 'oldfav'];
function doRandomMix(body, cb) {
  var many = Array.isArray(body.artists) ? body.artists.slice(0, 50).map(String) : [];
  var shelf = SHELF_MIX.indexOf(body.shelf) >= 0 ? body.shelf : '';
  if (!shelf && !body.artist && !many.length && !(body.dirs && body.dirs.length)) return cb(400, {ok: false, error: 'artist, artists, dirs or shelf missing'});
  albumsEnsure(function(list){
    var tl = libTracksLoad();
    if (!tl || !tl.length) return cb(200, {ok: false, building: albumBuilding, items: []});
    var n = Math.min(parseInt(body.n, 10) || 25, 100), bad = mixExcluded(), base = mixExcludedBase(), asked = {};
    [].concat(body.dirs || []).slice(0, 5000).forEach(function(d){ asked[String(d)] = true; });
    tl = tl.filter(function(t){                                        /* never "don't like" or NoMix in the dice mix */
      return !bad[t[2]] || (!base[t[2]] && asked[albums.albumDir(t[2])]);   /* another album version asked for by its folder */
    });
    function send(picked) {
      cb(200, {ok: true, items: picked.map(function(t){ return {f: t[2], ar: t[0], ti: t[1], al: t[4] || '', d: t[3] || 0}; })});
    }
    /* dice rules: at most 3 per artist (not on the artist page) and 2 per album (artist page 3),
       tracks played in the last 14 days only if there is too little otherwise */
    var pl = playStore.load(), now = Math.floor(Date.now() / 1000);
    var rules = {artist: body.artist ? 0 : 3, album: body.artist ? 3 : 2, recent: discover.recentFn(discoverStats(pl), now)};
    if (shelf) {                                                        /* Discover row: tracks of the whole row */
      var extra = {};
      if (shelf === 'ago') {
        var tz = {w: parseInt(body.tzw, 10) || 0, s: parseInt(body.tzs, 10) || 0};
        extra.keys = {};
        plays.ago(pl, now, tz, 500, 'track').items.forEach(function(it){ extra.keys[plays.norm(it.ar) + '|' + plays.norm(it.ti)] = true; });
      }
      var kind = body.kind === 'artist' || body.kind === 'album' ? body.kind : '';
      if (kind && shelf !== 'random' && shelf !== 'ago') {           /* artists/albums tab: tracks of the row's artists or albums */
        if (shelf !== 'gems') {
          var shKeys = discover.shelfKeys(shelf, kind, kind === 'artist' ? albums.artists(list || []) : list || [], discoverStats(pl), now);
          var gp = discover.groupPool(tl, list, kind, shKeys);
          if (gp.length) return send(discover.mixCapped(gp, n, rules));   /* otherwise (album list still being built) as in the tracks tab */
        } else return gemsReady(function(g){
          if (!g) return cb(200, {ok: false, building: albumBuilding, items: []});
          var gk = {};
          gems.pick(g, kind, 100).forEach(function(it){ gk[kind === 'artist' ? plays.norm(it.ar) : it.dir] = true; });
          send(discover.mixCapped(discover.groupPool(tl, list, kind, gk), n, rules));
        });
      }
      if (shelf !== 'gems') return send(discover.mixCapped(discover.shelfPool(shelf, tl, discoverStats(pl), now, extra), n, rules));
      return gemsReady(function(g){
        if (!g) return cb(200, {ok: false, building: albumBuilding, items: []});
        extra.files = {};
        gems.pick(g, 'track', 100).forEach(function(it){ extra.files[it.f] = true; });
        send(discover.mixCapped(discover.shelfPool('gems', tl, null, now, extra), n, rules));
      });
    }
    var pool = discover.mixPool(tl, list, {artist: body.artist, artists: many, dirs: [].concat(body.dirs || []).slice(0, 5000)});
    if (body.match) {                                                   /* mood/style page: only tracks that match themselves */
      var mq = url.parse('?' + String(body.match).slice(0, 1000), true).query, mc = moodmix.parse(mq);
      var hits = moodalbums.tracksMatching(moodmix.index(moodCollector), {moods: mc.moods, styles: mc.styles,
        emin: mq.emin ? mc.emin : 0, emax: mq.emax ? mc.emax : 0});
      var matched = pool.filter(function(t){ return hits[relUri(t[2])]; });
      if (matched.length) pool = matched;
    }
    send(many.length ? discover.mixBalanced(pool, n, list, null, rules.recent) : discover.mixCapped(pool, n, rules));   /* similar artists: evenly */
  });
}

/* GET /plays/resolve?artist=…&title=…: local file for a track from the history (e.g. imported from Last.fm) */
function doResolve(query, cb) {
  var artist = String(query.artist || '').trim(), title = String(query.title || '').trim();
  if (!artist || !title) return cb(400, {ok: false, error: 'artist and title required'});
  function find(how, done) {
    cp.execFile(MPC, ['-f', '%file%', how, 'artist', artist, 'title', title], {timeout: 15000, maxBuffer: 4 * 1024 * 1024}, function(e, out){
      done(e ? [] : String(out).split('\n').filter(Boolean));
    });
  }
  find('find', function(hits){
    if (hits.length) return cb(200, {ok: true, file: hits[0]});
    find('search', function(more){
      var want = plays.norm(title);
      var exact = more.filter(function(f){ return plays.norm(path.basename(f).replace(/\.[^.]+$/, '')).indexOf(want) >= 0; });
      cb(200, {ok: true, file: exact[0] || more[0] || null});
    });
  });
}

function doLastfm(body, cb) {
  var a = body.action;
  if (a === 'connect') return lfm.connect(function(e, u){ cb(200, e ? {ok: false, error: e} : {ok: true, url: u}); });
  if (a === 'finish') return lfm.finish(function(e){
    if (e) return cb(200, {ok: false, error: e});
    if (!lfm.state.importedTo) lfm.importAll();          /* fetch the history right away on first connect */
    cb(200, {ok: true, status: lfm.status()});
  });
  if (a === 'disconnect') { lfm.disconnect(); return cb(200, {ok: true, status: lfm.status()}); }
  if (a === 'import') {
    if (!lfm.state.user) return cb(200, {ok: false, error: 'Connect to Last.fm first'});
    lfm.importAll();
    return cb(200, {ok: true, status: lfm.status()});
  }
  if (a === 'send') { lfm.flush(); return cb(200, {ok: true, status: lfm.status()}); }
  cb(400, {ok: false, error: 'unknown action'});
}

/* GET /artistimage?name=…: artist photo (Deezer, stored on the player under artists/); 404 without photo */
var artistimg = require('./artistimg.js');
/* at most 10,000 photos (usually about 300 MB, never more than 500 MB): older ones are deleted and loaded again when needed */
var artistImages = new artistimg.Store(path.join(DATA_DIR, 'artists'), {max: 10000, maxBytes: 500 * 1024 * 1024});
function sendBusy(res) { res.writeHead(503, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Retry-After': '5'}); res.end(); }

function doArtistImage(query, res) {
  var name = String(query.name || '').trim();
  if (!name || name.length > 200) return send(res, 400, {ok: false, error: 'name missing'});
  artistImages.get(name, function(e, buf){
    if (e === 'busy') return sendBusy(res);
    if (!buf) { res.writeHead(404, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600'}); return res.end(); }
    res.writeHead(200, {'Content-Type': buf[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Content-Length': buf.length,
                        'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=2592000'});
    res.end(buf);
  });
}

/* Web radio: GET /radiocover?artist=…&title=… (cover for the current track) and GET /stationlogo?name=…[&url=…] (station logo);
   both stored on the player under radio-covers/ and stations/; 404 without image */
var radio = require('./radio.js');
var radioCovers = new artistimg.Store(path.join(DATA_DIR, 'radio-covers'), {lookup: radio.songLookup, noneTtl: 7 * 86400000, max: 3000, maxBytes: 300 * 1024 * 1024});
var stationLogos = new artistimg.Store(path.join(DATA_DIR, 'stations'), {lookup: radio.logoLookup, max: 1000, maxBytes: 100 * 1024 * 1024});

function sendImage(res, buf) {
  var type = buf && radio.mime(buf);
  if (!type) { res.writeHead(404, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}); return res.end(); }   /* may be learned right afterwards */
  res.writeHead(200, {'Content-Type': type, 'Content-Length': buf.length, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=2592000'});
  res.end(buf);
}
function doRadioCover(query, res) {
  var artist = String(query.artist || '').trim(), title = String(query.title || '').trim();
  if (!artist || !title || artist.length + title.length > 300) return send(res, 400, {ok: false, error: 'artist and title required'});
  radioCovers.get(artist + '\n' + title, function(e, buf){ if (e === 'busy') sendBusy(res); else sendImage(res, buf); });
}
function doStationLogo(query, res) {
  var name = String(query.name || '').trim(), u = String(query.url || '').trim();
  if (!name || name.length > 200 || u.length > 1000) return send(res, 400, {ok: false, error: 'name missing'});
  stationLogos.get(name, function(e, buf){ if (e === 'busy') sendBusy(res); else sendImage(res, buf); }, u);
}

/* GET /sysinfo[?full=1]: system values for the "System" page (sysinfo.js) */
var sysinfo = require('./sysinfo.js');
var sysInfo = new sysinfo.Sysinfo({file: path.join(DATA_DIR, 'sysinfo.json')});
/* GET /playback: crossfade, ReplayGain, normalization, AutoDJ automation; POST /playback {crossfade?, replaygain?} */
var playback = require('./playback.js');
function mpdOne(cmd, cb) { libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT, timeout: 5000}, cmd, cb); }
var rgauto = require('./rgauto.js');                    /* ReplayGain "Automatic": album or track gain depending on the queue */
/* Volumio's queue and position for "Automatic" (Volumio 2 gives MPD only the current track) */
function volumioQueue(cb) {
  playerState(function(e, st){
    if (e || !st || typeof st.position !== 'number') return cb(e || new Error('no position'));
    volumioGet('/api/v1/getQueue', 16 * 1024 * 1024, function(e2, q){
      if (e2 || !q || !Array.isArray(q.queue)) return cb(e2 || new Error('no queue'));
      cb(null, {pos: st.position, random: !!st.random, items: q.queue});
    });
  });
}
var rgAuto = new rgauto.RgAuto({file: path.join(DATA_DIR, 'replaygain.json'), mpd: mpdOne, queue: volumioQueue,
  idle: function(onChange){ return rgauto.mpdIdle(MPD_HOST, MPD_PORT, function(){ onChange(); xfAuto.check(); watchPlayerSoon(); }); }});
var xfauto = require('./xfauto.js');                    /* crossfade "Automatic": off inside an album, on for mixes */
var xfAuto = new xfauto.XfAuto({file: path.join(DATA_DIR, 'crossfade.json'), mpd: mpdOne});
var playCtl = new playback.Playback({mpd: mpdOne, rg: rgAuto, xf: xfAuto});
function doPlaybackGet(query, cb) { playCtl.read(function(r){ cb(r.ok ? 200 : 503, r); }); }
function doPlaybackSet(body, cb) { playCtl.set(body, cb); }
/* ReplayGain and MQA tags of the playing file: one Python call per file and change, shared by /replaygain and /mqa and by
   all devices (each asks at every track change). Key: path, stamp: size and modification time (saved tags count as new) */
var rgTags = new Map(), RG_TAGS_MAX = 200, rgWaiting = {};
function fileRgTags(full, cb) {
  fs.stat(full, function(e, st){
    if (e) return cb({ok: false, error: e.code});
    var stamp = st.size + ':' + st.mtime.getTime(), hit = rgTags.get(full);
    if (hit && hit.stamp === stamp) return cb(hit.p);
    var key = full + '|' + stamp;
    if (rgWaiting[key]) return rgWaiting[key].push(cb);   /* the same file asked at the same time: one Python call */
    rgWaiting[key] = [cb];
    runPy({op: 'replaygain', path: full}, function(p){
      if (p.ok) {
        rgTags.delete(full);
        if (rgTags.size >= RG_TAGS_MAX) rgTags.delete(rgTags.keys().next().value);
        rgTags.set(full, {stamp: stamp, p: p});
      }
      var list = rgWaiting[key]; delete rgWaiting[key];
      list.forEach(function(f){ f(p); });
    });
  });
}
/* GET /replaygain?uri=: gain MPD applies to this file (player view), {ok, mode, gain: {mode, db} | null} */
function doReplayGain(query, cb) {
  var r = resolveUri(query.uri);
  if (!r || r.missing) return cb(200, {ok: true, mode: null, gain: null});
  playCtl.gain(function(done){
    fileRgTags(r.full, function(p){ done(p.ok ? null : new Error(p.error), p); });
  }, function(o){ cb(o.ok ? 200 : 503, o); });
}
/* POST /applemusic {tracks: [{artist, title, album}]} or {items: [Xplorio items]} -> {ok, tracks: [{id, artist, title, album}], of}: Apple Music entries
   via the iTunes search (hidden test, tags/applemusic.js) */
var applemusic = require('./applemusic.js');
var AM_FILE = path.join(DATA_DIR, 'applemusic-ids.json'), AM_MAX_ENTRIES = 50000, amData = null, amDirty = false;
function amCache() {                                     /* found Apple Music IDs (and misses), kept for good */
  if (!amData) { try { amData = JSON.parse(fs.readFileSync(AM_FILE, 'utf8')); } catch (e) { amData = {}; } }
  if (!amData || typeof amData !== 'object' || Array.isArray(amData)) amData = {};
  return {
    get: function(k){ return Object.prototype.hasOwnProperty.call(amData, k) ? amData[k] : null; },
    set: function(k, v){ if (Object.keys(amData).length < AM_MAX_ENTRIES || Object.prototype.hasOwnProperty.call(amData, k)) { amData[k] = v; amDirty = true; } }
  };
}
function amCacheSave() {
  if (!amDirty) return;
  amDirty = false;
  var tmp = AM_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(amData), function(e){ if (!e) fs.rename(tmp, AM_FILE, function(){}); });
}
function doAppleMusic(body, cb) {
  function go(tracks) { applemusic.resolve(tracks, function(list){ amCacheSave(); cb(200, {ok: true, tracks: list, of: tracks.length}); }, amCache()); }
  if (Array.isArray(body && body.items)) {               /* "Apple Music" mode: Xplorio items (albums, folders, …) */
    return applemusic.expand(body.items, function(cmds, done){ remote.mpd(MPD_HOST, MPD_PORT, cmds, done); }, go);
  }
  go(Array.isArray(body && body.tracks) ? body.tracks : []);
}

/* GET /mqa?uri=: is this FLAC an MQA file (its tags), {ok, mqa: {orig: 192000|null} | null}; same cache as /replaygain */
function doMqa(query, cb) {
  var r = resolveUri(query.uri);
  if (!r || r.missing || !/\.flac$/i.test(r.full)) return cb(200, {ok: true, mqa: null});
  fileRgTags(r.full, function(p){
    if (!p.ok) return cb(200, {ok: false, mqa: null});
    cb(200, {ok: true, mqa: p.mqa || null});
  });
}

function doSysinfo(query, res) {
  sysInfo.report(query.full === '1', function(r){ send(res, 200, r); });
}
/* GET /warnings: drive errors, drive gone, memory, drive space (syswarn.js); POST /warnings {read: [id …] | 'all'} */
var syswarn = require('./syswarn.js');
var sysWarn = new syswarn.Warnings({file: path.join(DATA_DIR, 'syswarn.json'), sys: sysInfo});
function doWarningsRead(body, cb) {
  var ids = body && body.read;
  if (ids !== 'all' && !(Array.isArray(ids) && ids.length <= 100)) return cb(400, {ok: false, error: 'read missing'});
  sysWarn.markRead(ids);
  cb(200, sysWarn.list());
}

/* GET /services: state of the player services; POST /service {unit, action}: restart */
/* actions only with password (adminpass.js): POST /servicelogin {password} -> {token}, the device sends the token along */
var services = require('./services.js'), svc = new services.Services();
var SELF_UNIT = 'xplorio-tags';                                 /* the plugin's unit of this service */
var adminpass = require('./adminpass.js'), adminAuth = new adminpass.Auth(DATA_DIR);
function doServices(query, cb) { svc.status(function(r){ r.pw = adminAuth.isSet(); cb(r.ok ? 200 : 500, r); }); }
function doService(body, cb) {
  if (!adminAuth.isSet()) return cb(200, {ok: false, error: 'unset'});
  if (!adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  svc.act(String(body.unit || ''), String(body.action || ''), SELF_UNIT, cb);
}
/* POST /power {action: reboot|poweroff, token}: password only if one is set (Volumio itself never asks) */
function doPower(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  svc.power(String(body.action || ''), cb);
}
/* POST /logs {source, lines: 50|100|300, token}: last lines of a log (tags/logs.js), without source only the sources;
   password only if one is set */
var logs = require('./logs.js'), CRASH_LOG = path.join(DATA_DIR, 'crash.log'), logReader = new logs.Logs({files: {crashes: CRASH_LOG}});
function doLogs(body, cb) {
  if (body.source && adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth', sources: logReader.sources()});
  logReader.read(String(body.source || ''), body.lines, cb);
}
function doServiceLogin(body, cb) {
  adminAuth.login(String(body.password || '').slice(0, 200), Date.now(), function(r){ cb(200, r); });
}

/* GET /lyricsoffset?key=… -> {ok, ms}; POST /lyricsoffset {key, ms}: offset of the synced lyrics per track
   (in ms, positive = text comes later), shared by all devices in lyrics-offsets.json */
var OFFSET_FILE = path.join(DATA_DIR, 'lyrics-offsets.json');
var OFFSET_MAX = 10000;          /* tracks with their own lyrics offset; more are refused */
function readOffsets() { try { return JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8')) || {}; } catch (e) { return {}; } }

function doOffsetGet(query, cb) {
  var key = String(query.key || '');
  if (!key || key.length > 400) return cb(400, {ok: false, error: 'key missing'});
  var all = readOffsets();
  cb(200, {ok: true, ms: Object.prototype.hasOwnProperty.call(all, key) ? Number(all[key]) || 0 : 0});
}
function doOffsetSet(body, cb) {
  var key = String(body.key || ''), ms = Math.round(Number(body.ms) || 0);
  if (!key || key.length > 400 || Math.abs(ms) > 600000) return cb(400, {ok: false, error: 'invalid key or ms'});
  var all = readOffsets();
  if (ms && !Object.prototype.hasOwnProperty.call(all, key) && Object.keys(all).length >= OFFSET_MAX) return cb(400, {ok: false, error: 'too many offsets'});
  if (ms) all[key] = ms; else delete all[key];
  try { mkdirs(DATA_DIR); fs.writeFileSync(OFFSET_FILE + '.neu', JSON.stringify(all)); fs.renameSync(OFFSET_FILE + '.neu', OFFSET_FILE); }
  catch (e) { return cb(500, {ok: false, error: e.message}); }
  cb(200, {ok: true, ms: ms});
}

/* ---------- Cover ---------- */

function mkdirs(dir) {
  var parts = path.resolve(dir).split(path.sep), cur = '';
  parts.forEach(function(p, i){
    cur = i ? path.join(cur, p) : (p || path.sep);
    try { fs.mkdirSync(cur); } catch (e) { /* already exists */ }
  });
}

/* write folder.jpg: follow no link (it could point out of the music folder), and atomically
   (power loss: old or new image, never half of one) */
function writeFolderJpg(target, buf) {
  var st = null;
  try { st = fs.lstatSync(target); } catch (e) { /* none yet */ }
  if (st && !st.isFile()) throw new Error(FOLDER_JPG + ' is a link or folder');
  fs.writeFileSync(target + '.neu', buf);
  fs.renameSync(target + '.neu', target);
}

/* folders of the files (no duplicates), as {rel, full} */
function dirsOf(paths) {
  var seen = {}, out = [];
  paths.forEach(function(p){
    var rel = path.dirname(p.rel);
    if (!seen[rel]) { seen[rel] = true; out.push({rel: rel, full: path.dirname(p.full)}); }
  });
  return out;
}

/* GET /image?uri=…&src=embedded|folder: embedded cover of the file, or folder.jpg of its folder */
function doImage(query, res) {
  var p = resolveUri(query.uri);
  function none(code) { res.writeHead(code || 404, {'Access-Control-Allow-Origin': '*'}); res.end(); }
  if (!p || p.missing) return none(p ? 404 : 400);
  function img(mime, buf) {
    res.writeHead(200, {'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*'});
    res.end(buf);
  }
  if (query.src === 'folder') {
    fs.readFile(path.join(path.dirname(p.full), FOLDER_JPG), function(e, buf){ if (e) return none(); img('image/jpeg', buf); });
    return;
  }
  runPy({op: 'cover_get', path: p.full}, function(r){
    if (!r.ok || !r.data) return none();
    img(r.mime || 'image/jpeg', Buffer.from(r.data, 'base64'));
  });
}

/* POST /cover {uris, image:<base64 JPEG>, embed:bool, folder:bool, overwrite:bool}
   embed: image as front cover into all files; folder: image as folder.jpg into their folders.
   An existing folder.jpg is only replaced with overwrite (otherwise {ok:false, exists:[folders]}).
   batch: pass an ID so that several requests (large albums in parts) are undone together. */
function doCover(body, cb) {
  if (body.strip) return doCoverStrip(body, cb);
  var uris = body.uris;
  if (body.batch !== undefined && !BATCH_RE.test(String(body.batch))) return cb(400, {ok: false, error: 'invalid batch'});
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_ITEMS) return cb(400, {ok: false, error: 'uris missing or too many'});
  if (typeof body.image !== 'string' || !body.image) return cb(400, {ok: false, error: 'image missing'});
  if (!body.embed && !body.folder) return cb(400, {ok: false, error: 'nothing to do'});
  var buf = Buffer.from(body.image, 'base64');
  if (buf.length < 100 || !(buf[0] === 0xff && buf[1] === 0xd8)) return cb(400, {ok: false, error: 'image is not a JPEG'});

  var paths = [], bad = [];
  uris.forEach(function(u){ var p = resolveUri(u); if (p && !p.missing) { p.uri = u; paths.push(p); } else bad.push(u); });
  if (!paths.length) return cb(400, {ok: false, error: 'no valid files'});
  var dirs = body.folder ? dirsOf(paths) : [];
  var exists = dirs.filter(function(d){ return fs.existsSync(path.join(d.full, FOLDER_JPG)); });
  if (exists.length && !body.overwrite) return cb(200, {ok: false, exists: exists.map(function(d){ return d.rel; })});

  var batch = body.batch ? String(body.batch) : newBatch(), bdir = path.join(COVER_DIR, batch), tmp = path.join(bdir, 'neu.jpg');
  var part = newBatch();                                        /* backups of this request: own names, also within a shared batch */
  try { mkdirs(bdir); fs.writeFileSync(tmp, buf); } catch (e) { return cb(500, {ok: false, error: 'backup folder not writable: ' + e.message}); }

  var results = bad.map(function(u){ return {uri: u, ok: false, error: 'path not allowed or file missing'}; });
  var changedRel = [], folders = [];
  dirs.forEach(function(d, i){                                  /* folder.jpg first (fast, no Python) */
    var target = path.join(d.full, FOLDER_JPG), backup = null;
    try {
      var lst = null;
      try { lst = fs.lstatSync(target); } catch (e) { /* none yet */ }
      if (lst && !lst.isFile()) throw new Error(FOLDER_JPG + ' is a link or folder');
      if (lst) { backup = path.join(bdir, 'folder-' + part + '-' + i + '.jpg'); fs.writeFileSync(backup, fs.readFileSync(target)); }
      writeFolderJpg(target, buf);
      logEntry({batch: batch, time: new Date().toISOString(), folder: d.rel, cover: {backup: backup}});
      folders.push({dir: d.rel, ok: true});
    } catch (e) { folders.push({dir: d.rel, ok: false, error: e.message}); }
  });
  if (!body.embed) return finish();
  var i = 0;
  mapSeq(paths, function(p, done){
    runPy({op: 'cover_set', path: p.full, image: tmp, mime: 'image/jpeg', backup: path.join(bdir, part + '-' + (i++))}, function(r){
      r.uri = p.uri;
      if (r.ok && r.changed) {
        changedRel.push(p.rel);
        logEntry({batch: batch, time: new Date().toISOString(), uri: p.uri, cover: {backup: r.backup}});
      }
      done(r);
    });
  }, function(rs){ results = results.concat(rs); finish(); });

  function finish() {
    var changed = changedRel.length + folders.filter(function(f){ return f.ok; }).length;
    var out = {ok: true, batch: changed ? batch : null, items: results, folders: folders};
    if (!changedRel.length) return cb(200, out);
    mpdUpdate(changedRel, function(scanned){ out.scan = scanned; cb(200, out); });
  }
}

/* POST /cover {uris, strip: true, batch}: all embedded images out of the files (tags.py images_strip). Each image is
   saved into the file's folder first (folder.jpg, back.jpg, …; never overwritten, the same image only once) and kept
   for undo. For DSF: MPD 0.20 drops all tags of a file whose ID3 block is larger than 1 MB, which big covers cause. */
function doCoverStrip(body, cb) {
  var uris = body.uris;
  if (body.batch !== undefined && !BATCH_RE.test(String(body.batch))) return cb(400, {ok: false, error: 'invalid batch'});
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_ITEMS) return cb(400, {ok: false, error: 'uris missing or too many'});
  var paths = [], bad = [];
  uris.forEach(function(u){ var p = resolveUri(u); if (p && !p.missing) { p.uri = u; paths.push(p); } else bad.push(u); });
  if (!paths.length) return cb(400, {ok: false, error: 'no valid files'});
  var batch = body.batch ? String(body.batch) : newBatch(), bdir = path.join(COVER_DIR, batch), part = newBatch();
  try { mkdirs(bdir); } catch (e) { return cb(500, {ok: false, error: 'backup folder not writable: ' + e.message}); }
  var results = bad.map(function(u){ return {uri: u, ok: false, error: 'path not allowed or file missing'}; });
  var changedRel = [], saved = [], i = 0;
  mapSeq(paths, function(p, done){
    runPy({op: 'images_strip', path: p.full, backup: path.join(bdir, 'img-' + part + '-' + (i++))}, function(r){
      r.uri = p.uri;
      if (r.ok && r.changed) {
        changedRel.push(p.rel);
        var mine = (r.saved || []).map(function(f){ return path.relative(MUSIC_ROOT, f); });
        saved = saved.concat(mine);
        logEntry({batch: batch, time: new Date().toISOString(), uri: p.uri, images: {manifest: r.manifest, saved: mine}});
      }
      delete r.manifest;
      done(r);
    });
  }, function(rs){
    results = results.concat(rs);
    var out = {ok: true, batch: changedRel.length ? batch : null, items: results, saved: saved};
    if (!changedRel.length) return cb(200, out);
    mpdUpdate(changedRel, function(scanned){ out.scan = scanned; cb(200, out); });
  });
}

/* undo: restore text tags (before), embedded covers and folder.jpg of a job */
function doUndo(body, cb) {
  var entries = readLog().filter(function(e){ return e.batch === body.batch; });
  if (!entries.length) return cb(404, {ok: false, error: 'change not found'});
  var textEntries = entries.filter(function(e){ return e.before; });
  var coverEntries = entries.filter(function(e){ return (e.cover || e.images) && e.uri; });
  var folderEntries = entries.filter(function(e){ return e.cover && e.folder; });
  var results = [], changedRel = [];

  folderEntries.forEach(function(e){
    var dir = path.join(MUSIC_ROOT, e.folder), target = path.join(dir, FOLDER_JPG);
    try {
      if (e.folder.split('/').indexOf('..') >= 0) throw new Error('path not allowed');
      if (e.cover.backup) writeFolderJpg(target, fs.readFileSync(e.cover.backup)); else fs.unlinkSync(target);
      results.push({folder: e.folder, ok: true, changed: true});
    } catch (err) { results.push({folder: e.folder, ok: false, error: err.message}); }
  });
  mapSeq(coverEntries, function(e, done){
    var p = resolveUri(e.uri);
    if (!p || p.missing) return done({uri: e.uri, ok: false, error: 'file not found'});
    var job = e.images ? {op: 'images_restore', path: p.full, manifest: e.images.manifest}
                       : {op: 'cover_set', path: p.full, image: e.cover.backup || null};
    runPy(job, function(r){
      r.uri = e.uri;
      if (r.ok && r.changed) changedRel.push(p.rel);
      if (r.ok && e.images) (e.images.saved || []).forEach(function(rel){   /* the images it saved into the folder */
        var f = rel.split('/').indexOf('..') < 0 && path.join(MUSIC_ROOT, rel);
        try { if (f) fs.unlinkSync(f); } catch (err) { /* gone already */ }
      });
      done(r);
    });
  }, function(rs){
    results = results.concat(rs);
    if (!textEntries.length) {
      if (!changedRel.length) return cb(200, {ok: true, batch: null, items: results, undone: body.batch});
      return mpdUpdate(changedRel, function(scanned){ cb(200, {ok: true, batch: null, items: results, scan: scanned, undone: body.batch}); });
    }
    writeItems(textEntries.map(function(e){ return {uri: e.uri, tags: e.before}; }), newBatch(), true, function(code, res){
      res.items = results.concat(res.items || []);
      if (changedRel.length) mpdUpdate(changedRel, function(){});
      res.undone = body.batch; cb(code, res);
    });
  });
}

function doHistory(cb) {
  var seen = {}, list = [];
  readLog().reverse().forEach(function(e){
    if (!e.uri) return;                                   /* folder.jpg entries do not count as files */
    if (!seen[e.batch]) { seen[e.batch] = {batch: e.batch, time: e.time, files: 0}; list.push(seen[e.batch]); }
    seen[e.batch].files++;
  });
  cb(200, {ok: true, batches: list.slice(0, 20)});
}

/* ---------- Last.fm for the UI ---------- */
/* GET /lastfmapi?method=…&artist=…: UI queries (texts, similar artists) with the service's key,
   so that the key is not kept in the browser. Read-only methods only; responses cached in memory for 6 h. */
var LFM_METHODS = ['artist.getinfo', 'album.getinfo', 'track.getinfo', 'artist.getsimilar'];
var LFM_PARAMS  = ['artist', 'album', 'track', 'lang', 'limit', 'autocorrect'];
var LFM_TTL = 6 * 3600000, LFM_MAX = 300;
var lfmCache = {}, lfmCacheKeys = [];
function doLastfmApi(query, cb) {
  var method = String(query.method || '').toLowerCase();
  if (LFM_METHODS.indexOf(method) < 0) return cb(400, {ok: false, error: 'method not allowed'});
  var key = keys.lastfm().key;
  if (!key) return cb(503, {ok: false, error: 'LASTFM_KEY missing'});
  var qs = 'method=' + method;
  LFM_PARAMS.forEach(function(p){ if (query[p]) qs += '&' + p + '=' + encodeURIComponent(String(query[p]).slice(0, 300)); });
  var hit = lfmCache[qs];
  if (hit && Date.now() - hit.at < LFM_TTL) return cb(200, hit.data);
  var base = process.env.LASTFM_URL || 'https://ws.audioscrobbler.com';
  coversearch.fetchUrl(base + '/2.0/?' + qs + '&api_key=' + encodeURIComponent(key) + '&format=json', 2 * 1024 * 1024, function(e, r){
    var data = null;
    if (!e) { try { data = JSON.parse(r.body.toString('utf8')); } catch (x) { /* not JSON */ } }
    if (!data) return cb(200, {});                       /* like "nothing found"; do not cache */
    if (!lfmCache[qs]) { lfmCacheKeys.push(qs); if (lfmCacheKeys.length > LFM_MAX) delete lfmCache[lfmCacheKeys.shift()]; }
    lfmCache[qs] = {at: Date.now(), data: data};
    cb(200, data);
  });
}

/* ---------- Playback on this device (headphones button, ?player=remote|both|lokal, tags/remote.js) ---------- */
/* GET /remote -> {ok, available, mode}; POST /remote {mode}: switch MPD's outputs; GET /stream: MPD's stream output for
   the browser (Safari needs answers to range requests). If the amplifier output is off and nobody has listened for
   REMOTE_IDLE_MS, the outputs go back to "lokal" by themselves, so the system is never left silent; likewise when amplifier
   and stream are both on without anyone choosing it (after MPD restarts), see remote.idleReset. */
var remote = require('./remote.js');
var MPD_CONF = process.env.MPD_CONF || '/etc/mpd.conf';
var REMOTE_IDLE_MS = 60000;
var STREAM_CUSHION_MS = 6000;                          /* head start for the browser's buffer (remote.cushion) */
var remoteListeners = 0, remoteLastListen = Date.now(), remoteChosen = '';   /* last mode set here (POST /remote) */
function remoteState(cb) {
  var conf = [];
  try { conf = remote.confOutputs(fs.readFileSync(MPD_CONF, 'utf8')); } catch (e) { /* not readable: plugin field only */ }
  remote.mpd(MPD_HOST, MPD_PORT, ['outputs'], function(err, lines){
    if (err) return cb(err);
    cb(null, remote.find(remote.parseOutputs(lines), conf));
  });
}
function doRemoteGet(cb) {
  remoteState(function(err, f){
    if (err) return cb(200, {ok: false, error: err.message});
    cb(200, {ok: true, available: !!f, mode: f ? remote.modeOf(f) : 'lokal', listeners: remoteListeners,
             encoder: f ? f.stream.encoder : '', bitrate: f ? f.stream.bitrate : 0});   /* for the quality display while listening */
  });
}
function doRemoteSet(body, cb) {
  var mode = body && body.mode;
  if (['lokal', 'remote', 'both'].indexOf(mode) < 0) return cb(400, {ok: false, error: 'invalid mode'});
  remoteState(function(err, f){
    if (err) return cb(200, {ok: false, error: err.message});
    if (!f) return cb(200, {ok: false, available: false, error: 'no stream output in MPD'});
    var cmds = remote.commands(f, mode);
    if (!cmds) return cb(200, {ok: false, available: true, error: 'no amplifier output'});
    remoteLastListen = Date.now();                       /* time to connect before the safety check counts */
    remote.mpd(MPD_HOST, MPD_PORT, cmds, function(e2){
      if (e2) return cb(200, {ok: false, error: e2.message});
      remoteChosen = mode;
      cb(200, {ok: true, available: true, mode: mode});
    });
  });
}
function doStream(req, res) {
  remoteState(function(err, f){
    if (err || !f) { res.writeHead(404, {'Cache-Control': 'no-store'}); return res.end(); }
    var a = remote.rangeAnswer(req.headers.range, f.stream.encoder), left = a.limit, closed = false;
    var hold = remote.cushion(!left || left > 1048576 ? STREAM_CUSHION_MS : 0);   /* not for short probes (bytes=0-1) */
    var up = http.get({host: '127.0.0.1', port: f.stream.port, path: '/'}, function(u){
      if (closed) return u.destroy();
      res.writeHead(a.status, a.headers);
      remoteListeners++;                                 /* every connection counts: Safari asks "bytes=0-" for the live stream too */
      u.on('close', function(){ remoteListeners--; remoteLastListen = Date.now(); });
      u.on('data', function(chunk){
        remoteLastListen = Date.now();
        hold.push(chunk, Date.now()).forEach(function(c){
          if (!left) return res.write(c);
          if (left === -1) return;
          if (c.length > left) c = c.slice(0, left);
          left -= c.length;
          res.write(c);
          if (!left) { left = -1; res.end(); u.destroy(); }
        });
      });
      u.on('end', function(){ res.end(); });
    });
    up.on('error', function(){ if (!res.headersSent) res.writeHead(502, {'Cache-Control': 'no-store'}); res.end(); });
    req.on('close', function(){ closed = true; up.abort(); });
  });
}
setInterval(function(){                                  /* safety: nobody listening -> back to "lokal" (remote.idleReset) */
  if (remoteListeners > 0 || Date.now() - remoteLastListen < REMOTE_IDLE_MS) return;
  remoteState(function(err, f){
    if (err || !f || !remote.idleReset(remote.modeOf(f), remoteChosen)) return;
    console.log('playback on device: nobody listening, back to the amplifier only (was ' + remote.modeOf(f) + ')');
    remoteChosen = 'lokal';
    var cmds = remote.commands(f, 'lokal');
    if (cmds) remote.mpd(MPD_HOST, MPD_PORT, cmds, function(){});
  });
}, 15000).unref();

/* ---------- HTTP ---------- */

function send(res, code, obj) {
  var h = guard.corsHeaders(res.xplorioOrigin);
  h['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

/* additional allowed names of the player (APP_CONFIG.ALLOWED_HOSTS, XPLORIO_HOSTS); reread once a minute */
var extraHostsAt = 0, extraHostsList = [];
function extraHosts() {
  if (Date.now() - extraHostsAt > 60000) { extraHostsList = guard.extraHosts(appConfig(), process.env.XPLORIO_HOSTS); extraHostsAt = Date.now(); }
  return extraHostsList;
}

var server = http.createServer(function(req, res){
  try { handle(req, res); }
  catch (e) {                                           /* an error in one request does not take down the whole service */
    console.error('request ' + req.method + ' ' + req.url.split('?')[0] + ' failed: ' + (e && e.stack || e));
    if (!res.headersSent) send(res, 500, {ok: false, error: 'internal error'});
  }
});
function handle(req, res) {
  /* only the UI on this device (see guard.js) */
  var g = guard.check(req, req.method === 'POST', extraHosts());
  if (!g.ok) { res.writeHead(403, {'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin'}); return res.end(JSON.stringify({ok: false, error: 'not allowed (' + g.reason + ')'})); }
  res.xplorioOrigin = g.origin;
  var route = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && route === '/stream')  return doStream(req, res);
  if (req.method === 'GET' && route === '/remote')  return doRemoteGet(function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/health')  return send(res, 200, {ok: true, lastfm: !!keys.lastfm().key});
  if (req.method === 'GET' && route === '/lastfmapi') return doLastfmApi(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/history') return doHistory(function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/image')   return doImage(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/coverimage') return doCoverImage(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/coverbestimage') return doCoverBestImage(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/coversearch') return doCoverSearch(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/scan')    return doScanGet(function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/trash')   return doTrashGet(function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/trashfiles') return doTrashFiles(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/check')   return doCheckGet(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && ['/genrelist', '/genrealbums', '/albumgenre', '/versions', '/decades', '/decadealbums', '/yearalbums', '/decadeprofile'].indexOf(route) >= 0)
    return doGenreLib(route, url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/tracknums') return doTrackNums(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/patterns') return send(res, 200, {ok: true, patterns: patternsLoad()});
  if (req.method === 'GET' && route === '/genres')  return doGenres(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/radiocover')  return doRadioCover(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/stationlogo') return doStationLogo(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/playback') return doPlaybackGet(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/mqa') return doMqa(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/replaygain') return doReplayGain(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/sysinfo') return doSysinfo(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/warnings') return send(res, 200, sysWarn.list());
  if (req.method === 'GET' && route === '/services') return doServices(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/artistimage') return doArtistImage(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/lyricsoffset') return doOffsetGet(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/moodalbums') return doMoodAlbums(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/moodmix')  return doMoodmix(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/moodtags') return doMoodtags(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/albumprofile') return doAlbumProfile(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/artistprofile') return doArtistProfile(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/gems') return doGems(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/together') return doTogether(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/togethermix') return doTogetherMix(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/similar') return doSimilar(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/suggest') return doSuggest(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/welcome') return doWelcome(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/discover') return doDiscover(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/random')  return doRandom(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/plays')   return doPlays(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/plays/resolve') return doResolve(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/lastfm')  return send(res, 200, {ok: true, recording: recording, lastfm: lfm.status()});
  if (req.method === 'GET' && route === '/artist')  return doArtist(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'POST' && route === '/essentia') return doEssentiaUpload(req, res);
  if (req.method !== 'POST' || ['/read', '/write', '/undo', '/cover', '/scan', '/check', '/checkdone', '/genreok', '/patterns', '/remote', '/dupmove', '/filemove', '/trashrestore', '/trashdelete', '/files', '/dupfill', '/lastfm', '/lyricsoffset', '/randommix', '/ratings', '/rate', '/service', '/servicelogin', '/power', '/playback', '/logs', '/applemusic', '/warnings', '/coverbest'].indexOf(route) < 0) return send(res, 404, {ok: false, error: 'unknown path'});
  var data = '', tooBig = false;
  req.setEncoding('utf8');
  req.on('data', function(d){ data += d; if (data.length > MAX_BODY) { tooBig = true; req.destroy(); } });
  req.on('end', function(){
    if (tooBig) return;
    var body;
    try { body = JSON.parse(data); } catch (e) { return send(res, 400, {ok: false, error: 'invalid JSON'}); }
    var fn = {'/read': doRead, '/write': doWrite, '/cover': doCover, '/scan': doScan, '/undo': doUndo, '/check': doCheckStart, '/checkdone': doCheckDone, '/genreok': doGenreOk, '/patterns': doPatterns, '/remote': doRemoteSet, '/dupmove': doDupMove, '/filemove': doFileMove, '/trashrestore': doTrashRestore, '/trashdelete': doTrashDelete, '/files': doFiles, '/dupfill': doDupFill, '/lastfm': doLastfm, '/lyricsoffset': doOffsetSet, '/randommix': doRandomMix, '/ratings': doRatings, '/rate': doRate, '/service': doService, '/servicelogin': doServiceLogin, '/power': doPower, '/logs': doLogs, '/playback': doPlaybackSet, '/applemusic': doAppleMusic, '/warnings': doWarningsRead, '/coverbest': doCoverBest}[route];
    try { fn(body || {}, function(c, o){ send(res, c, o); }); }
    catch (e) { console.error('request ' + route + ' failed: ' + (e && e.stack || e)); if (!res.headersSent) send(res, 500, {ok: false, error: 'internal error'}); }
  });
}

if (require.main === module) {
  /* an error nobody catches: note it where it survives a restart (System > Logs), then end; systemd starts the service again */
  process.on('uncaughtException', function(e){
    console.error('uncaught: ' + (e && e.stack || e));
    logs.appendCrash(CRASH_LOG, e);
    process.exit(1);
  });
  /* Node closes an idle keep-alive connection after 5 s; Safari often reuses it at that very moment and the request fails
     ("tag service not reachable", fine again a moment later). Keep idle connections open longer than the browsers do. */
  server.keepAliveTimeout = 65000;
  server.listen(HTTP_PORT, function(){ console.log('tag-service on port ' + HTTP_PORT + ', music under ' + MUSIC_ROOT); });
  if (process.env.HISTORY !== '0' && appConfig().HISTORY !== false) { recording = true; watchPlayer(); lfm.flush(); }
  setTimeout(function(){ albumsEnsure(); }, 90000);       /* prepare the album list for the random album */
  setTimeout(pruneLog, 30000);                            /* clean up old undo data */
  setTimeout(dupMigrate, 20000);                          /* duplicates folder of earlier versions: new name, .mpdignore */
  sysInfo.start();                                        /* measure CPU load ("System" page) */
  if (process.env.SYSWARN !== '0') sysWarn.start();       /* drive, memory and space warnings */
  rgAuto.start();                                         /* follows the queue via MPD idle */
  if (process.env.RELEASEDATES !== '0' && appConfig().RELEASEDATES !== false) releaseDates.start();   /* birthdays: MusicBrainz */
  if (process.env.ARTISTNAMES !== '0' && appConfig().ARTISTNAMES !== false) artistNames.start();      /* library check: usual spelling */
  if (process.env.MOODTAGS !== '0' && appConfig().MOODTAGS !== false) {
    moodCollector.start();
    setInterval(function(){ albumsEnsure(); }, 3600000);  /* keep the track list current (rereads only when MPD has changed) */
  }
}
module.exports = {pruneLog: pruneLog, resolveUri: resolveUri, scanDirs: scanDirs, server: server, tracker: tracker, playStore: playStore, lastfm: lfm, moodtags: moodCollector};
