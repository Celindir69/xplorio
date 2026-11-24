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
/* the separate AutoDJ plugin (Celindir69/autodj-plugin): Xplorio only points to it on the settings page */
/* the SerialAmpControl plugin (amplifiers by RS232 or network): if it is on, it has Volumio's volume and the amplifier's
   port; Xplorio then takes the volume from Volumio, offers on/off through it and leaves the Rotel bridge off */
ControllerXplorio.prototype.ampPlugin = function() {
  try {
    var pm = this.commandRouter.pluginManager;
    return !!(pm && typeof pm.isEnabled === 'function' && pm.isEnabled('system_hardware', 'serialampcontroller'));
  } catch (e) { return false; }
};
function autodjInstalled() { return fs.existsSync(process.env.XPLORIO_AUTODJ_DIR || '/data/plugins/miscellanea/volumio_autodj'); }
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
  {id: 'vuRef',        key: 'VU_REF_DBFS',   kind: 'db', options: ['-4', '-5', '-6', '-7', '-8', '-9', '-10', '-11', '-12', '-13', '-14', '-16', '-18'], def: '-8'},
  {id: 'vuNeedle',     key: 'VU_NEEDLE',     kind: 'select', options: ['fast', 'classic']},
  {id: 'vuDelay',      key: 'VU_DELAY_MS',   kind: 'db', options: ['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000', '1200', '1500', '2000'], def: '400', unit: 'ms'},
  {id: 'rotelModel',   key: 'ROTEL_MODEL',   kind: 'select', options: ['RA-1572', 'RA-1592', 'RC-1592', 'RSP-1582']},
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
  if (this.config.get('vuOutput') === undefined) this.config.set('vuOutput', true);
  if (this.config.get('streamPreamp') === undefined) this.config.set('streamPreamp', '0');
  this.defaults();
  this.vuHook(true);                                  /* early, so the MPD plugin has it when it writes mpd.conf at boot */
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
  self.vuHook(true);
  self.mpdSync();
  self.restEndpoint(true);
  var amp = self.ampPlugin(), failed = null;
  var todo = SERVICES.filter(function(s){ return !s.id || (self.config.get(s.id) && !(amp && s.id === 'rotelBridge')); });   /* not both on the amplifier */
  if (amp && self.config.get('rotelBridge')) self.logger.info('Xplorio: SerialAmpControl is on, Rotel bridge not started');
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
      /* Volumio restarted on its own: our web server kept running and holds the port itself, so restart it */
      self.exec('/bin/systemctl', ['is-active', '--quiet', s.unit + '.service'], function(err){
        if (!err) return go();
        self.toast('error', self.str('PORT_BUSY').replace('{port}', port));
        failed = 'port ' + port + ' in use'; next();
      });
    });
  })();
  return defer.promise;
};

