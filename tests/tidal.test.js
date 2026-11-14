/* TIDAL on the Mac (tags/tidal/service.js): login, search, queue entries, proxy, seeking. TIDAL itself is mocked. */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var TidalService = require('../tags/tidal/service.js').TidalService;
var mpdplayer = require('../tags/mpdplayer.js');
var streaming = require('../web/js/streaming.js');

var n = 0, queue = [];
function t(name, fn) { queue.push([name, fn]); }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tidal-')); }
function json(status, body) { return Promise.resolve({status: status, ok: status < 300, headers: {get: function(){ return null; }}, json: function(){ return Promise.resolve(body); }}); }
function b64(o) { return Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64'); }

/* fake TIDAL: auth and the few API paths the tests use */
function fakeTidal(state) {
  return function(url, opts){
    url = String(url);
    if (/device_authorization$/.test(url)) return json(200, {deviceCode: 'dev', userCode: 'ABCDE', verificationUriComplete: 'link.tidal.com/ABCDE', expiresIn: 300, interval: 2});
    if (/oauth2\/token$/.test(url)) {
      var body = String(opts.body);
      if (/device_code/.test(body) && state.polls++ < 1) return json(400, {error: 'authorization_pending'});
      return json(200, {access_token: 'acc', refresh_token: 'ref', expires_in: 3600, user: {userId: 7, username: 'ich@example.org', countryCode: 'DE'}});
    }
    var p = new URL(url).pathname.replace('/v1/', '');
    if (p === 'sessions') return json(200, {countryCode: 'DE'});
    if (p === 'users/7/subscription') return json(200, {subscription: {type: 'HIFI_PLUS'}, highestSoundQuality: 'HI_RES_LOSSLESS'});
    if (p === 'search') return json(200, {artists: {items: [{id: 1, name: 'Daft Punk', picture: 'aa-bb'}]}, albums: {items: [{id: 2, title: 'Discovery', artists: [{name: 'Daft Punk'}], cover: 'cc-dd', releaseDate: '2001-03-12'}]},
                                          playlists: {items: []}, tracks: {items: [{id: 3, title: 'One More Time', artists: [{name: 'Daft Punk'}], album: {title: 'Discovery', cover: 'cc-dd'}, duration: 320}]}});
    if (p === 'albums/2') return json(200, {id: 2, title: 'Discovery', artists: [{name: 'Daft Punk'}], cover: 'cc-dd'});
    if (p === 'albums/2/tracks') return json(200, {items: [{id: 3, title: 'One More Time', artists: [{name: 'Daft Punk'}], duration: 320}, {id: 4, title: 'Aerodynamic', artists: [{name: 'Daft Punk'}], duration: 212}], totalNumberOfItems: 2});
    if (/^tracks\/\d+\/playbackinfopostpaywall$/.test(p)) {
      state.quality = new URL(url).searchParams.get('audioquality');
      return json(200, {trackId: 9, audioQuality: 'HIGH', manifestMimeType: 'application/vnd.tidal.bts', manifest: b64({codecs: 'mp4a.40.2', urls: ['https://cdn.example/9.m4a'], encryptionType: 'NONE'})});
    }
    return json(404, {});
  };
}
function service(state, extra) {
  var o = {dataDir: tmp(), fetch: fakeTidal(state), port: 0, pollMs: 20, mpd: function(c, cb){ cb(null, [[]]); },
           execFile: function(b, a, o2, cb){ cb(null); }, logger: {info: function(){}, warn: function(){}, error: function(){}}};
  Object.keys(extra || {}).forEach(function(k){ o[k] = extra[k]; });
  return new TidalService(o);
}
function wait(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }
function loggedIn(s) { return s.handle({action: 'login'}).then(function(){ return wait(120); }); }

t('login with a device code: code and link first, then the account; tokens stay in the data folder only', function(){
  var st = {polls: 0}, s = service(st);
  return s.handle({}).then(function(r){
    assert.strictEqual(r.loggedIn, false);
    assert.strictEqual(r.quality, 'HI_RES_LOSSLESS');
    assert.strictEqual(r.searchLimit, 20);
    return s.handle({action: 'login'});
  }).then(function(r){
    assert.strictEqual(r.login.code, 'ABCDE');
    assert.strictEqual(r.login.url, 'https://link.tidal.com/ABCDE');
    return wait(150).then(function(){ return s.handle({}); });
  }).then(function(r){
    assert.strictEqual(r.loggedIn, true);
    assert.strictEqual(r.login, null);
    assert.strictEqual(r.username, 'ich@example.org');
    assert.strictEqual(r.plan, 'HIFI_PLUS / HI_RES_LOSSLESS');
    assert.ok(!('access_token' in r) && JSON.stringify(r).indexOf('ref') < 0, 'no token in the answer');
    var file = path.join(s.o.dataDir, 'tidal.json');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).refresh_token, 'ref');
    assert.strictEqual(fs.statSync(file).mode & 0o077, 0);
    return s.handle({action: 'logout'});
  }).then(function(r){ assert.strictEqual(r.loggedIn, false); return s.stop(); });
});

