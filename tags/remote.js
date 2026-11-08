/* Playback on this device (headphones button, web/js/remote.js; ?player=remote|both|lokal): MPD's stream output ("httpd" in
   /etc/mpd.conf, from the "MPD HTTP & Icecast output" plugin or added by hand; Xplorio never changes the file) goes to the
   browser through the tag service; the ALSA output (amplifier) is switched off for "remote". Pure helpers here, the service is in tag-service.js. Node 8, ES5 only. */
var net = require('net');

/* audio_output blocks of mpd.conf -> [{type, name, port, enabled}] */
function confOutputs(text) {
  var out = [], re = /audio_output\s*\{([^}]*)\}/g, m;
  text = String(text || '').split(/\r?\n/).map(function(l){                 /* comments out, "#" inside quotes stays */
    return l.replace(/^((?:[^"#]|"[^"]*")*)#.*$/, '$1');
  }).join('\n');
  while ((m = re.exec(text))) {
    var o = {};
    m[1].split(/\r?\n/).forEach(function(l){
      var k = /^\s*([a-z_]+)\s+"([^"]*)"/i.exec(l);
      if (k) o[k[1].toLowerCase()] = k[2];
    });
    out.push({type: o.type || '', name: o.name || '', port: parseInt(o.port, 10) || 8000, enabled: o.enabled !== 'no', encoder: o.encoder || 'lame',
              bitrate: parseInt(o.bitrate, 10) || 0});
  }
  return out;
}

/* lines of MPD's "outputs" -> [{id, name, enabled, plugin}] */
function parseOutputs(lines) {
  var out = [], cur = null;
  lines.forEach(function(l){
    var i = l.indexOf(': ');
    if (i < 0) return;
    var k = l.slice(0, i), v = l.slice(i + 2);
    if (k === 'outputid') { cur = {id: +v, name: '', enabled: false, plugin: ''}; out.push(cur); }
    else if (cur && k === 'outputname') cur.name = v;
    else if (cur && k === 'outputenabled') cur.enabled = v === '1';
    else if (cur && k === 'plugin') cur.plugin = v;
  });
  return out;
}

/* outputs and mpd.conf -> {stream: {id, port, enabled, name, encoder}, alsa: [{id, enabled}]} or null without a stream output.
   The stream output comes from mpd.conf: from the "MPD HTTP & Icecast output" plugin (mpdoutput, Volumio 4) or added by hand,
   which writes its HTTP stream there through Volumio and adds a local-only feed for Icecast that is not meant for listeners */
var PLUGIN_FEED = 'mpdoutput-icecast-feed';
function find(outs, conf) {
  var types = {};
  conf.forEach(function(c){ types[c.name] = c; });
  var stream = null, alsa = [];
  outs.forEach(function(o){
    var type = o.plugin || (types[o.name] && types[o.name].type) || '';
    if (o.name === PLUGIN_FEED) return;                  /* the feed of the "MPD HTTP & Icecast output" plugin for its Icecast relay */
    var c = types[o.name] || {};
    if (type === 'httpd' && !stream) stream = {id: o.id, port: c.port || 8000, enabled: o.enabled, name: o.name, encoder: c.encoder || 'lame', bitrate: c.bitrate || 0};
    if (type === 'alsa') alsa.push({id: o.id, enabled: o.enabled});
  });
  return stream ? {stream: stream, alsa: alsa} : null;
}

/* current mode from the outputs: 'lokal' | 'remote' | 'both' */
function modeOf(f) {
  var a = f.alsa.some(function(x){ return x.enabled; });
  return !f.stream.enabled ? 'lokal' : a ? 'both' : 'remote';
}

/* nobody has listened for a while: back to "lokal"? For "remote" always (the system must not stay silent); for "both" only
   if nobody chose it here (chosen: last mode set through Xplorio): after MPD restarts (Volumio does that when settings
   are saved) every output is on again, and the stream would keep running along unasked */
function idleReset(mode, chosen) {
  return mode === 'remote' || (mode === 'both' && chosen !== 'both');
}

/* MPD commands for a mode (alsa outputs on/off, stream on/off) */
function commands(f, mode) {
  var cmds = [];
  var alsaOn = mode !== 'remote', streamOn = mode !== 'lokal';
  if (!alsaOn && !f.alsa.length) return null;                     /* nothing to switch off: keep it as it is */
  f.alsa.forEach(function(x){ cmds.push((alsaOn ? 'enableoutput ' : 'disableoutput ') + x.id); });
  cmds.push((streamOn ? 'enableoutput ' : 'disableoutput ') + f.stream.id);
  return cmds;
}

/* MPD: command (several: command list) -> lines */
function mpd(host, port, cmds, cb) {
  var sock = net.createConnection({host: host, port: port}), buf = '', greeted = false, lines = [], done = false;
  function finish(err) {
    if (done) return;
    done = true; clearTimeout(t);
    try { sock.end('close\n'); } catch (e) { /* closed */ }
    cb(err, lines);
  }
  var t = setTimeout(function(){ finish(new Error('MPD not responding')); sock.destroy(); }, 8000);
  sock.setEncoding('utf8');
  sock.on('data', function(d){
    buf += d;
    var n;
    while ((n = buf.indexOf('\n')) >= 0) {
      var l = buf.slice(0, n); buf = buf.slice(n + 1);
      if (!greeted) {
        greeted = true;
        if (l.indexOf('OK MPD') !== 0) return finish(new Error('not MPD'));
        sock.write(cmds.length > 1 ? 'command_list_begin\n' + cmds.join('\n') + '\ncommand_list_end\n' : cmds[0] + '\n');
        continue;
      }
      if (l === 'OK') return finish(null);
      if (l.indexOf('ACK') === 0) return finish(new Error(l));
      lines.push(l);
    }
  });
  sock.on('error', finish);
  sock.on('close', function(){ finish(new Error('MPD connection closed')); });
}

/* Range header of the browser -> {status, headers, limit} for a live stream: Safari first asks for "bytes=0-1" and only
   plays when ranges are answered; a live stream gets a very long length */
var BIG = 2147483647;
var TYPES = {lame: 'audio/mpeg', shine: 'audio/mpeg', vorbis: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wave: 'audio/wav'};
function rangeAnswer(range, encoder) {
  var head = {'Content-Type': TYPES[encoder] || 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache, no-store'};
  var m = /bytes=(\d+)-(\d*)/.exec(range || '');
  if (!m) return {status: 200, headers: head, limit: 0};
  var start = +m[1], end = m[2] ? Math.min(+m[2], BIG - 1) : BIG - 1;
  if (end < start) end = start;
  head['Content-Range'] = 'bytes ' + start + '-' + end + '/' + BIG;
  head['Content-Length'] = String(end - start + 1);
  return {status: 206, headers: head, limit: end - start + 1};
}

/* Cushion for the live stream: hold back the first ms of music (counted from the first data, so a paused player does
   not count), then pass everything on at once. The browser then starts with a few seconds in its buffer, which
   absorbs MPD's own timing when no sound card sets it ("only this device"). push(chunk, now) -> chunks to send now */
function cushion(ms) {
  var held = [], start = 0, open = !(ms > 0);
  return {push: function(c, now){
    if (open) return [c];
    if (!start) start = now;
    held.push(c);
    if (now - start < ms) return [];
    open = true;
    var out = held; held = [];
    return out;
  }};
}

module.exports = {confOutputs: confOutputs, parseOutputs: parseOutputs, find: find, modeOf: modeOf, idleReset: idleReset, commands: commands, mpd: mpd, rangeAnswer: rangeAnswer, cushion: cushion};
