/* System info for the "System" page in the gear menu: CPU load (live and 24 h), memory, temperature,
   drive usage (internal card, USB, each NAS connection), uptime and version.
   Reads only /proc, /sys and df; samples every 2 s (one small file), aggregates per minute and keeps 24 h in
   memory (saved to sysinfo.json every 10 min so a service restart does not erase the history).
   Node 8, ES5 only. root: prefix for /proc etc. (tests) */
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');

var SAMPLE_MS = 2000, MINUTE_MS = 60000, KEEP_MS = 24 * 3600000, LIVE_N = 90, SAVE_MS = 600000;
var DF_TIMEOUT = 4000, DISK_CACHE_MS = 30000;

/* /proc/stat -> {busy, total} overall and per core */
function parseStat(text) {
  var out = {all: null, cores: []};
  String(text || '').split('\n').forEach(function(l){
    var m = /^cpu(\d*)\s+(.*)$/.exec(l);
    if (!m) return;
    var v = m[2].trim().split(/\s+/).map(Number), total = 0;
    v.forEach(function(x){ total += x || 0; });
    var idle = (v[3] || 0) + (v[4] || 0);                   /* idle + iowait */
    var r = {busy: total - idle, total: total};
    if (m[1] === '') out.all = r; else out.cores.push(r);
  });
  return out;
}
/* load in percent between two samples */
function pct(a, b) {
  if (!a || !b) return null;
  var dt = b.total - a.total;
  return dt > 0 ? Math.max(0, Math.min(100, Math.round((b.busy - a.busy) / dt * 1000) / 10)) : null;
}

/* /proc/meminfo -> kB */
function parseMeminfo(text) {
  var o = {};
  String(text || '').split('\n').forEach(function(l){
    var m = /^(\w+):\s+(\d+)/.exec(l);
    if (m) o[m[1]] = +m[2];
  });
  var avail = o.MemAvailable !== undefined ? o.MemAvailable : (o.MemFree || 0) + (o.Buffers || 0) + (o.Cached || 0);
  return {total: o.MemTotal || 0, avail: avail, swapTotal: o.SwapTotal || 0, swapFree: o.SwapFree || 0};
}

/* /proc/mounts -> drives that appear on the page: each real partition (/dev/…) and each
   network connection. Depending on the version, Volumio mounts USB under /media/… or /mnt/USB/…, the internal card
   under /data (Volumio 2 also under /mnt/ext or similar). A device appears only once, under the
   most meaningful path; boot and image partitions (/boot, /imgpart, /static) are left out.
   kind: card (internal card/system drive), usb, net */
var NET_FS = /^(cifs|smb3|smbfs|nfs|nfs4|fuse\.sshfs)$/;
var SKIP_FS = /^(tmpfs|devtmpfs|proc|sysfs|devpts|cgroup2?|squashfs|overlay|autofs|debugfs|securityfs|pstore|mqueue|configfs|fusectl|binfmt_misc|rpc_pipefs|iso9660)$/;
var SKIP_MOUNT = /^\/(boot|imgpart|static|run|proc|sys|dev)(\/|$)/;
function mountRank(m) {
  if (m === '/data') return 0;
  if (/^\/(mnt|media)\/./.test(m) && !/^\/mnt\/INTERNAL(\/|$)/.test(m)) return 1;
  if (m === '/') return 3;
  return 2;
}
function parseMounts(text) {
  var byDev = {}, out = [], rootLine = false;
  String(text || '').split('\n').forEach(function(l){
    var p = l.split(' ');
    if (p.length < 3) return;
    var dev = p[0].replace(/\\040/g, ' '), mount = p[1].replace(/\\040/g, ' '), type = p[2];
    if (mount === '/') rootLine = true;
    if (SKIP_FS.test(type) || SKIP_MOUNT.test(mount)) return;
    var net = NET_FS.test(type);
    if (!net && dev.indexOf('/dev/') !== 0) return;
    if (!net && /^\/dev\/(loop|ram|zram)/.test(dev)) return;
    var kind = net ? 'net' : /^\/dev\/(sd|usb)/.test(dev) && mount !== '/' && mount !== '/data' ? 'usb' : 'card';
    var d = {mount: mount, type: type, net: net, kind: kind};
    if (net) return out.push(d);
    var have = byDev[dev];
    if (have) { if (mountRank(mount) < mountRank(have.mount)) { have.mount = mount; have.type = type; have.kind = kind; } return; }
    byDev[dev] = d;
    out.push(d);
  });
  /* data partition not visibly mounted (only as overlay under /): df on / shows its usage */
  if (rootLine && !out.some(function(d){ return d.kind === 'card'; })) out.push({mount: '/', type: 'overlay', net: false, kind: 'card'});
  /* internal card first, then USB, then network; otherwise in /proc/mounts order */
  var order = {card: 0, usb: 1, net: 2};
  return out.map(function(d, i){ return [d, i]; })
    .sort(function(a, b){ return order[a[0].kind] - order[b[0].kind] || a[1] - b[1]; })
    .map(function(x){ return x[0]; });
}

