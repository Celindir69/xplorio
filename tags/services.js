/* Dienste für die Seite „System“: Zustand der Player-Dienste (systemctl show) und Neustart, beim Kiosk auch
   Start und Stopp. Nur die Dienste und Aktionen aus UNITS sind erlaubt. Der Tag-Dienst läuft als Benutzer
   volumio und braucht dafür eine sudo-Regel (Anleitung: docs/einrichten.md, „Dienste“); ohne sie bleibt die
   Anzeige, die Knöpfe melden „nosudo“.
   Node 8, nur ES5. run: Ersatz für execFile (Tests) */
var fs = require('fs'), cp = require('child_process');

var UNITS = [
  {id: 'volumio',       actions: ['restart']},
  {id: 'mpd',           actions: ['restart']},
  {id: 'tag-service',   actions: ['restart']},
  {id: 'rotel-bridge',  actions: ['restart']},
  {id: 'volumio-kiosk', actions: ['start', 'stop', 'restart']}
];
var SYSTEMCTL = '/bin/systemctl', TIMEOUT = 8000, SUDO_CACHE_MS = 300000;

function unitOf(id) {
  for (var i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return UNITS[i];
  return null;
}
function allowed(id, action) {
  var u = unitOf(id);
  return !!u && u.actions.indexOf(action) >= 0;
}
/* genau diese Befehlszeile steht in der sudo-Regel */
function command(id, action) { return [SYSTEMCTL, '--no-block', action, id]; }

/* Ausgabe von systemctl show -p … a b c: je Dienst ein Block, getrennt durch Leerzeilen.
   uptime (s) und now (ms) rechnen den Startzeitpunkt (monoton, µs seit Systemstart) in Epoch-ms um */
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

/* Liste für die Seite: Reihenfolge wie UNITS, nicht eingerichtete Dienste fallen weg */
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

/* darf der Tag-Dienst die Befehle ohne Passwort ausführen? (sudo -n -l <Befehl>, 5 min gemerkt) */
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

/* Aktion ausführen; cb(code, obj). Beim eigenen Dienst kommt die Antwort zuerst, der Befehl kurz danach */
Services.prototype.act = function(id, action, self_, cb) {
  var me = this;
  if (!allowed(id, action)) return cb(400, {ok: false, error: 'nicht erlaubt'});
  function go(done) {
    me.run('sudo', ['-n'].concat(command(id, action)), function(err){
      if (err) { me.sudoOk = null; console.error('Dienst ' + id + ' ' + action + ' gescheitert: ' + (err.message || err)); }
      if (done) done(err);
    });
  }
  if (id === self_) {                       /* ohne sudo-Recht gäbe es danach keine Rückmeldung mehr */
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

module.exports = {Services: Services, UNITS: UNITS, allowed: allowed, command: command, parseShow: parseShow, merge: merge};
