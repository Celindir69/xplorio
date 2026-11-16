/* Backup of Xplorio's own data on the Mac (tags/macbackup.js) and the update (tags/macupdate.js, tools/mac/xplorio-update.sh) */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var mb = require('../tags/macbackup.js');
var mu = require('../tags/macupdate.js');

var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-bak-')); }
function w(f, s) { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, s); }

function setup() {
  var d = tmp(), data = path.join(d, 'daten'), sup = path.join(d, 'support'), target = path.join(d, 'platte');
  fs.mkdirSync(target);
  w(path.join(d, 'woanders', 'essentia.jsonl'), '{"p":"/a.flac"}\n');
  w(path.join(data, 'plays.jsonl'), 'play\n');
  w(path.join(data, 'smart-playlists', 'eins.json'), '{}');
  w(path.join(data, 'covers', 'alt.jpg'), 'img');
  w(path.join(data, 'artists', 'foto.jpg'), 'cache');
  w(path.join(data, 'tidal-cache', 'x.flac'), 'cache');
  ['tidal.json', 'lastfm.json', 'keys.json', 'admin.json', 'albums.json', 'library-tracks.json', 'ratings.json.neu'].forEach(function(f){ w(path.join(data, f), 'geheim'); });
  fs.symlinkSync(path.join(d, 'woanders', 'essentia.jsonl'), path.join(data, 'essentia.jsonl'));
  w(path.join(sup, 'xplorio.conf'), 'SUPPORT=x');
  w(path.join(sup, 'mpd', 'playlists', 'Favoriten.m3u'), 'a.flac\n');
  var now = new Date(2026, 10, 16, 1, 5).getTime();
  var b = new mb.Backup({dataDir: data, stateFile: path.join(d, 'state.json'), now: function(){ return now; },
    settings: [{from: path.join(sup, 'xplorio.conf'), as: 'einstellungen/xplorio.conf'}, {from: path.join(sup, 'config.local.js'), as: 'einstellungen/config.local.js'},
               {from: path.join(sup, 'mpd', 'playlists'), as: 'einstellungen/playlists'}]});
  return {d: d, data: data, target: target, b: b, at: function(t){ now = t; }, now: function(){ return now; }};
}
function run(b) { return new Promise(function(res, rej){ b.start(function(e){ if (e) rej(new Error(e)); }, function(e){ res(e); }); }); }
function files(dir) {
  var out = [];
  (function walk(rel){ fs.readdirSync(path.join(dir, rel)).forEach(function(n2){ var r = rel ? rel + '/' + n2 : n2; if (fs.statSync(path.join(dir, r)).isDirectory()) walk(r); else out.push(r); }); })('');
  return out.sort();
}

t('target: must exist, not inside the data folder; without one nothing starts', function(){
  var x = setup();
  return new Promise(function(res){ x.b.start(function(e){ res(e); }); }).then(function(e){
    assert.strictEqual(e, 'unset');
    assert.strictEqual(x.b.setTarget(path.join(x.d, 'fehlt')), 'missing');
    assert.strictEqual(x.b.setTarget(path.join(x.data, 'covers')), 'inside');
    assert.strictEqual(x.b.setTarget(x.target), '');
    assert.strictEqual(x.b.status().targetOk, true);
  });
});

t('a backup: data (links followed) and settings, no caches and no sign-ins; the second links unchanged files', function(){
  var x = setup();
  x.b.setTarget(x.target);
  return run(x.b).then(function(e){
    assert.strictEqual(e, '');
    var st = x.b.status(), g = path.join(x.target, 'Xplorio-Sicherung', '2026-11-16_0105');
    assert.deepStrictEqual(st.backups, ['2026-11-16_0105']);
    assert.deepStrictEqual(files(g), ['daten/covers/alt.jpg', 'daten/essentia.jsonl', 'daten/plays.jsonl', 'daten/smart-playlists/eins.json',
                                      'einstellungen/playlists/Favoriten.m3u', 'einstellungen/xplorio.conf']);
    assert.strictEqual(fs.readFileSync(path.join(g, 'daten', 'essentia.jsonl'), 'utf8'), '{"p":"/a.flac"}\n');
    assert.ok(!fs.lstatSync(path.join(g, 'daten', 'essentia.jsonl')).isSymbolicLink());
    assert.deepStrictEqual([st.lastFiles, st.lastCopied, st.lastError], [6, 6, '']);
    fs.appendFileSync(path.join(x.data, 'plays.jsonl'), 'noch einer\n');
    x.at(x.now() + 86400000);
    return run(x.b).then(function(){
      var st2 = x.b.status(), g2 = path.join(x.target, 'Xplorio-Sicherung', '2026-11-17_0105');
      assert.deepStrictEqual(st2.backups, ['2026-11-17_0105', '2026-11-16_0105']);
      assert.strictEqual(st2.lastCopied, 1);                                       /* only plays.jsonl changed */
      assert.strictEqual(fs.statSync(path.join(g2, 'daten', 'covers', 'alt.jpg')).ino, fs.statSync(path.join(g, 'daten', 'covers', 'alt.jpg')).ino);
      assert.strictEqual(fs.readFileSync(path.join(g2, 'daten', 'plays.jsonl'), 'utf8'), 'play\nnoch einer\n');
      assert.strictEqual(fs.readFileSync(path.join(g, 'daten', 'plays.jsonl'), 'utf8'), 'play\n');   /* the old one unchanged */
    });
  });
});

