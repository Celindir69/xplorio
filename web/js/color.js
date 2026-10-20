/* Cover color mood: an accent color and a background tint from the cover of the current track.
   pickMood() is a pure function (pixels -> colors) and testable with tests/color.test.js;
   updateMood() draws the cover small onto a canvas and sets the CSS variables
   --accent-d/-l, --on-accent-d/-l and --tint-d/-l (dark and light theme; base.css picks --accent and --bg-tint from them). Only covers from the own player (same origin or /albumart) are read:
   foreign servers (e.g. Tidal, TuneIn) send no CORS header, so the default look stays there.
   Classic script, shared global scope; load order see xplorio.html. */

function cmClamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function cmHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}

/* text on the accent surface: dark or light, whichever has more contrast (WCAG luminance) */
function cmOnColor(h, s, l) {
  var a = s * Math.min(l, 1 - l);
  function ch(n) {
    var k = (n + h / 30) % 12, v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  var L = 0.2126 * ch(0) + 0.7152 * ch(8) + 0.0722 * ch(4);
  return (L + 0.05) / 0.0556 >= 1.05 / (L + 0.05) ? '#111' : '#fff';
}

/* px: flat RGBA list (like ImageData.data). Result {hue, accent, tint} or null (cover without color) */
function pickMood(px) {
  var BINS = 36, bins = [], i, valid = 0, colored = 0;
  for (i = 0; i < BINS; i++) bins.push({ w: 0, s: 0, l: 0 });
  for (i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    var c = cmHsl(px[i], px[i + 1], px[i + 2]), h = c[0], s = c[1], l = c[2];
    if (l < 0.10 || l > 0.92) continue;           /* near black or white does not count */
    valid++;
    if (s < 0.18) continue;                       /* greys do not count */
    colored++;
    var w = s * (1 - Math.abs(l - 0.5) * 1.4);    /* strong midtones count most */
    if (w <= 0) continue;
    var b = bins[Math.floor(h / (360 / BINS)) % BINS];
    b.w += w; b.s += s * w; b.l += l * w;
  }
  if (valid < 8 || colored / valid < 0.15) return null;   /* cover (almost) without color */
  var best = -1, bestW = 0;
  for (i = 0; i < BINS; i++) {
    var sum = bins[i].w + bins[(i + BINS - 1) % BINS].w + bins[(i + 1) % BINS].w;
    if (sum > bestW) { bestW = sum; best = i; }
  }
  if (best < 0) return null;
  /* mean of the three bins (hue as circular mean) */
  var sx = 0, sy = 0, tw = 0, ts = 0, tl = 0;
  [-1, 0, 1].forEach(function(o){
    var k = (best + o + BINS) % BINS, bw = bins[k].w;
    if (!bw) return;
    var ang = (k + 0.5) * (360 / BINS) * Math.PI / 180;
    sx += Math.cos(ang) * bw; sy += Math.sin(ang) * bw; tw += bw; ts += bins[k].s; tl += bins[k].l;
  });
  var hue = Math.round(((Math.atan2(sy, sx) * 180 / Math.PI) + 360) % 360);
  var avgS = ts / tw, avgL = tl / tw;
  var s = cmClamp(avgS, 0.45, 0.85);
  var accentL = cmClamp(avgL * 0.5 + 0.34, 0.58, 0.72);     /* light enough for a dark background */
  var lightL  = cmClamp(avgL * 0.4 + 0.18, 0.32, 0.42);     /* dark enough for a light background (light mode) */
  var tintS = cmClamp(avgS * 0.9, 0.30, 0.65);
  return {
    hue: hue,
    accent: 'hsl(' + hue + ', ' + Math.round(s * 100) + '%, ' + Math.round(accentL * 100) + '%)',
    tint: 'hsla(' + hue + ', ' + Math.round(tintS * 100) + '%, 34%, 0.42)',
    accentLight: 'hsl(' + hue + ', ' + Math.round(s * 100) + '%, ' + Math.round(lightL * 100) + '%)',
    tintLight: 'hsla(' + hue + ', ' + Math.round(tintS * 100) + '%, 82%, 0.38)',
    onAccent: cmOnColor(hue, Math.round(s * 100) / 100, Math.round(accentL * 100) / 100),
    onAccentLight: cmOnColor(hue, Math.round(s * 100) / 100, Math.round(lightL * 100) / 100)
  };
}

/* set both color sets; the CSS decides which applies (--accent, --bg-tint in base.css, light/dark) */
function applyMood(m) {
  var root = document.documentElement.style;
  var props = {'--accent-d': 'accent', '--tint-d': 'tint', '--accent-l': 'accentLight', '--tint-l': 'tintLight',
               '--on-accent-d': 'onAccent', '--on-accent-l': 'onAccentLight'};
  Object.keys(props).forEach(function(k){ if (m) root.setProperty(k, m[props[k]]); else root.removeProperty(k); });
}

var moodCache = {};      /* cover URL -> {…} or null */
var moodSeq = 0;

function moodReadable(url) {
  try {
    var o = new URL(url, location.href).origin;
    return o === location.origin || url.indexOf('/albumart') > -1 ||
           (typeof TAGS !== 'undefined' && o === new URL(TAGS).origin);          /* tag service (web radio covers) allows CORS */
  }
  catch (e) { return false; }
}

function updateMood(url) {
  var cfg = window.APP_CONFIG || {};
  var mySeq = ++moodSeq;
  if (cfg.COLOR_MOOD === false || !url || !moodReadable(url)) { applyMood(null); return; }
  if (moodCache.hasOwnProperty(url)) { applyMood(moodCache[url]); return; }
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function(){
    var m = null;
    try {
      var N = 24, cv = document.createElement('canvas'); cv.width = cv.height = N;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, N, N);
      m = pickMood(ctx.getImageData(0, 0, N, N).data);
    } catch (e) { m = null; }
    moodCache[url] = m;
    if (mySeq === moodSeq) applyMood(m);       /* only if no other track is playing by now */
  };
  img.onerror = function(){ moodCache[url] = null; if (mySeq === moodSeq) applyMood(null); };
  /* own parameter so that a copy of the cover cached without CORS is not reused */
  img.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 'aw=mood';
}