t('settings: quality and search hits, other values refused', function(){
  var s = service({polls: 0});
  return s.handle({quality: 'LOSSLESS', searchLimit: 50}).then(function(r){
    assert.strictEqual(r.quality, 'LOSSLESS'); assert.strictEqual(r.searchLimit, 50);
    return s.handle({quality: 'MQA'});
  }).then(function(r){ assert.deepStrictEqual(r, {ok: false, error: 'value'}); });
});

t('search: TIDAL lists that the interface sorts into artists, albums and tracks of TIDAL', function(){
  var s = service({polls: 0});
  return loggedIn(s).then(function(){ return s.search('daft'); }).then(function(lists){
    var d = streaming.streamSplitSearch(lists, 'daft');
    assert.strictEqual(d.stream.tidal.artists[0].uri, 'tidal:artist:1');
    assert.ok(streaming.streamIsArtist(d.stream.tidal.artists[0]));
    assert.strictEqual(d.stream.tidal.albums[0].uri, 'tidal:album:2');
    assert.strictEqual(d.stream.tidal.songs[0].uri, 'tidal:track:3');
    assert.strictEqual(d.artists.length + d.albums.length + d.songs.length, 0);
    return s.stop();
  });
});

t('album to the queue: proxy addresses for MPD; state and queue show title, artist and cover', function(){
  var s = service({polls: 0}), sent = [];
  var pl = new mpdplayer.Player({
    mpd: function(cmds, cb){
      sent.push(cmds);
      if (cmds[0] === 'status') return cb(null, [['state: play', 'song: 0'], ['file: ' + s.proxy.urlFor(3), 'Title: 3.flac']]);
      if (cmds[0] === 'playlistinfo') return cb(null, [['file: ' + s.proxy.urlFor(3), 'file: ' + s.proxy.urlFor(4)]]);
      cb(null, [[]]);
    },
    expand: function(it, cb){ if (!s.handles(it)) return false; s.expand(it).then(function(f){ cb(null, f); }, cb); return true; },
    decorate: function(f, o){ s.decorate(f, o); }
  });
  return loggedIn(s).then(function(){
    return new Promise(function(res){ pl.command({action: 'replace', items: [{uri: 'tidal:album:2', service: 'tidal', type: 'folder'}]}, function(c, o){ res(o); }); });
  }).then(function(o){
    assert.strictEqual(o.added, 2);
    var last = sent[sent.length - 1];
    assert.deepStrictEqual(last, ['clear', 'add "' + s.proxy.urlFor(3) + '"', 'add "' + s.proxy.urlFor(4) + '"', 'play 0']);
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/tidal\/3\.flac$/.test(s.proxy.urlFor(3)));
    return new Promise(function(res){ pl.state(function(e, st){ res(st); }); });
  }).then(function(st){
    assert.strictEqual(st.title, 'One More Time');
    assert.strictEqual(st.artist, 'Daft Punk');
    assert.strictEqual(st.album, 'Discovery');
    assert.strictEqual(st.service, 'tidal');
    assert.strictEqual(st.uri, 'tidal:track:3');
    assert.strictEqual(st.stream, false);
    assert.ok(/resources\.tidal\.com\/images\/cc\/dd\/640x640\.jpg$/.test(st.albumart));
    assert.strictEqual(streaming.streamOf({service: st.service, uri: st.uri}).id, 'tidal');
    return new Promise(function(res){ pl.queue(function(e, q){ res(q); }); });
  }).then(function(q){
    assert.strictEqual(q.queue[1].title, 'Aerodynamic');
    assert.strictEqual(q.queue[1].service, 'tidal');
    return wait(1100);
  }).then(function(){
    var saved = JSON.parse(fs.readFileSync(path.join(s.o.dataDir, 'tidal-meta.json'), 'utf8'));
    assert.strictEqual(saved.length, 2);
    return s.stop();
  });
});

