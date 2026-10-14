/* Tag-Dienst: liest und schreibt Tags der Audiodateien (m4a, flac, mp3, dsf).
   HTTP, Port 8766. Läuft mit Node 8 (nur ES5-Syntax). Die eigentliche Arbeit macht tags.py (Python 2.7/3 + mutagen). */
var http  = require('http');
var fs    = require('fs');
var path  = require('path');
var cp    = require('child_process');
var url   = require('url');
var vm    = require('vm');

var HTTP_PORT   = parseInt(process.env.HTTP_PORT || '8766', 10);
var MUSIC_ROOT  = process.env.MUSIC_ROOT  || '/mnt';
/* Volumio 2: python (2.7); Volumio 4 (Debian 12) hat nur python3 */
var PYTHON      = process.env.PYTHON      || (['/usr/bin/python', '/usr/local/bin/python'].some(function(p){
  try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) ? 'python' : 'python3');
var USE_SUDO    = process.env.USE_SUDO === '1';          /* tags.py per "sudo -n" starten (nötig, wenn der Mount nur root beschreiben lässt) */
var MPC         = process.env.MPC         || 'mpc';
/* Datenordner /data/xplorio/data (früher /data/web-app/data bzw. /data/INTERNAL/tags; siehe appdata.js) */
var appdata     = require('./appdata.js');
var guard       = require('./guard.js');
var DATA_PREP   = process.env.TAGS_LOG ? {dir: path.dirname(process.env.TAGS_LOG)}
  : appdata.prepare(process.env.TAGS_DATA || appdata.defaultDir('/data/xplorio/data', '/data/web-app/data'), process.env.TAGS_OLD_DATA || '/data/INTERNAL/tags', console.log);
var DATA_DIR    = DATA_PREP.dir;
var LOG_FILE    = process.env.TAGS_LOG    || path.join(DATA_DIR, 'changes.jsonl');
var MPD_HOST    = process.env.MPD_HOST    || 'localhost';
var MPD_PORT    = parseInt(process.env.MPD_PORT || '6600', 10);
var SCRIPT      = path.join(__dirname, 'tags.py');
var ROOTS       = ['INTERNAL', 'USB', 'NAS'];            /* erlaubte Ordner unterhalb von MUSIC_ROOT */
var EXT_RE      = /\.(m4a|mp4|m4b|flac|mp3|dsf)$/i;
var MAX_ITEMS   = 500;                                   /* Dateien je Anfrage */
var MAX_ARTIST  = 3000;                                  /* Dateien je Künstler (/artist) */
var PY_BATCH    = 20;                                    /* Dateien je Python-Aufruf */
var MAX_BODY    = 12 * 1024 * 1024;                     /* Cover-Bilder kommen als base64 mit */
var JOB_TIMEOUT = 180000;
var KILL_GRACE  = 120000;                               /* nach SIGTERM: so lange darf die laufende Datei noch fertig werden */
var COVER_DIR   = path.join(DATA_DIR, 'covers');   /* Sicherungen alter Cover (für Rückgängig) */
var FOLDER_JPG  = 'folder.jpg';

/* ---------- Pfade ---------- */

/* Volumio-URI ("USB/Ordner/x.flac", "music-library/USB/…", "/mnt/USB/…") -> absoluter Pfad; null, wenn nicht erlaubt */
function resolveUri(uri) {
  if (typeof uri !== 'string' || !uri || uri.indexOf('\0') >= 0) return null;
  var rel = uri.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
  var parts = rel.split('/');
  if (ROOTS.indexOf(parts[0]) < 0 || parts.length < 2) return null;
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '' || parts[i] === '.' || parts[i] === '..') return null;
  }
  if (!EXT_RE.test(rel)) return null;
  var full = path.join(MUSIC_ROOT, rel);
  var real;
  try { real = fs.realpathSync(full); } catch (e) { return { rel: rel, full: full, missing: true }; }
  var root;
  try { root = fs.realpathSync(path.join(MUSIC_ROOT, parts[0])); } catch (e) { return null; }
  if (real.indexOf(root + path.sep) !== 0) return null;   /* Symlink führt aus INTERNAL/USB/NAS heraus */
  return { rel: rel, full: full };
}

/* ---------- tags.py aufrufen (immer nur ein Auftrag gleichzeitig; der CM3 hat wenig Speicher) ---------- */

var queue = [], busy = false;

function runPy(job, cb) {
  queue.push({job: job, cb: cb});
  next();
}

/* mehrere Aufträge, je PY_BATCH in einem Python-Aufruf; cb(results) in derselben Reihenfolge */
function runPyMany(jobs, cb) {
  var out = [], i = 0;
  (function step() {
    if (i >= jobs.length) return cb(out);
    var chunk = jobs.slice(i, i + PY_BATCH);
    i += chunk.length;
    runPy({op: 'batch', jobs: chunk}, function(r){
      chunk.forEach(function(j, k){
        out.push(r.ok && r.results && r.results[k] ? r.results[k] : {ok: false, error: r.error || 'keine Antwort'});
      });
      step();
    });
  })();
}
function next() {
  if (busy || !queue.length) return;
  busy = true;
  var q = queue.shift();
  var args = USE_SUDO ? ['-n', PYTHON, SCRIPT] : [SCRIPT];
  var child = cp.spawn(USE_SUDO ? 'sudo' : PYTHON, args, {stdio: ['pipe', 'pipe', 'pipe']});
  var out = '', err = '', done = false;
  function finish(res) {
    if (done) return;
    done = true; clearTimeout(timer); busy = false;
    q.cb(res); next();
  }
  var limit = Math.max(JOB_TIMEOUT, (q.job.jobs ? q.job.jobs.length : 1) * 30000);   /* m4a-Umschreiben kann je Datei dauern */
  /* Zeitüberschreitung: erst bitten (tags.py schreibt die laufende Datei fertig und meldet, was erledigt ist),
     nur wenn es dann noch hängt, hart beenden */
  var timer = setTimeout(function(){
    try { child.kill('SIGTERM'); } catch (e) { /* schon beendet */ }
    timer = setTimeout(function(){
      try { child.kill('SIGKILL'); } catch (e) { /* schon beendet */ }
      finish({ok: false, error: 'Zeitüberschreitung'});
    }, KILL_GRACE);
  }, limit);
  child.stdout.on('data', function(d){ out += d; });
  child.stderr.on('data', function(d){ err += d; });
  child.on('error', function(e){ finish({ok: false, error: 'Python nicht startbar: ' + e.message}); });
  child.on('close', function(){
    var res;
    try { res = JSON.parse(out); } catch (e) { res = {ok: false, error: (err || 'Keine Antwort von tags.py').trim().split('\n').pop()}; }
    if (!res.ok && /permission denied|read-only/i.test(res.error || '')) {
      res.error += ' (keine Schreibrechte auf dem Datenträger; siehe docs/tags.md)';
    }
    finish(res);
  });
  child.stdin.on('error', function(){});
  child.stdin.end(JSON.stringify(q.job));
}

/* ---------- Protokoll der Änderungen (für Rückgängig) ---------- */

var logAppends = 0;
function logEntry(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE));
  } catch (e) { /* existiert schon */ }
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n'); } catch (e) { return false; }
  if (++logAppends % 500 === 0) setTimeout(pruneLog, 0);
  return true;
}

/* Protokoll und Cover-Sicherungen begrenzen: nur die letzten KEEP_BATCHES Aufträge bleiben rückgängig machbar
   (die Oberfläche bietet Rückgängig ohnehin nur für den letzten an) */
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
    } catch (e) { console.error('Protokoll nicht gekürzt: ' + e.message); return; }
  }
  var dirs;
  try { dirs = fs.readdirSync(COVER_DIR); } catch (e) { return; }
  dirs.forEach(function(d){
    if (keep[d] || !BATCH_RE.test(d)) return;
    var full = path.join(COVER_DIR, d);
    try {
      if (Date.now() - fs.statSync(full).mtime.getTime() < 3600000) return;   /* Auftrag läuft vielleicht noch */
      fs.readdirSync(full).forEach(function(f){ fs.unlinkSync(path.join(full, f)); });
      fs.rmdirSync(full);
    } catch (e) { /* nächstes Mal */ }
  });
}
function readLog() {
  var txt;
  try { txt = fs.readFileSync(LOG_FILE, 'utf8'); } catch (e) { return []; }
  var list = [];
  txt.split('\n').forEach(function(line){
    if (!line) return;
    try { list.push(JSON.parse(line)); } catch (e) { /* kaputte Zeile überspringen */ }
  });
  return list;
}

/* ---------- MPD: geänderte Ordner neu einlesen ---------- */

/* Jedes "mpc update" lässt Volumio seine ganze Albumliste neu aufbauen (rund 1 min Last). Darum möglichst nur
   einen Ordner einlesen: den gemeinsamen Elternordner, solange er mindestens 3 Ebenen tief liegt
   (z. B. USB/MX-Media/AllFlac), sonst die einzelnen Ordner. Sind das mehr als SCAN_MAX_DIRS (Genre über viele
   Alben geändert), doch den gemeinsamen Elternordner, notfalls die ganze Bibliothek (''): ein Scan statt vieler. */
var SCAN_MAX_DIRS = 3;
var SCAN_QUIET = 15000;          /* so lange nach der letzten Änderung warten, dann alle gesammelten Ordner auf einmal */
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

