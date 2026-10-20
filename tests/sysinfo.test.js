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
  });
  s.report(false, function(r2){
    t('short report for the live display without history and drives', function(){
      assert.strictEqual(r2.hist, undefined);
      assert.strictEqual(r2.disks, undefined);
    });
    console.log(n + ' checks ok');
  });
});
