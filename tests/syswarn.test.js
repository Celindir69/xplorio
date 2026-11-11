/* system warnings (tags/syswarn.js): drive errors from the kernel log, drive gone, memory, drive space */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var sw = require('../tags/syswarn.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'syswarn-'));
['proc', 'proc/sys', 'proc/sys/kernel', 'proc/sys/kernel/random'].forEach(function(d){ fs.mkdirSync(path.join(root, d)); });
function put(p, s) { fs.writeFileSync(path.join(root, p), s); }
function mem(availPct) { put('proc/meminfo', 'MemTotal: 1000000 kB\nMemFree: 1000 kB\nMemAvailable: ' + (availPct * 10000) + ' kB\n'); }
var MOUNTS = '/dev/mmcblk0p3 /data ext4 rw 0 0\n/dev/sda1 /media/MX-Media ext4 rw 0 0\n';
put('proc/sys/kernel/random/boot_id', 'boot-1\n');
put('proc/uptime', '1000.00 4000.00\n');
put('proc/mounts', MOUNTS);
mem(50);

t('kernel lines: class and device', function(){
  assert.strictEqual(sw.classify('blk_update_request: I/O error, dev sda, sector 123'), 'io');
  assert.strictEqual(sw.classify('sd 0:0:0:0: [sda] tag#0 uas_eh_abort_handler 0 uas-tag 1 inflight: CMD'), 'io');
  assert.strictEqual(sw.classify('EXT4-fs error (device sda1): ext4_find_entry:1455: inode #2: comm mpd: reading directory lblock 0'), 'fs');
  assert.strictEqual(sw.classify('usb 1-1.3: reset high-speed USB device number 4 using dwc_otg'), 'reset');
  assert.strictEqual(sw.classify('Under-voltage detected! (0x00050005)'), 'power');
  assert.strictEqual(sw.classify('usb 1-1.3: new high-speed USB device number 4 using dwc_otg'), null);
  assert.strictEqual(sw.deviceOf('Buffer I/O error on dev sda1, logical block 0'), 'sda');
  assert.strictEqual(sw.deviceOf('usb 1-1.3: reset high-speed USB device'), 'usb 1-1.3');
  assert.deepStrictEqual(sw.parseKernel('[   12.500000] host kernel: sd 0:0:0:0: [sda] Read Capacity(16) failed\nnoise\n[13.0] x'),
    [{t: 12.5, msg: 'sd 0:0:0:0: [sda] Read Capacity(16) failed'}, {t: 13, msg: 'x'}]);
});

var dmesg = '';
var ran = [];
function run(file, args, cb) {
  ran.push(file);
  if (file === 'dmesg') return dmesg === null ? cb(new Error('Operation not permitted'), '', 'dmesg: read kernel buffer failed: Operation not permitted') : cb(null, dmesg, '');
  cb(null, '[  20.000000] player kernel: Under-voltage detected! (0x00050005)\n', '');
}
var disks = [{mount: '/data', kind: 'card', ok: true, size: 1000, used: 500, avail: 500}, {mount: '/media/MX-Media', kind: 'usb', ok: true, size: 1000, used: 950, avail: 50}];
var sys = {diskList: function(cb){ cb(disks); }};
var file = path.join(root, 'syswarn.json');
var w = new sw.Warnings({root: root, file: file, run: run, sys: sys});
var T0 = 1700000000000;

dmesg = '[    5.000000] usb 1-1.3: new high-speed USB device number 4\n' +
        '[  100.000000] sd 0:0:0:0: [sda] tag#3 uas_eh_abort_handler 0 uas-tag 4 inflight: CMD\n' +
        '[  101.000000] blk_update_request: I/O error, dev sda, sector 2048\n' +
        '[  102.000000] usb 1-1.3: reset high-speed USB device number 4 using dwc_otg\n';
w.check(T0, function(){
  t('drive errors: grouped per device, time from uptime, a single reset is not shown', function(){
    var l = w.list();
    assert.strictEqual(l.source, 'dmesg');
    var io = l.items.filter(function(x){ return x.id === 'k:io:sda'; })[0];
    assert.ok(io); assert.strictEqual(io.n, 2); assert.strictEqual(io.last, T0 - 1000000 + 101000);
    assert.ok(/I\/O error/.test(io.p.line)); assert.strictEqual(io.p.mount, '/media/MX-Media');
    assert.ok(!l.items.some(function(x){ return x.p.cls === 'reset'; }));
  });
  t('drive space: 90 % or more', function(){
    var s = w.list().items.filter(function(x){ return x.kind === 'space'; });
    assert.deepStrictEqual(s.map(function(x){ return [x.p.mount, x.p.p, x.active]; }), [['/media/MX-Media', 95, true]]);
  });
  dmesg += '[  110.000000] usb 1-1.3: reset high-speed USB device number 4 using dwc_otg\n[  111.000000] usb 1-1.3: reset high-speed USB device number 4 using dwc_otg\n';
  w.check(T0 + 60000, function(){
    t('kernel log: only new lines count; three resets are shown', function(){
      var l = w.list().items;
      assert.strictEqual(l.filter(function(x){ return x.id === 'k:io:sda'; })[0].n, 2);
      assert.strictEqual(l.filter(function(x){ return x.id === 'k:reset:usb 1-1.3'; })[0].n, 3);
    });
    put('proc/mounts', '/dev/mmcblk0p3 /data ext4 rw 0 0\n');
    w.check(T0 + 120000, function(){
      t('USB drive gone: warning while it is missing, settled when mounted again', function(){
        var g = w.list().items.filter(function(x){ return x.kind === 'gone'; })[0];
        assert.ok(g && g.active); assert.strictEqual(g.p.mount, '/media/MX-Media');
      });
      put('proc/mounts', MOUNTS);
      w.check(T0 + 180000, function(){
        assert.strictEqual(w.list().items.filter(function(x){ return x.kind === 'gone'; })[0].active, false);
        memory();
      });
    });
  });
});

function memory() {
  mem(10);                                               /* 90 % used */
  var k = 0;
  (function step() {
    if (k++ < 5) return w.check(T0 + 300000 + k * 60000, function(){
      if (k === 4) t('memory: not yet after 4 minutes', function(){ assert.ok(!w.list().items.some(function(x){ return x.kind === 'mem'; })); });
      step();
    });
    t('memory: over 80 % for 5 minutes', function(){
      var m = w.list().items.filter(function(x){ return x.kind === 'mem'; })[0];
      assert.ok(m && m.active && !m.read); assert.strictEqual(m.p.p, 90);
    });
    w.markRead(['mem'], T0 + 700000);
    t('marked as read: stays listed, but read', function(){ assert.ok(w.list().items.filter(function(x){ return x.kind === 'mem'; })[0].read); });
    mem(50);
    w.check(T0 + 760000, function(){
      t('memory: settled below 75 %', function(){ assert.strictEqual(w.list().items.filter(function(x){ return x.kind === 'mem'; })[0].active, false); });
      restart();
    });
  })();
}

function restart() {
  var w2 = new sw.Warnings({root: root, file: file, run: run, sys: sys});
  t('saved: after a restart of the service the warnings are still there', function(){
    assert.ok(w2.list().items.some(function(x){ return x.id === 'k:io:sda'; }));
  });
  put('proc/sys/kernel/random/boot_id', 'boot-2\n');
  dmesg = null;                                          /* dmesg not allowed: journalctl -k */
  ran = [];
  w2.check(T0 + 800000, function(){
    t('new boot: kernel log from the start, from the journal when dmesg is not allowed', function(){
      assert.deepStrictEqual(ran, ['dmesg', 'journalctl']);
      var l = w2.list();
      assert.strictEqual(l.source, 'journal');
      assert.ok(l.items.some(function(x){ return x.id === 'k:power:'; }));
      assert.ok(l.items.some(function(x){ return x.id === 'k:io:sda'; }));    /* from the boot before */
    });
    w2.markRead('all', T0 + 900000);
    t('all marked as read', function(){ assert.ok(w2.list().items.every(function(x){ return x.read; })); });
    w2.check(T0 + KEEP() , function(){
      t('after 24 h only what is still going on remains', function(){
        assert.deepStrictEqual(w2.list().items.map(function(x){ return x.kind; }).sort(), ['space']);
      });
      console.log(n + ' checks');
    });
  });
}
function KEEP() { return 800000 + 25 * 3600000; }
