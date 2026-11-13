/* VU meter (web/js/vumeter.js): MPD's "fifo" output (the plugin hands it to Volumio, which adds it to mpd.conf, or added by hand) carries the
   same music as the amplifier output as raw PCM. The tag service reads it while someone looks at the meters and sends
   level and peak per channel 40 times a second (GET /vu, Server-Sent Events). Pure helpers here, the service is in
   tag-service.js. Node 8, ES5 only. */

var WINDOW_MS = 25;

/* the meter's fifo output: type fifo (MPD's "outputs" reports the plugin in newer versions, else mpd.conf) and "vu" in
   its name, so another fifo (e.g. Snapcast's multiroom feed) is never read and robbed of its data
   -> {id, enabled, name, path, format} or null */
function find(outs, conf) {
  var byName = {};
  conf.forEach(function(c){ byName[c.name] = c; });
  for (var i = 0; i < outs.length; i++) {
    var o = outs[i], c = byName[o.name] || {};
    if ((o.plugin || c.type) === 'fifo' && /vu/i.test(o.name)) return {id: o.id, enabled: o.enabled, name: o.name, path: c.path || '', format: c.format || ''};
  }
  return null;
}

/* "44100:16:2" -> {rate, bits, channels, bytes (per sample)} or null. Without a fixed format MPD passes each track's own
   (e.g. DSD), which the meter cannot read, so the format is required */
function parseFormat(s) {
  var m = /^\s*(\d+):(16|24|32):([12])\s*$/.exec(String(s || ''));
  if (!m) return null;
  var bits = +m[2];
  return {rate: +m[1], bits: bits, channels: +m[3], bytes: bits === 16 ? 2 : 4};   /* MPD writes 24 bit in 32 bit words */
}

function db(x) { return x > 0 ? Math.round(200 * Math.log(x) / Math.LN10) / 10 : -99; }   /* 20·log10, 0.1 dB steps */

/* analyzer(fmt) -> {push(buf) -> [[rmsL, peakL, rmsR, peakR], ...]} in dBFS per 25 ms window; a frame split across two
   chunks is carried over. Mono: the same values for both sides */
function analyzer(fmt) {
  var frame = fmt.bytes * fmt.channels, per = Math.max(1, Math.round(fmt.rate * WINDOW_MS / 1000));
  var full = fmt.bits === 16 ? 32768 : 2147483648;
  var rest = null, n = 0, sum = [0, 0], peak = [0, 0];
  function sample(b, o) {
    return fmt.bytes === 2 ? b.readInt16LE(o) : b.readInt32LE(o) * (fmt.bits === 24 ? 256 : 1);   /* 24 bit: low 3 bytes, sign-extended by MPD */
  }
  return {push: function(buf){
    if (rest && rest.length) buf = Buffer.concat([rest, buf]);
    var out = [], end = buf.length - buf.length % frame;
    for (var o = 0; o < end; o += frame) {
      for (var ch = 0; ch < 2; ch++) {
        var v = ch < fmt.channels ? sample(buf, o + ch * fmt.bytes) / full : (fmt.channels === 1 ? sample(buf, o) / full : 0);
        sum[ch] += v * v;
        if (v < 0) v = -v;
        if (v > peak[ch]) peak[ch] = v;
      }
      if (++n >= per) {
        out.push([db(Math.sqrt(sum[0] / n)), db(peak[0]), db(Math.sqrt(sum[1] / n)), db(peak[1])]);
        n = 0; sum = [0, 0]; peak = [0, 0];
      }
    }
    rest = end < buf.length ? buf.slice(end) : null;
    return out;
  }};
}

/* MPD writes in chunks ahead of time; the windows go out one per tick, evenly. The tick is never exactly 25 ms and MPD
   sends a little in bursts, so without care the queue would fill up and the meter would lag behind for good (up to
   max windows). So while more than keep windows wait, two go out as one (the louder of each value): the queue drains
   at double speed and no peak is lost. A queue that grows too long anyway (the browser was busy, MPD sent a large
   block) is shortened from the front */
function pacer(max, keep) {
  var q = [];
  if (keep == null) keep = 2;
  return {
    add: function(list){ for (var i = 0; i < list.length; i++) q.push(list[i]); if (q.length > max) q.splice(0, q.length - max); },
    next: function(){
      if (!q.length) return null;
      var w = q.shift();
      if (q.length > keep) { var x = q.shift(); w = w.map(function(v, i){ return Math.max(v, x[i]); }); }
      return w;
    },
    size: function(){ return q.length; },
    clear: function(){ q = []; }
  };
}

module.exports = {WINDOW_MS: WINDOW_MS, find: find, parseFormat: parseFormat, analyzer: analyzer, pacer: pacer, db: db};
