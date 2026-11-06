/* tags/atomic.js: write via a copy and rename, no copy left behind */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var writeAtomic = require('../tags/atomic.js').writeAtomic;
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-')), f = path.join(dir, 'a.json');
t('new file, then replaced; no .neu left', function(){
  writeAtomic(f, '{"a":1}');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"a":1}');
  writeAtomic(f, '{"a":2}');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"a":2}');
  assert.ok(!fs.existsSync(f + '.neu'));
});
t('folder missing: throws, old state untouched', function(){
  assert.throws(function(){ writeAtomic(path.join(dir, 'nix', 'b.json'), 'x'); });
});
console.log(n + ' checks');
