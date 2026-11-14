/* MPD as the player without Volumio (tags/mpdplayer.js): MPD protocol with command lists and binary answers,
   state and queue in Volumio's shape, commands, items -> add commands, covers in pieces, live changes */
var assert = require('assert');
var net = require('net');
var m = require('../tags/mpdplayer.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) {                                     /* asynchronous: fn(done) */
  pending++;
  var timer = setTimeout(function(){ console.log('FAIL ' + name + ': timeout'); process.exit(1); }, 5000);
  fn(function(){ clearTimeout(timer); n++; console.log('ok   ' + name); if (!--pending) end(); });
}
function end() { console.log(n + ' tests passed'); process.exit(0); }

var STATUS = ['volume: 70', 'repeat: 1', 'random: 0', 'single: 1', 'consume: 0', 'state: play', 'song: 3', 'elapsed: 12.345',
              'duration: 245.6', 'bitrate: 912', 'audio: 96000:24:2'];
var SONG = ['file: USB/Pink Floyd/Animals/01 Dogs.flac', 'Artist: Pink Floyd', 'Album: Animals', 'Title: Dogs', 'Track: 1',
            'duration: 245.600', 'Time: 246'];

t('state in the shape of Volumio\'s getState', function(){
  var st = m.toState(m.fields(STATUS), m.songs(SONG)[0], false);
  assert.strictEqual(st.status, 'play');
  assert.strictEqual(st.position, 3);
  assert.strictEqual(st.title, 'Dogs');
  assert.strictEqual(st.artist, 'Pink Floyd');
  assert.strictEqual(st.uri, 'music-library/USB/Pink Floyd/Animals/01 Dogs.flac');
  assert.strictEqual(st.albumart, '/mpd/art?file=' + encodeURIComponent('USB/Pink Floyd/Animals/01 Dogs.flac'));
  assert.strictEqual(st.trackType, 'flac');
  assert.strictEqual(st.service, 'mpd');
  assert.strictEqual(st.seek, 12345);
  assert.strictEqual(st.duration, 246);
  assert.strictEqual(st.samplerate, '96 kHz');
  assert.strictEqual(st.bitdepth, '24 bit');
  assert.strictEqual(st.bitrate, '912 Kbps');
  assert.strictEqual(st.repeat, true);
  assert.strictEqual(st.repeatSingle, true);
  assert.strictEqual(st.random, false);
  assert.strictEqual(st.volume, 70);
  assert.strictEqual(st.disableVolumeControl, false);
});

t('stopped, empty queue, no mixer, muted', function(){
  var st = m.toState({state: 'stop', volume: '-1'}, {}, false);
  assert.strictEqual(st.status, 'stop');
  assert.strictEqual(st.uri, '');
  assert.strictEqual(st.title, '');
  assert.strictEqual(st.albumart, '');
  assert.strictEqual(st.disableVolumeControl, true);
  var mu = m.toState({state: 'pause', volume: '0'}, {file: 'a.mp3'}, true);
  assert.strictEqual(mu.mute, true);
  assert.strictEqual(mu.volume, 0);
  assert.strictEqual(mu.title, 'a');                               /* no tags: file name */
});

t('radio: station name, ICY title, no cover from MPD', function(){
  var st = m.toState({state: 'play'}, {file: 'http://stream.example/radio.mp3', name: 'Radio X', title: 'Artist - Song'}, false);
  assert.strictEqual(st.trackType, 'webradio');
  assert.strictEqual(st.service, 'webradio');
  assert.strictEqual(st.title, 'Artist - Song');
  assert.strictEqual(st.uri, 'http://stream.example/radio.mp3');
  assert.strictEqual(st.albumart, '');
  assert.strictEqual(m.toState({state: 'play'}, {file: 'https://s.example/x', name: 'Radio Y'}, false).title, 'Radio Y');
});

t('audio formats: PCM, float, DSD', function(){
  assert.deepStrictEqual(m.audioOf('44100:16:2'), {samplerate: '44.1 kHz', bitdepth: '16 bit', channels: 2});
  assert.deepStrictEqual(m.audioOf('48000:f:2'), {samplerate: '48 kHz', bitdepth: '32 bit', channels: 2});
  assert.deepStrictEqual(m.audioOf('dsd64:2'), {samplerate: '2.82 MHz', bitdepth: '1 bit', channels: 2});
  assert.deepStrictEqual(m.audioOf(''), {samplerate: '', bitdepth: '', channels: 0});
});

