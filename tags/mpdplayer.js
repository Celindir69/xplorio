/* MPD as the player, without Volumio (APP_CONFIG.PLAYER = 'mpd', e.g. on a Mac with "brew install mpd"): playback
   state, queue and commands in the shape Volumio's REST API answers (getState, getQueue), so the interface keeps one set
   of code (web/js/player.js). Live changes come from MPD's idle and go to the browser as server-sent events (/mpd/events).
   Covers from MPD itself (albumart: image file in the folder, readpicture: image inside the file).
   Node 8, ES5 only, no packages. */
var net = require('net');
var applemusic = require('./applemusic.js');

function quote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

/* ---------- MPD connection ---------- */

/* commands (several: command list with list_OK) -> cb(err, [lines per command], binary).
   binary: the bytes of a "binary: n" answer (albumart, readpicture), else null. opts: host, port, timeout */
function request(opts, cmds, cb) {
  var sock = net.createConnection({host: opts.host || 'localhost', port: opts.port || 6600});
  var buf = Buffer.alloc(0), greeted = false, lists = [[]], bin = null, need = 0, done = false;
  function finish(err) {
    if (done) return;
    done = true; clearTimeout(timer);
    try { sock.end('close\n'); } catch (e) { /* already closed */ }
    cb(err, lists, bin);
  }
  var timer = setTimeout(function(){ finish(new Error('MPD not responding')); sock.destroy(); }, opts.timeout || 8000);
  sock.on('data', function(d){
    buf = Buffer.concat([buf, d]);
    while (!done) {
      if (need) {                                        /* binary part, then a line feed */
        if (buf.length < need + 1) return;
        bin = buf.slice(0, need); buf = buf.slice(need + 1); need = 0;
        continue;
      }
      var n = buf.indexOf(10);
      if (n < 0) return;
      var l = buf.slice(0, n).toString('utf8'); buf = buf.slice(n + 1);
      if (!greeted) {
        greeted = true;
        if (l.indexOf('OK MPD') !== 0) return finish(new Error('not MPD'));
        sock.write(cmds.length > 1 ? 'command_list_ok_begin\n' + cmds.join('\n') + '\ncommand_list_end\n' : cmds[0] + '\n');
        continue;
      }
      if (l === 'OK') return finish(null);
      if (l === 'list_OK') { lists.push([]); continue; }
      if (l.indexOf('ACK') === 0) return finish(new Error(l));
      var m = /^binary: (\d+)$/.exec(l);
      if (m) { need = +m[1]; if (!need) bin = Buffer.alloc(0); continue; }
      lists[lists.length - 1].push(l);
    }
  });
  sock.on('error', finish);
  sock.on('close', function(){ finish(new Error('MPD connection closed')); });
}

/* "Key: value" lines -> {key: value} (keys lower case, the first value counts) */
function fields(lines) {
  var o = {};
  (lines || []).forEach(function(l){
    var i = l.indexOf(': ');
    if (i <= 0) return;
    var k = l.slice(0, i).toLowerCase();
    if (!(k in o)) o[k] = l.slice(i + 2);
  });
  return o;
}
/* playlistinfo and the like -> [{file, …}] (one object per song) */
function songs(lines) {
  var out = [], cur = null;
  (lines || []).forEach(function(l){
    var i = l.indexOf(': ');
    if (i <= 0) return;
    var k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
    if (k === 'file') { cur = {file: v}; out.push(cur); return; }
    if (k === 'directory' || k === 'playlist') { cur = null; return; }
    if (cur && !(k in cur)) cur[k] = v;
  });
  return out;
}

/* ---------- MPD -> Volumio's shapes ---------- */

function isStream(file) { return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(file || '')); }
function baseName(file) { return String(file || '').split('/').pop().replace(/\.[a-z0-9]{2,5}$/i, ''); }
/* address of the cover for a local song (tag service, /mpd/art); the browser puts the service's address in front */
function artOf(file) { return file && !isStream(file) ? '/mpd/art?file=' + encodeURIComponent(file) : ''; }
/* MPD's address of a song -> URI as Volumio gives it for its library ("music-library/USB/…"; streams as they are) */
function uriOf(file) { return isStream(file) ? file : 'music-library/' + file; }

