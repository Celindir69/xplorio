/* own records from Discogs (tags/vinyl.js): reading the folders, tracklists, matching with the library, search */
var assert = require('assert');
var fs = require('fs'), os = require('os'), path = require('path');
var vinyl = require('../tags/vinyl.js'), rd = require('../tags/releasedates.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function ta(name, fn) { pending++; fn(function(){ n++; pending--; console.log('ok   ' + name); }); }

function rel(id, artist, title, year, desc) {
  return {id: id, date_added: '2024-03-01T10:00:00-08:00', basic_information: {id: id, master_id: id + 1000, title: title, year: year,
    thumb: 'https://i.discogs.com/t' + id + '.jpg', cover_image: 'https://i.discogs.com/c' + id + '.jpg',
    formats: [{name: 'Vinyl', qty: '1', descriptions: desc || ['LP', 'Album']}], labels: [{name: 'Nordlicht (3)', catno: 'NL 001'}],
    artists: [{name: artist, anv: '', join: ''}]}};
}

t('release from a collection page: artist without Discogs number, format, label', function(){
  var it = vinyl.fromRelease(rel(7, 'Polar Echo (2)', 'Nebelbank', 1977), 904568);
  assert.strictEqual(it.ar, 'Polar Echo'); assert.strictEqual(it.al, 'Nebelbank'); assert.strictEqual(it.y, 1977);
  assert.strictEqual(it.f, 904568); assert.strictEqual(it.fmt, 'Vinyl, LP, Album'); assert.strictEqual(it.lab, 'Nordlicht · NL 001');
  assert.strictEqual(it.m, 1007); assert.strictEqual(it.add, '2024-03-01');
  assert.strictEqual(vinyl.credit([{name: 'A', join: '&'}, {name: 'B*', anv: ''}]), 'A & B');
});

t('tracklist without headings', function(){
  var tr = vinyl.fromTracklist({tracklist: [{type_: 'heading', title: 'Seite A'}, {type_: 'track', position: 'A1', title: 'Eins', duration: '4:01'},
                                            {position: 'B1', title: 'Zwei', artists: [{name: 'Gast (4)'}]}]});
  assert.deepStrictEqual(tr, [{p: 'A1', t: 'Eins', d: '4:01'}, {p: 'B1', t: 'Zwei', ar: 'Gast'}]);
});

t('configuration: any user and folders with own labels, nothing built in', function(){
  var c = vinyl.checkConfig({user: ' Celindir ', folders: [{id: '904568', name: 'LP'}, {id: 9268203, label: '12″'}, {id: 'x'}, {id: 904568}]});
  assert.deepStrictEqual(c, {user: 'Celindir', folders: [{id: 904568, name: 'LP', label: 'LP'}, {id: 9268203, name: '', label: '12″'}]});
  assert.strictEqual(vinyl.checkConfig({user: 'a/b'}).error, 'user');
  assert.deepStrictEqual(vinyl.checkConfig({}), {user: '', folders: []});
});

t('matching with the library: spelling, "The", edition additions, Various Artists; Live stays different', function(){
  var m = new vinyl.Matcher([{dir: 'USB/Polar Echo/Nebelbank', al: 'Nebelbank (Remastered 2011)', ar: 'The Polar Echo'},
                             {dir: 'USB/S&G/Brücke', al: 'Brücke', ar: 'Simon & Garfunkel'},
                             {dir: 'USB/VA/Hits', al: 'Hits 1', ar: 'Verschiedene'}]);
  assert.strictEqual(m.match('Polar Echo', 'Nebelbank'), 'USB/Polar Echo/Nebelbank');
  assert.strictEqual(m.match('Simon And Garfunkel', 'Brucke'), 'USB/S&G/Brücke');
  assert.strictEqual(m.match('Various', 'Hits 1'), 'USB/VA/Hits');
  assert.strictEqual(m.match('Polar Echo', 'Nebelbank (Live)'), '');
  assert.strictEqual(m.match('Andere Band', 'Nebelbank'), '');
  assert.ok(vinyl.sameAlbum('Polar Echo', 'Nebelbank [Deluxe Edition]', 'The Polar Echo', 'Nebelbank'));
  var hd = new vinyl.Matcher([{dir: 'USB/Highres/Polar Echo/Glas [HD 4824]', al: 'Glas [HD]', ar: 'Polar Echo'},
                              {dir: 'USB/Highres/Polar Echo/Eis', al: 'Eis (Bonus & Live) (HD)', ar: 'Polar Echo'},
                              {dir: 'USB/Polar Echo/Wind', al: 'Wind - 2011 Remaster', ar: 'Polar Echo'}]);
  assert.strictEqual(hd.match('Polar Echo', 'Glas'), 'USB/Highres/Polar Echo/Glas [HD 4824]');   /* as with the album versions */
  assert.strictEqual(hd.match('Polar Echo', 'Eis'), 'USB/Highres/Polar Echo/Eis');
  assert.strictEqual(hd.match('Polar Echo', 'Wind'), 'USB/Polar Echo/Wind');
});

t('search: artists with count, albums, tracks', function(){
  var items = [vinyl.fromRelease(rel(1, 'Polar Echo', 'Nebelbank', 1977), 1), vinyl.fromRelease(rel(2, 'Polar Echo', 'Halbschatten', 1981), 2),
               vinyl.fromRelease(rel(3, 'Lumen Drift', 'Nordwind', 1985, ['12"', '45 RPM']), 2)];
  var r = vinyl.search(items, {3: [{p: 'A', t: 'Nebel über Kiel'}]}, 'nebel');
  assert.deepStrictEqual(r.artists, []);
  assert.deepStrictEqual(r.albums.map(function(x){ return x.id; }), [1]);
  assert.strictEqual(r.songs.length, 1); assert.strictEqual(r.songs[0].item.id, 3);
  r = vinyl.search(items, {}, 'polar');
  assert.deepStrictEqual(r.artists, [{name: 'Polar Echo', n: 2}]);
  assert.strictEqual(r.albums.length, 2);                      /* artist and title together */
  assert.strictEqual(vinyl.search(items, {}, 'polar halb').albums[0].id, 2);
});

ta('reading: user from the token, every page of every chosen folder, tracklists afterwards', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinyl-')), urls = [], clock = 1e12;
  var pages = {
    '/oauth/identity': {username: 'Sammler'},
    '/users/Sammler/collection/folders/11/releases?per_page=100&page=1&sort=artist&sort_order=asc': {pagination: {pages: 2}, releases: [rel(1, 'A', 'Eins', 1970)]},
    '/users/Sammler/collection/folders/11/releases?per_page=100&page=2&sort=artist&sort_order=asc': {pagination: {pages: 2}, releases: [rel(2, 'B', 'Zwei', 1971)]},
    '/users/Sammler/collection/folders/22/releases?per_page=100&page=1&sort=artist&sort_order=asc': {pagination: {pages: 1}, releases: [rel(3, 'C', 'Drei', 1972, ['12"'])]},
    '/releases/1': {tracklist: [{position: 'A1', title: 'Lied'}]}
  };
  var c = new vinyl.Collection({file: path.join(dir, 'vinyl.json'), token: function(){ return 'tok'; }, stepMs: 1, now: function(){ return clock; },
    getJson: function(u, headers, cb){
      assert.strictEqual(headers.Authorization, 'Discogs token=tok');
      var p = u.replace(/^https:\/\/api\.discogs\.com/, '');
      urls.push(p);
      setImmediate(function(){ pages[p] ? cb(null, pages[p]) : cb(new Error('HTTP 404')); });
    }});
  c.setConfig({folders: [{id: 11, label: 'LP'}, {id: 22, label: '12″'}]}, function(){});   /* starts reading */
  (function wait(){
    if (c.busy) return setTimeout(wait, 5);
    assert.deepStrictEqual(c.data.items.map(function(x){ return x.id + '@' + x.f; }), ['1@11', '2@11', '3@22']);
    assert.strictEqual(c.label(22), '12″');
    assert.strictEqual(c.status().user, 'Sammler'); assert.strictEqual(c.status().count, 3);
    c.tick(function(){
      assert.deepStrictEqual(c.data.tracks[1], [{p: 'A1', t: 'Lied'}]);
      c.tick(function(){
        assert.deepStrictEqual(c.data.tracks[2], []);              /* gone at Discogs: not asked again */
        var again = new vinyl.Collection({file: path.join(dir, 'vinyl.json'), getJson: function(){}});
        again.data.tracks = c.data.tracks; c.save();
        again = new vinyl.Collection({file: path.join(dir, 'vinyl.json'), getJson: function(){}});
        assert.strictEqual(again.data.items.length, 3); assert.strictEqual(again.data.cfg.folders[1].label, '12″');
        clock += 25 * 3600 * 1000;                                  /* a day later: read again */
        var before = urls.length;
        c.tick(function(){ assert.ok(urls.length > before && /folders\/11/.test(urls[before + 0] || urls[before])); done(); });
      });
    });
  })();
});

