/* Genre suggestions for the library check: exactly one genre per album from the 15 Discogs top categories.
   Based on the existing genre tags (mapping table below) and the Discogs styles of the audio analysis
   (tags/essentia.js, "Electronic---Trip Hop"), averaged over all tracks of an album. The substyles stay in the
   tag service (result of the check); only the top category goes into the files. Node 8, ES5 only. */

var TOPS = ['Blues', 'Brass & Military', "Children's", 'Classical', 'Electronic', 'Folk, World, & Country', 'Funk / Soul',
            'Hip Hop', 'Jazz', 'Latin', 'Non-Music', 'Pop', 'Reggae', 'Rock', 'Stage & Screen'];
var MIN_SHARE = 0.25;            /* audio alone: the strongest top category needs at least this share */

/* key for genre names: no accents, lower case, & = and, letters and digits only ("Hip-Hop" = "hiphop") */
function genreKey(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  s = s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ');
  return s.replace(/[^a-z0-9]+/g, '');
}

/* known names -> top categories (several = ambiguous, then the audio analysis decides, else the first) */
var B = 'Blues', BM = 'Brass & Military', CH = "Children's", CL = 'Classical', EL = 'Electronic', FO = 'Folk, World, & Country',
    FS = 'Funk / Soul', HH = 'Hip Hop', JA = 'Jazz', LA = 'Latin', NM = 'Non-Music', PO = 'Pop', RE = 'Reggae', RO = 'Rock', SS = 'Stage & Screen';
var TABLE = {};
function map(tops, names) { names.split(',').forEach(function(n){ TABLE[genreKey(n)] = tops; }); }
TOPS.forEach(function(t){ TABLE[genreKey(t)] = [t]; });
map([B], 'blues,bluesrock,delta blues,chicago blues,electric blues');
map([BM], 'brass,military,marsch,marching band,blasmusik');
map([CH], 'children,childrens,kinder,kinderlieder,kindermusik,kids');
map([CL], 'classical,classic,klassik,klassisch,orchestral,orchester,opera,oper,baroque,barock,chamber music,kammermusik,' +
          'symphony,sinfonie,romantic,romantik,modern classical,neoclassical,choral,chor');
map([EL], 'electronic,electronica,elektronisch,elektronik,electro,techno,house,deep house,trance,ambient,downtempo,trip hop,' +
          'chillout,chill out,chill,lounge,idm,drum and bass,drum n bass,dnb,dubstep,edm,breakbeat,big beat,electro pop,' +
          'minimal,acid,eurodance,berlin school,experimental electronic');
map([EL, PO], 'dance,synth pop,synthpop,electropop,italo disco,hi nrg');
map([EL, FS], 'disco,nu disco');
map([EL, RO, PO], 'new wave,newwave,wave,dark wave,darkwave,new romantic');
map([FO], 'folk,country,world,world music,weltmusik,volksmusik,volkstümlich,americana,bluegrass,celtic,irish,keltisch,' +
          'african,afrobeat,folk rock');
map([FO, RO, PO], 'singer songwriter,liedermacher,songwriter');
map([FS], 'funk,soul,rnb,r and b,rhythm and blues,motown,northern soul,neo soul,gospel,contemporary r and b');
map([HH], 'hip hop,hiphop,rap,deutschrap,deutscher hip hop,gangsta,trap');
map([JA], 'jazz,swing,bebop,cool jazz,fusion,jazz rock,jazz funk,smooth jazz,acid jazz,free jazz,vocal jazz,nu jazz,latin jazz');
map([JA, BM], 'big band,bigband');
map([LA], 'latin,salsa,bossa nova,bossanova,samba,tango,reggaeton,cumbia,flamenco,mambo,latin pop');
map([RE], 'reggae,ska,dub,dancehall,rocksteady,roots reggae');
map([RO], 'rock,hard rock,hardrock,alternative,alternative rock,punk,punk rock,metal,heavy metal,hard and heavy,grunge,progressive,' +
          'progressive rock,prog rock,prog,art rock,psychedelic,psychedelic rock,classic rock,rock n roll,rock and roll,rockabilly,' +
          'krautrock,post rock,shoegaze,deutschrock,glam,glam rock,garage rock,stoner rock,symphonic rock,aor,soft rock,emo,gothic,' +
          'goth rock,industrial,britpop,indie rock,post punk');
