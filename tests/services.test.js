/* services (tags/services.js): parse systemctl show, allowed actions, sudo commands */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var sv = require('../tags/services.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { fn(function(){ n++; console.log('ok   ' + name); }); }
process.on('exit', function(code){ if (!code) { assert.strictEqual(n, 8, 'not all checks finished'); console.log(n + ' checks'); } });

var SHOW = [
  'Id=volumio.service', 'LoadState=loaded', 'ActiveState=active', 'SubState=running', 'ActiveEnterTimestampMonotonic=1000000000', '',
  'Id=mpd.service', 'LoadState=loaded', 'ActiveState=failed', 'SubState=failed', 'ActiveEnterTimestampMonotonic=0', '',
  'Id=tag-service.service', 'LoadState=loaded', 'ActiveState=activating', 'SubState=auto-restart', 'ActiveEnterTimestampMonotonic=0', '',
  'Id=rotel-bridge.service', 'LoadState=not-found', 'ActiveState=inactive', 'SubState=dead', 'ActiveEnterTimestampMonotonic=0', '',
  'Id=volumio-kiosk.service', 'LoadState=loaded', 'ActiveState=inactive', 'SubState=dead', 'ActiveEnterTimestampMonotonic=0'
].join('\n') + '\n';

t('systemctl show: one block per service, start time from the monotonic clock', function(){
  var p = sv.parseShow(SHOW, 4000, 10000000);          /* 4000 s since boot, active since 1000 s after boot */
  assert.strictEqual(p.length, 5);
  assert.deepStrictEqual(p[0], {id: 'volumio', load: 'loaded', active: 'active', sub: 'running', since: 10000000 - 3000000});
  assert.strictEqual(p[1].active, 'failed');
  assert.strictEqual(p[1].since, null);
  assert.strictEqual(p[3].load, 'not-found');
});

t('list: fixed order, services not installed are missing, kiosk with start and stop', function(){
  var m = sv.merge(sv.parseShow(SHOW, 4000, 10000000));
  assert.deepStrictEqual(m.map(function(u){ return u.id; }), ['volumio', 'mpd', 'tag-service', 'volumio-kiosk']);
  assert.deepStrictEqual(m[3].actions, ['start', 'stop', 'restart']);
  assert.deepStrictEqual(m[0].actions, ['restart']);
});

t('only allowed services and actions', function(){
  assert.ok(sv.allowed('volumio', 'restart'));
  assert.ok(sv.allowed('volumio-kiosk', 'stop'));
  assert.ok(!sv.allowed('volumio', 'stop'));
  assert.ok(!sv.allowed('ssh', 'restart'));
  assert.ok(!sv.allowed('volumio; reboot', 'restart'));
  assert.deepStrictEqual(sv.command('volumio-kiosk', 'start'), ['/bin/systemctl', '--no-block', 'start', 'volumio-kiosk']);
});

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'services-'));
fs.mkdirSync(path.join(root, 'proc'));
fs.writeFileSync(path.join(root, 'proc/uptime'), '4000.00 1.00\n');

ta('status: systemctl show and sudo check', function(done){
  var calls = [];
  var s = new sv.Services({root: root, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(f === 'sudo' ? new Error('no') : null, f === 'sudo' ? '' : SHOW); }});
  s.status(function(r){
    assert.ok(r.ok);
    assert.strictEqual(r.sudo, false);
    assert.strictEqual(r.units.length, 4);
    assert.ok(/^\/bin\/systemctl show -p Id,LoadState,ActiveState,SubState,ActiveEnterTimestampMonotonic volumio\.service /.test(calls[0]));
    assert.strictEqual(calls[1], 'sudo -n -l /bin/systemctl --no-block restart volumio');
    done();
  });
});

ta('action: sudo without password, error as nosudo, disallowed rejected', function(done){
  var calls = [], fail = false, err = console.error;
  console.error = function(){};
  var s = new sv.Services({root: root, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(fail ? new Error('x') : null, ''); }});
  s.act('volumio-kiosk', 'stop', 'tag-service', function(c, o){
    assert.strictEqual(c, 200); assert.ok(o.ok);
    assert.strictEqual(calls[0], 'sudo -n /bin/systemctl --no-block stop volumio-kiosk');
    s.act('volumio', 'stop', 'tag-service', function(c2, o2){
      assert.strictEqual(c2, 400); assert.ok(!o2.ok);
      fail = true;
      s.act('mpd', 'restart', 'tag-service', function(c3, o3){
        console.error = err;
        assert.strictEqual(o3.error, 'nosudo');
        done();
      });
    });
  });
});

ta('own restart: response first, then command; without sudo permission nosudo right away', function(done){
  var calls = [], allow = true;
  var s = new sv.Services({root: root, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(allow ? null : new Error('x'), ''); }});
  s.act('tag-service', 'restart', 'tag-service', function(c, o){
    assert.ok(o.ok && o.self);
    assert.ok(calls.every(function(x){ return x.indexOf(' -l ') > 0; }));    /* not run yet */
    setTimeout(function(){
      assert.strictEqual(calls[calls.length - 1], 'sudo -n /bin/systemctl --no-block restart tag-service');
      allow = false;
      s.act('tag-service', 'restart', 'tag-service', function(c2, o2){
        assert.strictEqual(o2.error, 'nosudo');
        done();
      });
    }, 400);
  });
});

ta('restart/power off player: only reboot and poweroff, response first, then command', function(done){
  var calls = [];
  var s = new sv.Services({root: root, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(null, ''); }});
  s.power('rm', function(c){
    assert.strictEqual(c, 400);
    s.power('toString', function(c1){
      assert.strictEqual(c1, 400);
      s.power('reboot', function(c2, o){
        assert.ok(o.ok);
        assert.deepStrictEqual(calls, ['sudo -n -l /sbin/reboot']);
        setTimeout(function(){
          assert.strictEqual(calls[1], 'sudo -n /sbin/reboot');
          var s2 = new sv.Services({root: root, run: function(f, a, cb){ cb(new Error('no'), ''); }});
          s2.power('poweroff', function(c3, o3){ assert.strictEqual(o3.error, 'nosudo'); done(); });
        }, 600);
      });
    });
  });
});

ta('kiosk "failed" after own stop: show as stopped, real state again after start', function(done){
  var show = SHOW.replace('Id=volumio-kiosk.service\nLoadState=loaded\nActiveState=inactive\nSubState=dead', 'Id=volumio-kiosk.service\nLoadState=loaded\nActiveState=failed\nSubState=failed');
  assert.notStrictEqual(show, SHOW);
  var s = new sv.Services({root: root, run: function(f, a, cb){ cb(null, f === 'sudo' ? '' : show); }});
  function kiosk(r){ return r.units.filter(function(u){ return u.id === 'volumio-kiosk'; })[0]; }
  s.status(function(r0){
    assert.strictEqual(kiosk(r0).active, 'failed');                 /* without own stop: real error */
    s.act('volumio-kiosk', 'stop', 'tag-service', function(){
      s.status(function(r1){
        assert.strictEqual(kiosk(r1).active, 'inactive');
        assert.strictEqual(r1.units.filter(function(u){ return u.id === 'mpd'; })[0].active, 'failed');   /* others stay */
        s.act('volumio-kiosk', 'start', 'tag-service', function(){
          s.status(function(r2){ assert.strictEqual(kiosk(r2).active, 'failed'); done(); });
        });
      });
    });
  });
});