/* Rescans sammeln: Änderungen kurz hintereinander (Bulk-Editor, Bibliotheks-Check, Rückgängig) ergeben einen Scan,
   SCAN_QUIET nach der letzten; nie, solange MPD noch einliest. Die Antwort wartet nicht auf den Scan,
   cb(ok) meldet, ob der letzte "mpc update" geklappt hat.
   Halten (POST /scan {hold:true}, solange der Bibliotheks-Check offen ist): nur sammeln, gescannt wird beim
   Loslassen ({hold:false}); kommt das nie (Seite zu), spätestens SCAN_HOLD_MAX nach der letzten Änderung. */
var SCAN_HOLD_MAX = 10 * 60000;
var scanPending = [], scanTimer = null, scanRunning = false, scanOk = true, scanHold = false;
var scanAll = false;             /* ganze Bibliothek einlesen (Knopf im Bibliotheks-Check), auch während des Haltens */
function mpdUpdate(relFiles, cb) {
  scanPending = scanPending.concat(relFiles);
  scanSchedule(scanHold ? SCAN_HOLD_MAX : SCAN_QUIET, scanHold);
  cb(scanOk);
}
function scanSchedule(ms, release) {               /* release: Halten endet (Höchstdauer erreicht) */
  clearTimeout(scanTimer);
  scanTimer = setTimeout(function(){ if (release) scanHold = false; scanRun(); }, ms);
}
function scanSetHold(on) {
  scanHold = !!on;
  if (scanHold) { if (scanPending.length) scanSchedule(SCAN_HOLD_MAX, true); else { clearTimeout(scanTimer); scanTimer = null; } }
  else if (scanPending.length) scanSchedule(0);
}
function scanRun() {
  scanTimer = null;
  if (scanRunning || (scanHold && !scanAll) || (!scanPending.length && !scanAll)) return;
  scanRunning = true;
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'status', function(err, st){
    if (!err && st.updating_db) { scanRunning = false; scanSchedule(SCAN_QUIET); return; }
    var list = scanAll ? [''] : scanDirs(scanPending);
    scanPending = []; scanAll = false;
    (function step() {
      if (!list.length) {
        scanRunning = false;
        var t = setTimeout(function(){ albumChecked = 0; albumsEnsure(); }, ALBUMS_AFTER_SCAN_MS);
        if (t.unref) t.unref();   /* Genres, Zufallsalbum aktuell */
        if (scanPending.length && !scanTimer) scanSchedule(scanHold ? SCAN_HOLD_MAX : SCAN_QUIET, scanHold);
        return;
      }
      var d = list.shift();
      cp.execFile(MPC, d ? ['update', d] : ['update'], {timeout: 15000}, function(e){ scanOk = !e; step(); });
    })();
  });
}

/* ---------- Aufträge ---------- */

function mapSeq(items, fn, cb) {
  var res = [], i = 0;
  (function step() {
    if (i >= items.length) return cb(res);
    fn(items[i], function(r){ res.push(r); i++; step(); });
  })();
}

function doRead(body, cb) {
  var uris = body.uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_ITEMS) return cb(400, {ok: false, error: 'uris fehlt oder zu viele'});
  var items = new Array(uris.length), jobs = [], at = [];
  uris.forEach(function(uri, k){
    var p = resolveUri(uri);
    if (!p || p.missing) items[k] = {uri: uri, ok: false, error: p ? 'Datei nicht gefunden' : 'Pfad nicht erlaubt'};
    else { jobs.push({op: 'read', path: p.full}); at.push(k); }
  });
  runPyMany(jobs, function(rs){
    rs.forEach(function(r, k){ r.uri = uris[at[k]]; items[at[k]] = r; });
    cb(200, {ok: true, items: items});
  });
}

var BATCH_RE = /^[a-z0-9]{6,16}$/;

/* POST /write {items:[{uri, tags}], batch?, scan?}
   batch: Kennung mitgeben, damit mehrere Anfragen gemeinsam rückgängig gemacht werden;
   scan:false: MPD nicht neu einlesen lassen (das macht dann ein abschließendes /scan) */
function doWrite(body, cb) {
  var items = body.items;
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return cb(400, {ok: false, error: 'items fehlt oder zu viele'});
  if (body.batch !== undefined && !BATCH_RE.test(String(body.batch))) return cb(400, {ok: false, error: 'batch ungültig'});
  writeItems(items, body.batch || newBatch(), body.scan !== false, cb);
}

function writeItems(items, batch, scan, cb) {
  var results = new Array(items.length), jobs = [], at = [], paths = [], changedRel = [];
  items.forEach(function(it, k){
    var p = resolveUri(it && it.uri);
    if (!p || p.missing) results[k] = {uri: it && it.uri, ok: false, error: p ? 'Datei nicht gefunden' : 'Pfad nicht erlaubt'};
    else { jobs.push({op: 'write', path: p.full, tags: it.tags || {}}); at.push(k); paths.push(p); }
  });
  runPyMany(jobs, function(rs){
    rs.forEach(function(r, k){
      var it = items[at[k]];
      r.uri = it.uri;
      if (r.ok && r.changed) {
        changedRel.push(paths[k].rel);
        if (!logEntry({batch: batch, time: new Date().toISOString(), uri: it.uri, before: r.before, after: r.after})) r.logWarning = true;
      }
      results[at[k]] = r;
    });
    if (!changedRel.length) return cb(200, {ok: true, batch: null, items: results, scan: null});
    if (!scan) return cb(200, {ok: true, batch: batch, items: results, scan: null});
    mpdUpdate(changedRel, function(scanned){ cb(200, {ok: true, batch: batch, items: results, scan: scanned}); });
  });
}

/* POST /scan {uris}: geänderte Dateien von MPD neu einlesen lassen (nach mehreren /write mit scan:false);
   POST /scan {hold:true|false}: Scans zurückhalten bzw. alles Gesammelte jetzt einlesen (siehe mpdUpdate);
   POST /scan {all:true}: ganze Bibliothek jetzt einlesen (wie "Bibliothek aktualisieren" in Volumio) */
function doScan(body, cb) {
  if (body.all === true) {                                 /* alles Gesammelte geht in diesem einen Scan auf */
    scanAll = true;
    clearTimeout(scanTimer); scanTimer = null;
    scanRun();
    return cb(200, {ok: true, scan: true});
  }
  if (typeof body.hold === 'boolean') { scanSetHold(body.hold); return cb(200, {ok: true, hold: scanHold, pending: scanPending.length}); }
  var rel = [];
  (Array.isArray(body.uris) ? body.uris : []).forEach(function(u){ var p = resolveUri(u); if (p && !p.missing) rel.push(p.rel); });
  if (!rel.length) return cb(400, {ok: false, error: 'uris fehlt'});
  mpdUpdate(rel, function(scanned){ cb(200, {ok: true, scan: scanned}); });
}

/* GET /scan: liest MPD gerade ein? {ok, updating, pending} (Fortschritt für den Knopf im Bibliotheks-Check) */
function doScanGet(cb) {
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'status', function(err, st){
    if (err) return cb(200, {ok: false, error: 'MPD: ' + err.message});
    cb(200, {ok: true, updating: !!st.updating_db || scanRunning || scanAll, pending: scanPending.length});
  });
}

/* GET /artist?name=…: alle Dateien, deren Interpret oder Album-Interpret dem Namen entspricht
   (Groß-/Kleinschreibung und Leerzeichen am Rand egal), über MPD.
   Mit &tracks=1 stattdessen alle Suchtreffer mit Titel und Album (Künstlerseite: Titel ohne eigenes Album). */
