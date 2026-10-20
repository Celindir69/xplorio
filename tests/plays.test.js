/* history: recording (Tracker), storage and sync, most played, statistics, local time */
var assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
var plays = require('../tags/plays.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }

function st(status, title, seek, extra) {
  var s = {status: status, artist: 'Spliff', title: title, album: '85555', uri: 'music-library/USB/M/Spliff/' + title + '.flac',
           service: 'mpd', duration: 200, seek: seek};
  for (var k in extra || {}) s[k] = extra[k];
  return s;
}
function run(steps) {
  var got = [], started = [], tr = new plays.Tracker(function(e){ got.push(e); }, function(e){ started.push(e.ti); });
  steps.forEach(function(s){ tr.update(s[1], s[0] * 1000); });
  return {plays: got, started: started, tr: tr};
}
function every5(from, to, state) { var out = []; for (var s = from; s <= to; s += 5) out.push([s, state(s - from)]); return out; }

t('track counts after half, start = now - seek', function(){
  var r = run(every5(1000, 1105, function(s){ return st('play', 'Carbonara', s * 1000); }).concat([[1110, st('play', 'Déjà vu', 0)]]));
  assert.strictEqual(r.plays.length, 1);
  assert.strictEqual(r.plays[0].ti, 'Carbonara');
  assert.strictEqual(r.plays[0].t, 1000);
  assert.strictEqual(r.plays[0].d, 200);
  assert.deepStrictEqual(r.started, ['Carbonara', 'Déjà vu']);
});
t('skipped too early does not count', function(){
  var r = run(every5(1000, 1060, function(s){ return st('play', 'Carbonara', s * 1000); }).concat([[1065, st('play', 'Déjà vu', 0)]]));
  assert.strictEqual(r.plays.length, 0);
});
t('pause does not count as play time, stop finishes', function(){
  var steps = every5(1000, 1080, function(s){ return st('play', 'Carbonara', s * 1000); });
  steps = steps.concat(every5(1085, 2000, function(){ return st('pause', 'Carbonara', 80000); }));
  steps.push([2005, st('stop', 'Carbonara', 80000)]);
  assert.strictEqual(run(steps).plays.length, 0, '80 s of 200 s');
  steps = every5(1000, 1060, function(s){ return st('play', 'Carbonara', s * 1000); })
    .concat(every5(1065, 1500, function(){ return st('pause', 'Carbonara', 60000); }))
    .concat(every5(1505, 1555, function(s){ return st('play', 'Carbonara', 60000 + s * 1000); }));
  steps.push([1560, st('stop', 'Carbonara', 0)]);
  var r = run(steps);
  assert.strictEqual(r.plays.length, 1, '60 + 55 s');
  assert.strictEqual(r.plays[0].t, 1000);
});
t('repeating the same track = two plays; web radio and short tracks never', function(){
  var steps = every5(1000, 1195, function(s){ return st('play', 'Carbonara', s * 1000); })
    .concat(every5(1200, 1300, function(s){ return st('play', 'Carbonara', s * 1000); }));
  steps.push([1305, st('stop', 'Carbonara', 0)]);
  assert.strictEqual(run(steps).plays.length, 2);
  var radio = every5(1000, 1400, function(s){ return st('play', 'Nachrichten', s * 1000, {service: 'webradio', duration: 0}); });
  radio.push([1405, st('stop', 'x', 0)]);
  assert.strictEqual(run(radio).plays.length, 0);
  var short = every5(1000, 1025, function(s){ return st('play', 'Intro', s * 1000, {duration: 25}); });
  short.push([1030, st('stop', 'x', 0)]);
  assert.strictEqual(run(short).plays.length, 0);
});
t('long tracks count after 4 minutes; gaps are not fully counted', function(){
  var steps = every5(1000, 1245, function(s){ return st('play', 'Lang', s * 1000, {duration: 1200}); });
  steps.push([1250, st('stop', 'Lang', 0)]);
  assert.strictEqual(run(steps).plays.length, 1);
  var gap = [[1000, st('play', 'Lang', 0, {duration: 1200})], [1600, st('play', 'Lang', 600000, {duration: 1200})], [1605, st('stop', 'Lang', 0)]];
  assert.strictEqual(run(gap).plays.length, 0, 'a poll 10 min later counts at most 30 s');
});

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plays-'));
var file = path.join(dir, 'sub', 'plays.jsonl');
t('storage: append, load, sort, detect duplicates on sync', function(){
  var s = new plays.Store(file);
  assert.ok(s.add([{t: 2000, ar: 'Spliff', ti: 'Carbonara'}, {t: 3000, ar: 'Nena', ti: '99 Luftballons'}]));
  assert.ok(s.add([{t: 1000, ar: 'Spliff', ti: 'Heut Nacht', s: 'lastfm'}]));
  var again = new plays.Store(file).load();
  assert.deepStrictEqual(again.map(function(e){ return e.t; }), [1000, 2000, 3000]);
  var fresh = s.fresh([{t: 2100, ar: 'spliff', ti: 'CARBONARA'}, {t: 2500, ar: 'Spliff', ti: 'Carbonara'}, {t: 2550, ar: 'Spliff', ti: 'Carbonara'}, {t: 9000, ar: 'Nena', ti: 'Leuchtturm'}]);
  assert.deepStrictEqual(fresh.map(function(e){ return e.t; }), [2500, 9000], '±5 min equal; also within the batch');
});

var NOW = Date.UTC(2026, 9, 6, 12) / 1000, H = 3600, D = 86400;
var list = [
  {t: NOW - 400 * D, ar: 'Nena', ti: 'Leuchtturm', al: '?', d: 240},
  {t: NOW - 20 * D, ar: 'Spliff', ti: 'Carbonara', al: '85555', u: 'music-library/USB/M/Spliff/85555/01.flac', d: 200},
  {t: NOW - 2 * D, ar: 'Spliff', ti: 'Carbonara', al: '85555', s: 'lastfm'},
  {t: NOW - 2 * D + 300, ar: 'Spliff', ti: 'Déjà vu', al: '85555', u: 'music-library/USB/M/Spliff/85555/02.flac', d: 300},
  {t: NOW - D, ar: 'Falco', ti: 'Jeanny', al: 'Bravo Hits', u: 'music-library/USB/M/Bravo/03.flac', d: 360},
  {t: NOW - D + 400, ar: 'Nena', ti: '99 Luftballons', al: 'Bravo Hits', u: 'music-library/USB/M/Bravo/04.flac', d: 230},
  {t: NOW - D + 800, ar: 'Spliff', ti: 'Heut Nacht', al: 'Bravo Hits', u: 'music-library/USB/M/Bravo/05.flac', d: 250},
  {t: NOW - H, ar: 'spliff', ti: 'carbonara', al: '85555', u: 'music-library/USB/M/Spliff/85555/01.flac', d: 200}
];
t('most played: tracks, artists, albums (compilations together), period', function(){
  var tr = plays.top(list, 'track', plays.rangeStart('d30', NOW), 10);
  assert.strictEqual(tr[0].ti, 'carbonara', 'spelling from the last time');
  assert.strictEqual(tr[0].n, 3);
  assert.strictEqual(tr[0].u, 'music-library/USB/M/Spliff/85555/01.flac');
  var ar = plays.top(list, 'artist', 0, 10);
  assert.deepStrictEqual(ar.map(function(x){ return x.n; }), [5, 2, 1]);
  var al = plays.top(list, 'album', plays.rangeStart('d30', NOW), 10);
  assert.strictEqual(al[0].ti, '85555'); assert.strictEqual(al[0].n, 4, 'also the Last.fm entry without file');
  assert.strictEqual(al[1].ti, 'Bravo Hits'); assert.strictEqual(al[1].n, 3); assert.strictEqual(al[1].ar, 'Verschiedene');
  assert.strictEqual(al[1].u, 'music-library/USB/M/Bravo');
  assert.strictEqual(plays.recent(list, NOW - D, 2)[0].ti, 'Déjà vu');
});
t('statistics: totals, days, time of day and weekday in local time', function(){
  var s = plays.stats(list, 'd30', NOW, {w: 60, s: 120});
  assert.strictEqual(s.plays, 7);
  assert.strictEqual(s.estimated, 1);
  assert.strictEqual(s.seconds, 200 + 250 + 300 + 360 + 230 + 250 + 200, 'unknown duration = median');
  assert.strictEqual(s.buckets.length, 30);
  assert.strictEqual(s.buckets[29].k, '2026-10-06'); assert.strictEqual(s.buckets[29].n, 1);
  assert.strictEqual(s.buckets[28].n, 3);
  assert.strictEqual(s.hours[13], 1, '11:00 UTC = 13:00 summer time');
  assert.strictEqual(s.tracks, 5); assert.strictEqual(s.artists, 3);
  assert.strictEqual(s.weekdays[0], 3, 'Monday 5 Oct'); assert.strictEqual(s.weekdays[1], 1, 'Tuesday 6 Oct');
  var all = plays.stats(list, 'all', NOW, {w: 60, s: 120});
  assert.deepStrictEqual(all.buckets.map(function(b){ return b.k; }), ['2025', '2026']);
  assert.strictEqual(plays.stats(list, 'm12', NOW, {w: 60, s: 120}).buckets.length, 12);
  assert.deepStrictEqual(s.genres, []);
  var g = plays.stats(list, 'd30', NOW, {w: 60, s: 120}, function(e){ return e.ar === 'Spliff' ? 'Rock' : e.ar ? 'Pop' : ''; });
  assert.deepStrictEqual(g.genres.map(function(x){ return x.g; }).sort(), ['Pop', 'Rock']);
  assert.ok(g.genres[0].n >= g.genres[1].n, 'most common first');
  assert.strictEqual(g.genres.reduce(function(n, x){ return n + x.n; }, 0), 7);
});
t('local time: switch at end of March and end of October', function(){
  var tz = {w: 60, s: 120};
  assert.strictEqual(plays.local(Date.UTC(2026, 2, 29, 0, 30) / 1000, tz).getUTCHours(), 1);
  assert.strictEqual(plays.local(Date.UTC(2026, 2, 29, 1, 30) / 1000, tz).getUTCHours(), 3);
  assert.strictEqual(plays.local(Date.UTC(2026, 9, 25, 0, 30) / 1000, tz).getUTCHours(), 2);
  assert.strictEqual(plays.local(Date.UTC(2026, 9, 25, 1, 30) / 1000, tz).getUTCHours(), 2);
});
t('year in review: totals, previous year, months, top lists, newly discovered', function(){
  var tz = {w: 60, s: 120}, y = plays.year(list, 2026, tz, NOW + 100 * D);
  assert.strictEqual(y.plays, 7); assert.strictEqual(y.prev.plays, 1);
  assert.strictEqual(plays.year(list, 2026, tz, Date.UTC(2026, 1, 1) / 1000).prev.plays, 0, 'current year: previous year only up to the same day');
  assert.strictEqual(y.months[9], 6); assert.strictEqual(y.months[8], 1);
  assert.strictEqual(y.albums_top[0].ti, '85555'); assert.strictEqual(y.artists_top[0].n, 5);
  assert.strictEqual(y.tracks_top[0].n, 3);
  assert.ok(y.hasBefore);
  assert.deepStrictEqual(y.newArtists.map(function(a){ return a.ar; }), ['spliff', 'Falco'], 'Nena already played in 2025');
  var y25 = plays.year(list, 2025, tz, NOW);
  assert.strictEqual(y25.plays, 1); assert.strictEqual(y25.hasBefore, false); assert.strictEqual(y25.newArtists.length, 0);
  assert.deepStrictEqual(plays.years(list, tz), [2026, 2025]);
});
t('review with month: totals for the year, rankings and newly discovered for the month', function(){
  var tz = {w: 60, s: 120}, y = plays.year(list, 2026, tz, NOW, 10, null, 8);
  assert.strictEqual(y.plays, 7, 'totals stay for the year'); assert.strictEqual(y.month, 8);
  assert.deepStrictEqual(y.tracks_top.map(function(x){ return x.n; }), [1]);
  assert.deepStrictEqual(y.newArtists.map(function(a){ return a.ar; }), ['Spliff']);
  var o = plays.year(list, 2026, tz, NOW, 10, null, 9);
  assert.deepStrictEqual(o.newArtists.map(function(a){ return a.ar; }), ['Falco'], 'Spliff already played in September');
});
t('year boundary in local time: New Year\'s Eve 23:30 UTC counts to the new year', function(){
  var tz = {w: 60, s: 120}, l = [{t: Date.UTC(2025, 11, 31, 23, 30) / 1000, ar: 'A', ti: 'x'}];
  assert.strictEqual(plays.year(l, 2026, tz, NOW).plays, 1);
  assert.strictEqual(plays.year(l, 2025, tz, NOW).plays, 0);
  assert.strictEqual(plays.localStart(2026, 6, 1, tz), Date.UTC(2026, 5, 30, 22) / 1000, 'summer time');
});
t('a year ago: ±3 days, else further back, else empty', function(){
  var tz = {w: 60, s: 120};
  var l = [{t: NOW - 2 * 365 * D - 2 * D, ar: 'Nena', ti: 'a', al: 'Fragezeichen'}, {t: NOW - 365 * D - 10 * D, ar: 'X', ti: 'b', al: 'Zu weit'}, {t: NOW, ar: 'Y', ti: 'c', al: 'Heute'}];
  var a = plays.ago(l, NOW, tz);
  assert.strictEqual(a.years, 2); assert.strictEqual(a.items[0].ti, 'Fragezeichen');
  l.push({t: NOW - 365 * D + 2 * D, ar: 'Z', ti: 'd', al: 'Genau'});
  l.sort(function(x, z){ return x.t - z.t; });
  a = plays.ago(l, NOW, tz);
  assert.strictEqual(a.years, 1); assert.strictEqual(a.items[0].ti, 'Genau');
  assert.strictEqual(plays.ago([{t: NOW, ar: 'Y', ti: 'c', al: 'Heute'}], NOW, tz).items.length, 0);
  var ar = plays.ago(l, NOW, tz, 12, 'artist'), tr = plays.ago(l, NOW, tz, 12, 'track');
  assert.strictEqual(ar.items[0].ar, 'Z'); assert.strictEqual(ar.items[0].ti, undefined, 'artist without title');
  assert.strictEqual(tr.items[0].ti, 'd'); assert.strictEqual(tr.items[0].al, 'Genau');
});
t('most played by genre with the most played album as image', function(){
  var l = [{t: 10, ar: 'A', ti: 'x', al: 'Eins', u: 'USB/A/Eins/1.flac'}, {t: 11, ar: 'A', ti: 'y', al: 'Zwei', u: 'USB/A/Zwei/1.flac'},
           {t: 12, ar: 'A', ti: 'z', al: 'Zwei', u: 'USB/A/Zwei/2.flac'}, {t: 13, ar: 'B', ti: 'q', al: 'Drei', u: 'tidal://song/1'},
           {t: 14, ar: 'C', ti: 'r', al: '', u: ''}];
  var g = plays.topGenre(l, function(e){ return e.ar === 'A' ? 'Rock' : e.ar === 'B' ? 'Pop; Rock' : ''; }, 0, 10);
  assert.deepStrictEqual(g, [{g: 'Rock', n: 4, ar: 'A', al: 'Zwei', u: 'USB/A/Zwei'}, {g: 'Pop', n: 1, ar: 'B', al: 'Drei'}]);
  assert.deepStrictEqual(plays.topGenre(l, function(){ return 'Rock'; }, 12, 10)[0].n, 3, 'period');
});
t('album page: how often heard (break over 3 h = new listen), last; folder also with CD1/CD2', function(){
  var H = 3600, rel = function(u){ return String(u).replace(/^mnt\//, ''); };
  var l = [{t: 1000, ar: 'A', ti: 'x', al: 'Eins', u: 'mnt/USB/A/Eins/CD1/1.flac'}, {t: 1300, ar: 'A', ti: 'y', al: 'Eins', u: 'mnt/USB/A/Eins/CD2/1.flac'},
           {t: 1000 + 5 * H, ar: 'A', ti: 'x', al: 'Eins', u: 'mnt/USB/A/Eins/CD1/1.flac'}, {t: 1000 + 6 * H, ar: 'B', ti: 'q', al: 'Eins', u: 'tidal://1'},
           {t: 1000 + 7 * H, ar: 'A', ti: 'z', al: 'Einsam', u: 'mnt/USB/A/Einsam/1.flac'}];
  assert.deepStrictEqual(plays.albumStats(l, rel, 'USB/A/Eins', 'Eins', ''), {n: 2, tracks: 3, first: 1000, last: 1000 + 5 * H});
  assert.strictEqual(plays.albumStats(l, rel, '', 'Eins', 'B').n, 1, 'streaming: album and artist');
  assert.strictEqual(plays.albumStats(l, rel, 'USB/A/Fehlt', 'Fehlt', ''), null);
});
console.log(n + ' checks');
