/* Alben nach Stimmung, Energie und Stil (tags/moodalbums.js) */
var assert = require('assert');
var ma = require('../tags/moodalbums.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
function tr(dir, i, mood, energy, style) { return {it: {f: 'mnt/USB/' + dir + '/' + i + '.flac'}, r: {mood: mood, energy: energy, style: style}}; }
var idx = [
  tr('A/Ruhig', 1, ['relaxed'], 2, ['ambient']), tr('A/Ruhig', 2, ['relaxed', 'dreamy'], 1, ['ambient']), tr('A/Ruhig', 3, ['dark'], 2, ['downtempo']),
  tr('B/Laut', 1, ['intense'], 5, ['house']), tr('B/Laut', 2, ['epic'], 4, ['techno']), tr('B/Laut', 3, ['relaxed'], null, ['rock']),
  tr('C/Single', 1, ['relaxed'], 2, ['ambient'])
];
var albumList = [{dir: 'USB/A/Ruhig', al: 'Ruhig', ar: 'Alpha', y: 1999}, {dir: 'USB/B/Laut', al: 'Laut', ar: 'Beta'}, {dir: 'USB/C/Single', al: 'Single', ar: 'Gamma'}];
var sums = ma.summarize(idx);
function names(q) { return ma.list(sums, albumList, q).map(function(a){ return a.al; }); }

t('Stimmung: überwiegend (mindestens die Hälfte der eingeordneten Titel), Einzeltitel-Alben nicht', function(){
  assert.deepStrictEqual(names({moods: ['relaxed']}), ['Ruhig']);
  assert.deepStrictEqual(names({moods: ['dark']}), []);
  assert.deepStrictEqual(names({moods: ['intense', 'epic']}), ['Laut']);
});

t('Stil: ein Knopf mit mehreren verwandten Stilen zählt jeden Titel einmal', function(){
  assert.deepStrictEqual(names({styles: ['house', 'techno']}), ['Laut']);
  assert.deepStrictEqual(names({styles: ['house']}), []);
  assert.deepStrictEqual(names({styles: ['ambient', 'downtempo']}), ['Ruhig']);
});

t('Energie: gerundeter Mittelwert der Titel mit Energie', function(){
  assert.deepStrictEqual(names({emin: 1, emax: 2}), ['Ruhig']);
  assert.deepStrictEqual(names({emin: 4, emax: 5}), ['Laut']);
  assert.deepStrictEqual(names({emin: 3, emax: 3}), []);
  assert.deepStrictEqual(ma.list(sums, albumList, {emin: 1, emax: 2})[0], {dir: 'USB/A/Ruhig', al: 'Ruhig', ar: 'Alpha', y: 1999});
});

t('Profil eines Künstlers: häufige Stimmungen und Stile, mittlere Energie, Jahrzehnte seiner Alben', function(){
  function a(ar, mood, energy, style) { return {it: {ar: ar, f: 'x'}, r: {mood: mood, energy: energy, style: style}}; }
  var ix = [a('Alpha', ['relaxed', 'dreamy'], 2, ['ambient']), a('Alpha', ['relaxed'], 1, ['ambient', 'downtempo']),
            a('Alpha', ['relaxed'], 2, ['ambient']), a('Alpha', ['dark'], 3, []), a('alpha', ['relaxed'], null, ['ambient']),
            a('Beta', ['intense'], 5, ['house'])];
  for (var i = 0; i < 6; i++) ix.push(a('Alpha', [], null, []));          /* Titel ohne Stimmung zählen mit */
  var al = albumList.concat([{dir: 'USB/A/Neu', al: 'Neu', ar: 'Alpha', y: 2004}, {dir: 'USB/A/Alt', al: 'Alt', ar: 'alpha', y: 1971}]);
  var norm = function(s){ return String(s).toLowerCase(); };
  var p = ma.artistProfile(ix, al, 'alpha', norm);
  assert.strictEqual(p.n, 11);
  assert.deepStrictEqual(p.moods, ['relaxed']);                          /* dreamy, dark: zu selten (unter 20 %) */
  assert.deepStrictEqual(p.styles, ['ambient']);
  assert.strictEqual(p.energy, 2);
  assert.deepStrictEqual(p.decades, [1970, 1990, 2000]);
  assert.deepStrictEqual(ma.artistProfile(ix, al, 'gamma', norm), {n: 0, moods: [], styles: [], energy: 0, decades: []});
});

t('Entdecken zum Jahrzehnt: Künstler mit Alben darin, häufige Stimmungen und Stile, Nachbar-Jahrzehnte', function(){
  var al = [{dir: 'USB/A/Ruhig', al: 'Ruhig', ar: 'Alpha', y: 1999}, {dir: 'USB/B/Laut', al: 'Laut', ar: 'Beta', y: 1991},
            {dir: 'USB/C/Single', al: 'Single', ar: 'Gamma', y: 2003}, {dir: 'USB/A/Zwei', al: 'Zwei', ar: 'Alpha', y: 1995}];
  var p = ma.decadeProfile(idx, al, 1990, require('../tags/albums.js').albumDir);
  assert.strictEqual(p.n, 6);
  assert.deepStrictEqual(p.artists, ['Alpha', 'Beta']);
  assert.strictEqual(p.moods[0], 'relaxed');
  assert.ok(p.styles.indexOf('ambient') >= 0);
  assert.deepStrictEqual(p.decades, [1990, 2000]);
  assert.deepStrictEqual(ma.decadeProfile(idx, al, 2000, function(f){ return f.replace(/\/[^\/]*$/, ''); }).decades, [1990, 2000]);
});

t('Albumprofil: über Ordner oder Titel, ähnliche Alben je Künstler eins, weitere Alben des Künstlers', function(){
  function a(ar, dir, i, mood, energy, style) { return {it: {ar: ar, f: 'mnt/' + dir + '/' + i + '.flac'}, r: {mood: mood, energy: energy, style: style}}; }
  var norm = function(s){ return String(s || '').toLowerCase().trim(); };
  var ix = [a('Alpha', 'M/A1', 1, ['relaxed'], 2, ['ambient']), a('Alpha', 'M/A1', 2, ['relaxed', 'dreamy'], 2, ['ambient']),
            a('Alpha', 'M/A2', 1, ['intense'], 5, ['house']), a('Alpha', 'M/A2', 2, ['intense'], 5, ['house']),
            a('Beta', 'M/B1', 1, ['relaxed'], 2, ['ambient']), a('Beta', 'M/B1', 2, ['relaxed'], 1, ['ambient']),
            a('Beta', 'M/B2', 1, ['relaxed'], 2, ['ambient']), a('Beta', 'M/B2', 2, ['dreamy'], 2, ['ambient']),
            a('Gamma', 'M/G1', 1, ['intense'], 5, ['techno']), a('Gamma', 'M/G1', 2, ['epic'], 4, ['house'])];
  var al = [{dir: 'M/A1', al: 'Stille (Remastered)', ar: 'Alpha', y: 1994, ge: 'Ambient'}, {dir: 'M/A2', al: 'Laut', ar: 'Alpha', y: 1991},
            {dir: 'M/B1', al: 'Nebel', ar: 'Beta', y: 2001}, {dir: 'M/B2', al: 'Dunst', ar: 'Beta'}, {dir: 'M/G1', al: 'Funken', ar: 'Gamma'}];
  var p = ma.albumProfile(ix, al, {dir: 'M/A1'}, norm);
  assert.strictEqual(p.source, 'album');
  assert.deepStrictEqual(p.moods, ['relaxed', 'dreamy']);
  assert.deepStrictEqual(p.styles, ['ambient']);
  assert.strictEqual(p.energy, 2); assert.strictEqual(p.year, 1994); assert.strictEqual(p.genre, 'Ambient');
  assert.deepStrictEqual(p.similar.map(function(x){ return x.al; }), ['Dunst']);          /* Beta nur einmal (Dunst passt besser), Gamma passt nicht, Alpha nie */
  assert.deepStrictEqual(p.others.map(function(x){ return x.al; }), ['Laut']);
  var bySearch = ma.albumProfile(ix, al, {artist: 'alpha', album: 'Stille'}, norm);                   /* Titel ohne Zusatz, vom Dienst oder aus der Suche */
  assert.strictEqual(bySearch.source, 'album'); assert.strictEqual(bySearch.dir, 'M/A1');          /* Ordner für den Würfel der ähnlichen Alben */
  var q = ma.albumProfile(ix, al, {artist: 'Gamma', album: 'Nur beim Dienst'}, norm);
  assert.strictEqual(q.source, 'artist'); assert.strictEqual(q.found, false); assert.strictEqual(q.dir, undefined);
  assert.deepStrictEqual(q.similar.map(function(x){ return x.al; }), ['Laut']);
  assert.deepStrictEqual(q.others.map(function(x){ return x.al; }), ['Funken']);
  var none = ma.albumProfile(ix, al, {artist: 'Delta', album: 'X'}, norm);
  assert.strictEqual(none.source, null); assert.deepStrictEqual(none.similar, []); assert.deepStrictEqual(none.others, []);
});

t('Würfel auf Stimmungs-/Stil-Seiten: nur Titel, die selbst passen', function(){
  assert.deepStrictEqual(Object.keys(ma.tracksMatching(idx, {moods: ['relaxed']})).sort(),
    ['USB/A/Ruhig/1.flac', 'USB/A/Ruhig/2.flac', 'USB/B/Laut/3.flac', 'USB/C/Single/1.flac']);
  assert.deepStrictEqual(Object.keys(ma.tracksMatching(idx, {styles: ['ambient'], emin: 2, emax: 2})).sort(), ['USB/A/Ruhig/1.flac', 'USB/C/Single/1.flac']);
  assert.deepStrictEqual(Object.keys(ma.tracksMatching(idx, {emin: 4, emax: 5})).sort(), ['USB/B/Laut/1.flac', 'USB/B/Laut/2.flac']);   /* ohne Energie nicht dabei */
});

console.log(n + ' Prüfungen');
