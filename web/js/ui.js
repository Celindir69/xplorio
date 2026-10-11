/* Overlays öffnen/schließen und Wiedergabe-Tasten
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html. */
/* ---------- Overlays ---------- */
function closeAllOverlays() {
  overlayLyrics.classList.remove('on');
  overlayInfo.classList.remove('on');
  overlayQueue.classList.remove('on');
  overlayPlaylists.classList.remove('on');
  overlaySearch.classList.remove('on');
  var ob = document.getElementById('overlayBrowse');
  if (ob) ob.classList.remove('on');
  var om = document.getElementById('overlayMenu');
  if (om) om.classList.remove('on');
  var ov = document.getElementById('overlayVolumio');
  if (ov) ov.classList.remove('on');
  var oc = document.getElementById('overlayCheck');
  if (oc) oc.classList.remove('on');
  if (typeof checkRelease === 'function') checkRelease();      /* zurückgehaltene MPD-Scans jetzt (check.js) */
  var oh = document.getElementById('overlayHistory');
  if (oh) oh.classList.remove('on');
  var osy = document.getElementById('overlaySystem');
  if (osy) osy.classList.remove('on');
  var opb = document.getElementById('overlayPlayback');
  if (opb) opb.classList.remove('on');
  var ohl = document.getElementById('overlayHelp');
  if (ohl) ohl.classList.remove('on');
  var ow = document.getElementById('overlayWelcome');
  if (ow) ow.classList.remove('on');
  var ot = document.getElementById('overlayTags');
  if (ot) ot.classList.remove('on');
  if (window.closeVolumioFrame) closeVolumioFrame();
}
function toggleOverlay(overlay) {
  var isOpen = overlay.classList.contains('on');
  closeAllOverlays();
  if (!isOpen) overlay.classList.add('on');
}

/* Tippen auf eine freie Stelle neben dem Overlay schließt es. Nicht bei Bedienelementen (die wechseln wie bisher
   das Overlay), nicht im Tag-Editor (ungesicherte Änderungen) und nicht für die festen Felder der Bühnenansicht. */
function overlayFreeTap(t) {
  var open = [].filter.call(document.querySelectorAll('.overlay.on'), function(o){
    return !(document.documentElement.classList.contains('stage') && (o.id === 'overlayInfo' || o.id === 'overlayLyrics'));
  });
  if (!open.length || open.some(function(o){ return o.id === 'overlayTags'; })) return false;
  return !(t && t.closest && t.closest('.overlay, .topBtn, #meta, #seekWrap, #ctrl, #volWrap, #actions, #toast, button, a, input, iframe'));
}
var overlayDownFree = false;                       /* Druck und Loslassen beide frei: Ziehen aus dem Overlay heraus zählt nicht */
document.addEventListener('pointerdown', function(e){ overlayDownFree = overlayFreeTap(e.target); }, true);
document.addEventListener('click', function(e){
  if (overlayDownFree && document.documentElement.contains(e.target) && overlayFreeTap(e.target)) closeAllOverlays();
  overlayDownFree = false;
});

btnLyrics.addEventListener('click', function(){
  if (!btnLyrics.classList.contains('has-content')) return;
  toggleOverlay(overlayLyrics);
});
document.getElementById('closeLyrics').addEventListener('click', closeAllOverlays);

btnInfo.addEventListener('click', function(){
  if (!btnInfo.classList.contains('has-content')) return;
  toggleOverlay(overlayInfo);
});

document.getElementById('closeInfo').addEventListener('click', closeAllOverlays);

btnQueue.addEventListener('click', function(){
  var isOpen = overlayQueue.classList.contains('on');
  closeAllOverlays();
  if (!isOpen) { overlayQueue.classList.add('on'); loadQueue(); }
});
document.getElementById('closeQueue').addEventListener('click', closeAllOverlays);

btnPlaylists.addEventListener('click', function(){
  var isOpen = overlayPlaylists.classList.contains('on');
  closeAllOverlays();
  if (!isOpen) {
    overlayPlaylists.classList.add('on');
    plShowTab(plTabActive);
  }
});
document.getElementById('closePlaylists').addEventListener('click', closeAllOverlays);