t('only the newest backups stay; unfinished ones are removed', function(){
  var x = setup();
  x.b.setTarget(x.target); x.b.s.keep = 2;
  fs.mkdirSync(path.join(x.target, 'Xplorio-Sicherung'));
  fs.mkdirSync(path.join(x.target, 'Xplorio-Sicherung', '2026-01-01_0100.unvollstaendig'));
  var p = Promise.resolve();
  [0, 1, 2].forEach(function(i){ p = p.then(function(){ x.at(new Date(2026, 10, 16 + i, 1, 0).getTime()); return run(x.b); }); });
  return p.then(function(){
    assert.deepStrictEqual(fs.readdirSync(path.join(x.target, 'Xplorio-Sicherung')).sort(), ['2026-11-17_0100', '2026-11-18_0100']);
  });
});

t('at night: 1 o\'clock, once a day, only with a target', function(){
  var x = setup();
  x.b.setNightly(true);
  assert.strictEqual(x.b.tick(), false);                     /* no target */
  x.b.setTarget(x.target);
  x.at(new Date(2026, 10, 16, 3, 0).getTime());
  assert.strictEqual(x.b.tick(), false);                     /* not 1 o'clock */
  x.at(new Date(2026, 10, 16, 1, 10).getTime());
  assert.strictEqual(x.b.tick(), true);
  assert.strictEqual(x.b.tick(), false);
  return new Promise(function(res){ (function wt(){ if (x.b.running()) return setTimeout(wt, 10); res(); })(); });
});

t('update: installed and newest version, newer only when the commit differs; install starts the script on its own', function(){
  var d = tmp(), state = path.join(d, 'update.json'), script = path.join(d, 'xplorio-update.sh'), urls = [], spawned = [];
  fs.writeFileSync(script, 'echo hallo\n');
  fs.writeFileSync(state, JSON.stringify({sha: 'aaa', branch: 'test', ok: true}));
  var u = new mu.Updater({repo: 'o/r', branch: function(){ return ''; }, stateFile: state, script: script, logFile: path.join(d, 'logs', 'update.log'), tmpDir: d,
    get: function(url, cb){ urls.push(url); cb(null, {sha: 'bbb', commit: {message: 'Neu\n\nmehr', committer: {date: '2026-11-16T16:00:00Z'}}}); },
    spawn: function(bin, args, o){ spawned.push([bin, args, o.detached, o.env.XPLORIO_UPDATE_STATE]); return {unref: function(){}}; }});
  return new Promise(function(res){ u.status(false, res); }).then(function(st){
    assert.deepStrictEqual(urls, ['https://api.github.com/repos/o/r/commits/test']);
    assert.strictEqual(st.newer, true);
    assert.deepStrictEqual(st.latest, {sha: 'bbb', date: '2026-11-16T16:00:00Z', message: 'Neu'});
    return new Promise(function(res){ u.status(false, res); });
  }).then(function(){
    assert.strictEqual(urls.length, 1);                      /* asked again only after 10 minutes */
    return new Promise(function(res){ u.install(res); });
  }).then(function(e){
    assert.strictEqual(e, null);
    assert.strictEqual(spawned.length, 1);
    assert.strictEqual(spawned[0][0], '/bin/bash'); assert.strictEqual(spawned[0][1][1], 'test');
    assert.notStrictEqual(spawned[0][1][0], script);         /* a copy: the build replaces the app */
    assert.strictEqual(fs.readFileSync(spawned[0][1][0], 'utf8'), 'echo hallo\n');
    assert.deepStrictEqual([spawned[0][2], spawned[0][3]], [true, state]);
    return new Promise(function(res){ u.install(res); });
  }).then(function(e){
    assert.strictEqual(e, 'running');
    fs.unlinkSync(state);                                    /* nothing installed through the button yet: the default branch */
    var u2 = new mu.Updater({repo: 'o/r', branch: function(){ return ''; }, defaultBranch: 'zweig', stateFile: state, script: script, logFile: path.join(d, 'l.log')});
    assert.strictEqual(u2.branch(), 'zweig');
    fs.writeFileSync(state, JSON.stringify({sha: 'aaa', branch: 'main', ok: false, error: 'unzip'}));
    assert.strictEqual(u2.branch(), 'zweig');                /* a failed update does not decide the branch */
    u2.o.settingsFile = path.join(d, 'update-settings.json');
    assert.strictEqual(u2.setBranch('../x'), 'value');
    assert.strictEqual(u2.setBranch('claude/anders'), '');
    assert.strictEqual(u2.branch(), 'claude/anders');
    assert.strictEqual(u2.setBranch(''), '');
    assert.strictEqual(u2.branch(), 'zweig');
  });
});