/* "44100:16:2", "dsd64:2", "48000:f:2" -> {samplerate: "44.1 kHz", bitdepth: "16 bit", channels: 2} */
function audioOf(a) {
  var p = String(a || '').split(':'), out = {samplerate: '', bitdepth: '', channels: 0};
  if (!a) return out;
  var dsd = /^dsd(\d+)$/i.exec(p[0]);
  if (dsd) {
    out.samplerate = (Math.round(+dsd[1] * 44100 / 10000) / 100) + ' MHz';
    out.bitdepth = '1 bit';
    out.channels = parseInt(p[1], 10) || 0;
    return out;
  }
  var hz = parseInt(p[0], 10);
  if (hz > 0) out.samplerate = (Math.round(hz / 100) / 10) + ' kHz';
  if (/^\d+$/.test(p[1] || '')) out.bitdepth = p[1] + ' bit';
  else if (p[1] === 'f') out.bitdepth = '32 bit';
  out.channels = parseInt(p[2], 10) || 0;
  return out;
}
function typeOf(file) {
  if (isStream(file)) return 'webradio';
  var m = /\.([a-z0-9]{2,5})$/i.exec(String(file || ''));
  return m ? m[1].toLowerCase() : '';
}
function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

/* status and currentsong -> state like Volumio's getState. mute: Xplorio's own (MPD has none) */
function toState(st, song, mute) {
  st = st || {}; song = song || {};
  var file = song.file || '', stream = isStream(file), a = audioOf(st.audio);
  var title = song.title || (stream ? (song.name || file) : baseName(file));
  var vol = parseInt(st.volume, 10);
  var out = {
    status: st.state === 'play' || st.state === 'pause' ? st.state : 'stop',
    position: st.song !== undefined ? parseInt(st.song, 10) || 0 : 0,
    title: file ? title : '',
    artist: song.artist || '',
    album: song.album || '',
    albumart: artOf(file),
    uri: file ? uriOf(file) : '',
    trackType: file ? typeOf(file) : '',
    service: stream ? 'webradio' : 'mpd',
    seek: Math.round(num(st.elapsed) * 1000),
    duration: Math.round(num(st.duration) || num(song.duration) || num(song.time)),
    samplerate: a.samplerate,
    bitdepth: a.bitdepth,
    channels: a.channels,
    bitrate: st.bitrate && st.bitrate !== '0' ? st.bitrate + ' Kbps' : '',
    random: st.random === '1',
    repeat: st.repeat === '1',
    repeatSingle: st.single === '1',
    consume: st.consume === '1',
    volume: vol >= 0 ? (mute ? 0 : vol) : 0,
    mute: !!mute,
    disableVolumeControl: !(vol >= 0) && !mute,
    stream: stream,
    updatedb: !!st.updating_db,
    volatile: false,
    player: 'mpd'
  };
  if (stream && song.name) out.album = '';                  /* radio: station name, not an album */
  if (stream && song.name && !song.title) out.title = song.name;
  return out;
}
/* playlistinfo song -> queue entry like Volumio's getQueue */
function toItem(s) {
  var file = s.file || '', stream = isStream(file);
  var title = s.title || (stream ? (s.name || file) : baseName(file));
  return {uri: uriOf(file), service: stream ? 'webradio' : 'mpd', name: title, title: title, artist: s.artist || '',
          album: s.album || '', albumart: artOf(file), duration: Math.round(num(s.duration) || num(s.time)),
          trackType: typeOf(file), type: stream ? 'webradio' : 'song'};
}

/* ---------- Items as Xplorio plays them -> MPD ---------- */

/* Xplorio item (song, folder, album, artist, genre, radio) -> {add: path or URL} or {find: MPD command}; null = not
   playable here (streaming services, Volumio's own lists) */
