/* Audio output on the Mac (settings page, PLAYER 'mpd'): every sound device macOS knows becomes an MPD output
   (type "osx" with its device name), plus "Systemausgabe" (no device: follows the Mac's sound setting, also AirPlay).
   One of them plays at a time: switching enables it and disables the other sound outputs (other outputs such as the
   VU fifo or a stream stay as they are). MPD keeps the choice in its state file.
   New devices: scan -> the managed part of mpd.conf is written again and MPD restarts.
   "Exclusive" (hog_device): no other program plays on the device at the same time, the sample rate follows the music.
   "Volume on the amplifier" (mixer_type "none" on the device outputs): MPD does not touch the samples (bit-perfect),
   the volume is set on the amplifier/DAC. "DSD as DoP" (dop): DSD files go to USB DACs unchanged, packed in PCM frames
   (only for DACs that understand DoP; others play noise).
   "DSD through ffmpeg": MPD's own DSD decoders (dsf, dsdiff) switched off, ffmpeg decodes DSD to PCM instead. MPD 0.24.0
   (MacPorts) turns DSD into noise on the Mac; needs an MPD with ffmpeg (sudo port install mpd +mad +ffmpeg).
   opts also: decoders(cb(err, text)) (mpd --version)
   Node 8, ES5 only.
   opts: mpd(cmds, cb(err, lists)), confFile (mpd.conf), devices(cb(err, json)) (audiodevices, else system_profiler SPAudioDataType -json),
         restart(cb) (MPD stops and starts again), listDevices(cb(err, json)) and setDefault(uid, cb(err)) (audiodevices only:
         the Mac's sound output for devices played through "Systemausgabe"),
         airplay (macairplay.js AirPlay: list/select through System Preferences) and airFile (the last list, kept across restarts):
         AirPlay speakers play through "Systemausgabe" too; listed only after "Find AirPlay speakers" (opens System Preferences) */
var fs = require('fs');

var BEGIN = '# ---- Xplorio: audio outputs (settings page; replaced on every device scan) ----';
var END = '# ---- Xplorio: end of audio outputs ----';
var SYSTEM = 'Systemausgabe';
var NO_HOG = /^(airplay|bluetooth)$/;          /* exclusive (hog_device) keeps these silent: macOS does not hand them over */
/* MPD cannot open Bluetooth devices itself (OSStatus -10851): they play through "Systemausgabe", choosing one makes it the
   Mac's sound output (audiodevices set <uid>). Only with the helper's uid; without it they get an output like the others */
function viaSystem(d) { return d.kind === 'bluetooth' && !!d.uid; }

/* devices that can play -> [{name, kind}]: from audiodevices (tools/mac/audiodevices.swift), else from system_profiler */
function parseDevices(json) {
  var out = [], data = json;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return out; } }
  if (data && Array.isArray(data.devices)) {               /* audiodevices (Core Audio names, exactly as MPD looks for them) */
    data.devices.forEach(function(d){
      if (!d || typeof d.name !== 'string' || !d.name || !(d.outputs > 0)) return;
      if (out.some(function(o){ return o.name === d.name; })) return;
      var o = {name: d.name, kind: /^(usb|builtin|airplay|bluetooth|hdmi|virtual)$/.test(d.transport) ? d.transport : 'other'};
      if (typeof d.uid === 'string' && d.uid) { o.uid = d.uid; o.def = d['default'] === true; }
      out.push(o);
    });
    return out;
  }
  var groups = (data && data.SPAudioDataType) || [];
  groups.forEach(function(g){
    (g._items || []).forEach(function(d){
      if (!d || typeof d._name !== 'string' || !d._name.trim()) return;
      if (!d.coreaudio_device_output && !d.coreaudio_output_source && !d.coreaudio_default_audio_output_device) return;
      var t = String(d.coreaudio_device_transport || '');
      var kind = /usb/.test(t) ? 'usb' : /airplay/.test(t) ? 'airplay' : /bluetooth/.test(t) ? 'bluetooth' : /hdmi|displayport/.test(t) ? 'hdmi'
               : /builtin/.test(t) ? 'builtin' : /virtual/.test(t) ? 'virtual' : 'other';
      if (!out.some(function(o){ return o.name === d._name; })) out.push({name: d._name.trim(), kind: kind});
    });
  });
  return out;
}

