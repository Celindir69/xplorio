/* Mehrsprachigkeit: Texte kommen aus web/lang/<code>.js (z. B. de.js, en.js), im Code nur Schlüssel: T('search.none').
   Sprache: ?lang=xx in der Adresse, sonst LANGUAGE in config(.local).js, sonst die Sprache der Volumio-Oberfläche,
   sonst die erste passende Gerätesprache aus LANGUAGES, sonst Englisch. Fehlt ein Text in der gewählten Sprache, gilt der englische, dann der deutsche.
   Neue Sprache: en.js kopieren, übersetzen, als web/lang/<code>.js ablegen und <code> in LANGUAGES eintragen.
   Klassisches Skript, ES5; wird nach config.js geladen und lädt selbst die nötigen Sprachdateien nach. */
var LANG_TEXTS = {};             /* Code -> {Schlüssel: Text} */
var LANG_NAMES = {};             /* Code -> Name der Sprache in ihr selbst ("English") */
var LANG = 'en', LANG_LOCALE = 'en';

/* von den Sprachdateien aufgerufen; locale: für Datum und Zahlen (z. B. 'de-DE'), sonst der Code */
function langRegister(code, name, texts, locale) {
  LANG_TEXTS[code] = texts;
  LANG_NAMES[code] = name;
  if (code === LANG && locale) LANG_LOCALE = locale;
}

/* gewünschte Sprache: Adresse, Einstellung, Gerät; nur Codes aus avail */
function langPick(avail, query, setting, device) {
  function find(c) {
    c = String(c || '').toLowerCase();
    if (avail.indexOf(c) >= 0) return c;
    c = c.split(/[-_]/)[0];
    return avail.indexOf(c) >= 0 ? c : '';
  }
  var m = /[?&]lang=([\w-]+)/.exec(query || '');
  var hit = (m && find(m[1])) || find(setting);
  for (var i = 0; !hit && device && i < device.length; i++) hit = find(device[i]);
  return hit || (avail.indexOf('en') >= 0 ? 'en' : avail[0] || 'de');
}

/* zuletzt von Volumio gemeldete Sprache (localStorage, da die Antwort erst nach dem Laden kommt) */
function langStored() {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem('volumioLang')) || ''; } catch (e) { return ''; }
}

/* Text zum Schlüssel; {name} wird aus vars ersetzt. Ist der Eintrag {one, other}, wählt vars.n die Form */
function T(key, vars) {
  var s;
  [LANG, 'en', 'de'].some(function(c){ var x = LANG_TEXTS[c]; return x && (s = x[key]) !== undefined; });
  if (s === undefined) return key;
  if (s && typeof s === 'object') s = vars && vars.n === 1 ? s.one : s.other;
  return !vars ? s : String(s).replace(/\{(\w+)\}/g, function(all, k){
    return vars[k] === undefined ? all : (k === 'n' && typeof vars.n === 'number' ? langNum(vars.n) : vars[k]);
  });
}

/* Zahlen und Datum im Format der Sprache */
function langNum(n) {
  try { return Number(n).toLocaleString(LANG_LOCALE); } catch (e) { return String(n); }
}
function langDate(d, opts) {
  d = d instanceof Date ? d : new Date(d);
  try { return d.toLocaleDateString(LANG_LOCALE, opts || {day: 'numeric', month: 'numeric', year: 'numeric'}); }
  catch (e) { return d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear(); }
}
/* Monats- und Wochentagsnamen (Montag zuerst); width: 'long', 'short' oder 'narrow' */
function langMonths(width) {
  var out = [];
  for (var m = 0; m < 12; m++) out.push(langDate(new Date(2024, m, 15), {month: width || 'long'}));
  return out;
}
function langWeekdays(width) {
  var out = [];
  for (var d = 0; d < 7; d++) out.push(langDate(new Date(2024, 0, 1 + d), {weekday: width || 'long'}));   /* 1.1.2024 war ein Montag */
  return out;
}

/* statische Texte im HTML: data-i18n (Inhalt), data-i18n-title, data-i18n-placeholder, data-i18n-aria (aria-label),
   data-i18n-empty (data-empty, Platzhalter per CSS content:attr(data-empty)) */
function langApply(root) {
  root = root || document;
  [['data-i18n', 'textContent'], ['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria', 'aria-label'], ['data-i18n-empty', 'data-empty']].forEach(function(a){
    Array.prototype.forEach.call(root.querySelectorAll('[' + a[0] + ']'), function(el){
      var v = T(el.getAttribute(a[0]));
      if (/-/.test(a[1])) el.setAttribute(a[1], v); else el[a[1]] = v;
    });
  });
}

if (typeof module !== 'undefined') {
  module.exports = {langPick: langPick, langRegister: langRegister, T: T, LANG_TEXTS: LANG_TEXTS,
                    setLang: function(c, loc){ LANG = c; LANG_LOCALE = loc || c; }};
} else {
  (function(){
    var cfg = window.APP_CONFIG || {};
    var avail = cfg.LANGUAGES || ['de', 'en', 'fr', 'es', 'it'];
    var device = [langStored()].concat(navigator.languages || [navigator.language]);   /* Volumio vor dem Gerät */
    LANG = LANG_LOCALE = langPick(avail, location.search, cfg.LANGUAGE, device);
    /* von core.js gerufen, sobald Volumio seine Sprache meldet: merken und, falls sie die Wahl ändert, einmal neu laden */
    window.langFromVolumio = function(code) {
      code = String(code || '').toLowerCase();
      if (!code || code === langStored()) return;
      try { localStorage.setItem('volumioLang', code); } catch (e) {}
      if (langStored() !== code) return;                /* Speicher gesperrt: nicht neu laden, sonst endlos */
      var want = langPick(avail, location.search, cfg.LANGUAGE, [code].concat(device.slice(1)));
      var once = false;
      try { once = sessionStorage.getItem('langReload') === want; sessionStorage.setItem('langReload', want); } catch (e) {}
      if (want !== LANG && !once) location.reload();
    };
    document.documentElement.lang = LANG;
    /* Englisch und Deutsch als Rückfall immer mitladen */
    [LANG, 'en', 'de'].filter(function(c, i, a){ return a.indexOf(c) === i; }).forEach(function(c){
      document.write('<script src="web/lang/' + c + '.js?v=' + (window.XV || Date.now()) + '" onerror="void 0"><\/script>');
    });
  })();
}
