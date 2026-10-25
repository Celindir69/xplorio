/* JSON Lines line by line (tags/jsonl.js): chunk boundaries, umlauts, last line without newline, missing file */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var jsonl = require('../tags/jsonl.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
process.on('exit', function(code){ if (!code) { assert.strictEqual(n, 4, 'not all checks finished'); console.log(n + ' checks'); } });

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));

t('many lines across chunk boundaries, umlauts intact, empty lines skipped', function(){
  var rows = [], f = path.join(dir, 'a.jsonl');
  for (var i = 0; i < 6000; i++) rows.push(JSON.stringify({i: i, ti: 'Grüße ' + i + ' ' + new Array(i % 97).join('ä')}));
  fs.writeFileSync(f, rows.join('\n\n') + '\n');
  assert.ok(fs.statSync(f).size > 2 * jsonl.CHUNK);
  var got = [];
  assert.strictEqual(jsonl.eachLine(f, function(l){ got.push(jsonl.parse(l)); }), true);
  assert.strictEqual(got.length, 6000);
  got.forEach(function(o, i){ assert.strictEqual(o.i, i); assert.strictEqual(o.ti, 'Grüße ' + i + ' ' + new Array(i % 97).join('ä')); });
});

t('last line without newline, broken line yields null', function(){
  var f = path.join(dir, 'b.jsonl'), got = [];
  fs.writeFileSync(f, '{"a":1}\n{kaputt\n{"a":2}');
  jsonl.eachLine(f, function(l){ got.push(jsonl.parse(l)); });
  assert.deepStrictEqual(got, [{a: 1}, null, {a: 2}]);
});

t('overlong line is skipped as a whole, the lines after it are read', function(){
  var f = path.join(dir, 'c.jsonl'), got = [];
  fs.writeFileSync(f, '{"a":1}\n' + new Array(3 * jsonl.MAX_LINE).join('x') + '\n{"a":2}\n' + new Array(2 * jsonl.MAX_LINE).join('y'));
  jsonl.eachLine(f, function(l){ got.push(jsonl.parse(l)); });
  assert.deepStrictEqual(got, [{a: 1}, {a: 2}]);
});

t('missing file: false, no call', function(){
  var called = false;
  assert.strictEqual(jsonl.eachLine(path.join(dir, 'fehlt.jsonl'), function(){ called = true; }), false);
  assert.ok(!called);
});
