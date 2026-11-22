/* similar artists without Last.fm (tags/similarartists.js): Deezer, otherwise ListenBrainz; Last.fm key refused (lastfm.js) */
var assert = require('assert'), http = require('http'), url = require('url');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

var hits = [];
var fake = http.createServer(function(req, res){
  var u = url.parse(req.url, true);
  hits.push(u.pathname + (u.query.q ? '?' + u.query.q : '') + (u.query.query ? '?' + u.query.query : ''));
  function json(o) { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }
  if (u.pathname === '/search/artist') {
    if (u.query.q === 'R.E.M.') return json({data: [{id: 5, name: 'R.E.M. Tribute', nb_fan: 9999}, {id: 7, name: 'r.e.m.', nb_fan: 10}, {id: 8, name: 'R.E.M.', nb_fan: 500}]});
    return json({data: []});
  }
  if (u.pathname === '/artist/8/related') return json({data: [{name: 'Pixies'}, {name: 'The Smiths'}, {name: 'R.E.M.'}, {name: 'pixies'}]});
  if (u.pathname === '/ws/2/artist') {
    if (/Nischenband/.test(u.query.query)) return json({artists: [{id: 'mbid-1', name: 'Nischenband', score: 100}]});
    return json({artists: []});
  }
  if (u.pathname === '/1/lb-radio/artist/mbid-1') return json({'mbid-1': [{similar_artist_name: 'Nischenband', similar_artist_mbid: 'mbid-1', total_listen_count: 50}],
    'mbid-2': [{similar_artist_name: 'Klein', similar_artist_mbid: 'mbid-2', total_listen_count: 5}],
    'mbid-3': [{similar_artist_name: 'Groß', similar_artist_mbid: 'mbid-3', total_listen_count: 900}]});
  res.writeHead(404); res.end();
});

fake.listen(0, function(){
  var base = 'http://127.0.0.1:' + fake.address().port;
  process.env.DEEZER_URL = base; process.env.MB_URL = base; process.env.LISTENBRAINZ_URL = base;
  var sa = require('../tags/similarartists.js'), lastfm = require('../tags/lastfm.js');
  sa.find('R.E.M.', 10, function(e, list){
    t('Deezer: the artist with exactly that name and the most fans, related artists without the artist itself and doubles', function(){
      assert.ifError(e);
      assert.deepStrictEqual(list, ['Pixies', 'The Smiths']);
      assert.ok(hits.indexOf('/artist/8/related') >= 0);
    });
    var before = hits.length;
    sa.find('r.e.m.', 1, function(e2, list2){
      t('cached for a day; limit applies', function(){
        assert.deepStrictEqual(list2, ['Pixies']);
        assert.strictEqual(hits.length, before);
      });
      sa.find('Nischenband', 10, function(e3, list3){
        t('Deezer knows nothing: ListenBrainz via the MusicBrainz ID, most listened first', function(){
          assert.ifError(e3);
          assert.deepStrictEqual(list3, ['Groß', 'Klein']);
          assert.ok(hits.some(function(h){ return h.indexOf('/1/lb-radio/artist/mbid-1') === 0; }));
        });
        sa.find('Unbekannt', 10, function(e4, list4){
          t('nobody knows the artist: empty list', function(){ assert.ifError(e4); assert.deepStrictEqual(list4, []); });
          t('Last.fm key refused: 10, 26 and the Pro message count, other errors do not', function(){
            assert.strictEqual(lastfm.keyError('K1', 6, 'Artist not found'), false);
            assert.strictEqual(lastfm.rejected('K1'), false);
            assert.strictEqual(lastfm.keyError('K1', 26, 'Suspended API key'), true);
            assert.strictEqual(lastfm.rejected('K1'), true);
            assert.strictEqual(lastfm.rejected('K2'), false);                     /* a new key is tried right away */
            lastfm.resetRejected();
            assert.strictEqual(lastfm.keyError('K3', 17, 'API keys require a Last.fm Pro subscription'), true);
            lastfm.resetRejected();
          });
          fake.close();
          console.log(n + ' checks passed');
        });
      });
    });
  });
});
