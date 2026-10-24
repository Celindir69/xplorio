/* Volumio plugin (plugin/index.js, tools/make-plugin.sh): build, defaults, web server inside Volumio's process,
   child processes with the right settings, services left to systemd, restart, stop, settings page */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var http = require('http'), Module = require('module'), EventEmitter = require('events');
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
fs.mkdirSync(DATA);
process.env.XPLORIO_DATA = DATA;
process.env.HTTP_PORT = '1234';                                     /* from Volumio's environment: must not reach the children */

t('make-plugin: plugin files at the top, interface and services in app/, no own settings', function(){
  ['package.json', 'index.js', 'install.sh', 'UIConfig.json', 'i18n/strings_de.json', 'app/xplorio.html', 'app/web/js/core.js',
   'app/web/build.js', 'app/web/version.json', 'app/server/xplorio-server.js', 'app/tags/tag-service.js', 'app/rotel/rotel-bridge.js']
    .forEach(function(f){ assert.ok(fs.existsSync(path.join(P, f)), f); });
  assert.ok(!fs.existsSync(path.join(P, 'app/web/config.local.js')) && !fs.existsSync(path.join(P, 'app/tests')));
  var pk = JSON.parse(fs.readFileSync(path.join(P, 'package.json'), 'utf8'));
  assert.strictEqual(pk.name, 'xplorio'); assert.strictEqual(pk.volumio_info.plugin_type, 'user_interface');
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
    spawned.push({bin: bin, args: args, o: o, proc: e}); return e;
  };
  return p;
}
var PORT = 40000 + Math.floor(Math.random() * 20000), plug = makePlugin();
function get(p, cb) { http.get({port: PORT, path: p, agent: false}, function(r){ var d = ''; r.on('data', function(c){ d += c; }); r.on('end', function(){ cb(r, d); }); }); }

fs.writeFileSync(path.join(DATA, 'config.local.js'), 'window.APP_CONFIG.ROTEL_HOST = "192.168.1.50";');
plug.onVolumioStart();
t('defaults: port 4040, tag service on, Rotel bridge on when config.local.js has an amplifier', function(){
  assert.deepStrictEqual([plug.config.get('port'), plug.config.get('tagService'), plug.config.get('rotelBridge')], [4040, true, true]);
});
plug.config.set('port', PORT);
plug.onStart().then(function(){
  t('services: tag service as child process with more heap and the settings in app/web; Rotel bridge left to systemd', function(){
    assert.strictEqual(spawned.length, 1);
    var s = spawned[0];
    assert.strictEqual(s.bin, process.execPath);
    assert.deepStrictEqual(s.args, ['--max-old-space-size=384', path.join(P, 'app/tags/tag-service.js')]);
    assert.strictEqual(s.o.cwd, path.join(P, 'app/tags'));
    assert.strictEqual(s.o.env.APP_CONFIG_DIR, path.join(P, 'app/web')); assert.strictEqual(s.o.env.TAGS_DATA, path.join(DATA, 'data'));
    assert.ok(!('HTTP_PORT' in s.o.env));
    assert.deepStrictEqual(plug.notes, ['rotel-bridge']);
  });
  t('config.local.js: one file in /data/xplorio for the interface and the services (link in app/web)', function(){
    assert.strictEqual(fs.readlinkSync(path.join(P, 'app/web/config.local.js')), path.join(DATA, 'config.local.js'));
  });
  get('/', function(r, d){
    get('/web/config.local.js', function(r2, d2){
      t('web server inside the plugin: interface and own settings on the plugin port', function(){
        assert.strictEqual(r.statusCode, 200); assert.ok(/<html/i.test(d));
        assert.ok(/192\.168\.1\.50/.test(d2), d2);
      });
      spawned[0].proc.emit('exit', 1, null);
      t('a child process that ends is started again later', function(){
        assert.ok(plug.children.tagService.timer && plug.children.tagService.wait === 10000);
      });
      plug.getUIConfig().then(function(ui){
        t('settings page: link to the plugin port, current values, note on services left to systemd', function(){
          assert.ok(new RegExp(':' + PORT + '/$').test(ui.sections[0].content[0].onClick.url));
          assert.ok(/rotel-bridge/.test(ui.sections[0].description) && /Systemdienst/.test(ui.sections[0].description), ui.sections[0].description);
          assert.deepStrictEqual(ui.sections[1].content.map(function(c){ return c.value; }), [PORT, true, true]);
        });
        plug.saveSettings({port: 3000, tagService: true, rotelBridge: true});
        t('saving: Volumio\'s own port is refused', function(){ assert.strictEqual(toasts.pop()[0], 'error'); assert.strictEqual(plug.config.get('port'), PORT); });
        spawned = [];
        plug.saveSettings({port: String(PORT), tagService: false, rotelBridge: true}).then(function(){
          t('saving restarts: tag service off, no new child process', function(){
            assert.strictEqual(spawned.length, 0); assert.strictEqual(toasts.pop()[0], 'success');
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
}).fail(function(e){ console.error(e); process.exit(1); });
