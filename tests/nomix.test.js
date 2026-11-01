/* NoMix (tags/nomix.js): tracks with NoMix in the comment never go into a mix */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var nm = require('../tags/nomix.js');
var ess = require('../tags/essentia.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomix-'));

t('marker: anywhere in the comment, any case', function(){
  assert.ok(nm.marked('NoMix')); assert.ok(nm.marked('live recording; nomix')); assert.ok(nm.marked('NOMIX!'));
  assert.ok(!nm.marked('')); assert.ok(!nm.marked('No Mix')); assert.ok(!nm.marked(null));
});

t('written through Xplorio: remembered, removed again, kept in the file', function(){
  var file = path.join(dir, 'nomix.json'), s = new nm.Store(file);
  assert.strictEqual(s.noteComment('USB/A/01.flac', 'NoMix'), true);
  assert.strictEqual(s.noteComment('USB/A/01.flac', 'NoMix again'), false, 'no change');
  s.noteComment('USB/A/02.flac', 'nomix');
  s.noteComment('USB/A/02.flac', 'live');
  assert.deepStrictEqual(new nm.Store(file).load().files, {'USB/A/01.flac': 1});
});

t('excluded: "don\'t like", NoMix written here and NoMix from the analysis', function(){
  var s = new nm.Store(path.join(dir, 'ex.json'));
  s.noteComment('USB/B/1.flac', 'NoMix');
  var tracks = [['X', 'a', 'USB/B/1.flac', 1, 'B'], ['X', 'b', 'USB/B/2.flac', 1, 'B'], ['Y', 'c', 'USB/C/1.flac', 1, 'C'], ['Y', 'd', 'USB/C/2.flac', 1, 'C']];
  var audio = {Xb: {nomix: false}, Yc: {nomix: true}};
  var ex = s.excluded({'USB/C/2.flac': true}, tracks, function(ar, ti){ return audio[ar + ti] || null; });
  assert.deepStrictEqual(Object.keys(ex).sort(), ['USB/B/1.flac', 'USB/C/1.flac', 'USB/C/2.flac']);
});

t('analysis file: field nomix is read', function(){
  var file = path.join(dir, 'essentia.jsonl');
  fs.writeFileSync(file, JSON.stringify({ar: 'Y', ti: 'c', al: 'C', bpm: 100, nomix: 1}) + '\n' + JSON.stringify({ar: 'Y', ti: 'd', al: 'C', bpm: 90}) + '\n');
  var st = new ess.Store(file);
  assert.strictEqual(st.get('Y', 'c', 'C').nomix, true);
  assert.strictEqual(st.get('Y', 'd', 'C').nomix, false);
});
console.log(n + ' checks');