/* audio_output blocks of mpd.conf -> [{start, end, type, name, device}] (start/end: character positions) */
function blocks(text) {
  var re = /^[ \t]*audio_output[ \t]*\{[^}]*\}[ \t]*\n?/gm, m, out = [];
  while ((m = re.exec(text))) {
    var b = m[0];
    function val(k) { var x = new RegExp('^\\s*' + k + '\\s+"((?:[^"\\\\]|\\\\.)*)"', 'm').exec(b); return x ? x[1].replace(/\\(.)/g, '$1') : ''; }
    out.push({start: m.index, end: m.index + b.length, type: val('type'), name: val('name'), device: val('device'), hog: val('hog_device') === 'yes',
              mixer: val('mixer_type'), dop: val('dop') === 'yes'});
  }
  return out;
}
function q(s) { return '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, ' ') + '"'; }

/* mpd.conf with all "osx" outputs replaced by the managed part: Systemausgabe and one per device.
   opts: {exclusive, fixedVolume, dop} (or just exclusive as a boolean) */
function writeConf(text, devices, opts) {
  if (typeof opts !== 'object' || !opts) opts = {exclusive: !!opts};
  var exclusive = !!opts.exclusive;
  var keep = '', pos = 0, i0 = text.indexOf(BEGIN), i1 = text.indexOf(END);
  if (i0 >= 0 && i1 > i0) text = text.slice(0, i0) + text.slice(i1 + END.length).replace(/^\n/, '');
  blocks(text).forEach(function(b){
    if (b.type !== 'osx') return;
    keep += text.slice(pos, b.start); pos = b.end;
  });
  keep += text.slice(pos);
  var names = [SYSTEM], lines = [BEGIN];
  lines.push('audio_output {', '  type       "osx"', '  name       ' + q(SYSTEM), '  mixer_type "software"', '}');
  (devices || []).forEach(function(d){
    if (viaSystem(d)) return;
    var name = d.name;
    while (names.indexOf(name) >= 0) name += ' ';
    names.push(name);
    lines.push('audio_output {', '  type       "osx"', '  name       ' + q(name), '  device     ' + q(d.name));
    if (exclusive && !NO_HOG.test(d.kind)) lines.push('  hog_device "yes"');
    if (opts.dop && d.kind === 'usb') lines.push('  dop        "yes"');
    lines.push('  mixer_type ' + (opts.fixedVolume && !NO_HOG.test(d.kind) ? '"none"' : '"software"'), '}');
  });
  lines.push(END);
  return keep.replace(/\n*$/, '\n') + lines.join('\n') + '\n';
}

/* decoder blocks of mpd.conf -> [{start, end, plugin, enabled}] */
function decoderBlocks(text) {
  var re = /^[ \t]*decoder[ \t]*\{[^}]*\}[ \t]*\n?/gm, m, out = [];
  while ((m = re.exec(text))) {
    var b = m[0], pl = /^\s*plugin\s+"([^"]*)"/m.exec(b), en = /^\s*enabled\s+"([^"]*)"/m.exec(b);
    out.push({start: m.index, end: m.index + b.length, plugin: pl ? pl[1] : '', enabled: !en || en[1] !== 'no'});
  }
  return out;
}
var DSD_PLUGINS = ['dsf', 'dsdiff'];
var DSD_NOTE = '# Xplorio: DSD through ffmpeg (settings page, audio output)';
/* MPD's DSD decoders off (both) */
function dsdViaFfmpeg(text) {
  var off = decoderBlocks(text).filter(function(d){ return DSD_PLUGINS.indexOf(d.plugin) >= 0 && !d.enabled; }).map(function(d){ return d.plugin; });
  return DSD_PLUGINS.every(function(p){ return off.indexOf(p) >= 0; });
}
/* mpd.conf with the dsf/dsdiff decoder blocks removed and, if on, written again (switched off) */
function writeDsd(text, on) {
  var keep = '', pos = 0;
  decoderBlocks(text).forEach(function(d){
    if (DSD_PLUGINS.indexOf(d.plugin) < 0) return;
    keep += text.slice(pos, d.start); pos = d.end;
  });
  keep += text.slice(pos);
  keep = keep.split('\n').filter(function(l){ return l !== DSD_NOTE; }).join('\n');
  if (!on) return keep;
  return keep.replace(/\n*$/, '\n') + DSD_NOTE + '\n' + DSD_PLUGINS.map(function(p){
    return 'decoder {\n  plugin     "' + p + '"\n  enabled    "no"\n}';
  }).join('\n') + '\n';
}
/* audio_buffer_size (KiB) of mpd.conf, 0 = MPD's default (4 MiB) */
var BUFFERS = [0, 16384, 32768];
function bufferSize(text) { var m = /^[ \t]*audio_buffer_size[ \t]+"?(\d+)/m.exec(text); return m ? +m[1] : 0; }
function writeBuffer(text, kib) {
  var t = text.replace(/^[ \t]*audio_buffer_size[ \t]+[^\n]*\n?/gm, '');
  if (!kib) return t;
  return t.replace(/\n*$/, '\n') + 'audio_buffer_size "' + kib + '"\n';
}

/* replaygain_missing_preamp (dB) of mpd.conf: gain for everything without ReplayGain tags (radio, streaming, untagged
   files) while ReplayGain is on. Tagged files are levelled to about -18 LUFS, streams are usually much louder.
   0 = MPD's default (unchanged). The wrongly named "replay_gain_missing_preamp" of an earlier version, which MPD
   refuses to start with, is removed */
var PREAMPS = [0, -3, -6, -9, -12];
function missingPreamp(text) { var m = /^[ \t]*replaygain_missing_preamp[ \t]+"?(-?\d+(?:\.\d+)?)/m.exec(text); return m ? +m[1] : 0; }
function writeMissingPreamp(text, db) {
  var t = text.replace(/^[ \t]*replay_?gain_missing_preamp[ \t]+[^\n]*\n?/gm, '');
  if (!db) return t;
  return t.replace(/\n*$/, '\n') + 'replaygain_missing_preamp "' + db + '"\n';
}

/* mpd --version lists a decoder plugin [ffmpeg] that knows dsf */
function ffmpegDecodes(versionText) { return /^\s*\[ffmpeg\][^\n]*\bdsf\b/m.test(String(versionText || '')); }

/* MPD's "outputs" lines -> [{id, name, plugin, enabled}] */
function parseOutputs(lines) {
  var out = [], cur = null;
  (lines || []).forEach(function(l){
    var i = l.indexOf(': '), k = l.slice(0, i), v = l.slice(i + 2);
    if (k === 'outputid') { cur = {id: +v, name: '', plugin: '', enabled: false}; out.push(cur); }
    else if (cur && k === 'outputname') cur.name = v;
    else if (cur && k === 'plugin') cur.plugin = v;
    else if (cur && k === 'outputenabled') cur.enabled = v === '1';
  });
  return out;
}

function MacAudio(opts) {
  this.o = opts; this.busy = false;
  this.air = {speakers: [], current: ''};
  if (opts.airFile) try {
    var a = JSON.parse(fs.readFileSync(opts.airFile, 'utf8'));
    if (a && Array.isArray(a.speakers)) this.air = {speakers: a.speakers.filter(function(x){ return x && typeof x.name === 'string' && x.name; }), current: String(a.current || '')};
  } catch (e) { /* none yet */ }
}
MacAudio.prototype.airSave = function() {
  if (!this.o.airFile) return;
  try { fs.writeFileSync(this.o.airFile, JSON.stringify(this.air)); } catch (e) { /* only a cache */ }
};
/* a fresh list from System Preferences; the one marked there is the Mac's output now */
MacAudio.prototype.airTake = function(list, chosen) {
  var cur = chosen || (list.filter(function(x){ return x.current; })[0] || {}).name || '';
  this.air = {speakers: list.map(function(x){ return {name: x.name, raw: x.raw || x.name}; }), current: cur};
  this.airSave();
};
/* look for AirPlay speakers (System Preferences opens for a moment). cb(err, {speakers: n}) */
MacAudio.prototype.airScan = function(cb) {
  var self = this;
  if (!this.o.airplay) return cb(new Error('nodevices'));
  if (this.busy) return cb(new Error('busy'));
  this.busy = true;
  this.o.airplay.list(function(e, list){
    self.busy = false;
    if (e) return cb(e);
    self.airTake(list);
    cb(null, {speakers: list.length});
  });
};

MacAudio.prototype.conf = function() { try { return fs.readFileSync(this.o.confFile, 'utf8'); } catch (e) { return ''; } };

/* sound outputs (from mpd.conf: type osx; plugin from MPD where it says) */
MacAudio.prototype.status = function(cb) {
  var self = this, conf = blocks(this.conf());
  this.o.mpd(['outputs'], function(err, lists){
    if (err) return cb(err);
    var outs = parseOutputs(lists[0]).filter(function(o){
      var b = conf.filter(function(x){ return x.name === o.name; })[0];
      return b ? b.type === 'osx' : o.plugin === 'osx';
    }).map(function(o){
      var b = conf.filter(function(x){ return x.name === o.name; })[0] || {};
      return {id: o.id, name: o.name.trim(), enabled: o.enabled, system: !b.device, hog: !!b.hog, fixed: b.mixer === 'none', dop: !!b.dop};
    });
    var managed = self.conf().indexOf(BEGIN) >= 0;
    var confText = self.conf();
    function done(list) {
      self.ffmpegOk(function(ff){
      cb(null, {outputs: list, dsdFfmpeg: dsdViaFfmpeg(confText), ffmpegDecoder: ff, bufferKib: bufferSize(confText), buffers: BUFFERS, exclusive: list.some(function(o){ return o.hog; }), fixedVolume: list.some(function(o){ return o.fixed; }),
                dop: list.some(function(o){ return o.dop; }), managed: managed, busy: self.busy});
      });
    }
    var sys = outs.filter(function(o){ return o.system; })[0];
    var air = sys && self.o.airplay ? self.air.speakers : [];
    function airOuts(macOnAirPlay) {                     /* AirPlay: through the system output, the one chosen last */
      return air.map(function(x){
        return {id: 'air:' + x.name, name: x.name, enabled: sys.enabled && macOnAirPlay && x.name === self.air.current, system: false, hog: false, via: true, airplay: true};
      });
    }
    if (!sys) return done(outs);
    if (!self.o.listDevices) return done(outs.concat(airOuts(true)));
    self.o.listDevices(function(e, json){                 /* Bluetooth: through the system output */
      var devs = e ? [] : parseDevices(json), via = devs.filter(viaSystem);
      var onAir = e ? true : devs.some(function(d){ return d.kind === 'airplay' && d.def; });   /* Core Audio's "AirPlay" device is the Mac's output */
      done(outs.concat(via.map(function(d){
        return {id: 'via:' + d.uid, name: d.name.trim(), enabled: sys.enabled && d.def, system: false, hog: false, via: true};
      })).concat(airOuts(onAir)));
    });
  });
};

/* does MPD have the ffmpeg decoder (with DSD)? asked once */
MacAudio.prototype.ffmpegOk = function(cb) {
  var self = this;
  if (this.ffmpeg !== undefined) return cb(this.ffmpeg);
  if (!this.o.decoders) return cb(false);
  this.o.decoders(function(e, text){ self.ffmpeg = !e && ffmpegDecodes(text); cb(self.ffmpeg); });
};

/* DSD through ffmpeg on/off: mpd.conf, MPD restarts */
MacAudio.prototype.setDsd = function(on, cb) { this.change(function(t){ return writeDsd(t, !!on); }, cb); };
/* MPD's buffer for decoded music (KiB, one of BUFFERS; 0 = default): mpd.conf, MPD restarts */
MacAudio.prototype.setBuffer = function(kib, cb) {
  if (BUFFERS.indexOf(kib) < 0) return cb(new Error('value'));
  this.change(function(t){ return writeBuffer(t, kib); }, cb);
};
/* gain for streams and untagged files with ReplayGain on (dB, one of PREAMPS): mpd.conf, MPD restarts */
MacAudio.prototype.setMissingPreamp = function(db, cb) {
  if (PREAMPS.indexOf(db) < 0) return cb(new Error('value'));
  this.change(function(t){ return writeMissingPreamp(t, db); }, cb);
};
MacAudio.prototype.change = function(fn, cb) {
  var self = this;
  if (this.busy) return cb(new Error('busy'));
  var text = this.conf();
  if (!text) return cb(new Error('conf'));
  var neu = fn(text);
  if (neu === text) return cb(null);
  try { fs.writeFileSync(this.o.confFile + '.neu', neu); fs.renameSync(this.o.confFile + '.neu', this.o.confFile); }
  catch (e) { return cb(e); }
  this.busy = true;
  this.o.restart(function(e){
    if (!e) { self.busy = false; return cb(null); }
    /* MPD did not come back (e.g. it refuses the new mpd.conf): the old one back and MPD started with it */
    try { fs.writeFileSync(self.o.confFile + '.neu', text); fs.renameSync(self.o.confFile + '.neu', self.o.confFile); }
    catch (e2) { self.busy = false; return cb(e); }
    self.o.restart(function(){ self.busy = false; cb(e); });
  });
};

/* a device that was gone (USB DAC switched off) is back: MPD would go on "playing" into nothing. MPD looks the device up
   only when an output is enabled, so the playing output is disabled and enabled again (what switching away and back does).
   Called every few seconds (tag-service.js); only with the Core Audio helper. cb(err, [names reopened]) */
MacAudio.prototype.watch = function(cb) {
  var self = this;
  cb = cb || function(){};
  if (this.busy || !this.o.listDevices) return cb(null, []);
  var conf = blocks(this.conf()).filter(function(b){ return b.type === 'osx' && b.device; });
  if (!conf.length) return cb(null, []);
  this.o.listDevices(function(e, json){
    if (e) return cb(e);
    var here = parseDevices(json).map(function(d){ return d.name; }), seen = self.seen || {}, back = [];
    self.seen = {};
    conf.forEach(function(b){
      var now = here.indexOf(b.device) >= 0;
      self.seen[b.device] = now;
      if (now && seen[b.device] === false) back.push(b.name);
    });
    if (!back.length) return cb(null, []);
    self.o.mpd(['outputs'], function(err, lists){
      if (err) return cb(err);
      var cmds = [];
      parseOutputs(lists[0]).forEach(function(o){
        if (o.enabled && back.indexOf(o.name) >= 0) cmds.push('disableoutput ' + o.id, 'enableoutput ' + o.id);
      });
      if (!cmds.length) return cb(null, []);
      self.o.mpd(cmds, function(e2){ cb(e2, back); });
    });
  });
};

/* play on this output only */
MacAudio.prototype.select = function(id, cb) {
  var self = this;
  this.status(function(err, st){
    if (err) return cb(err);
    var o = st.outputs.filter(function(x){ return x.id === id; })[0];
    if (!o) return cb(new Error('output'));
    if (o.airplay) {                                     /* choose it in System Preferences, then play on the system output */
      var sp = st.outputs.filter(function(x){ return x.system; })[0];
      var sk = self.air.speakers.filter(function(x){ return x.name === o.name; })[0];
      return self.o.airplay.select(sk.raw || sk.name, function(e, list){
        if (e) return cb(e);
        self.airTake(list, o.name);
        self.select(sp.id, cb);
      });
    }
    if (o.via) {                                         /* make it the Mac's output, then play on the system output */
      var sys = st.outputs.filter(function(x){ return x.system; })[0];
      return self.o.setDefault(String(id).slice(4), function(e){
        if (e) return cb(new Error('output'));
        self.select(sys.id, cb);
      });
    }
    var cmds = ['enableoutput ' + id];
    st.outputs.forEach(function(x){ if (x.id !== id && x.enabled && !x.via) cmds.push('disableoutput ' + x.id); });   /* via/air: not MPD outputs */
    self.o.mpd(cmds, function(e){ cb(e); });
  });
};

/* look for devices, write mpd.conf, restart MPD, the output playing before plays again (by name).
   opts: {exclusive, fixedVolume, dop} or just exclusive */
MacAudio.prototype.scan = function(opts, cb) {
  var self = this;
  if (this.busy) return cb(new Error('busy'));
  this.busy = true;
  function done(e, r) { self.busy = false; cb(e, r); }
  this.status(function(e0, st){
    var was = !e0 && st.outputs.filter(function(o){ return o.enabled; })[0];
    self.o.devices(function(err, json){
      if (err) return done(err);
      var devices = parseDevices(json), text = self.conf();
      /* the Core Audio "AirPlay" device (there only while a speaker is the Mac's output) gets no output of its own when
         the speakers are chosen through System Preferences: they play through the system output */
      if (self.o.airplay) devices = devices.filter(function(d){ return !(d.kind === 'airplay' && d.uid); });
      if (!text) return done(new Error('conf'));
      var neu = writeConf(text, devices, opts);
      if (neu !== text) {
        try { fs.writeFileSync(self.o.confFile + '.neu', neu); fs.renameSync(self.o.confFile + '.neu', self.o.confFile); }
        catch (e) { return done(e); }
      }
      var restart = neu !== text ? self.o.restart : function(c){ c(); };
      restart(function(e2){
        if (e2) return done(e2);
        self.status(function(e3, st2){
          if (e3) return done(e3);
          var target = st2.outputs.filter(function(o){ return was && o.name === was.name; })[0] || st2.outputs.filter(function(o){ return o.system; })[0];
          if (!target) return done(null, {devices: devices.length});
          self.busy = false;
          self.select(target.id, function(e4){ cb(e4, {devices: devices.length}); });
        });
      });
    });
  });
};

module.exports = {MacAudio: MacAudio, missingPreamp: missingPreamp, writeMissingPreamp: writeMissingPreamp, PREAMPS: PREAMPS, writeBuffer: writeBuffer, bufferSize: bufferSize, BUFFERS: BUFFERS, writeDsd: writeDsd, dsdViaFfmpeg: dsdViaFfmpeg, ffmpegDecodes: ffmpegDecodes, decoderBlocks: decoderBlocks, viaSystem: viaSystem, parseDevices: parseDevices, blocks: blocks, writeConf: writeConf, parseOutputs: parseOutputs, BEGIN: BEGIN, END: END, SYSTEM: SYSTEM};
