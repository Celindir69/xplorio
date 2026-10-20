/* Language files (web/lang/*.js): every language has all keys of English, the same placeholders {…},
   singular/plural as {one, other} like English, no keys that English does not have */
var assert = require('assert'), fs = require('fs'), path = require('path');
var dir = path.join(__dirname, '..', 'web', 'lang');
var all = {};
global.langRegister = function(code, name, texts, locale){ all[code] = {name: name, texts: texts, locale: locale}; };
fs.readdirSync(dir).filter(function(f){ return /^[a-z]{2}\.js$/.test(f); }).forEach(function(f){ require(path.join(dir, f)); });
var en = all.en.texts, n = 0;
function holes(v) {
  var s = typeof v === 'object' ? v.one + '|' + v.other : String(v);
  return (s.match(/\{\w+\}/g) || []).filter(function(x, i, a){ return a.indexOf(x) === i; }).sort().join(',');
}
Object.keys(all).forEach(function(code){
  if (code === 'en') return;
  var t = all[code].texts, problems = [];
  assert.strictEqual(path.basename(code), code);
  Object.keys(en).forEach(function(k){
    if (!(k in t)) return problems.push('missing: ' + k);
    if ((typeof en[k] === 'object') !== (typeof t[k] === 'object')) return problems.push('singular/plural: ' + k);
    if (typeof t[k] === 'object' && (typeof t[k].one !== 'string' || typeof t[k].other !== 'string')) return problems.push('one/other: ' + k);
    /* {n} may be missing in the singular ("one hour") */
    var a = holes(en[k]).replace(/(^|,)\{n\}/, ''), b = holes(t[k]).replace(/(^|,)\{n\}/, '');
    if (a.replace(/^,/, '') !== b.replace(/^,/, '')) problems.push('placeholders ' + k + ': ' + holes(en[k]) + ' / ' + holes(t[k]));
  });
  Object.keys(t).forEach(function(k){ if (!(k in en)) problems.push('not in English: ' + k); });
  assert.deepStrictEqual(problems, [], code + ':\n' + problems.join('\n'));
  assert.ok(all[code].locale, code + ': locale missing');
  n++; console.log('ok   ' + code + ' (' + all[code].name + ', ' + Object.keys(t).length + ' texts)');
});
console.log(n + ' languages checked');
