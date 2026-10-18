/* Queue (Liste, Verschieben, Entfernen)
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html. */
/* ---------- Queue ---------- */
var DELETE_W = 20;
var lastTouchAt = 0;          /* Zeitpunkt der letzten Touch-Eingabe: danach folgende "click"-Ereignisse nicht doppelt auswerten */
var finePointer = !!(window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches);   /* Maus/Trackpad */

/* Breite der Maßeinheit --vw in Pixeln (begrenzt auf großen Bildschirmen, siehe base.css) */
function vwPx() {
  var p = document.createElement('div');
  p.style.cssText = 'position:absolute;visibility:hidden;width:var(--vw)';
  document.body.appendChild(p);
  var w = p.getBoundingClientRect().width;
  document.body.removeChild(p);
  return w || window.innerWidth / 100;
}

function resetSwipe() {
  if (!swipe) return;
  swipe.wrap.classList.remove('swiped');
  swipe = null;
}

var queueSeq = 0;              /* nur die Antwort der letzten Anfrage zeichnen (ältere kämen sonst mit veralteten Positionen) */
/* Tipp auf einen Titel: abspielen; steht der Verstärker auf einem anderen Eingang, nur das sagen (ein Start ins Leere
   ließe Volumio durch die Titel springen) */
function queuePlayAt(i) {
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;
  if (inp) { showToast(T('audio.otherInput', {name: inp.name})); return; }
  socket.emit('play', {value: i});
}
function loadQueue() {
  var seq = ++queueSeq;
  fetch('/api/v1/getQueue').then(function(r){ return r.json(); }).then(function(j){
    if (seq !== queueSeq) return;
    if (drag) { setTimeout(loadQueue, 500); return; }     /* nicht unter dem Finger neu aufbauen */
    queueData = (j && j.queue) ? j.queue : [];
    while (queueList.firstChild) queueList.removeChild(queueList.firstChild);

    var qRows = [];
    queueData.forEach(function(t, i){
      var wrap = document.createElement('div');
      wrap.className = 'qRowWrap';
      var delLine = document.createElement('div');
      delLine.className = 'dragover-line';
      wrap.appendChild(delLine);

      var row = document.createElement('div');
      row.className = 'qRow' + (i === curPos ? ' cur' : '');
      row.dataset.qi = i;

      var num = document.createElement('div');
      num.className = 'qNum';
      num.textContent = i === curPos ? '▶' : (i + 1);

      var img = document.createElement('img');
      img.className = 'qCover';
      img.loading = 'lazy';                              /* lange Listen: Bilder erst, wenn sichtbar */
      img.decoding = 'async';
      if (t.albumart) img.src = artUrl(t.albumart);

      var meta = document.createElement('div');
      meta.className = 'qMeta';
      var ti = document.createElement('div');
      ti.className = 'qTitle'; ti.textContent = t.name || t.title || '';
      var ar = document.createElement('div');
      ar.className = 'qArtist'; ar.textContent = t.artist || '';
      meta.appendChild(ti); meta.appendChild(ar);

      var handle = document.createElement('div');
      handle.className = 'qHandle';
      if (i !== curPos) {
        handle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 3H7v2h2V3zm0 4H7v2h2V7zm0 4H7v2h2v-2zm0 4H7v2h2v-2zm4-12h-2v2h2V3zm0 4h-2v2h2V7zm0 4h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>';
      }

      var trash = document.createElement('div');          /* Papierkorb für Maus und Trackpad (nur dort sichtbar, siehe CSS) */
      trash.className = 'qTrash';
      trash.title = T('queue.remove');
      trash.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      trash.addEventListener('click', function(e){
        e.stopPropagation();
        socket.emit('removeFromQueue', {value: i});
        setTimeout(loadQueue, 300);
      });

      row.appendChild(num); row.appendChild(img);
      row.appendChild(meta);
      var pen = tagTrackButton(t);                        /* lokale Datei: Tags bearbeiten */
      if (pen) row.appendChild(pen);
      row.appendChild(trash); row.appendChild(handle);
      qRows.push(row);

      var del = document.createElement('div');
      del.className = 'qDelete';
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      del.addEventListener('click', function(e){
        e.stopPropagation();
        socket.emit('removeFromQueue', {value: i});
        resetSwipe();
        setTimeout(loadQueue, 300);
      });

      wrap.appendChild(row); wrap.appendChild(del);

      var touchState = {startX:0, startY:0, mode:null};
      row.addEventListener('touchstart', function(e){
        lastTouchAt = Date.now();
        touchState.startX = e.changedTouches[0].clientX;
        touchState.startY = e.changedTouches[0].clientY;
        touchState.mode = null;
      }, {passive:true});

      row.addEventListener('touchmove', function(e){
        if (touchState.mode === 'drag') return;
        var dx = e.changedTouches[0].clientX - touchState.startX;
        var dy = e.changedTouches[0].clientY - touchState.startY;
        if (touchState.mode === null) {
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) touchState.mode = 'swipe';
          else if (Math.abs(dy) > 8) touchState.mode = 'scroll';
        }
        if (touchState.mode === 'swipe') {
          e.preventDefault();
          if (dx < 0) {
            var pct = Math.min(-dx / (vwPx() * 100) * 100, DELETE_W);   /* in Einheiten von --vw */
            row.style.transition = 'none';
            row.style.transform = 'translateX(calc(-' + pct + ' * var(--vw)))';
            del.style.transition = 'none';
            del.style.transform  = 'translateX(' + (100 - pct / DELETE_W * 100) + '%)';
          } else if (wrap.classList.contains('swiped')) {
            row.style.transition = 'none'; row.style.transform = 'translateX(0)';
            del.style.transition = 'none'; del.style.transform  = 'translateX(100%)';
          }
        }
      }, {passive:false});

      row.addEventListener('touchend', function(e){
        if (touchState.mode === 'swipe') {
          var dx = e.changedTouches[0].clientX - touchState.startX;
          row.style.transition = ''; del.style.transition = '';
          row.style.transform = ''; del.style.transform = '';
          if (dx < -window.innerWidth * 0.15) {
            if (swipe && swipe.wrap !== wrap) resetSwipe();
            wrap.classList.add('swiped'); swipe = {wrap:wrap};
          } else {
            wrap.classList.remove('swiped');
            if (swipe && swipe.wrap === wrap) swipe = null;
          }
          return;
        }
  if (drag) return;

  /* Nur als Tap werten, wenn kaum Bewegung stattfand */
  var dxTotal = Math.abs(e.changedTouches[0].clientX - touchState.startX);
  var dyTotal = Math.abs(e.changedTouches[0].clientY - touchState.startY);
  if (dxTotal > 10 || dyTotal > 10) return;


  e.stopPropagation();
  queuePlayAt(i);
}, {passive:false});
      if (i !== curPos) {
        handle.addEventListener('touchstart', function(e){
          e.preventDefault(); e.stopPropagation();
          resetSwipe();
          var touch = e.changedTouches[0];
          drag = { fromIdx:i, toIdx:i, startY:touch.clientY,
                   rowH:row.getBoundingClientRect().height, row:row };
          row.classList.add('dragging');
          touchState.mode = 'drag';
        }, {passive:false});
      }

      /* Maus/Trackpad: Klick auf die Zeile spielt ab, Handle per Maus ziehen */
      row.addEventListener('click', function(){
        if (Date.now() - lastTouchAt < 800) return;      /* Tippen wurde schon über touchend behandelt */
        if (drag) return;
        queuePlayAt(i);
      });
      if (i !== curPos) {
        handle.addEventListener('click', function(e){ e.stopPropagation(); });
        handle.addEventListener('pointerdown', function(e){
          if (e.pointerType === 'touch') return;          /* Touch läuft über die touch-Ereignisse */
          e.preventDefault(); e.stopPropagation();
          if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
          drag = { fromIdx:i, toIdx:i, startY:e.clientY, rowH:row.getBoundingClientRect().height, row:row, mouse:true };
          row.classList.add('dragging');
        });
        handle.addEventListener('pointermove', function(e){
          if (!drag || !drag.mouse || drag.row !== row) return;
          var dy = e.clientY - drag.startY;
          row.style.transform = 'translateY(' + dy + 'px)';
          var n = Math.max(0, Math.min(queueData.length - 1, Math.round(drag.fromIdx + dy / drag.rowH)));
          if (n !== drag.toIdx) {
            drag.toIdx = n;
            var wraps = queueList.querySelectorAll('.qRowWrap');
            for (var k = 0; k < wraps.length; k++) wraps[k].classList.remove('dragover');
            if (wraps[n]) wraps[n].classList.add('dragover');
          }
        });
        var endMouseDrag = function(){
          if (!drag || !drag.mouse || drag.row !== row) return;
          var d = drag;
          setTimeout(function(){ if (drag === d) drag = null; }, 0);   /* damit das folgende click-Ereignis die Zeile nicht abspielt */
          row.style.transform = '';
          row.classList.remove('dragging');
          var wraps = queueList.querySelectorAll('.qRowWrap');
          for (var k = 0; k < wraps.length; k++) wraps[k].classList.remove('dragover');
          if (d.toIdx !== d.fromIdx) {
            socket.emit('moveQueue', {from: d.fromIdx, to: d.toIdx});
            setTimeout(function(){ loadQueue(); poll(); }, 400);
          }
        };
        handle.addEventListener('pointerup', endMouseDrag);
        handle.addEventListener('pointercancel', endMouseDrag);
      }

      queueList.appendChild(wrap);
    });
    if (typeof rateQueue === 'function') rateQueue(queueData, qRows);   /* Daumen je Titel (rating.js) */

    if (queueData.length) {
      var hint = document.createElement('div');
      hint.className = 'qHint';
      hint.textContent = finePointer
        ? T('queue.hintMouse')
        : T('queue.hintTouch');
      queueList.insertBefore(hint, queueList.firstChild);   /* oben, wie bei den anderen Listen; bei langen Listen sonst nie zu sehen */
    }
    if (!queueData.length) {                           /* leer: Hinweis und Weg zur Suche statt einer leeren Fläche */
      queueList.appendChild(browseNote(T('queue.empty')));
      var go = document.createElement('button');
      go.className = 'ckBtn qEmptyBtn'; go.textContent = T('queue.emptySearch');
      go.addEventListener('click', function(){ btnSearch.click(); });
      queueList.appendChild(go);
    }
    var cur = queueList.querySelector('.cur');
    if (cur) cur.scrollIntoView({block:'center', behavior:'smooth'});
  }).catch(function(){
    if (seq !== queueSeq) return;
    while (queueList.firstChild) queueList.removeChild(queueList.firstChild);
    queueList.appendChild(browseNote(T('queue.error')));
  });
}

