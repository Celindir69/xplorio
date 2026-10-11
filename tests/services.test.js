/* Dienste (tags/services.js): systemctl show auslesen, erlaubte Aktionen, sudo-Befehle */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var sv = require('../tags/services.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { fn(function(){ n++; console.log('ok   ' + name); }); }
process.on('exit', function(code){ if (!code) { assert.strictEqual(n, 6, 'nicht alle Prüfungen fertig'); console.log(n + ' Prüfungen'); } });

var SHOW = [
  'Id=volumio.service', 'LoadState=loaded', 'ActiveState=active', 'SubState=running', 'ActiveEnterTimestampMonotonic=1000000000', '',
  'Id=mpd.service', 'LoadState=loaded', 'ActiveState=failed', 'SubState=failed', 'ActiveEnterTimestampMonotonic=0', '',
  'Id=tag-service.service', 'LoadState=loaded', 'ActiveState=activating', 'SubState=auto-restart', 'ActiveEnterTimestampMonotonic=0', '',
  'Id=rotel-bridge.service', 'LoadState=not-found', 'ActiveState=inactive', 'SubState=dead', 'ActiveEnterTimestampMonotonic=0', '',
  'Id=volumio-kiosk.service', 'LoadState=loaded', 'ActiveState=inactive', 'SubState=dead', 'ActiveEnterTimestampMonotonic=0'
].join('\n') + '\n';

t('systemctl show: ein Block je Dienst, Startzeit aus der monotonen Uhr', function(){
  var p = sv.parseShow(SHOW, 4000, 10000000);          /* 4000 s seit Systemstart, aktiv seit 1000 s nach Start */
  assert.strictEqual(p.length, 5);
  assert.deepStrictEqual(p[0], {id: 'volumio', load: 'loaded', active: 'active', sub: 'running', since: 10000000 - 3000000});
  assert.strictEqual(p[1].active, 'failed');
  assert.strictEqual(p[1].since, null);
  assert.strictEqual(p[3].load, 'not-found');
});

t('Liste: Reihenfolge fest, nicht eingerichtete Dienste fehlen, Kiosk mit Start und Stopp', function(){
  var m = sv.merge(sv.parseShow(SHOW, 4000, 10000000));
  assert.deepStrictEqual(m.map(function(u){ return u.id; }), ['volumio', 'mpd', 'tag-service', 'volumio-kiosk']);
  assert.deepStrictEqual(m[3].actions, ['start', 'stop', 'restart']);
  assert.deepStrictEqual(m[0].actions, ['restart']);
});

t('nur erlaubte Dienste und Aktionen', function(){
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

ta('Status: systemctl show und sudo-Prüfung', function(done){
  var calls = [];
  var s = new sv.Services({root: root, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(f === 'sudo' ? new Error('nein') : null, f === 'sudo' ? '' : SHOW); }});
  s.status(function(r){
    assert.ok(r.ok);
    assert.strictEqual(r.sudo, false);
    assert.strictEqual(r.units.length, 4);
    assert.ok(/^\/bin\/systemctl show -p Id,LoadState,ActiveState,SubState,ActiveEnterTimestampMonotonic volumio\.service /.test(calls[0]));
    assert.strictEqual(calls[1], 'sudo -n -l /bin/systemctl --no-block restart volumio');
    done();
  });
});

ta('Aktion: sudo ohne Passwort, Fehler als nosudo, Unerlaubtes abgelehnt', function(done){
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

ta('eigener Neustart: erst Antwort, dann Befehl; ohne sudo-Recht gleich nosudo', function(done){
  var calls = [], allow = true;
  var s = new sv.Services({root: root, run: function(f, a, cb){ calls.push([f].concat(a).join(' ')); cb(allow ? null : new Error('x'), ''); }});
  s.act('tag-service', 'restart', 'tag-service', function(c, o){
    assert.ok(o.ok && o.self);
    assert.ok(calls.every(function(x){ return x.indexOf(' -l ') > 0; }));    /* noch nicht ausgeführt */
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