t('update script: download, commit from the zip, quit, build, update.json, start again; on an error the old commit stays', function(){
  if (!/zip/.test(cp.spawnSync('bash', ['-c', 'command -v zip && command -v unzip'], {encoding: 'utf8'}).stdout || '')) { console.log('     (zip/unzip missing: skipped)'); return; }
  var d = tmp(), bin = path.join(d, 'bin'), calls = path.join(d, 'calls'), src = path.join(d, 'xplorio-test');
  fs.mkdirSync(bin);
  w(path.join(src, 'tools', 'mac', 'make-app.sh'), 'echo "make-app $XPLORIO_SUPPORT" >>"' + calls + '"\n');
  var sha = '0123456789abcdef0123456789abcdef01234567';
  cp.execFileSync('bash', ['-c', 'cd "' + d + '" && zip -qr src.zip xplorio-test && echo ' + sha + ' | zip -qz src.zip']);
  var shim = function(name, body){ fs.writeFileSync(path.join(bin, name), '#!/bin/bash\n' + body + '\n', {mode: 493}); };
  shim('curl', 'echo "curl $*" >>"' + calls + '"; [ -n "$FAIL" ] && exit 22; out=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done; cp "' + path.join(d, 'src.zip') + '" "$out"');
  shim('pgrep', 'f="' + path.join(d, 'running') + '"; [ -f "$f" ] && exit 0; exit 1');
  shim('osascript', 'echo "quit" >>"' + calls + '"; rm -f "' + path.join(d, 'running') + '"');
  shim('open', 'echo "open $*" >>"' + calls + '"');
  var state = path.join(d, 'sup', 'update.json');
  var env = {}; Object.keys(process.env).forEach(function(k){ env[k] = process.env[k]; });
  env.PATH = bin + ':' + env.PATH; env.XPLORIO_SUPPORT = path.join(d, 'sup'); env.TMPDIR = d; env.XPLORIO_REPO = 'o/r';
  fs.writeFileSync(path.join(d, 'running'), '');
  var r = cp.spawnSync('bash', [path.join(__dirname, '..', 'tools', 'mac', 'xplorio-update.sh'), 'zweig'], {env: env, encoding: 'utf8'});
  assert.strictEqual(r.status, 0, r.stderr);
  var c = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.ok(/^curl .*https:\/\/github.com\/o\/r\/archive\/refs\/heads\/zweig.zip/.test(c[0]), c[0]);
  assert.deepStrictEqual(c.slice(1), ['quit', 'make-app ' + path.join(d, 'sup'), 'open -a Xplorio']);
  var s = JSON.parse(fs.readFileSync(state, 'utf8'));
  assert.deepStrictEqual([s.sha, s.branch, s.ok, s.error], [sha, 'zweig', true, '']);
  assert.deepStrictEqual(fs.readdirSync(d).filter(function(f){ return /^xplorio-update\./.test(f); }), []);   /* cleaned up */
  env.FAIL = '1';
  r = cp.spawnSync('bash', [path.join(__dirname, '..', 'tools', 'mac', 'xplorio-update.sh'), 'zweig'], {env: env, encoding: 'utf8'});
  assert.notStrictEqual(r.status, 0);
  s = JSON.parse(fs.readFileSync(state, 'utf8'));
  assert.deepStrictEqual([s.sha, s.ok, s.error], [sha, false, 'download']);
  assert.ok(/open -a Xplorio$/.test(fs.readFileSync(calls, 'utf8').trim()));   /* Xplorio is started again anyway */
});

(function next(i){
  if (i >= queue.length) { console.log(n + ' tests passed'); return; }
  Promise.resolve().then(function(){ return queue[i][1](); }).then(function(){ n++; console.log('ok   ' + queue[i][0]); next(i + 1); },
    function(e){ console.error('FAIL ' + queue[i][0]); console.error(e && e.stack || e); process.exit(1); });
})(0);