map([RO, PO], 'indie,pop rock,poprock,rock pop,pop/rock,oldies,neue deutsche welle,ndw');
map([PO], 'pop,popmusik,deutschpop,deutsch pop,dance pop,europop,ballad,ballade,teen pop,k pop,j pop,vocal');
map([PO, FO], 'schlager,deutscher schlager,chanson,chansons,easy listening,adult contemporary');
map([SS], 'soundtrack,soundtracks,filmmusik,film,ost,score,film score,musical,musicals,video game,game,games,theme,tv');
map([NM], 'hörspiel,hoerspiel,hörbuch,hoerbuch,audiobook,audio book,spoken word,comedy,kabarett,speech,podcast,interview,' +
          'field recording,poetry,lesung');

/* substyle name -> top categories, learned from the audio analysis styles ("Electronic---Trip Hop") */
function learnStyles(entries) {
  var subs = {};
  entries.forEach(function(o){
    (o && o.styles || []).forEach(function(x){
      var p = String(x[0] || '').split('---'), k = genreKey(p[1]);
      if (!p[1] || TOPS.indexOf(p[0]) < 0 || !k) return;
      var l = subs[k] || (subs[k] = []);
      if (l.indexOf(p[0]) < 0) l.push(p[0]);
    });
  });
  return subs;
}

/* one genre tag -> top categories (empty = unknown); "Pop/Rock", "Rock; Pop" get split */
function topsOf(value, subs) {
  var k = genreKey(value);
  if (!k) return [];
  if (TABLE[k]) return TABLE[k].slice();
  if (subs && subs[k]) return subs[k].slice();
  var parts = String(value).split(/\s*[\/;,|]\s*|\s+-\s+/), out = [];
  if (parts.length < 2) return [];
  parts.forEach(function(p){ topsOf(p, subs).forEach(function(t){ if (out.indexOf(t) < 0) out.push(t); }); });
  return out;
}

/* audio analysis of an album: shares per top category (sum 1 per track, then averaged) and strongest substyles */
function audioVote(entries) {
  var top = {}, sub = {}, n = 0;
  entries.forEach(function(o){
    var t = {}, sum = 0;
    (o && o.styles || []).forEach(function(x){
      var p = String(x[0] || '').split('---'), w = +x[1] || 0;
      if (TOPS.indexOf(p[0]) < 0 || w <= 0) return;
      t[p[0]] = (t[p[0]] || 0) + w; sum += w;
      if (p[1]) sub[x[0]] = (sub[x[0]] || 0) + w;
    });
    if (!sum) return;
    n++;
    Object.keys(t).forEach(function(k){ top[k] = (top[k] || 0) + t[k] / sum; });
  });
  if (!n) return null;
  Object.keys(top).forEach(function(k){ top[k] /= n; });
  var order = Object.keys(top).sort(function(a, b){ return top[b] - top[a]; });
  var subs = Object.keys(sub).filter(function(k){ return k.split('---')[0] === order[0]; })
    .sort(function(a, b){ return sub[b] - sub[a]; }).slice(0, 3).map(function(k){ return k.split('---')[1]; });
  return {tracks: n, share: top, order: order, subs: subs};
}

/* suggestion for an album. values: {genre tag: number of tracks}; audio: audioVote(...) or null.
   -> {genre, how: 'table'|'audio'|'both', share} or null (no clue) */
function suggest(values, audio, subs) {
  var cand = {}, order = [];
  Object.keys(values).forEach(function(v){
    topsOf(v, subs).forEach(function(t, i){
      if (!cand.hasOwnProperty(t)) { cand[t] = 0; order.push(t); }
      cand[t] += values[v] * (i ? 0.5 : 1);          /* first mapping of an ambiguous name counts more */
    });
  });
  var share = audio ? audio.share : {};
  if (!order.length) {
    if (!audio || share[audio.order[0]] < MIN_SHARE) return null;
    return {genre: audio.order[0], how: 'audio', share: round(share[audio.order[0]])};
  }
  if (order.length === 1) return {genre: order[0], how: 'table', share: audio ? round(share[order[0]] || 0) : null};
  if (audio) {
    var best = order.slice().sort(function(a, b){ return (share[b] || 0) - (share[a] || 0); })[0];
    if (share[best] > 0) return {genre: best, how: 'both', share: round(share[best])};
  }
  order.sort(function(a, b){ return cand[b] - cand[a]; });
  return {genre: order[0], how: 'table', share: null};
}
function round(x) { return Math.round(x * 100) / 100; }

/* check evaluation. albums: [{dir, name, artist, files, songs:[{genre}], audio:[entries]}]
   -> {missing: [...], merge: [...], styles: {dir: {genre, subs}}} */
