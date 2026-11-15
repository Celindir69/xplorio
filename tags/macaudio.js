/* Audio output on the Mac (settings page, PLAYER 'mpd'): every sound device macOS knows becomes an MPD output
   (type "osx" with its device name), plus "Systemausgabe" (no device: follows the Mac's sound setting, also AirPlay).
   One of them plays at a time: switching enables it and disables the other sound outputs (other outputs such as the
   VU fifo or a stream stay as they are). MPD keeps the choice in its state file.
   New devices: scan -> the managed part of mpd.conf is written again and MPD restarts.
   "Exclusive" (hog_device): no other program plays on the device at the same time, the sample rate follows the music.
   Node 8, ES5 only.
   opts: mpd(cmds, cb(err, lists)), confFile (mpd.conf), devices(cb(err, json)) (audiodevices, else system_profiler SPAudioDataType -json),
         restart(cb) (MPD stops and starts again), listDevices(cb(err, json)) and setDefault(uid, cb(err)) (audiodevices only:
         the Mac's sound output for devices played through "Systemausgabe") */
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
    out.push({start: m.index, end: m.index + b.length, type: val('type'), name: val('name'), device: val('device'), hog: val('hog_device') === 'yes'});
  }
  return out;
}
function q(s) { return '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, ' ') + '"'; }

/* mpd.conf with all "osx" outputs replaced by the managed part: Systemausgabe and one per device */
function writeConf(text, devices, exclusive) {
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
    lines.push('  mixer_type "software"', '}');
  });
  lines.push(END);
  return keep.replace(/\n*$/, '\n') + lines.join('\n') + '\n';
}

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

function MacAudio(opts) { this.o = opts; this.busy = false; }

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
      return {id: o.id, name: o.name.trim(), enabled: o.enabled, system: !b.device, hog: !!b.hog};
    });
    var managed = self.conf().indexOf(BEGIN) >= 0;
    function done(list) { cb(null, {outputs: list, exclusive: list.some(function(o){ return o.hog; }), managed: managed, busy: self.busy}); }
    var sys = outs.filter(function(o){ return o.system; })[0];
    if (!sys || !self.o.listDevices) return done(outs);
    self.o.listDevices(function(e, json){                 /* Bluetooth: through the system output */
      var via = e ? [] : parseDevices(json).filter(viaSystem);
      done(outs.concat(via.map(function(d){
        return {id: 'via:' + d.uid, name: d.name.trim(), enabled: sys.enabled && d.def, system: false, hog: false, via: true};
      })));
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
    if (o.via) {                                         /* make it the Mac's output, then play on the system output */
      var sys = st.outputs.filter(function(x){ return x.system; })[0];
      return self.o.setDefault(String(id).slice(4), function(e){
        if (e) return cb(new Error('output'));
        self.select(sys.id, cb);
      });
    }
    var cmds = ['enableoutput ' + id];
    st.outputs.forEach(function(x){ if (x.id !== id && x.enabled && !x.via) cmds.push('disableoutput ' + x.id); });
    self.o.mpd(cmds, function(e){ cb(e); });
  });
};

/* look for devices, write mpd.conf, restart MPD, the output playing before plays again (by name) */
MacAudio.prototype.scan = function(exclusive, cb) {
  var self = this;
  if (this.busy) return cb(new Error('busy'));
  this.busy = true;
  function done(e, r) { self.busy = false; cb(e, r); }
  this.status(function(e0, st){
    var was = !e0 && st.outputs.filter(function(o){ return o.enabled; })[0];
    self.o.devices(function(err, json){
      if (err) return done(err);
      var devices = parseDevices(json), text = self.conf();
      if (!text) return done(new Error('conf'));
      var neu = writeConf(text, devices, !!exclusive);
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

module.exports = {MacAudio: MacAudio, viaSystem: viaSystem, parseDevices: parseDevices, blocks: blocks, writeConf: writeConf, parseOutputs: parseOutputs, BEGIN: BEGIN, END: END, SYSTEM: SYSTEM};
