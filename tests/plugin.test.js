/* Volumio plugin (plugin/index.js, install.sh, tools/make-plugin.sh): build, what the plugin store asks for, the page:
   defaults on the first start, config.local.js written from the settings page, the services started and stopped
   via systemctl with their settings in /tmp/xplorio, settings page */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var http = require('http'), Module = require('module'), EventEmitter = require('events'), vm = require('vm');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var T = fs.mkdtempSync(path.join(os.tmpdir(), 'xplug-')), repo = path.join(__dirname, '..');

/* kew and v-conf come with npm install on the player: small stand-ins here */
function wrap(p) { return {then: function(a, b){ return wrap(p.then(a, b)); }, fail: function(f){ return wrap(p.catch(f)); }, _p: p}; }
var kew = {resolve: function(v){ return wrap(Promise.resolve(v)); },
           defer: function(){ var d = {}; d.promise = wrap(new Promise(function(res, rej){ d.resolve = res; d.reject = rej; })); return d; }};
function VConf() { this.d = {}; }
VConf.prototype.loadFile = function(f){ this.f = f; };
VConf.prototype.get = function(k){ return this.d[k]; };
VConf.prototype.set = function(k, v){ this.d[k] = v; };
var stubs = {kew: kew, 'v-conf': VConf}, resolve = Module._resolveFilename, load = Module._load;
Module._load = function(r){ return stubs[r] || load.apply(this, arguments); };
Module._resolveFilename = function(r){ return stubs[r] ? r : resolve.apply(this, arguments); };

cp.execSync('bash tools/make-plugin.sh . ' + path.join(T, 'build'), {cwd: repo});
var P = path.join(T, 'build/xplorio'), DATA = path.join(T, 'data');
fs.mkdirSync(path.join(DATA, 'data'), {recursive: true});
fs.writeFileSync(path.join(DATA, 'data/keys.json'), JSON.stringify({OTHER: 'bleibt', LASTFM_KEY: 'oldkey1'}));
fs.writeFileSync(path.join(DATA, 'config.local.js'), 'window.APP_CONFIG.ROTEL_PROFILE = {speakerB: false};\n');   /* own additions */
fs.mkdirSync(path.join(T, 'music/USB/Stick'), {recursive: true});
process.env.XPLORIO_DATA = DATA;
process.env.XPLORIO_MUSIC = path.join(T, 'music');
var RUN = path.join(T, 'run'); process.env.XPLORIO_RUN = RUN;
process.env.HTTP_PORT = '1234';                                     /* from Volumio's environment: must not reach the children */
function evalConfig() {
  var ctx = {window: {}};
  ['config.js', 'config.local.js'].forEach(function(f){ vm.runInNewContext(fs.readFileSync(path.join(P, 'app/web', f), 'utf8'), ctx); });
  return JSON.parse(JSON.stringify(ctx.window.APP_CONFIG));     /* objects of the other context: compare as plain data */
}

t('make-plugin: plugin files at the top, interface and services in app/, no own settings', function(){
  ['package.json', 'index.js', 'install.sh', 'UIConfig.json', 'i18n/strings_de.json', 'app/xplorio.html', 'app/web/js/core.js',
   'app/web/build.js', 'app/web/version.json', 'app/server/xplorio-server.js', 'app/tags/tag-service.js', 'app/rotel/rotel-bridge.js']
    .forEach(function(f){ assert.ok(fs.existsSync(path.join(P, f)), f); });
  assert.ok(!fs.existsSync(path.join(P, 'app/web/config.local.js')) && !fs.existsSync(path.join(P, 'app/tests')));
  ['app/app.html', 'app/web/config.local.js.example', 'app/tags/vendor/mutagen/_tools'].forEach(function(f){ assert.ok(!fs.existsSync(path.join(P, f)), f); });
  assert.ok(fs.existsSync(path.join(P, 'app/tags/vendor/mutagen/COPYING')));
  var pk = JSON.parse(fs.readFileSync(path.join(P, 'package.json'), 'utf8'));
  assert.strictEqual(pk.name, 'xplorio'); assert.strictEqual(pk.volumio_info.plugin_type, 'user_interface');
});

