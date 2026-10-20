/* Rotel bridge (rotel/rotel-bridge.js): device profile, allowed commands, replies */
var assert = require('assert');
var rb = require('../rotel/rotel-bridge.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

t('default profile RA-1572: all inputs, tone, balance, speakers A/B', function(){
  var p = rb.makeProfile();
  assert.deepStrictEqual(p.sources.map(function(x){ return x.cmd; }), ['cd', 'coax1', 'coax2', 'opt1', 'opt2', 'aux', 'tuner', 'phono', 'usb', 'bluetooth', 'bal_xlr', 'pcusb']);
  assert.deepStrictEqual(p.bypass, ['bypass_on', 'bypass_off']);
  assert.strictEqual(p.toneMax, 10); assert.strictEqual(p.balanceMax, 15);
  assert.deepStrictEqual(rb.queries(p), ['power?', 'volume?', 'mute?', 'source?', 'bypass?', 'bass?', 'treble?', 'balance?', 'speaker?']);
});

t('custom profile: named inputs, hiding with false, invalid commands are dropped', function(){
  var p = rb.makeProfile({sources: [{cmd: 'opt1', name: 'TV'}, 'pcusb', {cmd: 'rm -rf', name: 'x'}], speakerB: false, bass: ['bass;reboot', 'a', 'b'], balance: false});
  assert.deepStrictEqual(p.sources, [{cmd: 'opt1', name: 'TV', icon: 'digital'}, {cmd: 'pcusb', name: 'pcusb', icon: 'pc'}]);
  assert.strictEqual(p.speakerB, false); assert.strictEqual(p.bass, false); assert.strictEqual(p.balance, false);
  assert.deepStrictEqual(p.treble, ['treble_up', 'treble_down', 'treble_000']);
  var a = rb.allowedCmds(p);
  assert.ok(a.indexOf('opt1') >= 0 && a.indexOf('speaker_a_on') >= 0 && a.indexOf('bypass_off') >= 0 && a.indexOf('treble_000') >= 0);
  assert.ok(a.indexOf('cd') < 0 && a.indexOf('speaker_b_on') < 0 && a.indexOf('rm -rf') < 0 && a.indexOf('bass_up') < 0 && a.indexOf('balance_l') < 0);
  assert.deepStrictEqual(rb.queries(p), ['power?', 'volume?', 'mute?', 'source?', 'bypass?', 'treble?', 'speaker?']);
});

t('icons by command; ROTEL_INPUTS changes only the name and icon of individual inputs', function(){
  var p = rb.makeProfile();
  var ic = {}; p.sources.forEach(function(x){ ic[x.cmd] = x.icon; });
  assert.deepStrictEqual(ic, {cd: 'cd', coax1: 'digital', coax2: 'digital', opt1: 'digital', opt2: 'digital', aux: 'aux', tuner: 'tuner',
                              phono: 'phono', usb: 'usb', bluetooth: 'bluetooth', bal_xlr: 'aux', pcusb: 'pc'});
  var q = rb.makeProfile(null, {AUX: {name: 'Turntable', icon: 'phono'}, opt1: 'TV', cd: {icon: 'rocket'}, pc_usb: {icon: 'tv'}});
  var by = {}; q.sources.forEach(function(x){ by[x.cmd] = x; });
  assert.strictEqual(q.sources.length, 12);
  assert.deepStrictEqual(by.aux, {cmd: 'aux', name: 'Turntable', icon: 'phono'});
  assert.deepStrictEqual(by.opt1, {cmd: 'opt1', name: 'TV', icon: 'digital'});
  assert.deepStrictEqual(by.cd, {cmd: 'cd', name: 'CD', icon: 'cd'});                  /* unknown icon: default */
  assert.strictEqual(by.pcusb.icon, 'tv');
  var r = rb.makeProfile({sources: [{cmd: 'aux', name: 'Record', icon: 'phono'}]});
  assert.deepStrictEqual(r.sources, [{cmd: 'aux', name: 'Record', icon: 'phono'}]);
});

t('amplifier replies', function(){
  ['bass=-04', 'treble=000', 'balance=R03', 'bypass=on', 'speaker=b'].forEach(rb.parseMsg);
  assert.strictEqual(rb.state.bass, -4); assert.strictEqual(rb.state.treble, 0); assert.strictEqual(rb.state.balance, 3);
  assert.strictEqual(rb.state.bypass, true); assert.strictEqual(rb.state.speakerA, false); assert.strictEqual(rb.state.speakerB, true);
  ['balance=000', 'speaker=off'].forEach(rb.parseMsg);
  assert.strictEqual(rb.state.balance, 0); assert.strictEqual(rb.state.speakerB, false);
});
t('query the new state after a command; tone= as the opposite of bypass', function(){
  var p = rb.makeProfile();
  assert.strictEqual(rb.queryFor(p, 'bypass_off'), 'bypass?');
  assert.strictEqual(rb.queryFor(p, 'speaker_b_on'), 'speaker?');
  assert.strictEqual(rb.queryFor(p, 'bass_up'), 'bass?');
  assert.strictEqual(rb.queryFor(p, 'phono'), 'source?');
  assert.strictEqual(rb.queryFor(p, 'vol_up'), null);
  var log = console.log; console.log = function(){};
  ['bypass=off', 'tone=off', 'whatever=1'].forEach(rb.parseMsg);
  console.log = log;
  assert.strictEqual(rb.state.bypass, true);
  rb.parseMsg('bypass=off');
  assert.strictEqual(rb.state.bypass, false);
});
console.log(n + ' checks');
