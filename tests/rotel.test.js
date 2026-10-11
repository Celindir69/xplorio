/* Rotel-Bridge (rotel/rotel-bridge.js): Geräteprofil, erlaubte Befehle, Rückmeldungen */
var assert = require('assert');
var rb = require('../rotel/rotel-bridge.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

t('Standardprofil RA-1572: alle Eingänge, Klang, Balance, Lautsprecher A/B', function(){
  var p = rb.makeProfile();
  assert.deepStrictEqual(p.sources.map(function(x){ return x.cmd; }), ['cd', 'coax1', 'coax2', 'opt1', 'opt2', 'aux', 'tuner', 'phono', 'usb', 'bluetooth', 'bal_xlr', 'pcusb']);
  assert.deepStrictEqual(p.bypass, ['bypass_on', 'bypass_off']);
  assert.strictEqual(p.toneMax, 10); assert.strictEqual(p.balanceMax, 15);
  assert.deepStrictEqual(rb.queries(p), ['power?', 'volume?', 'mute?', 'source?', 'bypass?', 'bass?', 'treble?', 'balance?', 'speaker?']);
});

t('eigenes Profil: Eingänge mit Namen, Ausblenden mit false, ungültige Befehle fallen weg', function(){
  var p = rb.makeProfile({sources: [{cmd: 'opt1', name: 'Fernseher'}, 'pcusb', {cmd: 'rm -rf', name: 'x'}], speakerB: false, bass: ['bass;reboot', 'a', 'b'], balance: false});
  assert.deepStrictEqual(p.sources, [{cmd: 'opt1', name: 'Fernseher'}, {cmd: 'pcusb', name: 'pcusb'}]);
  assert.strictEqual(p.speakerB, false); assert.strictEqual(p.bass, false); assert.strictEqual(p.balance, false);
  assert.deepStrictEqual(p.treble, ['treble_up', 'treble_down', 'treble_000']);
  var a = rb.allowedCmds(p);
  assert.ok(a.indexOf('opt1') >= 0 && a.indexOf('speaker_a_on') >= 0 && a.indexOf('bypass_off') >= 0 && a.indexOf('treble_000') >= 0);
  assert.ok(a.indexOf('cd') < 0 && a.indexOf('speaker_b_on') < 0 && a.indexOf('rm -rf') < 0 && a.indexOf('bass_up') < 0 && a.indexOf('balance_l') < 0);
  assert.deepStrictEqual(rb.queries(p), ['power?', 'volume?', 'mute?', 'source?', 'bypass?', 'treble?', 'speaker?']);
});

t('Rückmeldungen des Verstärkers', function(){
  ['bass=-04', 'treble=000', 'balance=R03', 'bypass=on', 'speaker=b'].forEach(rb.parseMsg);
  assert.strictEqual(rb.state.bass, -4); assert.strictEqual(rb.state.treble, 0); assert.strictEqual(rb.state.balance, 3);
  assert.strictEqual(rb.state.bypass, true); assert.strictEqual(rb.state.speakerA, false); assert.strictEqual(rb.state.speakerB, true);
  ['balance=000', 'speaker=off'].forEach(rb.parseMsg);
  assert.strictEqual(rb.state.balance, 0); assert.strictEqual(rb.state.speakerB, false);
});
console.log(n + ' Prüfungen');
