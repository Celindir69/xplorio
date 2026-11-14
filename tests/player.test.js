/* web/js/player.js: with Volumio exactly the REST and socket calls of before, with MPD the tag service's /mpd/* */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok   ' + name); }
var SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'player.js'), 'utf8');

/* runs player.js in a browser stand-in; records fetch and socket calls */
function load(cfg) {
  var log = {fetch: [], emit: [], on: [], es: []};
  var ctx = {
    window: {APP_CONFIG: cfg}, location: {hostname: 'player.local'}, console: console, Promise: Promise, JSON: JSON, Math: Math,
    fetch: function(u, o){ log.fetch.push([u, o]); return Promise.resolve({ok: true, json: function(){ return Promise.resolve({queue: [{albumart: '/mpd/art?file=a'}], albumart: '/mpd/art?file=b'}); }}); },
    io: function(){ return {connected: true, on: function(e){ log.on.push(e); }, emit: function(){ log.emit.push(Array.prototype.slice.call(arguments)); }}; },
    EventSource: function(u){ log.es.push(u); this.addEventListener = function(){}; }
  };
  vm.runInNewContext(SRC, ctx);
  return {ctx: ctx, log: log};
}

t('Volumio (default): the same calls as before', function(){
  var r = load({}), p = r.ctx.player;
  assert.strictEqual(p.kind, 'volumio');
  p.cmd('toggle'); p.seek(42); p.state(); p.queue();
  p.replaceAndPlay({uri: 'x'});
  assert.deepStrictEqual(r.log.fetch.map(function(f){ return f[0]; }),
    ['/api/v1/commands/?cmd=toggle', '/api/v1/commands/?cmd=seek&position=42', '/api/v1/getState', '/api/v1/getQueue', '/api/v1/replaceAndPlay']);
  assert.strictEqual(r.log.fetch[4][1].body, '{"item":{"uri":"x"}}');
  p.playAt(3); p.add([{uri: 'a'}]); p.clear(); p.remove(2); p.move(1, 4); p.random(true);
  p.repeat({value: true, repeatSingle: false}); p.volume(30); p.mute(true); p.mute(false); p.replaceAndPlay({uri: 'r'}, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.log.emit)), [
    ['play', {value: 3}], ['addToQueue', [{uri: 'a'}]], ['clearQueue'], ['removeFromQueue', {value: 2}], ['moveQueue', {from: 1, to: 4}],
    ['setRandom', {value: true}], ['setRepeat', {value: true, repeatSingle: false}], ['volume', 30], ['mute'], ['unmute'],
    ['replaceAndPlay', {uri: 'r'}]]);
  p.on('state', function(){}); p.on('connect', function(){});
  assert.deepStrictEqual(r.log.on, ['pushState', 'connect']);
  assert.strictEqual(p.connected(), true);
  assert.strictEqual(r.log.es.length, 0);
});

t('MPD: commands to the tag service, socket silent', function(){
  var r = load({PLAYER: 'mpd', TAGS_PORT: 9000}), p = r.ctx.player;
  assert.strictEqual(p.kind, 'mpd');
  r.ctx.socket.emit('getUiSettings');
  assert.strictEqual(r.log.emit.length, 0);
  p.cmd('next'); p.seek(12.7); p.playAt(0); p.add([{uri: 'u'}]); p.repeat({value: true, repeatSingle: true}); p.mute(true); p.volume(140);
  var bodies = r.log.fetch.map(function(f){ assert.strictEqual(f[0], 'http://player.local:9000/mpd/cmd'); return JSON.parse(f[1].body); });
  assert.deepStrictEqual(bodies, [{action: 'next'}, {action: 'seek', sec: 12}, {action: 'play', pos: 0}, {action: 'add', items: [{uri: 'u'}]},
    {action: 'repeat', value: true, repeatSingle: true}, {action: 'mute'}, {action: 'volume', value: 100}]);
  assert.strictEqual(r.log.fetch[0][1].headers['Content-Type'], 'text/plain;charset=UTF-8');   /* no preflight */
  p.on('state', function(){});
  assert.deepStrictEqual(r.log.es, ['http://player.local:9000/mpd/events']);
  p.on('connect', function(){});
  assert.strictEqual(r.log.es.length, 1);                               /* one connection for all listeners */
});

/* covers get the tag service's address */
var r2 = load({PLAYER: 'mpd'});
Promise.all([r2.ctx.player.state(), r2.ctx.player.queue()]).then(function(res){
  assert.strictEqual(res[0].albumart, 'http://player.local:8766/mpd/art?file=b');
  assert.strictEqual(res[1].queue[0].albumart, 'http://player.local:8766/mpd/art?file=a');
  n++; console.log('ok   MPD: cover addresses point to the tag service');
  console.log(n + ' tests passed');
}).catch(function(e){ console.log('FAIL covers: ' + e.message); process.exit(1); });
