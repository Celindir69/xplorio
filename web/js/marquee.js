/* Long title: scrolls through once, then stays truncated (…) for 30 seconds, scrolls again
   Classic script, shared global scope; load order see xplorio.html.
   The element has overflow:hidden; the text is moved via scrollLeft (no extra elements needed). */
var MARQUEE_SPEED = 45;       /* pixels per second */
var MARQUEE_EDGE_MS = 1500;   /* pause at start and end */
var MARQUEE_REST_MS = 30000;  /* stay truncated before the title scrolls again */

function marqueeSet(el, text) {
  if (el._mqText === text) return;           /* the poll delivers the same title again and again */
  el._mqText = text;
  marqueeStop(el);
  el.textContent = text;
  marqueeSchedule(el, 800);
}

function marqueeStop(el) {
  clearTimeout(el._mqTimer);
  cancelAnimationFrame(el._mqFrame);
  el.scrollLeft = 0;
  el.style.textOverflow = '';
}

function marqueeSchedule(el, delay) {
  clearTimeout(el._mqTimer);
  el._mqTimer = setTimeout(function(){ marqueeRun(el); }, delay);
}

function marqueeRun(el) {
  var dist = el.scrollWidth - el.clientWidth;
  if (dist <= 2 || document.hidden) {         /* fits in the line (or page hidden): check again later */
    marqueeSchedule(el, dist <= 2 ? MARQUEE_REST_MS : 2000);
    return;
  }
  el.style.textOverflow = 'clip';             /* no ellipsis while scrolling */
  var dur = dist / MARQUEE_SPEED * 1000, t0 = 0;
  function step(now) {
    if (!t0) t0 = now;
    var k = Math.min(1, Math.max(0, (now - t0 - MARQUEE_EDGE_MS) / dur));
    el.scrollLeft = dist * k;
    if (now - t0 < MARQUEE_EDGE_MS + dur + MARQUEE_EDGE_MS) {
      el._mqFrame = requestAnimationFrame(step);
    } else {
      el.scrollLeft = 0;
      el.style.textOverflow = '';             /* truncated again */
      marqueeSchedule(el, MARQUEE_REST_MS);
    }
  }
  el._mqFrame = requestAnimationFrame(step);
}

/* window resized (rotation): re-evaluate */
window.addEventListener('resize', function(){
  [mTitle].forEach(function(el){
    if (el._mqText === undefined) return;
    marqueeStop(el);
    marqueeSchedule(el, 500);
  });
});
