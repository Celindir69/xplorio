/* Settings on the Mac (PLAYER 'mpd'; gear menu -> "Mac settings", web/js/macsettings.js): what the Volumio plugin's
   settings page does on the player. Music folders as links in the music folder (INTERNAL, USB, NAS or links inside them),
   the audio analysis file (link to the file the analysis writes, or a copy), Last.fm access, the interface settings
   (written to config.local.js; own lines below the marker stay). Node 8, ES5 only.
   opts: musicRoot, configFile (config.local.js, also through a link), keys (appdata.Keys), essentiaFile,
         scan(cb) (MPD reads the library again), choose(kind, cb(err, path)) (folder/file dialog, Mac only),
         essentiaStatus() ({tracks}) */
var fs = require('fs');
var path = require('path');

var SLOTS = ['INTERNAL', 'USB', 'NAS'];
var MARK = '/* ---- own additions (kept) ---- */';
/* settings of the interface: id, APP_CONFIG key, kind (like plugin/index.js) */
var FIELDS = [
  {id: 'language',     key: 'LANGUAGE',      kind: 'select', options: ['', 'de', 'en', 'fr', 'es', 'it'], def: ''},
  {id: 'theme',        key: 'THEME',         kind: 'select', options: ['auto', 'light', 'dark'], def: 'auto'},
  {id: 'history',      key: 'HISTORY',       kind: 'bool', def: true},
  {id: 'releaseDates', key: 'RELEASEDATES',  kind: 'bool', def: true},
  {id: 'artistNames',  key: 'ARTISTNAMES',   kind: 'bool', def: true},
  {id: 'moodTags',     key: 'MOODTAGS',      kind: 'bool', def: true},
  {id: 'colorMood',    key: 'COLOR_MOOD',    kind: 'bool', def: true},
  {id: 'm4aProbe',     key: 'M4A_PROBE',     kind: 'bool', def: true},
  {id: 'm4aLossless',  key: 'M4A_LOSSLESS',  kind: 'bool', def: true},
  {id: 'allowedHosts', key: 'ALLOWED_HOSTS', kind: 'hosts', def: []}
];