/* output of df -kP for one path -> kB */
function parseDf(text) {
  var l = String(text || '').trim().split('\n')[1];
  if (!l) return null;
  var p = l.trim().split(/\s+/);
  if (p.length < 6) return null;
  return {size: +p[1], used: +p[2], avail: +p[3]};
}

/* /etc/os-release -> {VOLUMIO_VERSION, PRETTY_NAME, …} */
function parseOsRelease(text) {
  var o = {};
  String(text || '').split('\n').forEach(function(l){
    var m = /^([A-Z_]+)=("?)(.*)\2$/.exec(l.trim());
    if (m) o[m[1]] = m[3];
  });
  return o;
}

function Sysinfo(opts) {
  opts = opts || {};
  this.root = opts.root || '';
  this.file = opts.file || '';
  this.df = opts.df || dfRun;
  this.prev = null;                  /* last /proc/stat sample */
  this.minA = null;                  /* sample at the start of the current minute */
  this.minStart = 0;
  this.cpu = null; this.cores = [];
  this.live = [];                    /* [time, load] of the last 3 min */
  this.hist = [];                    /* [time, load, memory %, temperature] per minute */
  this.disks = null; this.disksAt = 0; this.disksWait = null;
  this.timers = [];
  this.load();
}

Sysinfo.prototype.read = function(p) {
  try { return fs.readFileSync(this.root + p, 'utf8'); } catch (e) { return ''; }
};

Sysinfo.prototype.temp = function() {
  var t = parseInt(this.read('/sys/class/thermal/thermal_zone0/temp'), 10);
  return isFinite(t) ? Math.round(t / 100) / 10 : null;
};

Sysinfo.prototype.mem = function() { return parseMeminfo(this.read('/proc/meminfo')); };

/* one sample (every 2 s); now for tests */
Sysinfo.prototype.sample = function(now) {
  now = now || Date.now();
  var s = parseStat(this.read('/proc/stat'));
  if (!s.all) return;
  if (this.prev) {
    this.cpu = pct(this.prev.all, s.all);
    var prev = this.prev;
    this.cores = s.cores.map(function(c, i){ return pct(prev.cores[i], c); });
    if (this.cpu !== null) {
      this.live.push([now, this.cpu]);
      if (this.live.length > LIVE_N) this.live.splice(0, this.live.length - LIVE_N);
    }
  }
  this.prev = s;
  if (!this.minA) { this.minA = s.all; this.minStart = now; }
  if (now - this.minStart >= MINUTE_MS) {
    var m = this.mem(), memPct = m.total ? Math.round((m.total - m.avail) / m.total * 1000) / 10 : null;
    this.hist.push([Math.round(now / 1000) * 1000, pct(this.minA, s.all), memPct, this.temp()]);
    this.minA = s.all; this.minStart = now;
    this.trim(now);
  }
};

Sysinfo.prototype.trim = function(now) {
  var cut = (now || Date.now()) - KEEP_MS, i = 0;
  while (i < this.hist.length && this.hist[i][0] < cut) i++;
  if (i) this.hist.splice(0, i);
};

Sysinfo.prototype.load = function() {
  if (!this.file) return;
  try {
    var j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (Array.isArray(j.hist)) this.hist = j.hist.filter(function(r){ return Array.isArray(r) && r.length >= 4; });
    this.trim();
  } catch (e) { /* no history yet */ }
};
Sysinfo.prototype.save = function() {
  if (!this.file) return;
  var tmp = this.file + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify({hist: this.hist})); fs.renameSync(tmp, this.file); } catch (e) { /* next time */ }
};