btnSearch.addEventListener('click', function(){
  var isOpen = overlaySearch.classList.contains('on');
  closeAllOverlays();
  if (!isOpen) {
    overlaySearch.classList.add('on');
    setTimeout(function(){ searchInput.focus(); }, 400);
  }
});
document.getElementById('closeSearch').addEventListener('click', closeAllOverlays);

var swipeStartY = 0, swipeStartX = 0;
var swipeFromTop = false;

document.addEventListener('touchstart', function(e){
  swipeStartY = e.changedTouches[0].clientY;
  swipeStartX = e.changedTouches[0].clientX;
  swipeFromTop = false;
  var el = e.target;
  while (el && el !== document.body) {
    if (el.classList &&
        (el.classList.contains('overlayHandle') ||
         el.classList.contains('overlayHead'))) {
      swipeFromTop = true;
      break;
    }
    el = el.parentElement;
  }
}, {passive:true});

document.addEventListener('touchend', function(e){
  if (drag) return;
  if (!swipeFromTop) return;
  var dy = e.changedTouches[0].clientY - swipeStartY;
  var dx = e.changedTouches[0].clientX - swipeStartX;
  var land = window.matchMedia('(orientation:landscape)').matches;   /* Querformat: Seitenleiste, nach rechts wischen */
  if (!(land ? dx > 80 && dx > Math.abs(dy) * 1.5 : dy > 80)) return;
  if (overlayTags.classList.contains('on')) return overlayTags.classList.remove('on');   /* wie das X: nur der Editor, die Seite darunter bleibt */
  closeAllOverlays();
}, {passive:true});

/* ---------- Wiedergabe ---------- */
function cmd(c) { fetch('/api/v1/commands/?cmd=' + c).catch(function(){}); }
document.getElementById('cPrev').addEventListener('click', function(){ cmd('prev'); });
document.getElementById('cPlay').addEventListener('click', function(){ cmd('toggle'); });
document.getElementById('cNext').addEventListener('click', function(){ cmd('next'); });

document.getElementById('seekBar').addEventListener('click', function(e){
  if (!curDur) return;
  var rect = this.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekBase = pct * curDur * 1000; seekStamp = Date.now();
  paintTime();
  fetch('/api/v1/commands/?cmd=seek&position=' + Math.floor(pct * curDur))
    .catch(function(){});
});

document.addEventListener('visibilitychange', function(){
  if (!document.hidden) { lastKey = ''; lastLyrKey = ''; poll(); }
});

/* kurze Meldung unten */
var toastTimer = null;
function showToast(text) {
  var el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('on'); }, 3500);
}

/* body.ovOn: ein Overlay ist offen; body.ovMain: eines außer Lyrics und Info (für die CSS-Regeln am Zahnrad;
   ersetzt :has(), das Safari vor 15.4 nicht kennt) */
(function(){
  var list = document.querySelectorAll('.overlay');
  function sync() {
    var on = false, main = false;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].classList.contains('on')) continue;
      on = true;
      if (list[i].id !== 'overlayLyrics' && list[i].id !== 'overlayInfo') main = true;
    }
    document.body.classList.toggle('ovOn', on);
    document.body.classList.toggle('ovMain', main);
  }
  if (window.MutationObserver) {
    var mo = new MutationObserver(sync);
    for (var i = 0; i < list.length; i++) mo.observe(list[i], {attributes: true, attributeFilter: ['class']});
  }
  sync();
})();

/* Esc (Desktop, iPad mit Tastatur): Tag-Editor schließen, in der Album-/Künstleransicht eine Stufe zurück, sonst alles zu */
document.addEventListener('keydown', function(e){
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  if (overlayTags && overlayTags.classList.contains('on')) { overlayTags.classList.remove('on'); return; }
  if (overlayBrowse.classList.contains('on') && browseStack.length > 1) { browseBack.click(); return; }
  closeAllOverlays();
});
