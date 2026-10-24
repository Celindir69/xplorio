/* "System" page (gear menu): CPU load live and over 24 h, temperature, memory, drives (internal
   card, USB, each NAS connection), system details and the current file. Values from the tag service (GET /sysinfo,
   tags/sysinfo.js), services (GET /services, POST /service, tags/services.js), logs (POST /logs, tags/logs.js)
   and from Volumio (getState). While the page is open: live values every 2 s, everything else every minute.
   Classic script, shared global scope; see xplorio.html for load order. */
var overlaySystem = document.getElementById('overlaySystem');
var sysBody = document.getElementById('sysBody');
var sysTimer = null, sysFullTimer = null, sysSeq = 0, sysData = null, sysHistKind = 'cpu', sysEls = null;
var sysSvc = null, sysSvcBusy = {}, sysSvcMsg = '', sysSvcTimers = [], sysSvcPending = null;
var SYS_NS = 'http://www.w3.org/2000/svg';

/* the Volumio plugin's services carry other names, same texts */
function svcKey(id) { return {'xplorio-tags': 'tag-service', 'xplorio-rotel': 'rotel-bridge'}[id] || id; }
function openSystem() {
  closeAllOverlays();
  overlaySystem.classList.add('on');
  sysSeq++;
  sysEls = null; sysSvcPending = null; sysSvcBusy = {}; sysSvcMsg = '';
  clearTimeout(sysLog.timer); sysLog.src = ''; sysLog.live = false; sysLog.data = null; sysLog.filter = ''; sysLog.focus = false;   /* log only after a source is chosen */
  while (sysBody.firstChild) sysBody.removeChild(sysBody.firstChild);
  sysBody.appendChild(browseNote(T('hist.loading')));
  sysFull();
}
function sysStop() { clearTimeout(sysTimer); clearTimeout(sysFullTimer); sysSvcTimers.forEach(clearTimeout); sysSvcTimers = []; sysSeq++; }
function sysOpen() { return overlaySystem.classList.contains('on') && !document.hidden; }

