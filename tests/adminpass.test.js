/* password for the services (tags/adminpass.js): hash instead of plain text, login per device, lockout after failed attempts */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var ap = require('../tags/adminpass.js');
var n = 0, steps = [];
function t(name, fn) { steps.push([name, fn]); }
function next() {
  var s = steps.shift();
  if (!s) return console.log(n + ' checks');
  s[1](function(){ n++; console.log('ok   ' + s[0]); next(); });
}
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adminpass-')), auth = new ap.Auth(dir), T0 = 1700000000000, token;

t('no password: locked', function(done){
  assert.ok(!auth.isSet());
  assert.ok(!auth.check('a'.repeat(64)));
  auth.login('x', T0, function(r){ assert.strictEqual(r.error, 'unset'); done(); });
});
t('set password: only hash and salt in admin.json', function(done){
  assert.throws(function(){ auth.setPassword('abc'); });
  auth.setPassword('Plattenspieler');
  var j = fs.readFileSync(path.join(dir, ap.FILE), 'utf8');
  assert.ok(auth.isSet() && j.indexOf('Plattenspieler') < 0 && /"salt":"[0-9a-f]{32}"/.test(j));
  done();
});
t('correct password: token for the device, valid for 30 days', function(done){
  auth.login('Plattenspieler', T0, function(r){
    assert.ok(r.ok && /^[0-9a-f]{64}$/.test(r.token));
    token = r.token;
    assert.ok(auth.check(token, T0 + 29 * 86400000));
    assert.ok(!auth.check(token, T0 + 31 * 86400000));
    assert.ok(!auth.check('b'.repeat(64), T0));
    assert.ok(!auth.check('kein hex', T0));
    assert.ok(fs.readFileSync(path.join(dir, ap.FILE), 'utf8').indexOf(token) < 0);    /* only the hash of the token */
    done();
  });
});
t('locked after 5 failed attempts, even for the correct password', function(done){
  var i = 0;
  (function wrong(){
    auth.login('falsch', T0, function(r){
      assert.strictEqual(r.error, 'wrong');
      if (++i < 5) return wrong();
      assert.ok(r.wait >= 30);
      auth.login('Plattenspieler', T0 + 1000, function(r2){
        assert.strictEqual(r2.error, 'locked');
        auth.login('Plattenspieler', T0 + 31000, function(r3){ assert.ok(r3.ok); done(); });
      });
    });
  })();
});
t('new password logs out all devices', function(done){
  assert.ok(auth.check(token, T0));
  auth.setPassword('Neues Passwort');
  assert.ok(!auth.check(token, T0));
  done();
});

next();
