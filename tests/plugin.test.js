/* Volumio plugin (plugin/index.js, tools/make-plugin.sh): build and ZIP, settings of an earlier installation taken
   over, config.local.js written from the settings page, web server inside Volumio's process, child processes with the
   right settings, services left to systemd, restart via the System page (IPC), stop, settings page and its checks */
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
var P = path.join(T, 'build/xplorio'), DATA = path.join(T, 'data'), OLD = path.join(T, 'vhttp');
fs.mkdirSync(path.join(DATA, 'data'), {recursive: true});
fs.writeFileSync(path.join(DATA, 'data/keys.json'), JSON.stringify({OTHER: 'bleibt'}));
fs.mkdirSync(path.join(OLD, 'www3/web'), {recursive: true});
fs.writeFileSync(path.join(OLD, 'www3/web/config.local.js'), [
  'window.APP_CONFIG.ROTEL_HOST = "192.168.1.50";', 'window.APP_CONFIG.THEME = "dark";', 'window.APP_CONFIG.TIDAL = false;',
  'window.APP_CONFIG.ROTEL_INPUTS = {aux: {name: "Plattenspieler", icon: "phono"}};', 'window.APP_CONFIG.LASTFM_KEY = "oldkey1";',
  'window.APP_CONFIG.ROTEL_PROFILE = {speakerB: false};'].join('\n'));
fs.mkdirSync(path.join(T, 'music/USB/Stick'), {recursive: true});
process.env.XPLORIO_DATA = DATA;
process.env.XPLORIO_VOLUMIO_HTTP = OLD;
process.env.XPLORIO_MUSIC = path.join(T, 'music');
process.env.HTTP_PORT = '1234';                                     /* from Volumio's environment: must not reach the children */
function evalConfig() {
  var ctx = {window: {}};
  ['config.js', 'config.local.js'].forEach(function(f){ vm.runInNewContext(fs.readFileSync(path.join(P, 'app/web', f), 'utf8'), ctx); });
  return JSON.parse(JSON.stringify(ctx.window.APP_CONFIG));     /* objects of the other context: compare as plain data */
}

t('make-plugin: plugin files at the top, interface and services in app/, no own settings, ZIP for the plugin page', function(){
  ['package.json', 'index.js', 'install.sh', 'UIConfig.json', 'i18n/strings_de.json', 'app/xplorio.html', 'app/web/js/core.js',
   'app/web/build.js', 'app/web/version.json', 'app/server/xplorio-server.js', 'app/tags/tag-service.js', 'app/rotel/rotel-bridge.js']
    .forEach(function(f){ assert.ok(fs.existsSync(path.join(P, f)), f); });
  assert.ok(!fs.existsSync(path.join(P, 'app/web/config.local.js')) && !fs.existsSync(path.join(P, 'app/tests')));
  var pk = JSON.parse(fs.readFileSync(path.join(P, 'package.json'), 'utf8'));
  assert.strictEqual(pk.name, 'xplorio'); assert.strictEqual(pk.volumio_info.plugin_type, 'user_interface');
  var list = cp.execFileSync('python3', ['-c', 'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))',
                                         path.join(T, 'build/xplorio.zip')]).toString().split('\n');
  assert.ok(list.indexOf('package.json') >= 0 && list.indexOf('install.sh') >= 0 && list.indexOf('app/tags/tags.py') >= 0, list.slice(0, 5));
});

t('settings page: every text has a German and an English string', function(){
  var de = JSON.parse(fs.readFileSync(path.join(P, 'i18n/strings_de.json'), 'utf8')).XPLORIO;
  var en = JSON.parse(fs.readFileSync(path.join(P, 'i18n/strings_en.json'), 'utf8')).XPLORIO;
  var keys = (fs.readFileSync(path.join(P, 'UIConfig.json'), 'utf8').match(/XPLORIO\.[A-Z0-9_]+/g) || []).map(function(k){ return k.slice(8); });
  (fs.readFileSync(path.join(P, 'index.js'), 'utf8').match(/str\('[A-Z0-9_]+'\)/g) || []).forEach(function(m){ keys.push(m.slice(5, -2)); });
  ['THEME_AUTO', 'THEME_LIGHT', 'THEME_DARK', 'LANG_AUTO', 'TRI_AUTO', 'TRI_ON', 'TRI_OFF'].forEach(function(k){ keys.push(k); });
  keys.forEach(function(k){ assert.ok(de[k] && en[k], k); });
});

