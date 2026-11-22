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

t('MusicBrainz: only a year or year-month is enough for the check; edition additions count as the same album, Live not', function(){
  var j = {'release-groups': [
    {score: 100, title: 'Nebelbank (Live)', 'first-release-date': '1980', 'artist-credit': [{name: 'Polar Echo'}]},
    {score: 100, title: 'Nebelbank', 'first-release-date': '1977', 'artist-credit': [{name: 'Polar Echo'}]}]};
  assert.strictEqual(rd.pickDate(j, 'Nebelbank (Remastered 2011)', 'Polar Echo', 0), '1977');
  assert.strictEqual(rd.pickDate(j, 'Nebelbank [Deluxe Edition]', 'Polar Echo', 0), '1977');
  assert.strictEqual(rd.pickDate(j, 'Nebelbank (Live)', 'Polar Echo', 0), '1980');
  assert.strictEqual(rd.stripEdition('Nebelbank (Live at Wembley, Deluxe Edition)'), 'Nebelbank (Live at Wembley, Deluxe Edition)');
  assert.strictEqual(rd.stripEdition('Nebelbank (40th Anniversary) [Bonus Tracks]'), 'Nebelbank');
  var c = new rd.Collector({file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-')), 'r.jsonl'), list: function(){ return [{dir: 'P/N', al: 'Nebelbank', ar: 'Polar Echo'}]; }});
  c.by['P/N'] = {dir: 'P/N', d: '1977', t: 'Nebelbank', at: 1};
  assert.strictEqual(c.dateOf({dir: 'P/N'}), '');                   /* birthdays: full dates only */
  c.by['P/N'] = {dir: 'P/N', d: '', t: '', at: Math.floor(Date.now() / 1000)};
  assert.strictEqual(c.next(Math.floor(Date.now() / 1000)).dir, 'P/N');   /* not found with the old rules: once more */
  var d = rd.diffs([{dir: 'P/N', al: 'Nebelbank', ar: 'Polar Echo', y: 1977, rd: '1977-05-02'}, {dir: 'P/M', al: 'Moor', ar: 'Polar Echo'}], [],
    function(x){ return {'P/N': '1977', 'P/M': '1979-04'}[x] || ''; }, albums.albumDir);
  assert.deepStrictEqual(d.map(function(x){ return [x.name, x.mb]; }), [['Moor', '1979-04']]);   /* same year: consistent; none: suggested */
});

t('year and month (tag "1977-05" or MusicBrainz): kept, counts as a birthday this month, not today or this week', function(){
  function s(file, date) { return {file: file, artist: 'A', albumartist: '', album: 'Moor', title: file, date: date, genre: ''}; }
  assert.strictEqual(albums.fromSongs([s('P/M/1.flac', '1979-11'), s('P/M/2.flac', '1979-11')])[0].rd, '1979-11');
  assert.strictEqual(albums.fromSongs([s('P/M/1.flac', '1979-11'), s('P/M/2.flac', '1979-11-03')])[0].rd, '1979-11-03');   /* full one first */
  var c = new rd.Collector({file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rd-')), 'r.jsonl'), list: function(){ return []; }});
  c.by['P/M'] = {dir: 'P/M', d: '1979-11', t: 'Moor', at: 1, v: 2};
  assert.strictEqual(c.dateOf({dir: 'P/M'}), '1979-11');
  c.by['P/M'].d = '1979-11-03';
  assert.strictEqual(c.dateOf({dir: 'P/M', rd: '1979-11'}), '1979-11-03');   /* the day from MusicBrainz wins over the tag's month */
  var b = rd.birthdays([{dir: 'P/M', al: 'Moor', ar: 'A', d: '1979-11'}, {dir: 'P/O', al: 'Ost', ar: 'A', d: '1980-12'}],
    function(a){ return a.d; }, '2026-11-22');
  assert.deepStrictEqual([b.today.length, b.week.length, b.month.map(function(x){ return [x.al, x.years]; })], [0, 0, [['Moor', 47]]]);
  var d = rd.diffs([{dir: 'P/M', al: 'Moor', ar: 'A', y: 1979, rd: '1979-11'}], [], function(){ return '1979-11-03'; }, albums.albumDir);
  assert.deepStrictEqual(d.map(function(x){ return [x.tag, x.mb]; }), [['1979-11', '1979-11-03']]);   /* MusicBrainz knows the day */
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
      assert.deepStrictEqual(c.progress(), {todo: 2, done: 2, found: 1, errors: 0, running: false});   /* with a full Date tag or compilation: not to do */
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

(function(){
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-')), file = path.join(dir, 'r.jsonl'), urls = [];
  var list = [{dir: 'L/H', al: 'Halbschatten', ar: 'Lumen Drift', y: 1981, rd: '1981-01-01'}];
  fs.writeFileSync(file, JSON.stringify({dir: 'L/H', d: '1981-10-14', at: 1}) + '\n');   /* record from before titles */
  var c = new rd.Collector({file: file, list: function(){ return list; }, stepMs: 1,
    extra: function(){ return [{dir: 'L/H', al: 'halbschatten (Disc 2)', ar: 'Lumen Drift', y: 1981}, {dir: 'S/V', al: 'X', ar: 'Verschiedene'}]; },
    getJson: function(u, cb){ urls.push(decodeURIComponent(u)); cb(null, mb); }});
  c.step(function(){ c.step(function(){
    c.stop();
    t('extra albums: looked up despite Date tag, without disc addition, MusicBrainz title kept; once', function(){
      assert.strictEqual(urls.length, 1);
      assert.ok(/releasegroup:"halbschatten" AND/.test(urls[0]), urls[0]);
      assert.strictEqual(c.by['L/H'].t, 'Halbschatten');
      assert.strictEqual(c.by['L/H'].d, '1981-10-14');
    });
  }); });
})();
