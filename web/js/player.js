/* Who plays: Volumio (default) or MPD alone (APP_CONFIG.PLAYER = 'mpd', e.g. on a Mac with "brew install mpd").
   Playback and queue go only through `player`, so the rest of the app does not care which one it is:
     player.state() / player.queue()        -> Promise of Volumio's getState / getQueue answer ({queue: […]})
     player.cmd('play'|'pause'|'toggle'|'stop'|'next'|'prev'), player.seek(sec), player.playAt(i)
     player.add(items), player.clear(), player.replaceAndPlay(item[, viaSocket]) -> Promise
     player.remove(i), player.move(from, to), player.random(on), player.repeat({value, repeatSingle})
     player.volume(v), player.mute(on), player.connected(), player.on('state'|'connect', fn)
   Volumio: exactly the REST and socket calls the app always made. MPD: through the tag service (tags/mpdplayer.js),
   live changes as server-sent events (/mpd/events).
   `socket` is Volumio's socket; with MPD a silent stand-in, so the Volumio-only parts (favourites, Infinity Playback,
   language, browse sources) simply do nothing.
   Classic script, shared global scope; loaded before core.js (load order see xplorio.html). */
var PLAYER_KIND = String((window.APP_CONFIG && window.APP_CONFIG.PLAYER) || 'volumio').toLowerCase() === 'mpd' ? 'mpd' : 'volumio';

var socket = PLAYER_KIND === 'mpd' || typeof io !== 'function'
  ? {connected: false, on: function(){}, off: function(){}, emit: function(){}}
  : io();

function volumioJson(r) { return r.json(); }

var playerVolumio = {
  kind: 'volumio',
  state: function(){ return fetch('/api/v1/getState').then(volumioJson); },
  queue: function(){ return fetch('/api/v1/getQueue').then(volumioJson); },
  cmd: function(c){ fetch('/api/v1/commands/?cmd=' + c).catch(function(){}); },
  seek: function(sec){ fetch('/api/v1/commands/?cmd=seek&position=' + sec).catch(function(){}); },
  playAt: function(i){ socket.emit('play', {value: i}); },
  add: function(items){ socket.emit('addToQueue', items); },
  clear: function(){ socket.emit('clearQueue'); },
  replaceAndPlay: function(item, viaSocket){
    if (viaSocket) { socket.emit('replaceAndPlay', item); return Promise.resolve(); }
    return fetch('/api/v1/replaceAndPlay', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({item: item})
    });
  },
  remove: function(i){ socket.emit('removeFromQueue', {value: i}); },
  move: function(from, to){ socket.emit('moveQueue', {from: from, to: to}); },
  random: function(on){ socket.emit('setRandom', {value: on}); },
  repeat: function(r){ socket.emit('setRepeat', r); },
  volume: function(v){ socket.emit('volume', v); },
  mute: function(on){ socket.emit(on ? 'mute' : 'unmute'); },
  connected: function(){ return socket.connected; },
  on: function(ev, fn){ socket.on(ev === 'state' ? 'pushState' : ev, fn); }
};

/* MPD through the tag service (its address as in tagedit.js) */
function playerMpdMake() {
  var base = 'http://' + location.hostname + ':' + ((window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766);
  var handlers = {state: [], connect: [], queue: []}, es = null, open = false;
  function fire(ev, arg) { handlers[ev].forEach(function(f){ try { f(arg); } catch (e) { console.error(e); } }); }
  /* cover addresses of the tag service ("/mpd/art?…") get its address, so artUrl() leaves them alone */
  function arts(o) {
    if (o && typeof o.albumart === 'string' && o.albumart.indexOf('/mpd/') === 0) o.albumart = base + o.albumart;
    return o;
  }
  function get(route) {
    return fetch(base + route).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  /* as text/plain: no preflight request (like tagPost) */
  function post(body) {
    return fetch(base + '/mpd/cmd', {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(body)})
      .then(function(r){ return r.json(); });
  }
  function quiet(body) { post(body).catch(function(){}); }
  function listen() {
    if (es || typeof EventSource !== 'function') return;
    es = new EventSource(base + '/mpd/events');
    es.addEventListener('open', function(){ if (!open) { open = true; fire('connect'); } });
    es.addEventListener('error', function(){ open = false; });       /* EventSource reconnects by itself */
    es.addEventListener('state', function(e){
      var st;
      try { st = JSON.parse(e.data); } catch (x) { return; }
      fire('state', arts(st));
    });
    es.addEventListener('queue', function(){ fire('queue'); });
  }
  return {
    kind: 'mpd',
    base: base,
    state: function(){ return get('/mpd/state').then(arts); },
    queue: function(){ return get('/mpd/queue').then(function(j){ (j && j.queue || []).forEach(arts); return j; }); },
    cmd: function(c){ quiet({action: c}); },
    seek: function(sec){ quiet({action: 'seek', sec: Math.max(0, Math.floor(sec))}); },
    playAt: function(i){ quiet({action: 'play', pos: i}); },
    add: function(items){ quiet({action: 'add', items: items || []}); },
    clear: function(){ quiet({action: 'clear'}); },
    replaceAndPlay: function(item){ return post({action: 'replace', items: [item]}); },
    remove: function(i){ quiet({action: 'remove', pos: i}); },
    move: function(from, to){ quiet({action: 'move', from: from, to: to}); },
    random: function(on){ quiet({action: 'random', on: !!on}); },
    repeat: function(r){ quiet({action: 'repeat', value: !!(r && r.value), repeatSingle: !!(r && r.repeatSingle)}); },
    volume: function(v){ quiet({action: 'volume', value: Math.round(Math.max(0, Math.min(100, v)))}); },
    mute: function(on){ quiet({action: on ? 'mute' : 'unmute'}); },
    connected: function(){ return open; },
    on: function(ev, fn){ if (handlers[ev]) handlers[ev].push(fn); listen(); }
  };
}

var player = PLAYER_KIND === 'mpd' ? playerMpdMake() : playerVolumio;

if (typeof module !== 'undefined') module.exports = {playerVolumio: playerVolumio, playerMpdMake: playerMpdMake};