var Plugin = require(path.join(P, 'index.js'));
var toasts = [], spawned = [], active = {'rotel-bridge': true};
function makePlugin() {
  var p = new Plugin({coreCommand: {
      pluginManager: {getConfigurationFile: function(){ return path.join(T, 'conf/config.json'); }},
      pushToastMessage: function(k, ti, tx){ toasts.push([k, tx]); },
      sharedVars: {get: function(){ return 'de'; }},
      i18nJson: function(a, b, ui){ return kew.resolve(JSON.parse(fs.readFileSync(ui, 'utf8'))); }},
    logger: {info: function(){}, error: function(){}}});
  p.exec = function(cmd, args, cb){ setImmediate(function(){ cb(active[args[2]] ? null : new Error('inactive')); }); };
  p.spawn = function(bin, args, o){
    var e = new EventEmitter(); e.stdout = new EventEmitter(); e.stderr = new EventEmitter();
    e.kill = function(){ setImmediate(function(){ e.emit('exit', null, 'SIGTERM'); }); };
    e.send = function(m){ e.sent = (e.sent || []).concat([m]); };
    spawned.push({bin: bin, args: args, o: o, proc: e}); return e;
  };
  return p;
}
var PORT = 40000 + Math.floor(Math.random() * 20000), plug = makePlugin();
function get(p, cb) { http.get({port: PORT, path: p, agent: false}, function(r){ var d = ''; r.on('data', function(c){ d += c; }); r.on('end', function(){ cb(r, d); }); }); }
function el(ui, id) {
  var all = []; ui.sections.forEach(function(s){ all = all.concat(s.content || []); });
  return all.filter(function(c){ return c.id === id; })[0];
}
var kf = path.join(DATA, 'data/keys.json');