Sysinfo.prototype.start = function() {
  var self = this;
  this.sample();
  this.timers.push(setInterval(function(){ self.sample(); }, SAMPLE_MS));
  this.timers.push(setInterval(function(){ self.save(); }, SAVE_MS));
  this.timers.forEach(function(t){ if (t.unref) t.unref(); });
};
Sysinfo.prototype.stop = function() {
  this.timers.forEach(clearInterval); this.timers = [];
  this.save();
};

/* df per drive separately and with a time limit: so a hanging NAS connection does not block the others */
function dfRun(mount, cb) {
  var done = false, out = '';
  var child;
  try { child = cp.spawn('df', ['-kP', '--', mount]); } catch (e) { return cb(null); }
  var timer = setTimeout(function(){ if (!done) { done = true; try { child.kill('SIGKILL'); } catch (e) { /* gone */ } cb(null); } }, DF_TIMEOUT);
  child.stdout.on('data', function(d){ out += d; });
  child.on('error', function(){ if (!done) { done = true; clearTimeout(timer); cb(null); } });
  child.on('close', function(){ if (!done) { done = true; clearTimeout(timer); cb(parseDf(out)); } });
}

Sysinfo.prototype.diskList = function(cb) {
  var self = this;
  if (this.disks && Date.now() - this.disksAt < DISK_CACHE_MS) return cb(this.disks);
  if (this.disksWait) return this.disksWait.push(cb);
  this.disksWait = [cb];
  var list = parseMounts(this.read('/proc/mounts')), left = list.length, res = [];
  function fin() {
    self.disks = res.filter(Boolean); self.disksAt = Date.now();
    var w = self.disksWait; self.disksWait = null;
    w.forEach(function(f){ f(self.disks); });
  }
  if (!left) return fin();
  list.forEach(function(d, i){
    self.df(d.mount, function(r){
      res[i] = {mount: d.mount, type: d.type, net: d.net, kind: d.kind, ok: !!r, size: r ? r.size : 0, used: r ? r.used : 0, avail: r ? r.avail : 0};
      if (--left === 0) fin();
    });
  });
};

/* response for GET /sysinfo; full: with history, drives and static details */
Sysinfo.prototype.report = function(full, cb) {
  var self = this, up = parseFloat(this.read('/proc/uptime'));
  var r = {ok: true, now: Date.now(), cpu: this.cpu, cores: this.cores, live: this.live, load: os.loadavg().map(function(x){ return Math.round(x * 100) / 100; }),
           mem: this.mem(), temp: this.temp(), uptime: isFinite(up) ? Math.round(up) : null};
  if (!full) return cb(r);
  var osr = parseOsRelease(this.read('/etc/os-release')), cpus = os.cpus() || [];
  r.hist = this.hist;
  r.sys = {host: os.hostname(), kernel: os.release(), arch: os.arch(), node: process.version,
           volumio: osr.VOLUMIO_VERSION || '', hardware: osr.VOLUMIO_HARDWARE || '', os: osr.PRETTY_NAME || '',
           cpuModel: cpus[0] ? String(cpus[0].model || '').trim() : '', cpuCount: cpus.length};
  this.diskList(function(d){ r.disks = d; cb(r); });
};

module.exports = {Sysinfo: Sysinfo, parseStat: parseStat, pct: pct, parseMeminfo: parseMeminfo, parseMounts: parseMounts,
                  parseDf: parseDf, parseOsRelease: parseOsRelease};
