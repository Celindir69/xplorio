/* VU meter: two backlit needle instruments (left and right channel). Levels from the tag service (GET /vu, tags/vumeter.js),
   which reads MPD's "VU" fifo output while someone watches. Where: in the stage view below the lyrics or track list
   ("VU" button at the bottom right, next to "Lyrics | Track list"); in the classic landscape layout below the controls,
   on the phone side by side below a smaller cover (a tap on the cover switches them on and off, a tap on the meters
   switches their color). ?vu=true (default) | false (off) | nodsd (off while DSD plays, saves the player converting it) |
   demo (simulated signal, without fifo); remembered per device.
   Needle like a real VU meter: about 300 ms to the value with a slight overshoot, slower back; the lamp in the middle
   lights while the needle is past 0 VU and stays on for a second. APP_CONFIG.VU_REF_DBFS: level (dBFS RMS) shown as 0 VU;
   APP_CONFIG.VU_DELAY_MS: MPD fills the fifo before the sound reaches the amplifier, the needle waits this long.
   Classic script, shared global scope; loaded after stage.js. */
var VU_KEY = 'xplorioVu', VU_PANE_KEY = 'mxStagePane', VU_ON_KEY = 'xplorioVuOn';
var VU_REF = vuNum((window.APP_CONFIG || {}).VU_REF_DBFS, -8);
var VU_DELAY = vuNum((window.APP_CONFIG || {}).VU_DELAY_MS, 400);
var VU_SCALE = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
var VU_ANGLE = 45;                       /* degrees left and right of the middle */
var VU_P0 = Math.pow(10, -23 / 20);      /* deflection at -20 VU (deflection is proportional to the voltage, +3 VU = full) */
var VU_REST = -0.045;                    /* needle at the stop, left of -20 */
var VU_POS0 = vuPos(0);
var VU_LAMP_MS = 1000, VU_SILENT_MS = 250;

/* face colors, a tap on the meters switches to the next one (per device); ?vustyle=… sets it */
var VU_STYLES = ['accent', 'amberAccent', 'amber', 'white', 'blue'], VU_STYLE_KEY = 'xplorioVuStyle';
var vuStyle = vuStyleStored();
function vuStyleStored() {
  try {
    var m = /[?&]vustyle=(\w+)/.exec(location.search);
    if (m && VU_STYLES.indexOf(m[1]) >= 0) localStorage.setItem(VU_STYLE_KEY, m[1]);
    var s = localStorage.getItem(VU_STYLE_KEY);
    return VU_STYLES.indexOf(s) >= 0 ? s : 'amber';
  } catch (e) { return 'amber'; }
}
function vuSetStyle(s) {
  vuStyle = s;
  document.documentElement.setAttribute('data-vu', s);
  try { localStorage.setItem(VU_STYLE_KEY, s); } catch (e) { /* private mode */ }
}
document.documentElement.setAttribute('data-vu', vuStyle);

var vuOpt = vuOption(), vuAvail = vuOpt === 'demo', vuDsd = false, vuPlaying = false;
var vuSrc = null, vuQueue = [], vuLastAt = 0, vuRaf = 0, vuT = 0;
var vuMeters = [];                       /* {needle:[x, v, target, el], lamp:{el, until}} per instrument set */
var vuPane = vuPaneStored() === 'tracks' ? 'tracks' : 'lyrics';
var vuWanted = vuStored(VU_ON_KEY) === '1';         /* instruments shown (per device) */

