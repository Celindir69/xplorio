/* Services for the "System" page on the Mac (PLAYER 'mpd', Xplorio.app): the same answers as services.js, without
   systemctl. MPD, tag service, web server and (when it is switched on) the Rotel bridge, each with "restart".
   Restarting: MPD as after an audio device scan (mpdRestart); web server: stopped here, then the program's own start
   script (xplorio-services.sh start) starts what is missing, as when Xplorio opens. The tag service restarting itself: answer first, then leave; the script started
   beforehand (it waits a moment) brings it back. No restart or power-off of the Mac.
   Node 8, ES5 only.
   opts: ping(port, cb(ok)), mpdPort, webPort, tagsStarted (ms), runDir (pid files of the start script),
         script (xplorio-services.sh), mpdRestart(cb(err)), rotel: {on(), since(), restart()}, spawn, kill(pid), exit(), psStart(pid, cb(ms)) */
var fs = require('fs'), cp = require('child_process'), net = require('net');

function tcpPing(port, cb) {
  var done = false, s = net.createConnection({host: '127.0.0.1', port: port});
  function end(ok) { if (done) return; done = true; s.destroy(); cb(ok); }
  s.setTimeout(1500, function(){ end(false); });
  s.on('connect', function(){ end(true); });
  s.on('error', function(){ end(false); });
}
/* ps etime "[[dd-]hh:]mm:ss" -> seconds */
function etimeSeconds(t) {
  var m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(String(t || ''));
  return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3]) * 60 + (+m[4])) : NaN;
}
function defaultPsStart(pid, cb) {
  cp.execFile('ps', ['-p', String(pid), '-o', 'etime='], {timeout: 4000}, function(e, out){
    var s = etimeSeconds(out);
    cb(e || !isFinite(s) ? null : Date.now() - s * 1000);
  });
}

function MacServices(o) {
  this.o = o;
  this.ping = o.ping || tcpPing;
  this.psStart = o.psStart || defaultPsStart;
}

MacServices.prototype.pidOf = function(name) {
  try { var p = parseInt(fs.readFileSync(this.o.runDir + '/' + name + '.pid', 'utf8'), 10); return p > 1 ? p : 0; } catch (e) { return 0; }
};

/* {ok, units: [{id, active, sub, since, actions}], sudo: true, mac: true} */
MacServices.prototype.status = function(cb) {
  var self = this, o = this.o, units = [];
  function unit(id, on, since) { return {id: id, active: on ? 'active' : 'inactive', sub: on ? 'running' : 'dead', since: on ? since : null, actions: ['restart']}; }
  function started(name, on, next) {
    var pid = on && self.pidOf(name);
    if (!pid) return next(null);
    self.psStart(pid, next);
  }
  this.ping(o.mpdPort, function(mpdOn){
    started('mpd', mpdOn, function(mpdSince){
      units.push(unit('mpd', mpdOn, mpdSince));
      units.push(unit('xplorio-tags', true, o.tagsStarted));
      self.ping(o.webPort, function(webOn){
        started('web', webOn, function(webSince){
          units.push(unit('xplorio-web', webOn, webSince));
          if (o.rotel && o.rotel.on()) units.push(unit('xplorio-rotel', !!o.rotel.since(), o.rotel.since()));
          cb({ok: true, units: units, sudo: true, mac: true});
        });
      });
    });
  });
};

/* the start script, detached, after a moment (so whatever is stopping has let go of its port) */
MacServices.prototype.startScript = function(delay) {
  var spawn = this.o.spawn || cp.spawn;
  var ch = spawn('/bin/bash', ['-c', 'sleep ' + (delay || 1) + '; exec /bin/bash "$0" start', this.o.script], {detached: true, stdio: 'ignore'});
  if (ch && ch.unref) ch.unref();
};

/* cb(code, obj) like services.js act */
MacServices.prototype.act = function(id, action, selfId, cb) {
  var o = this.o;
  if (action !== 'restart' || ['mpd', 'xplorio-tags', 'xplorio-web', 'xplorio-rotel'].indexOf(id) < 0) return cb(400, {ok: false, error: 'not allowed'});
  if (id === 'xplorio-rotel') {
    if (!o.rotel || !o.rotel.on()) return cb(400, {ok: false, error: 'not allowed'});
    o.rotel.restart();
    return cb(200, {ok: true});
  }
  if (id === 'mpd') return o.mpdRestart(function(e){ cb(200, e ? {ok: false, error: 'mpd'} : {ok: true}); });   /* answers once it is back */
  if (!o.script || !fs.existsSync(o.script)) return cb(200, {ok: false, error: 'nosudo'});
  if (id === 'xplorio-tags') {
    cb(200, {ok: true, self: true});
    this.startScript(2);
    return setTimeout(function(){ (o.exit || process.exit)(0); }, 300);
  }
  if (id === 'xplorio-web') {
    var pid = this.pidOf('web');
    if (pid) { try { (o.kill || process.kill)(pid); } catch (e) { /* already gone */ } }
    this.startScript(1);
    return cb(200, {ok: true});
  }
};

module.exports = {MacServices: MacServices, etimeSeconds: etimeSeconds};
