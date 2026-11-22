/* Rotel bridge run by the tag service on the Mac (XPLORIO_ROTEL_PARENT): ends when the tag service is gone, so no bridge
   is left behind holding the port (every new one then failed with EADDRINUSE every 10 s) */
var assert = require('assert'), cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
var BRIDGE = path.join(__dirname, '..', 'rotel', 'rotel-bridge.js'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotel-orphan-'));
function run(parent, port, cb) {
  var env = Object.assign({}, process.env, {XPLORIO_ROTEL_PARENT: String(parent), HTTP_PORT: String(port), APP_CONFIG_DIR: dir});
  var ch = cp.spawn(process.execPath, [BRIDGE], {env: env, stdio: 'ignore'}), ended = false;
  ch.on('exit', function(){ ended = true; });
  setTimeout(function(){ var e = ended; if (!e) ch.kill('SIGKILL'); cb(e); }, 7000);
}
var dead = cp.spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {encoding: 'utf8'}).stdout.trim();
run(dead, 18765, function(endedOrphan){
  assert.ok(endedOrphan, 'bridge of a tag service that is gone ends by itself');
  console.log('ok   tag service gone: the bridge ends by itself');
  run(process.pid, 18766, function(endedChild){
    assert.ok(!endedChild, 'bridge of a running tag service keeps running');
    console.log('ok   tag service running: the bridge keeps running');
    console.log('2 tests passed');
  });
});