ta('folder list of a user for the choice, "All" last', function(done){
  var c = new vinyl.Collection({file: path.join(os.tmpdir(), 'vinyl-none-' + process.pid + '.json'), stepMs: 1,
    getJson: function(u, h, cb){
      assert.ok(/\/users\/Celindir\/collection\/folders$/.test(u));
      cb(null, {folders: [{id: 0, name: 'All', count: 3}, {id: 904568, name: 'LP', count: 2}, {id: 9268203, name: '12"', count: 1}]});
    }});
  c.folders('Celindir', function(e, r){
    assert.ifError(e);
    assert.deepStrictEqual(r.folders.map(function(f){ return f.id; }), [904568, 9268203, 0]);
    c.folders('', function(e2){ assert.strictEqual(e2.message, 'no user'); done(); });   /* no name and no token */
  });
});

ta('birthdays: records only on vinyl are looked up after the library', function(done){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinyl-rd-'));
  var c = new rd.Collector({file: path.join(dir, 'r.jsonl'), list: function(){ return [{dir: 'X/A', al: 'A', ar: 'B', rd: '1970-01-02'}]; },
    more: function(){ return [{dir: 'discogs:5', al: 'Nordwind', ar: 'Lumen Drift'}]; }, stepMs: 1,
    getJson: function(u, cb){ cb(null, {'release-groups': [{score: 100, title: 'Nordwind', 'first-release-date': '1985-11-25', 'artist-credit': [{name: 'Lumen Drift'}]}]}); }});
  assert.strictEqual(c.next(0).dir, 'discogs:5');
  c.step(function(){
    assert.strictEqual(c.dateOf({dir: 'discogs:5'}), '1985-11-25');
    var b = rd.birthdays([{dir: 'discogs:5', al: 'Nordwind', ar: 'Lumen Drift'}], function(a){ return c.dateOf(a); }, '2025-11-25');
    assert.strictEqual(b.today[0].years, 40);
    c.stop(); done();
  });
});

process.on('exit', function(){ if (pending) { console.log('FAIL ' + pending + ' async test(s) did not finish'); process.exitCode = 1; } });