t('queue entries like Volumio\'s getQueue', function(){
  var q = m.songs(SONG.concat(['file: USB/x/02 Pigs.flac', 'Title: Pigs (Three Different Ones)', 'Time: 683'])).map(m.toItem);
  assert.strictEqual(q.length, 2);
  assert.strictEqual(q[0].name, 'Dogs');
  assert.strictEqual(q[0].service, 'mpd');
  assert.strictEqual(q[1].uri, 'music-library/USB/x/02 Pigs.flac');
  assert.strictEqual(q[1].duration, 683);
});

t('items -> add or find', function(){
  assert.deepStrictEqual(m.itemTarget({uri: 'music-library/USB/A/B/01.flac', service: 'mpd'}), {add: 'USB/A/B/01.flac'});
  assert.deepStrictEqual(m.itemTarget({uri: 'mnt/USB/A/B', type: 'folder'}), {add: 'USB/A/B'});
  assert.deepStrictEqual(m.itemTarget({uri: 'http://radio.example/x', service: 'webradio'}), {add: 'http://radio.example/x'});
  assert.deepStrictEqual(m.itemTarget({uri: 'albums://Pink%20Floyd/Animals'}), {find: 'find albumartist "Pink Floyd" album "Animals"'});
  assert.strictEqual(m.itemTarget({uri: 'tidal://album/1', service: 'tidal'}), null);
});

/* stand-in for MPD: answers per command from a table, records what came */
function fakeMpd(table) {
  var seen = [];
  function mpd(cmds, cb) {
    seen.push(cmds);
    var lists = [], bin = null;
    for (var i = 0; i < cmds.length; i++) {
      var a = table[cmds[i]] || table[cmds[i].split(' ')[0]];
      if (a instanceof Error) return setImmediate(function(){ cb(a, lists, null); });
      if (a && a.bin) { lists.push(a.lines); bin = a.bin; } else lists.push(a || []);
    }
    setImmediate(function(){ cb(null, lists, bin); });
  }
  return {mpd: mpd, seen: seen};
}

ta('commands map to MPD', function(done){
  var f = fakeMpd({status: ['state: play', 'volume: 40']});
  var p = new m.Player({mpd: f.mpd, idle: function(){ return function(){}; }});
  var steps = [
    [{action: 'toggle'}, ['pause 1']],
    [{action: 'play', pos: 4}, ['play 4']],
    [{action: 'prev'}, ['previous']],
    [{action: 'seek', sec: 90}, ['seekcur 90']],
    [{action: 'repeat', value: true, repeatSingle: false}, ['repeat 1', 'single 0']],
    [{action: 'random', on: true}, ['random 1']],
    [{action: 'move', from: 5, to: 1}, ['move 5 1']],
    [{action: 'remove', pos: 2}, ['delete 2']],
    [{action: 'volume', value: 55}, ['setvol 55']],
    [{action: 'mute'}, ['setvol 0']],
    [{action: 'unmute'}, ['setvol 40']]
  ], i = 0;
  (function next(){
    if (i >= steps.length) {
      p.command({action: 'seek', sec: 'x'}, function(c){
        assert.strictEqual(c, 400);
        p.command({action: 'rm -rf'}, function(c2){ assert.strictEqual(c2, 400); done(); });
      });
      return;
    }
    var s = steps[i++];
    f.seen.length = 0;
    p.command(s[0], function(code, o){
      assert.strictEqual(code, 200, JSON.stringify(s[0]));
      assert.ok(o.ok);
      assert.deepStrictEqual(f.seen[f.seen.length - 1], s[1], JSON.stringify(s[0]));
      next();
    });
  })();
});

ta('replace: clear, add sorted album tracks, play from the start; album without album artist found by artist', function(done){
  var f = fakeMpd({
    'find albumartist "Nena" album "99 Luftballons"': [],
    'find artist "Nena" album "99 Luftballons"': ['file: N/99/02.flac', 'Album: 99 Luftballons', 'Track: 2', 'file: N/99/01.flac', 'Album: 99 Luftballons', 'Track: 1'],
    'clear': [], 'add': [], 'play': []
  });
  var p = new m.Player({mpd: f.mpd});
  p.command({action: 'replace', items: [{uri: 'albums://Nena/99%20Luftballons'}, {uri: 'tidal://track/1', service: 'tidal'}]}, function(code, o){
    assert.strictEqual(code, 200);
    assert.deepStrictEqual(o, {ok: true, added: 2, skipped: 1});
    assert.deepStrictEqual(f.seen[f.seen.length - 1], ['clear', 'add "N/99/01.flac"', 'add "N/99/02.flac"', 'play 0']);
    var before = f.seen.length;
    p.command({action: 'replace', items: [{uri: 'tidal://track/1', service: 'tidal'}]}, function(c2, o2){
      assert.strictEqual(o2.ok, false);                          /* nothing playable: the queue stays */
      assert.strictEqual(f.seen.length, before);
      done();
    });
  });
});

