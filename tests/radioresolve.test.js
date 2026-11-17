/* radioresolve.js: TuneIn Tune.ashx, .pls and .m3u resolved to a stream address for MPD; the station's own address back on the state */
var assert = require('assert'), http = require('http');
var rr = require('../tags/radioresolve.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

t('which addresses are playlists', function(){
  assert.ok(rr.isPlaylist('http://opml.radiotime.com/Tune.ashx?id=s307915'));
  assert.ok(rr.isPlaylist('https://x.de/live.pls') && rr.isPlaylist('http://x.de/a.m3u?x=1'));
  assert.ok(!rr.isPlaylist('http://internetradio.salue.de:8000/salue.mp3') && !rr.isPlaylist('https://x.de/hls.m3u8'));
});
t('PLS and M3U text', function(){
  assert.deepStrictEqual(rr.parse('[playlist]\nNumberOfEntries=2\nFile1=http://a/1\nTitle1=x\nFile2=http://a/2\n'), ['http://a/1', 'http://a/2']);
  assert.deepStrictEqual(rr.parse('#EXTM3U\n#EXTINF:-1,x\nhttp://s/1.mp3\r\nhttp://s/2.aac\n'), ['http://s/1.mp3', 'http://s/2.aac']);
  assert.deepStrictEqual(rr.parse('notcompatible'), []);
});

/* a small server: Tune.ashx -> .pls -> stream; a direct audio answer stays as it is */
var srv = http.createServer(function(req, res){
  var base = 'http://127.0.0.1:' + srv.address().port;
  if (/^\/Tune\.ashx/.test(req.url)) { res.writeHead(200, {'Content-Type': 'audio/x-mpegurl'}); return res.end(base + '/list.pls\n'); }
  if (req.url === '/list.pls') { res.writeHead(200, {'Content-Type': 'audio/x-scpls'}); return res.end('[playlist]\nFile1=' + base + '/stream.mp3\n'); }
  if (req.url === '/moved.m3u') { res.writeHead(302, {Location: '/real.m3u'}); return res.end(); }
  if (req.url === '/real.m3u') { res.writeHead(200, {'Content-Type': 'audio/mpegurl'}); return res.end('#EXTM3U\n' + base + '/b.mp3\n'); }
  if (req.url === '/audio.m3u') { res.writeHead(200, {'Content-Type': 'audio/mpeg'}); res.write(Buffer.alloc(1000)); return; }   /* endless stream */
  res.writeHead(404); res.end();
});
srv.listen(0, '127.0.0.1', function(){
  var base = 'http://127.0.0.1:' + srv.address().port;
  /* the real get(), but with the test server standing in for opml.radiotime.com */
  var r = new rr.Resolver({get: function(u, cb){ rr.get(u.replace('http://opml.radiotime.com', base), cb); }});
  var item = {service: 'webradio', uri: 'http://opml.radiotime.com/Tune.ashx?id=s362142', title: 'Tears for Fears Radio', albumart: 'https://logo/x.png'};
  assert.ok(r.handles(item) && !r.handles({service: 'webradio', uri: base + '/stream.mp3'}));
  r.expand(item, function(e, files){
    t('Tune.ashx -> PLS -> stream address; state and queue show the station', function(){
      assert.deepStrictEqual(files, [base + '/stream.mp3']);
      var st = {title: base + '/stream.mp3', uri: base + '/stream.mp3', albumart: ''};
      assert.ok(r.decorate(base + '/stream.mp3', st));
      assert.deepStrictEqual(st, {title: 'Tears for Fears Radio', uri: item.uri, albumart: 'https://logo/x.png'});
      var playing = {title: 'Shout', uri: '', albumart: ''};      /* ICY title from the station stays */
      r.decorate(base + '/stream.mp3', playing);
      assert.strictEqual(playing.title, 'Shout');
      assert.ok(!r.decorate('http://other/', {}));
    });
    r.expand({uri: base + '/moved.m3u'}, function(e2, f2){
      t('M3U behind a redirect', function(){ assert.deepStrictEqual(f2, [base + '/b.mp3']); });
      r.expand({uri: base + '/audio.m3u'}, function(e3, f3){
        t('an address that answers with audio is played as it is', function(){ assert.deepStrictEqual(f3, [base + '/audio.m3u']); });
        r.expand({uri: base + '/gone.pls'}, function(e4, f4){
          t('not reachable: the address as it is (MPD may still manage)', function(){ assert.deepStrictEqual(f4, [base + '/gone.pls']); });
          srv.close();
          console.log(n + ' checks ok');
          process.exit(0);
        });
      });
    });
  });
});