function doArtist(query, cb) {
  var name = String(query.name || '').trim();
  if (!name) return cb(400, {ok: false, error: 'name fehlt'});
  var me = name.toLowerCase(), seen = {}, files = [], tracks = [], withTracks = query.tracks === '1';
  function search(tag, done) {
    cp.execFile(MPC, ['-f', '%file%\t[%artist%]\t[%albumartist%]\t[%title%]\t[%album%]', 'search', tag, name], {timeout: 30000, maxBuffer: 32 * 1024 * 1024}, function(e, out){
      if (e) return done(e);
      String(out).split('\n').forEach(function(line){
        var f = line.split('\t');
        if (!f[0] || seen[f[0]]) return;
        if (withTracks) {                                    /* Teiltreffer ("A feat. B") filtert der Browser */
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
      if (e1 && e2) return cb(500, {ok: false, error: 'MPD-Suche fehlgeschlagen: ' + e1.message});
      if (withTracks) return cb(200, {ok: true, tracks: tracks.slice(0, MAX_ARTIST)});
      files = files.filter(function(f){ var p = resolveUri(f); return p && !p.missing; }).sort();
      if (files.length > MAX_ARTIST) return cb(200, {ok: false, error: 'zu viele Dateien (' + files.length + ', höchstens ' + MAX_ARTIST + ')'});
      cb(200, {ok: true, files: files});
    });
  });
}

/* ---------- Bibliotheks-Check ---------- */
/* POST /check startet die Prüfung im Hintergrund, GET /check liefert Fortschritt und das letzte Ergebnis.
   Das Ergebnis liegt in check.json neben dem Änderungsprotokoll, bis neu geprüft wird. */
var libcheck = require('./libcheck.js');
var batchSeq = 0;
function newBatch() { return Date.now().toString(36) + (++batchSeq % 1296).toString(36); }   /* zwei Aufträge in derselben ms: verschiedene Kennungen */
var CHECK_FILE = path.join(DATA_DIR, 'check.json');
function writeCheck(obj) { fs.writeFileSync(CHECK_FILE + '.neu', JSON.stringify(obj)); fs.renameSync(CHECK_FILE + '.neu', CHECK_FILE); checkCache = null; }   /* Stromausfall: alte oder neue Datei, nie halbe */
/* letztes Ergebnis (kann einige MB groß sein): nur neu lesen, wenn sich die Datei geändert hat; null = noch nie geprüft */
var checkCache = null, checkStamp = '';
function readCheck() {
  var stamp;
  try { var st = fs.statSync(CHECK_FILE); stamp = st.mtime.getTime() + ':' + st.size; } catch (e) { return null; }
  if (checkCache && stamp === checkStamp) return checkCache;
  try { checkCache = JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8')); checkStamp = stamp; } catch (e) { checkCache = null; }
  return checkCache;
}
var checkRun = null;                                     /* {phase, done, total, started} während der Prüfung */
var checkError = null;

function doCheckStart(body, cb) {
  if (checkRun) return cb(200, {ok: true, running: checkRun});
  checkRun = {phase: 'mpd', done: 0, total: 0, started: Date.now()};
  checkError = null;
  cb(200, {ok: true, running: checkRun});
  libcheck.mpdWalk({host: MPD_HOST, port: MPD_PORT}, function(err, songs){
    if (err) { checkError = 'MPD: ' + err.message; checkRun = null; return; }
    checkRun.phase = 'cover';
    libcheck.dirsWithoutImage(songs, MUSIC_ROOT, function(cand){ checkCovers(songs, cand); });
  }, function(done, total){ checkRun.done = done; checkRun.total = total; });
}
function checkCovers(songs, cand) {
  var noCover = {};
  checkRun.done = 0; checkRun.total = cand.length;
  var jobs = cand.map(function(c){ return {op: 'cover_has', path: path.join(MUSIC_ROOT, c.file)}; });
  var i = 0, results = [];
  (function step() {                                   /* in Teilen, damit der Fortschritt mitläuft */
    if (i >= jobs.length) {
      cand.forEach(function(c, k){ if (!(results[k] && results[k].ok && results[k].has)) noCover[c.dir] = true; });
      var res = libcheck.analyze(songs, function(d){ return !noCover[d]; },
        function(s){ return audioStore.get(s.artist, s.title, s.album); });
      res.releaseDate = releasedates.diffs(albums.fromSongs(songs), songs,
        function(d){ var r = releaseDates.by[d]; return (r && r.d) || ''; }, albums.albumDir);   /* Date-Tag gegen MusicBrainz */
      res.at = Date.now();
      res.seconds = Math.round((res.at - checkRun.started) / 1000);
      try { writeCheck(res); } catch (e) { checkError = 'Ergebnis nicht speicherbar: ' + e.message; }
      checkRun = null;
      return;
    }
    var part = jobs.slice(i, i + PY_BATCH);
    i += part.length;
    runPyMany(part, function(r){ results = results.concat(r); checkRun.done = i; step(); });
  })();
}

/* GET /genres?dir=… -> Oberkategorie und Unterstile eines Albums aus der Audio-Analyse (Stand des letzten Checks);
   ohne dir alle Alben. Die Unterstile stehen nur hier, in die Dateien schreibt der Check nur die Oberkategorie. */
function doGenres(query, cb) {
  var last = readCheck();
  var all = (last && last.genreStyles) || {};
  if (query.dir !== undefined) return cb(200, {ok: true, album: all[String(query.dir)] || null});
  cb(200, {ok: true, albums: all, at: last ? last.at : null});
}

/* ?have=<at>: Ergebnis mit diesem Stand liegt beim Aufrufer schon vor -> nur Fortschritt, result: 'same' (spart MB je Abfrage) */
function doCheckGet(query, cb) {
  var last = readCheck();
  var same = last && query && query.have && String(last.at) === String(query.have);
  cb(200, {ok: true, running: checkRun, error: checkError, result: same ? 'same' : last});
}

/* POST /checkdone {key}: Eintrag als bearbeitet merken (bleibt ausgegraut), bis neu geprüft wird.
   Steht in check.json, eine neue Prüfung überschreibt die Datei und damit auch die Markierungen. */
function doCheckDone(body, cb) {
  var key = body && body.key;
  if (typeof key !== 'string' || !key || key.length > 1000) return cb(400, {ok: false, error: 'key fehlt'});
  var last = readCheck();
  if (!last) return cb(200, {ok: false, error: 'noch nicht geprüft'});
  if (checkRun) return cb(200, {ok: false, error: 'Prüfung läuft'});
  last.done = last.done || {};
  last.done[key] = 1;
  try { writeCheck(last); } catch (e) { return cb(500, {ok: false, error: e.message}); }
  cb(200, {ok: true});
}

/* ---------- Cover online suchen ---------- */
/* GET /coversearch?artist=…&album=… -> {ok, results:[{id, source}]}; GET /coverimage?id=… liefert das Bild.
   Nur Adressen, die die Suche selbst gefunden hat, werden geladen (über die id). Last.fm-Schlüssel aus web/config*.js. */
var coversearch = require('./coversearch.js');
var APP_CONFIG_DIR = process.env.APP_CONFIG_DIR || '/volumio/http/www3/web';
var coverHits = Object.create(null), coverHitIds = [], coverHitSeq = 0;   /* ohne Prototyp: ?id=constructor u. ä. treffen nichts */

/* neu gelesen nur, wenn sich eine der beiden Dateien geändert hat (wird sehr oft gefragt) */
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
    catch (e) { /* Datei fehlt oder ist fehlerhaft: Standardwerte */ }
  });
  appConfigCache = ctx.window.APP_CONFIG || {}; appConfigStamp = stamp;
  return appConfigCache;
}

function doCoverSearch(query, cb) {
  var album = String(query.album || '').trim();
  if (!album) return cb(400, {ok: false, error: 'album fehlt'});
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
  if (typeof u !== 'string') return send(res, 404, {ok: false, error: 'unbekannt'});
  coversearch.image(u, function(e, img){
    if (e) return send(res, 404, {ok: false, error: e.message});
    res.writeHead(200, {'Content-Type': img.mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=600'});
    res.end(img.body);
  });
}

/* ---------- Verlauf und Last.fm ---------- */
/* Der Dienst fragt Volumio alle paar Sekunden nach dem Wiedergabestand und schreibt gezählte Wiedergaben
   nach plays.jsonl. GET /plays?view=recent|top|stats liefert Listen und Statistik, /lastfm verbindet und gleicht ab. */
var plays  = require('./plays.js');
var lastfm = require('./lastfm.js');
var VOLUMIO_URL = process.env.VOLUMIO_URL || 'http://localhost:3000';
var playStore = new plays.Store(path.join(DATA_DIR, 'plays.jsonl'));
var keys = new appdata.Keys(DATA_DIR, appConfig, console.log);   /* Last.fm-Key und -Secret (keys.json) */
/* nur in den eigenen Datenordner übernehmen, nie in den alten (liegt evtl. in einer Netzwerkfreigabe) */
if (!DATA_PREP.error) keys.migrate();
var lfm = new lastfm.Sync(path.join(DATA_DIR, 'lastfm.json'), playStore, function(){ return keys.lastfm(); });
var tracker = new plays.Tracker(function(e){ playStore.add([e]); lfm.played(e); }, function(e){ lfm.nowPlaying(e); });
var recording = false;

function playerState(cb) {
  var done = false;
  function finish(e, st) { if (!done) { done = true; cb(e, st); } }
  var req = http.get(VOLUMIO_URL + '/api/v1/getState', function(res){
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function(d){ data += d; });
    res.on('end', function(){ try { finish(null, JSON.parse(data)); } catch (e) { finish(e); } });
  });
  req.setTimeout(5000, function(){ req.abort(); finish(new Error('Zeitüberschreitung')); });
  req.on('error', finish);
}

function watchPlayer() {
  playerState(function(e, st){
    if (!e && st) tracker.update(st, Date.now());
    setTimeout(watchPlayer, tracker.cur && tracker.cur.playing ? 5000 : 15000);
  });
}

/* Volumio-uri -> Pfad relativ zum Musikordner ("USB/…"), sonst '' */
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
    albumsEnsure();                                      /* Genres kommen aus der Albenliste */
    return cb(200, {ok: true, recording: recording, stats: plays.stats(list, query.range, now, tz, albumGenreFn())});
  }
  if (view === 'year') {
    var ys = plays.years(list, tz), y = parseInt(query.y, 10) || ys[0] || plays.local(now, tz).getUTCFullYear();
    albumsEnsure();                                      /* Genres kommen aus der Albenliste */
    var gi = albumIdx && albumIdx.list;
    albumGenreFn();
    var m = parseInt(query.m, 10);
    var yr = plays.year(list, y, tz, now, 10, gi ? albumGenre.fn : null, m >= 1 && m <= 12 ? m - 1 : -1);
    yr.albums_top.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; });
    return cb(200, {ok: true, years: ys, review: yr});
  }
  if (view === 'album') {                               /* Albumseite: wie oft gehört, zuletzt */
    var dir = relUri(query.u).replace(/\/+$/, '');
    return cb(200, {ok: true, stats: plays.albumStats(list, relUri, dir, query.al, query.ar)});
  }
  if (view === 'ago') {
    var ak = ['artist', 'track'].indexOf(query.kind) >= 0 ? query.kind : 'album';
    var ag = plays.ago(list, now, tz, 12, ak);
    ag.items.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; });
    return cb(200, {ok: true, ago: ag});
  }
  cb(400, {ok: false, error: 'view fehlt'});
}