t('settings page: every text has a German and an English string', function(){
  var de = JSON.parse(fs.readFileSync(path.join(P, 'i18n/strings_de.json'), 'utf8')).XPLORIO;
  var en = JSON.parse(fs.readFileSync(path.join(P, 'i18n/strings_en.json'), 'utf8')).XPLORIO;
  var keys = (fs.readFileSync(path.join(P, 'UIConfig.json'), 'utf8').match(/XPLORIO\.[A-Z0-9_]+/g) || []).map(function(k){ return k.slice(8); });
  (fs.readFileSync(path.join(P, 'index.js'), 'utf8').match(/str\('[A-Z0-9_]+'\)/g) || []).forEach(function(m){ keys.push(m.slice(5, -2)); });
  ['THEME_AUTO', 'THEME_LIGHT', 'THEME_DARK', 'LANG_AUTO', 'TRI_AUTO', 'TRI_ON', 'TRI_OFF'].forEach(function(k){ keys.push(k); });
  keys.forEach(function(k){ assert.ok(de[k] && en[k], k); });
});

t('package.json: what the Volumio 4 plugin store asks for', function(){
  var pk = JSON.parse(fs.readFileSync(path.join(P, 'package.json'), 'utf8')), vi = pk.volumio_info;
  assert.deepStrictEqual(pk.engines, {node: '>=20', volumio: '>=4'});
  assert.deepStrictEqual(vi.os, ['bookworm']); assert.ok(vi.architectures.length && vi.details && vi.changelog && vi.prettyName);
  assert.ok(vi.boot_priority >= 1 && vi.boot_priority <= 10);
});