document.addEventListener('touchmove', function(e){
  if (!drag) return;
  e.preventDefault();
  var touch = e.changedTouches[0];
  var dy = touch.clientY - drag.startY;
  drag.row.style.transform = 'translateY(' + dy + 'px)';
  var newIdx = Math.round(drag.fromIdx + dy / drag.rowH);
  newIdx = Math.max(0, Math.min(queueData.length - 1, newIdx));
  if (newIdx !== drag.toIdx) {
    drag.toIdx = newIdx;
    queueList.querySelectorAll('.qRowWrap').forEach(function(w){ w.classList.remove('dragover'); });
    var wraps = queueList.querySelectorAll('.qRowWrap');
    if (wraps[newIdx]) wraps[newIdx].classList.add('dragover');
  }
}, {passive:false});

document.addEventListener('touchcancel', function(){    /* iOS bricht ab (Systemgeste): Ziehen beenden, nichts verschieben */
  if (!drag) return;
  var d = drag; drag = null;
  d.row.style.transform = '';
  d.row.classList.remove('dragging');
  queueList.querySelectorAll('.qRowWrap').forEach(function(w){ w.classList.remove('dragover'); });
});
document.addEventListener('touchend', function(e){
  if (!drag) return;
  var d = drag; drag = null;
  d.row.style.transform = '';
  d.row.classList.remove('dragging');
  queueList.querySelectorAll('.qRowWrap').forEach(function(w){ w.classList.remove('dragover'); });
  if (d.toIdx !== d.fromIdx) {
    socket.emit('moveQueue', {from: d.fromIdx, to: d.toIdx});
    setTimeout(function(){ loadQueue(); poll(); }, 400);
  }
}, {passive:true});

queueList.addEventListener('touchstart', function(e){
  if (!swipe) return;
  if (!swipe.wrap.contains(e.target)) resetSwipe();
}, {passive:true});