/* ---------- Zufallsalbum ---------- */
/* GET /random[?kind=artist|track] -> {ok, album: {dir, al, ar, last}} (artist: {ar, n, dir, last}; track: {ar, ti, al, f, d, last}) oder {ok: false, building: true}, solange die Albenliste entsteht.
   Die Liste kommt aus MPD (wie beim Bibliotheks-Check), liegt in albums.json und wird neu gelesen,
   wenn MPDs Datenbank sich geändert hat (Prüfung höchstens einmal pro Minute, nur ein kurzes "stats"). */
var albums = require('./albums.js');
var genres = require('./genres.js');
var ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');
var albumIdx = null, albumBuilding = false, albumChecked = 0, albumPicks = [], albumLast = null, albumGenre = null;
var ALBUMS_CHECK_MS = 60000;                             /* so oft höchstens bei MPD nachfragen, ob sich die Datenbank geändert hat */
var ALBUMS_AFTER_SCAN_MS = 90000;                        /* nach eigenem Scan: Albenliste nachziehen, wenn MPD und Volumio fertig sind */
var ALBUMS_VERSION = 8;                                  /* 2: mit Genre, 3: dazu library-tracks.json, 4: mit Dauer und Album, 5: Titel mit Genre, 6: Alben mit Jahr, 7: mit Änderungsdatum, 8: mit vollem Datum */
var TRACKS_FILE = path.join(DATA_DIR, 'library-tracks.json');   /* [[Künstler, Titel, Datei, Sekunden, Album, Genre des Albums], …] */

function albumsEnsure(cb) {
  cb = cb || function(){};
  if (!albumIdx) { try { albumIdx = JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8')); } catch (e) { /* noch nie gelesen */ } }
  if (albumBuilding || (albumIdx && Date.now() - albumChecked < ALBUMS_CHECK_MS)) return cb(albumIdx && albumIdx.list);
  albumChecked = Date.now();
  libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT}, 'stats', function(err, st){
    var stamp = !err && st.db_update;
    if (albumIdx && (err || stamp === albumIdx.db) && albumIdx.v === ALBUMS_VERSION) return cb(albumIdx.list);
    albumBuilding = true;
    if (albumIdx) cb(albumIdx.list);                     /* alte Liste bis die neue fertig ist */
    libcheck.mpdWalk({host: MPD_HOST, port: MPD_PORT}, function(e2, songs){
      albumBuilding = false;
      if (!e2 && songs.length) {
        albumIdx = {v: ALBUMS_VERSION, db: stamp || null, at: Date.now(), list: albums.fromSongs(songs)};
        try { fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albumIdx)); } catch (x) { /* nächstes Mal */ }
        var ge = {};                                     /* Genre des Albums (häufigstes im Ordner) für jeden Titel */
        albumIdx.list.forEach(function(a){ if (a.ge) ge[a.dir] = a.ge; });
        var tl = songs.filter(function(s){ return s.artist && s.title; }).map(function(s){
          return [s.artist, s.title, s.file, parseInt(s.time, 10) || 0, s.album, ge[albums.albumDir(s.file)] || ''];
        });
        try { fs.writeFileSync(TRACKS_FILE + '.neu', JSON.stringify(tl)); fs.renameSync(TRACKS_FILE + '.neu', TRACKS_FILE); } catch (x) { /* nächstes Mal */ }
      }
    });
    if (!albumIdx) cb(null);
  });
}

/* ---------- Stimmungs-Tags ---------- */
/* Last.fm-Tags je Titel sammeln, nur solange nichts spielt (Pause und Stopp zählen als still).
   GET /moodtags -> {ok, status, summary}; GET /moodtags?artist=…&title=… -> Rohtags und Ergebnis für einen Titel */
var moodtags = require('./moodtags.js');
var essentia = require('./essentia.js');
var ESSENTIA_FILE = path.join(DATA_DIR, 'essentia.jsonl');      /* Audio-Analyse vom Mac (tools/essentia), per POST /essentia oder scp */
var ESSENTIA_MAX = 100 * 1024 * 1024;             /* rund 1 kB je Titel: reicht für weit über 50 000 Titel */
var essentiaBusy = false;
var audioStore = new essentia.Store(ESSENTIA_FILE);
var moodCollector = new moodtags.Collector({
  dir: path.join(DATA_DIR, 'moodtags'), libFile: TRACKS_FILE, audio: audioStore,
  libRaw: function(){ return libTracksLoad() ? libTracks : null; },     /* dieselbe Titelliste wie Zufall und Genres */
  getCfg: function(){ return {key: keys.lastfm().key}; },
  playing: function(cb){ playerState(function(e, st){ cb(!!(e || (st && st.status === 'play'))); }); }   /* im Zweifel: spielt */
});

/* ---------- Genres der Bibliothek (Genre-Tag, je Album das häufigste) ---------- */
/* GET /genrelist[?q=] -> {ok, genres:[{g, n, dir, al, ar}], subs:[{g, s, n, dir, al, ar}] (nur mit q)};
   GET /genrealbums?g= -> {ok, albums:[{dir, al, ar, st:[Unterstile]}], subs:[{g, s, n, dir, al, ar}]};
   GET /albumgenre?q=[[uri, album, künstler], …] -> {ok, genres:[…], years:[…]} (leer = unbekannt). building: Albenliste entsteht noch.
   GET /decades -> {ok, decades:[{d, n, dir, al, ar}]}; GET /decadealbums?d=1990 -> {ok, albums:[{dir, al, ar, y}]} (Jahr aus dem Date-Tag).
   GET /yearalbums?y=1984 -> {ok, albums}; GET /decadeprofile?d=1980 -> {ok, n, artists, moods, styles, decades} (Entdecken).
   /albumgenre liefert dazu years:[…] (0 = unbekannt).
   Unterstile kommen aus der Audio-Analyse (tools/essentia), je Album innerhalb seines Genres */
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
    genreSubs = {list: list, tl: tl, at: st.at, idx: st.tracks ? genres.subsIndex(list, tl, function(ar, ti, al){ return audioStore.get(ar, ti, al); }, albums.albumDir) : {}};
  }
  return genreSubs.idx;
}
function doGenreLib(route, query, cb) {
  albumsEnsure(function(list){
    if (!list) return cb(200, {ok: false, building: true});
    if (route === '/genrelist') {
      var q = String(query.q || '').trim();
      return cb(200, {ok: true, genres: albums.genreList(list, q), subs: q ? genres.subList(list, genreSubsIdx(list), '', q) : []});
    }
    if (route === '/decades') return cb(200, {ok: true, decades: albums.decadeList(list)});
    if (route === '/decadealbums') return cb(200, {ok: true, albums: albums.decadeAlbums(list, query.d)});
    if (route === '/yearalbums') return cb(200, {ok: true, albums: albums.yearAlbums(list, query.y)});
    if (route === '/decadeprofile') {
      var d = parseInt(query.d, 10);
      if (!(d >= 1900 && d < 2100) || d % 10) return cb(400, {ok: false, error: 'd ungültig'});
      var pr = moodalbums.decadeProfile(moodmix.index(moodCollector), list, d, albums.albumDir);
      pr.ok = true;
      return cb(200, pr);
    }
    if (route === '/genrealbums') {
      var idx = genreSubsIdx(list);
      var al = albums.genreAlbums(list, query.g);
      al.forEach(function(a){ if (idx[a.dir]) a.st = idx[a.dir]; });
      return cb(200, {ok: true, albums: al, subs: genres.subList(list, idx, query.g)});
    }
    q = [];
    try { q = JSON.parse(String(query.q || '[]')); } catch (e) { return cb(400, {ok: false, error: 'q ungültig'}); }
    if (!Array.isArray(q) || q.length > 500) return cb(400, {ok: false, error: 'q ungültig'});
    var fn = albumGenreFn();
    if (!albumYear || albumYear.list !== list) albumYear = {list: list, fn: albums.yearIndex(list)};
    var es = q.map(function(x){ x = Array.isArray(x) ? x : []; return {u: String(x[0] || ''), al: String(x[1] || ''), ar: String(x[2] || '')}; });
    cb(200, {ok: true, genres: es.map(fn), years: es.map(albumYear.fn)});
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

/* POST /essentia: Ergebnisdatei des Analyse-Skripts (JSON Lines) ersetzt die bisherige */
function doEssentiaUpload(req, res) {
  if (essentiaBusy) { req.resume(); return send(res, 409, {ok: false, error: 'es läuft schon ein Upload'}); }
  if (Number(req.headers['content-length']) > ESSENTIA_MAX) { req.resume(); return send(res, 413, {ok: false, error: 'Datei zu groß'}); }
  try { mkdirs(DATA_DIR); } catch (e) { /* existiert */ }
  essentiaBusy = true;
  var tmp = ESSENTIA_FILE + '.neu', out = fs.createWriteStream(tmp), size = 0, failed = false, ended = false;
  function fail(code, msg) {
    if (failed) return; failed = true; essentiaBusy = false;
    req.unpipe(out); out.destroy(); try { fs.unlinkSync(tmp); } catch (e) { /* schon weg */ }
    if (!res.headersSent) send(res, code, {ok: false, error: msg});
  }
  req.on('data', function(d){ size += d.length; if (size > ESSENTIA_MAX) { fail(413, 'Datei zu groß'); req.destroy(); } });
  req.on('end', function(){ ended = true; });
  req.on('error', function(){ fail(400, 'Übertragung abgebrochen'); });
  req.on('aborted', function(){ fail(400, 'Übertragung abgebrochen'); });
  req.on('close', function(){ if (!ended) fail(400, 'Übertragung abgebrochen'); });     /* Verbindung weg: Datei nicht offen lassen */
  out.on('error', function(e){ fail(500, 'Schreiben fehlgeschlagen: ' + e.message); });
  out.on('finish', function(){
    if (failed) return;
    essentiaBusy = false;
    try { fs.renameSync(tmp, ESSENTIA_FILE); } catch (e) { return fail(500, 'Speichern fehlgeschlagen'); }
    audioStore.reload(true);
    var st = audioStore.status(), lib = moodCollector.loadLib(), matched = 0;
    lib.forEach(function(it){ if (audioStore.get(it.ar, it.ti, it.al)) matched++; });
    send(res, 200, {ok: true, tracks: st.tracks, library: lib.length, matched: matched});
  });
  req.pipe(out);
}

/* GET /moodmix?moods=a,b&emin=&emax=&styles=&match=any|all&genres=&n=&disc=0..1 -> {ok, level, matches, tracks}
   mit count=1 nur {ok, count, rated, styles, genres} (Trefferanzeige, Stil- und Genre-Chips) */
var moodmix = require('./moodmix.js');
var mixPlays = null;
/* GET /moodalbums?moods=a,b | styles=a,b | emin=&emax= -> {ok, albums:[{dir, al, ar, y}]}: Alben, deren eingeordnete Titel
   überwiegend diese Stimmung bzw. diesen Stil tragen oder deren mittlere Energie im Bereich liegt (moodalbums.js) */
var moodalbums = require('./moodalbums.js'), moodAlbumSums = null;
function doMoodAlbums(query, cb) {
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding});
    var c = moodmix.parse(query), idx = moodmix.index(moodCollector);
    if (!moodAlbumSums || moodAlbumSums.idx !== idx) moodAlbumSums = {idx: idx, sums: moodalbums.summarize(idx)};
    var q = {moods: c.moods, styles: c.styles, emin: query.emin ? c.emin : 0, emax: query.emax ? c.emax : 0};
    var d = parseInt(query.d, 10);                       /* nur Alben dieses Jahrzehnts (Entdecken auf Jahres-/Jahrzehntseite) */
    if (d >= 1900 && d <= 2090 && d % 10 === 0) list = list.filter(function(a){ return a.y && a.y - a.y % 10 === d; });
    cb(200, {ok: true, albums: moodalbums.list(moodAlbumSums.sums, list, q)});
  });
}