function itemTarget(it) {
  var uri = String((it && it.uri) || '');
  if (/^https?:\/\//i.test(uri)) return {add: uri};
  var cmd = applemusic.itemCommand(it);
  if (!cmd) return null;
  if (/^listallinfo /.test(cmd)) {
    var p = uri.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
    return p ? {add: p} : null;
  }
  return {find: cmd};
}
function bySong(a, b) {                                   /* album by album, then disc and track (find answers in no order) */
  var al = a.album || '', bl = b.album || '';
  return al < bl ? -1 : al > bl ? 1 : (parseInt(a.disc, 10) || 0) - (parseInt(b.disc, 10) || 0) ||
    (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0) || (a.file < b.file ? -1 : 1);
}
/* items -> cb(null, ['add "…"', …], skipped). Albums, artists and genres are looked up (sorted like an album);
   an album without album artist tag is searched by artist */
function addCommands(mpd, items, cb) {
  var list = (items || []).slice(0, 2000), out = [], skipped = 0, i = 0;
  (function next(){
    if (i >= list.length) return cb(null, out, skipped);
    var t = itemTarget(list[i++]);
    if (!t) { skipped++; return next(); }
    if (t.add) { out.push('add ' + quote(t.add)); return next(); }
    mpd([t.find], function(err, lists){
      var found = err ? [] : songs(lists[0]);
      if (!found.length && /^find albumartist /.test(t.find)) {
        return mpd([t.find.replace(/^find albumartist /, 'find artist ')], function(e2, l2){ add(e2 ? [] : songs(l2[0])); });
      }
      add(found);
    });
    function add(found) {
      if (!found.length) skipped++;
      found.sort(bySong).forEach(function(s){ out.push('add ' + quote(s.file)); });
      next();
    }
  })();
}

/* ---------- Player ---------- */

/* opts: host, port, mpd(cmds, cb(err, lists, bin)) (tests), idle(onChange(subsystems)) -> stop() (tests) */
function Player(opts) {
  opts = opts || {};
  var self = this;
  this.host = opts.host || 'localhost';
  this.port = opts.port || 6600;
  this.mpd = opts.mpd || function(cmds, cb){ request({host: self.host, port: self.port}, cmds, cb); };
  this.idleFn = opts.idle || function(onChange){ return idleWatch(self.host, self.port, onChange); };
  this.muted = null;                                       /* volume before mute; null = not muted */
  this.clients = [];
  this.stopIdle = null;
  this.pushTimer = null; this.pushQueue = false;
}

Player.prototype.state = function(cb) {
  var self = this;
  this.mpd(['status', 'currentsong'], function(err, lists){
    if (err) return cb(err);
    cb(null, toState(fields(lists[0]), songs(lists[1])[0] || fields(lists[1]), self.muted !== null));
  });
};
Player.prototype.queue = function(cb) {
  this.mpd(['playlistinfo'], function(err, lists){
    if (err) return cb(err);
    cb(null, {queue: songs(lists[0]).map(toItem)});
  });
};

/* body {action, …} -> cb(code, answer). The actions are those of Volumio's REST commands and socket events. */
Player.prototype.command = function(body, cb) {
  var self = this, a = String((body && body.action) || '');
  function run(cmds) {
    self.mpd(cmds, function(err){ cb(err ? 502 : 200, err ? {ok: false, error: 'mpd', detail: err.message} : {ok: true}); });
  }
  function int(v) { return /^\d{1,6}$/.test(String(v)) ? +v : -1; }
  switch (a) {
    case 'play': {
      var p = body.pos === undefined ? null : int(body.pos);
      if (p === -1) return cb(400, {ok: false, error: 'pos'});
      return run([p === null ? 'play' : 'play ' + p]);
    }
    case 'pause': return run(['pause 1']);
    case 'stop': return run(['stop']);
    case 'next': return run(['next']);
    case 'prev': case 'previous': return run(['previous']);
    case 'toggle':
      return this.mpd(['status'], function(err, lists){
        if (err) return cb(502, {ok: false, error: 'mpd'});
        run([fields(lists[0]).state === 'play' ? 'pause 1' : 'play']);
      });
    case 'seek': {
      var s = int(body.sec);
      return s < 0 ? cb(400, {ok: false, error: 'sec'}) : run(['seekcur ' + s]);
    }
    case 'random': return run(['random ' + (body.on ? 1 : 0)]);
    case 'repeat': return run(['repeat ' + (body.value ? 1 : 0), 'single ' + (body.value && body.repeatSingle ? 1 : 0)]);
    case 'volume': {
      var v = int(body.value);
      if (v < 0 || v > 100) return cb(400, {ok: false, error: 'value'});
      this.muted = null;
      return run(['setvol ' + v]);
    }
    case 'mute':
      if (this.muted !== null) return cb(200, {ok: true});
      return this.mpd(['status'], function(err, lists){
        if (err) return cb(502, {ok: false, error: 'mpd'});
        var vol = parseInt(fields(lists[0]).volume, 10);
        if (!(vol >= 0)) return cb(200, {ok: false, error: 'novolume'});
        self.muted = vol;
        run(['setvol 0']);
      });
    case 'unmute': {
      if (this.muted === null) return cb(200, {ok: true});
      var back = this.muted; this.muted = null;
      return run(['setvol ' + back]);
    }
    case 'clear': return run(['clear']);
    case 'remove': {
      var r = int(body.pos);
      return r < 0 ? cb(400, {ok: false, error: 'pos'}) : run(['delete ' + r]);
    }
    case 'move': {
      var f = int(body.from), t = int(body.to);
      return f < 0 || t < 0 ? cb(400, {ok: false, error: 'pos'}) : run(['move ' + f + ' ' + t]);
    }
    case 'add': case 'replace':
      if (!Array.isArray(body.items)) return cb(400, {ok: false, error: 'items'});
      return addCommands(this.mpd, body.items, function(err, adds, skipped){
        if (!adds.length) return cb(200, {ok: false, error: 'nothing', skipped: skipped});
        var cmds = a === 'replace' ? ['clear'].concat(adds, ['play 0']) : adds;
        self.mpd(cmds, function(e2){
          cb(e2 ? 502 : 200, e2 ? {ok: false, error: 'mpd', detail: e2.message} : {ok: true, added: adds.length, skipped: skipped});
        });
      });
  }
  cb(400, {ok: false, error: 'unknown action'});
};

/* cover of a local song: image file in the folder (albumart), else the image in the file (readpicture).
   MPD sends it in pieces (binarylimit, default 8 KB) -> cb(err, {body, mime}) */
var ART_MAX = 16 * 1024 * 1024;
Player.prototype.art = function(file, cb) {
  var self = this;
  if (!file || isStream(file) || file.indexOf('\n') >= 0) return cb(new Error('no file'));
  function fetchAll(cmd, done) {
    var parts = [], got = 0, mime = '';
    (function more(){
      self.mpd([cmd + ' ' + quote(file) + ' ' + got], function(err, lists, bin){
        if (err) return done(err);
        var f = fields(lists[0]), size = parseInt(f.size, 10);
        if (f.type) mime = f.type;
        if (!bin || !bin.length || !(size > 0) || size > ART_MAX) return done(new Error('no image'));
        parts.push(bin); got += bin.length;
        if (got < size) return more();
        done(null, Buffer.concat(parts), mime);
      });
    })();
  }
  fetchAll('albumart', function(err, body, mime){
    if (!err) return cb(null, {body: body, mime: mime || sniff(body)});
    fetchAll('readpicture', function(e2, b2, m2){
      if (e2) return cb(e2);
      cb(null, {body: b2, mime: m2 || sniff(b2)});
    });
  });
};
function sniff(b) {
  if (b && b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b && b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b && b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

/* ---------- Live changes (server-sent events) ---------- */

/* a browser listens: res gets "state" (and "queue" when the queue changed) after every change in MPD */
Player.prototype.listen = function(res) {
  var self = this;
  this.clients.push(res);
  if (!this.stopIdle) {
    this.stopIdle = this.idleFn(function(changed){
      if (changed.indexOf('playlist') >= 0) self.pushQueue = true;
      self.schedulePush();
    });
  }
  this.state(function(err, st){ if (!err) send(res, 'state', st); });
  return function(){
    var i = self.clients.indexOf(res);
    if (i >= 0) self.clients.splice(i, 1);
    if (!self.clients.length && self.stopIdle) { self.stopIdle(); self.stopIdle = null; }
  };
};
/* several changes at once (clear, add, play) -> one push */
Player.prototype.schedulePush = function() {
  var self = this;
  if (this.pushTimer) return;
  this.pushTimer = setTimeout(function(){
    self.pushTimer = null;
    var q = self.pushQueue; self.pushQueue = false;
    if (!self.clients.length) return;
    self.state(function(err, st){
      if (err) return;
      self.clients.forEach(function(r){ send(r, 'state', st); if (q) send(r, 'queue', {}); });
    });
  }, 80);
  if (this.pushTimer.unref) this.pushTimer.unref();
};
function send(res, ev, obj) {
  try { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* gone */ }
}

/* MPD idle on its own connection: onChange([subsystems]) after each change; reconnects after errors. Returns stop() */
var IDLE = 'idle playlist player options mixer';
function idleWatch(host, port, onChange) {
  var sock = null, stopped = false, timer = null;
  function connect() {
    if (stopped) return;
    var buf = '', greeted = false, changed = [];
    sock = net.createConnection({host: host, port: port});
    sock.setEncoding('utf8');
    sock.on('data', function(d){
      buf += d;
      var n;
      while ((n = buf.indexOf('\n')) >= 0) {
        var l = buf.slice(0, n); buf = buf.slice(n + 1);
        if (!greeted) { greeted = true; sock.write(IDLE + '\n'); continue; }
        if (l.indexOf('changed: ') === 0) { changed.push(l.slice(9)); continue; }
        if (l === 'OK') { var c = changed; changed = []; onChange(c); sock.write(IDLE + '\n'); }
      }
    });
    sock.on('error', function(){ /* close follows */ });
    sock.on('close', function(){ sock = null; if (!stopped) timer = setTimeout(connect, 3000); });
  }
  connect();
  return function(){ stopped = true; clearTimeout(timer); if (sock) sock.destroy(); };
}

module.exports = {Player: Player, request: request, fields: fields, songs: songs, toState: toState, toItem: toItem,
                  audioOf: audioOf, itemTarget: itemTarget, addCommands: addCommands, idleWatch: idleWatch};
