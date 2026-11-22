/* ListenBrainz: scrobble and "now playing", the free alternative to Last.fm (MetaBrainz, no developer key needed).
   Needs only the user's token from https://listenbrainz.org/settings/ (LISTENBRAINZ_TOKEN in keys.json, see appdata.js).
   The queue survives restarts (listenbrainz.json next to the history); ListenBrainz also takes older plays, so nothing
   is lost while the player is offline. Node 8, ES5 only. */
var fs    = require('fs');
var path  = require('path');
var http  = require('http');
var https = require('https');
var url   = require('url');

var API   = process.env.LISTENBRAINZ_URL || 'https://api.listenbrainz.org';
var UA    = 'Xplorio/1.0 ( https://github.com/Celindir69/xplorio )';
var BATCH = 100;                      /* listens per request (ListenBrainz allows 1000) */
var RETRY = 10 * 60 * 1000;           /* resend the queue */
var QUEUE_MAX = 20000;                /* oldest plays are dropped beyond this */
var CHECK_MS = 6 * 3600 * 1000;       /* check the token again */

/* method, path, token, body (object or null), cb(err {status, message}, json) */
function request(method, p, token, body, cb) {
  var u = url.parse(API + p), data = body ? JSON.stringify(body) : '';
  var headers = {'User-Agent': UA, 'Authorization': 'Token ' + token};
  if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
  var done = false;
  function finish(e, j) { if (!done) { done = true; cb(e, j); } }
  var req = (u.protocol === 'https:' ? https : http).request({method: method, protocol: u.protocol, hostname: u.hostname, port: u.port,
                                                             path: u.path, headers: headers}, function(res){
    var parts = [], size = 0;
    res.on('data', function(d){ size += d.length; if (size < 1024 * 1024) parts.push(d); });
    res.on('end', function(){
      var j = null;
      try { j = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { /* not JSON */ }
      if (res.statusCode !== 200) return finish({status: res.statusCode, message: (j && (j.error || j.message)) || ('HTTP ' + res.statusCode),
                                                 retryIn: parseInt(res.headers['x-ratelimit-reset-in'], 10) || 0});
      finish(null, j || {});
    });
  });
  req.setTimeout(20000, function(){ req.abort(); finish({status: 0, message: 'timeout'}); });
  req.on('error', function(e){ finish({status: 0, message: e.message}); });
  if (body) req.write(data);
  req.end();
}

/* history entry {t, ar, ti, al, d} -> listen */
function listen(e, now) {
  var info = {submission_client: 'Xplorio', media_player: 'Xplorio'};
  if (e.d) info.duration_ms = Math.round(e.d * 1000);
  var md = {artist_name: String(e.ar), track_name: String(e.ti), additional_info: info};
  if (e.al) md.release_name = String(e.al);
  var l = {track_metadata: md};
  if (!now) l.listened_at = Math.floor(e.t);
  return l;
}

/* file: listenbrainz.json; getToken(): token or '' */
function Sync(file, getToken) {
  this.file = file; this.getToken = getToken;
  this.state = {};
  try { this.state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { /* first use */ }
  if (!Array.isArray(this.state.queue)) this.state.queue = [];
  this.sending = false; this.timer = null; this.sendError = null; this.checking = false;
}
Sync.prototype.save = function() {
  try { fs.mkdirSync(path.dirname(this.file)); } catch (e) { /* already exists */ }
  try { fs.writeFileSync(this.file + '.neu', JSON.stringify(this.state)); fs.renameSync(this.file + '.neu', this.file); } catch (e) { /* next time */ }
};
Sync.prototype.token = function() { return String(this.getToken() || '').trim(); };
/* the token as checked last: {user} when valid; a new token is checked first */
Sync.prototype.check = function(cb) {
  var self = this, t = this.token();
  cb = cb || function(){};
  if (!t) return cb(null);
  var c = this.state.checked;
  if (c && c.token === t && Date.now() - c.at < CHECK_MS) return cb(null);
  if (this.checking) return cb(null);
  this.checking = true;
  request('GET', '/1/validate-token', t, null, function(e, j){
    self.checking = false;
    if (e) { self.sendError = e.message; return cb(e); }            /* not reachable: keep the last result */
    self.state.checked = {token: t, at: Date.now(), valid: !!j.valid, user: j.user_name || ''};
    self.save();
    cb(null);
  });
};
Sync.prototype.valid = function() {
  var c = this.state.checked, t = this.token();
  return !!(t && c && c.token === t && c.valid);
};
Sync.prototype.status = function() {
  var t = this.token(), c = this.state.checked;
  var known = !!(t && c && c.token === t);
  return {configured: !!t, valid: known ? c.valid : null, user: known && c.valid ? c.user : null,
          queue: this.state.queue.length, sendError: this.sendError, lastSent: this.state.lastSent || null};
};

Sync.prototype.played = function(entry) {
  if (!this.token()) return;
  this.state.queue.push({t: entry.t, ar: entry.ar, ti: entry.ti, al: entry.al, d: entry.d});
  if (this.state.queue.length > QUEUE_MAX) this.state.queue = this.state.queue.slice(-QUEUE_MAX);
  this.save();
  this.flush();
};
Sync.prototype.nowPlaying = function(entry) {
  var t = this.token();
  if (!t || (this.state.checked && this.state.checked.token === t && !this.state.checked.valid)) return;
  request('POST', '/1/submit-listens', t, {listen_type: 'playing_now', payload: [listen(entry, true)]}, function(){});
};
Sync.prototype.flush = function() {
  var self = this, t = this.token();
  clearTimeout(this.timer); this.timer = null;
  if (this.sending || !t || !this.state.queue.length) return;
  var c = this.state.checked;
  if (c && c.token === t && !c.valid) { this.sendError = 'token invalid'; return; }   /* a new token is needed */
  var part = this.state.queue.slice(0, BATCH);
  this.sending = true;
  request('POST', '/1/submit-listens', t, {listen_type: part.length === 1 ? 'single' : 'import', payload: part.map(function(e){ return listen(e); })}, function(e){
    self.sending = false;
    if (e) {
      self.sendError = e.message;
      if (e.status === 401) { self.state.checked = {token: t, at: Date.now(), valid: false, user: ''}; self.save(); return; }
      if (e.status === 400) { self.state.queue = self.state.queue.slice(part.length); self.save(); }   /* bad listens: discard */
      self.timer = setTimeout(function(){ self.flush(); }, e.status === 429 && e.retryIn ? e.retryIn * 1000 + 1000 : RETRY);
      if (self.timer.unref) self.timer.unref();
      return;
    }
    self.sendError = null;
    self.state.queue = self.state.queue.slice(part.length);
    self.state.lastSent = Math.floor(Date.now() / 1000);
    self.save();
    if (self.state.queue.length) self.timer = setTimeout(function(){ self.flush(); }, 1100);   /* one request per second */
  });
};
/* token removed: forget the queue and the check */
Sync.prototype.clear = function() {
  clearTimeout(this.timer); this.timer = null;
  this.state = {queue: []}; this.sendError = null;
  this.save();
};

module.exports = {Sync: Sync, listen: listen, request: request};