/* GET /artistprofile?artist=… -> {ok, n, moods, styles, energy, decades} („Mehr entdecken“ auf der Künstlerseite) */
function doArtistProfile(query, cb) {
  var artist = String(query.artist || '').trim();
  if (!artist) return cb(400, {ok: false, error: 'artist fehlt'});
  albumsEnsure(function(list){
    var r = moodalbums.artistProfile(moodmix.index(moodCollector), list || [], plays.norm(artist), plays.norm);
    r.ok = true;
    cb(200, r);
  });
}

/* GET /albumprofile?artist=…&album=…[&dir=…] -> Entdecken auf der Albumseite (moodalbums.albumProfile) */
function doAlbumProfile(query, cb) {
  var artist = String(query.artist || '').trim(), album = String(query.album || '').trim(), dir = relUri(query.dir || '').replace(/\/+$/, '');
  if (!album && !dir) return cb(400, {ok: false, error: 'album fehlt'});
  albumsEnsure(function(list){
    if (!list) return cb(200, {ok: false, building: true});              /* Albenliste entsteht zum ersten Mal */
    var r = moodalbums.albumProfile(moodmix.index(moodCollector), list, {dir: dir, artist: artist, album: album}, plays.norm);
    r.ok = true;
    cb(200, r);
  });
}

/* GET /similar?file=…&artist=…&title=…&album=…[&shuffle=1] -> {ok, seed: {mood, energy, bpm, style}, items: [{f, ar, ti, al, d, why}]}
   (Mehr wie dieser Titel); ohne Stimmungsdaten zum Titel {ok: false, nodata: true} */
var similar = require('./similar.js');
function doSimilar(query, cb) {
  albumsEnsure();
  var idx = moodmix.index(moodCollector), bad = ratingStore.disliked();
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

/* Jahr des Albums je Titel (albums.json, häufigstes Date-Tag im Ordner); Spanne der bekannten Jahre für den Regler */
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
  albumsEnsure();                                        /* hält library-tracks.json (mit Genre) und albums.json aktuell */
  var c = moodmix.parse(query), yrs = mixYearsOf(albumIdx && albumIdx.list);   /* nicht warten: bis zur ersten Albenliste ohne Jahre */
  var bad = ratingStore.disliked();
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

var artistPicks = [], trackPicks = [], libTracks = null, artistList = null;
/* Titelliste der Bibliothek (library-tracks.json), neu gelesen, wenn die Datei sich geändert hat */
function libTracksLoad() {
  var st;
  try { st = fs.statSync(TRACKS_FILE); } catch (e) { return null; }
  if (!libTracks || libTracks.m !== +st.mtime) {
    try { libTracks = {m: +st.mtime, list: JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'))}; } catch (e) { return libTracks && libTracks.list; }
  }
  return libTracks.list;
}

function doRandom(query, cb) {
  var kind = query.kind === 'artist' || query.kind === 'track' ? query.kind : 'album';
  albumsEnsure(function(list){
    if (!list || !list.length) return cb(200, {ok: false, building: albumBuilding, error: albumBuilding ? null : 'keine Alben gefunden'});
    var pl = playStore.load(), now = Math.floor(Date.now() / 1000);
    if (kind === 'artist') {
      if (!artistList || artistList.src !== list) artistList = {src: list, list: albums.artists(list)};
      var ar = albums.pickArtist(artistList.list, albums.lastArtistIndex(pl), now, artistPicks);
      return cb(200, ar ? {ok: true, artist: ar} : {ok: false, error: 'keine Künstler gefunden'});
    }
    if (kind === 'track') {
      var tl = libTracksLoad();
      if (!tl || !tl.length) return cb(200, {ok: false, building: albumBuilding, error: 'keine Titel gefunden'});
      return cb(200, {ok: true, track: albums.pickTrack(tl, albums.lastTrackIndex(pl), now, trackPicks)});
    }
    if (!albumLast || albumLast.n !== pl.length) albumLast = {n: pl.length, fn: albums.lastIndex(pl)};
    cb(200, {ok: true, album: albums.pick(list, albumLast.fn, now, albumPicks)});
  });
}

/* ---------- Entdecken und Zufallsmix (discover.js) ---------- */
/* GET /discover?kind=artist|album|track -> {ok, shelves: [{id: random|forgotten|never|oldfav, items}]}
   POST /randommix {artist}, {artists: [...]}, {dirs: [...]} oder {shelf: random|gems|ago|forgotten|never|oldfav[, tzw, tzs]}
   -> {ok, items: [{f, ar, ti, al, d}]} (25 Titel, Würfel neben „Alle abspielen“ bzw. an den Entdecken-Reihen) */
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
/* ---------- Begrüßung ---------- */
/* GET /welcome?day=2026-10-09 (Datum beim Hörer) -> {ok, day: {dir, al, ar, y, last}, recent: [{ti, ar, u, y, last}], fresh: [{dir, al, ar, y, m}],
   birthdays: {today, week, month: [{dir, al, ar, y, date, years, mark}]}, dates: {albums, dated, fetched, running}}.
   Das Album des Tages bleibt den ganzen Tag dasselbe, auch wenn es inzwischen lief (welcome.json) */
var WELCOME_FILE = path.join(DATA_DIR, 'welcome.json');
var releasedates = require('./releasedates.js');          /* Erscheinungsdaten (Date-Tag, sonst MusicBrainz) für die Geburtstage */
var releaseDates = new releasedates.Collector({file: path.join(DATA_DIR, 'releasedates.jsonl'), list: function(){ return albumIdx && albumIdx.list; }});
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
      try { fs.writeFileSync(WELCOME_FILE, JSON.stringify(welcomeDay)); } catch (e) { /* dann eben neu gezogen */ }
    }
    var recent = plays.recentAlbums(pl, 8);
    recent.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; var y = yearOf({u: it.u, al: it.ti, ar: it.ar}); if (y) it.y = y; });
    var tz = {w: parseInt(query.tzw, 10) || 0, s: parseInt(query.tzs, 10) || 0};
    var ago = plays.ago(pl, now, tz, 8, 'album');        /* um diese Zeit vor X Jahren gehört (wie die Reihe in Entdecken) */
    ago.items.forEach(function(it){ if (it.u) it.u = relUri(it.u); if (!it.u) delete it.u; var y = yearOf({u: it.u, al: it.ti, ar: it.ar}); if (y) it.y = y; });
    cb(200, {ok: true, day: pick, recent: recent, fresh: albums.freshAlbums(list, now, 8), ago: ago.items.length ? ago : null,
             birthdays: releasedates.birthdays(list, function(a){ return releaseDates.dateOf(a); }, day), dates: releaseDates.status()});
  });
}

