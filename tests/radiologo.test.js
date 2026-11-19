/* station logos from radio-browser (tags/radio.js logoLookup): exact name, without spaces, else the brand of the channel */
var assert = require('assert'), http = require('http'), url = require('url');
var PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5bd0000000049454e44ae426082', 'hex');
var calls = [], base;
var stations = {
  'HR3': [{name: 'hr3', favicon: '/img/hr3.png'}],
  '80s80s': [{name: '80s80s Real 80s Radio', favicon: '/img/80s.png'}, {name: 'Radio 80s', favicon: '/img/falsch.png'}],
  'Radio': [{name: 'Radio Irgendwas', favicon: '/img/falsch.png'}]
};
var fake = http.createServer(function(req, res){
  var u = url.parse(req.url, true); calls.push(decodeURIComponent(u.pathname));
  var m = /^\/json\/stations\/byname\/(.*)$/.exec(decodeURIComponent(u.pathname));
  if (m) {
    var l = (stations[m[1]] || []).map(function(s){ return {name: s.name, favicon: base + s.favicon}; });
    res.writeHead(200, {'Content-Type': 'application/json'}); return res.end(JSON.stringify(l));
  }
  if (/^\/img\/(hr3|80s)\.png$/.test(u.pathname)) { res.writeHead(200); return res.end(PNG); }
  res.writeHead(404); res.end();
});
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
fake.listen(0, '127.0.0.1', function(){
  base = 'http://127.0.0.1:' + fake.address().port;
  process.env.RADIOBROWSER_URL = base; process.env.RADIO_ALLOW_LOCAL = '1';
  var radio = require('../tags/radio.js');
  radio.logoLookup('HR 3', function(img){
    t('"HR 3" found as "hr3"', function(){ assert.ok(img && img.equals(PNG)); assert.ok(calls.indexOf('/json/stations/byname/HR3') >= 0); });
    radio.logoLookup('80s80s Synthiepop', function(img2){
      t('channel without its own logo: the logo of the brand', function(){ assert.ok(img2 && img2.equals(PNG)); assert.ok(calls.indexOf('/img/80s.png') >= 0); });
      calls = [];
      radio.logoLookup('Radio Salü', function(img3, failed){
        t('a generic first word is no brand: no foreign logo', function(){
          assert.strictEqual(img3, null); assert.ok(!failed);
          assert.ok(!calls.some(function(c){ return c === '/json/stations/byname/Radio'; }));
        });
        fake.close();
        console.log(n + ' checks ok');
      });
    });
  });
});
