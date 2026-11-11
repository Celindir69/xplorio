/* Warnings for the "System" page and as a notice in the app: drive errors from the kernel log (USB/SCSI errors, file system
   errors, resets, under-voltage), USB drives that disappeared or hang, memory used over 80 % for 5 minutes, drives over 90 %
   full. Checks once a minute; drive space every 10 minutes (df on a hanging drive can block). Kept in syswarn.json, so a
   warning survives a restart of the service or the player (the journal on Volumio lives in RAM).
   The kernel log comes from dmesg, else from journalctl -k (needs the systemd-journal group, like the logs).
   Node 8, ES5 only. opts: root (prefix for /proc, tests), file, run (replacement for execFile), sys (Sysinfo, for df) */
var fs = require('fs'), cp = require('child_process');
var sysinfo = require('./sysinfo.js');

var CHECK_MS = 60000, SPACE_MS = 600000, KEEP_MS = 24 * 3600000, MAX_ITEMS = 40, MAX_LINES = 4000;
var MEM_WARN = 80, MEM_CLEAR = 75, MEM_MINUTES = 5, SPACE_WARN = 90, SPACE_CLEAR = 88, RESET_MIN = 3;
/* internal card (/data, also /mnt/INTERNAL): small and needed by MPD and Volumio -> earlier, also by free space in kB */
var CARD_WARN = 80, CARD_CLEAR = 78, CARD_MIN_KB = 500 * 1024, CARD_OK_KB = 600 * 1024;

/* kernel lines that point at a drive or its power supply -> class; null: not of interest */
var KERNEL_RULES = [
  {cls: 'power', re: /under-?voltage detected|over-?current/i},
  {cls: 'fs',    re: /(EXT[234]-fs|FAT-fs|exFAT-fs|NTFS|ntfs3?|btrfs|xfs)[^:]*:?.*\b(error|corrupt)/i},
  {cls: 'io',    re: /I\/O error|Buffer I\/O|blk_update_request|critical medium error|Unit Not Ready|Read Capacity|Medium Error|Sense Key ?: ?(Medium|Hardware|Not Ready)|timing out command|uas_eh_abort_handler|task abort|rejecting I\/O|device offline/i},
  {cls: 'reset', re: /reset (high|super|full)-speed USB device|uas_eh_(device|bus)_reset|device descriptor read.*error/i}
];
function classify(msg) {
  for (var i = 0; i < KERNEL_RULES.length; i++) if (KERNEL_RULES[i].re.test(msg)) return KERNEL_RULES[i].cls;
  return null;
}
/* which device: sda / sdb1 -> sda; "usb 1-1.3" -> usb 1-1.3; else '' */
function deviceOf(msg) {
  var m = /\b(sd[a-z]+)\d*\b/.exec(msg) || /\b(mmcblk\d+)/.exec(msg);
  if (m) return m[1];
  m = /\busb (\d+-[\d.]+)/.exec(msg);
  return m ? 'usb ' + m[1] : '';
}
/* "[  123.456789] text" (dmesg, journalctl -o short-monotonic with "host kernel: " in front of the text) -> {t, msg} */
function parseKernel(text) {
  var out = [];
  String(text || '').split('\n').forEach(function(l){
    var m = /^\[\s*(\d+\.\d+)\]\s?(.*)$/.exec(l);
    if (m) out.push({t: parseFloat(m[1]), msg: m[2].replace(/^\S+ kernel: /, '')});
  });
  return out;
}

function defaultRun(file, args, cb) {
  cp.execFile(file, args, {timeout: 8000, maxBuffer: 4 * 1024 * 1024}, function(err, stdout, stderr){
    cb(err, String(stdout || ''), String(stderr || ''));
  });
}

function Warnings(opts) {
  opts = opts || {};
  this.root = opts.root || '';
  this.file = opts.file || '';
  this.run = opts.run || defaultRun;
  this.sys = opts.sys || null;
  this.source = '';                  /* dmesg | journal | none: where the kernel log came from last time */
  this.st = {boot: '', kt: 0, items: [], mounts: {}, mem: []};
  this.spaceAt = 0;
  this.timer = null;
  this.load();
}

Warnings.prototype.read = function(p) {
  try { return fs.readFileSync(this.root + p, 'utf8'); } catch (e) { return ''; }
};
Warnings.prototype.load = function() {
  if (!this.file) return;
  try {
    var j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (j && Array.isArray(j.items)) this.st = {boot: j.boot || '', kt: j.kt || 0, items: j.items, mounts: j.mounts || {}, mem: j.mem || []};
  } catch (e) { /* none yet */ }
};
Warnings.prototype.save = function() {
  if (!this.file) return;
  var tmp = this.file + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(this.st)); fs.renameSync(tmp, this.file); } catch (e) { /* next time */ }
};

