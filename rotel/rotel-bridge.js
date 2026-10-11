var net  = require('net');
var http = require('http');
var url  = require('url');

var fs   = require('fs');
var vm   = require('vm');

/* Adresse des Verstärkers aus der Konfiguration der Oberfläche (web/config.js, dann web/config.local.js):
   ROTEL_HOST, ROTEL_AMP_PORT (Verstärker, 9590) und ROTEL_PORT (dieser Dienst, 8765).
   Umgebungsvariablen ROTEL_HOST, ROTEL_PORT (Verstärker), HTTP_PORT gehen vor. */
var CONFIG_DIR = process.env.APP_CONFIG_DIR || '/volumio/http/www3/web';
function loadAppConfig() {
  var ctx = {window: {}};
  ['config.js', 'config.local.js'].forEach(function(f){
    try { vm.runInNewContext(fs.readFileSync(CONFIG_DIR + '/' + f, 'utf8'), ctx, {filename: f, timeout: 1000}); }
    catch (e) { if (e.code !== 'ENOENT') console.error('Konfiguration ' + f + ': ' + e.message); }
  });
  return ctx.window.APP_CONFIG || {};
}
var CFG = loadAppConfig();

var ROTEL_HOST = process.env.ROTEL_HOST || CFG.ROTEL_HOST || '';
var ROTEL_PORT = parseInt(process.env.ROTEL_PORT || CFG.ROTEL_AMP_PORT || '9590', 10);
var HTTP_PORT  = parseInt(process.env.HTTP_PORT  || CFG.ROTEL_PORT || '8765', 10);
var MAX_VOL    = 70;   /* Sicherheitsgrenze (Rotel: 0-96) */

/* Geräteprofil: Befehle des Rotel-ASCII-Protokolls V2 (RA-1572 ab V2.65, RA-1572MKII; Rotel „RS232 / IP ASCII
   Controller Command List“). Andere Modelle: in web/config.local.js mit ROTEL_PROFILE überschreiben, z. B.
   ROTEL_PROFILE: {sources: [{cmd: 'opt1', name: 'Fernseher'}, {cmd: 'pcusb', name: 'Player'}], speakerB: false}.
   Jeder Eintrag ersetzt den Standard; false blendet das Bedienelement aus. Nur Befehle aus dem Profil gehen an den Verstärker.
   bass/treble: [lauter, leiser, Mitte]; balance: [nach rechts, nach links, Mitte] (je ein Schritt bzw. auf 0) */
var DEFAULT_PROFILE = {
  model: 'RA-1572 / RA-1572MKII',
  sources: [
    {cmd: 'cd', name: 'CD'}, {cmd: 'coax1', name: 'Coax 1'}, {cmd: 'coax2', name: 'Coax 2'}, {cmd: 'opt1', name: 'Opt 1'},
    {cmd: 'opt2', name: 'Opt 2'}, {cmd: 'aux', name: 'Aux'}, {cmd: 'tuner', name: 'Tuner'}, {cmd: 'phono', name: 'Phono'},
    {cmd: 'usb', name: 'USB'}, {cmd: 'bluetooth', name: 'Bluetooth'}, {cmd: 'bal_xlr', name: 'XLR'}, {cmd: 'pcusb', name: 'PC-USB'}
  ],
  bypass: ['bypass_on', 'bypass_off'],
  bass: ['bass_up', 'bass_down', 'bass_000'], treble: ['treble_up', 'treble_down', 'treble_000'], toneMax: 10,
  balance: ['balance_r', 'balance_l', 'balance_000'], balanceMax: 15,
  speakerA: ['speaker_a_on', 'speaker_a_off'], speakerB: ['speaker_b_on', 'speaker_b_off'],
  powerOnSource: 'pcusb'                          /* nach dem Einschalten diesen Eingang wählen ('' = nichts umschalten) */
};
var CMD_RE = /^[a-z0-9_+\-]{1,24}$/;

