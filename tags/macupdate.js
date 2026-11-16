/* Updating Xplorio on the Mac from the settings page ("Xplorio aktualisieren"): which version is installed (update.json,
   written by tools/mac/xplorio-update.sh), which one is the newest on GitHub (last commit of the branch), and the update
   itself: the script runs on its own (detached), quits Xplorio, builds the app again and starts it.
   Node 8, ES5 only.
   opts: repo ("owner/name"), branch() -> branch, stateFile (update.json), script (xplorio-update.sh in the app),
         logFile, env (extra environment for the script), spawn, get(url, cb(err, json)), now(), tmpDir */
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), https = require('https');

var CHECK_MS = 10 * 60 * 1000;

function httpsJson(url, cb) {
  var done = false;
  function end(e, v) { if (!done) { done = true; cb(e, v); } }
  var req = https.get(url, {headers: {'User-Agent': 'Xplorio', Accept: 'application/vnd.github+json'}}, function(res){
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function(d){ data += d; if (data.length > 2000000) req.abort(); });
    res.on('end', function(){
      if (res.statusCode !== 200) return end(new Error('HTTP ' + res.statusCode));
      try { end(null, JSON.parse(data)); } catch (e) { end(e); }
    });
  });
  req.on('error', function(e){ end(e); });
  req.setTimeout(15000, function(){ req.abort(); end(new Error('timeout')); });
}

function Updater(o) {
  this.o = o;
  this.now = o.now || Date.now;
  this.get = o.get || httpsJson;
  this.spawn = o.spawn || cp.spawn;
  this.cache = null;          /* {at, branch, latest} */
  this.started = 0;
}
Updater.prototype.branch = function() { return (this.o.branch && this.o.branch()) || this.installed().branch || 'main'; };

/* update.json: {sha, branch, at, ok, error} */
Updater.prototype.installed = function() {
  try { var d = JSON.parse(fs.readFileSync(this.o.stateFile, 'utf8')); return d && typeof d === 'object' ? d : {}; }
  catch (e) { return {}; }
};

/* the last commit of the branch on GitHub -> cb({sha, date, message} or {error}) */
Updater.prototype.latest = function(force, cb) {
  var self = this, br = this.branch(), c = this.cache;
  if (!force && c && c.branch === br && this.now() - c.at < CHECK_MS) return cb(c.latest);
  var url = 'https://api.github.com/repos/' + this.o.repo + '/commits/' + encodeURIComponent(br);
  this.get(url, function(e, j){
    var l = e || !j || !j.sha ? {error: 'net'}
      : {sha: String(j.sha), date: j.commit && j.commit.committer && j.commit.committer.date || '',
         message: String(j.commit && j.commit.message || '').split('\n')[0].slice(0, 200)};
    self.cache = {at: self.now(), branch: br, latest: l};
    cb(l);
  });
};

Updater.prototype.status = function(force, cb) {
  var self = this;
  this.latest(force, function(l){
    var inst = self.installed();
    var running = !!self.started && self.now() - self.started < 15 * 60 * 1000;
    cb({ok: true, branch: self.branch(), installed: inst, latest: l, running: running, script: fs.existsSync(self.o.script),
        newer: !!l.sha && l.sha !== inst.sha, log: inst.ok === false ? self.tail() : []});
  });
};

/* the end of the last update's log (shown when it failed) */
Updater.prototype.tail = function() {
  try {
    var t = fs.readFileSync(this.o.logFile, 'utf8');
    return t.split(/\r?\n|\r/).map(function(l){ return l.trim(); }).filter(Boolean).slice(-8);
  } catch (e) { return []; }
};

/* starts the script on its own: it outlives the tag service, which ends when Xplorio quits -> cb(error code or null) */
Updater.prototype.install = function(cb) {
  if (this.started && this.now() - this.started < 15 * 60 * 1000) return cb('running');
  if (!fs.existsSync(this.o.script)) return cb('script');
  var tmp = path.join(this.o.tmpDir || os.tmpdir(), 'xplorio-update-' + process.pid + '.sh'), fd;
  try {
    fs.writeFileSync(tmp, fs.readFileSync(this.o.script));   /* a copy: the build replaces the app the script is in */
    fs.mkdirSync(path.dirname(this.o.logFile));
  } catch (e) { if (e.code !== 'EEXIST') return cb('fs'); }
  try { fd = fs.openSync(this.o.logFile, 'w'); } catch (e) { return cb('fs'); }
  var env = {};
  Object.keys(process.env).forEach(function(k){ env[k] = process.env[k]; });
  Object.keys(this.o.env || {}).forEach(function(k){ env[k] = this.o.env[k]; }, this);
  env.XPLORIO_UPDATE_STATE = this.o.stateFile;
  try {
    var ch = this.spawn('/bin/bash', [tmp, this.branch()], {detached: true, stdio: ['ignore', fd, fd], env: env});
    if (ch.unref) ch.unref();
  } catch (e) { try { fs.closeSync(fd); } catch (e2) { /* closed */ } return cb('start'); }
  try { fs.closeSync(fd); } catch (e) { /* the child has its own */ }
  this.started = this.now();
  cb(null);
};

module.exports = {Updater: Updater, httpsJson: httpsJson};
