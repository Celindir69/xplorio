/* Last.fm: connect (authorization in the browser), scrobble, "now playing" and import the existing history.
   Needs LASTFM_KEY and LASTFM_SECRET (keys.json in the data folder, see appdata.js). The session key stays on the player
   (lastfm.json next to the history) and never goes to the browser. Node 8, ES5 only. */
var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');
var http   = require('http');
var https  = require('https');
var url    = require('url');
var qs     = require('querystring');

var API  = process.env.LASTFM_URL      || 'https://ws.audioscrobbler.com';
var AUTH = process.env.LASTFM_AUTH_URL || 'https://www.last.fm/api/auth/';
var UA   = 'Xplorio/1.0 ( https://github.com/Celindir69/xplorio )';
var BATCH = 50;                       /* scrobbles per request (Last.fm maximum) */
var RETRY = 10 * 60 * 1000;           /* resend the queue */
var PAGE_PAUSE = 300;                 /* ms between pages when importing (Last.fm allows ~5 requests/s) */
var MAX_AGE = 14 * 86400;             /* Last.fm no longer accepts older scrobbles */

function sign(params, secret) {
  var s = Object.keys(params).filter(function(k){ return k !== 'format' && k !== 'callback'; }).sort()
    .map(function(k){ return k + params[k]; }).join('');
  return crypto.createHash('md5').update(s + secret, 'utf8').digest('hex');
}

