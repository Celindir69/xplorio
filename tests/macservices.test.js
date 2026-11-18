/* System page on the Mac (tags/macservices.js): services without systemctl, restart, no power-off */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ms = require('../tags/macservices.js');

var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }
function make(extra) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-svc-')), log = [];
  fs.writeFileSync(path.join(dir, 'web.pid'), '4242\n');
  fs.writeFileSync(path.join(dir, 'xplorio-services.sh'), '#!/bin/bash\n');
  var rotelOn = false;
  var o = {mpdPort: 6600, webPort: 4040, tagsStarted: 1000, runDir: dir, script: path.join(dir, 'xplorio-services.sh'),
    ping: function(port, cb){ cb(port !== 9999); },
    psStart: function(pid, cb){ cb(pid === 4242 ? 5000 : null); },
    mpdRestart: function(cb){ log.push('mpd restart'); cb(null); },
    rotel: {on: function(){ return rotelOn; }, since: function(){ return rotelOn ? 7000 : null; }, restart: function(){ log.push('rotel restart'); }},
    spawn: function(bin, args){ log.push('spawn ' + args[1]); return {unref: function(){}}; },
    kill: function(pid){ log.push('kill ' + pid); },
    exit: function(code){ log.push('exit ' + code); }};
  Object.keys(extra || {}).forEach(function(k){ o[k] = extra[k]; });
  var s = new ms.MacServices(o);
  return {s: s, log: log, rotel: function(v){ rotelOn = v; }};
}

t('status: MPD, tag service and web server running, Rotel only when switched on; no sudo needed', function(done){
  var m = make();
  m.s.status(function(r){
    assert.strictEqual(r.ok, true); assert.strictEqual(r.mac, true); assert.strictEqual(r.sudo, true);
    assert.deepStrictEqual(r.units.map(function(u){ return [u.id, u.active, u.since]; }),
      [['mpd', 'active', null], ['xplorio-tags', 'active', 1000], ['xplorio-web', 'active', 5000]]);
    m.rotel(true);
    m.s.status(function(r2){
      assert.deepStrictEqual(r2.units[3], {id: 'xplorio-rotel', active: 'active', sub: 'running', since: 7000, actions: ['restart']});
      done();
    });
  });
});

t('status: a service that does not answer is shown as stopped', function(done){
  var m = make({webPort: 9999});
  m.s.status(function(r){
    assert.deepStrictEqual(r.units[2], {id: 'xplorio-web', active: 'inactive', sub: 'dead', since: null, actions: ['restart']});
    done();
  });
});

t('restart: MPD, web server (stop, start script), Rotel; the tag service answers first and then leaves', function(done){
  var m = make();
  m.rotel(true);
  m.s.act('mpd', 'restart', 'xplorio-tags', function(c, r){
    assert.deepStrictEqual([c, r], [200, {ok: true}]);
    m.s.act('xplorio-web', 'restart', 'xplorio-tags', function(c2, r2){
      assert.deepStrictEqual(r2, {ok: true});
      m.s.act('xplorio-rotel', 'restart', 'xplorio-tags', function(){
        m.s.act('xplorio-tags', 'restart', 'xplorio-tags', function(c4, r4){
          assert.deepStrictEqual(r4, {ok: true, self: true});
          setTimeout(function(){
            assert.deepStrictEqual(m.log, ['mpd restart', 'kill 4242', 'spawn sleep 1; exec /bin/bash "$0" start', 'rotel restart',
                                           'spawn sleep 2; exec /bin/bash "$0" start', 'exit 0']);
            done();
          }, 400);
        });
      });
    });
  });
});

t('not allowed: other services, other actions, Rotel while it is off', function(done){
  var m = make();
  m.s.act('volumio', 'restart', 'xplorio-tags', function(c){
    assert.strictEqual(c, 400);
    m.s.act('mpd', 'stop', 'xplorio-tags', function(c2){
      assert.strictEqual(c2, 400);
      m.s.act('xplorio-rotel', 'restart', 'xplorio-tags', function(c3){ assert.strictEqual(c3, 400); assert.deepStrictEqual(m.log, []); done(); });
    });
  });
});

t('ps elapsed time', function(done){
  assert.strictEqual(ms.etimeSeconds('05:07'), 307);
  assert.strictEqual(ms.etimeSeconds('02:05:07'), 7507);
  assert.strictEqual(ms.etimeSeconds('3-02:05:07'), 266707);
  assert.ok(isNaN(ms.etimeSeconds('')));
  done();
});

(function run(i){
  if (i >= queue.length) { console.log(n + ' tests passed'); return; }
  queue[i][1](function(){ n++; console.log('ok   ' + queue[i][0]); run(i + 1); });
})(0);
