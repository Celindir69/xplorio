/* Which folders below the music root are drives (fileops.js, duplicates.js trashPath, trash.js, tag service).
   Volumio: INTERNAL, USB/<drive> and NAS/<share>, each one a drive with its own "Xplorio Trash".
   Mac (macsettings.js): the place USB or NAS is often one music folder itself, a link straight to it (musicAdd makes the
   first folder the place itself, e.g. USB -> /Volumes/MX-Media). Then the place as a whole is one drive, not every folder
   inside it. The same on the Mac for a real folder USB or NAS without links inside (music lying in it directly).
   A place that holds links stays a folder of drives, one per entry, as on Volumio.
   Paths in the library do not change ("USB/Musik/…"), only what counts as the drive.
   Node 8, ES5 only. */
var fs = require('fs');
var path = require('path');

var SLOTS = ['USB', 'NAS'];
var TTL = 3000;                                        /* the layout is looked at again after that long */

var macFlag = false, defRoot = null, cache = {};

function lstat(p) { try { return fs.lstatSync(p); } catch (e) { return null; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function children(p) { try { return fs.readdirSync(p).sort(); } catch (e) { return []; } }

/* root: the music root for calls without one; mac: true, false or a function (asked each time the layout is looked at) */
function setup(root, mac) {
  if (root) defRoot = root;
  if (mac !== undefined) macFlag = mac;
  cache = {};
}
function reset() { cache = {}; }
function onMac() { return typeof macFlag === 'function' ? !!macFlag() : !!macFlag; }

/* the places that are one drive as a whole: {USB: true} */
function whole(root) {
  root = root || defRoot;
  if (!root) return {};
  var c = cache[root], now = Date.now();
  if (c && now - c.at < TTL) return c.whole;
  var out = {}, mac = onMac();
  SLOTS.forEach(function(s){
    var p = path.join(root, s), st = lstat(p);
    if (!st) return;
    if (st.isSymbolicLink()) { if (isDir(p)) out[s] = true; return; }
    if (!mac || !st.isDirectory()) return;
    var links = children(p).some(function(n){ var x = lstat(path.join(p, n)); return x && x.isSymbolicLink(); });
    if (!links) out[s] = true;
  });
  cache[root] = {at: now, whole: out};
  return out;
}
function wholeList(root) { return Object.keys(whole(root)).sort(); }

/* number of path parts of the drive: INTERNAL 1, a whole place 1, USB/<x> and NAS/<x> 2 */
function driveParts(parts, root) {
  if (parts[0] === 'INTERNAL') return 1;
  return whole(root)[parts[0]] ? 1 : 2;
}
/* "USB/S/Beatles/Help" -> "USB/S" (or "USB" if USB is one drive) */
function driveOf(rel, root) {
  var p = String(rel).split('/');
  return p.slice(0, driveParts(p, root)).join('/');
}

/* the drives below USB and NAS (INTERNAL not included): a whole place itself, else its folders (also hidden ones; the
   caller leaves those out where wanted) */
function list(root) {
  root = root || defRoot;
  var w = whole(root), out = [];
  SLOTS.forEach(function(s){
    if (w[s]) { out.push(s); return; }
    children(path.join(root, s)).forEach(function(d){ if (isDir(path.join(root, s, d))) out.push(s + '/' + d); });
  });
  return out;
}

module.exports = {setup: setup, reset: reset, whole: whole, wholeList: wholeList, driveParts: driveParts, driveOf: driveOf,
  list: list, TTL: TTL};
