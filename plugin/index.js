'use strict';
/* Volumio plugin Xplorio: web server (port 4040), tag service and Rotel bridge run as systemd services of their own
   (xplorio-web, xplorio-tags, xplorio-rotel; install.sh sets them up), started in onStart and stopped in onStop as
   Volumio asks of plugins. Nothing below /volumio changes, so Volumio's integrity check before a system update stays
   intact. Data and own settings live in /data/xplorio (stay when the plugin is updated or removed). Everything is set on the plugin's
   settings page, no console needed: the plugin writes app/web/config.local.js from it (plus the optional own
   additions in /data/xplorio/config.local.js) and the settings of the services to /tmp/xplorio/<service>.env.
   Node 8, ES5 only (runs on Volumio 2 to 4). */
var libQ = require('kew');
var fs   = require('fs');
var os   = require('os');
var path = require('path');
var cp   = require('child_process');
var net  = require('net');
var vm   = require('vm');

module.exports = ControllerXplorio;

var APP    = path.join(__dirname, 'app');            /* the interface and the services (tools/make-plugin.sh) */
var DATA   = process.env.XPLORIO_DATA || '/data/xplorio';
var RUN  = process.env.XPLORIO_RUN || '/tmp/xplorio';             /* settings of the services (EnvironmentFile) */
var MUSIC = process.env.XPLORIO_MUSIC || '/mnt';
/* the services: systemd unit, switch on the page (the web server always runs) */
var SERVICES = [
  {unit: 'xplorio-web',   id: null},
  {unit: 'xplorio-tags',  id: 'tagService'},
  {unit: 'xplorio-rotel', id: 'rotelBridge'}
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

function ControllerXplorio(context) {
  this.context = context;
  this.commandRouter = context.coreCommand;
  this.logger = context.logger;
  this.exec = cp.execFile;                            /* replaced in the tests */
}

ControllerXplorio.prototype.onVolumioStart = function() {
  var file = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
  try { fs.mkdirSync(path.dirname(file)); } catch (e) { /* exists */ }
  this.config = new (require('v-conf'))();
  this.config.loadFile(file);
  if (this.config.get('port') === undefined) this.config.set('port', 4040);
  if (this.config.get('tagService') === undefined) this.config.set('tagService', true);
  this.defaults();
  return libQ.resolve();
};

/* settings for the page: defaults from app/web/config.js for everything not set yet */
ControllerXplorio.prototype.defaults = function() {
  var self = this, cfg = appConfig([path.join(APP, 'web', 'config.js')]);
  FIELDS.forEach(function(f){ if (self.config.get(f.id) === undefined) self.config.set(f.id, fromApp(f, cfg[f.key])); });
  if (self.config.get('rotelBridge') === undefined) self.config.set('rotelBridge', false);
};

ControllerXplorio.prototype.getConfigurationFiles = function() { return ['config.json']; };

ControllerXplorio.prototype.onStart = function() {
  var self = this, defer = libQ.defer(), port = self.port();
  self.writeConfig();
  self.writeEnv();
  var todo = SERVICES.filter(function(s){ return !s.id || self.config.get(s.id); }), failed = null;
  (function next() {
    var s = todo.shift();
    if (!s) return failed ? defer.reject(new Error(failed)) : defer.resolve();
    var go = function(){
      self.systemctl('restart', s.unit, function(err){
        if (err) {
          self.logger.error('Xplorio: ' + s.unit + ' did not start: ' + (err.message || err));
          if (!s.id) failed = s.unit + ' did not start';             /* without the web server the plugin is not running */
        }
        next();
      });
    };
    if (s.id) return go();
    portFree(port, function(free){                                  /* web server: is the port taken by something else? */
      if (free) return go();
      self.toast('error', self.str('PORT_BUSY').replace('{port}', port));
      failed = 'port ' + port + ' in use'; next();
    });
  })();
  return defer.promise;
};

/* all services of the plugin off (also those switched off on the page) */
ControllerXplorio.prototype.onStop = function() {
  var self = this, defer = libQ.defer(), left = SERVICES.length;
  SERVICES.forEach(function(s){ self.systemctl('stop', s.unit, function(){ if (--left === 0) defer.resolve(); }); });
  return defer.promise;
};

ControllerXplorio.prototype.port = function() {
  var p = parseInt(this.config.get('port'), 10);
  return p >= 1024 && p <= 65535 && p !== 3000 ? p : 4040;
};

/* as in Volumio's examples: systemctl via sudo (-n: never wait for a password) */
ControllerXplorio.prototype.systemctl = function(action, unit, cb) {
  this.exec('/usr/bin/sudo', ['-n', '/bin/systemctl', action, unit + '.service'], function(err){ cb(err || null); });
};

/* /tmp/xplorio/<service>.env: what the systemd units read (EnvironmentFile) */
ControllerXplorio.prototype.writeEnv = function() {
  var web = path.join(APP, 'web'), envs = {
    'xplorio-web':   {HTTP_PORT: this.port(), XPLORIO_WWW: APP},
    'xplorio-tags':  {APP_CONFIG_DIR: web, TAGS_DATA: path.join(DATA, 'data')},
    'xplorio-rotel': {APP_CONFIG_DIR: web}
  };
  try {
    mkdirs(RUN);
    Object.keys(envs).forEach(function(u){
      fs.writeFileSync(path.join(RUN, u + '.env'), Object.keys(envs[u]).map(function(k){ return k + '=' + envs[u][k]; }).join('\n') + '\n');
    });
  } catch (e) { this.logger.error('Xplorio: writing ' + RUN + ': ' + e.message); }
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
    open.description = [self.str('OPEN_DOC').replace('{url}', url)].concat(self.ownBroken ? [self.str('OWN_BROKEN')] : []).join(' ');
    open.content[0].onClick.url = url;
    function el(id) {
      for (var i = 0; i < ui.sections.length; i++)
        for (var j = 0; j < (ui.sections[i].content || []).length; j++) if (ui.sections[i].content[j].id === id) return ui.sections[i].content[j];
      return {};
    }
    el('port').value = self.port();
    ['tagService', 'rotelBridge'].forEach(function(id){ el(id).value = !!self.config.get(id); });
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
    var pwSet = self.auth().isSet();
    el('password').doc = self.str('PASSWORD_DOC') + ' ' + self.str(pwSet ? 'PASSWORD_SET' : 'PASSWORD_NONE');
    /* the status in the label as well: Volumio 2 does not show a field's doc text */
    el('lastfmKey').label = self.str('LASTFM_KEY') + ' (' + self.str(k.LASTFM_KEY ? 'STATE_SAVED' : 'STATE_NONE') + ')';
    el('lastfmSecret').label = self.str('LASTFM_SECRET') + ' (' + self.str(k.LASTFM_SECRET ? 'STATE_SAVED' : 'STATE_NONE') + ')';
    if (pwSet) el('password').label = self.str('PASSWORD_NEW');
    else el('password').label = self.str('PASSWORD') + ' (' + self.str('STATE_NO_PASSWORD') + ')';
    if (!pwSet) ui.sections.forEach(function(sec){                 /* nothing to confirm yet: no field for the current one */
      sec.content = (sec.content || []).filter(function(c){ return c.id !== 'passwordOld'; });
      if (sec.saveButton) sec.saveButton.data = sec.saveButton.data.filter(function(d){ return d !== 'passwordOld'; });
    });
    var ro = readOnlyMusic();
    if (ro.length) el('tagService').doc = self.str('TAG_SERVICE_DOC') + ' ' + self.str('TAGS_RO').replace('{dirs}', ro.join(', '));
    defer.resolve(ui);
  }).fail(function(e){ defer.reject(e); });
  return defer.promise;
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
  ['tagService', 'rotelBridge'].forEach(function(id){ if (has(id)) set[id] = !!data[id]; });
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
  /* Volumio's pages are open to everyone on the network: a password once set is only changed with the current one */
  if (pw && self.auth().isSet()) {
    var defer = libQ.defer();
    self.auth().verify(String(data.passwordOld || ''), 0, function(r){
      if (r.ok) return self.applySettings(data, set, key, secret, pw).then(function(v){ defer.resolve(v); });
      self.toast('error', r.error === 'locked' ? self.str('PASSWORD_LOCKED').replace('{wait}', r.wait) : self.str('PASSWORD_WRONG'));
      defer.resolve({});
    });
    return defer.promise;
  }
  return self.applySettings(data, set, key, secret, pw);
};