plug.onVolumioStart();
t('first start: settings of the earlier installation on the page, own file copied once, Last.fm key into keys.json', function(){
  var c = plug.config;
  assert.deepStrictEqual([c.get('port'), c.get('tagService'), c.get('rotelBridge'), c.get('tagsRoot')], [4040, true, true, false]);
  assert.deepStrictEqual([c.get('theme'), c.get('tidal'), c.get('qobuz'), c.get('history'), c.get('language')], ['dark', 'off', 'auto', true, '']);
  assert.strictEqual(c.get('rotelHost'), '192.168.1.50'); assert.strictEqual(c.get('rotelInputs'), 'aux=Plattenspieler/phono');
  assert.ok(/ROTEL_PROFILE/.test(fs.readFileSync(path.join(DATA, 'config.local.js'), 'utf8')));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt', LASTFM_KEY: 'oldkey1'});
  assert.strictEqual(c.get('imported'), true);
  c.set('theme', 'auto'); plug.takeOver();
  assert.strictEqual(c.get('theme'), 'auto');                     /* only once */
});
plug.config.set('port', PORT);
plug.onStart().then(function(){
  t('services: tag service as child process with more heap, IPC and the settings in app/web; Rotel bridge left to systemd', function(){
    assert.strictEqual(spawned.length, 1);
    var s = spawned[0];
    assert.strictEqual(s.bin, process.execPath);
    assert.deepStrictEqual(s.args, ['--max-old-space-size=384', path.join(P, 'app/tags/tag-service.js')]);
    assert.strictEqual(s.o.cwd, path.join(P, 'app/tags'));
    assert.strictEqual(s.o.env.APP_CONFIG_DIR, path.join(P, 'app/web')); assert.strictEqual(s.o.env.TAGS_DATA, path.join(DATA, 'data'));
    assert.strictEqual(s.o.env.XPLORIO_PLUGIN, '1'); assert.strictEqual(s.o.stdio[3], 'ipc');
    assert.ok(!('HTTP_PORT' in s.o.env) && !('USE_SUDO' in s.o.env));
    assert.deepStrictEqual(plug.notes, ['rotel-bridge']);
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
  t('System page: the tag service asks the plugin for the state and for a restart (IPC)', function(){
    var tag = spawned[0].proc;
    tag.emit('message', {type: 'status', id: 7});
    var st = tag.sent.pop();
    assert.strictEqual(st.id, 7);
    assert.deepStrictEqual(st.units['rotel-bridge'], {managed: false, running: false, since: null});
    assert.ok(st.units['tag-service'].managed && st.units['tag-service'].running && st.units['tag-service'].since > 0);
    tag.emit('message', {type: 'restart', unit: 'rotel-bridge', id: 8});
    assert.deepStrictEqual(tag.sent.pop(), {type: 'restart', ok: false, id: 8});
  });
  get('/', function(r, d){
    get('/web/config.local.js', function(r2, d2){
      t('web server inside the plugin: interface and settings on the plugin port', function(){
        assert.strictEqual(r.statusCode, 200); assert.ok(/<html/i.test(d));
        assert.ok(/192\.168\.1\.50/.test(d2), d2);
      });
      spawned[0].proc.emit('message', {type: 'restart', unit: 'tag-service', id: 9});
      setTimeout(function(){
      t('System page: restart of the tag service at once, without waiting', function(){
        assert.deepStrictEqual(spawned[0].proc.sent.pop(), {type: 'restart', ok: true, id: 9});
        assert.strictEqual(spawned.length, 2); assert.ok(plug.children.tagService.proc === spawned[1].proc);
      });
      spawned[1].proc.emit('exit', 1, null);
      t('a child process that ends is started again later', function(){
        assert.ok(plug.children.tagService.timer && plug.children.tagService.wait === 10000);
      });
      plug.getUIConfig().then(function(ui){
        t('settings page: link to the plugin port, current values, choices, notes', function(){
          assert.ok(new RegExp(':' + PORT + '/$').test(ui.sections[0].content[0].onClick.url));
          assert.ok(/rotel-bridge/.test(ui.sections[0].description) && /Systemdienst/.test(ui.sections[0].description), ui.sections[0].description);
          assert.deepStrictEqual(['port', 'tagService', 'rotelBridge', 'rotelHost', 'history'].map(function(id){ return el(ui, id).value; }),
                                 [PORT, true, true, '192.168.1.50', true]);
          assert.deepStrictEqual(el(ui, 'tidal').value, {value: 'off', label: 'Nie'});
          assert.deepStrictEqual(el(ui, 'language').options.map(function(o){ return o.label; }), ['Automatisch', 'Deutsch', 'English', 'Français', 'Español', 'Italiano']);
          assert.strictEqual(el(ui, 'rotelInputs').value, 'aux=Plattenspieler/phono');
          assert.ok(/Gespeichert/.test(el(ui, 'lastfmKey').doc) && /Noch nicht/.test(el(ui, 'lastfmSecret').doc) && el(ui, 'lastfmKey').value === '');
          assert.ok(JSON.stringify(ui).indexOf('oldkey1') < 0);
          assert.ok(/Noch kein Passwort/.test(el(ui, 'password').doc));
          assert.ok(/music\/USB\/Stick/.test(el(ui, 'tagsRoot').doc) === (process.getuid() !== 0) && /Freigabe dafür fehlt/.test(el(ui, 'tagsRoot').doc), el(ui, 'tagsRoot').doc);
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
          refused({password: 'abc', tagsRoot: false}, /4 Zeichen/);
          assert.ok(!fs.existsSync(path.join(DATA, 'data/admin.json')));
        });
        plug.saveSettings({password: 'geheim', tagsRoot: true}).then(function(){
          t('password for the System page set from the settings page; tags with root rights via the root-owned copy', function(){
            assert.ok(fs.existsSync(path.join(DATA, 'data/admin.json')));
            assert.strictEqual(toasts.pop()[0], 'success');
            var env = spawned[spawned.length - 1].o.env;
            assert.strictEqual(env.USE_SUDO, '1'); assert.strictEqual(env.TAGS_SCRIPT, '/usr/local/lib/xplorio/tags/tags.py');
            assert.ok(/^\/usr\/bin\/python3?$/.test(env.PYTHON));
          });
          spawned = [];
          plug.saveSettings({theme: {value: 'light', label: 'Immer hell'}, tidal: {value: 'on', label: 'Immer'}, history: false,
                             allowedHosts: ' player.example.net ,x.lan', releaseDates: true, moodTags: true, colorMood: true,
                             m4aProbe: true, m4aLossless: false, qobuz: {value: 'auto'}, hra: {value: 'off'}, spotify: {value: 'auto'}})
          .then(function(){ return plug.saveSettings({port: String(PORT), tagService: false, language: {value: 'en'}, theme: {value: 'light'}}); })
          .then(function(){ spawned = []; return plug.saveSettings({rotelBridge: true, rotelHost: '10.0.0.9', rotelInputs: 'aux = Plattenspieler / phono, OPT1=TV'}); })
          .then(function(){
          t('saving: values into config.local.js, tag service off, no new child process', function(){
            var c = evalConfig();
            assert.deepStrictEqual([c.THEME, c.TIDAL, c.HRA, c.HISTORY, c.M4A_LOSSLESS, c.LANGUAGE, c.ROTEL_HOST], ['light', true, false, false, false, 'en', '10.0.0.9']);
            assert.deepStrictEqual(c.ALLOWED_HOSTS, ['player.example.net', 'x.lan']);
            assert.deepStrictEqual(c.ROTEL_INPUTS, {aux: {name: 'Plattenspieler', icon: 'phono'}, opt1: {name: 'TV'}});
            assert.strictEqual(spawned.length, 0); assert.strictEqual(toasts.pop()[0], 'success');
          });
          plug.saveSettings({lastfmKey: ' abc123 ', lastfmSecret: '', lastfmClear: false});
          t('Last.fm: key into keys.json (only for the service), other entries stay; no restart', function(){
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt', LASTFM_KEY: 'abc123'});
            assert.strictEqual(fs.statSync(kf).mode & 511, 384);
            assert.deepStrictEqual(toasts.pop(), ['success', 'Last.fm-Zugang gespeichert.']);
            plug.saveKeys({LASTFM_KEY: '', LASTFM_SECRET: 'sec1'});
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt', LASTFM_KEY: 'abc123', LASTFM_SECRET: 'sec1'});
          });
          plug.getUIConfig().then(function(ui2){
          t('settings page shows "saved" for Last.fm and the password, never the values; delete removes both', function(){
            assert.ok(/Gespeichert/.test(el(ui2, 'lastfmKey').doc) && /Gespeichert/.test(el(ui2, 'lastfmSecret').doc));
            assert.ok(JSON.stringify(ui2).indexOf('abc123') < 0 && JSON.stringify(ui2).indexOf('geheim') < 0);
            assert.ok(/Passwort ist gesetzt/.test(el(ui2, 'password').doc));
            plug.saveSettings({lastfmKey: '', lastfmSecret: '', lastfmClear: true});
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(kf, 'utf8')), {OTHER: 'bleibt'});
          });
          get('/xplorio.html', function(r){
          t('saving restarts: web server answers again on the same port', function(){ assert.strictEqual(r.statusCode, 200); });
          plug.onStop().then(function(){
            http.get({port: PORT, path: '/', agent: false}, function(){ console.error('server still running'); process.exit(1); }).on('error', function(){
              t('stop: web server closed', function(){});
              console.log(n + ' checks passed'); process.exit(0);
            });
          });
          });
          });
          });
        });
      });
      }, 50);
    });
  });
}).fail(function(e){ console.error(e); process.exit(1); });