t('install.sh: systemd services of the plugin, only own files, no sudo rule, no copies into system paths', function(){
  var sh = fs.readFileSync(path.join(P, 'install.sh'), 'utf8');
  ['xplorio-web', 'xplorio-tags', 'xplorio-rotel'].forEach(function(u){ assert.ok(sh.indexOf('unit ' + u + ' ') >= 0, u); });
  assert.ok(/EnvironmentFile=-\/tmp\/xplorio\/\$1\.env/.test(sh) && /User=volumio/.test(sh));
  assert.ok(!/sudoers\.d\/[^ \n]*\s*<</.test(sh) && !/cp [^\n]*\/usr\/local/.test(sh) && !/\/volumio\//.test(sh.replace(/^#.*$/mg, '')));
  assert.ok(/plugininstallend"\s*$/.test(sh) && /rm -rf "\$SCRIPTPATH"/.test(sh));
  /* hardening: system folders read-only; no privileges except for the tag service (it needs sudo for systemctl) */
  assert.ok(/^ProtectSystem=full$/m.test(sh) && /^\$\{5:\+NoNewPrivileges=true\}$/m.test(sh));
  assert.ok(/unit xplorio-web .* nopriv$/m.test(sh) && /unit xplorio-rotel .* nopriv$/m.test(sh) && !/unit xplorio-tags .*nopriv/.test(sh));
});

t('uninstall.sh: caches and runtime files go, the user\'s data stays', function(){
  var X = path.join(T, 'uninst'), D = path.join(X, 'data');
  ['artists', 'radio-covers', 'stations', 'covers/b1', 'moodtags'].forEach(function(d){ fs.mkdirSync(path.join(D, d), {recursive: true}); });
  ['artists/a.jpg', 'stations/s.jpg', 'albums.json', 'library-tracks.json', 'check.json', 'sysinfo.json', 'welcome.json',
   'together.json', 'ratings.json.neu', 'plays.jsonl', 'ratings.json', 'lyrics-offsets.json', 'admin.json', 'keys.json', 'lastfm.json',
   'changes.jsonl', 'covers/b1/0', 'essentia.jsonl', 'moodtags/tracks.jsonl', 'releasedates.jsonl'].forEach(function(f){ fs.writeFileSync(path.join(D, f), 'x'); });
  fs.writeFileSync(path.join(X, 'config.local.js'), 'x');
  var r = cp.spawnSync('bash', [path.join(P, 'uninstall.sh')], {encoding: 'utf8', env: Object.assign({}, process.env, {XPLORIO_DATA: X})});
  assert.ok(/pluginuninstallend/.test(r.stdout), r.stdout + r.stderr);
  assert.deepStrictEqual(fs.readdirSync(D).sort(), ['admin.json', 'changes.jsonl', 'covers', 'essentia.jsonl', 'keys.json', 'lastfm.json',
    'lyrics-offsets.json', 'moodtags', 'plays.jsonl', 'ratings.json', 'releasedates.jsonl']);
  assert.ok(fs.existsSync(path.join(X, 'config.local.js')) && fs.existsSync(path.join(D, 'covers/b1/0')));
});

var Plugin = require(path.join(P, 'index.js'));
var toasts = [], calls = [], failing = {};
function makePlugin() {
  var p = new Plugin({coreCommand: {
      pluginManager: {getConfigurationFile: function(){ return path.join(T, 'conf/config.json'); }},
      pushToastMessage: function(k, ti, tx){ toasts.push([k, tx]); },
      sharedVars: {get: function(){ return 'de'; }},
      i18nJson: function(a, b, ui){ return kew.resolve(JSON.parse(fs.readFileSync(ui, 'utf8'))); }},
    logger: {info: function(){}, error: function(){}}});
  /* /usr/bin/sudo -n /bin/systemctl <action> <unit> */
  p.exec = function(cmd, args, cb){
    calls.push([cmd].concat(args).join(' '));
    setImmediate(function(){ cb(failing[args[3]] ? new Error('failed') : null); });
  };
  return p;
}
var PORT = 40000 + Math.floor(Math.random() * 20000), plug = makePlugin();
function el(ui, id) {
  var all = []; ui.sections.forEach(function(s){ all = all.concat(s.content || []); });
  return all.filter(function(c){ return c.id === id; })[0];
}
function sudo() { return calls.filter(function(c){ return /^\/usr\/bin\/sudo/.test(c); }).map(function(c){ return c.replace('/usr/bin/sudo -n /bin/systemctl ', ''); }); }
function env(u) { return fs.readFileSync(path.join(RUN, u + '.env'), 'utf8'); }
var kf = path.join(DATA, 'data/keys.json');

plug.onVolumioStart();
t('first start: defaults from config.js on the page, nothing started yet', function(){
  var c = plug.config;
  assert.deepStrictEqual([c.get('port'), c.get('tagService'), c.get('rotelBridge')], [4040, true, false]);
  assert.deepStrictEqual([c.get('theme'), c.get('tidal'), c.get('qobuz'), c.get('history'), c.get('language')], ['auto', 'auto', 'auto', true, '']);
  assert.strictEqual(c.get('rotelHost'), '');
  assert.ok(c.get('imported') === undefined);
  c.set('theme', 'dark'); plug.defaults();
  assert.strictEqual(c.get('theme'), 'dark');                     /* set values stay */
  assert.deepStrictEqual(calls, []);                               /* nothing started before onStart */
  c.set('theme', 'auto'); c.set('tidal', 'off'); c.set('rotelBridge', true);
  c.set('rotelHost', '192.168.1.50'); c.set('rotelInputs', 'aux=Plattenspieler/phono');
});
plug.config.set('port', PORT);
plug.onStart().then(function(){
  t('start: the services switched on via systemctl (sudo)', function(){
    assert.deepStrictEqual(sudo(), ['restart xplorio-web.service', 'restart xplorio-tags.service', 'restart xplorio-rotel.service']);
  });
  t('start: settings of the services in /tmp/xplorio/<service>.env', function(){
    assert.strictEqual(env('xplorio-web'), 'HTTP_PORT=' + PORT + '\nXPLORIO_WWW=' + path.join(P, 'app') + '\n');
    assert.ok(env('xplorio-tags').indexOf('APP_CONFIG_DIR=' + path.join(P, 'app/web') + '\nTAGS_DATA=' + path.join(DATA, 'data') + '\n') === 0);
    assert.strictEqual(env('xplorio-rotel'), 'APP_CONFIG_DIR=' + path.join(P, 'app/web') + '\n');
  });
  t('config.local.js: written by the plugin, own additions first, then the values of the settings page', function(){
    var f = path.join(P, 'app/web/config.local.js');
    assert.ok(!fs.lstatSync(f).isSymbolicLink());
    var c = evalConfig();
    assert.deepStrictEqual([c.THEME, c.TIDAL, c.QOBUZ, c.ROTEL, c.ROTEL_HOST, c.HISTORY], ['auto', false, 'auto', true, '192.168.1.50', true]);
    assert.deepStrictEqual(c.ROTEL_INPUTS, {aux: {name: 'Plattenspieler', icon: 'phono'}});
    assert.deepStrictEqual(c.ROTEL_PROFILE, {speakerB: false});
  });
  t('config.local.js: a broken own file is left out, the settings still apply', function(){
    var own = path.join(DATA, 'config.local.js'), keep = fs.readFileSync(own, 'utf8');
    fs.writeFileSync(own, 'window.APP_CONFIG.THEME = ;');
    plug.writeConfig();
    assert.ok(plug.ownBroken); assert.strictEqual(evalConfig().ROTEL_HOST, '192.168.1.50');
    fs.writeFileSync(own, 'window.APP_CONFIG.ROTEL_PROFILE = {speakerB: false}; throw new Error("x");');
    plug.writeConfig();
    assert.ok(!plug.ownBroken); assert.strictEqual(evalConfig().THEME, 'auto');       /* error while running: rest still runs */
    fs.writeFileSync(own, keep); plug.writeConfig();
  });
  calls = [];
  return plug.onStop();
}).then(function(){
  t('stop: all services of the plugin stopped, nothing else', function(){
    assert.deepStrictEqual(sudo(), ['stop xplorio-web.service', 'stop xplorio-tags.service', 'stop xplorio-rotel.service']);
  });
  /* the port taken by something else: message, the plugin does not count as started */
  var blocker = require('net').createServer().listen(PORT);
  return new Promise(function(res){ blocker.on('listening', res); }).then(function(){
    calls = [];
    return new Promise(function(res){ plug.onStart().then(function(){ res('started'); }, function(e){ res(e.message); }); });
  }).then(function(r){
    t('start: port in use, message and the start fails, the web server is not started', function(){
      assert.ok(/in use/.test(r), r);
      assert.ok(/Port \d+ ist belegt/.test(toasts.pop()[1]));
      assert.ok(sudo().indexOf('restart xplorio-web.service') < 0);
    });
    blocker.close();
  });
}).then(function(){
  failing['xplorio-web.service'] = true; calls = [];
  return new Promise(function(res){ plug.onStart().then(function(){ res('started'); }, function(e){ res(e.message); }); });
}).then(function(r){
  t('start: the web server does not start, the plugin reports a failed start (red indicator)', function(){ assert.ok(/did not start/.test(r), r); });
  delete failing['xplorio-web.service'];
  return plug.getUIConfig();
}).then(function(ui){
  t('settings page: link to the plugin port, current values, choices', function(){
    assert.ok(new RegExp(':' + PORT + '/$').test(ui.sections[0].content[0].onClick.url));
    assert.deepStrictEqual(['port', 'tagService', 'rotelBridge', 'rotelHost', 'history'].map(function(id){ return el(ui, id).value; }),
                           [PORT, true, true, '192.168.1.50', true]);
    assert.deepStrictEqual(el(ui, 'tidal').value, {value: 'off', label: 'Nie'});
    assert.deepStrictEqual(el(ui, 'language').options.map(function(o){ return o.label; }), ['Automatisch', 'Deutsch', 'English', 'Français', 'Español', 'Italiano']);
    assert.strictEqual(el(ui, 'rotelInputs').value, 'aux=Plattenspieler/phono');
    assert.ok(/Gespeichert/.test(el(ui, 'lastfmKey').doc) && /Noch nicht/.test(el(ui, 'lastfmSecret').doc) && el(ui, 'lastfmKey').value === '');
    assert.strictEqual(el(ui, 'lastfmKey').label, 'Last.fm API-Key (gespeichert)');
    assert.strictEqual(el(ui, 'lastfmSecret').label, 'Last.fm Shared Secret (nicht eingetragen)');
    assert.ok(/noch keins gesetzt/.test(el(ui, 'password').label));
    assert.ok(JSON.stringify(ui).indexOf('oldkey1') < 0);
    assert.ok(/Noch kein Passwort/.test(el(ui, 'password').doc) && !el(ui, 'passwordOld') && !el(ui, 'tagsRoot'));
    ui.sections.slice(1).forEach(function(s){
      assert.deepStrictEqual(s.saveButton.data, s.content.map(function(c){ return c.id; }));
      assert.strictEqual(s.onSave.method, 'saveSettings');
    });
  });
  function refused(data, what) {
    var before = JSON.stringify(plug.config.d);
    plug.saveSettings(data);
    var last = toasts.pop();
    assert.ok(last[0] === 'error' && what.test(last[1]), last); assert.strictEqual(JSON.stringify(plug.config.d), before);
  }
  t('saving: wrong values are refused with a message, nothing changes', function(){
    refused({port: 3000, tagService: true}, /Port/);
    refused({lastfmKey: 'abc def'}, /ungültige Zeichen/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt', LASTFM_KEY: 'oldkey1'});
    refused({rotelBridge: true, rotelHost: '', rotelInputs: ''}, /Adresse des Verstärkers/);
    refused({rotelBridge: true, rotelHost: '1.2.3.4; rm', rotelInputs: ''}, /ungültige Zeichen/);
    refused({rotelBridge: true, rotelHost: '1.2.3.4', rotelInputs: 'aux=Platte/blink'}, /Eingänge/);
    refused({theme: {value: 'pink', label: 'x'}}, /Auswahl/);
    refused({allowedHosts: 'a.example.net, b c'}, /Namen/);
    refused({password: 'abc'}, /4 Zeichen/);
    assert.ok(!fs.existsSync(path.join(DATA, 'data/admin.json')));
  });
  return plug.saveSettings({password: 'geheim'});
}).then(function(){
  t('password for the System page set from the settings page, no restart needed', function(){
    assert.ok(fs.existsSync(path.join(DATA, 'data/admin.json')));
    assert.deepStrictEqual(toasts.pop(), ['success', 'Passwort gespeichert.']);
  });
  return plug.saveSettings({password: 'anders', passwordOld: 'falsch'});
}).then(function(){
  t('password: once set, changed only with the current one (the plugin page is open to everyone)', function(){
    assert.deepStrictEqual(toasts.pop(), ['error', 'Das bisherige Passwort stimmt nicht, nichts geändert.']);
  });
  return plug.saveSettings({password: 'anders', passwordOld: 'geheim'});
}).then(function(){
  var d = kew.defer();
  new (require(path.join(P, 'app/tags/adminpass.js')).Auth)(path.join(DATA, 'data')).verify('anders', 0, d.resolve);
  return d.promise;
}).then(function(r){
  t('password: changed with the right current one', function(){ assert.ok(r.ok); assert.strictEqual(toasts.pop()[0], 'success'); });
  return plug.saveSettings({theme: {value: 'light', label: 'Immer hell'}, tidal: {value: 'on', label: 'Immer'}, history: false,
                            allowedHosts: ' player.example.net ,x.lan', releaseDates: true, moodTags: true, colorMood: true,
                            m4aProbe: true, m4aLossless: false, qobuz: {value: 'auto'}, hra: {value: 'off'}, spotify: {value: 'auto'}});
}).then(function(){
  return plug.saveSettings({port: String(PORT), tagService: false, language: {value: 'en'}, theme: {value: 'light'}});
}).then(function(){
  calls = [];
  return plug.saveSettings({rotelBridge: true, rotelHost: '10.0.0.9', rotelInputs: 'aux = Plattenspieler / phono, OPT1=TV'});
}).then(function(){
  t('saving: values into config.local.js; restart: all stopped, then only the services switched on', function(){
    var c = evalConfig();
    assert.deepStrictEqual([c.THEME, c.TIDAL, c.HRA, c.HISTORY, c.M4A_LOSSLESS, c.LANGUAGE, c.ROTEL_HOST], ['light', true, false, false, false, 'en', '10.0.0.9']);
    assert.deepStrictEqual(c.ALLOWED_HOSTS, ['player.example.net', 'x.lan']);
    assert.deepStrictEqual(c.ROTEL_INPUTS, {aux: {name: 'Plattenspieler', icon: 'phono'}, opt1: {name: 'TV'}});
    assert.deepStrictEqual(sudo(), ['stop xplorio-web.service', 'stop xplorio-tags.service', 'stop xplorio-rotel.service',
                                    'restart xplorio-web.service', 'restart xplorio-rotel.service']);
    assert.strictEqual(toasts.pop()[0], 'success');
  });
  plug.saveSettings({lastfmKey: ' abc123 ', lastfmSecret: '', lastfmClear: false});
  t('Last.fm: key into keys.json (only for the service), other entries stay; no restart', function(){
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt', LASTFM_KEY: 'abc123'});
    assert.strictEqual(fs.statSync(kf).mode & 511, 384);
    assert.deepStrictEqual(toasts.pop(), ['success', 'Last.fm-Zugang gespeichert.']);
    plug.saveKeys({LASTFM_KEY: '', LASTFM_SECRET: 'sec1'});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt', LASTFM_KEY: 'abc123', LASTFM_SECRET: 'sec1'});
  });
  return plug.getUIConfig();
}).then(function(ui2){
  t('settings page shows "saved" for Last.fm and the password, never the values; delete removes both', function(){
    assert.ok(el(ui2, 'passwordOld') && /Neues Passwort/.test(el(ui2, 'password').label));
    assert.ok(/Gespeichert/.test(el(ui2, 'lastfmKey').doc) && /Gespeichert/.test(el(ui2, 'lastfmSecret').doc));
    assert.ok(JSON.stringify(ui2).indexOf('abc123') < 0 && JSON.stringify(ui2).indexOf('anders') < 0);
    assert.ok(/Passwort ist gesetzt/.test(el(ui2, 'password').doc));
    plug.saveSettings({lastfmKey: '', lastfmSecret: '', lastfmClear: true});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt'});
  });
  console.log(n + ' checks passed'); process.exit(0);
}).fail(function(e){ console.error(e); process.exit(1); });
