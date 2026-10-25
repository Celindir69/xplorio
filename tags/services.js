/* Services for the "System" page: state of the player services (systemctl show) and restart. Only the services and actions in UNITS are allowed. The tag service runs as user
   volumio and needs sudo for systemctl (Volumio allows it; for an installation with xplorio-deploy see
   docs/einrichten.md, "Dienste"); without it the display stays, the buttons report "nosudo". Also restart and power-off of the whole player (power).
   Node 8, ES5 only. run: replacement for execFile (tests) */
var fs = require('fs'), cp = require('child_process');

var UNITS = [
  {id: 'volumio',       actions: ['restart']},
  {id: 'mpd',           actions: ['restart']},
  {id: 'tag-service',   actions: ['restart']},
  {id: 'rotel-bridge',  actions: ['restart']},
  {id: 'xplorio-web',   actions: ['restart']},   /* the Volumio plugin's own services */
  {id: 'xplorio-tags',  actions: ['restart']},
  {id: 'xplorio-rotel', actions: ['restart']}
];
var SYSTEMCTL = '/bin/systemctl', TIMEOUT = 8000, SUDO_CACHE_MS = 300000;
var POWER = {reboot: ['/sbin/reboot'], poweroff: ['/sbin/poweroff']};   /* the same commands as Volumio itself */

function unitOf(id) {
  for (var i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return UNITS[i];
  return null;
}
function allowed(id, action) {
  var u = unitOf(id);
  return !!u && u.actions.indexOf(action) >= 0;
}
/* exactly this command line is in the sudo rule */
function command(id, action) { return [SYSTEMCTL, '--no-block', action, id]; }

/* output of systemctl show -p … a b c: one block per service, separated by blank lines.
   uptime (s) and now (ms) convert the start time (monotonic, µs since boot) to epoch ms */
function parseShow(text, uptime, now) {
  var out = [], cur = null;
  String(text || '').split('\n').concat(['']).forEach(function(l){
    l = l.replace(/\r$/, '');
    if (!l) { if (cur) out.push(cur); cur = null; return; }
    var i = l.indexOf('=');
    if (i < 0) return;
    cur = cur || {};
    cur[l.slice(0, i)] = l.slice(i + 1);
  });
  return out.map(function(b){
    var mono = parseInt(b.ActiveEnterTimestampMonotonic, 10), since = null;
    if (b.ActiveState === 'active' && mono > 0 && isFinite(uptime) && uptime > 0)
      since = Math.round(now - (uptime * 1e6 - mono) / 1000);
    return {id: String(b.Id || '').replace(/\.service$/, ''), load: b.LoadState || '', active: b.ActiveState || '',
            sub: b.SubState || '', since: since};
  });
}

/* list for the page: order as in UNITS, services not installed are dropped */
function merge(parsed) {
  var by = {};
  parsed.forEach(function(p){ by[p.id] = p; });
  return UNITS.filter(function(u){ var p = by[u.id]; return p && p.load && p.load !== 'not-found'; })
    .map(function(u){ var p = by[u.id]; return {id: u.id, active: p.active, sub: p.sub, since: p.since, actions: u.actions}; });
}

function defaultRun(file, args, cb) {
  cp.execFile(file, args, {timeout: TIMEOUT}, function(err, stdout){ cb(err, String(stdout || '')); });
}

function Services(opts) {
  opts = opts || {};
  this.run = opts.run || defaultRun;
  this.root = opts.root || '';
  this.sudoOk = null; this.sudoAt = 0;
}

Services.prototype.uptime = function() {
  try { return parseFloat(fs.readFileSync(this.root + '/proc/uptime', 'utf8')); } catch (e) { return NaN; }
};

/* may the tag service run the commands without a password? (sudo -n -l <command>, cached for 5 min) */
Services.prototype.sudoCheck = function(cb) {
  var self = this;
  if (this.sudoOk !== null && Date.now() - this.sudoAt < SUDO_CACHE_MS) return cb(this.sudoOk);
  this.run('sudo', ['-n', '-l'].concat(command('volumio', 'restart')), function(err){
    self.sudoOk = !err; self.sudoAt = Date.now();
    cb(self.sudoOk);
  });
};

Services.prototype.status = function(cb) {
  var self = this, ids = UNITS.map(function(u){ return u.id + '.service'; });
  this.run(SYSTEMCTL, ['show', '-p', 'Id,LoadState,ActiveState,SubState,ActiveEnterTimestampMonotonic'].concat(ids), function(err, out){
    if (err && !out) return cb({ok: false, error: 'systemctl'});
    var list = merge(parseShow(out, self.uptime(), Date.now()));
    self.sudoCheck(function(ok){ cb({ok: true, units: list, sudo: ok}); });
  });
};

/* run an action; cb(code, obj). For the own service the response comes first, the command shortly after */
Services.prototype.act = function(id, action, self_, cb) {
  var me = this;
  if (!allowed(id, action)) return cb(400, {ok: false, error: 'not allowed'});
  function go(done) {
    me.run('sudo', ['-n'].concat(command(id, action)), function(err){
      if (err) { me.sudoOk = null; console.error('service ' + id + ' ' + action + ' failed: ' + (err.message || err)); }
      if (done) done(err);
    });
  }
  if (id === self_) {                       /* without sudo permission there would be no feedback afterwards */
    this.sudoOk = null;
    return this.sudoCheck(function(ok){
      if (!ok) return cb(200, {ok: false, error: 'nosudo'});
      cb(200, {ok: true, self: true});
      setTimeout(function(){ go(null); }, 300);
    });
  }
  go(function(err){
    if (err) return cb(200, {ok: false, error: 'nosudo'});
    cb(200, {ok: true});
  });
};

/* restart or power off the player: first check that sudo allows it, then respond, then run */
Services.prototype.power = function(action, cb) {
  var me = this, cmd = POWER[action];
  if (!cmd || !Object.prototype.hasOwnProperty.call(POWER, action)) return cb(400, {ok: false, error: 'not allowed'});
  this.run('sudo', ['-n', '-l'].concat(cmd), function(err){
    if (err) return cb(200, {ok: false, error: 'nosudo'});
    cb(200, {ok: true});
    setTimeout(function(){
      console.log('Player: ' + action + ' (System page)');
      me.run('sudo', ['-n'].concat(cmd), function(e){ if (e) console.error('Player ' + action + ' failed: ' + (e.message || e)); });
    }, 500);
  });
};

module.exports = {Services: Services, UNITS: UNITS, allowed: allowed, command: command, POWER: POWER, parseShow: parseShow, merge: merge};
