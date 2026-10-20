/* Access to the original Volumio UI (menu at the top right, entry "Volumio UI")
   Classic script, shared global scope; load order see xplorio.html.
   The pages open in the overlay in a frame (iframe), the app stays intact underneath.
   Pages that xplorio.html has taken over itself can simply be removed from the list here. */

var VOLUMIO_PAGES = [
  { label: T('volumio.page.browse'),   path: '/browse' },
  { label: T('volumio.page.queue'),    path: '/queue' },
  { label: T('volumio.page.settings'), path: '/settings' },
  { label: T('volumio.page.plugins'),  path: '/plugin-manager' },
  { label: T('volumio.page.system'),   path: '/dev' }              /* developer page: SSH, logs, restart */

];

var overlayVolumio   = document.getElementById('overlayVolumio');
var volumioTabBar    = document.getElementById('volumioTabBar');
var volumioPanel     = document.getElementById('volumioPanel');
var volumioHint      = document.getElementById('volumioHint');
var openVolumioTab   = document.getElementById('openVolumioTab');
var volumioActive    = -1;

function buildVolumioTabs() {
  volumioTabBar.innerHTML = '';
  VOLUMIO_PAGES.forEach(function(pg, i){
    var tab = document.createElement('div');
    tab.className = 'qTab';
    tab.textContent = pg.label;
    tab.addEventListener('click', function(){ showVolumioPage(i); });
    volumioTabBar.appendChild(tab);
  });
}

function showVolumioPage(i) {
  var pg = VOLUMIO_PAGES[i];
  if (!pg) return;
  volumioActive = i;
  Array.prototype.forEach.call(volumioTabBar.children, function(el, k){
    el.className = 'qTab' + (k === i ? ' on' : '');
  });
  volumioHint.style.display = 'none';
  var f = document.getElementById('volumioFrame');
  if (!f) {
    f = document.createElement('iframe');
    f.id = 'volumioFrame';
    volumioPanel.appendChild(f);
  }
  f.src = pg.path;
  openVolumioTab.href = pg.path;
  openVolumioTab.style.display = '';
}

/* remove the frame on close (saves work on the player and in the browser) */
function closeVolumioFrame() {
  var f = document.getElementById('volumioFrame');
  if (f) f.parentNode.removeChild(f);
  volumioActive = -1;
  volumioHint.style.display = '';
  openVolumioTab.style.display = 'none';
  Array.prototype.forEach.call(volumioTabBar.children, function(el){ el.className = 'qTab'; });
}

function openVolumio() {                       /* from the menu (menu.js) */
  closeAllOverlays();
  overlayVolumio.classList.add('on');
}
document.getElementById('volumioBack').addEventListener('click', function(){ openMenu(); });
document.getElementById('closeVolumio').addEventListener('click', closeAllOverlays);

buildVolumioTabs();