/* a warning with this id: new or updated. p: details for the text. active: still true now (memory, space, drive gone) */
Warnings.prototype.raise = function(id, kind, p, now, count) {
  var it = this.find(id);
  if (!it) {
    it = {id: id, kind: kind, first: now, last: now, n: 0, p: p, ok: 0};
    this.st.items.push(it);
    if (this.st.items.length > MAX_ITEMS) this.st.items.splice(0, this.st.items.length - MAX_ITEMS);
  }
  if (it.ok && now > it.ok) { it.first = now; it.n = 0; it.ok = 0; }   /* marked as read before: counts as new */
  it.last = now; it.n += count || 1; it.p = p; it.active = true;
  return it;
};
Warnings.prototype.find = function(id) {
  for (var i = 0; i < this.st.items.length; i++) if (this.st.items[i].id === id) return this.st.items[i];
  return null;
};
Warnings.prototype.settle = function(id) { var it = this.find(id); if (it) it.active = false; };

/* kernel log: only lines after the last one seen in this boot */
Warnings.prototype.kernel = function(now, cb) {
  var self = this, up = parseFloat(this.read('/proc/uptime'));
  var mountOf = {};                                    /* sda -> where it is mounted, for the name on the page */
  this.read('/proc/mounts').split('\n').forEach(function(l){
    var m = /^\/dev\/(sd[a-z]+|mmcblk\d+)\S*\s+(\S+)/.exec(l);
    if (m && (!mountOf[m[1]] || /^\/(media|mnt)\//.test(m[2]))) mountOf[m[1]] = m[2].replace(/\\040/g, ' ');
  });
  function use(lines) {
    var bootAt = isFinite(up) ? now - up * 1000 : now, groups = {};
    lines.slice(-MAX_LINES).forEach(function(l){
      if (l.t <= self.st.kt) return;
      var cls = classify(l.msg);
      if (!cls) return;
      var dev = cls === 'power' ? '' : deviceOf(l.msg), id = 'k:' + cls + ':' + dev;
      var g = groups[id] || (groups[id] = {cls: cls, dev: dev, mount: mountOf[dev] || '', n: 0, at: 0, line: ''});
      g.n++; g.at = Math.round(bootAt + l.t * 1000); g.line = l.msg.slice(0, 300);
    });
    if (lines.length) self.st.kt = Math.max(self.st.kt, lines[lines.length - 1].t);
    Object.keys(groups).forEach(function(id){
      var g = groups[id], old = self.find(id);
      var it = self.raise(id, 'kernel', {cls: g.cls, dev: g.dev, mount: g.mount || (old && old.p.mount) || '', line: g.line}, g.at, g.n);
      it.active = false;                               /* an event, not a state: stays listed for 24 h */
    });
    cb();
  }
  this.run('dmesg', [], function(err, out){
    var lines = parseKernel(out);
    if (!err && lines.length) { self.source = 'dmesg'; return use(lines); }
    self.run('journalctl', ['-k', '-b', '-o', 'short-monotonic', '--no-pager', '-n', String(MAX_LINES)], function(err2, out2){
      var l2 = parseKernel(out2);
      self.source = l2.length ? 'journal' : 'none';
      use(l2);
    });
  });
};

/* USB drives: mounted before and now gone -> warning until mounted again */
Warnings.prototype.mounts = function(now) {
  var self = this, cur = {}, text = this.read('/proc/mounts');
  if (!text) return;                                   /* unreadable: say nothing */
  sysinfo.parseMounts(text).forEach(function(d){ if (d.kind === 'usb') cur[d.mount] = 1; });
  Object.keys(this.st.mounts).forEach(function(m){
    if (!cur[m]) { var it = self.find('gone:' + m); if (!it || !it.active) self.raise('gone:' + m, 'gone', {mount: m}, now); }
  });
  Object.keys(cur).forEach(function(m){ self.settle('gone:' + m); });
  /* remember what is mounted now; a missing one stays remembered while its warning is open */
  var keep = {};
  Object.keys(cur).forEach(function(m){ keep[m] = 1; });
  this.st.items.forEach(function(it){ if (it.kind === 'gone' && it.active) keep[it.p.mount] = 1; });
  this.st.mounts = keep;
};

/* memory: used share once a minute; warning after MEM_MINUTES values in a row over MEM_WARN */
Warnings.prototype.memory = function(now) {
  var m = sysinfo.parseMeminfo(this.read('/proc/meminfo'));
  if (!m.total) return;
  var p = Math.round((m.total - m.avail) / m.total * 100);
  this.st.mem.push(p);
  if (this.st.mem.length > MEM_MINUTES) this.st.mem.splice(0, this.st.mem.length - MEM_MINUTES);
  var it = this.find('mem');
  if (this.st.mem.length >= MEM_MINUTES && this.st.mem.every(function(x){ return x > MEM_WARN; })) {
    if (!it || !it.active) this.raise('mem', 'mem', {p: p}, now);
    else it.p = {p: Math.max(it.p.p || 0, p)};
  } else if (it && it.active && p < MEM_CLEAR) this.settle('mem');
};

/* drive space: USB and network at SPACE_WARN % or more; the internal card at CARD_WARN % or under CARD_MIN_KB free */
Warnings.prototype.space = function(now, cb) {
  var self = this;
  if (!this.sys || now - this.spaceAt < SPACE_MS) return cb();
  this.spaceAt = now;
  this.sys.diskList(function(list){
    (list || []).forEach(function(d){
      if (!d.ok || !d.size) return;
      var p = Math.round(d.used / d.size * 100), id = 'space:' + d.mount, it = self.find(id), card = d.kind === 'card';
      var warn = card ? p >= CARD_WARN || d.avail < CARD_MIN_KB : p >= SPACE_WARN;
      var clear = card ? p < CARD_CLEAR && d.avail >= CARD_OK_KB : p < SPACE_CLEAR;
      if (warn) { if (!it || !it.active) self.raise(id, 'space', {mount: d.mount, kind: d.kind, p: p, avail: d.avail}, now); else { it.p.p = p; it.p.avail = d.avail; } }
      else if (it && it.active && clear) self.settle(id);
    });
    cb();
  });
};

/* one round; cb() when done */
Warnings.prototype.check = function(now, cb) {
  var self = this;
  now = now || Date.now();
  var boot = this.read('/proc/sys/kernel/random/boot_id').trim();
  if (boot !== this.st.boot) {                         /* player restarted: kernel log and mounts start anew */
    this.st.boot = boot; this.st.kt = 0; this.st.mounts = {};
    this.st.items.forEach(function(it){ if (it.kind === 'gone') it.active = false; });
  }
  this.mounts(now);
  this.memory(now);
  this.kernel(now, function(){
    self.space(now, function(){
      var cut = now - KEEP_MS;                         /* past events and settled states leave after 24 h */
      self.st.items = self.st.items.filter(function(it){ return it.active || it.last >= cut; });
      self.save();
      if (cb) cb();
    });
  });
};

Warnings.prototype.start = function() {
  var self = this;
  function go() { self.check(Date.now(), function(){ self.timer = setTimeout(go, CHECK_MS); if (self.timer.unref) self.timer.unref(); }); }
  this.timer = setTimeout(go, 5000);                   /* shortly after start: the boot messages too */
  if (this.timer.unref) this.timer.unref();
};
Warnings.prototype.stop = function() { clearTimeout(this.timer); this.save(); };

/* GET /warnings: unread first (dot on the gear), then newest first */
Warnings.prototype.list = function() {
  var items = this.st.items.filter(function(it){ return !(it.kind === 'kernel' && it.p.cls === 'reset' && it.n < RESET_MIN); })   /* single resets are normal */
    .map(function(it){
      return {id: it.id, kind: it.kind, first: it.first, last: it.last, n: it.n, p: it.p, active: !!it.active, read: !!(it.ok && it.ok >= it.last)};
    }).sort(function(a, b){ return (a.read - b.read) || (b.last - a.last); });   /* unread first, then newest */
  return {ok: true, items: items, source: this.source};
};
/* POST /warnings {read: [id …] | 'all'}: marked as read; comes back when it happens again. A drive that is gone and
   marked as read is forgotten (unplugged on purpose) */
Warnings.prototype.markRead = function(ids, now) {
  var self = this;
  now = now || Date.now();
  function hit(it) { return ids === 'all' || (Array.isArray(ids) && ids.indexOf(it.id) >= 0); }
  this.st.items = this.st.items.filter(function(it){
    if (!hit(it)) return true;
    if (it.kind === 'gone' && it.active) { delete self.st.mounts[it.p.mount]; return false; }
    it.ok = Math.max(now, it.last);
    return true;
  });
  this.save();
};

module.exports = {Warnings: Warnings, classify: classify, deviceOf: deviceOf, parseKernel: parseKernel,
                  MEM_WARN: MEM_WARN, SPACE_WARN: SPACE_WARN, CARD_WARN: CARD_WARN, CARD_MIN_KB: CARD_MIN_KB, RESET_MIN: RESET_MIN};
