/* Settings page on the Mac (tags/macsettings.js): music folders as links, audio analysis file, interface settings, Last.fm */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var ms = require('../tags/macsettings.js');
var appdata = require('../tags/appdata.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; console.log('ok   ' + name); if (!--pending) console.log(n + ' tests passed'); }); }

function setup() {
  var d = fs.mkdtempSync(path.join(os.tmpdir(), 'xplorio-ms-'));
  ['root', 'data', 'support', 'web', 'A', 'B', 'C'].forEach(function(x){ fs.mkdirSync(path.join(d, x)); });
  fs.writeFileSync(path.join(d, 'support', 'config.local.js'), "/* own settings */\nwindow.APP_CONFIG.PLAYER = 'mpd';\nwindow.APP_CONFIG.LANGUAGE = 'de';\nwindow.APP_CONFIG.MY_OWN = 1;\n");
  fs.symlinkSync(path.join(d, 'support', 'config.local.js'), path.join(d, 'web', 'config.local.js'));   /* like in the program */
  var scans = [];
  var s = new ms.MacSettings({musicRoot: path.join(d, 'root'), configFile: path.join(d, 'web', 'config.local.js'), keys: new appdata.Keys(path.join(d, 'data')),
                              essentiaFile: path.join(d, 'data', 'essentia.jsonl'), scan: function(cb){ scans.push(1); cb(); },
                              essentiaStatus: function(){ return {tracks: 7}; }});
  s.dir = d; s.scans = scans;
  return s;
}
function cfgOf(file) {
  var ctx = {window: {APP_CONFIG: {}}};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return ctx.window.APP_CONFIG;
}

t('music: first folder becomes the place, a second turns it into a folder of links; removing takes only the link', function(){
  var s = setup(), d = s.dir;
  assert.deepStrictEqual(s.musicAdd('USB', path.join(d, 'A')), {ok: true, rel: 'USB'});
  assert.strictEqual(fs.readlinkSync(path.join(d, 'root', 'USB')), path.join(d, 'A'));
  assert.deepStrictEqual(s.musicAdd('USB', path.join(d, 'B') + '/'), {ok: true, rel: 'USB/B'});
  assert.ok(fs.lstatSync(path.join(d, 'root', 'USB')).isDirectory());
  assert.deepStrictEqual(s.music().map(function(m){ return [m.rel, m.target]; }), [['USB/A', path.join(d, 'A')], ['USB/B', path.join(d, 'B')]]);
  assert.strictEqual(s.musicAdd('USB', path.join(d, 'B')).error, 'exists');
  assert.strictEqual(s.musicAdd('HOME', path.join(d, 'C')).error, 'slot');
  assert.strictEqual(s.musicAdd('NAS', path.join(d, 'gibtsnicht')).error, 'path');
  assert.strictEqual(s.musicAdd('NAS', 'C').error, 'path');
  assert.strictEqual(s.musicAdd('NAS', path.join(d, 'root')).error, 'inside');
  assert.strictEqual(s.musicAdd('NAS', d).error, 'inside');               /* would contain the music folder itself */
  assert.deepStrictEqual(s.musicRemove('USB/A'), {ok: true});
  assert.ok(fs.existsSync(path.join(d, 'A')));                            /* the music stays */
  assert.strictEqual(s.musicRemove('USB').error, 'notlink');
  assert.strictEqual(s.musicRemove('USB/../..').error, 'path');
});

t('music: a real folder with music shows as such', function(){
  var s = setup(), d = s.dir;
  fs.mkdirSync(path.join(d, 'root', 'INTERNAL'));
  fs.writeFileSync(path.join(d, 'root', 'INTERNAL', 'a.flac'), '');
  assert.deepStrictEqual(s.music().map(function(m){ return [m.rel, m.link]; }), [['INTERNAL', false]]);
});

t('audio analysis: link, a copy there before is kept', function(){
  var s = setup(), d = s.dir, src = path.join(d, 'A', 'essentia.jsonl'), f = path.join(d, 'data', 'essentia.jsonl');
  fs.writeFileSync(src, '{"a":1}\n');
  fs.writeFileSync(f, 'old\n');
  assert.strictEqual(s.essentiaLink(path.join(d, 'A', 'other.txt')).error, 'path');
  assert.deepStrictEqual(s.essentiaLink(src), {ok: true});
  assert.strictEqual(fs.readlinkSync(f), src);
  assert.strictEqual(fs.readFileSync(f + '.bak', 'utf8'), 'old\n');
  var e = s.read({}).essentia;
  assert.strictEqual(e.linked, true); assert.strictEqual(e.target, src); assert.strictEqual(e.tracks, 7);
});

t('interface settings: written through the link, own lines stay, values the page sets move up', function(){
  var s = setup(), d = s.dir, file = path.join(d, 'support', 'config.local.js');
  var cfg = cfgOf(file);
  assert.strictEqual(s.settings(cfg).language, 'de');
  assert.strictEqual(s.saveSettings({theme: 'purple'}, cfg).error, 'value');
  var r = s.saveSettings({theme: 'dark', history: false, allowedHosts: 'mac.local, 10.0.0.2'}, cfg);
  assert.ok(r.ok);
  assert.ok(fs.lstatSync(path.join(d, 'web', 'config.local.js')).isSymbolicLink());
  var text = fs.readFileSync(file, 'utf8'), c = cfgOf(file);
  assert.strictEqual(c.PLAYER, 'mpd'); assert.strictEqual(c.THEME, 'dark'); assert.strictEqual(c.HISTORY, false);
  assert.strictEqual(c.LANGUAGE, 'de'); assert.strictEqual(c.MY_OWN, 1);
  assert.deepStrictEqual([].slice.call(c.ALLOWED_HOSTS), ['mac.local', '10.0.0.2']);
  assert.strictEqual((text.match(/PLAYER/g) || []).length, 1);
  assert.strictEqual((text.match(/LANGUAGE/g) || []).length, 1);
  assert.ok(text.indexOf(ms.MARK) < text.indexOf('MY_OWN'));
  s.saveSettings({language: 'en'}, c);
  c = cfgOf(file);
  assert.strictEqual(c.LANGUAGE, 'en'); assert.strictEqual(c.THEME, 'dark'); assert.strictEqual(c.MY_OWN, 1);
});

ta('commands: Last.fm, folders with a rescan, unknown', function(done){
  var s = setup(), d = s.dir;
  s.command({action: 'lastfm', key: 'abc def'}, {}, function(c, r){
    assert.strictEqual(r.error, 'lastfm');
    s.command({action: 'lastfm', key: 'abc123', secret: 'xyz'}, {}, function(c2, r2){
      assert.deepStrictEqual(r2.lastfm, {key: true, secret: true});
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'data', 'keys.json'), 'utf8')).LASTFM_KEY, 'abc123');
      s.command({action: 'lastfm', clear: true}, {}, function(c3, r3){
        assert.deepStrictEqual(r3.lastfm, {key: false, secret: false});
        s.command({action: 'musicAdd', slot: 'NAS', path: path.join(d, 'C')}, {}, function(c4, r4){
          assert.strictEqual(r4.music[0].rel, 'NAS');
          assert.strictEqual(s.scans.length, 1);
          s.command({action: 'settings', settings: {theme: 'light'}}, {}, function(c5, r5){
            assert.strictEqual(r5.reload, true);
            s.command({action: 'rm'}, {}, function(c6){ assert.strictEqual(c6, 400); done(); });
          });
        });
      });
    });
  });
});
