/* Text functions for the tag editor (capitalize words, title case, lower, UPPER, spaces, replace).
   Classic script in the global scope; also loadable via require() for the tests. */

/* English small words that stay lowercase in title case (except at the start, the end and after : ( - etc.) */
var TEXT_SMALL_WORDS = ['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'on', 'in', 'at', 'to', 'by',
                        'as', 'vs', 'vs.', 'via'];

function textIsLetter(ch) { return ch.toLowerCase() !== ch.toUpperCase(); }
function textHasLower(s)  { for (var i = 0; i < s.length; i++) if (textIsLetter(s[i]) && s[i] === s[i].toLowerCase()) return true; return false; }

/* a new word starts after these characters (not apostrophe: "don't" stays "Don't") */
var TEXT_WORD_START = ' \t(["{-/.&+_';

/* "tears for fears" -> "Tears For Fears". The rest of a word stays as it is ("AC/DC", "McCartney"),
   unless the whole multi-word text is in CAPITALS ("TEARS FOR FEARS"): then lowercase everything first.
   A single word in capitals stays ("ABBA", "AC/DC"). */
function textWords(s) {
  s = String(s || '');
  if (!textHasLower(s) && /\S\s+\S/.test(s)) s = s.toLowerCase();
  var out = '', start = true;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (start && textIsLetter(ch)) { out += ch.toUpperCase(); start = false; }
    else {
      out += ch;
      if (TEXT_WORD_START.indexOf(ch) >= 0) start = true;
      else if (textIsLetter(ch) || /[0-9]/.test(ch)) start = false;
    }
  }
  return out;
}

/* Like textWords, but English small words (of, the, and …) stay lowercase, except at the start and the end
   and at the start of a section (after ":", "(", " - ", "/"): "Back In Black" -> "Back in Black" */
function textTitle(s) {
  var w = textWords(s);
  var parts = w.split(/(\s+)/), words = [];
  parts.forEach(function(p, i){ if (p && !/^\s+$/.test(p)) words.push(i); });
  words.forEach(function(idx, n){
    if (n === 0 || n === words.length - 1) return;
    var prev = parts[words[n - 1]];
    if (/[:(\[\/–-]$/.test(prev) || /^[-–\/]$/.test(prev)) return;
    var p = parts[idx], m = /^([("'\[]*)(.*?)([)"'\],;!?]*)$/.exec(p);
    if (m[1]) return;                                         /* "(The …" starts a section */
    if (TEXT_SMALL_WORDS.indexOf(m[2].toLowerCase()) >= 0 && m[2] === textWords(m[2].toLowerCase())) {
      parts[idx] = m[1] + m[2].toLowerCase() + m[3];
    }
  });
  return parts.join('');
}

function textLower(s)  { return String(s || '').toLowerCase(); }
function textUpper(s)  { return String(s || '').toUpperCase(); }
/* text for the language key (i18n.js); in Node tests there is no T(), then the German text */
function textT(key, de, vars) {
  if (typeof T === 'function') return T(key, vars);
  return !vars ? de : de.replace(/\{(\w+)\}/g, function(all, k){ return vars[k] === undefined ? all : vars[k]; });
}

function textSpaces(s) {
 return String(s || '').replace(/\s+/g, ' ').trim(); }

/* plain text, all occurrences; case-sensitive */
function textReplace(s, find, repl) {
  s = String(s || '');
  if (!find) return s;
  return s.split(find).join(repl || '');
}

/* ---------- Split by pattern ---------- */
/* placeholder in the pattern -> tag field; %DUMMY% captures text that is discarded */
var TEXT_PLACEHOLDERS = {title: 'title', artist: 'artist', album: 'album', albumartist: 'albumartist', genre: 'genre',
                         composer: 'composer', date: 'date', year: 'date', track: 'track', disc: 'disc', dummy: null};

function textEscRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'); }

/* "%TITLE% - %ARTIST%" -> {names:['title','artist'], lazy:RegExp, greedy:RegExp}; on error {error} */
function textPattern(pattern) {
  var parts = String(pattern || '').split(/%([a-zA-Z]+)%/), names = [], lazy = '', greedy = '';
  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { lazy += textEscRe(parts[i]); greedy += textEscRe(parts[i]); continue; }
    var key = parts[i].toLowerCase();
    if (!TEXT_PLACEHOLDERS.hasOwnProperty(key)) return {error: textT('textfn.err.unknown', 'unbekannter Platzhalter {name}', {name: '%' + parts[i] + '%'})};
    if (i > 1 && parts[i - 1] === '') return {error: textT('textfn.err.separator', 'zwischen zwei Platzhaltern muss ein Trennzeichen stehen')};
    names.push(TEXT_PLACEHOLDERS[key]);
    lazy += '(.+?)'; greedy += '(.+)';
  }
  if (!names.some(function(n){ return n; })) return {error: textT('textfn.err.none', 'Muster braucht mindestens einen Platzhalter wie %TITLE%')};
  return {names: names, lazy: new RegExp('^\\s*' + lazy + '\\s*$'), greedy: new RegExp('^\\s*' + greedy + '\\s*$')};
}

/* Split text by pattern -> {tags:{field:value}, ambiguous:bool, alt:{…}} or null if it does not match.
   ambiguous: the separator occurs more often than the pattern needs ("A - B - C"). tags splits at the first,
   alt at the last occurrence. */
function textSplit(value, pat) {
  var m = pat.lazy.exec(String(value || ''));
  if (!m) return null;
  var g = pat.greedy.exec(String(value || '')), tags = {}, alt = {}, ambiguous = false;
  pat.names.forEach(function(name, i){
    if (g && g[i + 1].trim() !== m[i + 1].trim()) ambiguous = true;
    if (name) { tags[name] = m[i + 1].trim(); alt[name] = g ? g[i + 1].trim() : tags[name]; }
  });
  return ambiguous ? {tags: tags, ambiguous: true, alt: alt} : {tags: tags, ambiguous: false};
}

/* list for menus: [id, label, function] */
var TEXT_FUNCS = [
  ['words', textT('textfn.func.words', 'Wortanfänge groß'), textWords],
  ['title', textT('textfn.func.title', 'Title Case (englisch)'), textTitle],
  ['lower', textT('textfn.func.lower', 'alles klein'), textLower],
  ['upper', textT('textfn.func.upper', 'ALLES GROSS'), textUpper],
  ['spaces', textT('textfn.func.spaces', 'Leerzeichen bereinigen'), textSpaces]
];
function textFunc(id) {
  for (var i = 0; i < TEXT_FUNCS.length; i++) if (TEXT_FUNCS[i][0] === id) return TEXT_FUNCS[i][2];
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {textWords: textWords, textTitle: textTitle, textLower: textLower, textUpper: textUpper,
                    textSpaces: textSpaces, textReplace: textReplace, textFunc: textFunc, TEXT_FUNCS: TEXT_FUNCS,
                    textPattern: textPattern, textSplit: textSplit};
}
