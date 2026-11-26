/* system info (tags/sysinfo.js): CPU load from /proc/stat, memory, drives, history per minute */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var si = require('../tags/sysinfo.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'sysinfo-'));
['proc', 'sys', 'sys/class', 'sys/class/thermal', 'sys/class/thermal/thermal_zone0', 'etc'].forEach(function(d){ fs.mkdirSync(path.join(root, d)); });   /* Node 8: no recursive */
function put(p, s) { fs.writeFileSync(path.join(root, p), s); }
function stat(busy, idle) {
  return 'cpu  ' + busy + ' 0 0 ' + idle + ' 0 0 0 0 0 0\ncpu0 ' + busy + ' 0 0 ' + idle + ' 0 0 0 0 0 0\nintr 1 2 3\n';
}
put('proc/meminfo', 'MemTotal:        1000000 kB\nMemFree:          100000 kB\nMemAvailable:     400000 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n');
put('sys/class/thermal/thermal_zone0/temp', '49388\n');
put('proc/uptime', '12345.67 40000.00\n');
put('etc/os-release', 'PRETTY_NAME="Raspbian GNU/Linux 8 (jessie)"\nVOLUMIO_VERSION="1.079"\nVOLUMIO_HARDWARE=cm3\n');
put('proc/mounts', [
  '/dev/mmcblk0p3 /data ext4 rw 0 0',
  'overlay / overlay rw 0 0',
  '/dev/mmcblk0p3 /mnt/INTERNAL ext4 rw 0 0',
  'tmpfs /run tmpfs rw 0 0',
  '/dev/mmcblk0p1 /boot vfat rw 0 0',
  '/dev/sda1 /media/MX-Media fuseblk rw 0 0',
  '/dev/sda1 /mnt/USB/MX-Media fuseblk rw 0 0',
  '//nas/musik /mnt/NAS/Musik cifs rw 0 0',
  '//nas/hörbuch /mnt/NAS/H\\040Buch cifs rw 0 0'
].join('\n') + '\n');

t('CPU load from two /proc/stat samples', function(){
  var a = si.parseStat(stat(100, 900)), b = si.parseStat(stat(150, 950));
  assert.strictEqual(si.pct(a.all, b.all), 50);
  assert.strictEqual(a.cores.length, 1);
  assert.strictEqual(si.pct(a.all, a.all), null);
});

t('memory: MemAvailable, else free + buffers + cache', function(){
  assert.deepStrictEqual(si.parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 300 kB\n'), {total: 1000, avail: 300, swapTotal: 0, swapFree: 0});
  assert.strictEqual(si.parseMeminfo('MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 150 kB\n').avail, 300);
});

t('drives: card, USB (also under /media), each NAS connection; each device once, /boot gone', function(){
  var l = si.parseMounts(fs.readFileSync(path.join(root, 'proc/mounts'), 'utf8'));
  assert.deepStrictEqual(l.map(function(d){ return d.mount; }), ['/data', '/media/MX-Media', '/mnt/NAS/Musik', '/mnt/NAS/H Buch']);
  assert.deepStrictEqual(l.map(function(d){ return d.kind; }), ['card', 'usb', 'net', 'net']);
});

t('drives: Volumio 2 without mounted /data -> usage via the overlay under /', function(){
  var l = si.parseMounts(['/dev/mmcblk0p2 /imgpart ext4 rw 0 0', '/dev/loop0 /static squashfs ro 0 0', 'overlay / overlay rw 0 0',
                          '/dev/mmcblk0p1 /boot vfat rw 0 0', '/dev/sda1 /media/MX-Media exfat rw 0 0', '//nas/m /mnt/NAS/M cifs rw 0 0'].join('\n'));
  assert.deepStrictEqual(l.map(function(d){ return d.mount + ':' + d.kind; }), ['/:card', '/media/MX-Media:usb', '/mnt/NAS/M:net']);
});

t('name of the internal drive: file system label, else the device model; Volumio labels are skipped', function(){
  var r = fs.mkdtempSync(path.join(os.tmpdir(), 'sysinfo-lbl-'));
  function mk(p) { p.split('/').reduce(function(acc, x){ acc = path.join(acc, x); if (!fs.existsSync(acc)) fs.mkdirSync(acc); return acc; }, r); }
  mk('dev/disk/by-label'); mk('sys/block/mmcblk0/device'); mk('sys/block/sda/device'); mk('sys/block/nvme0n1/device');
  fs.writeFileSync(path.join(r, 'sys/block/mmcblk0/device/name'), 'SC64G\n');
  fs.writeFileSync(path.join(r, 'sys/block/sda/device/model'), 'Samsung SSD 860 \n');
  fs.writeFileSync(path.join(r, 'sys/block/nvme0n1/device/model'), 'WD Blue SN570  \n');
  fs.symlinkSync('../../mmcblk0p3', path.join(r, 'dev/disk/by-label/volumio_data'));
  fs.symlinkSync('../../nvme0n1p3', path.join(r, 'dev/disk/by-label/Musik\\x20SSD'));
  assert.strictEqual(si.driveLabel('/dev/mmcblk0p3', r), 'SC64G');               /* Raspberry Pi: SD card product name */
  assert.strictEqual(si.driveLabel('/dev/sda3', r), 'Samsung SSD 860');            /* PC: SATA model */
  assert.strictEqual(si.driveLabel('/dev/nvme0n1p3', r), 'Musik SSD');             /* own label wins */
  assert.strictEqual(si.driveLabel('/dev/mmcblk1p2', r), '');
  assert.strictEqual(si.driveLabel('', r), '');
  var l = si.parseMounts(['/dev/mmcblk0p2 /imgpart ext4 rw 0 0', 'overlay / overlay rw 0 0', '/dev/mmcblk0p1 /boot vfat rw 0 0'].join('\n'));
  assert.strictEqual(l[0].dev, '/dev/mmcblk0p2');                                  /* overlay on /: device from /imgpart */
  mk('Volumes'); fs.symlinkSync('/', path.join(r, 'Volumes/Macintosh HD'));
  assert.strictEqual(si.macRootName(r), 'Macintosh HD');
});

t('parse df -kP', function(){
  assert.deepStrictEqual(si.parseDf('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 600 400 60% /mnt/USB\n'), {size: 1000, used: 600, avail: 400});
  assert.strictEqual(si.parseDf(''), null);
});

t('history per minute with load, memory and temperature; older than 24 h is dropped', function(){
  var s = new si.Sysinfo({root: root});
  var t0 = Date.UTC(2026, 9, 10, 12, 0, 0);
  s.hist.push([t0 - 25 * 3600000, 1, 1, 1]);
  put('proc/stat', stat(100, 900)); s.sample(t0);
  put('proc/stat', stat(110, 990)); s.sample(t0 + 2000);
  assert.strictEqual(s.cpu, 10);
  assert.strictEqual(s.live.length, 1);
  put('proc/stat', stat(400, 1100)); s.sample(t0 + 60000);
  assert.strictEqual(s.hist.length, 1);
  assert.deepStrictEqual(s.hist[0].slice(1), [60, 60, 49.4]);
});

t('history survives a restart (sysinfo.json)', function(){
  var file = path.join(root, 'sysinfo.json');
  var a = new si.Sysinfo({root: root, file: file});
  a.hist.push([Date.now() - 60000, 12, 34, 45.6]);
  a.save();
  var b = new si.Sysinfo({root: root, file: file});
  assert.deepStrictEqual(b.hist, a.hist);
});

var s = new si.Sysinfo({root: root, df: function(m, cb){
  if (m === '/mnt/NAS/Musik') return setTimeout(function(){ cb(null); }, 5);     /* hanging connection */
  cb({size: 1000, used: 250, avail: 750});
}});
s.report(true, function(r){
  t('report with drives, version, temperature and uptime', function(){
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.temp, 49.4);
    assert.strictEqual(r.uptime, 12346);
    assert.strictEqual(r.sys.volumio, '1.079');
    assert.strictEqual(r.mem.total, 1000000);
    assert.strictEqual(r.disks.length, 4);
    var nas = r.disks.filter(function(d){ return d.mount === '/mnt/NAS/Musik'; })[0];
    assert.strictEqual(nas.ok, false);
    assert.strictEqual(r.disks[0].used, 250);
    assert.strictEqual(r.disks[0].label, undefined);                         /* no model in the test /sys: just "Internal" */
  });
  s.report(false, function(r2){
    t('short report for the live display without history and drives', function(){
      assert.strictEqual(r2.hist, undefined);
      assert.strictEqual(r2.disks, undefined);
    });
    t('samples every 2 s only while someone watches, otherwise every 10 s', function(){
      var w = new si.Sysinfo({root: root});
      assert.strictEqual(w.interval(1000), 10000);
      w.watch(1000);
      assert.strictEqual(w.interval(20000), 2000);
      assert.strictEqual(w.interval(31001), 10000);
      assert.ok(s.interval() === 2000);             /* report() counts as watching */
    });
    console.log(n + ' checks ok');
  });
});

/* Mac: no /proc; load from os.cpus(), memory from vm_stat, drives from mount, version from sw_vers */
(function(){
  var si = require('../tags/sysinfo.js');
  var VM = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free:  1000.\nPages active:  5000.\nPages inactive:  2000.\nPages speculative:  500.\nPages purgeable:  500.\n';
  var MOUNT = '/dev/disk1s1 on / (apfs, local, journaled)\ndevfs on /dev (devfs, local, nobrowse)\n/dev/disk1s4 on /System/Volumes/VM (apfs, local)\n' +
              '/dev/disk2s1 on /Volumes/Musik USB (exfat, local, nodev, nosuid)\n//ich@nas/music on /Volumes/music (smbfs, nodev, nosuid, mounted by ich)\n';
  var c = si.statFromCpus([{times: {user: 10, nice: 0, sys: 5, irq: 0, idle: 85}}, {times: {user: 20, nice: 0, sys: 0, irq: 0, idle: 80}}]);
  assert.deepStrictEqual(c.all, {busy: 35, total: 200}); assert.strictEqual(c.cores.length, 2);
  assert.deepStrictEqual(si.parseVmStat(VM, 100000), {total: 100000, avail: 16000, swapTotal: 0, swapFree: 0});   /* (1000+2000+500+500)·4 kB */
  assert.deepStrictEqual(si.parseMacMounts(MOUNT).map(function(d){ return [d.mount, d.kind]; }), [['/', 'card'], ['/Volumes/Musik USB', 'usb'], ['/Volumes/music', 'net']]);
  var s = new si.Sysinfo({platform: 'darwin', df: function(m, cb){ cb({size: 100, used: 40, avail: 60}); },
    mpdBin: '/opt/local/bin/mpd',
    run: function(cmd, args, cb){ cb(cmd === 'vm_stat' ? VM : cmd === 'mount' ? MOUNT : cmd === 'sw_vers' ? '11.7.10\n' :
      cmd === '/opt/local/bin/mpd' ? 'Music Player Daemon 0.24.19 (v0.24.19)\n\nDecoder plugins:\n [mad] mp3\n [ffmpeg] dsf flac\n\nInput plugins:\n file\n' : ''); }});
  s.sample(1000); s.sample(3000);
  s.report(true, function(r){
    assert.strictEqual(r.sys.os, 'macOS 11.7.10');
    assert.strictEqual(r.sys.mpd, '0.24.19'); assert.strictEqual(r.sys.mpdFfmpeg, true);
    assert.strictEqual(r.disks.length, 3);
    assert.ok(r.mem.total > 0 && r.mem.avail > 0);
    assert.ok(r.uptime > 0);
    var noFf = 'Music Player Daemon 0.24 (v0.24)\n\nDecoder plugins:\n [dsf] dsf\n\nInput plugins:\n [ffmpeg] gopher\n';
    assert.deepStrictEqual(si.parseMpdVersion(noFf), {version: '0.24', ffmpeg: false});   /* ffmpeg only as input plugin */
    assert.strictEqual(si.parseMpdVersion(''), null);
    console.log('ok   Mac: load, memory, drives, version and MPD version without /proc');
  });
})();
