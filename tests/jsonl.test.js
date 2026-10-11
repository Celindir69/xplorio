/* JSON Lines zeilenweise (tags/jsonl.js): Blockgrenzen, Umlaute, letzte Zeile ohne Zeilenumbruch, fehlende Datei */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var jsonl = require('../tags/jsonl.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
process.on('exit', function(code){ if (!code) { assert.strictEqual(n, 3, 'nicht alle Prüfungen fertig'); console.log(n + ' Prüfungen'); } });

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));

t('viele Zeilen über Blockgrenzen, Umlaute heil, leere Zeilen übersprungen', function(){
  var rows = [], f = path.join(dir, 'a.jsonl');
  for (var i = 0; i < 6000; i++) rows.push(JSON.stringify({i: i, ti: 'Grüße ' + i + ' ' + new Array(i % 97).join('ä')}));
  fs.writeFileSync(f, rows.join('\n\n') + '\n');
  assert.ok(fs.statSync(f).size > 2 * jsonl.CHUNK);
  var got = [];
  assert.strictEqual(jsonl.eachLine(f, function(l){ got.push(jsonl.parse(l)); }), true);
  assert.strictEqual(got.length, 6000);
  got.forEach(function(o, i){ assert.strictEqual(o.i, i); assert.strictEqual(o.ti, 'Grüße ' + i + ' ' + new Array(i % 97).join('ä')); });
});

t('letzte Zeile ohne Zeilenumbruch, kaputte Zeile ergibt null', function(){
  var f = path.join(dir, 'b.jsonl'), got = [];
  fs.writeFileSync(f, '{"a":1}\n{kaputt\n{"a":2}');
  jsonl.eachLine(f, function(l){ got.push(jsonl.parse(l)); });
  assert.deepStrictEqual(got, [{a: 1}, null, {a: 2}]);
});

t('fehlende Datei: false, kein Aufruf', function(){
  var called = false;
  assert.strictEqual(jsonl.eachLine(path.join(dir, 'fehlt.jsonl'), function(){ called = true; }), false);
  assert.ok(!called);
});