function lstat(p) { try { return fs.lstatSync(p); } catch (e) { return null; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

function MacSettings(opts) {
  this.o = opts;
}

/* ---------- music folders ---------- */

/* -> [{rel, slot, target, link, missing}]: the three places and the links inside them */
MacSettings.prototype.music = function() {
  var root = this.o.musicRoot, out = [];
  SLOTS.forEach(function(s){
    var p = path.join(root, s), st = lstat(p);
    if (!st) return;
    if (st.isSymbolicLink()) {
      var t = fs.readlinkSync(p);
      out.push({rel: s, slot: s, target: path.resolve(root, t), link: true, missing: !isDir(p)});
      return;
    }
    if (!st.isDirectory()) return;
    var inner = [];
    try { inner = fs.readdirSync(p); } catch (e) { /* not readable */ }
    var links = inner.filter(function(n){ var x = lstat(path.join(p, n)); return x && x.isSymbolicLink(); }).sort();
    links.forEach(function(n){
      var q = path.join(p, n);
      out.push({rel: s + '/' + n, slot: s, target: path.resolve(p, fs.readlinkSync(q)), link: true, missing: !isDir(q)});
    });
    if (inner.length > links.length) out.push({rel: s, slot: s, target: p, link: false, missing: false});   /* real folder with music */
  });
  return out;
};

/* new folder: as the place itself when it is free, else as a link inside it (named after the folder) */
MacSettings.prototype.musicAdd = function(slot, dir) {
  var root = this.o.musicRoot;
  if (SLOTS.indexOf(slot) < 0) return {error: 'slot'};
  dir = String(dir || '').trim().replace(/\/+$/, '');
  if (!dir || dir.charAt(0) !== '/' || dir.indexOf('\0') >= 0 || !isDir(dir)) return {error: 'path'};
  var real = fs.realpathSync(dir), rootReal = isDir(root) ? fs.realpathSync(root) : root;
  if (real === rootReal || rootReal.indexOf(real + '/') === 0 || real.indexOf(rootReal + '/') === 0) return {error: 'inside'};
  if (this.music().some(function(m){ return m.link && m.target === dir; })) return {error: 'exists'};
  try { fs.mkdirSync(root, {recursive: true}); } catch (e) { /* exists */ }
  var p = path.join(root, slot), st = lstat(p);
  if (!st) { fs.symlinkSync(dir, p); return {ok: true, rel: slot}; }
  if (st.isSymbolicLink()) {                               /* the place is one folder already: make it a folder of links */
    var old = fs.readlinkSync(p), oldName = linkName(p, path.basename(old));
    fs.unlinkSync(p);
    fs.mkdirSync(p);
    fs.symlinkSync(old, path.join(p, oldName));
    st = lstat(p);
  }
  if (!st.isDirectory()) return {error: 'slot'};
  var name = linkName(p, path.basename(dir) || 'Musik');
  fs.symlinkSync(dir, path.join(p, name));
  return {ok: true, rel: slot + '/' + name};
};
function linkName(dir, base) {
  base = String(base).replace(/[\/\0]/g, '_') || 'Musik';
  var n = base, i = 2;
  while (lstat(path.join(dir, n))) n = base + ' ' + i++;
  return n;
}

/* remove a folder: only the link, never music */
MacSettings.prototype.musicRemove = function(rel) {
  rel = String(rel || '');
  var parts = rel.split('/');
  if (SLOTS.indexOf(parts[0]) < 0 || parts.length > 2 || parts.some(function(x){ return !x || x === '.' || x === '..'; })) return {error: 'path'};
  var p = path.join(this.o.musicRoot, rel), st = lstat(p);
  if (!st || !st.isSymbolicLink()) return {error: 'notlink'};
  fs.unlinkSync(p);
  return {ok: true};
};

/* ---------- audio analysis (essentia.jsonl) ---------- */

MacSettings.prototype.essentia = function() {
  var f = this.o.essentiaFile, st = lstat(f), out = {exists: false, linked: false, target: '', size: 0, date: ''};
  if (!st) return out;
  if (st.isSymbolicLink()) { out.linked = true; out.target = path.resolve(path.dirname(f), fs.readlinkSync(f)); }
  try { var s = fs.statSync(f); out.exists = true; out.size = s.size; out.date = s.mtime.toISOString(); } catch (e) { /* link to nothing */ }
  return out;
};
/* link to the file the analysis writes: every new analysis counts at once. A copy there before is kept as .bak */
MacSettings.prototype.essentiaLink = function(file) {
  file = String(file || '').trim();
  var f = this.o.essentiaFile;
  if (!file || file.charAt(0) !== '/' || !/\.jsonl$/i.test(file) || !isFile(file)) return {error: 'path'};
  if (fs.realpathSync(file) === (lstat(f) && isFile(f) ? fs.realpathSync(f) : '')) return {ok: true};
  try { fs.mkdirSync(path.dirname(f), {recursive: true}); } catch (e) { /* exists */ }
  var st = lstat(f);
  if (st && st.isSymbolicLink()) fs.unlinkSync(f);
  else if (st) fs.renameSync(f, f + '.bak');
  fs.symlinkSync(file, f);
  return {ok: true};
};

/* ---------- interface settings (config.local.js) ---------- */

function valueOf(f, cfg) {
  var v = cfg[f.key];
  if (f.kind === 'bool') return v === undefined ? f.def : v !== false;
  if (f.kind === 'select') return f.options.indexOf(v) >= 0 ? v : f.def;
  if (f.kind === 'hosts') return Array.isArray(v) ? v.filter(function(h){ return typeof h === 'string'; }).join(', ') : '';
  return v;
}
function check(f, v) {
  if (f.kind === 'bool') return typeof v === 'boolean' ? v : undefined;
  if (f.kind === 'select') return f.options.indexOf(v) >= 0 ? v : undefined;
  if (f.kind === 'hosts') {
    var list = String(v || '').split(/[\s,;]+/).filter(Boolean);
    return list.length <= 20 && list.every(function(h){ return /^[A-Za-z0-9.\-]{1,253}$/.test(h); }) ? list : undefined;
  }
  return undefined;
}
/* cfg: APP_CONFIG as the services read it -> {id: value} */
MacSettings.prototype.settings = function(cfg) {
  var out = {};
  FIELDS.forEach(function(f){ out[f.id] = valueOf(f, cfg || {}); });
  return out;
};
/* own lines of config.local.js: below the marker; in a file not written here, everything except comment lines.
   Single-line settings the page writes itself (and the player line) go: their value is in the page's lines now */
var OWN_DROP = new RegExp('^\\s*window\\.APP_CONFIG\\.(PLAYER|' + FIELDS.map(function(f){ return f.key; }).join('|') + ')\\s*=.*;\\s*$');
function ownPart(text) {
  var i = text.indexOf(MARK), own = i >= 0 ? text.slice(i + MARK.length).replace(/^\n/, '') : text;
  return own.split('\n').filter(function(l){ return !OWN_DROP.test(l) && (i >= 0 || !/^\s*\/\*.*\*\/\s*$/.test(l)); }).join('\n').trim();
}
/* values {id: value} (only those to change) on top of cfg -> writes config.local.js; {error} on an invalid value */
MacSettings.prototype.saveSettings = function(values, cfg) {
  var cur = this.settings(cfg), lines = [], err = null;
  FIELDS.forEach(function(f){
    if (!values || !Object.prototype.hasOwnProperty.call(values, f.id)) return;
    var v = check(f, values[f.id]);
    if (v === undefined) err = err || f.id; else cur[f.id] = f.kind === 'hosts' ? v.join(', ') : v;
  });
  if (err) return {error: 'value', field: err};
  lines.push('/* Xplorio on the Mac: written by the settings page (gear menu); changes above the marker are replaced. */');
  lines.push("window.APP_CONFIG.PLAYER = 'mpd';");
  FIELDS.forEach(function(f){
    var v = f.kind === 'hosts' ? check(f, cur[f.id]) : cur[f.id];
    lines.push('window.APP_CONFIG.' + f.key + ' = ' + JSON.stringify(v) + ';');
  });
  var file = this.o.configFile, real = file;
  try { real = fs.realpathSync(file); } catch (e) { /* not there yet */ }
  var own = ownPart(readText(real));
  var text = lines.join('\n') + '\n' + MARK + '\n' + (own ? own.replace(/\n*$/, '\n') : '');
  fs.writeFileSync(real + '.neu', text);
  fs.renameSync(real + '.neu', real);                       /* the real file: a link to it stays a link */
  return {ok: true, settings: cur};
};

/* ---------- everything for the page ---------- */

MacSettings.prototype.read = function(cfg) {
  var k = this.o.keys.lastfm();
  var es = this.essentia();
  if (this.o.essentiaStatus) { try { es.tracks = this.o.essentiaStatus().tracks || 0; } catch (e) { es.tracks = 0; } }
  return {ok: true, mac: process.platform === 'darwin', musicRoot: this.o.musicRoot, music: this.music(), essentia: es,
          lastfm: {key: !!k.key, secret: !!k.secret}, settings: this.settings(cfg)};
};

/* POST body {action, …} -> cb(code, answer). cfg: current APP_CONFIG */
MacSettings.prototype.command = function(body, cfg, cb) {
  var self = this, a = String((body && body.action) || ''), r;
  function done(res) { cb(200, res.error ? {ok: false, error: res.error, field: res.field} : (function(){ var o = self.read(cfg); o.done = a; return o; })()); }
  try {
    if (a === 'musicAdd' || a === 'musicRemove') {
      r = a === 'musicAdd' ? this.musicAdd(body.slot, body.path) : this.musicRemove(body.rel);
      if (!r.error && this.o.scan) this.o.scan(function(){});
      return done(r);
    }
    if (a === 'essentiaLink') return done(this.essentiaLink(body.path));
    if (a === 'settings') {
      r = this.saveSettings(body.settings || {}, cfg);
      if (r.error) return done(r);
      return cb(200, {ok: true, done: a, settings: r.settings, reload: true});
    }
    if (a === 'lastfm') {
      var key = String(body.key || '').trim(), secret = String(body.secret || '').trim();
      if (!body.clear && (!/^[A-Za-z0-9]{1,64}$/.test(key) || !/^[A-Za-z0-9]{0,64}$/.test(secret))) return done({error: 'lastfm'});
      var cur = this.o.keys.read(), k = {};
      Object.keys(cur).forEach(function(n){ k[n] = cur[n]; });
      if (body.clear) { delete k.LASTFM_KEY; delete k.LASTFM_SECRET; }
      else { k.LASTFM_KEY = key; if (secret) k.LASTFM_SECRET = secret; }
      this.o.keys.write(k);
      return done({ok: true});
    }
    if (a === 'choose') {
      if (!this.o.choose || process.platform !== 'darwin') return cb(200, {ok: false, error: 'nochooser'});
      return this.o.choose(body.kind === 'file' ? 'file' : 'folder', function(err, p){
        cb(200, err || !p ? {ok: false, error: 'cancel'} : {ok: true, path: p});
      });
    }
  } catch (e) {
    return cb(200, {ok: false, error: 'fs', detail: e.message});
  }
  cb(400, {ok: false, error: 'unknown action'});
};

module.exports = {MacSettings: MacSettings, FIELDS: FIELDS, SLOTS: SLOTS, MARK: MARK, ownPart: ownPart};
