/* Mac program (tools/mac/make-app.sh, xplorio-services.sh): bundle layout, settings, taking over the test setup.
   Runs the script without swiftc (XPLORIO_NO_SWIFT) and with a stand-in for mpd. */
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var ROOT = path.join(__dirname, '..');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-mac-')); }
function make(dir, env) {
  var bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, {recursive: true});
  fs.writeFileSync(path.join(bin, 'mpd'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  var e = Object.assign({}, process.env, {HOME: path.join(dir, 'home'), PATH: bin + ':' + process.env.PATH, XPLORIO_NO_SWIFT: '1',
                                          XPLORIO_APPS: path.join(dir, 'apps'), XPLORIO_SUPPORT: path.join(dir, 'Application Support', 'Xplorio')}, env || {});
  fs.mkdirSync(e.HOME, {recursive: true});
  var r = cp.spawnSync('bash', [path.join(ROOT, 'tools', 'mac', 'make-app.sh')], {env: e, encoding: 'utf8'});
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  return e;
}
function conf(e) {
  var o = {};
  fs.readFileSync(path.join(e.XPLORIO_SUPPORT, 'xplorio.conf'), 'utf8').split('\n').forEach(function(l){
    var m = /^(\w+)="(.*)"$/.exec(l);
    if (m) o[m[1]] = m[2];
  });
  return o;
}

t('scripts are valid bash', function(){
  ['make-app.sh', 'xplorio-services.sh'].forEach(function(f){
    assert.strictEqual(cp.spawnSync('bash', ['-n', path.join(ROOT, 'tools', 'mac', f)]).status, 0, f);
  });
});

t('new setup: music folder as USB, MPD settings, program with the interface and settings links', function(){
  var d = tmp(), music = path.join(d, 'Musik');
  fs.mkdirSync(music);
  var e = make(d, {XPLORIO_MUSIC: music});
  var c = conf(e);
  assert.strictEqual(c.MPD_PORT, '6600');
  assert.strictEqual(fs.realpathSync(path.join(c.MUSIC_ROOT, 'USB')), fs.realpathSync(music));
  var mc = fs.readFileSync(c.MPD_CONF, 'utf8');
  assert.ok(mc.indexOf('music_directory "' + c.MUSIC_ROOT + '"') >= 0);
  assert.ok(/bind_to_address "127\.0\.0\.1"/.test(mc));
  var app = path.join(e.XPLORIO_APPS, 'Xplorio.app', 'Contents');
  assert.ok(/<key>CFBundleExecutable<\/key><string>Xplorio<\/string>/.test(fs.readFileSync(path.join(app, 'Info.plist'), 'utf8')));
  assert.ok(fs.existsSync(path.join(app, 'MacOS', 'Xplorio')));
  ['xplorio.html', 'web/js/player.js', 'tags/mpdplayer.js', 'server/xplorio-server.js', 'mac/xplorio-services.sh'].forEach(function(f){
    assert.ok(fs.existsSync(path.join(app, 'Resources', 'xplorio', f)), f);
  });
  assert.ok(/PLAYER = 'mpd'/.test(fs.readFileSync(path.join(app, 'Resources', 'xplorio', 'web', 'config.local.js'), 'utf8')));
  assert.strictEqual(fs.realpathSync(path.join(app, 'Resources', 'xplorio.conf')), fs.realpathSync(path.join(e.XPLORIO_SUPPORT, 'xplorio.conf')));
});

t('folder that already has INTERNAL/USB/NAS is used as it is', function(){
  var d = tmp(), music = path.join(d, 'Musik');
  fs.mkdirSync(path.join(music, 'INTERNAL'), {recursive: true});
  assert.strictEqual(conf(make(d, {XPLORIO_MUSIC: music})).MUSIC_ROOT, music);
});

t('test setup in ~/xplorio-mpd is taken over (library, port, history); own settings stay on a rebuild', function(){
  var d = tmp(), home = path.join(d, 'home'), x = path.join(home, 'xplorio-mpd');
  fs.mkdirSync(path.join(x, 'xplorio-daten'), {recursive: true});
  fs.writeFileSync(path.join(x, 'mpd.conf'), 'music_directory "/Users/a/xplorio-mpd/musik"\nport            "6611"\n');
  var e = make(d);
  var c = conf(e);
  assert.strictEqual(c.MPD_CONF, path.join(x, 'mpd.conf'));
  assert.strictEqual(c.MUSIC_ROOT, '/Users/a/xplorio-mpd/musik');
  assert.strictEqual(c.MPD_PORT, '6611');
  assert.strictEqual(c.TAGS_DATA, path.join(x, 'xplorio-daten'));
  var cl = path.join(e.XPLORIO_SUPPORT, 'config.local.js');
  fs.appendFileSync(cl, "window.APP_CONFIG.LANGUAGE = 'de';\n");
  make(d);
  var s = fs.readFileSync(cl, 'utf8');
  assert.ok(/LANGUAGE = 'de'/.test(s));
  assert.strictEqual((s.match(/PLAYER/g) || []).length, 1);
});

console.log(n + ' tests passed');