/* ---------- Versteckte Perlen (gems.js) ---------- */
/* GET /gems?kind=artist|album|track -> {ok, items: [{…, why: {why: artist|like|tags, ar, mood, ge}}]} */
var gems = require('./gems.js'), gemState = null, favState = {at: 0, map: {}, rev: 0, loading: false};
/* Volumio-Favoriten (Daumen hoch) -> {Datei: true}; höchstens einmal je Minute gefragt, bei Fehlern der letzte Stand */
function volumioFavs(cb) {
  if (Date.now() - favState.at < 60000 || favState.loading) return cb(favState);
  favState.loading = true;
  function done(map) {
    favState.loading = false; favState.at = Date.now();
    if (map && Object.keys(map).sort().join('\n') !== Object.keys(favState.map).sort().join('\n')) { favState.map = map; favState.rev++; }
    cb(favState);
  }
  var req = http.get(VOLUMIO_URL + '/api/v1/browse?uri=favourites', function(res){
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function(d){ data += d; });
    res.on('end', function(){
      var map = {};
      try {
        ((JSON.parse(data).navigation || {}).lists || []).forEach(function(l){
          (l.items || []).forEach(function(it){ var f = relUri(it.uri); if (f) map[f] = true; });
        });
      } catch (e) { return done(null); }
      done(map);
    });
  });
  req.setTimeout(5000, function(){ req.abort(); });
  req.on('error', function(){ done(null); });
}
/* vorbereiteter Geschmack für die Perlen (gems.prepare), neu nur bei geänderter Bibliothek, Verlauf, Bewertungen, Favoriten */
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

/* ---------- Passt zusammen (together.js) ---------- */
/* GET /together?day=YYYY-MM-DD[&reroll=1]: Mixe des Tages aus 2–3 passenden Künstlern; Last.fm-„ähnliche Künstler“
   der Anker zählen mit (wenn ein Key da ist). Gezeigte Paarungen merkt sich together.json 7 Tage, damit sie sich nicht
   gleich wiederholen. GET /togethermix?ar=…&ar=…[&day=…][&shuffle=1]: die Titel eines Mixes. */
var together = require('./together.js');
var TOGETHER_FILE = path.join(DATA_DIR, 'together.json'), TOGETHER_KEEP = 7;
function togetherLoad() { try { return JSON.parse(fs.readFileSync(TOGETHER_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function togetherSave(all) {
  var out = {};
  Object.keys(all).sort().slice(-TOGETHER_KEEP).forEach(function(d){ out[d] = all[d]; });
  try { mkdirs(DATA_DIR); fs.writeFileSync(TOGETHER_FILE + '.neu', JSON.stringify(out)); fs.renameSync(TOGETHER_FILE + '.neu', TOGETHER_FILE); }
  catch (e) { console.error('together.json: ' + e.message); }
}
/* Last.fm: ähnliche Künstler der Anker als {ak: {ak: true}}; doLastfmApi merkt sich die Antworten 6 h */
function togetherSimilar(g, cb) {
  if (!keys.lastfm().key) return cb({});
  var list = together.anchors(g), map = {}, left = list.length, done = false;
  function fin() { if (!done) { done = true; cb(map); } }
  if (!left) return fin();
  var timer = setTimeout(fin, 8000);                     /* langsames Last.fm hält die Seite nicht auf */
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
/* together.json: {Tag: {items: [Mixe], seen: [Schlüssel aller an dem Tag gezeigten Paarungen]}};
   die Mixe eines Tages bleiben gleich, bis man neu würfelt */
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
      if (!items.length) items = together.build(g, {rnd: rnd, similar: sim});   /* alles schon gezeigt: dann eben wieder */
      var seen = ((today && today.seen) || []).concat(items.map(function(it){ return it.key; }));
      all[day] = {items: items, seen: seen.filter(function(k, i){ return seen.indexOf(k) === i; }).slice(-60)};
      togetherSave(all);
      cb(200, {ok: true, items: items});
    });
  });
}
function doTogetherMix(query, cb) {
  var names = [].concat(query.ar || []).slice(0, 3).map(String);
  if (names.length < 2) return cb(400, {ok: false, error: 'mindestens zwei Künstler (ar) nötig'});
  var day = /^\d{4}-\d\d-\d\d$/.test(query.day || '') ? query.day : new Date().toISOString().slice(0, 10);
  gemsReady(function(g){
    if (!g) return cb(200, {ok: false, building: albumBuilding, items: []});
    var rnd = query.shuffle === '1' ? Math.random : together.seeded(day + '|' + names.map(plays.norm).sort().join('+'));
    cb(200, {ok: true, items: together.mix(g, names, {rnd: rnd, bad: ratingStore.disliked()})});
  });
}

/* ---------- Bewertungen (ratings.js) ---------- */
/* POST /ratings {artist, album, tracks: [uri, …]} -> {ok, artist, album, tracks}; POST /rate {kind, v, name | uri, ar, al, ti} */
var ratingStore = new ratings.Store(path.join(DATA_DIR, 'ratings.json'));
function doRatings(body, cb) {
  if (Array.isArray(body.tracks) && body.tracks.length > MAX_ITEMS) return cb(400, {ok: false, error: 'zu viele Titel'});
  var out = ratingStore.get(body);
  out.ok = true;
  cb(200, out);
}
function doRate(body, cb) {
  var v;
  try { v = ratingStore.set(body); } catch (e) { return cb(500, {ok: false, error: 'Speichern fehlgeschlagen'}); }
  if (v === null) return cb(400, {ok: false, error: 'ungültige Bewertung'});
  cb(200, {ok: true, v: v});
}

var SHELF_MIX = ['random', 'gems', 'ago', 'forgotten', 'never', 'oldfav'];
function doRandomMix(body, cb) {
  var many = Array.isArray(body.artists) ? body.artists.slice(0, 50).map(String) : [];
  var shelf = SHELF_MIX.indexOf(body.shelf) >= 0 ? body.shelf : '';
  if (!shelf && !body.artist && !many.length && !(body.dirs && body.dirs.length)) return cb(400, {ok: false, error: 'artist, artists, dirs oder shelf fehlt'});
  albumsEnsure(function(list){
    var tl = libTracksLoad();
    if (!tl || !tl.length) return cb(200, {ok: false, building: albumBuilding, items: []});
    var n = Math.min(parseInt(body.n, 10) || 25, 100), bad = ratingStore.disliked();
    tl = tl.filter(function(t){ return !bad[t[2]]; });                 /* „mag ich nicht“ nie im Würfel */
    function send(picked) {
      cb(200, {ok: true, items: picked.map(function(t){ return {f: t[2], ar: t[0], ti: t[1], al: t[4] || '', d: t[3] || 0}; })});
    }
    /* Würfel-Regeln: höchstens 3 je Künstler (nicht auf der Künstlerseite) und 2 je Album (Künstlerseite 3),
       in den letzten 14 Tagen Gehörtes nur, wenn sonst zu wenig da ist */
    var pl = playStore.load(), now = Math.floor(Date.now() / 1000);
    var rules = {artist: body.artist ? 0 : 3, album: body.artist ? 3 : 2, recent: discover.recentFn(discoverStats(pl), now)};
    if (shelf) {                                                        /* Entdecken-Reihe: Titel der ganzen Reihe */
      var extra = {};
      if (shelf === 'ago') {
        var tz = {w: parseInt(body.tzw, 10) || 0, s: parseInt(body.tzs, 10) || 0};
        extra.keys = {};
        plays.ago(pl, now, tz, 500, 'track').items.forEach(function(it){ extra.keys[plays.norm(it.ar) + '|' + plays.norm(it.ti)] = true; });
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
    send(many.length ? discover.mixBalanced(pool, n, list, null, rules.recent) : discover.mixCapped(pool, n, rules));   /* ähnliche Künstler: gleichmäßig */
  });
}

/* GET /plays/resolve?artist=…&title=…: lokale Datei zu einem Titel aus dem Verlauf (z. B. von Last.fm eingelesen) */
function doResolve(query, cb) {
  var artist = String(query.artist || '').trim(), title = String(query.title || '').trim();
  if (!artist || !title) return cb(400, {ok: false, error: 'artist und title nötig'});
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
    if (!lfm.state.importedTo) lfm.importAll();          /* beim ersten Verbinden gleich den Verlauf holen */
    cb(200, {ok: true, status: lfm.status()});
  });
  if (a === 'disconnect') { lfm.disconnect(); return cb(200, {ok: true, status: lfm.status()}); }
  if (a === 'import') {
    if (!lfm.state.user) return cb(200, {ok: false, error: 'Erst mit Last.fm verbinden'});
    lfm.importAll();
    return cb(200, {ok: true, status: lfm.status()});
  }
  if (a === 'send') { lfm.flush(); return cb(200, {ok: true, status: lfm.status()}); }
  cb(400, {ok: false, error: 'action unbekannt'});
}

/* GET /artistimage?name=…: Künstlerfoto (Deezer, auf dem Player gespeichert unter artists/); 404 ohne Foto */
var artistimg = require('./artistimg.js');
var artistImages = new artistimg.Store(path.join(DATA_DIR, 'artists'));

