/* Runs all *.test.js in this folder one after another. Usage: node tests/run-all.js */
var fs = require('fs'), path = require('path'), cp = require('child_process');
var files = fs.readdirSync(__dirname).filter(function(f){ return /\.test\.js$/.test(f); }).sort();
var failed = [];
files.forEach(function(f){
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  var out = (r.stdout || '') + (r.stderr || '');
  var ok = (out.match(/^ok /gm) || []).length, bad = (out.match(/^FAIL /gm) || []).length;
  console.log((r.status === 0 ? 'ok    ' : 'FAIL  ') + f + '  (' + ok + ' ok' + (bad ? ', ' + bad + ' failed' : '') + ')');
  if (r.status !== 0) { failed.push(f); console.log(out); }
});
console.log(failed.length ? '\n' + failed.length + ' file(s) with failures' : '\nall tests passed');
process.exit(failed.length ? 1 : 0);