/* all services of the plugin off (also those switched off on the page) */
ControllerXplorio.prototype.onStop = function() {
  var self = this, defer = libQ.defer(), left = SERVICES.length;
  self.vuHook(false);                                 /* removed or switched off: Volumio must not call into it any more */
  self.restEndpoint(false);
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
    'xplorio-tags':  {APP_CONFIG_DIR: web, TAGS_DATA: path.join(DATA, 'data'), XPLORIO_PLUGIN: 1},   /* the plugin's REST endpoint is there */
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
  var amp = self.ampPlugin();
  lines.push('window.APP_CONFIG.ROTEL = ' + (!!self.config.get('rotelBridge') && !amp) + ';');
  lines.push('window.APP_CONFIG.AMP_PLUGIN = ' + amp + ';');
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
    if (!autodjInstalled()) {
      var feat = ui.sections.filter(function(sec){ return sec.id === 'section_features'; })[0];
      if (feat) feat.description = [feat.description, self.str('AUTODJ_HINT')].filter(Boolean).join(' ');
    }
    el('port').value = self.port();
    if (self.ampPlugin()) {                                         /* SerialAmpControl has the amplifier */
      var rs = ui.sections.filter(function(sec){ return sec.id === 'section_rotel'; })[0];
      if (rs) rs.description = [rs.description, self.str('AMP_PLUGIN_ON')].filter(Boolean).join(' ');
    }
    ['tagService', 'rotelBridge', 'vuOutput'].forEach(function(id){ el(id).value = !!self.config.get(id); });
    var vuNote = !self.mpd() ? 'VU_NO_HOOK' : vuInTemplate() ? 'VU_BY_HAND' : '';
    if (vuNote) el('vuOutput').doc = self.str('VU_OUTPUT_DOC') + ' ' + self.str(vuNote);
    var sp = el('streamPreamp'), spv = self.preamp();
    sp.options = PREAMPS.map(function(o){ return {value: o, label: o === '0' ? self.str('PREAMP_0') : o.replace('-', '−') + ' dB'}; });
    sp.value = sp.options.filter(function(o){ return o.value === String(spv); })[0] || sp.options[0];
    var spNote = !self.mpd() ? 'VU_NO_HOOK' : preampInTemplate() ? 'PREAMP_BY_HAND' : '';
    if (spNote) sp.doc = self.str('PREAMP_DOC') + ' ' + self.str(spNote);
    FIELDS.forEach(function(f){
      var e = el(f.id), v = self.config.get(f.id);
      if (f.kind === 'bool') { e.value = !!v; return; }
      if (f.kind === 'select' || f.kind === 'tri' || f.kind === 'db') {
        e.options = (f.options || ['auto', 'on', 'off']).map(function(o){
          if (f.kind === 'db') return {value: o, label: o + ' ' + (f.unit || 'dBFS') + (o === f.def ? ' (' + self.str('VU_REF_STD') + ')' : '')};
          if (f.id === 'rotelModel') return {value: o, label: o === 'RA-1572' ? 'RA-1572 / RA-1572MKII' : o};
          return {value: o, label: f.id === 'language' && o ? LANG_NAMES[o] : self.str((f.id === 'theme' ? 'THEME_' : f.id === 'language' ? 'LANG_' : f.id === 'vuNeedle' ? 'VU_NEEDLE_' : 'TRI_') + (o || 'auto').toUpperCase())};
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
    el('listenbrainzToken').doc = self.str('LB_TOKEN_DOC') + ' ' + self.str(k.LISTENBRAINZ_TOKEN ? 'LASTFM_SAVED' : 'LASTFM_NONE');
    el('listenbrainzToken').label = self.str('LB_TOKEN') + ' (' + self.str(k.LISTENBRAINZ_TOKEN ? 'STATE_SAVED' : 'STATE_NONE') + ')';
    el('discogsToken').doc = self.str('DC_TOKEN_DOC') + ' ' + self.str(k.DISCOGS_TOKEN ? 'LASTFM_SAVED' : 'LASTFM_NONE');
    el('discogsToken').label = self.str('DC_TOKEN') + ' (' + self.str(k.DISCOGS_TOKEN ? 'STATE_SAVED' : 'STATE_NONE') + ')';
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
  ['tagService', 'rotelBridge', 'vuOutput'].forEach(function(id){ if (has(id)) set[id] = !!data[id]; });
  if (has('streamPreamp')) {
    if (PREAMPS.indexOf(String(val('streamPreamp'))) < 0) err = 'BAD_DB'; else set.streamPreamp = String(val('streamPreamp'));
  }
  FIELDS.forEach(function(f){
    if (!has(f.id) || err) return;
    var v = check(f, val(f.id));
    if (v === undefined) err = 'BAD_' + f.kind.toUpperCase(); else set[f.id] = v;
  });
  if (!err && set.rotelBridge && !(has('rotelHost') ? set.rotelHost : self.config.get('rotelHost'))) err = 'ROTEL_NO_HOST';
  var key = String(data.lastfmKey || '').trim(), secret = String(data.lastfmSecret || '').trim();
  if (!err && (!/^[A-Za-z0-9]{0,64}$/.test(key) || !/^[A-Za-z0-9]{0,64}$/.test(secret))) err = 'LASTFM_BAD';
  if (!err && !/^(|[A-Za-z0-9-]{20,100})$/.test(String(data.listenbrainzToken || '').trim())) err = 'LB_BAD';
  if (!err && !/^(|[A-Za-z0-9]{10,100})$/.test(String(data.discogsToken || '').trim())) err = 'DC_BAD';   /* as tags/macsettings.js */
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
  var lb = String(data.listenbrainzToken || '').trim();
  if (data.listenbrainzClear || lb) {
    try { self.saveKeys(data.listenbrainzClear ? {LISTENBRAINZ_TOKEN: null} : {LISTENBRAINZ_TOKEN: lb}); }
    catch (e) { self.toast('error', self.str('LASTFM_FAIL').replace('{error}', e.message)); return libQ.resolve({}); }
  }
  var dc = String(data.discogsToken || '').trim();
  if (data.discogsClear || dc) {
    try { self.saveKeys(data.discogsClear ? {DISCOGS_TOKEN: null} : {DISCOGS_TOKEN: dc}); }
    catch (e) { self.toast('error', self.str('LASTFM_FAIL').replace('{error}', e.message)); return libQ.resolve({}); }
  }
  if (pw) {
    try { self.auth().setPassword(pw); self.logger.info('Xplorio: password for the System page set'); }
    catch (e) { self.toast('error', self.str('PASSWORD_FAIL').replace('{error}', e.message)); return libQ.resolve({}); }
  }
  Object.keys(set).forEach(function(k){ self.config.set(k, set[k]); });
  var lfm = key || secret || data.lastfmClear;
  if (!Object.keys(set).length) { self.toast('success', self.str(pw ? 'PASSWORD_SAVED' : (data.discogsClear || dc) && !lfm ? (data.discogsClear ? 'DC_CLEARED' : 'DC_STORED') :
                                                                (data.listenbrainzClear || lb) && !lfm ? 'LB_STORED' : 'LASTFM_STORED')); return libQ.resolve({}); }
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
/* vals: {LASTFM_KEY, LASTFM_SECRET, LISTENBRAINZ_TOKEN, DISCOGS_TOKEN} (empty = keep, null = delete that one), null = delete both Last.fm entries */
ControllerXplorio.prototype.saveKeys = function(vals) {
  var keys = this.keys(), k = {}, cur = keys.read();
  Object.keys(cur).forEach(function(n){ k[n] = cur[n]; });
  if (!vals) { delete k.LASTFM_KEY; delete k.LASTFM_SECRET; }
  else Object.keys(vals).forEach(function(n){ if (vals[n]) k[n] = vals[n]; else if (vals[n] === null) delete k[n]; });
  keys.write(k);
  var name = vals && vals.DISCOGS_TOKEN !== undefined ? 'DISCOGS_TOKEN' : vals && vals.LISTENBRAINZ_TOKEN !== undefined ? 'LISTENBRAINZ_TOKEN' : '';
  this.logger.info('Xplorio: ' + ({DISCOGS_TOKEN: 'Discogs', LISTENBRAINZ_TOKEN: 'ListenBrainz'}[name] || 'Last.fm') + ' access ' + (vals && (!name || vals[name] !== null) ? 'saved' : 'deleted'));
};

/* ---------- additions to Volumio's own mpd.conf: VU meter output and the level of radio and streams ----------
   Xplorio never writes mpd.conf itself. Volumio's MPD plugin builds it from its template and appends what plugins return
   through registerConfigCallback, on every rebuild (boot, playback settings).
   VU meter: with the switch on, Xplorio returns the fifo output (switched off; the tag service switches it on only while
   someone looks at the meters, tags/vumeter.js). Is a VU output already in the template (added by hand), nothing is added.
   Radio and streams: replaygain_missing_preamp (dB) for everything without ReplayGain tags while ReplayGain is on. Tagged
   files are levelled to about -18 LUFS, streams are usually much louder. 0 = MPD's default (line left out); one in the
   template stays as it is. Same values as on the Mac (tags/macaudio.js). */
var VU_BLOCK = 'audio_output {\n    type            "fifo"\n    name            "VU"\n    path            "/tmp/mpd-vu.fifo"\n' +
               '    format          "44100:16:2"\n    enabled         "no"\n}\n';
var PREAMPS = ['0', '-3', '-6', '-9', '-12'];
var PREAMP_RE = /^[ \t]*replaygain_missing_preamp[ \t]+"?(-?\d+(?:\.\d+)?)/m;
var MPD_TMPL = process.env.XPLORIO_MPD_TMPL || '/volumio/app/plugins/music_service/mpd/mpd.conf.tmpl';
var MPD_CONF = process.env.XPLORIO_MPD_CONF || '/etc/mpd.conf';
var MPD_ADDR = {host: process.env.MPD_HOST || '127.0.0.1', port: +process.env.MPD_PORT || 6600};
var VU_HOOK = {type: 'user_interface', plugin: 'xplorio', data: 'getMpdConfig'};
function vuOutputIn(text) {
  return require(path.join(APP, 'tags', 'remote.js')).confOutputs(text).some(function(o){ return o.type === 'fifo' && /vu/i.test(o.name); });
}
function vuInTemplate() { return vuOutputIn(read(MPD_TMPL)); }
function preampIn(text) { var m = PREAMP_RE.exec(text); return m ? +m[1] : 0; }
function preampInTemplate() { return PREAMP_RE.test(read(MPD_TMPL)); }

ControllerXplorio.prototype.mpd = function() {
  var pm = this.commandRouter.pluginManager, m = null;
  try { m = pm && typeof pm.getPlugin === 'function' ? pm.getPlugin('music_service', 'mpd') : null; } catch (e) { /* not there */ }
  return m && typeof m.registerConfigCallback === 'function' && Array.isArray(m.registeredCallbacks) ? m : null;
};
/* on: in the MPD plugin's list once (it has no removal and keeps the list until Volumio restarts); off: out of the list
   again, else an uninstalled Xplorio would leave "undefined" in the next mpd.conf */
ControllerXplorio.prototype.vuHook = function(on) {
  var m = this.mpd();
  if (!m) return;
  var list = m.registeredCallbacks;
  for (var i = list.length - 1; i >= 0; i--) if (list[i] && list[i].plugin === VU_HOOK.plugin && list[i].data === VU_HOOK.data) list.splice(i, 1);
  if (on) m.registerConfigCallback({type: VU_HOOK.type, plugin: VU_HOOK.plugin, data: VU_HOOK.data});
};
/* level for radio and streams as set (dB, 0 = unchanged) */
ControllerXplorio.prototype.preamp = function() {
  var v = this.config && String(this.config.get('streamPreamp'));
  return PREAMPS.indexOf(v) >= 0 ? +v : 0;
};
/* called by the MPD plugin while it builds mpd.conf; the text is appended as it is (always a string) */
ControllerXplorio.prototype.getMpdConfig = function() {
  var text = this.config && this.config.get('vuOutput') && !vuInTemplate() ? VU_BLOCK : '', db = this.preamp();
  if (db && !preampInTemplate()) text += 'replaygain_missing_preamp "' + db + '"\n';
  return text;
};
/* mpd.conf as it should be with the settings? Otherwise let the MPD plugin rebuild it and restart MPD (only then:
   a setting changed, or the first start after installing). MPD forgets the ReplayGain mode set at runtime (Xplorio's
   "Playback" page) when it restarts: it is set again afterwards. cb(err) optional */
ControllerXplorio.prototype.mpdSync = function(cb) {
  var self = this, m = self.mpd();
  cb = cb || function(){};
  if (!m || typeof m.createMPDFile !== 'function') return cb(new Error('nohook'));
  var conf = read(MPD_CONF), want = self.getMpdConfig(), vu = want.indexOf(VU_BLOCK) >= 0;
  var vuOk = vu ? vuOutputIn(conf) : conf.indexOf(VU_BLOCK) < 0;  /* off: only our own block goes, one added by hand stays */
  var preOk = preampInTemplate() || preampIn(conf) === self.preamp();
  if (vuOk && preOk) return cb(null);
  self.logger.info('Xplorio: mpd.conf rebuilt (VU output ' + (vu ? 'on' : 'off') + ', radio and streams ' + self.preamp() + ' dB), MPD restarts');
  self.mpdCmd('replay_gain_status', function(e, rg){
    var mode = !e && /^replay_gain_mode: (off|track|album|auto)$/m.exec(rg || '');
    m.createMPDFile(function(err){
      if (err) { self.logger.error('Xplorio: mpd.conf not rebuilt: ' + err); return cb(new Error('conf')); }
      if (typeof m.restartMpd !== 'function') return cb(null);
      m.restartMpd(function(err2){
        if (err2) { self.logger.error('Xplorio: MPD did not restart: ' + err2); return cb(new Error('restart')); }
        if (!mode || mode[1] === 'off') return cb(null);
        self.mpdCmd('replay_gain_mode ' + mode[1], function(){ cb(null); }, 20);
      });
    });
  }, 0);
};
/* one MPD command on its own connection; tries: MPD may still be starting. cb(err, answer text) */
ControllerXplorio.prototype.mpdCmd = function(cmd, cb, tries) {
  var self = this, done = false, buf = '';
  var sock = net.connect(MPD_ADDR.port, MPD_ADDR.host);
  function end(e, text) {
    if (done) return; done = true; sock.destroy();
    if (e && tries > 0) return setTimeout(function(){ self.mpdCmd(cmd, cb, tries - 1); }, 500);
    cb(e, text);
  }
  sock.setTimeout(5000, function(){ end(new Error('timeout')); });
  sock.on('error', function(e){ end(e); });
  sock.on('data', function(d){
    buf += d;
    if (buf.indexOf('OK MPD') === 0 && buf.indexOf('\n') > 0 && !sock.sent) { sock.sent = true; buf = ''; sock.write(cmd + '\n'); return; }
    if (/^(OK|ACK.*)$/m.test(buf)) end(/^ACK/m.test(buf) ? new Error('ack') : null, buf);
  });
};
/* REST for Xplorio's "Playback" page (POST /api/v1/pluginEndpoint {endpoint: 'xplorio', data}), reached through the
   tag service, which checks the password first: {action: 'preamp'} = state, {action: 'preamp', db} = set (MPD restarts) */
var REST_ENDPOINT = {endpoint: 'xplorio', type: 'user_interface', name: 'xplorio', method: 'restApi'};
ControllerXplorio.prototype.restEndpoint = function(on) {
  var r = this.commandRouter, fn = on ? 'addPluginRestEndpoint' : 'removePluginRestEndpoint';
  try { if (typeof r[fn] === 'function') r[fn](REST_ENDPOINT); } catch (e) { this.logger.error('Xplorio: REST endpoint: ' + e.message); }
};
ControllerXplorio.prototype.restApi = function(data) {
  var self = this, defer = libQ.defer();
  data = data || {};
  function state() {
    return {ok: true, missingPreamp: preampIn(read(MPD_CONF)), missingPreamps: PREAMPS.map(Number), byHand: preampInTemplate(), hook: !!self.mpd()};
  }
  if (data.action !== 'preamp') return libQ.resolve({ok: false, error: 'action'});
  if (data.db === undefined) return libQ.resolve(state());
  var db = String(parseInt(data.db, 10));
  if (PREAMPS.indexOf(db) < 0) return libQ.resolve({ok: false, error: 'value'});
  if (!self.mpd()) return libQ.resolve({ok: false, error: 'conf'});
  if (preampInTemplate()) return libQ.resolve({ok: false, error: 'byhand'});
  if (self.preampBusy) return libQ.resolve({ok: false, error: 'busy'});
  self.preampBusy = true;
  self.config.set('streamPreamp', db);
  self.mpdSync(function(err){
    self.preampBusy = false;
    var r = state();
    if (err) { r.ok = false; r.error = err.message === 'restart' ? 'restart' : 'conf'; }
    defer.resolve(r);
  });
  return defer.promise;
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
  if (f.kind === 'db') return f.options.indexOf(String(v)) >= 0 ? String(v) : f.def;
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
  if (f.kind === 'db') return Number(v);
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
  if (f.kind === 'select' || f.kind === 'db') return f.options.indexOf(String(v)) >= 0 ? String(v) : undefined;
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