function sysFull() {
  var seq = sysSeq;
  clearTimeout(sysFullTimer);
  Promise.all([tagGetJson('/sysinfo?full=1'), withTimeout(fetch('/api/v1/getState'), 8000).then(function(r){ return r.json(); }).catch(function(){ return null; }),
               tagGetJson('/services').catch(function(){ return null; })])
    .then(function(res){
      if (seq !== sysSeq) return;
      sysData = res[0];
      sysSvc = res[2] && res[2].ok ? res[2] : null;
      if (!sysData || !sysData.ok) throw new Error('keine Daten');
      if (!sysSvcPending || !sysEls) sysKeepScroll(function(){ sysRender(res[1]); });   /* not during password entry */
      sysLive(seq);
      sysFullTimer = setTimeout(function(){ if (seq === sysSeq && sysOpen()) sysFull(); }, 60000);
    }).catch(function(){
      if (seq !== sysSeq) return;
      while (sysBody.firstChild) sysBody.removeChild(sysBody.firstChild);
      sysBody.appendChild(browseNote(T('hist.offlinePort', {port: (window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766})));
    });
}

function sysLive(seq) {
  clearTimeout(sysTimer);
  sysTimer = setTimeout(function(){
    if (seq !== sysSeq) return;
    if (!overlaySystem.classList.contains('on')) return;  /* page closed: stop */
    if (document.hidden) return sysLive(seq);              /* in the background: do not poll, but stay on */
    tagGetJson('/sysinfo').then(function(r){
      if (seq !== sysSeq || !r || !r.ok) return;
      ['cpu', 'cores', 'live', 'load', 'mem', 'temp', 'uptime'].forEach(function(k){ sysData[k] = r[k]; });
      sysPaintLive();
    }).catch(function(){}).then(function(){ sysLive(seq); });
  }, 2000);
}

/* rebuild the page without losing the scroll position (keep height, restore position) */
function sysKeepScroll(fn) {
  var keep = [];
  for (var el = sysBody; el && el.nodeType === 1; el = el.parentNode) if (el.scrollTop) keep.push([el, el.scrollTop]);
  var se = document.scrollingElement;
  if (se && se.scrollTop) keep.push([se, se.scrollTop]);
  sysBody.style.minHeight = sysBody.offsetHeight + 'px';
  fn();
  keep.forEach(function(k){ k[0].scrollTop = k[1]; });
  sysBody.style.minHeight = '';
  keep.forEach(function(k){ k[0].scrollTop = k[1]; });
}

/* ---------- Formats ---------- */
function sysNum(x, d) {
  try { return Number(x).toLocaleString(LANG_LOCALE, {minimumFractionDigits: d || 0, maximumFractionDigits: d || 0}); } catch (e) { return Number(x).toFixed(d || 0); }
}
function sysBytes(kb) {
  var u = ['KB', 'MB', 'GB', 'TB'], i = 0, v = kb;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return sysNum(v, v < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}
function sysDuration(s) {
  var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? T('sys.upDays', {d: d, h: h}) : h ? T('sys.upHours', {h: h, m: m}) : T('sys.upMin', {m: m});
}
function sysTime(t) {
  var d = new Date(t);
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function sysDiskName(k) {
  var m = k.mount, last = m.split('/').filter(Boolean).pop() || m;
  if (k.kind === 'card' || m === '/data' || m === '/') return T('sys.diskInternal');
  if (/^\/mnt\/INTERNAL(\/|$)/.test(m)) return T('sys.diskInternalMusic');
  if (k.kind === 'usb') return 'USB · ' + last;
  var p = m.split('/');                                   /* /mnt/NAS/Name -> NAS · Name */
  return p[1] === 'mnt' && p.length > 3 ? p[2] + ' · ' + p.slice(3).join('/') : last;
}

/* ---------- Building blocks ---------- */
function sysCard(title, cls) {
  var c = histEl('div', 'syCard' + (cls ? ' ' + cls : ''));
  c.appendChild(histEl('div', 'syTitle', title));
  return c;
}
function sysMeter(frac) {
  var m = histEl('div', 'syMeter');
  m.appendChild(histEl('div', 'syMeterFill'));
  sysMeterSet(m, frac);
  return m;
}
function sysMeterSet(m, frac) { m.firstChild.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'; }
function sysSvg(tag, attrs, parent) {
  var e = document.createElementNS(SYS_NS, tag);
  Object.keys(attrs).forEach(function(k){ e.setAttribute(k, attrs[k]); });
  if (parent) parent.appendChild(e);
  return e;
}

/* Area chart [[time, value], …] with fixed scale lo..hi; gaps (service was not running) break the line.
   opts: {lo, hi, h, fmt(v), grid:[values], gap (ms), labels: true, hover: true} */
function sysArea(box, pts, opts) {
  var W = Math.max(200, box.clientWidth || 320), H = opts.h || 120;
  box.style.height = H + 'px';                             /* fixed height: redrawing never makes the page shorter (otherwise it jumps up) */
  while (box.firstChild) box.removeChild(box.firstChild);
  var padB = opts.labels ? 18 : 2, padT = 6;
  var svg = sysSvg('svg', {viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, 'class': 'syChart'}, box);
  var lo = opts.lo, hi = opts.hi, ph = H - padB - padT;
  pts = pts.filter(function(p){                          /* only values in the shown period: older ones would lie left outside the card */
    return p[1] !== null && p[1] !== undefined && (opts.t0 === undefined || p[0] >= opts.t0) && (opts.t1 === undefined || p[0] <= opts.t1);
  });
  if (opts.bucket && pts.length > W / 3) {                 /* 24 h = 1440 values: average to about 3 px per point */
    var n = Math.max(1, Math.round(W / 3)), span = ((opts.t1 || pts[pts.length - 1][0]) - (opts.t0 || pts[0][0])) / n, acc = {}, keys = [];
    pts.forEach(function(p){
      var k = Math.floor((p[0] - (opts.t0 || pts[0][0])) / span);
      if (!acc[k]) { acc[k] = [0, 0, 0]; keys.push(k); }
      acc[k][0] += p[0]; acc[k][1] += p[1]; acc[k][2]++;
    });
    pts = keys.map(function(k){ return [acc[k][0] / acc[k][2], acc[k][1] / acc[k][2]]; });
    opts.gap = Math.max(opts.gap || 0, span * 2.5);        /* averaged points are further apart: no false gaps */
  }
  var t0 = opts.t0 !== undefined ? opts.t0 : (pts.length ? pts[0][0] : 0), t1 = opts.t1 !== undefined ? opts.t1 : (pts.length ? pts[pts.length - 1][0] : 1);
  if (t1 <= t0) t1 = t0 + 1;
  function x(t) { return (t - t0) / (t1 - t0) * (W - 2) + 1; }
  function y(v) { return padT + ph - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * ph; }
  (opts.grid || []).forEach(function(g){
    sysSvg('line', {x1: 0, x2: W, y1: y(g), y2: y(g), 'class': 'syGrid'}, svg);
    if (opts.labels) { var tx = sysSvg('text', {x: W - 2, y: y(g) - 3, 'class': 'syAxis', 'text-anchor': 'end'}, svg); tx.textContent = opts.fmt(g); }
  });
  /* split into sections without gaps */
  var segs = [], cur = [];
  pts.forEach(function(p, i){
    if (i && p[0] - pts[i - 1][0] > (opts.gap || 180000)) { segs.push(cur); cur = []; }
    cur.push(p);
  });
  if (cur.length) segs.push(cur);
  segs.forEach(function(s){
    if (s.length === 1) s = [s[0], [s[0][0] + 1, s[0][1]]];
    var line = s.map(function(p, i){ return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join('');
    sysSvg('path', {d: line + 'L' + x(s[s.length - 1][0]).toFixed(1) + ' ' + (padT + ph) + 'L' + x(s[0][0]).toFixed(1) + ' ' + (padT + ph) + 'Z', 'class': 'syFill'}, svg);
    sysSvg('path', {d: line, 'class': 'syLine'}, svg);
  });
  if (opts.labels) {                                       /* times at the bottom: every 6 h */
    var first = Math.ceil(t0 / 3600000) * 3600000;
    for (var tt = first; tt <= t1; tt += 3600000) {
      if (new Date(tt).getHours() % 6) continue;
      var lx = x(tt);
      if (lx < 16 || lx > W - 16) continue;
      var tl = sysSvg('text', {x: lx, y: H - 4, 'class': 'syAxis', 'text-anchor': 'middle'}, svg);
      tl.textContent = sysTime(tt);
    }
  }
  if (!opts.hover || !pts.length) return;
  /* crosshair with value and time (mouse: hover, touch: tap and swipe) */
  var cross = sysSvg('line', {y1: padT, y2: padT + ph, 'class': 'syCross'}, svg);
  var dot = sysSvg('circle', {r: 4, 'class': 'syDot'}, svg);
  var tip = histEl('div', 'syTip');
  box.appendChild(tip);
  function hide() { cross.style.display = dot.style.display = tip.style.display = 'none'; }
  function show(ev) {
    var r = svg.getBoundingClientRect(), tx = (ev.clientX - r.left) / r.width * W, t = t0 + (tx - 1) / (W - 2) * (t1 - t0);
    var best = pts[0];
    pts.forEach(function(p){ if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; });
    var px = x(best[0]), py = y(best[1]);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    tip.textContent = sysTime(best[0]) + ' · ' + opts.fmt(best[1]);
    tip.style.left = Math.max(0, Math.min(r.width - 90, px / W * r.width - 45)) + 'px';
    cross.style.display = dot.style.display = tip.style.display = '';
  }
  hide();
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

/* ---------- Page ---------- */
function sysRender(st) {
  var d = sysData;
  while (sysBody.firstChild) sysBody.removeChild(sysBody.firstChild);
  var grid = histEl('div', 'syGridBox');
  sysBody.appendChild(grid);
  sysEls = {};

  /* processor: current load large, history of the last 3 minutes, one bar per core */
  var cpu = sysCard(T('sys.cpu'), 'syWide');
  var hero = histEl('div', 'syHero');
  sysEls.cpuVal = histEl('span', 'syBig', '–');
  hero.appendChild(sysEls.cpuVal);
  sysEls.cpuSub = histEl('span', 'sySub', '');
  hero.appendChild(sysEls.cpuSub);
  cpu.appendChild(hero);
  sysEls.cpuLive = histEl('div', 'syChartBox');
  cpu.appendChild(sysEls.cpuLive);
  sysEls.cores = histEl('div', 'syCores');
  cpu.appendChild(sysEls.cores);
  grid.appendChild(cpu);

  /* 24 hours: one quantity at a time (load, temperature or memory), switchable */
  var hist = sysCard(T('sys.hist'), 'syWide');
  var seg = histEl('div', 'mxChips syKinds');
  [['cpu', T('sys.kind.cpu')], ['temp', T('sys.kind.temp')], ['mem', T('sys.kind.mem')]].forEach(function(k){
    var c = histEl('div', 'mxChip mxSmall' + (k[0] === sysHistKind ? ' on' : ''), k[1]);
    c.addEventListener('click', function(){
      sysHistKind = k[0];
      Array.prototype.forEach.call(seg.children, function(x){ x.classList.toggle('on', x === c); });
      sysPaintHist();
    });
    seg.appendChild(c);
  });
  hist.appendChild(seg);
  sysEls.hist = histEl('div', 'syChartBox');
  hist.appendChild(sysEls.hist);
  sysEls.histNote = histEl('div', 'syNote', '');
  hist.appendChild(sysEls.histNote);
  grid.appendChild(hist);

  /* temperature */
  var temp = sysCard(T('sys.temp'));
  sysEls.tempVal = histEl('div', 'syBig', '–');
  temp.appendChild(sysEls.tempVal);
  sysEls.tempMeter = histEl('div');
  temp.appendChild(sysEls.tempMeter);
  sysEls.tempNote = histEl('div', 'syNote', '');
  temp.appendChild(sysEls.tempNote);
  grid.appendChild(temp);

  /* memory */
  var mem = sysCard(T('sys.mem'));
  sysEls.memVal = histEl('div', 'syBig', '–');
  mem.appendChild(sysEls.memVal);
  sysEls.memMeter = histEl('div');
  mem.appendChild(sysEls.memMeter);
  sysEls.memNote = histEl('div', 'syNote', '');
  mem.appendChild(sysEls.memNote);
  grid.appendChild(mem);

  /* drives */
  var disks = sysCard(T('sys.disks'), 'syWide');
  (d.disks || []).forEach(function(k){
    var row = histEl('div', 'syDisk');
    var head = histEl('div', 'syDiskHead');
    head.appendChild(histEl('span', 'syDiskName', sysDiskName(k)));
    head.appendChild(histEl('span', 'syDiskVal', k.ok
      ? T('sys.diskFree', {free: sysBytes(k.avail), size: sysBytes(k.size)})
      : T('sys.diskOffline')));
    row.appendChild(head);
    if (k.ok && k.size) row.appendChild(sysMeter(k.used / k.size));
    row.appendChild(histEl('div', 'syNote', k.mount + (k.net ? ' · ' + T('sys.diskNet') : '') + (k.ok && k.size ? ' · ' + T('sys.diskUsed', {p: sysNum(k.used / k.size * 100)}) : '')));
    disks.appendChild(row);
  });
  if (!(d.disks || []).length) disks.appendChild(histEl('div', 'syNote', T('sys.diskNone')));
  grid.appendChild(disks);

  /* services: state, restart; kiosk also start and stop (missing with an older tag service) */
  if (sysSvc) {
    var svc = sysCard(T('sys.svc'), 'syWide');
    sysEls.svc = histEl('div', 'sySvcList');
    svc.appendChild(sysEls.svc);
    sysEls.svcNote = histEl('div', 'syNote', '');
    svc.appendChild(sysEls.svcNote);
    sysEls.svcLogin = sysSvcLoginForm();
    svc.appendChild(sysEls.svcLogin);
    grid.appendChild(svc);
    sysPaintSvc();

    /* logs: last lines, source and length selectable, "Live" refreshes every 3 s */
    var lg = sysCard(T('sys.log'), 'syWide');
    sysEls.logSrc = histEl('div', 'mxChips syKinds');
    lg.appendChild(sysEls.logSrc);
    sysEls.logCtl = histEl('div', 'mxChips syLogCtl');
    lg.appendChild(sysEls.logCtl);
    sysEls.logFilter = histEl('input', 'sySvcPw syLogFilter');
    sysEls.logFilter.type = 'search'; sysEls.logFilter.placeholder = T('sys.log.filter');
    sysEls.logFilter.autocapitalize = 'off'; sysEls.logFilter.autocomplete = 'off'; sysEls.logFilter.spellcheck = false;
    sysEls.logFilter.value = sysLog.filter;
    sysEls.logFilter.addEventListener('input', function(){ sysLog.filter = this.value; sysLog.bottom = true; sysPaintLog(); });
    sysEls.logFilter.addEventListener('focus', function(){ sysLog.focus = true; });
    sysEls.logFilter.addEventListener('blur', function(){ sysLog.focus = false; });
    lg.appendChild(sysEls.logFilter);
    sysEls.logBox = histEl('pre', 'syLog');
    sysEls.logBox.addEventListener('scroll', function(){ sysLog.scroll = sysEls.logBox.scrollTop; sysLog.bottom = sysLogAtBottom(sysEls.logBox); });
    lg.appendChild(sysEls.logBox);
    sysEls.logNote = histEl('div', 'syNote', '');
    lg.appendChild(sysEls.logNote);
    grid.appendChild(lg);
    sysPaintLog();
    if (sysLog.focus) { sysEls.logFilter.focus(); var fl = sysEls.logFilter.value.length; try { sysEls.logFilter.setSelectionRange(fl, fl); } catch (er) {} }
    if (!sysLog.data || sysLog.seq !== sysSeq) sysLogLoad();
  }

  /* system details */
  var s = d.sys || {}, info = sysCard(T('sys.info'));
  function kv(box, k, v) {
    if (!v) return;
    var r = histEl('div', 'syKv');
    r.appendChild(histEl('span', 'syK', k));
    r.appendChild(histEl('span', 'syV', v));
    box.appendChild(r);
  }
  kv(info, T('sys.volumio'), s.volumio + (s.hardware ? ' (' + s.hardware + ')' : ''));
  kv(info, T('sys.os'), s.os);
  kv(info, T('sys.kernel'), s.kernel + (s.arch ? ' · ' + s.arch : ''));
  kv(info, T('sys.cpuModel'), (s.cpuCount ? T('sys.cores', {n: s.cpuCount}) : '') + (s.cpuModel ? ' · ' + s.cpuModel : ''));
  kv(info, T('sys.node'), s.node);
  kv(info, T('sys.host'), s.host);
  sysEls.uptime = histEl('span', 'syV', '');
  var ur = histEl('div', 'syKv');
  ur.appendChild(histEl('span', 'syK', T('sys.uptime')));
  ur.appendChild(sysEls.uptime);
  info.appendChild(ur);
  grid.appendChild(info);

  /* current file (Volumio getState) */
  if (st) {
    var pl = sysCard(T('sys.playing'));
    kv(pl, T('sys.state'), [st.status, st.service].filter(Boolean).join(' · '));
    kv(pl, T('sys.track'), [st.artist, st.title].filter(Boolean).join(' – '));
    kv(pl, T('sys.format'), [String(st.trackType || '').toUpperCase(), st.samplerate, st.bitdepth, st.bitrate, st.channels ? T('sys.channels', {n: st.channels}) : ''].filter(Boolean).join(' · '));
    var p = histEl('div', 'syPath', st.uri || '');
    if (st.uri) { pl.appendChild(histEl('div', 'syK', T('sys.path'))); pl.appendChild(p); }
    grid.appendChild(pl);
  }

  sysPaintLive();
  sysPaintHist();
}

/* ---------- Services ---------- */
function sysSvcState(u) {
  if (sysSvcBusy[u.id]) return T('sys.svc.busy');
  if (u.active === 'active') return u.since ? T('sys.svc.since', {d: sysDuration(Math.max(60, (Date.now() - u.since) / 1000))}) : T('sys.svc.running');
  if (u.active === 'activating' || u.active === 'reloading') return T('sys.svc.starting');
  if (u.active === 'deactivating') return T('sys.svc.stopping');
  if (u.active === 'failed') return T('sys.svc.failed');
  return T('sys.svc.stopped');
}
function sysPaintSvc() {
  var e = sysEls;
  if (!e || !e.svc || !sysSvc) return;
  while (e.svc.firstChild) e.svc.removeChild(e.svc.firstChild);
  (sysSvc.units || []).forEach(function(u){
    var row = histEl('div', 'sySvc');
    var st = sysSvcBusy[u.id] ? 'busy' : u.active === 'active' ? 'on' : u.active === 'failed' ? 'bad' : /ing$/.test(u.active) ? 'busy' : 'off';
    row.appendChild(histEl('span', 'sySvcDot ' + st));
    var txt = histEl('div', 'sySvcText');
    txt.appendChild(histEl('div', 'sySvcName', T('sys.svc.' + svcKey(u.id))));
    txt.appendChild(histEl('div', 'sySvcState' + (st === 'bad' ? ' syWarn' : ''), sysSvcState(u)));
    row.appendChild(txt);
    var btns = histEl('div', 'sySvcBtns'), on = u.active === 'active' || u.active === 'activating';
    var acts = u.actions.indexOf('start') >= 0
      ? (on ? ['stop', 'restart'] : ['start'])
      : ['restart'];
    acts.forEach(function(a){
      var label = a === 'restart' && !on ? T('sys.svc.do.start') : T('sys.svc.do.' + a);
      var b = histEl('div', 'mxChip mxSmall sySvcBtn' + (sysSvcBusy[u.id] || !sysSvc.pw ? ' off' : ''), label);
      b.addEventListener('click', function(){ sysSvcAct(u, a); });
      btns.appendChild(b);
    });
    row.appendChild(btns);
    e.svc.appendChild(row);
  });
  /* the whole player: restart and power off (with password only if one is set) */
  var pr = histEl('div', 'sySvc sySvcPlayer'), pb = sysSvcBusy.player;
  pr.appendChild(histEl('span', 'sySvcDot ' + (pb ? 'busy' : 'on')));
  var pt = histEl('div', 'sySvcText');
  pt.appendChild(histEl('div', 'sySvcName', T('sys.power.name')));
  pt.appendChild(histEl('div', 'sySvcState', pb ? T('sys.power.busy.' + pb) : sysData && sysData.uptime ? T('sys.svc.since', {d: sysDuration(sysData.uptime)}) : T('sys.svc.running')));
  pr.appendChild(pt);
  var pbs = histEl('div', 'sySvcBtns');
  ['reboot', 'poweroff'].forEach(function(a){
    var b = histEl('div', 'mxChip mxSmall sySvcBtn' + (pb ? ' off' : ''), T('sys.power.do.' + a));
    b.addEventListener('click', function(){ sysSvcAct({id: 'player'}, a); });
    pbs.appendChild(b);
  });
  pr.appendChild(pbs);
  e.svc.appendChild(pr);
  var note = sysSvcMsg || [sysSvc.pw ? '' : T('sys.svc.nopw'), sysSvc.sudo === false ? T('sys.svc.nosudo') : ''].filter(Boolean).join(' ');
  e.svcNote.textContent = note;
  e.svcNote.className = 'syNote' + (note ? ' syWarn' : '');
  e.svcLogin.style.display = sysSvcPending ? '' : 'none';
}

/* login per device: enter the password once, the tag service issues a key for 30 days (localStorage) */
function sysSvcToken(v) {
  try {
    if (v === undefined) return localStorage.getItem('xplorio.svcToken') || '';
    if (v) localStorage.setItem('xplorio.svcToken', v); else localStorage.removeItem('xplorio.svcToken');
  } catch (e) { /* private window: then log in every time */ }
  return v || '';
}
var sysSvcMem = '';                                        /* key without localStorage, while the page is open */
function sysSvcLoginForm() {
  var f = histEl('form', 'sySvcLogin');
  f.appendChild(histEl('div', 'syNote', T('sys.svc.loginHint')));
  var row = histEl('div', 'sySvcLoginRow');
  var inp = histEl('input', 'sySvcPw');
  inp.type = 'password'; inp.autocomplete = 'current-password'; inp.placeholder = T('sys.svc.password');
  row.appendChild(inp);
  var ok = histEl('button', 'mxChip mxSmall sySvcBtn', T('sys.svc.login'));
  ok.type = 'submit';
  row.appendChild(ok);
  var no = histEl('div', 'mxChip mxSmall mxMore sySvcBtn', T('sys.svc.cancel'));
  no.addEventListener('click', function(){ sysSvcPending = null; err.textContent = ''; sysPaintSvc(); });
  row.appendChild(no);
  f.appendChild(row);
  var err = histEl('div', 'syNote syWarn', '');
  f.appendChild(err);
  f.addEventListener('submit', function(ev){
    ev.preventDefault();
    if (!inp.value || ok.classList.contains('off')) return;
    ok.classList.add('off');
    tagPostJson('/servicelogin', {password: inp.value}).then(function(r){
      ok.classList.remove('off');
      if (r && r.ok) {
        inp.value = ''; err.textContent = '';
        sysSvcMem = sysSvcToken(r.token);
        var p = sysSvcPending; sysSvcPending = null;
        sysPaintSvc();
        if (p && p.logs) sysLogLoad();
        else if (p) sysSvcRun(p.u, p.action);
        return;
      }
      inp.value = '';
      err.textContent = r && r.error === 'locked' ? T('sys.svc.locked', {s: r.wait}) : r && r.error === 'wrong' ? T('sys.svc.wrong') + (r.wait ? ' ' + T('sys.svc.locked', {s: r.wait}) : '') : T('sys.svc.error');
    }).catch(function(){ ok.classList.remove('off'); err.textContent = T('sys.svc.error'); });
  });
  return f;
}
function sysSvcAskLogin(u, action) {
  sysSvcPending = {u: u, action: action};
  sysPaintSvc();
  var inp = sysEls && sysEls.svcLogin && sysEls.svcLogin.querySelector('input');
  if (inp) { inp.focus(); sysEls.svcLogin.scrollIntoView({block: 'nearest'}); }
}
function sysSvcAct(u, action) {
  if (sysSvcBusy[u.id]) return;
  var ask = u.id === 'player' ? T('sys.power.ask.' + action) : action === 'start' ? '' : action === 'stop' ? T('sys.svc.askStop.' + svcKey(u.id)) : T('sys.svc.ask.' + svcKey(u.id));
  if (ask && !window.confirm(ask)) return;
  sysSvcRun(u, action);
}
function sysSvcRun(u, action) {
  var token = sysSvcToken() || sysSvcMem, player = u.id === 'player';
  if (!token && (!player || sysSvc.pw)) return sysSvcAskLogin(u, action);
  var seq = sysSeq;
  sysSvcBusy[u.id] = player ? action : true; sysSvcMsg = '';
  sysPaintSvc();
  tagPostJson(player ? '/power' : '/service', player ? {action: action, token: token} : {unit: u.id, action: action, token: token}).then(function(r){
    if (seq !== sysSeq) return;
    if (r && r.error === 'auth') {                         /* expired or new password: log in again */
      delete sysSvcBusy[u.id];
      sysSvcMem = sysSvcToken(null);
      return sysSvcAskLogin(u, action);
    }
    if (!r || !r.ok) {
      delete sysSvcBusy[u.id];
      sysSvcMsg = r && r.error === 'nosudo' ? T('sys.svc.nosudo') : r && r.error === 'unset' ? T('sys.svc.nopw') : T('sys.svc.error');
      return sysPaintSvc();
    }
    if (player) {                                          /* player shuts down; after a restart, reload in 1 and 2 minutes */
      if (action === 'reboot') [60000, 120000].forEach(function(ms){
        sysSvcTimers.push(setTimeout(function(){ if (seq === sysSeq) { delete sysSvcBusy.player; sysFull(); } }, ms));
      });
      return;
    }
    if (r.self) {                                          /* the tag service restarts itself: wait briefly, then reload everything */
      return sysSvcTimers.push(setTimeout(function(){ if (seq === sysSeq) { delete sysSvcBusy[u.id]; sysFull(); } }, 6000));
    }
    [1500, 5000, 12000, 30000].forEach(function(ms, i, all){
      sysSvcTimers.push(setTimeout(function(){
        if (seq !== sysSeq) return;
        tagGetJson('/services').then(function(s){
          if (seq !== sysSeq || !s || !s.ok) return;
          sysSvc = s;
          var x = (s.units || []).filter(function(v){ return v.id === u.id; })[0];
          if (i === all.length - 1 || (x && !/ing$/.test(x.active))) delete sysSvcBusy[u.id];
          sysPaintSvc();
        }).catch(function(){});
      }, ms));
    });
  }).catch(function(){
    if (seq !== sysSeq) return;
    delete sysSvcBusy[u.id];
    sysSvcMsg = T('sys.svc.error');
    sysPaintSvc();
  });
}

/* ---------- Logs ---------- */
var sysLog = {src: '', filter: '', focus: false, n: 50, live: false, data: null, seq: -1, timer: null, busy: false, scroll: 0, bottom: true};
function sysLogAtBottom(b) { return b.scrollTop + b.clientHeight >= b.scrollHeight - 24; }
function sysLogLoad() {
  var seq = sysSeq, src = sysLog.src, token = sysSvcToken() || sysSvcMem;
  clearTimeout(sysLog.timer);
  sysLog.busy = true;
  sysPaintLogCtl();
  tagPostJson('/logs', {source: src, lines: sysLog.n, token: token}).then(function(r){
    if (seq !== sysSeq || src !== sysLog.src) return;
    if (r && r.error === 'auth') { if (token) sysSvcMem = sysSvcToken(null); sysLog.live = false; }
    sysLog.data = r || {ok: false}; sysLog.seq = seq;
  }).catch(function(){
    if (seq !== sysSeq) return;
    sysLog.data = {ok: false, error: 'net', sources: sysLog.data && sysLog.data.sources}; sysLog.seq = seq;
  }).then(function(){
    if (seq !== sysSeq) return;
    sysLog.busy = false;
    sysPaintLog();
    if (sysLog.live) sysLog.timer = setTimeout(function tick(){
      if (seq !== sysSeq || !sysLog.live || !overlaySystem.classList.contains('on')) return;
      if (document.hidden) sysLog.timer = setTimeout(tick, 3000);   /* in the background: do not poll, but stay on */
      else sysLogLoad();
    }, 3000);
  });
}
function sysPaintLogCtl() {
  var e = sysEls;
  if (!e || !e.logCtl) return;
  while (e.logCtl.firstChild) e.logCtl.removeChild(e.logCtl.firstChild);
  [50, 100, 300].forEach(function(n){
    var c = histEl('div', 'mxChip mxSmall' + (sysLog.n === n ? ' on' : ''), T('sys.log.lines', {n: n}));
    c.addEventListener('click', function(){ if (sysLog.n === n) return; sysLog.n = n; sysLog.bottom = true; sysLogLoad(); });
    e.logCtl.appendChild(c);
  });
  var live = histEl('div', 'mxChip mxSmall syLogLive' + (sysLog.live ? ' on' : ''), T('sys.log.live'));
  live.addEventListener('click', function(){
    sysLog.live = !sysLog.live;
    if (sysLog.live) { sysLog.bottom = true; sysLogLoad(); } else { clearTimeout(sysLog.timer); sysPaintLogCtl(); }
  });
  e.logCtl.appendChild(live);
  var rf = histEl('div', 'mxChip mxSmall mxMore' + (sysLog.busy ? ' off' : ''), T('sys.log.refresh'));
  rf.addEventListener('click', function(){ if (!sysLog.busy) { sysLog.bottom = true; sysLogLoad(); } });
  e.logCtl.appendChild(rf);
}
function sysPaintLog() {
  var e = sysEls, d = sysLog.data;
  if (!e || !e.logBox) return;
  var srcs = d && d.sources || ['volumio', 'mpd', 'tag-service'];
  while (e.logSrc.firstChild) e.logSrc.removeChild(e.logSrc.firstChild);
  srcs.forEach(function(id){
    var c = histEl('div', 'mxChip mxSmall' + (id === sysLog.src ? ' on' : ''), T('sys.log.src.' + id));
    c.addEventListener('click', function(){
      clearTimeout(sysLog.timer);
      if (id === sysLog.src) { sysLog.src = ''; sysLog.live = false; sysLog.data = {ok: true, source: '', lines: [], sources: srcs}; return sysPaintLog(); }   /* once more: collapse */
      sysLog.src = id; sysLog.data = {ok: true, source: id, lines: [], sources: srcs}; sysLog.bottom = true;
      sysLogLoad(); sysPaintLog();
    });
    e.logSrc.appendChild(c);
  });
  sysPaintLogCtl();
  e.logCtl.style.display = e.logFilter.style.display = sysLog.src ? '' : 'none';
  var box = e.logBox, all = d && d.ok ? d.lines || [] : [], lines = all;
  var q = sysLog.filter.trim().toLowerCase();             /* filter: lines containing the text (case-insensitive) */
  if (q) lines = all.filter(function(l){ return l.toLowerCase().indexOf(q) >= 0; });
  box.textContent = lines.join('\n');
  box.style.display = lines.length ? '' : 'none';
  if (sysLog.bottom) box.scrollTop = box.scrollHeight; else box.scrollTop = sysLog.scroll;
  var note = !d ? T('hist.loading')
    : d.error === 'auth' ? T('sys.log.auth')
    : d.error === 'nojournal' ? T('sys.log.nojournal')
    : d.error === 'missing' ? T('sys.log.missing')
    : !d.ok ? T('sys.svc.error')
    : !sysLog.src ? T('sys.log.pick')
    : q && all.length ? T('sys.log.match', {n: lines.length, all: all.length})
    : !lines.length && !sysLog.busy ? T('sys.log.empty') : '';
  e.logNote.textContent = note;
  e.logNote.className = 'syNote' + (d && !d.ok ? ' syWarn' : '');
  if (d && d.error === 'auth') {
    var b = histEl('div', 'mxChip mxSmall sySvcBtn syLogLogin', T('sys.svc.login'));
    b.addEventListener('click', function(){
      sysSvcPending = {logs: true};
      sysPaintSvc();
      var inp = sysEls && sysEls.svcLogin && sysEls.svcLogin.querySelector('input');
      if (inp) { inp.focus(); sysEls.svcLogin.scrollIntoView({block: 'center'}); }
    });
    e.logNote.appendChild(document.createTextNode(' '));
    e.logNote.appendChild(b);
  }
}

function sysPaintLive() {
  var d = sysData, e = sysEls;
  if (!e || !d) return;
  e.cpuVal.textContent = d.cpu === null || d.cpu === undefined ? '–' : sysNum(d.cpu) + ' %';
  e.cpuSub.textContent = (d.load || []).length ? T('sys.load', {a: sysNum(d.load[0], 2), b: sysNum(d.load[1], 2), c: sysNum(d.load[2], 2)}) : '';
  var now = d.now || Date.now(), live = d.live || [];
  sysArea(e.cpuLive, live, {lo: 0, hi: 100, h: 64, fmt: function(v){ return sysNum(v) + ' %'; }, grid: [50], gap: 10000,
                            t0: live.length ? live[live.length - 1][0] - 180000 : now - 180000, t1: live.length ? live[live.length - 1][0] : now, hover: true});
  (d.cores || []).forEach(function(c, i){                 /* lines stay in place, only values change */
    var b = e.cores.children[i];
    if (!b) {
      b = histEl('div', 'syCore');
      b.appendChild(histEl('span', 'syCoreName', T('sys.core', {n: i + 1})));
      b.appendChild(sysMeter(0));
      b.appendChild(histEl('span', 'syCoreVal', ''));
      e.cores.appendChild(b);
    }
    sysMeterSet(b.children[1], (c || 0) / 100);
    b.children[2].textContent = c === null ? '–' : sysNum(c) + ' %';
  });
  if (d.temp !== null && d.temp !== undefined) {
    e.tempVal.textContent = sysNum(d.temp, 1) + ' °C';
    if (!e.tempMeter.firstChild) e.tempMeter.appendChild(sysMeter(0));
    sysMeterSet(e.tempMeter.firstChild, (d.temp - 30) / 55);           /* scale 30–85 °C: from 80 °C the Raspberry Pi throttles */
    e.tempNote.textContent = d.temp >= 80 ? '⚠ ' + T('sys.tempHot') : d.temp >= 70 ? '⚠ ' + T('sys.tempWarm') : T('sys.tempOk');
    e.tempNote.className = 'syNote' + (d.temp >= 70 ? ' syWarn' : '');
  } else e.tempVal.textContent = T('sys.none');
  var m = d.mem || {};
  if (m.total) {
    var used = m.total - m.avail;
    e.memVal.textContent = sysNum(used / m.total * 100) + ' %';
    if (!e.memMeter.firstChild) e.memMeter.appendChild(sysMeter(0));
    sysMeterSet(e.memMeter.firstChild, used / m.total);
    e.memNote.textContent = T('sys.memUsed', {used: sysBytes(used), total: sysBytes(m.total)}) +
      (m.swapTotal ? ' · ' + T('sys.swap', {used: sysBytes(m.swapTotal - m.swapFree)}) : '');
  }
  if (d.uptime) e.uptime.textContent = sysDuration(d.uptime);
}

function sysPaintHist() {
  var d = sysData, e = sysEls;
  if (!e || !d) return;
  var col = {cpu: 1, mem: 2, temp: 3}[sysHistKind], h = d.hist || [];
  var pts = h.map(function(r){ return [r[0], r[col]]; });
  var vals = pts.map(function(p){ return p[1]; }).filter(function(v){ return v !== null && v !== undefined; });
  var now = d.now || Date.now();
  var o = sysHistKind === 'temp'
    ? {lo: 30, hi: 85, grid: [40, 60, 80], fmt: function(v){ return sysNum(v, 1) + ' °C'; }}
    : {lo: 0, hi: 100, grid: [25, 50, 75], fmt: function(v){ return sysNum(v) + ' %'; }};
  o.h = 150; o.labels = true; o.hover = true; o.bucket = true; o.gap = 600000; o.t0 = now - 24 * 3600000; o.t1 = now;
  sysArea(e.hist, pts, o);
  if (!vals.length) { e.histNote.textContent = T('sys.histEmpty'); return; }
  var avg = vals.reduce(function(a, b){ return a + b; }, 0) / vals.length, max = Math.max.apply(null, vals);
  e.histNote.textContent = T('sys.histSum', {avg: o.fmt(avg), max: o.fmt(max)}) + (h.length && h[0][0] > now - 23 * 3600000 ? ' · ' + T('sys.histSince', {t: sysTime(h[0][0])}) : '');
}

document.getElementById('closeSystem').addEventListener('click', function(){ sysStop(); closeAllOverlays(); });
document.getElementById('systemBack').addEventListener('click', function(){ sysStop(); openMenu(); });
window.addEventListener('resize', function(){ if (sysOpen() && sysEls) { sysPaintLive(); sysPaintHist(); } });
document.addEventListener('visibilitychange', function(){ if (sysOpen() && sysEls) sysFull(); });