ControllerXplorio.prototype.applySettings = function(data, set, key, secret, pw) {
  var self = this;
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

/* password for the System page (tags/adminpass.js, data folder of the tag service); one instance keeps the lock
   after wrong attempts */
ControllerXplorio.prototype.auth = function() {
  if (!this.authObj) this.authObj = new (require(path.join(APP, 'tags', 'adminpass.js')).Auth)(path.join(DATA, 'data'));
  return this.authObj;
};

/* Last.fm access in /data/xplorio/data/keys.json (the tag service rereads it when it changes); other entries stay */
ControllerXplorio.prototype.keys = function() {
  var appdata = require(path.join(APP, 'tags', 'appdata.js'));
  return new appdata.Keys(path.join(DATA, 'data'));
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

/* music folders Volumio (user volumio, as the tag service) cannot write to: the tag editor fails there */
function readOnlyMusic() {
  var ro = [];
  ['INTERNAL'].concat(['USB', 'NAS'].reduce(function(a, d){
    try { return a.concat(fs.readdirSync(path.join(MUSIC, d)).map(function(x){ return d + '/' + x; })); } catch (e) { return a; }
  }, [])).forEach(function(d){
    var full = path.join(MUSIC, d);
    try { if (!fs.statSync(full).isDirectory()) return; } catch (e) { return; }
    try { fs.accessSync(full, fs.W_OK); } catch (e) { ro.push(full); }
  });
  return ro;
}

/* is the port free? (a short listen on it; cb(false) when something else holds it) */
function portFree(port, cb) {
  var srv = net.createServer();
  srv.once('error', function(e){ cb(e.code !== 'EADDRINUSE'); });
  srv.once('listening', function(){ srv.close(function(){ cb(true); }); });
  try { srv.listen(port); } catch (e) { cb(true); }
}

/* the player's address for the link on the settings page */
function address() {
  var nets = os.networkInterfaces(), found = '';
  Object.keys(nets).forEach(function(n){
    (nets[n] || []).forEach(function(a){ if (!found && (a.family === 'IPv4' || a.family === 4) && !a.internal) found = a.address; });
  });
  return found || os.hostname() + '.local';
}

ControllerXplorio.SERVICES = SERVICES;
ControllerXplorio.FIELDS = FIELDS;
