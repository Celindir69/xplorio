/* limiting the data folder: log and cover backups, image stores */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
process.env.TAGS_LOG = path.join(dir, 'changes.jsonl');
process.env.APP_CONFIG_DIR = dir;
process.env.MOODTAGS = '0';
var svc = require('../tags/tag-service.js');
var artistimg = require('../tags/artistimg.js');

var covers = path.join(dir, 'covers'), lines = [];
fs.mkdirSync(covers);
for (var i = 0; i < 205; i++) {
  var b = 'bat' + (100000 + i).toString(36);
  lines.push(JSON.stringify({batch: b, uri: 'USB/x/' + i + '.flac', before: {title: 'x'}}));
  fs.mkdirSync(path.join(covers, b)); fs.writeFileSync(path.join(covers, b, '0'), 'old');
  if (i < 3) { var old = new Date(Date.now() - 2 * 3600000); fs.utimesSync(path.join(covers, b), old, old); }
}
fs.mkdirSync(path.join(covers, 'neu123')); fs.writeFileSync(path.join(covers, 'neu123', '0'), 'running');   /* job without log entry, just started */
fs.writeFileSync(process.env.TAGS_LOG, lines.join('\n') + '\n');
svc.pruneLog();

t('log: only the last 200 jobs', function(){
  var kept = fs.readFileSync(process.env.TAGS_LOG, 'utf8').trim().split('\n').map(function(l){ return JSON.parse(l).batch; });
  assert.strictEqual(kept.length, 200);
  assert.strictEqual(kept[0], 'bat' + (100005).toString(36));
});
t('cover backups: old ones deleted, running jobs kept', function(){
  assert.ok(!fs.existsSync(path.join(covers, 'bat' + (100000).toString(36))));
  assert.ok(fs.existsSync(path.join(covers, 'bat' + (100010).toString(36))));
  assert.ok(fs.existsSync(path.join(covers, 'neu123')));
});

t('image store: oldest files are removed when over the limit', function(){
  var d = path.join(dir, 'imgs');
  fs.mkdirSync(d);
  for (var k = 0; k < 12; k++) {
    fs.writeFileSync(path.join(d, k + '.jpg'), 'x');
    var tm = new Date(Date.now() - (20 - k) * 60000); fs.utimesSync(path.join(d, k + '.jpg'), tm, tm);
  }
  new artistimg.Store(d, {max: 10});
  var left = fs.readdirSync(d).sort();
  assert.strictEqual(left.length, 10);
  assert.ok(left.indexOf('0.jpg') < 0 && left.indexOf('1.jpg') < 0 && left.indexOf('11.jpg') >= 0);
});
t('image store: also at most maxBytes together, oldest first', function(){
  var d = path.join(dir, 'bytes');
  fs.mkdirSync(d);
  for (var k = 0; k < 5; k++) {
    fs.writeFileSync(path.join(d, k + '.jpg'), Buffer.alloc(1000));
    var tm = new Date(Date.now() - (20 - k) * 60000); fs.utimesSync(path.join(d, k + '.jpg'), tm, tm);
  }
  new artistimg.Store(d, {max: 100, maxBytes: 3000});
  assert.deepStrictEqual(fs.readdirSync(d).sort(), ['2.jpg', '3.jpg', '4.jpg']);
});
setTimeout(function(){
  var s = new artistimg.Store(path.join(dir, 'queue2'), {lookup: function(){ /* never answers */ }, queueMax: 3}), got = [];
  for (var k = 0; k < 8; k++) s.get('artist ' + k, function(e){ got.push(e); });
  setTimeout(function(){
    t('image store: lookups beyond the queue answer busy', function(){
      assert.strictEqual(s.running, 2);                  /* PARALLEL */
      assert.strictEqual(s.queue.length, 3);
      assert.deepStrictEqual(got, ['busy', 'busy', 'busy']);
    });
    console.log(n + ' tests passed');
    process.exit(0);
  }, 300);
}, 0);
