/* Display layout for large landscape screens (iPad, MacBook, desktop), based on legacy/now_playing.html:
   cover and title on the left, below them the info carousel (pages by itself like kioskTV.html), controls at the bottom;
   lyrics always on the right. Toggle at the top right; each device remembers its choice.
   Classic script, shared global scope; loaded after poll.js. */
var STAGE_KEY = 'mxLayout';
var STAGE_MQ = window.matchMedia('(orientation:landscape) and (min-width:900px) and (min-height:560px)');
var STAGE_PAGE_MS = 25000;       /* carousel: page change as in the kiosk */
var STAGE_IDLE_MS = 60000;       /* after own swiping/tapping, do not auto-page for this long */

var btnStage = document.getElementById('btnStage');
var topRight = document.getElementById('topRight');
var stageOn = false;
var stageInfoTimer = null, stageInfoUserAt = 0;

function stagePref() {
  try {
    var m = /[?&]layout=(stage|classic)\b/.exec(location.search);
    if (m) localStorage.setItem(STAGE_KEY, m[1]);           /* e.g. xplorio.html?layout=stage for the iPad next to the stereo */
    return localStorage.getItem(STAGE_KEY) === 'stage';
  } catch (e) { return false; }
}

/* queue, playlists and search buttons move to the bar at the top right (and back) */
var STAGE_BTNS = ['btnQueue', 'btnPlaylists', 'btnSearch'];
function stageMoveButtons(on) {
  var actions = document.getElementById('actions');
  STAGE_BTNS.forEach(function(id){
    var b = document.getElementById(id);
    if (on) { b.classList.add('topBtn'); topRight.insertBefore(b, btnStage); }
    else { b.classList.remove('topBtn'); actions.appendChild(b); }
  });
}

function stageApply() {
  var want = STAGE_MQ.matches && stagePref();
  if (want === stageOn) return;
  stageOn = want;
  closeAllOverlays();
  var info = document.getElementById('overlayInfo');
  if (want) document.getElementById('rightPane').insertBefore(info, document.getElementById('seekWrap'));   /* carousel between title and controls */
  else document.body.insertBefore(info, document.getElementById('overlayQueue'));
  stageMoveButtons(want);
  document.documentElement.classList.toggle('stage', want);
  btnStage.classList.toggle('on', want);
  lyrLastH = 0;                                              /* re-center the lyrics */
  infoOverlayBody.scrollTop = 0;
  stageInfoSchedule();
  setTimeout(stagePlainSetup, 50);
  lyrShiftPlace();                                           /* − and + above the lyrics */
}

btnStage.addEventListener('click', function(){
  try { localStorage.setItem(STAGE_KEY, stageOn ? 'classic' : 'stage'); } catch (e) {}
  stageApply();
});
if (STAGE_MQ.addEventListener) STAGE_MQ.addEventListener('change', stageApply);
else if (STAGE_MQ.addListener) STAGE_MQ.addListener(stageApply);          /* older Safari versions */

/* ---------- Info carousel: pages through the text, then to the next tab ---------- */
function stageInfoSchedule() {
  clearTimeout(stageInfoTimer);
  if (stageOn) stageInfoTimer = setTimeout(stageInfoStep, STAGE_PAGE_MS);
}

function stageInfoStep() {
  if (!stageOn) return;
  var idle = Date.now() - stageInfoUserAt >= STAGE_IDLE_MS;
  if (idle && infoItems.length) {
    var b = infoOverlayBody, page = b.clientHeight - 40;
    if (b.scrollTop + b.clientHeight < b.scrollHeight - 4 && page > 40) {
      stageScroll(b, Math.min(b.scrollTop + page, b.scrollHeight - b.clientHeight));
    } else if (infoItems.length > 1) {
      infoIdx = (infoIdx + 1) % infoItems.length;
      b.scrollTop = 0;
      buildInfoTabs(); renderInfo(1);
    } else if (b.scrollTop > 0) stageScroll(b, 0);
  }
  stageInfoSchedule();
}

/* smooth scrolling in whole pixels (old browsers lack scrollTo with options) */
function stageScroll(el, top) {
  var from = el.scrollTop, t0 = Date.now(), dur = 600;
  top = Math.round(top);
  (function step() {
    var k = Math.min(1, (Date.now() - t0) / dur);
    k = 1 - Math.pow(1 - k, 3);
    el.scrollTop = Math.round(from + (top - from) * k);
    if (k < 1) requestAnimationFrame(step);
  })();
}

['touchstart', 'wheel', 'mousedown'].forEach(function(ev){
  infoOverlayBody.addEventListener(ev, function(){ stageInfoUserAt = Date.now(); }, {passive:true});
});

/* dots below the carousel instead of the tab bar; tapping jumps to the tab */
var stageDots = document.createElement('div');
stageDots.id = 'stageDots';
document.getElementById('overlayInfo').appendChild(stageDots);
function stagePaintDots() {
  while (stageDots.firstChild) stageDots.removeChild(stageDots.firstChild);
  if (infoItems.length < 2) return;
  infoItems.forEach(function(it, i){
    var d = document.createElement('span');
    d.className = i === infoIdx ? 'on' : '';
    d.title = it.label || it.title;
    d.addEventListener('click', function(){
      if (i === infoIdx) return;
      stageInfoUserAt = Date.now();
      var dir = i > infoIdx ? 1 : -1;
      infoIdx = i; infoOverlayBody.scrollTop = 0;
      buildInfoTabs(); renderInfo(dir);
    });
    stageDots.appendChild(d);
  });
}
var stageBuildTabs = buildInfoTabs;
buildInfoTabs = function(){ stageBuildTabs(); stagePaintDots(); };

/* new track: carousel from the start */
var stageShowInfo = showInfo;
showInfo = function(list){
  stageShowInfo(list);
  infoOverlayBody.scrollTop = 0;
  stageInfoSchedule();
};

/* ---------- Lyrics without timestamps: overly long texts slightly smaller; if they still do not fit, the user scrolls
   (no automatic paging: otherwise the text would vanish while reading it) ---------- */
var STAGE_PLAIN_MIN = 0.72;      /* smallest font relative to the normal size */

var stageShowLyrics = showLyrics;
showLyrics = function(data){
  stageShowLyrics(data);
  lyricsText.style.fontSize = '';
  stagePlainSetup();
};

function stagePlainSetup() {
  lyricsText.style.fontSize = '';
  if (!stageOn || lyricsText.classList.contains('synced') || !lyricsText.textContent) return;
  var avail = area.clientHeight - 24;
  if (!avail || lyricsText.scrollHeight <= avail) return;
  var base = parseFloat(getComputedStyle(lyricsText).fontSize), min = Math.round(base * STAGE_PLAIN_MIN);
  for (var px = Math.floor(base) - 1; px >= min && lyricsText.scrollHeight > avail; px--) lyricsText.style.fontSize = px + 'px';
  area.scrollTop = 0;
}

window.addEventListener('resize', function(){ if (stageOn) setTimeout(stagePlainSetup, 100); });

stageApply();
