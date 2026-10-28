/* repeat button with a fourth state ∞ (AutoDJ plugin), web/js/autodj.js */
var assert = require('assert');
var a = require('../web/js/autodj.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var NONE = {avail: false, enabled: false, ready: false}, READY = {avail: true, enabled: false, ready: true};

t('no plugin: three states as before', function(){
  assert.strictEqual(a.repeatNext('off', NONE).mode, 'all');
  assert.strictEqual(a.repeatNext('all', NONE).mode, 'one');
  assert.deepStrictEqual(a.repeatNext('one', NONE), {mode: 'off', repeat: {value: false, repeatSingle: false}, autodj: null});
});
t('with plugin: one → ∞ turns repeat off and AutoDJ on, ∞ → off turns AutoDJ off', function(){
  assert.deepStrictEqual(a.repeatNext('one', READY), {mode: 'inf', repeat: {value: false, repeatSingle: false}, autodj: true});
  assert.deepStrictEqual(a.repeatNext('inf', READY), {mode: 'off', repeat: null, autodj: false});
});
t('plugin without Last.fm key: no ∞; a still running AutoDJ is switched off on the way through "off"', function(){
  assert.strictEqual(a.repeatNext('one', {avail: true, enabled: false, ready: false}).mode, 'off');
  assert.strictEqual(a.repeatNext('one', {avail: true, enabled: true, ready: false}).autodj, false);
});
t('display: ∞ only with AutoDJ on and repeat off', function(){
  var on = {avail: true, enabled: true, ready: true};
  assert.strictEqual(a.repeatShown('off', on), 'inf');
  assert.strictEqual(a.repeatShown('all', on), 'all');               /* AutoDJ pauses while repeating */
  assert.strictEqual(a.repeatShown('off', READY), 'off');
  assert.strictEqual(a.repeatShown('off', {avail: false, enabled: true, ready: true}), 'off');
});
t('endpoint answer: no plugin, current plugin, plugin without the automatic-mode fields', function(){
  assert.deepStrictEqual(a.autodjState(undefined), NONE);
  assert.deepStrictEqual(a.autodjState({enabled: true, ready: true, replayGain: true, crossfade: 6}),
                         {avail: true, enabled: true, ready: true, replayGain: true, crossfade: 6});
  assert.deepStrictEqual(a.autodjState({enabled: false, ready: false}),
                         {avail: true, enabled: false, ready: false, replayGain: null, crossfade: null});
});
t('Infinity Playback (MyVolumio): available only with available:true', function(){
  var NO = {avail: false, enabled: false};
  assert.deepStrictEqual(a.infinityState(undefined), NO);
  assert.deepStrictEqual(a.infinityState({available: false, enabled: true}), NO);
  assert.deepStrictEqual(a.infinityState({available: true, enabled: true}), {avail: true, enabled: true});
  assert.deepStrictEqual(a.infinityState({available: true, enabled: false}), {avail: true, enabled: false});
});
t('∞ uses AutoDJ when installed, else Continuous Play', function(){
  var ADJ = {avail: true, enabled: false, ready: true}, NOADJ = {avail: false, enabled: false, ready: false};
  var INF = {avail: true, enabled: true}, NOINF = {avail: false, enabled: false};
  assert.strictEqual(a.endlessState(ADJ, INF).kind, 'autodj');
  assert.strictEqual(a.endlessState(ADJ, INF).enabled, false);
  assert.deepStrictEqual(a.endlessState(NOADJ, INF), {avail: true, enabled: true, ready: true, kind: 'infinity'});
  assert.deepStrictEqual(a.endlessState(NOADJ, NOINF), {avail: false, enabled: false, ready: false, kind: null});
  assert.strictEqual(a.repeatShown('off', a.endlessState(NOADJ, INF)), 'inf');
});
console.log(n + ' checks');
