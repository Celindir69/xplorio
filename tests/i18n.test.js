/* Localization: language choice, fallback, placeholders; every key in the code is in de.js, en.js has the same ones */
var assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
var i18n = require('../web/js/i18n.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var ROOT = path.join(__dirname, '..'), LANGDIR = path.join(ROOT, 'web/lang');

var files = {};
fs.readdirSync(LANGDIR).filter(function(f){ return /^[\w-]+\.js$/.test(f); }).forEach(function(f){
  var got = null;
  vm.runInNewContext(fs.readFileSync(path.join(LANGDIR, f), 'utf8'), {langRegister: function(c, name, texts, loc){ got = {c: c, name: name, texts: texts, loc: loc}; }});
  files[f.replace(/\.js$/, '')] = got;
});

t('language choice: URL before setting before device, region ignored, else English', function(){
  assert.strictEqual(i18n.langPick(['de', 'en'], '?lang=en', 'de', ['de-DE']), 'en');
  assert.strictEqual(i18n.langPick(['de', 'en'], '', 'de', ['en-US']), 'de');
  assert.strictEqual(i18n.langPick(['de', 'en'], '', '', ['fr-FR', 'de-AT']), 'de');
  assert.strictEqual(i18n.langPick(['de', 'en'], '?x=1&lang=fr', '', ['it']), 'en');
  assert.strictEqual(i18n.langPick(['de', 'en', 'fr'], '', 'fr', []), 'fr');
  assert.strictEqual(i18n.langPick(['de', 'en'], '', '', ['en', 'de-DE']), 'en');   /* Volumio language before the device */
});

t('T: fallback language -> English -> German -> key, placeholders, singular/plural', function(){
  i18n.langRegister('de', 'Deutsch', {'a': 'A-de', 'b': 'B-de', 'n': {one: '1 Titel', other: '{n} Titel'}, 'p': 'Hallo {name}'});
  i18n.langRegister('en', 'English', {'a': 'A-en', 'n': {one: '1 track', other: '{n} tracks'}, 'p': 'Hello {name}'});
  i18n.langRegister('fr', 'Français', {'a': 'A-fr'});
  i18n.setLang('fr');
  assert.strictEqual(i18n.T('a'), 'A-fr'); assert.strictEqual(i18n.T('p', {name: 'X'}), 'Hello X');
  assert.strictEqual(i18n.T('b'), 'B-de'); assert.strictEqual(i18n.T('zz'), 'zz');
  i18n.setLang('de', 'de-DE');
  assert.strictEqual(i18n.T('n', {n: 1}), '1 Titel');
  assert.strictEqual(i18n.T('n', {n: 3}), '3 Titel');
  assert.strictEqual(i18n.T('p', {}), 'Hallo {name}');
});

t('language files: de and en present, same keys, same placeholders and forms', function(){
  assert.ok(files.de && files.en, 'de.js and en.js');
  assert.strictEqual(files.de.c, 'de'); assert.strictEqual(files.en.c, 'en');
  var de = files.de.texts, en = files.en.texts;
  var miss = Object.keys(de).filter(function(k){ return !(k in en); }), extra = Object.keys(en).filter(function(k){ return !(k in de); });
  assert.deepStrictEqual(miss, [], 'missing in en.js'); assert.deepStrictEqual(extra, [], 'only in en.js');
  function ph(v) { return (typeof v === 'object' ? v.one + v.other : v).match(/\{\w+\}/g) || []; }
  Object.keys(de).forEach(function(k){
    assert.strictEqual(typeof de[k], typeof en[k], 'form ' + k);
    if (typeof de[k] === 'object') assert.ok(de[k].one !== undefined && de[k].other !== undefined && en[k].one !== undefined && en[k].other !== undefined, k);
    assert.deepStrictEqual(ph(en[k]).filter(function(x, i, a){ return a.indexOf(x) === i; }).sort(),
                           ph(de[k]).filter(function(x, i, a){ return a.indexOf(x) === i; }).sort(), 'placeholders ' + k);
  });
});

t('every key in the code (T(…), data-i18n*) is in de.js', function(){
  var src = fs.readdirSync(path.join(ROOT, 'web/js')).filter(function(f){ return f !== 'i18n.js'; }).map(function(f){ return path.join(ROOT, 'web/js', f); })
    .concat([path.join(ROOT, 'xplorio.html')]);
  var used = {};
  src.forEach(function(f){
    var s = fs.readFileSync(f, 'utf8'), m, re = /\b(?:T|textT)\(\s*'([\w.-]+)'|data-i18n(?:-title|-placeholder|-aria|-empty)?="([\w.-]+)"/g;
    while ((m = re.exec(s))) if (!/\.$/.test(m[1] || m[2])) used[m[1] || m[2]] = path.basename(f);   /* 'mood.' + id: composed */
  });
  var missing = Object.keys(used).filter(function(k){ return !(k in files.de.texts); }).map(function(k){ return k + ' (' + used[k] + ')'; });
  assert.deepStrictEqual(missing, []);
  assert.ok(Object.keys(used).length > 100, 'keys found: ' + Object.keys(used).length);
});

t('other language files: valid, only known keys', function(){
  Object.keys(files).filter(function(c){ return c !== 'de' && c !== 'en'; }).forEach(function(c){
    assert.ok(files[c] && files[c].c === c, c + '.js calls langRegister(\'' + c + '\', …)');
    Object.keys(files[c].texts).forEach(function(k){ assert.ok(k in files.de.texts, c + ': unknown key ' + k); });
  });
});
console.log(n + ' checks');
