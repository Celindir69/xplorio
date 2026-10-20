/* Streaming services (web/js/streaming.js): detecting TIDAL/Qobuz/HIGHRESAUDIO/Spotify, splitting the search answer, enabling per setting */
var assert = require('assert');
var st = require('../web/js/streaming.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

t('detect the service from service or URI', function(){
  assert.strictEqual(st.streamOf({service: 'tidal', uri: 'tidal://album/1'}).id, 'tidal');
  assert.strictEqual(st.streamOf({service: 'qobuz', uri: 'qobuz://album/abc'}).id, 'qobuz');
  assert.strictEqual(st.streamOf('qobuz/artist/123').id, 'qobuz');
  assert.strictEqual(st.streamOf({service: 'mpd', uri: 'music-library/USB/Qobuz-Käufe/a.flac'}), null);
  assert.strictEqual(st.streamOf({service: 'webradio', uri: 'http://x'}), null);
  assert.strictEqual(st.streamOf({service: 'spop', uri: 'spotify:album:2up3OPMp9Tb4dAKM2erWXQ'}).id, 'spotify');
  assert.strictEqual(st.streamOf('spotify:track:6rqhFgbbKwnb9MLmUQDhG6').id, 'spotify');
  assert.strictEqual(st.streamOf({service: 'hra', uri: 'hra://album/77'}).id, 'hra');
  assert.strictEqual(st.streamOf('highresaudio/artist/12').id, 'hra');
  assert.strictEqual(st.streamOf({service: 'volspotconnect2', uri: ''}), null);   /* Spotify Connect: no search */
});

t('artist URIs of the services', function(){
  assert.ok(st.streamIsArtist({service: 'tidal', uri: 'tidal://artist/42'}));
  assert.ok(st.streamIsArtist({service: 'qobuz', uri: 'qobuz://artist/42'}));
  assert.ok(st.streamIsArtist({service: 'qobuz', uri: 'qobuz/artists/42'}));
  assert.ok(!st.streamIsArtist({service: 'qobuz', uri: 'qobuz://album/0060253'}));
  assert.ok(!st.streamIsArtist({service: 'mpd', uri: 'artists://Nena'}));
  assert.ok(st.streamIsArtist({service: 'spop', uri: 'spotify:artist:4Z8W4fKeB5YxbusRsdQVPb'}));
  assert.ok(!st.streamIsArtist({service: 'spop', uri: 'spotify:album:4Z8W4fKeB5YxbusRsdQVPb'}));
  assert.ok(st.streamIsArtist({service: 'hra', uri: 'hra/artist/12'}));
  /* this is how the HIGHRESAUDIO plugin on the MX-Stream returns the search for "Massive Attack" */
  assert.ok(st.streamIsArtist({service: 'hi_res_audio', type: 'folder', title: 'Massive Attack', artist: 'Massive Attack',
    uri: 'hi_res_audio/artists/880cb308-6084-4800-b054-bafcbcfd0cb3'}));
  assert.ok(!st.streamIsArtist({service: 'hi_res_audio', type: 'folder', title: 'Blue Lines (2012 Mix/Master)', artist: 'Massive Attack',
    uri: 'hi_res_audio/artists/86dcf456-dfd2-4b7f-8572-e32d30fd2770'}));
  assert.ok(!st.streamIsArtist({service: 'hi_res_audio', type: 'folder', uri: 'hi_res_audio/artists/'}));
  assert.ok(st.streamIsArtist({service: 'qobuz', type: 'folder-with-favourites', title: 'Massive Attack', uri: 'qobuz://artist/53293'}));
});

t('search answer: local, TIDAL and Qobuz separated', function(){
  var lists = [
    {title: "Gefunden 1 Interpret 'nena'", items: [{service: 'mpd', title: 'Nena', uri: 'artists://Nena'}]},
    {title: "Gefunden 2 Titel 'nena'", items: [{service: 'mpd', type: 'song', title: '99 Luftballons', artist: 'Nena'}, {service: 'mpd', type: 'song', title: 'Irgendwas', artist: 'Andere'}]},
    {title: 'TIDAL Interpreten', items: [{service: 'tidal', title: 'Nena', uri: 'tidal://artist/1'}]},
    {title: 'TIDAL Playlisten', items: [{service: 'tidal', title: 'NDW', uri: 'tidal://playlist/1'}]},
    {title: 'Qobuz Albums', items: [{service: 'qobuz', type: 'folder', title: 'Nena', uri: 'qobuz://album/7'}]},
    {title: 'Qobuz Tracks', items: [{service: 'qobuz', type: 'song', title: 'Leuchtturm', uri: 'qobuz://track/9'}]},
    {title: 'Qobuz', items: [{service: 'qobuz', title: 'Nena', uri: 'qobuz://artist/3'}]},   /* heading without kind: detect from the entry */
    {title: 'Webradio', items: [{service: 'webradio', title: 'NDW Radio'}]},
    {title: 'Spotify Artists', items: [{service: 'spop', title: 'Nena', uri: 'spotify:artist:1'}]},
    {title: 'Spotify Tracks', items: [{service: 'spop', type: 'song', title: 'Nur geträumt', uri: 'spotify:track:2'}]},
    {title: 'HIGHRESAUDIO Alben', items: [{service: 'hra', type: 'folder', title: 'Nena live', uri: 'hra://album/5'}]}
  ];
  var d = st.streamSplitSearch(lists, 'nena');
  assert.strictEqual(d.artists.length, 1);
  assert.deepStrictEqual(d.songs.map(function(x){ return x.title; }), ['99 Luftballons']);
  assert.strictEqual(d.stream.tidal.artists.length, 1);
  assert.strictEqual(d.stream.tidal.albums.length, 0);
  assert.strictEqual(d.stream.qobuz.albums.length, 1);
  assert.strictEqual(d.stream.qobuz.songs.length, 1);
  assert.strictEqual(d.stream.qobuz.artists.length, 1);
  assert.strictEqual(d.stream.spotify.artists.length, 1);
  assert.strictEqual(d.stream.spotify.songs.length, 1);
  assert.strictEqual(d.stream.hra.albums.length, 1);
});

t('HIGHRESAUDIO list without heading: artist and album separated, empty entry dropped', function(){
  var d = st.streamSplitSearch([{availableListViews: ['list'], items: [
    {service: 'hi_res_audio', type: 'folder', title: 'Massive Attack', artist: 'Massive Attack', uri: 'hi_res_audio/artists/880cb308-6084-4800-b054-bafcbcfd0cb3'},
    {service: 'hi_res_audio', type: 'folder', title: 'Blue Lines (2012 Mix/Master)', artist: 'Massive Attack', uri: 'hi_res_audio/artists/86dcf456-dfd2-4b7f-8572-e32d30fd2770'},
    {service: 'hi_res_audio', type: 'folder', uri: 'hi_res_audio/artists/'}]}], 'massive attack');
  assert.deepStrictEqual(d.stream.hra.artists.map(function(x){ return x.title; }), ['Massive Attack']);
  assert.deepStrictEqual(d.stream.hra.albums.map(function(x){ return x.title; }), ['Blue Lines (2012 Mix/Master)']);
});

t('search term in the heading does not make it a service list', function(){
  var d = st.streamSplitSearch([{title: "Gefunden 1 Interpret 'Shrapnel Spotify'", items: [{service: 'mpd', title: 'Shrapnel Spotify', uri: 'artists://Shrapnel Spotify'}]}], 'shrapnel spotify');
  assert.strictEqual(d.artists.length, 1);
  assert.strictEqual(d.stream.spotify.artists.length + d.stream.hra.artists.length, 0);
});

t('enabling: fixed, auto from Volumio sources, until then only TIDAL', function(){
  var tidal = st.STREAMS[0], qobuz = st.STREAMS[1], hra = st.STREAMS[2], spotify = st.STREAMS[3];
  st.streamConfigure({TIDAL: 'auto', QOBUZ: 'auto'}, null);
  assert.deepStrictEqual([tidal.on, qobuz.on], [true, false]);
  st.streamConfigure({TIDAL: 'auto', QOBUZ: 'auto'}, [{plugin_name: 'qobuz', uri: 'qobuz'}, {plugin_name: 'mpd'}]);
  assert.deepStrictEqual([tidal.on, qobuz.on], [false, true]);
  st.streamConfigure({TIDAL: false, QOBUZ: true}, null);
  assert.deepStrictEqual([tidal.on, qobuz.on], [false, true]);
  assert.strictEqual(st.streamNeedsSources({TIDAL: false, QOBUZ: true, HRA: false, SPOTIFY: false}), false);
  assert.strictEqual(st.streamNeedsSources({TIDAL: false}), true);
  assert.deepStrictEqual(st.streamsOn().map(function(s){ return s.id; }), ['qobuz']);
  st.streamConfigure({}, [{plugin_name: 'spop', uri: 'spotify'}, {plugin_name: 'hra', uri: 'hra'}]);
  assert.deepStrictEqual([tidal.on, qobuz.on, hra.on, spotify.on], [false, false, true, true]);
  st.streamConfigure({}, [{plugin_name: 'volspotconnect2', uri: 'volspotconnect2'}]);
  assert.strictEqual(spotify.on, false);
  /* this is how the HIGHRESAUDIO plugin reports itself on the MX-Stream (source list from browse) */
  st.streamConfigure({}, [{plugin_name: 'qobuz', uri: 'qobuz://'}, {plugin_name: 'hi_res_audio', uri: 'hi_res_audio', name: 'HIGHRESAUDIO'}]);
  assert.deepStrictEqual([tidal.on, qobuz.on, hra.on, spotify.on], [false, true, true, false]);
  assert.strictEqual(st.streamOf({service: 'hi_res_audio', uri: 'hi_res_audio/album/1'}).id, 'hra');
});

console.log(n + ' checks passed');
