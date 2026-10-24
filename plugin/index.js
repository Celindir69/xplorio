'use strict';
/* Volumio plugin Xplorio: serves the interface on its own port (app/server/xplorio-server.js, inside Volumio's own
   Node process) and starts the tag service and the Rotel bridge as child processes. Nothing below /volumio changes,
   so Volumio's integrity check before a system update stays intact. Data and own settings live in /data/xplorio
   (stay when the plugin is updated or removed). A service that already runs as a systemd unit (earlier installation
   with xplorio-deploy) is left as it is. Everything is set on the plugin's settings page, no console needed: the plugin
   writes app/web/config.local.js from it (plus the optional own additions in /data/xplorio/config.local.js).
   Node 8, ES5 only. */
var libQ = require('kew');
var fs   = require('fs');
var os   = require('os');
var path = require('path');
var cp   = require('child_process');
var vm   = require('vm');

module.exports = ControllerXplorio;

var APP    = path.join(__dirname, 'app');            /* the interface and the services (tools/make-plugin.sh) */
var DATA   = process.env.XPLORIO_DATA || '/data/xplorio';
var OLD_HTTP = process.env.XPLORIO_VOLUMIO_HTTP || '/volumio/http';   /* earlier installation below /volumio (read only) */
var ROOT_TAGS = '/usr/local/lib/xplorio/tags/tags.py';             /* root-owned copy for the sudo rule (install.sh) */
var MUSIC = process.env.XPLORIO_MUSIC || '/mnt';
var CHILDREN = [
  {id: 'tagService',  unit: 'tag-service',  script: 'tags/tag-service.js',   node: ['--max-old-space-size=384'], ipc: true},
  {id: 'rotelBridge', unit: 'rotel-bridge', script: 'rotel/rotel-bridge.js', node: []}
];
/* settings on the page that go into config.local.js: id on the page, key in APP_CONFIG, kind (see toApp / fromApp) */
var FIELDS = [
  {id: 'language',     key: 'LANGUAGE',      kind: 'select', options: ['', 'de', 'en', 'fr', 'es', 'it']},
  {id: 'theme',        key: 'THEME',         kind: 'select', options: ['auto', 'light', 'dark']},
  {id: 'history',      key: 'HISTORY',       kind: 'bool'},
  {id: 'releaseDates', key: 'RELEASEDATES',  kind: 'bool'},
  {id: 'moodTags',     key: 'MOODTAGS',      kind: 'bool'},
  {id: 'colorMood',    key: 'COLOR_MOOD',    kind: 'bool'},
  {id: 'm4aProbe',     key: 'M4A_PROBE',     kind: 'bool'},
  {id: 'm4aLossless',  key: 'M4A_LOSSLESS',  kind: 'bool'},
  {id: 'tidal',        key: 'TIDAL',         kind: 'tri'},
  {id: 'qobuz',        key: 'QOBUZ',         kind: 'tri'},
  {id: 'hra',          key: 'HRA',           kind: 'tri'},
  {id: 'spotify',      key: 'SPOTIFY',       kind: 'tri'},
  {id: 'allowedHosts', key: 'ALLOWED_HOSTS', kind: 'hosts'},
  {id: 'rotelHost',    key: 'ROTEL_HOST',    kind: 'host'},
  {id: 'rotelInputs',  key: 'ROTEL_INPUTS',  kind: 'inputs'}
];
var LANG_NAMES = {de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano'};
var ICONS = ['phono', 'cd', 'tuner', 'bluetooth', 'usb', 'digital', 'aux', 'pc', 'tv'];
var RESTART_MIN = 5000, RESTART_MAX = 60000;          /* a child that ends is started again, waiting longer each time */

function ControllerXplorio(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.server = null;
  this.children = {};
  this.stopping = false;
  this.notes = [];                                    /* shown on the settings page (services left to systemd) */
  this.exec = cp.execFile; this.spawn = cp.spawn;     /* replaced in the tests */
}

ControllerXplorio.prototype.onVolumioStart = function() {
  var file = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  try { fs.mkdirSync(path.dirname(file)); } catch (e) { /* exists */ }
  this.config = new (require('v-conf'))();
  this.config.loadFile(file);
  if (this.config.get('port') === undefined) this.config.set('port', 4040);
  if (this.config.get('tagService') === undefined) this.config.set('tagService', true);
  if (this.config.get('tagsRoot') === undefined) this.config.set('tagsRoot', false);
  this.takeOver();
  return libQ.resolve();
};

/* settings for the page: defaults from app/web/config.js. On the first start also the own settings of an earlier
   installation: /volumio/http/www…/web/config.local.js is copied once to /data/xplorio/config.local.js (the original
   stays untouched), its known values come onto the page, a Last.fm key into keys.json */
ControllerXplorio.prototype.takeOver = function() {
  var self = this, first = !self.config.get('imported'), own = path.join(DATA, 'config.local.js');
  if (first && !exists(own)) {
    var old = ['www4', 'www3', 'www'].map(function(w){ return path.join(OLD_HTTP, w, 'web', 'config.local.js'); }).filter(exists)[0];
    if (old) {
      try { mkdirs(DATA); fs.writeFileSync(own, fs.readFileSync(old)); self.logger.info('Xplorio: settings taken over from ' + old); }
      catch (e) { self.logger.error('Xplorio: taking over ' + old + ': ' + e.message); }
    }
  }
  var cfg = appConfig([path.join(APP, 'web', 'config.js')].concat(first ? [own] : []));
  FIELDS.forEach(function(f){ if (first || self.config.get(f.id) === undefined) self.config.set(f.id, fromApp(f, cfg[f.key])); });
  if (first || self.config.get('rotelBridge') === undefined) self.config.set('rotelBridge', !!cfg.ROTEL_HOST);
  if (!first) return;
  var key = String(cfg.LASTFM_KEY || ''), secret = String(cfg.LASTFM_SECRET || '');
  try {
    if (/^[A-Za-z0-9]{1,64}$/.test(key) && !self.keys().read().LASTFM_KEY)
      self.saveKeys({LASTFM_KEY: key, LASTFM_SECRET: /^[A-Za-z0-9]{1,64}$/.test(secret) ? secret : ''});
  } catch (e) { self.logger.error('Xplorio: Last.fm access: ' + e.message); }
  self.config.set('imported', true);
};

ControllerXplorio.prototype.getConfigurationFiles = function() { return ['config.json']; };

ControllerXplorio.prototype.onStart = function() {
  var self = this, defer = libQ.defer();
  self.stopping = false; self.notes = [];
  self.writeConfig();
  var port = self.port();
  self.unitActive('xplorio-server', function(active){
    if (active) { self.note('xplorio-server'); } else { self.startServer(port); }
    var todo = CHILDREN.filter(function(c){ return self.config.get(c.id); });
    (function next() {
      var c = todo.shift();
      if (!c) return defer.resolve();
      self.unitActive(c.unit, function(on){ if (on) self.note(c.unit); else self.startChild(c); next(); });
    })();
  });
  return defer.promise;
};

ControllerXplorio.prototype.onStop = function() {
  var self = this, defer = libQ.defer(), left = 0;
  self.stopping = true;
  if (self.server) { self.server.close(); self.server.dropAll(); self.server = null; }
  Object.keys(self.children).forEach(function(id){
    var ch = self.children[id];
    clearTimeout(ch.timer);
    if (!ch.proc) return;
    left++;
    ch.proc.once('exit', function(){ if (--left === 0) defer.resolve(); });
    ch.proc.kill('SIGTERM');
  });
  self.children = {};
  if (!left) defer.resolve();
  else setTimeout(function(){ defer.resolve(); }, 8000);      /* do not hold up Volumio for long */
  return defer.promise;
};

ControllerXplorio.prototype.port = function() {
  var p = parseInt(this.config.get('port'), 10);
  return p >= 1024 && p <= 65535 && p !== 3000 ? p : 4040;
};

/* is a systemd unit of an earlier installation running? (then it keeps the job) */
ControllerXplorio.prototype.unitActive = function(unit, cb) {
  this.exec('systemctl', ['is-active', '--quiet', unit], function(err){ cb(!err); });
};
ControllerXplorio.prototype.note = function(unit) {
  this.notes.push(unit);
  this.logger.info('Xplorio: ' + unit + ' runs as a systemd service, left as it is');
};

ControllerXplorio.prototype.startServer = function(port) {
  var self = this;
  var srv = require(path.join(APP, 'server', 'xplorio-server.js')).create({www: APP, port: port});
  var tries = 0, socks = [];
  srv.on('connection', function(sock){                /* closed on stop: browsers keep connections open */
    socks.push(sock);
    sock.on('close', function(){ socks.splice(socks.indexOf(sock), 1); });
  });
  srv.dropAll = function(){ socks.slice().forEach(function(x){ x.destroy(); }); };
  srv.on('error', function(e){
    /* right after a restart (saving the settings) the old server may still hold the port for a moment */
    if (e.code === 'EADDRINUSE' && ++tries <= 5 && !self.stopping) return setTimeout(function(){ srv.listen(port); }, 1000);
    self.logger.error('Xplorio: web server on port ' + port + ': ' + e.message);
    if (e.code === 'EADDRINUSE') self.toast('error', self.str('PORT_BUSY').replace('{port}', port));
  });
  srv.on('listening', function(){ self.logger.info('Xplorio: interface on port ' + port); });
  srv.listen(port);
  self.server = srv;
};

ControllerXplorio.prototype.startChild = function(c) {
  var self = this, ch = self.children[c.id] || (self.children[c.id] = {wait: RESTART_MIN, proc: null, timer: null});
  var env = {};
  Object.keys(process.env).forEach(function(k){ if (k !== 'HTTP_PORT') env[k] = process.env[k]; });
  env.APP_CONFIG_DIR = path.join(APP, 'web');       /* config.js and config.local.js (written by the plugin) */
  env.TAGS_DATA = path.join(DATA, 'data');
  env.XPLORIO_PLUGIN = '1';                          /* the System page restarts the services via the plugin */
  if (c.id === 'tagService' && self.config.get('tagsRoot')) {
    env.USE_SUDO = '1'; env.PYTHON = python(); env.TAGS_SCRIPT = ROOT_TAGS;
  }
  var started = Date.now();
  var proc = self.spawn(process.execPath, c.node.concat([path.join(APP, c.script)]),
                        {cwd: path.join(APP, path.dirname(c.script)), env: env,
                         stdio: c.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe']});
  ch.proc = proc; ch.since = started; ch.now = false;
  function log(level) {
    return function(d){ String(d).split('\n').forEach(function(l){ if (l.trim()) self.logger[level]('Xplorio ' + c.unit + ': ' + l); }); };
  }
  if (proc.stdout) proc.stdout.on('data', log('info'));
  if (proc.stderr) proc.stderr.on('data', log('error'));
  proc.on('error', function(e){ self.logger.error('Xplorio ' + c.unit + ': ' + e.message); });
  proc.on('message', function(m){ self.answer(proc, m); });
  proc.on('exit', function(code, sig){
    if (ch.proc !== proc) return;
    ch.proc = null;
    if (self.stopping) return;
    if (ch.now) { ch.wait = RESTART_MIN; return self.startChild(c); }      /* restart from the System page */
    if (Date.now() - started > RESTART_MAX) ch.wait = RESTART_MIN;          /* ran for a while: start again soon */
    self.logger.error('Xplorio ' + c.unit + ' ended (' + (sig || code) + '), new start in ' + ch.wait / 1000 + ' s');
    ch.timer = setTimeout(function(){ if (!self.stopping) self.startChild(c); }, ch.wait);
    ch.wait = Math.min(RESTART_MAX, ch.wait * 2);
  });
};

/* questions of the tag service (System page): state of the services the plugin starts, restart of one of them */
ControllerXplorio.prototype.answer = function(proc, m) {
  var self = this;
  if (!m || typeof m !== 'object') return;
  function reply(o) { o.id = m.id; try { proc.send(o); } catch (e) { /* ended meanwhile */ } }
  if (m.type === 'status') {
    var units = {};
    CHILDREN.forEach(function(c){
      var ch = self.children[c.id];
      units[c.unit] = {managed: !!ch, running: !!(ch && ch.proc), since: ch && ch.proc ? ch.since : null};
    });
    return reply({type: 'status', units: units});
  }
  if (m.type === 'restart') {
    var c = CHILDREN.filter(function(x){ return x.unit === m.unit; })[0];
    if (!c || !self.children[c.id]) return reply({type: 'restart', ok: false});
    reply({type: 'restart', ok: true});
    self.restartChild(c);
  }
};
ControllerXplorio.prototype.restartChild = function(c) {
  var ch = this.children[c.id];
  if (!ch) return;
  this.logger.info('Xplorio: ' + c.unit + ' restart (System page)');
  if (ch.proc) { ch.now = true; ch.proc.kill('SIGTERM'); return; }
  clearTimeout(ch.timer); ch.wait = RESTART_MIN; this.startChild(c);
};

/* app/web/config.local.js for the interface and the services: own additions from /data/xplorio/config.local.js
   (kept as they are, a broken file is left out), then the values from the settings page */
ControllerXplorio.prototype.writeConfig = function() {
  var self = this, own = read(path.join(DATA, 'config.local.js')), lines = [];
  lines.push('/* Written by the Xplorio plugin from its settings page in Volumio; changes here are lost.',
             '   Own additions: /data/xplorio/config.local.js on the player. */');
  self.ownBroken = false;
  if (own.trim()) {
    var block = 'try {\n' + own + '\n} catch (e) { /* own additions failed: the settings below still apply */ }';
    try { new vm.Script(block, {filename: 'config.local.js'}); lines.push(block); }
    catch (e) { self.ownBroken = true; self.logger.error('Xplorio: /data/xplorio/config.local.js left out: ' + e.message); }
  }
  FIELDS.forEach(function(f){ lines.push('window.APP_CONFIG.' + f.key + ' = ' + JSON.stringify(toApp(f, self.config.get(f.id))) + ';'); });
  lines.push('window.APP_CONFIG.ROTEL = ' + !!self.config.get('rotelBridge') + ';');
  var file = path.join(APP, 'web', 'config.local.js'), text = lines.join('\n') + '\n';
  if (read(file) === text) return;
  try {
    try { if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file); } catch (e) { /* not there */ }   /* link of earlier versions */
    fs.writeFileSync(file + '.neu', text); fs.renameSync(file + '.neu', file);
  } catch (e) { self.logger.error('Xplorio: writing ' + file + ': ' + e.message); }
};

/* ---------- settings page ---------- */
ControllerXplorio.prototype.str = function(key) {
  if (!this.strings) {
    var lang = (this.commandRouter.sharedVars && this.commandRouter.sharedVars.get('language_code')) || 'en';
    this.strings = json(path.join(__dirname, 'i18n', 'strings_' + lang + '.json')) || {};
    this.stringsEn = json(path.join(__dirname, 'i18n', 'strings_en.json')) || {};
  }
  var s = (this.strings.XPLORIO || {})[key] || (this.stringsEn.XPLORIO || {})[key];
  return s || key;
};
ControllerXplorio.prototype.toast = function(kind, text) { this.commandRouter.pushToastMessage(kind, 'Xplorio', text); };
ControllerXplorio.prototype.url = function() { return 'http://' + address() + ':' + this.port() + '/'; };

ControllerXplorio.prototype.getUIConfig = function() {
  var self = this, defer = libQ.defer();
  var lang = (self.commandRouter.sharedVars && self.commandRouter.sharedVars.get('language_code')) || 'en';
  self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'), path.join(__dirname, 'i18n', 'strings_en.json'),
                              path.join(__dirname, 'UIConfig.json')).then(function(ui){
    var url = self.url(), open = ui.sections[0];
    open.description = [self.str('OPEN_DOC').replace('{url}', url)].concat(self.notes.map(function(u){
      return self.str('SYSTEMD').replace('{name}', u);
    }), self.ownBroken ? [self.str('OWN_BROKEN')] : []).join(' ');
    open.content[0].onClick.url = url;
    function el(id) {
      for (var i = 0; i < ui.sections.length; i++)
        for (var j = 0; j < (ui.sections[i].content || []).length; j++) if (ui.sections[i].content[j].id === id) return ui.sections[i].content[j];
      return {};
    }
    el('port').value = self.port();
    ['tagService', 'rotelBridge', 'tagsRoot'].forEach(function(id){ el(id).value = !!self.config.get(id); });
    FIELDS.forEach(function(f){
      var e = el(f.id), v = self.config.get(f.id);
      if (f.kind === 'bool') { e.value = !!v; return; }
      if (f.kind === 'select' || f.kind === 'tri') {
        e.options = (f.options || ['auto', 'on', 'off']).map(function(o){
          return {value: o, label: f.id === 'language' && o ? LANG_NAMES[o] : self.str((f.id === 'theme' ? 'THEME_' : f.id === 'language' ? 'LANG_' : 'TRI_') + (o || 'auto').toUpperCase())};
        });
        e.value = e.options.filter(function(o){ return o.value === v; })[0] || e.options[0];
        return;
      }
      e.value = v || '';
    });
    var k = self.keys().read();                         /* only whether it is set, never the value */
    el('lastfmKey').doc = self.str('LASTFM_KEY_DOC') + ' ' + self.str(k.LASTFM_KEY ? 'LASTFM_SAVED' : 'LASTFM_NONE');
    el('lastfmSecret').doc = self.str('LASTFM_SECRET_DOC') + ' ' + self.str(k.LASTFM_SECRET ? 'LASTFM_SAVED' : 'LASTFM_NONE');
    el('password').doc = self.str('PASSWORD_DOC') + ' ' + self.str(self.auth().isSet() ? 'PASSWORD_SET' : 'PASSWORD_NONE');
    self.rootCheck(function(ro, sudo){
      el('tagsRoot').doc = [self.str('TAGS_ROOT_DOC'),
        ro.length ? self.str('TAGS_RO').replace('{dirs}', ro.join(', ')) : self.str('TAGS_RW'),
        sudo ? '' : self.str('TAGS_NOSUDO')].filter(Boolean).join(' ');
      defer.resolve(ui);
    });
  }).fail(function(e){ defer.reject(e); });
  return defer.promise;
};

/* music folders the plugin (user volumio) cannot write to, and whether the sudo rule of install.sh is there */
ControllerXplorio.prototype.rootCheck = function(cb) {
  var ro = [];
  ['INTERNAL'].concat(['USB', 'NAS'].reduce(function(a, d){
    try { return a.concat(fs.readdirSync(path.join(MUSIC, d)).map(function(x){ return d + '/' + x; })); } catch (e) { return a; }
  }, [])).forEach(function(d){
    var full = path.join(MUSIC, d);
    try { if (!fs.statSync(full).isDirectory()) return; } catch (e) { return; }
    try { fs.accessSync(full, fs.W_OK); } catch (e) { ro.push(full); }
  });
  this.exec('sudo', ['-n', '-l', python(), ROOT_TAGS], function(err){ cb(ro, !err); });
};

/* one method for all sections: each sends only its own fields */
ControllerXplorio.prototype.saveSettings = function(data) {
  var self = this, set = {}, err = null;
  data = data || {};
  function has(id) { return Object.prototype.hasOwnProperty.call(data, id); }
  function val(id) { var v = data[id]; return v && typeof v === 'object' ? v.value : v; }
  if (has('port')) {
    var p = parseInt(data.port, 10);
    if (!(p >= 1024 && p <= 65535) || p === 3000) err = 'BAD_PORT'; else set.port = p;
  }
  ['tagService', 'rotelBridge', 'tagsRoot'].forEach(function(id){ if (has(id)) set[id] = !!data[id]; });
  FIELDS.forEach(function(f){
    if (!has(f.id) || err) return;
    var v = check(f, val(f.id));
    if (v === undefined) err = 'BAD_' + f.kind.toUpperCase(); else set[f.id] = v;
  });
  if (!err && set.rotelBridge && !(has('rotelHost') ? set.rotelHost : self.config.get('rotelHost'))) err = 'ROTEL_NO_HOST';
  var key = String(data.lastfmKey || '').trim(), secret = String(data.lastfmSecret || '').trim();
  if (!err && (!/^[A-Za-z0-9]{0,64}$/.test(key) || !/^[A-Za-z0-9]{0,64}$/.test(secret))) err = 'LASTFM_BAD';
  var pw = String(data.password || '');
  if (!err && pw && pw.length < 4) err = 'PASSWORD_SHORT';
  if (err) { self.toast('error', self.str(err)); return libQ.resolve({}); }
  if (data.lastfmClear || key || secret) {
    try { self.saveKeys(data.lastfmClear ? null : {LASTFM_KEY: key, LASTFM_SECRET: secret}); }
    catch (e) { self.toast('error', self.str('LASTFM_FAIL').replace('{error}', e.message)); return libQ.resolve({}); }
  }
  if (pw) {
    try { self.auth().setPassword(pw); self.logger.info('Xplorio: password for the System page set'); }
    catch (e) { self.toast('error', self.str('PASSWORD_FAIL').replace('{error}', e.message)); return libQ.resolve({}); }
  }
  Object.keys(set).forEach(function(k){ self.config.set(k, set[k]); });
  if (!Object.keys(set).length) { self.toast('success', self.str(pw ? 'PASSWORD_SAVED' : 'LASTFM_STORED')); return libQ.resolve({}); }
  return self.onStop().then(function(){ return self.onStart(); }).then(function(){ self.toast('success', self.str('SAVED')); return {}; });
};

/* password for the System page (tags/adminpass.js, data folder of the tag service) */
ControllerXplorio.prototype.auth = function() {
  var adminpass = require(path.join(APP, 'tags', 'adminpass.js'));
  return new adminpass.Auth(path.join(DATA, 'data'));
};

/* Last.fm access in /data/xplorio/data/keys.json (the tag service rereads it when it changes); other entries stay */
ControllerXplorio.prototype.keys = function() {
  var appdata = require(path.join(APP, 'tags', 'appdata.js'));
  return new appdata.Keys(path.join(DATA, 'data'), function(){ return {}; });
};
/* vals: {LASTFM_KEY, LASTFM_SECRET} (empty = keep), null = delete both */
ControllerXplorio.prototype.saveKeys = function(vals) {
  var keys = this.keys(), k = {}, cur = keys.read();
  Object.keys(cur).forEach(function(n){ k[n] = cur[n]; });
  if (!vals) { delete k.LASTFM_KEY; delete k.LASTFM_SECRET; }
  else Object.keys(vals).forEach(function(n){ if (vals[n]) k[n] = vals[n]; });
  keys.write(k);
  this.logger.info('Xplorio: Last.fm access ' + (vals ? 'saved' : 'deleted'));
};

/* ---------- helpers ---------- */
function read(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }
function json(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function exists(f) { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }
function mkdirs(d) { if (!fs.existsSync(d)) { mkdirs(path.dirname(d)); fs.mkdirSync(d); } }

/* APP_CONFIG after running the given files in order (as the browser does), broken or missing files are skipped */
function appConfig(files) {
  var ctx = {window: {}};
  files.forEach(function(f){
    try { vm.runInNewContext(fs.readFileSync(f, 'utf8'), ctx, {filename: path.basename(f), timeout: 1000}); } catch (e) { /* skip */ }
  });
  return ctx.window.APP_CONFIG || {};
}

/* APP_CONFIG value -> value on the page */
function fromApp(f, v) {
  if (f.kind === 'bool') return v !== false;
  if (f.kind === 'select') return f.options.indexOf(v) >= 0 ? v : f.options[0];
  if (f.kind === 'tri') return v === true ? 'on' : v === false ? 'off' : 'auto';
  if (f.kind === 'hosts') return Array.isArray(v) ? v.filter(function(h){ return typeof h === 'string'; }).join(', ') : '';
  if (f.kind === 'inputs') {
    return v && typeof v === 'object' ? Object.keys(v).filter(function(c){ return v[c] && (v[c].name || v[c].icon); }).map(function(c){
      return c + '=' + (v[c].name || c) + (v[c].icon ? '/' + v[c].icon : '');
    }).join(', ') : '';
  }
  return typeof v === 'string' ? v : '';
}
/* value on the page -> APP_CONFIG value */
function toApp(f, v) {
  if (f.kind === 'bool') return v !== false;
  if (f.kind === 'tri') return v === 'on' ? true : v === 'off' ? false : 'auto';
  if (f.kind === 'hosts') return splitList(v);
  if (f.kind === 'inputs') {
    var o = {};
    splitList(v).forEach(function(x){
      var m = /^([A-Za-z0-9_]+)\s*=\s*([^\/]*?)\s*(?:\/\s*([a-z]+))?$/.exec(x);
      if (!m) return;
      o[m[1].toLowerCase()] = m[3] ? {name: m[2] || m[1], icon: m[3]} : {name: m[2] || m[1]};
    });
    return o;
  }
  return v === undefined || v === null ? '' : v;
}
/* input from the page -> stored value, undefined = not valid */
function check(f, v) {
  if (f.kind === 'bool') return !!v;
  if (f.kind === 'select') return f.options.indexOf(v) >= 0 ? v : undefined;
  if (f.kind === 'tri') return ['auto', 'on', 'off'].indexOf(v) >= 0 ? v : undefined;
  v = String(v === undefined || v === null ? '' : v).trim();
  if (v.length > 500) return undefined;
  if (f.kind === 'host') return /^[A-Za-z0-9.:\-]*$/.test(v) ? v : undefined;
  if (f.kind === 'hosts') return splitList(v).every(function(h){ return /^[A-Za-z0-9.\-]+$/.test(h); }) ? splitList(v).join(', ') : undefined;
  if (f.kind === 'inputs') {
    return splitList(v).every(function(x){
      var m = /^([A-Za-z0-9_]+)\s*=\s*([^\/<>"]*?)\s*(?:\/\s*([a-z]+))?$/.exec(x);
      return m && (!m[3] || ICONS.indexOf(m[3]) >= 0);
    }) ? splitList(v).join(', ') : undefined;
  }
  return v;
}
function splitList(v) { return String(v || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean); }

/* Python for tags.py with root rights: the same choice as the tag service, as a full path (sudo rule) */
function python() { return exists('/usr/bin/python') ? '/usr/bin/python' : '/usr/bin/python3'; }

/* the player's address for the link on the settings page */
function address() {
  var nets = os.networkInterfaces(), found = '';
  Object.keys(nets).forEach(function(n){
    (nets[n] || []).forEach(function(a){ if (!found && (a.family === 'IPv4' || a.family === 4) && !a.internal) found = a.address; });
  });
  return found || os.hostname() + '.local';
}

ControllerXplorio.CHILDREN = CHILDREN;
ControllerXplorio.FIELDS = FIELDS;