/* Standard mit ROTEL_PROFILE überschreiben; ungültige Befehle fallen weg */
function makeProfile(over) {
  var p = {}, o = over && typeof over === 'object' ? over : {};
  Object.keys(DEFAULT_PROFILE).forEach(function(k){ p[k] = Object.prototype.hasOwnProperty.call(o, k) ? o[k] : DEFAULT_PROFILE[k]; });
  p.sources = (Array.isArray(p.sources) ? p.sources : []).map(function(x){
    return typeof x === 'string' ? {cmd: x, name: x} : {cmd: String(x && x.cmd || ''), name: String(x && (x.name || x.cmd) || '')};
  }).filter(function(x){ return CMD_RE.test(x.cmd); });
  function cmds(v, len) { return Array.isArray(v) && v.length === len && v.every(function(c){ return CMD_RE.test(String(c)); }) ? v.map(String) : false; }
  ['bypass', 'speakerA', 'speakerB'].forEach(function(k){ p[k] = cmds(p[k], 2); });
  ['bass', 'treble', 'balance'].forEach(function(k){ p[k] = cmds(p[k], 3); });
  p.toneMax = Math.max(1, Math.min(20, parseInt(p.toneMax, 10) || 10));
  p.balanceMax = Math.max(1, Math.min(30, parseInt(p.balanceMax, 10) || 15));
  p.powerOnSource = CMD_RE.test(String(p.powerOnSource || '')) ? p.powerOnSource : '';
  return p;
}
/* Rückmeldungen: Klang +03 / -03 / 000, Balance L05 / R05 / 000 (links negativ) */
function parseTone(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
function parseBalance(v) {
  var m = /^([lr]?)(\d+)$/.exec(String(v));
  if (!m) return null;
  return m[1] === 'l' ? -parseInt(m[2], 10) : parseInt(m[2], 10);
}
/* erlaubte Befehle für /cmd */
function allowedCmds(p) {
  var a = ['vol_up', 'vol_dwn', 'mute_on', 'mute_off', 'power_on', 'power_off'];
  p.sources.forEach(function(x){ a.push(x.cmd); });
  ['bypass', 'speakerA', 'speakerB', 'bass', 'treble', 'balance'].forEach(function(k){ if (p[k]) a = a.concat(p[k]); });
  var cfgCmds = [CFG.ROTEL_CMD_POWER_ON, CFG.ROTEL_CMD_POWER_OFF].filter(function(c){ return CMD_RE.test(String(c || '')); });
  return a.concat(cfgCmds);
}
/* Abfragen nach dem Verbinden */
function queries(p) {
  var q = ['power?', 'volume?', 'mute?', 'source?'];
  if (p.bypass) q.push('bypass?');
  if (p.bass) q.push('bass?');
  if (p.treble) q.push('treble?');
  if (p.balance) q.push('balance?');
  if (p.speakerA || p.speakerB) q.push('speaker?');
  return q;
}

var PROFILE = makeProfile(CFG.ROTEL_PROFILE);
var POWER_ON_SOURCE = PROFILE.powerOnSource;

var state = {connected:false, power:null, volume:null, mute:null, source:null,
             bypass:null, bass:null, treble:null, balance:null, speakerA:null, speakerB:null};
var sock = null, buf = '', retry = null, connectTimer = null, sourceTimer = null;

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* true, wenn der Befehl wirklich an den Verstärker ging */
function send(c) {
  if (sock && state.connected) { sock.write(c + '!'); return true; }
  return false;
}

/* Eingang nach dem Einschalten: Der Verstärker braucht beim Hochfahren einen Moment und
   nimmt Befehle erst danach an. Darum: senden, kurz warten, nachfragen, bei Bedarf bis zu
   fünfmal wiederholen. */
function ensureSource(tries) {
  clearTimeout(sourceTimer);
  if (!POWER_ON_SOURCE || !state.connected || state.power !== true) return;
  if (norm(state.source) === norm(POWER_ON_SOURCE)) return;
  if (tries <= 0) return;
  send(POWER_ON_SOURCE);
  sourceTimer = setTimeout(function(){
    if (sock && state.connected) sock.write('source?');
    sourceTimer = setTimeout(function(){ ensureSource(tries - 1); }, 1000);
  }, 1500);
}

function parseMsg(m) {
  m = m.trim();
  var i = m.indexOf('=');
  if (i < 0) return;
  var k = m.slice(0, i).toLowerCase(), v = m.slice(i + 1).toLowerCase();
  if (k === 'volume') { var n = parseInt(v, 10); if (!isNaN(n)) state.volume = n; }
  else if (k === 'mute')   state.mute  = (v === 'on');
  else if (k === 'power') {
    var was = state.power;
    state.power = (v === 'on');
    /* Wechsel von Standby auf "an" (nicht beim ersten Abfragen nach dem Verbinden) */
    if (was === false && state.power === true) {
      clearTimeout(sourceTimer);
      sourceTimer = setTimeout(function(){ ensureSource(5); }, 2000);
    }
    if (!state.power) clearTimeout(sourceTimer);
  }
  else if (k === 'source') state.source = v;
  else if (k === 'bypass') state.bypass = (v === 'on');
  else if (k === 'bass')    state.bass    = parseTone(v);
  else if (k === 'treble')  state.treble  = parseTone(v);
  else if (k === 'balance') state.balance = parseBalance(v);
  else if (k === 'speaker') { state.speakerA = v === 'a' || v === 'a_b'; state.speakerB = v === 'b' || v === 'a_b'; }
}

function connect() {
  clearTimeout(retry);
  if (!ROTEL_HOST) { console.error('ROTEL_HOST fehlt (web/config.local.js oder Umgebungsvariable): keine Verbindung zum Verstärker'); return; }
  buf = '';
  sock = net.createConnection({host:ROTEL_HOST, port:ROTEL_PORT});
  sock.setEncoding('ascii');
  sock.setKeepAlive(true, 10000);
  /* hängt der Verbindungsaufbau (Verstärker antwortet nicht), nach 5 s abbrechen und neu versuchen */
  clearTimeout(connectTimer);
  var mine = sock;
  connectTimer = setTimeout(function(){ if (mine === sock && !state.connected) mine.destroy(); }, 5000);
  sock.on('connect', function(){
    clearTimeout(connectTimer);
    state.connected = true;
    send('rs232_update_on');          /* Rotel meldet Änderungen selbst */
    queries(PROFILE).forEach(function(q){ sock.write(q); });
  });
  sock.on('data', function(d){
    buf += d;
    var parts = buf.split('$');
    buf = parts.pop();
    parts.forEach(parseMsg);
  });
  sock.on('error', function(){});
  sock.on('close', function(){
    clearTimeout(connectTimer);
    clearTimeout(sourceTimer);
    state.connected = false;
    state.power = null;               /* unbekannt statt eines alten Werts */
    sock = null;
    clearTimeout(retry);
    retry = setTimeout(connect, 5000);
  });
}

/* ---------- Zugriffsschutz (Kopie von tags/guard.js; Änderungen dort mit übernehmen) ----------
   Nur die Oberfläche auf diesem Gerät darf schalten: Host aus dem Heimnetz (gegen DNS-Rebinding),
   Origin vom selben Gerät; ohne Origin (curl) braucht /cmd bzw. /vol den Kopf X-Xplorio. */
var LOCAL_SUFFIX = /\.(local|lan|home|internal|home\.arpa|fritz\.box|localdomain)$/;

/* "Name:Port" bzw. "[::1]:Port" -> Name in Kleinbuchstaben */
function hostName(h) {
  h = String(h || '').trim().toLowerCase();
  if (h.charAt(0) === '[') { var e = h.indexOf(']'); return e > 0 ? h.slice(1, e) : ''; }
  var i = h.indexOf(':');
  if (i >= 0 && h.indexOf(':', i + 1) < 0) h = h.slice(0, i);    /* IPv6 ohne Klammern: unverändert */
  return h.replace(/\.$/, '');
}

function isIp(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.indexOf(':') >= 0 && /^[0-9a-f:.]+$/.test(h));
}