function vuNum(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function vuOption() {
  try {
    var m = /[?&]vu=(true|false|nodsd|demo|1|0|on|off)\b/.exec(location.search);
    if (m) localStorage.setItem(VU_KEY, {'1': 'true', on: 'true', '0': 'false', off: 'false'}[m[1]] || m[1]);
    return localStorage.getItem(VU_KEY) || 'true';
  } catch (e) { return 'true'; }
}
function vuStored(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function vuPaneStored() { return vuStored(VU_PANE_KEY) || 'lyrics'; }
function vuOn() { return vuOpt !== 'false' && vuAvail; }

/* VU value -> needle position 0 (-20) … 1 (+3) */
function vuPos(vu) { return (Math.pow(10, (vu - 3) / 20) - VU_P0) / (1 - VU_P0); }
function vuDeg(p) { return -VU_ANGLE + 2 * VU_ANGLE * p; }

/* ---------- Drawing: one face in a 200 × 130 box, needle pivot below the visible part ---------- */
var VU_NS = 'http://www.w3.org/2000/svg', VU_CX = 100, VU_CY = 150, VU_R = 98;
var vuGradN = 0;
function vuEl(name, attrs, parent) {
  var e = document.createElementNS(VU_NS, name);
  for (var k in attrs) {
    if (/^var\(/.test(attrs[k])) e.style.setProperty(k, attrs[k]);   /* CSS variable: as a style, not every browser reads it in an attribute */
    else e.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(e);
  return e;
}
function vuPt(deg, r) {
  var a = deg * Math.PI / 180;
  return [VU_CX + r * Math.sin(a), VU_CY - r * Math.cos(a)];
}
function vuArc(d0, d1, r) {
  var a = vuPt(d0, r), b = vuPt(d1, r);
  return 'M' + a[0].toFixed(2) + ' ' + a[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 0 1 ' + b[0].toFixed(2) + ' ' + b[1].toFixed(2);
}
function vuFace(label) {
  var id = 'vuGlow' + (++vuGradN);
  var svg = vuEl('svg', {viewBox: '0 0 200 130', 'class': 'vuFace', 'aria-hidden': 'true'});
  var defs = vuEl('defs', {}, svg);
  var g = vuEl('radialGradient', {id: id, cx: '50%', cy: '62%', r: '75%'}, defs);
  vuEl('stop', {offset: '0', 'stop-color': 'var(--vu-g0)'}, g);       /* colors from the style (CSS, html[data-vu]) */
  vuEl('stop', {offset: '.55', 'stop-color': 'var(--vu-g1)'}, g);
  vuEl('stop', {offset: '1', 'stop-color': 'var(--vu-g2)'}, g);
  vuEl('rect', {x: 0, y: 0, width: 200, height: 130, rx: 6, fill: 'url(#' + id + ')'}, svg);
  var ink = 'var(--vu-ink)', red = 'var(--vu-red)';
  vuEl('path', {d: vuArc(vuDeg(0), vuDeg(vuPos(0)), VU_R), fill: 'none', stroke: ink, 'stroke-width': 1.4}, svg);
  vuEl('path', {d: vuArc(vuDeg(vuPos(0)), vuDeg(1), VU_R + 2.5), fill: 'none', stroke: red, 'stroke-width': 6}, svg);
  VU_SCALE.forEach(function(v){
    var d = vuDeg(vuPos(v)), a = vuPt(d, VU_R), b = vuPt(d, VU_R + (v === 0 || v === -20 || v === 3 ? 10 : 7)), t = vuPt(d, VU_R + 17);
    vuEl('line', {x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: v > 0 ? red : ink, 'stroke-width': v === 0 ? 2 : 1.4}, svg);
    var tx = vuEl('text', {x: t[0], y: t[1] + 3.5, 'text-anchor': 'middle', 'class': 'vuNum', fill: v > 0 ? red : ink}, svg);
    tx.textContent = String(Math.abs(v));
  });
  [-15, -4].forEach(function(v){                  /* small marks in between */
    var d = vuDeg(vuPos(v)), a = vuPt(d, VU_R), b = vuPt(d, VU_R + 4);
    vuEl('line', {x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: ink, 'stroke-width': 1}, svg);
  });
  var mn = vuPt(-VU_ANGLE - 6, VU_R + 12), pl = vuPt(VU_ANGLE + 6, VU_R + 12);
  vuEl('text', {x: mn[0], y: mn[1] + 4, 'text-anchor': 'middle', 'class': 'vuSign', fill: ink}, svg).textContent = '−';
  vuEl('text', {x: pl[0], y: pl[1] + 4, 'text-anchor': 'middle', 'class': 'vuSign', fill: red}, svg).textContent = '+';
  var lamp = vuEl('circle', {cx: VU_CX, cy: 80, r: 4.2, 'class': 'vuLamp'}, svg);   /* lamp in the middle below the scale */
  vuEl('text', {x: VU_CX, y: 101, 'text-anchor': 'middle', 'class': 'vuTitle', fill: ink}, svg).textContent = label;   /* Left / Right */
  var note = vuEl('text', {x: VU_CX, y: 68, 'text-anchor': 'middle', 'class': 'vuNote', fill: ink}, svg);
  var needle = vuEl('g', {}, svg);
  vuEl('line', {x1: VU_CX, y1: VU_CY, x2: VU_CX, y2: VU_CY - VU_R - 8, stroke: 'var(--vu-needle)', 'stroke-width': 1.6, 'stroke-linecap': 'round'}, needle);
  vuEl('rect', {x: 0, y: 116, width: 200, height: 14, fill: '#1b130c'}, svg);         /* cover over the needle's pivot */
  vuEl('rect', {x: .5, y: .5, width: 199, height: 129, rx: 6, fill: 'none', stroke: 'rgba(0,0,0,.35)'}, svg);
  return {svg: svg, needle: needle, lamp: lamp, note: note, x: VU_REST, v: 0, target: VU_REST, until: 0};
}
/* dark frame with the two instruments side by side */
function vuBuild() {
  var box = document.createElement('div');
  box.className = 'vuBox';
  var l = vuFace('Left'), r = vuFace('Right');
  box.appendChild(l.svg); box.appendChild(r.svg);
  box.addEventListener('click', function(e){
    e.stopPropagation();
    vuSetStyle(VU_STYLES[(VU_STYLES.indexOf(vuStyle) + 1) % VU_STYLES.length]);
  });
  vuMeters.push({box: box, faces: [l, r]});
  return box;
}

/* ---------- Ballistics ---------- */
function vuStep(f, dt) {
  var up = f.target > f.x, w = up ? 13.5 : (vuSilent() ? 4 : 8), z = up ? 0.8 : 1;   /* up ≈ 300 ms, 1–2 % overshoot */
  for (var t = 0; t < dt; t += 0.004) {
    var h = Math.min(0.004, dt - t);
    f.v += (w * w * (f.target - f.x) - 2 * z * w * f.v) * h;
    f.x += f.v * h;
  }
  if (f.x > 1.06) { f.x = 1.06; f.v = 0; }                    /* stop at the right */
  if (f.x < VU_REST) { f.x = VU_REST; f.v = 0; }
}
function vuSilent() { return Date.now() - vuLastAt > VU_SILENT_MS; }

/* one level window [rmsL, peakL, rmsR, peakR] (dBFS) */
function vuApply(w, now) {
  vuLastAt = now;
  vuMeters.forEach(function(m){
    m.faces.forEach(function(f, i){
      var vu = w[i * 2] - VU_REF;
      f.target = Math.max(VU_REST, Math.min(1.06, vuPos(vu)));
    });
  });
}

function vuFrame() {
  vuRaf = 0;
  if (!vuShown()) return;
  var now = Date.now(), dt = Math.min(0.1, (now - (vuT || now)) / 1000);
  vuT = now;
  if (vuOpt === 'demo') vuDemo(now);
  while (vuQueue.length && vuQueue[0].at <= now) vuApply(vuQueue.shift().w, now);
  var silent = vuSilent();
  vuMeters.forEach(function(m){
    m.faces.forEach(function(f){
      if (silent) f.target = VU_REST;                           /* pause, stop: the needles sink slowly */
      vuStep(f, dt);
      if (f.x > VU_POS0) f.until = now + VU_LAMP_MS;           /* lamp: when the needle itself is past 0 VU */
      f.needle.setAttribute('transform', 'rotate(' + vuDeg(f.x).toFixed(2) + ' ' + VU_CX + ' ' + VU_CY + ')');
      f.lamp.setAttribute('class', 'vuLamp' + (f.until > now ? ' on' : ''));
    });
  });
  vuRaf = requestAnimationFrame(vuFrame);
}

/* demo: a made-up signal around -4 VU with beats, only while playing */
var vuDemoAt = 0, vuDemoBase = -6;
function vuDemo(now) {
  if (!vuPlaying || now - vuDemoAt < 25) return;
  vuDemoAt = now;
  vuDemoBase += (Math.random() - .5) * 0.8;
  vuDemoBase = Math.max(-12, Math.min(-1, vuDemoBase));
  var beat = (now % 520) < 90 ? 5 : 0;
  var l = VU_REF + vuDemoBase + beat + (Math.random() - .5) * 3, r = l + (Math.random() - .5) * 2.5;
  vuApply([l, l + 9, r, r + 9], now);
}

/* ---------- Data from the tag service ---------- */
function vuShown() { return vuOn() && vuWanted && !document.hidden; }
function vuDsdOff() { return vuOpt === 'nodsd' && vuDsd; }
function vuUpdate() {
  document.documentElement.classList.toggle('vuAvail', vuOn());
  document.documentElement.classList.toggle('vuOn', vuOn() && vuWanted);
  var shown = vuShown(), want = shown && vuOpt !== 'demo' && !vuDsdOff() && typeof TAGS !== 'undefined';
  if (want && !vuSrc) {
    vuSrc = new EventSource(TAGS + '/vu');
    vuSrc.onmessage = function(e){
      var w = String(e.data).split(',').map(Number);
      if (w.length === 4) vuQueue.push({at: Date.now() + VU_DELAY, w: w});
      if (vuQueue.length > 200) vuQueue.splice(0, vuQueue.length - 200);
    };
  } else if (!want && vuSrc) { vuSrc.close(); vuSrc = null; vuQueue = []; }
  vuMeters.forEach(function(m){ m.faces.forEach(function(f){ f.note.textContent = vuDsdOff() ? T('vu.dsdOff') : ''; }); });
  if (shown && !vuRaf) { vuT = 0; vuRaf = requestAnimationFrame(vuFrame); }
}

/* player state (poll.js): DSD or not, playing or not */
function vuSync(st) {
  var dsd = typeof classifyQuality === 'function' && classifyQuality(st).kind === 'dsd';
  vuPlaying = st.status === 'play';
  if (dsd !== vuDsd) { vuDsd = dsd; vuUpdate(); }
}

/* ---------- Where the instruments are ----------
   VU on or off (per device): in the stage view the "VU" button at the bottom right, below the lyrics or track list;
   otherwise a tap on the cover. Classic landscape: in the right column below the controls; phone: side by side
   below a smaller cover. Each place has its own set, CSS shows the one that fits. */
function vuPlace(id, parent, before) {
  var d = document.createElement('div');
  d.id = id; d.className = 'vuPlace';
  d.appendChild(vuBuild());
  parent.insertBefore(d, before || null);
}
vuPlace('vuStage', overlayLyrics);                                                     /* stage view: below the lyrics */
vuPlace('vuPort', document.getElementById('app'), document.getElementById('rightPane'));   /* phone: below the cover */
vuPlace('vuSide', document.getElementById('rightPane'));                               /* classic landscape: below the controls */

function vuSetOn(on) {
  vuWanted = on;
  try { localStorage.setItem(VU_ON_KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
  vuPaint(); vuUpdate();
  lyrLastH = 0;                                            /* stage view: the lyrics area changed its height, re-center */
  if (typeof stagePlainSetup === 'function') setTimeout(stagePlainSetup, 50);
}

/* stage view, bottom right: Lyrics | Track list, and VU on/off */
var vuPaneBar = document.createElement('div');
vuPaneBar.id = 'stagePane';
['lyrics', 'tracks', 'vu'].forEach(function(p){
  var b = document.createElement('button');
  b.type = 'button'; b.setAttribute('data-pane', p);
  b.textContent = T('vu.pane.' + p);
  b.addEventListener('click', function(){ if (p === 'vu') vuSetOn(!vuWanted); else vuSetPane(p); });
  vuPaneBar.appendChild(b);
});
overlayLyrics.appendChild(vuPaneBar);

/* poll.js: show the album's track list in place of the lyrics */
function stagePaneTracks() { return vuPane === 'tracks'; }
function vuPaint() {
  [].forEach.call(vuPaneBar.children, function(b){
    var p = b.getAttribute('data-pane');
    b.classList.toggle('on', p === 'vu' ? vuWanted : p === vuPane);
    if (p === 'vu') { b.style.display = vuOn() ? '' : 'none'; b.setAttribute('aria-pressed', vuWanted ? 'true' : 'false'); }
  });
}
function vuSetPane(p) {
  if (p === vuPane) return;
  vuPane = p;
  try { localStorage.setItem(VU_PANE_KEY, p); } catch (e) { /* private mode */ }
  vuPaint();
  if (typeof poll === 'function') { lastLyrKey = ''; poll(); }   /* lyrics <-> track list */
}

document.getElementById('coverWrap').addEventListener('click', function(){
  if (stageOn || !vuOn() || document.querySelector('.overlay.on')) return;   /* an open panel: the tap only closes it (ui.js) */
  vuSetOn(!vuWanted);
});

var vuStageApply = stageApply;
stageApply = function(){
  vuStageApply();
  vuUpdate();
};
document.addEventListener('visibilitychange', vuUpdate);

/* is a VU output there? (once at the start; the meter appears only then) */
function vuCheck() {
  if (vuOpt === 'false' || vuOpt === 'demo' || typeof TAGS === 'undefined') return;
  fetch(TAGS + '/vustatus').then(function(r){ return r.json(); }).then(function(r){
    vuAvail = !!(r && r.ok && r.available);
    vuPaint(); vuUpdate();
  }).catch(function(){});
}
vuPaint(); vuUpdate();
vuCheck();
