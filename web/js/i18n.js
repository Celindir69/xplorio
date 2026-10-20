/* Localization: texts come from web/lang/<code>.js (e.g. de.js, en.js), the code only uses keys: T('search.none').
   Language: ?lang=xx in the URL, else LANGUAGE in config(.local).js, else the language of the Volumio UI,
   else the first matching device language from LANGUAGES, else English. If a text is missing in the chosen language, English applies, then German.
   New language: copy en.js, translate it, save as web/lang/<code>.js and add <code> to LANGUAGES.
   Classic script, ES5; loaded after config.js and loads the needed language files itself. */
var LANG_TEXTS = {};             /* code -> {key: text} */
var LANG_NAMES = {};             /* code -> name of the language in itself ("English") */
var LANG = 'en', LANG_LOCALE = 'en';

/* called by the language files; locale: for dates and numbers (e.g. 'de-DE'), else the code */
function langRegister(code, name, texts, locale) {
  LANG_TEXTS[code] = texts;
  LANG_NAMES[code] = name;
  if (code === LANG && locale) LANG_LOCALE = locale;
}

/* desired language: URL, setting, device; only codes from avail */
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

/* language last reported by Volumio (localStorage, since the answer only arrives after loading) */
function langStored() {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem('volumioLang')) || ''; } catch (e) { return ''; }
}

/* text for the key; {name} is replaced from vars. If the entry is {one, other}, vars.n picks the form */
function T(key, vars) {
  var s;
  [LANG, 'en', 'de'].some(function(c){ var x = LANG_TEXTS[c]; return x && (s = x[key]) !== undefined; });
  if (s === undefined) return key;
  if (s && typeof s === 'object') s = vars && vars.n === 1 ? s.one : s.other;
  return !vars ? s : String(s).replace(/\{(\w+)\}/g, function(all, k){
    return vars[k] === undefined ? all : (k === 'n' && typeof vars.n === 'number' ? langNum(vars.n) : vars[k]);
  });
}

/* numbers and dates in the language's format */
function langNum(n) {
  try { return Number(n).toLocaleString(LANG_LOCALE); } catch (e) { return String(n); }
}
function langDate(d, opts) {
  d = d instanceof Date ? d : new Date(d);
  try { return d.toLocaleDateString(LANG_LOCALE, opts || {day: 'numeric', month: 'numeric', year: 'numeric'}); }
  catch (e) { return d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear(); }
}
/* month and weekday names (Monday first); width: 'long', 'short' or 'narrow' */
function langMonths(width) {
  var out = [];
  for (var m = 0; m < 12; m++) out.push(langDate(new Date(2024, m, 15), {month: width || 'long'}));
  return out;
}
function langWeekdays(width) {
  var out = [];
  for (var d = 0; d < 7; d++) out.push(langDate(new Date(2024, 0, 1 + d), {weekday: width || 'long'}));   /* 1 Jan 2024 was a Monday */
  return out;
}

/* static texts in the HTML: data-i18n (content), data-i18n-title, data-i18n-placeholder, data-i18n-aria (aria-label),
   data-i18n-empty (data-empty, placeholder via CSS content:attr(data-empty)) */
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
    var device = [langStored()].concat(navigator.languages || [navigator.language]);   /* Volumio before the device */
    LANG = LANG_LOCALE = langPick(avail, location.search, cfg.LANGUAGE, device);
    /* called by core.js as soon as Volumio reports its language: remember it and, if it changes the choice, reload once */
    window.langFromVolumio = function(code) {
      code = String(code || '').toLowerCase();
      if (!code || code === langStored()) return;
      try { localStorage.setItem('volumioLang', code); } catch (e) {}
      if (langStored() !== code) return;                /* storage blocked: do not reload, else endless loop */
      var want = langPick(avail, location.search, cfg.LANGUAGE, [code].concat(device.slice(1)));
      var once = false;
      try { once = sessionStorage.getItem('langReload') === want; sessionStorage.setItem('langReload', want); } catch (e) {}
      if (want !== LANG && !once) location.reload();
    };
    document.documentElement.lang = LANG;
    /* always load English and German as fallback */
    [LANG, 'en', 'de'].filter(function(c, i, a){ return a.indexOf(c) === i; }).forEach(function(c){
      document.write('<script src="web/lang/' + c + '.js?v=' + (window.XV || Date.now()) + '" onerror="void 0"><\/script>');
    });
  })();
}