function check(albums) {
  var subs = learnStyles([].concat.apply([], albums.map(function(a){ return a.audio; })));
  var missing = [], groups = {}, styles = {};
  albums.forEach(function(a){
    var values = {}, empty = 0;
    a.songs.forEach(function(s){ var g = String(s.genre || '').trim(); if (g) values[g] = (values[g] || 0) + 1; else empty++; });
    var audio = audioVote(a.audio), names = Object.keys(values);
    var sg = suggest(values, audio, subs);
    if (audio) styles[a.dir] = {genre: audio.order[0], share: round(audio.share[audio.order[0]]), subs: audio.subs};
    var base = {dir: a.dir, name: a.name, artist: a.artist, count: a.files.length, files: a.files,
                genre: sg ? sg.genre : null, how: sg ? sg.how : null, share: sg ? sg.share : null, subs: audio ? audio.subs : []};
    if (!names.length) { missing.push(base); return; }
    if (!sg || (names.length === 1 && !empty && names[0] === sg.genre)) return;
    var from = names.sort().join(' / ') + (empty ? ' / –' : '');
    var key = from + '\n' + sg.genre;
    var g = groups[key] || (groups[key] = {from: from, genre: sg.genre, albums: [], count: 0, files: []});
    g.albums.push({dir: a.dir, name: a.name, artist: a.artist, how: sg.how});
    g.count += a.files.length;
    g.files = g.files.concat(a.files);
  });
  var merge = Object.keys(groups).map(function(k){ return groups[k]; })
    .sort(function(a, b){ return b.albums.length - a.albums.length || a.from.localeCompare(b.from); });
  missing.sort(function(a, b){ return (b.genre ? 1 : 0) - (a.genre ? 1 : 0) || a.dir.localeCompare(b.dir); });
  return {missing: missing, merge: merge, styles: styles};
}

/* ---------- substyles per album (genre page, search) ---------- */
var SUB_SHARE = 0.15;           /* further substyles of an album from this share on (the strongest always counts) */
var SUB_MAX = 3;

/* substyles of an album within its top categories tops: shares per track (only styles of these categories),
   averaged over the analyzed tracks -> names, strongest first */
function albumSubs(entries, tops) {
  var sub = {}, n = 0;
  entries.forEach(function(o){
    var t = {}, sum = 0;
    (o && o.styles || []).forEach(function(x){
      var p = String(x[0] || '').split('---'), w = +x[1] || 0;
      if (!p[1] || tops.indexOf(p[0]) < 0 || w <= 0) return;
      t[p[1]] = (t[p[1]] || 0) + w; sum += w;
    });
    if (!sum) return;
    n++;
    Object.keys(t).forEach(function(k){ sub[k] = (sub[k] || 0) + t[k] / sum; });
  });
  if (!n) return [];
  return Object.keys(sub).sort(function(a, b){ return sub[b] - sub[a] || a.localeCompare(b); })
    .filter(function(k, i){ return i === 0 || sub[k] / n >= SUB_SHARE; }).slice(0, SUB_MAX);
}

/* substyles of all albums: list = album list [{dir, ge}], tracks = [[artist, title, file, sec., album], …],
   audioOf(artist, title, album) -> analysis or null, dirOf(file) -> album folder. -> {folder: [substyles]} */
function subsIndex(list, tracks, audioOf, dirOf) {
  var byDir = {}, out = {};
  tracks.forEach(function(t){
    var o = audioOf(t[0], t[1], t[4]);
    if (o) (byDir[dirOf(t[2])] || (byDir[dirOf(t[2])] = [])).push(o);
  });
  list.forEach(function(a){
    var tops = a.ge && byDir[a.dir] ? topsOf(a.ge) : [];
    var subs = tops.length ? albumSubs(byDir[a.dir], tops) : [];
    if (subs.length) out[a.dir] = subs;
  });
  return out;
}

/* substyles as tiles: [{g, s, n (albums), dir, al, ar}], largest first.
   g: only albums of this genre; q: substring in the substyle name (search across all genres) */
function subList(list, idx, g, q) {
  var by = {}, out = [];
  g = String(g || '').toLowerCase(); q = String(q || '').toLowerCase().trim();
  list.forEach(function(a){
    if (!a.ge || !idx[a.dir] || (g && a.ge.toLowerCase() !== g)) return;
    idx[a.dir].forEach(function(s){
      if (q && s.toLowerCase().indexOf(q) < 0) return;
      var k = a.ge.toLowerCase() + '\n' + s.toLowerCase(), x = by[k];
      if (!x) { x = by[k] = {g: a.ge, s: s, n: 0, dir: a.dir, al: a.al, ar: a.ar}; out.push(x); }
      x.n++;
    });
  });
  return out.sort(function(a, b){ return b.n - a.n || a.s.localeCompare(b.s); });
}

module.exports = {TOPS: TOPS, genreKey: genreKey, topsOf: topsOf, learnStyles: learnStyles, audioVote: audioVote,
                  suggest: suggest, check: check, albumSubs: albumSubs, subsIndex: subsIndex, subList: subList};
