/* plugin-install (tools/plugin-install.js): installs and updates the plugin through Volumio's websocket, with a stand-in
   for socket.io-client that answers like Volumio's plugin manager */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var T = fs.mkdtempSync(path.join(os.tmpdir(), 'xpinst-')), stub = path.join(T, 'io.js'), log = path.join(T, 'sent.json');
fs.writeFileSync(stub, [
  "var fs = require('fs');",
  "module.exports = {connect: function(url){",
  "  var h = {}, sock = {on: function(e, f){ h[e] = f; }, close: function(){},",
  "    emit: function(e, d){",
  "      fs.writeFileSync(process.env.SENT, JSON.stringify({url: url, event: e, data: d}));",
  "      var fail = process.env.FAIL === '1';",
  "      setTimeout(function(){ h.installPluginStatus({progress: 10, message: 'Downloading'}); }, 5);",
  "      setTimeout(function(){ h.installPluginStatus(fail ? {progress: 0, message: 'Error <b>x</b>'} : {progress: 100, message: 'Done'}); }, 10);",
  "    }};",
  "  setTimeout(function(){ h.connect(); }, 5);",
  "  return sock;",
  "}};"].join('\n'));
function run(args, env) {
  var e = {}; Object.keys(process.env).forEach(function(k){ e[k] = process.env[k]; });
  e.SOCKET_IO_CLIENT = stub; e.SENT = log;
  Object.keys(env || {}).forEach(function(k){ e[k] = env[k]; });
  return cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'plugin-install.js')].concat(args), {env: e, encoding: 'utf8'});
}

t('install: installPlugin with the zip from /tmp/plugins and confirm, exit 0 at 100 %', function(){
  var r = run(['install', 'xplorio.zip']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(log, 'utf8')), {url: 'http://127.0.0.1:3000', event: 'installPlugin',
    data: {url: 'http://127.0.0.1:3000/plugin-serve/xplorio.zip', confirm: true}});
  assert.ok(/\[10%\] Downloading/.test(r.stdout) && /\[100%\] Done/.test(r.stdout));
});
t('update: updatePlugin with category and name', function(){
  assert.strictEqual(run(['update', 'xplorio.zip']).status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(log, 'utf8')).data, {url: 'http://127.0.0.1:3000/plugin-serve/xplorio.zip', category: 'user_interface', name: 'xplorio'});
});
t('error from Volumio: exit 1 with the message', function(){
  var r = run(['update', 'xplorio.zip'], {FAIL: '1'});
  assert.strictEqual(r.status, 1); assert.ok(/Volumio reports an error: Error x/.test(r.stdout), r.stdout);
});
t('wrong arguments: nothing sent', function(){
  fs.unlinkSync(log);
  assert.strictEqual(run(['remove', 'xplorio.zip']).status, 2);
  assert.strictEqual(run(['install', '../etc/x.zip']).status, 2);
  assert.ok(!fs.existsSync(log));
});
console.log(n + ' checks');
