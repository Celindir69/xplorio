/* AirPlay speakers on the Mac (Xplorio4Mac, macOS 11 Big Sur): macOS gives programs no way to pick an AirPlay speaker
   (Core Audio shows one only once it is chosen, Apple's own interface needs an Apple entitlement). Big Sur's System
   Preferences list them under Sound -> Output, so this reads and clicks that list through System Events (UI scripting).
   Needs: Xplorio allowed under Security & Privacy -> Privacy -> Accessibility, and once "Xplorio wants to control
   System Events" confirmed on the Mac. System Preferences opens for a moment and closes again (if it was not open).
   From Ventura on the Sound pane looks different: then reading the list fails (error "airplay").
   opts: run(file, args, cb(err, stdout, stderr)) (replacement for execFile, tests). Node 8, ES5 only. */
var cp = require('child_process');

var OSASCRIPT = '/usr/bin/osascript', TIMEOUT = 30000;

/* one AppleScript for both: list (want "") or choose the row named want. Output: one line per row, name TAB type TAB 1|0
   (1: the Mac's output now), and "#chosen" when want was clicked */
var SCRIPT = [
  'on run argv',
  '  set want to item 1 of argv',
  '  tell application "System Events" to set wasOpen to (exists process "System Preferences")',
  '  tell application "System Preferences" to reveal anchor "output" of pane id "com.apple.preference.sound"',
  '  set out to ""',
  '  tell application "System Events" to tell process "System Preferences"',
  '    set t0 to current date',
  '    repeat until exists (table 1 of scroll area 1 of tab group 1 of window 1)',
  '      if (current date) - t0 > 10 then error "nolist"',
  '      delay 0.2',
  '    end repeat',
  '    delay 1.5',
  '    set tbl to table 1 of scroll area 1 of tab group 1 of window 1',
  '    repeat with r in (rows of tbl)',
  '      set nm to ""',
  '      set ty to ""',
  '      try',
  '        set nm to value of text field 1 of r',
  '      end try',
  '      try',
  '        set ty to value of text field 2 of r',
  '      end try',
  '      set cur to "0"',
  '      if selected of r then set cur to "1"',
  '      if want is not "" and nm is want then',
  '        select r',
  '        set cur to "1"',
  '        set out to out & "#chosen" & linefeed',
  '      end if',
  '      set out to out & nm & tab & ty & tab & cur & linefeed',
  '    end repeat',
  '  end tell',
  '  if not wasOpen then',
  '    delay 0.5',
  '    tell application "System Preferences" to quit',
  '  end if',
  '  return out',
  'end run'
].join('\n');

/* rows -> {speakers: [{name, raw, current}], chosen}: only AirPlay rows (type column "AirPlay" in every language) */
function parse(text) {
  var speakers = [], chosen = false;
  String(text || '').split('\n').forEach(function(l){
    if (l === '#chosen') { chosen = true; return; }
    var f = l.split('\t');
    if (f.length < 3 || !/airplay/i.test(f[1])) return;
    var name = f[0].replace(/^\s+|\s+$/g, '');
    if (name) speakers.push({name: name, raw: f[0], current: f[2] === '1'});   /* raw: as the list has it (clicking compares exactly) */
  });
  return {speakers: speakers, chosen: chosen};
}

/* error of osascript -> short code: access (Accessibility not allowed), automation (System Events not allowed), airplay */
function errorCode(err, stderr) {
  var s = String(stderr || '') + ' ' + String((err && err.message) || '');
  if (/-25211|-1719|assistive|Hilfszugriff|Bedienungshilfen/i.test(s)) return 'access';
  if (/-1743|not authori[sz]ed|nicht berechtigt/i.test(s)) return 'automation';
  return 'airplay';
}

function defaultRun(file, args, cb) {
  cp.execFile(file, args, {timeout: TIMEOUT, maxBuffer: 1024 * 1024}, function(err, stdout, stderr){
    cb(err, String(stdout || ''), String(stderr || ''));
  });
}

function AirPlay(opts) {
  opts = opts || {};
  this.run = opts.run || defaultRun;
}

AirPlay.prototype.call = function(want, cb) {
  this.run(OSASCRIPT, ['-e', SCRIPT, String(want || '')], function(err, out, stderr){
    if (err) return cb(new Error(errorCode(err, stderr)));
    cb(null, parse(out));
  });
};
/* cb(err, [{name, current}]) */
AirPlay.prototype.list = function(cb) { this.call('', function(e, r){ cb(e, r ? r.speakers : []); }); };
/* make this speaker the Mac's sound output. cb(err, [{name, current}]) */
AirPlay.prototype.select = function(name, cb) {
  if (!name) return cb(new Error('output'));
  this.call(name, function(e, r){
    if (e) return cb(e);
    if (!r.chosen) return cb(new Error('output'));    /* not (any more) in the list */
    cb(null, r.speakers.map(function(x){ return {name: x.name, raw: x.raw, current: x.raw === name}; }));   /* rows read before the click still show the old one */
  });
};

module.exports = {AirPlay: AirPlay, parse: parse, errorCode: errorCode, SCRIPT: SCRIPT};
