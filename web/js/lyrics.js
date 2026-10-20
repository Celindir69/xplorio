/* Lyrics source (LRCLIB) and display of the synchronized lines
   Classic script, shared global scope; load order see xplorio.html. */
/* ===================================================================
   INSERT YOUR FOURTH INFO HERE:
     var EXTRA_TITLE = ...
     function extraUrl(artist, title) { ... }
     function parseSyncedLyrics(text) { ... }
     function askExtra(artist, title) { ... }
   =================================================================== */
var EXTRA_TITLE = 'Lyrics';
var EXTRA_FIELD = ['syncedLyrics'];

function extraUrl(artist, title) {
  return 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(artist) + '&track_name=' + encodeURIComponent(title);
}

function parseSyncedLyrics(text) {
  var result = [];
  var lines = String(text || '').split(/\r?\n/);

  lines.forEach(function(raw) {
    var matches = [];
    var re = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    var match;

    while ((match = re.exec(raw)) !== null) {
      var minutes = parseInt(match[1], 10);
      var seconds = parseInt(match[2], 10);
      var fraction = match[3] || '0';

      var milliseconds;
      if (fraction.length === 1) {
        milliseconds = parseInt(fraction, 10) * 100;
      } else if (fraction.length === 2) {
        milliseconds = parseInt(fraction, 10) * 10;
      } else {
        milliseconds = parseInt(fraction.slice(0, 3), 10);
      }

      matches.push(
        minutes * 60000 +
        seconds * 1000 +
        milliseconds
      );
    }

    var lyric = raw.replace(/\[[^\]]+\]/g, '').trim();
if (!lyric) {
  return;
}
    matches.forEach(function(time) {
      result.push({
        time: time,
        text: lyric
      });
    });
  });

  result.sort(function(a, b) {
    return a.time - b.time;
  });

  return result;
}


function askExtra(artist, title, isRadio) {
  var url = extraUrl(artist, title);
  if (!url) return Promise.resolve(null);

  return fetch(url)
    .then(function(r) {
      return r.ok ? r.json() : null;
    })
    .then(function(j) {
      if (!j) return null;

      if(!isRadio)var synced = j.syncedLyrics; else synced = null;
      var plain  = j.plainLyrics;

      if (typeof synced === 'string' && synced.trim()) {
        var parsed = parseSyncedLyrics(synced);

        if (parsed.length) {
          return {
            kind: 'syncedLyrics',
            value: parsed,
            key: lyrKeyOf(artist, title)
          };
        }
      }

      if (typeof plain === 'string' && plain.trim()) {
        return {
          kind: 'story',
          value: plain
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        };
      }

      return null;
    })
    .catch(function() {
      return null;
    });
}




/* ===================================================================
   INSERT YOUR LYRICS FUNCTIONS HERE:
     /* display state: active line, pause after swiping, running animation */
var lyrActive = -2, lyrUserUntil = 0, lyrPending = false, lyrAnim = 0, lyrLastH = 0;
var LYR_PAUSE_MS = 4000;

/* ---------- Offset per track (ms, positive = text comes later); stored in the tag service, else in the browser ---------- */
var lyrOffset = 0, lyrKey = '', lyrSyncTimer = null;

function lyrKeyOf(artist, title) {
  function k(s) { s = String(s || ''); if (s.normalize) s = s.normalize('NFKD'); return s.replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  return k(artist) + '|' + k(title);
}
function lyrTags() { return typeof TAGS !== 'undefined' ? TAGS : ''; }
function lyrLocal(key, ms) {
  try {
    var all = JSON.parse(localStorage.getItem('lyrOffsets') || '{}');
    if (ms === undefined) return all[key] || 0;
    if (ms) all[key] = ms; else delete all[key];
    localStorage.setItem('lyrOffsets', JSON.stringify(all));
  } catch (e) { return 0; }
}

function lyrSyncShow(on) { document.documentElement.classList.toggle('lyrSynced', !!on); lyrShiftPlace(); }

/* stage view: − and + between the start and middle of the lyrics, left of the buttons at the top right */
function lyrShiftPlace() {
  var bar = document.getElementById('lyrShiftBar'), top = document.getElementById('topBar'), right = document.getElementById('topRight');
  var body = document.querySelector('#overlayLyrics .overlayBody');
  if (!bar || !body || !document.documentElement.classList.contains('stage')) return;
  var t = top.getBoundingClientRect(), l = body.getBoundingClientRect(), r = right.getBoundingClientRect();
  var w = bar.offsetWidth, start = l.left + (parseFloat(getComputedStyle(body).paddingLeft) || 0) - t.left;
  var mid = Math.min((l.left + l.right) / 2, r.left - 12 - w / 2) - t.left;       /* middle of the lyrics, further left if needed */
  var x = Math.max(start, ((start + w / 2) + mid) / 2 - w / 2);
  x = Math.min(x, r.left - t.left - 16 - w);                                       /* never under the buttons on the right (e.g. with remote control) */
  bar.style.left = Math.round(Math.max(0, x)) + 'px';
}
window.addEventListener('resize', lyrShiftPlace);

function lyrPaintOffset() {
  var v = document.getElementById('lyrSyncVal');
  if (!v) return;
  v.textContent = lyrOffset ? (lyrOffset > 0 ? '+' : '−') + T('lyrics.seconds', {s: (Math.abs(lyrOffset) / 1000).toLocaleString(LANG_LOCALE, {minimumFractionDigits: 1, maximumFractionDigits: 1})}) : T('lyrics.sync');
  v.classList.toggle('set', !!lyrOffset);
}

function lyrSetOffset(ms, save) {
  lyrOffset = ms;
  lyrActive = -2;                               /* recompute the active line */
  lyrPaintOffset();
  updateSyncedLyrics();
  if (!save || !lyrKey) return;
  var key = lyrKey;
  clearTimeout(lyrSyncTimer);                   /* repeated taps: save once */
  lyrSyncTimer = setTimeout(function(){
    lyrLocal(key, ms);
    if (lyrTags()) fetch(lyrTags() + '/lyricsoffset', {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'},
                                                     body: JSON.stringify({key: key, ms: ms})}).catch(function(){});
  }, 800);
}

function lyrLoadOffset(key) {
  lyrKey = key || '';
  lyrSetOffset(key ? lyrLocal(key) : 0, false);
  if (!key || !lyrTags()) return;
  fetch(lyrTags() + '/lyricsoffset?key=' + encodeURIComponent(key)).then(function(r){ return r.json(); }).then(function(j){
    if (j && j.ok && key === lyrKey && j.ms !== lyrOffset) lyrSetOffset(j.ms, false);
  }).catch(function(){});
}

function lyrShift(d) {
  if (!lyricLines.length) return;
  lyrSetOffset(lyrOffset + d, true);
  showToast(T(d > 0 ? 'lyrics.later' : 'lyrics.earlier', {state: lyrOffset ? document.getElementById('lyrSyncVal').textContent : T('lyrics.asDelivered')}));
}

Array.prototype.forEach.call(document.querySelectorAll('.lyrShift'), function(b){
  b.addEventListener('click', function(e){ e.stopPropagation(); lyrShift(Number(b.getAttribute('data-d'))); });
});
document.getElementById('lyrSyncVal').addEventListener('click', function(){
  if (lyrOffset) { lyrSetOffset(0, true); showToast(T('lyrics.reset')); }

});

function renderSyncedLyrics(lines, key) {
  body.className = 'synced';
  lyrSyncShow(true);
  lyrLoadOffset(key);
  lyricLines = lines || [];
  lyrActive = -2; lyrPending = false; lyrUserUntil = 0; lyrLastH = 0;
  cancelAnimationFrame(lyrAnim);
  area.scrollTop = 0;

  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }

  lyricLines.forEach(function(line, index) {
    var div = document.createElement('div');

    div.className = 'lyric-line';
    div.dataset.index = index;
    div.textContent = line.text || ' ';

    body.appendChild(div);
  });

  updateSyncedLyrics();
}

