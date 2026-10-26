/* Access to the original Volumio UI (menu at the top right, entry "Volumio UI")
   Classic script, shared global scope; load order see xplorio.html.
   The pages open in the overlay in a frame (iframe), the app stays intact underneath.
   Pages that xplorio.html has taken over itself can simply be removed from the list here. */

var VOLUMIO_PAGES = [
  { label: T('volumio.page.home'),     path: '/' },              /* start page of every UI (Classic, Contemporary, Manifest), menu to all other pages */
  { label: T('volumio.page.browse'),   path: '/browse' },
  { label: T('volumio.page.queue'),    path: '/queue' },
  { label: T('volumio.page.plugins'),  path: '/plugin-manager' },
  { label: T('volumio.page.system'),   path: '/dev' }              /* developer page: SSH, logs, restart */

];

/* on Xplorio's own web server (server/xplorio-server.js, port 4040 or another one) "/" is Xplorio itself: Volumio's
   pages then come from Volumio's own address (port 80, or 3000). On the player itself (kiosk browser at localhost)
   port 3000 directly: Volumio forwards port 80 to 3000 only for requests from the network */
var VOLUMIO_ORIGIN = ['', '80', '443', '3000'].indexOf(location.port) >= 0 ? ''
  : /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname) ? 'http://' + location.hostname + ':3000'
  : location.protocol + '//' + location.hostname;

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
  f.src = VOLUMIO_ORIGIN + pg.path;
  openVolumioTab.href = VOLUMIO_ORIGIN + pg.path;
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
