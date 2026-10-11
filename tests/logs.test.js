/* Protokolle (tags/logs.js): feste Quellen, Journal ohne Rechnernamen, Dateiende, fehlendes Leserecht */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var lg = require('../tags/logs.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-'));
var adj = path.join(dir, 'autodj.debug.log');
var rows = [];
for (var i = 1; i <= 500; i++) rows.push('[2026-10-11 10:00:00] Zeile ' + i);
fs.writeFileSync(adj, rows.join('\n') + '\n');
var files = {autodj: adj, smartplaylists: path.join(dir, 'fehlt.log')};

t('nur bekannte Quellen, Zeilen nur 100 oder 300', function(){
  assert.strictEqual(lg.lineCount('300'), 300);
  assert.strictEqual(lg.lineCount(5000), 100);
  assert.strictEqual(lg.lineCount('x'), 100);
  new lg.Logs({files: files, run: function(){ throw new Error('nicht aufrufen'); }}).read('/etc/passwd', 100, function(c, o){
    assert.strictEqual(c, 400); assert.ok(!o.ok);
  });
});

t('Plugin-Protokoll: letzte Zeilen, nur vorhandene Dateien als Quelle', function(){
  var l = new lg.Logs({files: files});
  assert.deepStrictEqual(l.sources(), ['volumio', 'mpd', 'tag-service', 'autodj']);
  l.read('autodj', 100, function(c, o){
    assert.ok(o.ok);
    assert.strictEqual(o.lines.length, 100);
    assert.strictEqual(o.lines[99], '[2026-10-11 10:00:00] Zeile 500');
    assert.strictEqual(o.lines[0], '[2026-10-11 10:00:00] Zeile 401');
  });
  l.read('smartplaylists', 300, function(c, o){ assert.strictEqual(o.error, 'missing'); });
});

t('großes Protokoll: nur das Ende wird gelesen, keine angeschnittene erste Zeile', function(){
  var big = path.join(dir, 'gross.log'), parts = [];
  for (var i = 0; i < 20000; i++) parts.push('Eintrag ' + i + ' ' + new Array(30).join('x'));
  fs.writeFileSync(big, parts.join('\n'));
  var tl = lg.tailFile(big, 300);
  assert.strictEqual(tl.length, 300);
  assert.strictEqual(tl[299].indexOf('Eintrag 19999 '), 0);
  assert.strictEqual(tl[0].indexOf('Eintrag 19700 '), 0);
});

t('Journal: fester Befehl, Rechnername entfernt, Kopfzeilen weg', function(){
  var calls = [];
  var out = '-- Logs begin at Sat 2026-10-10 08:00:00 CEST. --\nOct 11 10:56:07 mxstream volumio[812]: info: Play\nOct  1 09:00:00 mxstream volumio[812]: info: Stop\n';
  new lg.Logs({files: files, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(null, out, ''); }}).read('volumio', 300, function(c, o){
    assert.strictEqual(calls[0], '/bin/journalctl -u volumio -n 300 --no-pager -o short');
    assert.deepStrictEqual(o.lines, ['Oct 11 10:56:07 volumio[812]: info: Play', 'Oct  1 09:00:00 volumio[812]: info: Stop']);
  });
});

t('Journal ohne Leserecht: nojournal statt leerer Liste', function(){
  var l = new lg.Logs({files: files, run: function(f, a, cb){ cb(null, '', 'No journal files were opened due to insufficient permissions.\n'); }});
  l.read('mpd', 100, function(c, o){ assert.strictEqual(o.error, 'nojournal'); assert.ok(!o.ok); });
  l = new lg.Logs({files: files, run: function(f, a, cb){ cb(null, '-- No entries --\n', ''); }});
  l.read('mpd', 100, function(c, o){ assert.ok(o.ok); assert.deepStrictEqual(o.lines, []); });
});
console.log(n + ' Prüfungen');