ta('cover in pieces: albumart, else readpicture', function(done){
  var calls = [];
  function mpd(cmds, cb) {
    calls.push(cmds[0]);
    var off = +cmds[0].split(' ').pop();
    if (/^albumart /.test(cmds[0])) return setImmediate(function(){ cb(new Error('ACK [50@0] {albumart} No file exists'), [[]], null); });
    var all = Buffer.from([0x89, 0x50, 1, 2, 3, 4, 5]);
    var part = all.slice(off, off + 3);
    setImmediate(function(){ cb(null, [['size: 7']], part); });
  }
  new m.Player({mpd: mpd}).art('USB/a/b.flac', function(err, img){
    assert.ifError(err);
    assert.strictEqual(img.mime, 'image/png');
    assert.strictEqual(img.body.length, 7);
    assert.deepStrictEqual(calls, ['albumart "USB/a/b.flac" 0', 'readpicture "USB/a/b.flac" 0', 'readpicture "USB/a/b.flac" 3', 'readpicture "USB/a/b.flac" 6']);
    done();
  });
});

ta('live changes: one push per burst, queue event when the queue changed, idle stops with the last listener', function(done){
  var onChange = null, stopped = 0;
  var f = fakeMpd({status: ['state: play'], currentsong: ['file: a.flac']});
  var p = new m.Player({mpd: f.mpd, idle: function(cb){ onChange = cb; return function(){ stopped++; }; }});
  var out = '';
  var res = {write: function(s){ out += s; }};
  var stop = p.listen(res);
  setTimeout(function(){
    assert.strictEqual((out.match(/event: state/g) || []).length, 1);        /* the state right away */
    onChange(['playlist']); onChange(['player']);
    setTimeout(function(){
      assert.strictEqual((out.match(/event: state/g) || []).length, 2);
      assert.strictEqual((out.match(/event: queue/g) || []).length, 1);
      stop();
      assert.strictEqual(stopped, 1);
      done();
    }, 200);
  }, 50);
});

ta('protocol: command list with list_OK, binary answer, ACK', function(done){
  var server = net.createServer(function(c){
    c.write('OK MPD 0.23.5\n');
    var buf = '';
    c.on('data', function(d){
      buf += d;
      if (/command_list_end\n$/.test(buf)) { c.write('state: play\nlist_OK\nfile: x.flac\nTitle: X\nlist_OK\nOK\n'); buf = ''; }
      else if (/^albumart .*\n$/.test(buf)) {
        c.write(Buffer.concat([Buffer.from('size: 4\ntype: image/jpeg\nbinary: 4\n'), Buffer.from([0xff, 0x0a, 0xd8, 0x0a]), Buffer.from('\nOK\n')]));
        buf = '';
      }
      else if (/^bogus\n$/.test(buf)) { c.write('ACK [5@0] {} unknown command "bogus"\n'); buf = ''; }
      else if (/^close\n$/.test(buf)) c.end();
    });
  }).listen(0, '127.0.0.1', function(){
    var o = {host: '127.0.0.1', port: server.address().port};
    m.request(o, ['status', 'currentsong'], function(err, lists){
      assert.ifError(err);
      assert.deepStrictEqual(lists, [['state: play'], ['file: x.flac', 'Title: X'], []]);
      m.request(o, ['albumart "x.flac" 0'], function(e2, l2, bin){
        assert.ifError(e2);
        assert.deepStrictEqual(l2[0], ['size: 4', 'type: image/jpeg']);
        assert.deepStrictEqual(Array.prototype.slice.call(bin), [0xff, 0x0a, 0xd8, 0x0a]);   /* line feeds inside the image stay */
        m.request(o, ['bogus'], function(e3){
          assert.ok(/unknown command/.test(e3 && e3.message));
          server.close();
          done();
        });
      });
    });
  });
});