/* extra: zusätzliche erlaubte Namen (APP_CONFIG.ALLOWED_HOSTS) */
function hostOk(h, extra) {
  var n = hostName(h);
  if (!n) return false;
  if ((extra || []).some(function(x){ return hostName(x) === n; })) return true;
  return n === 'localhost' || isIp(n) || /^[a-z0-9-]+$/.test(n) || LOCAL_SUFFIX.test(n);
}

/* Herkunft "http://name:port" -> Name, sonst '' ("null", file:, Unsinn) */
function originName(o) {
  var m = /^https?:\/\/([^\/?#]+)$/i.exec(String(o || '').trim());
  return m ? hostName(m[1].replace(/^[^@]*@/, '')) : '';
}

/* Prüft eine Anfrage. Ergebnis: {ok, origin, reason}
   origin: die erlaubte Herkunft für Access-Control-Allow-Origin ('' = keine)
   write:  true für Anfragen, die etwas ändern */
function check(req, write, extra) {
  var h = req.headers || {}, host = h.host, origin = h.origin;
  if (!hostOk(host, extra)) return {ok: false, origin: '', reason: 'host'};
  if (origin !== undefined) {
    var on = originName(origin);
    if (!on || on !== hostName(host) && !(extra || []).some(function(x){ return hostName(x) === on; }))
      return {ok: false, origin: '', reason: 'origin'};
    return {ok: true, origin: String(origin).trim(), reason: ''};
  }
  if (write && !h['x-xplorio'] && !/^application\/(json|x-ndjson)\b/i.test(String(h['content-type'] || '')))
    return {ok: false, origin: '', reason: 'marker'};
  return {ok: true, origin: '', reason: ''};
}

/* Kopfzeilen für CORS: nur für die erlaubte Herkunft */
function corsHeaders(origin) {
  var o = {'Vary': 'Origin'};
  if (origin) {
    o['Access-Control-Allow-Origin'] = origin;
    o['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    o['Access-Control-Allow-Headers'] = 'Content-Type, X-Xplorio';
    o['Access-Control-Max-Age'] = '600';
  }
  return o;
}

var EXTRA_HOSTS = [].concat(CFG.ALLOWED_HOSTS || [], String(process.env.XPLORIO_HOSTS || '').split(','))
  .map(function(x){ return String(x).trim(); }).filter(Boolean);

var ALLOWED = allowedCmds(PROFILE);

var server = http.createServer(function(req, res){
  var u = url.parse(req.url, true), ok = true, error = null;
  var g = check(req, u.pathname === '/cmd' || u.pathname === '/vol', EXTRA_HOSTS);
  if (!g.ok) {
    res.writeHead(403, {'Content-Type':'application/json', 'Vary':'Origin', 'Cache-Control':'no-store'});
    return res.end(JSON.stringify({ok:false, error:'nicht erlaubt (' + g.reason + ')'}));
  }
  var head = corsHeaders(g.origin);
  head['Content-Type'] = 'application/json';
  head['Cache-Control'] = 'no-store';
  if (req.method === 'OPTIONS') { res.writeHead(204, head); return res.end(); }
  if (u.pathname === '/cmd' && ALLOWED.indexOf(u.query.c) > -1) {
    if (!send(u.query.c)) { ok = false; error = 'nicht verbunden'; }
  } else if (u.pathname === '/vol') {
    var v = parseInt(u.query.v, 10);
    if (!isNaN(v)) {
      v = Math.max(0, Math.min(MAX_VOL, v));
      if (send('vol_' + (v < 10 ? '0' : '') + v)) state.volume = v;
      else { ok = false; error = 'nicht verbunden'; }
    }
  } else if (u.pathname === '/profile') {
    /* für die Fernbedienung: welche Bedienelemente es gibt (ohne Befehle) */
    res.writeHead(200, head);
    return res.end(JSON.stringify({ok: true, state: state, profile: {model: PROFILE.model, maxVol: MAX_VOL,
      sources: PROFILE.sources, bypass: !!PROFILE.bypass, bass: !!PROFILE.bass, treble: !!PROFILE.treble, toneMax: PROFILE.toneMax,
      balance: !!PROFILE.balance, balanceMax: PROFILE.balanceMax, speakerA: !!PROFILE.speakerA, speakerB: !!PROFILE.speakerB,
      cmd: {bypass: PROFILE.bypass, speakerA: PROFILE.speakerA, speakerB: PROFILE.speakerB, bass: PROFILE.bass, treble: PROFILE.treble, balance: PROFILE.balance}}}));
  } else if (u.pathname !== '/state') {
    ok = false; error = 'unbekannt';
  }
  res.writeHead(ok ? 200 : (error === 'unbekannt' ? 404 : 503), head);
  var out = {ok:ok, state:state};
  if (error) out.error = error;
  res.end(JSON.stringify(out));
});

if (require.main === module) { server.listen(HTTP_PORT); connect(); }
module.exports = {server: server, check: check, hostOk: hostOk, makeProfile: makeProfile, allowedCmds: allowedCmds, queries: queries,
  parseMsg: parseMsg, state: state};
