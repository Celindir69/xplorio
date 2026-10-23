/* library check: evaluation, spelling key, reading from a fake MPD, folders without image */
var assert = require('assert'), net = require('net'), fs = require('fs'), path = require('path'), os = require('os');
var lc = require('../tags/libcheck.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function S(file, o) { var s = {file: file, artist: '', albumartist: '', album: '', title: '', track: '', date: ''}; for (var k in o) s[k] = o[k]; return s; }

var songs = [
  S('USB/A/Album1/01.flac', {artist: 'Spliff', albumartist: 'Spliff', album: '85555', title: 'Carbonara', track: '1', date: '1982'}),
  S('USB/A/Album1/02.flac', {artist: 'Spliff', albumartist: 'Spliff', album: '85555', title: 'Deja Vu', track: '2', date: '1982-05-01'}),
  S('USB/C/NDW/01.flac', {artist: 'SPLIFF', album: 'NDW Hits', title: 'Das Blech', track: '1', date: '1999'}),
  S('USB/C/NDW/02.flac', {artist: 'Nena', album: 'NDW Hits', title: '99 Luftballons', track: '', date: '1999'}),
  S('USB/C/Mix/01.flac', {artist: 'The Cure', albumartist: 'Various Artists', album: 'Mix', track: '1', date: '2001'}),
  S('USB/C/Mix/02.flac', {artist: 'Cure', albumartist: 'Various', album: 'Mix 2', track: '2', date: '2003'}),
  S('USB/D/Café/01.flac', {artist: 'Café del Mar', album: 'C', track: '1'}),
  S('USB/D/Cafe/01.flac', {artist: 'Cafe Del Mar', album: 'C', track: '1'})
];
var r = lc.analyze(songs, function(d){ return d !== 'USB/C/NDW'; });
t('counters', function(){ assert.strictEqual(r.songs, 8); assert.strictEqual(r.albums, 5); });
t('no cover: only the folder without image', function(){
  assert.deepStrictEqual(r.noCover.map(function(x){ return x.dir; }), ['USB/C/NDW']);
  assert.deepStrictEqual(r.noCover[0].files[0], {uri: 'USB/C/NDW/01.flac', title: 'Das Blech'});
});
t('album artist: compilation without and with inconsistent album artist', function(){
  assert.deepStrictEqual(r.albumArtist.map(function(x){ return x.dir; }), ['USB/C/Mix', 'USB/C/NDW']);
  var ndw = r.albumArtist[1];
  assert.strictEqual(ndw.missing, true); assert.deepStrictEqual(ndw.artists, ['SPLIFF', 'Nena']);
});
t('inconsistent: album name or year (same year in another format does not count)', function(){
  assert.deepStrictEqual(r.mixed.map(function(x){ return x.dir; }), ['USB/C/Mix']);
  assert.deepStrictEqual(r.mixed[0].albums, ['Mix', 'Mix 2']); assert.deepStrictEqual(r.mixed[0].years, ['2001', '2003']);
});
t('no track number', function(){
  assert.deepStrictEqual(r.noTrack.map(function(x){ return [x.dir, x.missing]; }), [['USB/C/NDW', 1]]);
});
t('spellings: case, The, accents', function(){
  var g = r.spelling.map(function(x){ return x.variants.map(function(v){ return v.name; }).sort().join('|'); });
  assert.ok(g.indexOf('SPLIFF|Spliff') >= 0);
  assert.ok(g.indexOf('Cure|The Cure') >= 0);
  assert.ok(g.indexOf('Cafe Del Mar|Café del Mar') >= 0);
  assert.ok(!g.some(function(x){ return /Various/.test(x); }));     /* "Various" and "Various Artists" are different */
  assert.strictEqual(r.spelling.filter(function(x){ return x.variants[0].name === 'Spliff'; })[0].variants[0].count, 2);
});
t('artistKey', function(){
  assert.strictEqual(lc.artistKey('Simon & Garfunkel'), lc.artistKey('Simon and Garfunkel'));
  assert.notStrictEqual(lc.artistKey('Nena'), lc.artistKey('Nina'));
});

var root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
['USB/A/Album1', 'USB/C/NDW'].forEach(function(d){ fs.mkdirSync(path.join(root, d), {recursive: true}); });
fs.writeFileSync(path.join(root, 'USB/A/Album1/folder.JPG'), 'x');
lc.dirsWithoutImage(songs.slice(0, 4), root, function(list){
  t('folders without image file (asynchronous)', function(){
    assert.deepStrictEqual(list, [{dir: 'USB/C/NDW', file: 'USB/C/NDW/01.flac'}]);
  });
});

/* fake MPD: lsinfo per folder */
var tree = {
  '': 'directory: USB\nplaylist: x.m3u\n',
  'USB': 'directory: USB/A\ndirectory: USB/kaputt\ndirectory: USB/S\n',
  'USB/S': 'directory: USB/S/Abbey Road\ndirectory: USB/S/Abbey Road (Remastered)\n',
  'USB/S/Abbey Road': 'file: USB/S/Abbey Road/1.mp3\nArtist: The Beatles\nAlbum: Abbey Road\nFormat: 44100:24:2\nTime: 259\n',
  'USB/S/Abbey Road (Remastered)': 'file: USB/S/Abbey Road (Remastered)/1.flac\nArtist: Beatles\nAlbum: Abbey Road (2019 Remaster)\nFormat: 96000:24:2\nTime: 260\n',
  'USB/A': 'file: USB/A/1.flac\nArtist: Spliff\nArtist: Zweiter\nAlbum: 85555\nTrack: 1\nTitle: Carbonara\nGenre: Rock\nTime: 245\nfile: USB/A/2.flac\nTitle: Ohne Tags\n'
};
var srv = net.createServer(function(c){
  c.write('OK MPD 0.19.0\n');
  var b = '';
  c.on('data', function(d){
    b += d;
    var i;
    while ((i = b.indexOf('\n')) >= 0) {
      var l = b.slice(0, i); b = b.slice(i + 1);
      if (l === 'status') { c.write('state: stop\nOK\n'); continue; }
      var m = /^lsinfo "(.*)"$/.exec(l);
      if (!m) continue;
      if (tree.hasOwnProperty(m[1])) c.write(tree[m[1]] + 'OK\n');
      else c.write('ACK [50@0] {lsinfo} No such directory\n');
    }
  });
});
srv.listen(0, function(){
  var prog = [];
  lc.mpdWalk({port: srv.address().port}, function(err, list, dirs){
    t('read MPD: all folders, tracks with tags, broken folder skipped', function(){
      assert.ifError(err);
      assert.strictEqual(dirs, 7);
      assert.strictEqual(list.length, 4);
      assert.deepStrictEqual(list[0], {file: 'USB/A/1.flac', artist: 'Spliff', albumartist: '', album: '85555', title: 'Carbonara', track: '1', date: '', genre: 'Rock', time: '245', 'last-modified': '', disc: '', format: ''});
      assert.strictEqual(list[3].format, '96000:24:2');
      assert.strictEqual(list[1].title, 'Ohne Tags');
      assert.ok(prog.length >= 3);
    });
    lc.mpdWalk({port: 1}, function(err2){
      t('MPD unreachable: error instead of hanging', function(){ assert.ok(err2); });
      service(srv.address().port);
    });
  }, function(d, total){ prog.push([d, total]); });
});

/* service: POST /check starts, GET /check returns progress and then the saved result */
function service(mpdPort) {
  var http = require('http');
  process.env.MUSIC_ROOT = root; process.env.MPD_PORT = String(mpdPort);
  process.env.TAGS_LOG = path.join(root, 'log', 'changes.jsonl'); process.env.PYTHON = 'false';
  var mpcLog = path.join(root, 'mpc.log');                 /* fake mpc: notes its arguments */
  fs.writeFileSync(path.join(root, 'mpc'), '#!/bin/sh\necho "$@" >> "' + mpcLog + '"\n', {mode: 493});
  process.env.MPC = path.join(root, 'mpc');
  fs.mkdirSync(path.join(root, 'log'));
  var s2 = require('../tags/tag-service.js').server;
  function call(method, route, cb, body) {
    var req = http.request({port: s2.address().port, path: route, method: method, headers: {'X-Xplorio': '1'}}, function(res){
      var d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ cb(JSON.parse(d)); });
    });
    req.end(method === 'POST' ? JSON.stringify(body || {}) : undefined);
  }
  ['USB/S/Abbey Road', 'USB/S/Abbey Road (Remastered)'].forEach(function(d){ fs.mkdirSync(path.join(root, d), {recursive: true}); });
  s2.listen(0, function(){
    call('GET', '/check', function(r0){
      t('service: no result before the first check', function(){ assert.ok(r0.ok); assert.strictEqual(r0.result, null); });
      call('POST', '/check', function(r1){
        t('service: POST /check runs in the background', function(){ assert.ok(r1.ok && r1.running); });
        (function poll(k) {
          call('GET', '/check', function(r){
            if (r.running && k < 50) return setTimeout(function(){ poll(k + 1); }, 100);
            t('service: result saved', function(){
              assert.ok(!r.running && !r.error && r.result);
              assert.strictEqual(r.result.songs, 4);
              assert.deepStrictEqual(r.result.noCover.map(function(x){ return x.dir; }), ['USB/A', 'USB/S/Abbey Road', 'USB/S/Abbey Road (Remastered)']);     /* Python missing: counts as without cover */
              assert.ok(fs.existsSync(path.join(root, 'log', 'check.json')));
              var d = r.result.duplicates;
              assert.strictEqual(d.length, 1);
              assert.deepStrictEqual(d[0].versions.map(function(v){ return [v.dirs[0], v.format, v.keep]; }),
                [['USB/S/Abbey Road (Remastered)', 'FLAC 24/96', true], ['USB/S/Abbey Road', 'MP3', false]]);
            });
            call('POST', '/dupmove', function(m1){
              t('service: /dupmove refuses folders that are not listed as duplicates', function(){
                assert.ok(!m1.ok && /not a duplicate/.test(m1.error));
                assert.ok(fs.existsSync(path.join(root, 'USB/A')));
              });
              call('POST', '/dupmove', function(m2){
                t('service: /dupmove moves into .duplicates on the same drive and marks it done', function(){
                  assert.ok(m2.ok, m2.error);
                  assert.deepStrictEqual(m2.moved, [{from: 'USB/S/Abbey Road', to: 'USB/S/.duplicates/Abbey Road'}]);
                  assert.ok(!fs.existsSync(path.join(root, 'USB/S/Abbey Road')));
                  assert.ok(fs.statSync(path.join(root, 'USB/S/.duplicates/Abbey Road')).isDirectory());
                  var saved = JSON.parse(fs.readFileSync(path.join(root, 'log', 'check.json'), 'utf8'));
                  assert.strictEqual(saved.done['duplicates|USB/S/Abbey Road'], 1);
                });
                call('POST', '/dupmove', function(m3){
                  t('service: /dupmove of a folder that is already gone fails', function(){ assert.ok(!m3.ok); });
                  call('POST', '/scan', function(){                 /* check closed: collected scans run now */
                    setTimeout(function(){
                      t('service: after moving, MPD rescans exactly the moved folder, not its parent or the drive', function(){
                        assert.strictEqual(fs.readFileSync(mpcLog, 'utf8'), 'update USB/S/Abbey Road\n');
                      });
                      s2.close(); srv.close();
                      console.log(n + ' checks');
                      process.exit(0);
                    }, 500);
                  }, {hold: false});
                }, {dirs: ['USB/S/Abbey Road']});
              }, {dirs: ['USB/S/Abbey Road']});
            }, {dirs: ['USB/A']});
          });
        })(0);
      });
    });
  });
}
