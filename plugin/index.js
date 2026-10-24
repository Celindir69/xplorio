'use strict';
/* Volumio plugin Xplorio: serves the interface on its own port (app/server/xplorio-server.js, inside Volumio's own
   Node process) and starts the tag service and the Rotel bridge as child processes. Nothing below /volumio changes,
   so Volumio's integrity check before a system update stays intact. Data and own settings live in /data/xplorio
   (stay when the plugin is updated or removed). A service that already runs as a systemd unit (earlier installation
   with xplorio-deploy) is left as it is. Node 8, ES5 only. */
var libQ = require('kew');
var fs   = require('fs');
var os   = require('os');
var path = require('path');
var cp   = require('child_process');

module.exports = ControllerXplorio;

var APP    = path.join(__dirname, 'app');            /* the interface and the services (tools/make-plugin.sh) */
var DATA   = process.env.XPLORIO_DATA || '/data/xplorio';
var CHILDREN = [
  {id: 'tagService',  unit: 'tag-service',  script: 'tags/tag-service.js',   node: ['--max-old-space-size=384']},
  {id: 'rotelBridge', unit: 'rotel-bridge', script: 'rotel/rotel-bridge.js', node: []}
];
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
  if (this.config.get('rotelBridge') === undefined) this.config.set('rotelBridge', /ROTEL_HOST/.test(read(path.join(DATA, 'config.local.js'))));
  return libQ.resolve();
};

ControllerXplorio.prototype.getConfigurationFiles = function() { return ['config.json']; };

ControllerXplorio.prototype.onStart = function() {
  var self = this, defer = libQ.defer();
  self.stopping = false; self.notes = [];
  linkConfig(self.logger);
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
  env.APP_CONFIG_DIR = path.join(APP, 'web');       /* config.js and config.local.js (link to /data/xplorio) */
  env.TAGS_DATA = path.join(DATA, 'data');
  var started = Date.now();
  var proc = self.spawn(process.execPath, c.node.concat([path.join(APP, c.script)]),
                        {cwd: path.join(APP, path.dirname(c.script)), env: env, stdio: ['ignore', 'pipe', 'pipe']});
  ch.proc = proc;
  function log(level) {
    return function(d){ String(d).split('\n').forEach(function(l){ if (l.trim()) self.logger[level]('Xplorio ' + c.unit + ': ' + l); }); };
  }
  if (proc.stdout) proc.stdout.on('data', log('info'));
  if (proc.stderr) proc.stderr.on('data', log('error'));
  proc.on('error', function(e){ self.logger.error('Xplorio ' + c.unit + ': ' + e.message); });
  proc.on('exit', function(code, sig){
    if (ch.proc !== proc) return;
    ch.proc = null;
    if (self.stopping) return;
    if (Date.now() - started > RESTART_MAX) ch.wait = RESTART_MIN;          /* ran for a while: start again soon */
    self.logger.error('Xplorio ' + c.unit + ' ended (' + (sig || code) + '), new start in ' + ch.wait / 1000 + ' s');
    ch.timer = setTimeout(function(){ if (!self.stopping) self.startChild(c); }, ch.wait);
    ch.wait = Math.min(RESTART_MAX, ch.wait * 2);
  });
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
    var url = self.url(), open = ui.sections[0], set = ui.sections[1].content;
    open.description = [self.str('OPEN_DOC').replace('{url}', url)].concat(self.notes.map(function(u){
      return self.str('SYSTEMD').replace('{name}', u);
    })).join(' ');
    open.content[0].onClick.url = url;
    set[0].value = self.port();
    set[1].value = !!self.config.get('tagService');
    set[2].value = !!self.config.get('rotelBridge');
    defer.resolve(ui);
  }).fail(function(e){ defer.reject(e); });
  return defer.promise;
};

ControllerXplorio.prototype.saveSettings = function(data) {
  var self = this, p = parseInt(data.port, 10);
  if (!(p >= 1024 && p <= 65535) || p === 3000) { self.toast('error', self.str('BAD_PORT')); return libQ.resolve({}); }
  self.config.set('port', p);
  self.config.set('tagService', !!data.tagService);
  self.config.set('rotelBridge', !!data.rotelBridge);
  return self.onStop().then(function(){ return self.onStart(); }).then(function(){ self.toast('success', self.str('SAVED')); return {}; });
};

/* ---------- helpers ---------- */
function read(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }
function json(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

/* app/web/config.local.js -> /data/xplorio/config.local.js: one file for the interface and the services, outside the
   plugin folder (which Volumio replaces on every update) */
function linkConfig(logger) {
  var link = path.join(APP, 'web', 'config.local.js'), target = path.join(DATA, 'config.local.js');
  try { if (fs.readlinkSync(link) === target) return; } catch (e) { /* not a link yet */ }
  try { fs.unlinkSync(link); } catch (e) { /* not there */ }
  try { fs.symlinkSync(target, link); } catch (e) { logger.error('Xplorio: link to ' + target + ': ' + e.message); }
}

/* the player's address for the link on the settings page */
function address() {
  var nets = os.networkInterfaces(), found = '';
  Object.keys(nets).forEach(function(n){
    (nets[n] || []).forEach(function(a){ if (!found && (a.family === 'IPv4' || a.family === 4) && !a.internal) found = a.address; });
  });
  return found || os.hostname() + '.local';
}

ControllerXplorio.CHILDREN = CHILDREN;