/* smooth scrolling (old browsers lack scrollTo with options) */
function lyrScrollTo(top, animate) {
  cancelAnimationFrame(lyrAnim);
  var from = area.scrollTop;
  top = Math.max(0, top);
  if (!animate || Math.abs(top - from) < 2) { area.scrollTop = top; return; }
  var t0 = Date.now(), dur = 350;
  (function step() {
    var k = Math.min(1, (Date.now() - t0) / dur);
    k = 1 - Math.pow(1 - k, 3);
    area.scrollTop = from + (top - from) * k;
    if (k < 1) lyrAnim = requestAnimationFrame(step);
  })();
}

function lyrCenter(el, animate) {
  var h = area.clientHeight;
  body.style.paddingBottom = (h / 2) + 'px';   /* the last lines can also move up to the middle; deliberately no space at the top: the first lines move from top to bottom first, then the text scrolls */
  var y = el.getBoundingClientRect().top - area.getBoundingClientRect().top + area.scrollTop;
  lyrScrollTo(y - h / 2 + el.offsetHeight / 2, animate);
}

function updateSyncedLyrics() {
  if (!lyricLines.length || document.hidden) return;

  var pos = (Number(window.currentSeekMs) || 0) - lyrOffset;
  var active = -1;

  for (var i = 0; i < lyricLines.length; i++) {
    if (lyricLines[i].time <= pos) {
      active = i;
    } else {
      break;
    }
  }

  var changed = active !== lyrActive;
  /* nothing new: only check whether the overlay just opened (height), otherwise touch nothing */
  if (!changed && !lyrPending && area.clientHeight === lyrLastH) return;
  var elements = body.querySelectorAll('.lyric-line');

  if (changed) {
    lyrActive = active;
    for (var j = 0; j < elements.length; j++) {
      elements[j].classList.remove('current', 'past');

      if (j < active) {
        elements[j].classList.add('past');
      } else if (j === active) {
        elements[j].classList.add('current');
      }
    }
  }

  if (active < 0 || !elements[active]) return;

  var h = area.clientHeight;
  if (!h) return;                               /* overlay not visible */
  var resized = h !== lyrLastH;                 /* overlay opened or window resized: center immediately */
  lyrLastH = h;

  var paused = Date.now() < lyrUserUntil;       /* user is scrolling */
  if (resized) { lyrCenter(elements[active], false); lyrPending = false; }
  else if (!paused && (changed || lyrPending)) { lyrCenter(elements[active], true); lyrPending = false; }
  else if (paused && changed) lyrPending = true;
}

/* Own scrolling: auto-follow pauses briefly, then the view jumps back to the current line */
function lyrUserTouched() {
  cancelAnimationFrame(lyrAnim);
  lyrUserUntil = Date.now() + LYR_PAUSE_MS;
  lyrPending = true;
}
['touchstart', 'wheel', 'mousedown'].forEach(function(ev) {
  area.addEventListener(ev, lyrUserTouched, { passive: true });
});

/* tapping a line seeks the song to that position */
body.addEventListener('click', function(e) {
  var el = e.target;
  while (el && el !== body && !(el.classList && el.classList.contains('lyric-line'))) el = el.parentNode;
  if (!el || el === body) return;
  var line = lyricLines[Number(el.dataset.index)];
  if (!line || !curDur) return;                 /* web radio: no seeking */
  lyrUserUntil = 0; lyrPending = true;
  seekToMs(Math.max(0, line.time + lyrOffset));
});