function doArtistImage(query, res) {
  var name = String(query.name || '').trim();
  if (!name || name.length > 200) return send(res, 400, {ok: false, error: 'name fehlt'});
  artistImages.get(name, function(e, buf){
    if (!buf) { res.writeHead(404, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600'}); return res.end(); }
    res.writeHead(200, {'Content-Type': buf[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Content-Length': buf.length,
                        'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=2592000'});
    res.end(buf);
  });
}

/* Webradio: GET /radiocover?artist=…&title=… (Cover zum laufenden Titel) und GET /stationlogo?name=…[&url=…] (Senderlogo);
   beides auf dem Player gespeichert unter radio-covers/ bzw. stations/; 404 ohne Bild */
var radio = require('./radio.js');
var radioCovers = new artistimg.Store(path.join(DATA_DIR, 'radio-covers'), {lookup: radio.songLookup, noneTtl: 7 * 86400000, max: 3000});
var stationLogos = new artistimg.Store(path.join(DATA_DIR, 'stations'), {lookup: radio.logoLookup, max: 1000});

function sendImage(res, buf) {
  var type = buf && radio.mime(buf);
  if (!type) { res.writeHead(404, {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}); return res.end(); }   /* kann gleich danach gelernt werden */
  res.writeHead(200, {'Content-Type': type, 'Content-Length': buf.length, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=2592000'});
  res.end(buf);
}
function doRadioCover(query, res) {
  var artist = String(query.artist || '').trim(), title = String(query.title || '').trim();
  if (!artist || !title || artist.length + title.length > 300) return send(res, 400, {ok: false, error: 'artist und title nötig'});
  radioCovers.get(artist + '\n' + title, function(e, buf){ sendImage(res, buf); });
}
function doStationLogo(query, res) {
  var name = String(query.name || '').trim(), u = String(query.url || '').trim();
  if (!name || name.length > 200 || u.length > 1000) return send(res, 400, {ok: false, error: 'name fehlt'});
  stationLogos.get(name, function(e, buf){ sendImage(res, buf); }, u);
}

/* GET /sysinfo[?full=1]: Systemwerte für die Seite „System“ (sysinfo.js) */
var sysinfo = require('./sysinfo.js');
var sysInfo = new sysinfo.Sysinfo({file: path.join(DATA_DIR, 'sysinfo.json')});
/* GET /playback: Crossfade, ReplayGain, Normalisierung, AutoDJ-Automatik; POST /playback {crossfade?, replaygain?} */
var playback = require('./playback.js');
var playCtl = new playback.Playback({mpd: function(cmd, cb){ libcheck.mpdCommand({host: MPD_HOST, port: MPD_PORT, timeout: 5000}, cmd, cb); }});
function doPlaybackGet(query, cb) { playCtl.read(function(r){ cb(r.ok ? 200 : 503, r); }); }
function doPlaybackSet(body, cb) { playCtl.set(body, cb); }

function doSysinfo(query, res) {
  sysInfo.report(query.full === '1', function(r){ send(res, 200, r); });
}

/* GET /services: Zustand der Player-Dienste; POST /service {unit, action}: Neustart (Kiosk auch Start/Stopp) */
/* Aktionen nur mit Passwort (adminpass.js): POST /servicelogin {password} -> {token}, das Gerät schickt token mit */
var services = require('./services.js'), svc = new services.Services();
var adminpass = require('./adminpass.js'), adminAuth = new adminpass.Auth(DATA_DIR);
function doServices(query, cb) { svc.status(function(r){ r.pw = adminAuth.isSet(); cb(r.ok ? 200 : 500, r); }); }
function doService(body, cb) {
  if (!adminAuth.isSet()) return cb(200, {ok: false, error: 'unset'});
  if (!adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  svc.act(String(body.unit || ''), String(body.action || ''), 'tag-service', cb);
}
/* POST /power {action: reboot|poweroff, token}: Passwort nur, wenn eines festgelegt ist (Volumio selbst fragt nie) */
function doPower(body, cb) {
  if (adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth'});
  svc.power(String(body.action || ''), cb);
}
/* POST /logs {source, lines: 50|100|300, token}: letzte Zeilen eines Protokolls (tags/logs.js), ohne source nur die Quellen;
   Passwort nur, wenn eines festgelegt ist */
var logs = require('./logs.js'), logReader = new logs.Logs();
function doLogs(body, cb) {
  if (body.source && adminAuth.isSet() && !adminAuth.check(body.token)) return cb(200, {ok: false, error: 'auth', sources: logReader.sources()});
  logReader.read(String(body.source || ''), body.lines, cb);
}
function doServiceLogin(body, cb) {
  adminAuth.login(String(body.password || '').slice(0, 200), Date.now(), function(r){ cb(200, r); });
}

/* GET /lyricsoffset?key=… -> {ok, ms}; POST /lyricsoffset {key, ms}: Versatz der synchronen Lyrics je Titel
   (in ms, positiv = Text kommt später), für alle Geräte gemeinsam in lyrics-offsets.json */
var OFFSET_FILE = path.join(DATA_DIR, 'lyrics-offsets.json');
function readOffsets() { try { return JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8')) || {}; } catch (e) { return {}; } }

function doOffsetGet(query, cb) {
  var key = String(query.key || '');
  if (!key || key.length > 400) return cb(400, {ok: false, error: 'key fehlt'});
  var all = readOffsets();
  cb(200, {ok: true, ms: Object.prototype.hasOwnProperty.call(all, key) ? Number(all[key]) || 0 : 0});
}
function doOffsetSet(body, cb) {
  var key = String(body.key || ''), ms = Math.round(Number(body.ms) || 0);
  if (!key || key.length > 400 || Math.abs(ms) > 600000) return cb(400, {ok: false, error: 'key oder ms ungültig'});
  var all = readOffsets();
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
    try { fs.mkdirSync(cur); } catch (e) { /* existiert schon */ }
  });
}

/* folder.jpg schreiben: keinem Verweis folgen (könnte aus dem Musikordner hinaus zeigen) und atomar
   (Stromausfall: altes oder neues Bild, nie ein halbes) */
function writeFolderJpg(target, buf) {
  var st = null;
  try { st = fs.lstatSync(target); } catch (e) { /* noch keins */ }
  if (st && !st.isFile()) throw new Error(FOLDER_JPG + ' ist ein Verweis oder Ordner');
  fs.writeFileSync(target + '.neu', buf);
  fs.renameSync(target + '.neu', target);
}

/* Ordner der Dateien (ohne Doppelte), als {rel, full} */
function dirsOf(paths) {
  var seen = {}, out = [];
  paths.forEach(function(p){
    var rel = path.dirname(p.rel);
    if (!seen[rel]) { seen[rel] = true; out.push({rel: rel, full: path.dirname(p.full)}); }
  });
  return out;
}

/* GET /image?uri=…&src=embedded|folder: eingebettetes Cover der Datei bzw. folder.jpg ihres Ordners */
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
   embed: Bild als Frontcover in alle Dateien; folder: Bild als folder.jpg in deren Ordner.
   Eine vorhandene folder.jpg wird nur mit overwrite ersetzt (sonst {ok:false, exists:[Ordner]}). */
function doCover(body, cb) {
  var uris = body.uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_ITEMS) return cb(400, {ok: false, error: 'uris fehlt oder zu viele'});
  if (typeof body.image !== 'string' || !body.image) return cb(400, {ok: false, error: 'Bild fehlt'});
  if (!body.embed && !body.folder) return cb(400, {ok: false, error: 'nichts zu tun'});
  var buf = Buffer.from(body.image, 'base64');
  if (buf.length < 100 || !(buf[0] === 0xff && buf[1] === 0xd8)) return cb(400, {ok: false, error: 'Bild ist kein JPEG'});

  var paths = [], bad = [];
  uris.forEach(function(u){ var p = resolveUri(u); if (p && !p.missing) { p.uri = u; paths.push(p); } else bad.push(u); });
  if (!paths.length) return cb(400, {ok: false, error: 'keine gültigen Dateien'});
  var dirs = body.folder ? dirsOf(paths) : [];
  var exists = dirs.filter(function(d){ return fs.existsSync(path.join(d.full, FOLDER_JPG)); });
  if (exists.length && !body.overwrite) return cb(200, {ok: false, exists: exists.map(function(d){ return d.rel; })});

  var batch = newBatch(), bdir = path.join(COVER_DIR, batch), tmp = path.join(bdir, 'neu.jpg');
  try { mkdirs(bdir); fs.writeFileSync(tmp, buf); } catch (e) { return cb(500, {ok: false, error: 'Sicherungsordner nicht beschreibbar: ' + e.message}); }

  var results = bad.map(function(u){ return {uri: u, ok: false, error: 'Pfad nicht erlaubt oder Datei fehlt'}; });
  var changedRel = [], folders = [];
  dirs.forEach(function(d, i){                                  /* folder.jpg zuerst (schnell, ohne Python) */
    var target = path.join(d.full, FOLDER_JPG), backup = null;
    try {
      var lst = null;
      try { lst = fs.lstatSync(target); } catch (e) { /* noch keins */ }
      if (lst && !lst.isFile()) throw new Error(FOLDER_JPG + ' ist ein Verweis oder Ordner');
      if (lst) { backup = path.join(bdir, 'folder-' + i + '.jpg'); fs.writeFileSync(backup, fs.readFileSync(target)); }
      writeFolderJpg(target, buf);
      logEntry({batch: batch, time: new Date().toISOString(), folder: d.rel, cover: {backup: backup}});
      folders.push({dir: d.rel, ok: true});
    } catch (e) { folders.push({dir: d.rel, ok: false, error: e.message}); }
  });
  if (!body.embed) return finish();
  var i = 0;
  mapSeq(paths, function(p, done){
    runPy({op: 'cover_set', path: p.full, image: tmp, mime: 'image/jpeg', backup: path.join(bdir, String(i++))}, function(r){
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

/* Rückgängig: Text-Tags (before), eingebettete Cover und folder.jpg eines Auftrags zurücksetzen */
function doUndo(body, cb) {
  var entries = readLog().filter(function(e){ return e.batch === body.batch; });
  if (!entries.length) return cb(404, {ok: false, error: 'Änderung nicht gefunden'});
  var textEntries = entries.filter(function(e){ return e.before; });
  var coverEntries = entries.filter(function(e){ return e.cover && e.uri; });
  var folderEntries = entries.filter(function(e){ return e.cover && e.folder; });
  var results = [], changedRel = [];

  folderEntries.forEach(function(e){
    var dir = path.join(MUSIC_ROOT, e.folder), target = path.join(dir, FOLDER_JPG);
    try {
      if (e.folder.split('/').indexOf('..') >= 0) throw new Error('Pfad nicht erlaubt');
      if (e.cover.backup) writeFolderJpg(target, fs.readFileSync(e.cover.backup)); else fs.unlinkSync(target);
      results.push({folder: e.folder, ok: true, changed: true});
    } catch (err) { results.push({folder: e.folder, ok: false, error: err.message}); }
  });
  mapSeq(coverEntries, function(e, done){
    var p = resolveUri(e.uri);
    if (!p || p.missing) return done({uri: e.uri, ok: false, error: 'Datei nicht gefunden'});
    runPy({op: 'cover_set', path: p.full, image: e.cover.backup || null}, function(r){
      r.uri = e.uri;
      if (r.ok && r.changed) changedRel.push(p.rel);
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
    if (!e.uri) return;                                   /* folder.jpg-Einträge zählen nicht als Datei */
    if (!seen[e.batch]) { seen[e.batch] = {batch: e.batch, time: e.time, files: 0}; list.push(seen[e.batch]); }
    seen[e.batch].files++;
  });
  cb(200, {ok: true, batches: list.slice(0, 20)});
}

/* ---------- Last.fm für die Oberfläche ---------- */
/* GET /lastfmapi?method=…&artist=…: Abfragen der Oberfläche (Texte, ähnliche Künstler) mit dem Key des Dienstes,
   damit der Key nicht im Browser liegt. Nur lesende Methoden; Antworten 6 h im Speicher. */
var LFM_METHODS = ['artist.getinfo', 'album.getinfo', 'track.getinfo', 'artist.getsimilar'];
var LFM_PARAMS  = ['artist', 'album', 'track', 'lang', 'limit', 'autocorrect'];
var LFM_TTL = 6 * 3600000, LFM_MAX = 300;
var lfmCache = {}, lfmCacheKeys = [];
function doLastfmApi(query, cb) {
  var method = String(query.method || '').toLowerCase();
  if (LFM_METHODS.indexOf(method) < 0) return cb(400, {ok: false, error: 'method nicht erlaubt'});
  var key = keys.lastfm().key;
  if (!key) return cb(503, {ok: false, error: 'LASTFM_KEY fehlt'});
  var qs = 'method=' + method;
  LFM_PARAMS.forEach(function(p){ if (query[p]) qs += '&' + p + '=' + encodeURIComponent(String(query[p]).slice(0, 300)); });
  var hit = lfmCache[qs];
  if (hit && Date.now() - hit.at < LFM_TTL) return cb(200, hit.data);
  var base = process.env.LASTFM_URL || 'https://ws.audioscrobbler.com';
  coversearch.fetchUrl(base + '/2.0/?' + qs + '&api_key=' + encodeURIComponent(key) + '&format=json', 2 * 1024 * 1024, function(e, r){
    var data = null;
    if (!e) { try { data = JSON.parse(r.body.toString('utf8')); } catch (x) { /* kein JSON */ } }
    if (!data) return cb(200, {});                       /* wie "nichts gefunden"; nicht merken */
    if (!lfmCache[qs]) { lfmCacheKeys.push(qs); if (lfmCacheKeys.length > LFM_MAX) delete lfmCache[lfmCacheKeys.shift()]; }
    lfmCache[qs] = {at: Date.now(), data: data};
    cb(200, data);
  });
}

/* ---------- HTTP ---------- */

function send(res, code, obj) {
  var h = guard.corsHeaders(res.xplorioOrigin);
  h['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

/* Zusätzlich erlaubte Namen des Players (APP_CONFIG.ALLOWED_HOSTS, XPLORIO_HOSTS); einmal je Minute neu gelesen */
var extraHostsAt = 0, extraHostsList = [];
function extraHosts() {
  if (Date.now() - extraHostsAt > 60000) { extraHostsList = guard.extraHosts(appConfig(), process.env.XPLORIO_HOSTS); extraHostsAt = Date.now(); }
  return extraHostsList;
}

var server = http.createServer(function(req, res){
  try { handle(req, res); }
  catch (e) {                                           /* ein Fehler in einer Anfrage reißt nicht den ganzen Dienst mit */
    console.error('Anfrage ' + req.method + ' ' + req.url.split('?')[0] + ' gescheitert: ' + (e && e.stack || e));
    if (!res.headersSent) send(res, 500, {ok: false, error: 'interner Fehler'});
  }
});
function handle(req, res) {
  /* nur die Oberfläche auf diesem Gerät (siehe guard.js) */
  var g = guard.check(req, req.method === 'POST', extraHosts());
  if (!g.ok) { res.writeHead(403, {'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin'}); return res.end(JSON.stringify({ok: false, error: 'nicht erlaubt (' + g.reason + ')'})); }
  res.xplorioOrigin = g.origin;
  var route = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && route === '/health')  return send(res, 200, {ok: true, lastfm: !!keys.lastfm().key, keysInWeb: keys.inWeb()});
  if (req.method === 'GET' && route === '/lastfmapi') return doLastfmApi(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/history') return doHistory(function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/image')   return doImage(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/coverimage') return doCoverImage(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/coversearch') return doCoverSearch(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/scan')    return doScanGet(function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/check')   return doCheckGet(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && ['/genrelist', '/genrealbums', '/albumgenre', '/decades', '/decadealbums', '/yearalbums', '/decadeprofile'].indexOf(route) >= 0)
    return doGenreLib(route, url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/genres')  return doGenres(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/radiocover')  return doRadioCover(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/stationlogo') return doStationLogo(url.parse(req.url, true).query, res);
  if (req.method === 'GET' && route === '/playback') return doPlaybackGet(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/sysinfo') return doSysinfo(url.parse(req.url, true).query, res);
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
  if (req.method === 'GET' && route === '/welcome') return doWelcome(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/discover') return doDiscover(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/random')  return doRandom(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/plays')   return doPlays(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/plays/resolve') return doResolve(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'GET' && route === '/lastfm')  return send(res, 200, {ok: true, recording: recording, lastfm: lfm.status()});
  if (req.method === 'GET' && route === '/artist')  return doArtist(url.parse(req.url, true).query, function(c, o){ send(res, c, o); });
  if (req.method === 'POST' && route === '/essentia') return doEssentiaUpload(req, res);
  if (req.method !== 'POST' || ['/read', '/write', '/undo', '/cover', '/scan', '/check', '/checkdone', '/lastfm', '/lyricsoffset', '/randommix', '/ratings', '/rate', '/service', '/servicelogin', '/power', '/playback', '/logs'].indexOf(route) < 0) return send(res, 404, {ok: false, error: 'unbekannter Pfad'});
  var data = '', tooBig = false;
  req.setEncoding('utf8');
  req.on('data', function(d){ data += d; if (data.length > MAX_BODY) { tooBig = true; req.destroy(); } });
  req.on('end', function(){
    if (tooBig) return;
    var body;
    try { body = JSON.parse(data); } catch (e) { return send(res, 400, {ok: false, error: 'Ungültiges JSON'}); }
    var fn = {'/read': doRead, '/write': doWrite, '/cover': doCover, '/scan': doScan, '/undo': doUndo, '/check': doCheckStart, '/checkdone': doCheckDone, '/lastfm': doLastfm, '/lyricsoffset': doOffsetSet, '/randommix': doRandomMix, '/ratings': doRatings, '/rate': doRate, '/service': doService, '/servicelogin': doServiceLogin, '/power': doPower, '/logs': doLogs, '/playback': doPlaybackSet}[route];
    try { fn(body || {}, function(c, o){ send(res, c, o); }); }
    catch (e) { console.error('Anfrage ' + route + ' gescheitert: ' + (e && e.stack || e)); if (!res.headersSent) send(res, 500, {ok: false, error: 'interner Fehler'}); }
  });
}

if (require.main === module) {
  server.listen(HTTP_PORT, function(){ console.log('tag-service auf Port ' + HTTP_PORT + ', Musik unter ' + MUSIC_ROOT); });
  if (process.env.HISTORY !== '0' && appConfig().HISTORY !== false) { recording = true; watchPlayer(); lfm.flush(); }
  setTimeout(function(){ albumsEnsure(); }, 90000);       /* Albenliste fürs Zufallsalbum vorbereiten */
  setTimeout(pruneLog, 30000);                            /* alte Rückgängig-Daten aufräumen */
  sysInfo.start();                                        /* CPU-Last messen (Seite „System“) */
  if (process.env.RELEASEDATES !== '0' && appConfig().RELEASEDATES !== false) releaseDates.start();   /* Geburtstage: MusicBrainz */
  if (process.env.MOODTAGS !== '0' && appConfig().MOODTAGS !== false) {
    moodCollector.start();
    setInterval(function(){ albumsEnsure(); }, 3600000);  /* Titelliste aktuell halten (liest nur neu, wenn MPD sich geändert hat) */
  }
}
module.exports = {pruneLog: pruneLog, resolveUri: resolveUri, scanDirs: scanDirs, server: server, tracker: tracker, playStore: playStore, lastfm: lfm, moodtags: moodCollector};