/* cfg {key, secret}; signed: with api_sig; post: as a form; cb(err, json) */
var MAX_RESPONSE = 5 * 1024 * 1024;        /* one page of 200 plays is about 100 kB */
function call(cfg, method, params, signed, post, cb) {
  var p = {method: method, api_key: cfg.key};
  Object.keys(params).forEach(function(k){ if (params[k] !== undefined && params[k] !== '') p[k] = String(params[k]); });
  if (signed) p.api_sig = sign(p, cfg.secret);
  p.format = 'json';
  var body = qs.stringify(p), u = url.parse(API + '/2.0/' + (post ? '' : '?' + body));
  var done = false;
  function finish(e, j) { if (!done) { done = true; cb(e, j); } }
  var req = (u.protocol === 'https:' ? https : http).request({
    method: post ? 'POST' : 'GET', protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path,
    headers: post ? {'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body)}
                  : {'User-Agent': UA}
  }, function(res){
    var parts = [], size = 0;
    res.on('data', function(d){
      size += d.length; parts.push(d);
      if (size > MAX_RESPONSE) { req.abort(); finish({code: 0, message: 'response too large'}); }
    });
    res.on('end', function(){
      var j;
      try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { return finish({code: 0, message: 'HTTP ' + res.statusCode}); }
      if (j && j.error) return finish({code: j.error, message: j.message || ('error ' + j.error)});
      if (res.statusCode !== 200) return finish({code: 0, message: 'HTTP ' + res.statusCode});
      finish(null, j);
    });
  });
  req.setTimeout(20000, function(){ req.abort(); finish({code: 0, message: 'timeout'}); });
  req.on('error', function(e){ finish({code: 0, message: e.message}); });
  if (post) req.write(body);
  req.end();
}

function arr(x) { return Array.isArray(x) ? x : (x ? [x] : []); }
function text(x) { return x && typeof x === 'object' ? (x['#text'] || x.name || '') : (x || ''); }

/* one page of user.getRecentTracks -> {tracks:[history entries], pages} */
function recentPage(cfg, user, page, from, to, cb) {
  call(cfg, 'user.getrecenttracks', {user: user, limit: 200, page: page, from: from || undefined, to: to || undefined}, false, false, function(e, j){
    if (e) return cb(e);
    var r = j.recenttracks || {}, attr = r['@attr'] || {};
    var tracks = arr(r.track).filter(function(t){ return t && t.date && t.date.uts && !(t['@attr'] && t['@attr'].nowplaying); })
      .map(function(t){
        var e = {t: parseInt(t.date.uts, 10), ar: text(t.artist), ti: t.name || '', s: 'lastfm'};
        if (text(t.album)) e.al = text(t.album);
        return e;
      }).filter(function(e){ return e.t && e.ar && e.ti; });
    cb(null, {tracks: tracks, pages: parseInt(attr.totalPages, 10) || 1, total: parseInt(attr.total, 10) || 0});
  });
}

/* ---------- sync with the history ---------- */

/* store: plays.Store; file: lastfm.json; getCfg(): {key, secret} */
function Sync(file, store, getCfg) {
  this.file = file; this.store = store; this.getCfg = getCfg;
  this.state = {};
  try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { /* not connected yet */ }
  if (!Array.isArray(this.state.queue)) this.state.queue = [];
  this.importRun = null; this.importError = null; this.sendError = null;
  this.sending = false; this.timer = null; this.token = null;
}

Sync.prototype.save = function() {
  try { fs.mkdirSync(path.dirname(this.file)); } catch (e) { /* already exists */ }
  try { fs.writeFileSync(this.file + '.neu', JSON.stringify(this.state)); fs.renameSync(this.file + '.neu', this.file); } catch (e) { /* next time */ }
};
Sync.prototype.cfg = function() { var c = this.getCfg() || {}; return {key: c.key || '', secret: c.secret || ''}; };
Sync.prototype.connected = function() { return !!this.state.sk; };

Sync.prototype.status = function() {
  var c = this.cfg();
  return {configured: !!(c.key && c.secret), hasKey: !!c.key, user: this.state.user || null, connected: this.connected(),
          waiting: !!this.token, queue: this.state.queue.length, sendError: this.sendError,
          importedTo: this.state.importedTo || null, lastImport: this.state.lastImport || null, importing: this.importRun, importError: this.importError};
};

/* step 1: get the authorization URL; the user confirms it at Last.fm */
Sync.prototype.connect = function(cb) {
  var self = this, c = this.cfg();
  if (!c.key || !c.secret) return cb('LASTFM_KEY and LASTFM_SECRET missing (keys.json in the data folder)');
  call(c, 'auth.gettoken', {}, true, false, function(e, j){
    if (e || !j.token) return cb('Last.fm: ' + (e ? e.message : 'no token'));
    self.token = j.token;
    cb(null, AUTH + '?api_key=' + encodeURIComponent(c.key) + '&token=' + encodeURIComponent(j.token));
  });
};

/* step 2: after authorization fetch the session key */
Sync.prototype.finish = function(cb) {
  var self = this, c = this.cfg();
  if (!this.token) return cb('Tap “Connect to Last.fm” first');
  call(c, 'auth.getsession', {token: this.token}, true, false, function(e, j){
    if (e) return cb(e.code === 14 ? 'Not authorized yet. Please tap “Allow” on Last.fm and try again.' : 'Last.fm: ' + e.message);
    var s = j.session || {};
    if (!s.key) return cb('Last.fm: no session');
    self.token = null;
    self.state.sk = s.key; self.state.user = s.name || '';
    self.sendError = null;
    self.save();
    cb(null);
  });
};

Sync.prototype.disconnect = function() {
  this.state = {queue: [], importedTo: this.state.importedTo};
  this.token = null; this.sendError = null;
  this.save();
};

/* new play: into the queue and send */
Sync.prototype.played = function(entry) {
  if (!this.connected()) return;
  this.state.queue.push(entry);
  this.save();
  this.flush();
};

Sync.prototype.nowPlaying = function(entry) {
  if (!this.connected()) return;
  var p = {artist: entry.ar, track: entry.ti, album: entry.al, duration: entry.d || undefined, sk: this.state.sk};
  call(this.cfg(), 'track.updatenowplaying', p, true, true, function(){});
};

Sync.prototype.flush = function() {
  var self = this;
  clearTimeout(this.timer); this.timer = null;
  if (this.sending || !this.connected()) return;
  var now = Date.now() / 1000;
  this.state.queue = this.state.queue.filter(function(e){ return now - e.t < MAX_AGE; });
  if (!this.state.queue.length) return;
  var part = this.state.queue.slice(0, BATCH), p = {sk: this.state.sk};
  part.forEach(function(e, i){
    p['artist[' + i + ']'] = e.ar; p['track[' + i + ']'] = e.ti; p['timestamp[' + i + ']'] = e.t;
    if (e.al) p['album[' + i + ']'] = e.al;
    if (e.d) p['duration[' + i + ']'] = e.d;
  });
  this.sending = true;
  call(this.cfg(), 'track.scrobble', p, true, true, function(e){
    self.sending = false;
    if (e) {
      self.sendError = e.message;
      if (e.code === 9) { self.state.sk = null; self.save(); return; }       /* session invalid: reconnect */
      if (e.code === 13 || e.code === 6) { self.state.queue = self.state.queue.slice(part.length); self.save(); }   /* bad request: discard */
      self.timer = setTimeout(function(){ self.flush(); }, RETRY);
      return;
    }
    self.sendError = null;
    self.state.queue = self.state.queue.slice(part.length);   /* accepted or ignored by Last.fm: done */
    self.save();
    if (self.state.queue.length) self.flush();
  });
};

/* import the history from Last.fm; everything the first time, afterwards only what is new since the last import */
Sync.prototype.importAll = function() {
  var self = this, c = this.cfg(), user = this.state.user;
  if (this.importRun || !c.key || !user) return;
  var from = this.state.importedTo ? this.state.importedTo - 3600 : 0, started = Math.floor(Date.now() / 1000);
  var run = this.importRun = {page: 0, pages: 0, added: 0, started: started};
  this.importError = null;
  var maxT = this.state.importedTo || 0;
  (function step(page) {
    recentPage(c, user, page, from, started, function(e, r){   /* up to the start: pages don't shift */
      if (e) {
        if (e.code === 29 && run.retries !== 3) { run.retries = (run.retries || 0) + 1; return setTimeout(function(){ step(page); }, 5000); }   /* too many requests */
        self.importError = e.message; self.importRun = null; return;
      }
      run.retries = 0;
      run.page = page; run.pages = r.pages;
      var fresh = self.store.fresh(r.tracks);
      self.store.add(fresh);
      run.added += fresh.length;
      r.tracks.forEach(function(t){ if (t.t > maxT) maxT = t.t; });
      if (self.store.full && self.store.full()) run.full = true;   /* pages go back in time: everything older would be dropped */
      if (page < r.pages && r.tracks.length && !run.full) return setTimeout(function(){ step(page + 1); }, PAGE_PAUSE);
      self.state.importedTo = Math.max(maxT, from ? from : 0) || started;
      self.state.lastImport = {at: started, added: run.added};
      if (run.full) self.state.lastImport.full = true;
      self.save();
      self.importRun = null;
    });
  })(1);
};

module.exports = {Sync: Sync, sign: sign, call: call, recentPage: recentPage};
