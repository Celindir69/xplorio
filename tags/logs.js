/* Protokolle für die Seite „System“: letzte Zeilen aus dem Journal (Volumio, MPD, Tag-Dienst) und aus den
   Protokolldateien der Plugins AutoDJ und Smart Playlists. Nur die Quellen aus SOURCES, nur 100 oder 300 Zeilen.
   Das Journal kann der Benutzer volumio nur lesen, wenn er in der Gruppe systemd-journal ist (Anleitung:
   docs/einrichten.md, „Protokolle“); sonst meldet die Quelle „nojournal“. Node 8, nur ES5.
   opts: run (Ersatz für execFile), files ({autodj, smartplaylists}: andere Pfade, Tests) */
var fs = require('fs'), cp = require('child_process');

var JOURNALCTL = '/bin/journalctl', TIMEOUT = 8000, LINES = [100, 300], MAX_LINE = 2000, TAIL_BYTES = 256 * 1024;
var SOURCES = [
  {id: 'volumio',        unit: 'volumio'},
  {id: 'mpd',            unit: 'mpd'},
  {id: 'tag-service',    unit: 'tag-service'},
  {id: 'autodj',         file: '/data/volumio_autodj_data/autodj.debug.log'},
  {id: 'smartplaylists', file: '/data/smart_playlists_data/smart_playlists.debug.log'}
];

function sourceOf(id) {
  for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i];
  return null;
}
function lineCount(n) { n = parseInt(n, 10); return LINES.indexOf(n) >= 0 ? n : LINES[0]; }

/* journalctl -o short: „Okt 11 10:56:07 rechner volumio[123]: …“ – den Rechnernamen weglassen */
function cleanJournal(text) {
  return String(text || '').split('\n').filter(function(l){ return l && !/^-- (Logs begin|No entries|Reboot)/.test(l); })
    .map(function(l){ return l.replace(/^(\S+ +\d+ \d\d:\d\d:\d\d) \S+ /, '$1 '); });
}
/* ohne Leserecht gibt journalctl nichts oder nur einen Hinweis aus, oft mit Rückgabewert 0 */
function noJournal(lines, stderr) {
  return !lines.length && /permission|journal files|systemd-journal|not seeing messages/i.test(String(stderr || ''));
}

/* letzte n Zeilen einer Datei, nur das Ende lesen */
function tailFile(file, n) {
  var fd;
  try {
    fd = fs.openSync(file, 'r');
    var size = fs.fstatSync(fd).size, len = Math.min(size, TAIL_BYTES), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    var lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift();                       /* erste Zeile ist angeschnitten */
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

/* welche Quellen gibt es? Plugin-Protokolle nur, wenn die Datei da ist */
Logs.prototype.sources = function() {
  var self = this;
  return SOURCES.filter(function(s){ return s.unit || fs.existsSync(self.path(s)); }).map(function(s){ return s.id; });
};

/* cb(code, {ok, source, lines, sources}) */
Logs.prototype.read = function(id, n, cb) {
  var s = sourceOf(id), list = this.sources();
  if (!s) return cb(400, {ok: false, error: 'nicht erlaubt'});
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