t('proxy: a stream without segments goes to MPD as a redirect to TIDAL, in the chosen quality', function(){
  var st = {polls: 0}, s = service(st);
  return loggedIn(s).then(function(){ return s.handle({quality: 'HIGH'}); }).then(function(){ return s.ensureProxy(); }).then(function(){
    return new Promise(function(res, rej){ http.get(s.proxy.urlFor(9), res).on('error', rej); });
  }).then(function(r){
    assert.strictEqual(r.statusCode, 302);
    assert.strictEqual(r.headers.location, 'https://cdn.example/9.m4a');
    assert.strictEqual(st.quality, 'HIGH');
    r.resume();
    return new Promise(function(res, rej){ http.get(s.proxy.urlFor('../x'), res).on('error', rej); });
  }).then(function(r){ assert.strictEqual(r.statusCode, 404); r.resume(); return s.stop(); });
});

t('seek: own tracks of the library as usual; a downloaded TIDAL track switches to a seekable copy', function(){
  var cmds = [], cur = {file: 'USB/a.flac', id: '5'}, s;
  s = service({polls: 0}, {sleep: function(){ return Promise.resolve(); }, mpd: function(c, cb){
    cmds.push(c.join(';'));
    if (c[0] === 'status' && c[1] === 'currentsong') return cb(null, [['state: play', 'song: 2', 'songid: ' + cur.id], ['file: ' + cur.file, 'Id: ' + cur.id]]);
    if (c[0] === 'seekcur 60' && /tidal/.test(cur.file) && cmds.filter(function(x){ return /^addid/.test(x); }).length === 0) return cb(new Error('ACK [2@0] {seekcur} Not seekable'));
    if (/^addid /.test(c[0])) return cb(null, [['Id: 9']]);
    if (c[0] === 'status') return cb(null, [['state: play', 'songid: 9']]);
    cb(null, [[]]);
  }});
  return s.seek(60).then(function(r){
    assert.strictEqual(r, null);
    cur = {file: s.proxy.urlFor(3), id: '5'};
    s.cache.index.set('3', {size: 1, mtimeMs: 0});
    cmds = [];
    return s.seek(60);
  }).then(function(r){
    assert.deepStrictEqual(r, {ok: true});
    assert.deepStrictEqual(cmds.slice(1), ['seekcur 60', 'addid "' + s.proxy.urlFor(3) + '" 3', 'playid 9', 'status', 'seekcur 60', 'deleteid 5']);
  });
});

t('not logged in: nothing from TIDAL in the search, browse refused', function(){
  var s = service({polls: 0});
  return s.search('daft').then(function(l){
    assert.deepStrictEqual(l, []);
    return s.browse('tidal:album:2').then(function(){ throw new Error('should fail'); }, function(e){ assert.ok(/not logged in/.test(e.message)); });
  });
});

t('web: TIDAL artist addresses of this plugin count as artists', function(){
  assert.ok(streaming.streamIsArtist({uri: 'tidal:artist:123', service: 'tidal', title: 'X'}));
  assert.ok(streaming.streamIsArtist({uri: 'tidal://artist/123', service: 'tidal', title: 'X'}));
});

(function run(i){
  if (i >= queue.length) { console.log(n + ' tests passed'); return; }
  Promise.resolve().then(queue[i][1]).then(function(){ n++; console.log('ok   ' + queue[i][0]); run(i + 1); },
    function(e){ console.error('FAIL ' + queue[i][0] + '\n', e); process.exit(1); });
})(0);
