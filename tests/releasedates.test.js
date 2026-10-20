/* album birthdays (tags/releasedates.js): MusicBrainz hits, lookup, today/week/month, round years */
var assert = require('assert');
var fs = require('fs'), os = require('os'), path = require('path');
var rd = require('../tags/releasedates.js'), albums = require('../tags/albums.js');
var n = 0, pending = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

t('full Date tag per album, only if it matches the year', function(){
  function s(file, date) { return {file: file, artist: 'A', albumartist: '', album: path.basename(path.dirname(file)), title: file, date: date, genre: ''}; }
  var list = albums.fromSongs([s('X/Eins/1.flac', '1981-05-12'), s('X/Eins/2.flac', '1981'), s('X/Zwei/1.flac', '2011-01-01'), s('X/Zwei/2.flac', '1994'), s('X/Zwei/3.flac', '1994')]);
  assert.strictEqual(list[0].rd, '1981-05-12');
  assert.strictEqual(list[1].rd, undefined);          /* remaster date, album is from 1994 */
});

var mb = {'release-groups': [
  {score: 100, title: 'Halbschatten (Live)', 'first-release-date': '1979-01-01', 'artist-credit': [{name: 'Lumen Drift'}]},
  {score: 98, title: 'Halbschatten', 'first-release-date': '1981-10', 'artist-credit': [{name: 'Lumen Drift'}]},
  {score: 95, title: 'Halbschatten', 'first-release-date': '1981-10-14', 'artist-credit': [{name: 'Lumen Drift'}, {name: ' & Gäste'}]}
]};
t('MusicBrainz: title and artist matching, date complete, not later than the album', function(){
  assert.strictEqual(rd.pickDate(mb, 'Halbschatten', 'Lumen Drift', 1981), '1981-10-14');
  assert.strictEqual(rd.pickDate(mb, 'Halbschatten', 'Lumen Drift', 1975), '');
  assert.strictEqual(rd.pickDate(mb, 'Halbschatten', 'Polar Echo', 1981), '');
  assert.strictEqual(rd.pickDate({}, 'X', 'Y', 0), '');
});

t('library check: Date tag against MusicBrainz (year, full date, missing)', function(){
  var L = [{dir: 'A/1', al: 'Eins', ar: 'A', y: 1981}, {dir: 'A/2', al: 'Zwei', ar: 'A', y: 1994}, {dir: 'A/3', al: 'Drei', ar: 'A', y: 1990, rd: '1990-02-03'},
           {dir: 'A/4', al: 'Vier', ar: 'A'}, {dir: 'A/5', al: 'Fünf', ar: 'A', y: 2000}, {dir: 'A/6', al: 'Sechs', ar: 'A', y: 2001, rd: '2001-05-05'}];
  var mb = {'A/1': '1981-10-14', 'A/2': '1989-01-02', 'A/3': '1990-03-01', 'A/4': '1977-07-07', 'A/6': '2001-05-05'};
  var songs = [{file: 'A/2/CD1/1.flac', title: 'x'}, {file: 'A/2/CD2/1.flac', title: 'y'}];
  var d = rd.diffs(L, songs, function(x){ return mb[x] || ''; }, albums.albumDir);
  assert.deepStrictEqual(d.map(function(x){ return [x.name, x.tag, x.mb, x.count]; }),
    [['Drei', '1990-02-03', '1990-03-01', 0], ['Vier', '', '1977-07-07', 0], ['Zwei', '1994', '1989-01-02', 2]]);
});

pending++;
(function(){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-')), file = path.join(dir, 'r.jsonl'), urls = [];
  var list = [{dir: 'L/H', al: 'Halbschatten', ar: 'Lumen Drift', y: 1981}, {dir: 'L/T', al: 'Tag', ar: 'A', y: 1990, rd: '1990-02-03'},
              {dir: 'S/V', al: 'Sampler', ar: 'Verschiedene', y: 2000}, {dir: 'L/N', al: 'Nix', ar: 'B', y: 2001}];
  var c = new rd.Collector({file: file, list: function(){ return list; }, stepMs: 1,
    getJson: function(u, cb){ urls.push(decodeURIComponent(u)); cb(null, /Halbschatten/.test(decodeURIComponent(u)) ? mb : {}); }});
  c.step(function(){ c.step(function(){ c.step(function(){
    c.stop();
    t('lookup: only albums without Date tag, no compilations, once; saved', function(){
      assert.strictEqual(urls.length, 2);
      assert.ok(/releasegroup:"Halbschatten" AND artist:"Lumen Drift"/.test(urls[0]), urls[0]);
      assert.strictEqual(c.dateOf(list[0]), '1981-10-14');
      assert.strictEqual(c.dateOf(list[1]), '1990-02-03');
      assert.strictEqual(c.dateOf(list[3]), '');
      var c2 = new rd.Collector({file: file, list: function(){ return list; }});
      assert.strictEqual(c2.dateOf(list[0]), '1981-10-14');
      assert.strictEqual(c2.next(Math.floor(Date.now() / 1000)), null);
      assert.strictEqual(c2.next(Math.floor(Date.now() / 1000) + 91 * 86400).dir, 'L/N');   /* not found: retried later */
      assert.deepStrictEqual(c2.status(), {albums: 4, dated: 2, fetched: 0, running: false});
    });
    t('birthdays: today, this week (Mon–Sun), this month; jubilees and round ones first', function(){
      var L = [
        {dir: 'a', al: 'A', ar: 'X', d: '1981-10-09'}, {dir: 'b', al: 'B', ar: 'X', d: '2001-10-09'},
        {dir: 'c', al: 'C', ar: 'X', d: '1990-10-06'}, {dir: 'd', al: 'D', ar: 'X', d: '1976-10-11'}, {dir: 'e', al: 'E', ar: 'X', d: '1975-10-05'},
        {dir: 'f', al: 'F', ar: 'X', d: '1999-10-30'}, {dir: 'g', al: 'G', ar: 'X', d: '1999-11-09'}, {dir: 'h', al: 'H', ar: 'X', d: '2026-10-09'}, {dir: 'i', al: 'I', ar: 'X', d: ''}
      ];
      var b = rd.birthdays(L, function(a){ return a.d; }, '2026-10-09');      /* Friday; week 5–11 Oct */
      function s(l) { return l.map(function(x){ return x.al + x.years + x.mark; }); }
      assert.deepStrictEqual(s(b.today), ['B25jubilee', 'A45']);
      assert.deepStrictEqual(s(b.week), ['D50jubilee', 'E51', 'C36']);
      assert.deepStrictEqual(s(b.month), ['F27']);
      assert.deepStrictEqual(rd.birthdays([{d: '1980-02-29'}], function(a){ return a.d; }, '2027-02-28').today.length, 1);   /* leap day */
      assert.deepStrictEqual(rd.birthdays(L, function(a){ return a.d; }, 'x'), {today: [], week: [], month: []});
    });
    console.log(n + ' checks');
  }); }); });
})();
