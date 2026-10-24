/* Logs for the "System" page: last lines from the journal (Volumio, MPD, tag service) and from the
   log files of the AutoDJ and Smart Playlists plugins. Only the sources in SOURCES, only 50, 100 or 300 lines.
   The volumio user can read the journal only if it is in the systemd-journal group (instructions:
   docs/einrichten.md, "Protokolle"); otherwise the source reports "nojournal". Node 8, ES5 only.
   opts: run (replacement for execFile), files ({autodj, smartplaylists}: other paths, tests) */
var fs = require('fs'), cp = require('child_process');

var JOURNALCTL = '/bin/journalctl', TIMEOUT = 8000, LINES = [50, 100, 300], MAX_LINE = 2000, TAIL_BYTES = 256 * 1024;
var SOURCES = [
  {id: 'volumio',        unit: 'volumio'},
  {id: 'mpd',            unit: 'mpd'},
  {id: 'tag-service',    unit: process.env.XPLORIO_UNIT || 'tag-service'},   /* xplorio-tags as a Volumio plugin */
  {id: 'autodj',         file: '/data/volumio_autodj_data/autodj.debug.log'},
  {id: 'smartplaylists', file: '/data/smart_playlists_data/smart_playlists.debug.log'}
];

function sourceOf(id) {
  for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i];
  return null;
}
function lineCount(n) { n = parseInt(n, 10); return LINES.indexOf(n) >= 0 ? n : LINES[0]; }

/* journalctl -o short: "Okt 11 10:56:07 host volumio[123]: …" – drop the host name */
function cleanJournal(text) {
  return String(text || '').split('\n').filter(function(l){ return l && !/^-- (Logs begin|No entries|Reboot)/.test(l); })
    .map(function(l){ return l.replace(/^(\S+ +\d+ \d\d:\d\d:\d\d) \S+ /, '$1 '); });
}
/* without read permission journalctl prints nothing or just a hint, often with exit code 0 */
function noJournal(lines, stderr) {
  return !lines.length && /permission|journal files|systemd-journal|not seeing messages/i.test(String(stderr || ''));
}

/* last n lines of a file, reading only the end */
function tailFile(file, n) {
  var fd;
  try {
    fd = fs.openSync(file, 'r');
    var size = fs.fstatSync(fd).size, len = Math.min(size, TAIL_BYTES), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    var lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift();                       /* first line is cut off */
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-n);
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {}
  }
}

function defaultRun(file, args, cb) {
  cp.execFile(file, args, {timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024}, function(err, stdout, stderr){
    cb(err, String(stdout || ''), String(stderr || ''));
  });
}

function Logs(opts) {
  opts = opts || {};
  this.run = opts.run || defaultRun;
  this.files = opts.files || {};
}

Logs.prototype.path = function(s) { return this.files[s.id] || s.file; };

/* which sources exist? plugin logs only if the file is there */
Logs.prototype.sources = function() {
  var self = this;
  return SOURCES.filter(function(s){ return s.unit || fs.existsSync(self.path(s)); }).map(function(s){ return s.id; });
};

/* cb(code, {ok, source, lines, sources}) */
Logs.prototype.read = function(id, n, cb) {
  var s = sourceOf(id), list = this.sources();
  if (!id) return cb(200, {ok: true, source: '', lines: [], sources: list});   /* only the list of sources */
  if (!s) return cb(400, {ok: false, error: 'not allowed'});
  n = lineCount(n);
  function done(lines, error) {
    var o = {ok: !error, source: s.id, lines: (lines || []).map(function(l){ return l.length > MAX_LINE ? l.slice(0, MAX_LINE) + '…' : l; }), sources: list};
    if (error) o.error = error;
    cb(200, o);
  }
  if (s.file) {
    var t = tailFile(this.path(s), n);
    return t ? done(t) : done(null, 'missing');
  }
  this.run(JOURNALCTL, ['-u', s.unit, '-n', String(n), '--no-pager', '-o', 'short'], function(err, out, stderr){
    var lines = cleanJournal(out);
    if (noJournal(lines, stderr) || (err && !lines.length && /permission/i.test(stderr || ''))) return done(null, 'nojournal');
    if (err && !lines.length) return done(null, 'journal');
    done(lines.slice(-n));
  });
};

module.exports = {Logs: Logs, SOURCES: SOURCES, LINES: LINES, sourceOf: sourceOf, lineCount: lineCount, cleanJournal: cleanJournal, tailFile: tailFile};
